/**
 * World Info Engine – self-contained worldbook activation and EJS rendering.
 *
 * Replicates SillyTavern's worldbook activation logic:
 *  - Constant (🔵) entries
 *  - Decorator-based activation (@@activate, @@dont_activate, @@only_preload)
 *  - Primary keyword matching (regex, case-sensitive, whole-word)
 *  - Secondary keyword (blue lamp) logic: AND_ANY, AND_ALL, NOT_ANY, NOT_ALL
 *  - Probability filtering
 *  - Inclusion group handling (priority, scoring, weighted random)
 *  - Position classification (before/after char defs, at depth, etc.)
 *
 * Used exclusively for workflow prompt assembly.
 */

import { EwSettings } from './types';
import { evalEjsTemplate, createRenderContext } from './ejs-internal';

// ---------------------------------------------------------------------------
// ST Constants (replicated locally to avoid import dependency)
// ---------------------------------------------------------------------------

/** ST world_info_position enum values */
const WI_POSITION: Record<string, number> = {
  before: 0,       // Before Char Defs
  after: 1,        // After Char Defs
  EMTop: 2,        // Before Example Messages
  EMBottom: 3,     // After Example Messages
  ANTop: 4,        // Top of Author's Note
  ANBottom: 5,     // Bottom of Author's Note
  atDepth: 6,      // @ D (at specified depth in chat)
};

/** ST world_info_logic enum values (selectiveLogic) */
const WI_LOGIC: Record<string, number> = {
  AND_ANY: 0,   // Primary + Any secondary
  NOT_ALL: 1,   // Primary + NOT all secondary
  NOT_ANY: 2,   // Primary + NONE of the secondary
  AND_ALL: 3,   // Primary + ALL secondary
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal worldbook entry as returned by ST's getWorldbook API */
interface RawWbEntry {
  uid: number;
  name: string;
  content: string;
  enabled: boolean;
  position: {
    type: string;
    role: string;
    depth: number;
    order: number;
  };
  strategy: {
    type: string;
    keys: string[];
    keys_secondary: { logic: string; keys: string[] };
    scan_depth: string | number;
  };
  probability: number;
  recursion: {
    prevent_incoming: boolean;
    prevent_outgoing: boolean;
    delay_until: number | null;
  };
  effect: {
    sticky: number | null;
    cooldown: number | null;
    delay: number | null;
  };
  extra: Record<string, any>;
}

/** Normalized entry used internally */
interface NormalizedEntry {
  uid: number;
  name: string;
  content: string;
  cleanContent: string;
  decorators: string[];
  enabled: boolean;
  worldbook: string;

  // Activation strategy
  constant: boolean;
  selective: boolean;
  keys: string[];
  keysSecondary: string[];
  selectiveLogic: number;
  useProbability: boolean;
  probability: number;

  // Keyword matching options
  caseSensitive: boolean;
  matchWholeWords: boolean;

  // Inclusion groups
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  useGroupScoring: boolean;

  // Position
  position: number;
  depth: number;
  order: number;
  role: string;
}

export interface ResolvedWorldInfo {
  before: Array<{ name: string; content: string }>;
  after: Array<{ name: string; content: string }>;
}

// ---------------------------------------------------------------------------
// ST Runtime Accessors
// ---------------------------------------------------------------------------

declare function getWorldbook(name: string): Promise<RawWbEntry[]>;
declare function getCharWorldbookNames(target: 'current'): { primary: string | null; additional: string[] };
declare function getGlobalWorldbookNames(): string[];

// ---------------------------------------------------------------------------
// Decorator Parsing
// ---------------------------------------------------------------------------

const KNOWN_DECORATORS = [
  '@@activate', '@@dont_activate', '@@message_formatting',
  '@@generate_before', '@@generate_after', '@@render_before', '@@render_after',
  '@@dont_preload', '@@initial_variables', '@@always_enabled',
  '@@only_preload', '@@iframe', '@@preprocessing', '@@if', '@@private',
];

function parseDecorators(content: string): { decorators: string[]; cleanContent: string } {
  const decorators: string[] = [];
  const lines = content.split('\n');
  const cleanLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = KNOWN_DECORATORS.find(d => trimmed.startsWith(d));
    if (match) {
      decorators.push(trimmed);
    } else {
      cleanLines.push(line);
    }
  }

  return {
    decorators,
    cleanContent: cleanLines.join('\n').trim(),
  };
}

// ---------------------------------------------------------------------------
// Entry Normalization
// ---------------------------------------------------------------------------

function normalizeEntry(raw: RawWbEntry, worldbookName: string): NormalizedEntry {
  const { decorators, cleanContent } = parseDecorators(raw.content);

  // Map position.type string to numeric position
  let position = WI_POSITION.atDepth;
  const posType = raw.position?.type ?? 'at_depth';
  if (posType === 'before_char' || posType === 'before') position = WI_POSITION.before;
  else if (posType === 'after_char' || posType === 'after') position = WI_POSITION.after;
  else if (posType === 'em_top') position = WI_POSITION.EMTop;
  else if (posType === 'em_bottom') position = WI_POSITION.EMBottom;
  else if (posType === 'an_top') position = WI_POSITION.ANTop;
  else if (posType === 'an_bottom') position = WI_POSITION.ANBottom;
  else if (posType === 'at_depth') position = WI_POSITION.atDepth;
  // numeric position from extensions (legacy support)
  else if (typeof (raw as any).extensions?.position === 'number') {
    position = (raw as any).extensions.position;
  }

  // Map strategy.type to boolean flags
  const isConstant = raw.strategy?.type === 'constant';
  const isSelective = raw.strategy?.type === 'selective';

  // selectiveLogic from keys_secondary
  let selectiveLogic = WI_LOGIC.AND_ANY;
  const logicStr = raw.strategy?.keys_secondary?.logic;
  if (logicStr === 'not_all') selectiveLogic = WI_LOGIC.NOT_ALL;
  else if (logicStr === 'not_any') selectiveLogic = WI_LOGIC.NOT_ANY;
  else if (logicStr === 'and_all') selectiveLogic = WI_LOGIC.AND_ALL;

  return {
    uid: raw.uid,
    name: raw.name,
    content: raw.content,
    cleanContent,
    decorators,
    enabled: raw.enabled,
    worldbook: worldbookName,

    constant: isConstant,
    selective: isSelective,
    keys: raw.strategy?.keys ?? [],
    keysSecondary: raw.strategy?.keys_secondary?.keys ?? [],
    selectiveLogic,
    useProbability: raw.probability !== undefined && raw.probability < 100,
    probability: raw.probability ?? 100,

    caseSensitive: (raw.extra as any)?.caseSensitive ?? false,
    matchWholeWords: (raw.extra as any)?.matchWholeWords ?? false,

    group: (raw.extra as any)?.group ?? '',
    groupOverride: (raw.extra as any)?.groupOverride ?? false,
    groupWeight: (raw.extra as any)?.groupWeight ?? 100,
    useGroupScoring: (raw.extra as any)?.useGroupScoring ?? false,

    position,
    depth: raw.position?.depth ?? 0,
    order: raw.position?.order ?? 100,
    role: raw.position?.role ?? 'system',
  };
}

// ---------------------------------------------------------------------------
// Keyword Matching
// ---------------------------------------------------------------------------

function parseRegexFromString(input: string): RegExp | null {
  const match = /^\/(.*?)\/([gimsuy]*)$/.exec(input);
  if (!match) return null;
  try {
    return new RegExp(match[1], match[2]);
  } catch {
    return null;
  }
}

function matchKeys(haystack: string, needle: string, entry: NormalizedEntry): boolean {
  // Regex keyword
  const keyRegex = parseRegexFromString(needle.trim());
  if (keyRegex) {
    return keyRegex.test(haystack);
  }

  const transformedHaystack = entry.caseSensitive ? haystack : haystack.toLowerCase();
  const transformedNeedle = entry.caseSensitive ? needle.trim() : needle.trim().toLowerCase();

  if (!transformedNeedle) return false;

  if (entry.matchWholeWords) {
    const keyWords = transformedNeedle.split(/\s+/);
    if (keyWords.length > 1) {
      return transformedHaystack.includes(transformedNeedle);
    }
    const regex = new RegExp(`(?:^|\\W)(${_.escapeRegExp(transformedNeedle)})(?:$|\\W)`);
    return regex.test(transformedHaystack);
  }

  return transformedHaystack.includes(transformedNeedle);
}

// ---------------------------------------------------------------------------
// Group Scoring
// ---------------------------------------------------------------------------

function getScore(trigger: string, entry: NormalizedEntry): number {
  let primaryScore = 0;
  let secondaryScore = 0;

  for (const key of entry.keys) {
    if (matchKeys(trigger, key, entry)) primaryScore++;
  }

  for (const key of entry.keysSecondary) {
    if (matchKeys(trigger, key, entry)) secondaryScore++;
  }

  if (entry.keys.length === 0) return 0;

  if (entry.keysSecondary.length > 0) {
    if (entry.selectiveLogic === WI_LOGIC.AND_ANY) return primaryScore + secondaryScore;
    if (entry.selectiveLogic === WI_LOGIC.AND_ALL) {
      return secondaryScore === entry.keysSecondary.length
        ? primaryScore + secondaryScore
        : primaryScore;
    }
  }

  return primaryScore;
}

// ---------------------------------------------------------------------------
// Entry Activation (replicates ST selectActivatedEntries)
// ---------------------------------------------------------------------------

function selectActivatedEntries(entries: NormalizedEntry[], trigger: string): NormalizedEntry[] {
  const activated = new Set<NormalizedEntry>();

  for (const entry of entries) {
    if (!entry.enabled) continue;

    // Probability check
    if (entry.useProbability && entry.probability < _.random(1, 100)) continue;

    // 🔵 Constant — always activated
    if (entry.constant) {
      activated.add(entry);
      continue;
    }

    // Decorator-based activation
    if (entry.decorators.some(d => d.startsWith('@@activate'))) {
      activated.add(entry);
      continue;
    }
    if (entry.decorators.some(d => d.startsWith('@@dont_activate'))) continue;
    if (entry.decorators.some(d => d.startsWith('@@only_preload'))) continue;

    // Special decorator entries (@@generate, @@render, @@initial_variables, @@preprocessing, @@iframe)
    const specialDecorators = ['@@generate', '@@render', '@@initial_variables', '@@preprocessing', '@@iframe'];
    if (entry.decorators.some(d => specialDecorators.some(sd => d.startsWith(sd)))) continue;

    // Primary keyword matching
    if (entry.keys.length === 0) continue;
    const matchedKey = entry.keys.find(k => matchKeys(trigger, k, entry));
    if (!matchedKey) continue;

    // Secondary keyword (blue lamp) logic
    const hasSecondaryKeys = entry.selective && entry.keysSecondary.length > 0;
    if (!hasSecondaryKeys) {
      activated.add(entry);
      continue;
    }

    let hasAnyMatch = false;
    let hasAllMatch = true;

    for (const secondary of entry.keysSecondary) {
      const hasMatch = secondary.trim() !== '' && matchKeys(trigger, secondary.trim(), entry);
      if (hasMatch) hasAnyMatch = true;
      if (!hasMatch) hasAllMatch = false;

      // AND_ANY: primary + any one secondary
      if (entry.selectiveLogic === WI_LOGIC.AND_ANY && hasMatch) {
        activated.add(entry);
        break;
      }

      // NOT_ALL: primary + NOT all secondary present
      if (entry.selectiveLogic === WI_LOGIC.NOT_ALL && !hasMatch) {
        activated.add(entry);
        break;
      }
    }

    // NOT_ANY: primary + none of secondary
    if (entry.selectiveLogic === WI_LOGIC.NOT_ANY && !hasAnyMatch) {
      activated.add(entry);
      continue;
    }

    // AND_ALL: primary + all secondary
    if (entry.selectiveLogic === WI_LOGIC.AND_ALL && hasAllMatch) {
      activated.add(entry);
      continue;
    }
  }

  if (activated.size === 0) return [];

  // ── Inclusion Group handling ──

  const grouped = _.groupBy(Array.from(activated), e => e.group);
  const ungrouped = grouped[''] ?? [];

  if (ungrouped.length > 0 && Object.keys(grouped).length <= 1) {
    return ungrouped.sort(sortEntries);
  }

  const matched: NormalizedEntry[] = [];
  for (const [group, members] of Object.entries(grouped)) {
    if (group === '') continue;

    if (members.length === 1) {
      matched.push(members[0]);
      continue;
    }

    // Group prioritization
    const usePrioritize = members.filter(e => e.groupOverride);
    if (usePrioritize.length > 0) {
      const orders = members.map(e => e.order);
      const top = Math.min(...orders);
      matched.push(members[Math.max(orders.findIndex(o => o <= top), 0)]);
      continue;
    }

    // Group scoring
    const useScoring = members.filter(e => e.useGroupScoring);
    if (useScoring.length > 0) {
      const scores = members.map(e => getScore(trigger, e));
      const top = Math.max(...scores);
      if (top > 0) {
        matched.push(members[Math.max(scores.findIndex(s => s >= top), 0)]);
        continue;
      }
    }

    // Weighted random
    const weights = members.map(e => e.groupWeight);
    const totalWeight = _.sum(weights);
    let rollValue = _.random(1, totalWeight);
    const winner = weights.findIndex(w => (rollValue -= w) <= 0);
    if (winner >= 0) matched.push(members[winner]);
  }

  return ungrouped.concat(matched).sort(sortEntries);
}

function sortEntries(a: NormalizedEntry, b: NormalizedEntry): number {
  // Sort by order (asc), then uid (desc)
  return a.order - b.order || b.uid - a.uid;
}

// ---------------------------------------------------------------------------
// Worldbook Collection
// ---------------------------------------------------------------------------

async function collectAllWorldbookEntries(): Promise<NormalizedEntry[]> {
  const allEntries: NormalizedEntry[] = [];

  // 1. Character primary worldbook
  try {
    const charWb = getCharWorldbookNames('current');
    if (charWb.primary) {
      const entries = await getWorldbook(charWb.primary);
      for (const entry of entries) {
        allEntries.push(normalizeEntry(entry, charWb.primary));
      }
    }

    // Character additional worldbooks
    for (const additionalWb of charWb.additional ?? []) {
      try {
        const entries = await getWorldbook(additionalWb);
        for (const entry of entries) {
          allEntries.push(normalizeEntry(entry, additionalWb));
        }
      } catch (e) {
        console.debug(`[EW WI Engine] Cannot read additional worldbook '${additionalWb}':`, e);
      }
    }
  } catch (e) {
    console.debug('[EW WI Engine] Cannot read character worldbooks:', e);
  }

  // 2. Global worldbooks
  try {
    const globalNames = getGlobalWorldbookNames();
    for (const wbName of globalNames) {
      try {
        const entries = await getWorldbook(wbName);
        for (const entry of entries) {
          allEntries.push(normalizeEntry(entry, wbName));
        }
      } catch (e) {
        console.debug(`[EW WI Engine] Cannot read global worldbook '${wbName}':`, e);
      }
    }
  } catch (e) {
    console.debug('[EW WI Engine] Cannot read global worldbooks:', e);
  }

  return allEntries;
}

// ---------------------------------------------------------------------------
// Position Classification
// ---------------------------------------------------------------------------

function classifyPosition(entry: NormalizedEntry): 'before' | 'after' {
  switch (entry.position) {
    case WI_POSITION.before:
    case WI_POSITION.EMTop:
    case WI_POSITION.ANTop:
      return 'before';
    case WI_POSITION.after:
    case WI_POSITION.EMBottom:
    case WI_POSITION.ANBottom:
    case WI_POSITION.atDepth:
    default:
      return 'after';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve all active worldbook entries for the current context.
 *
 * 1. Collects entries from all relevant worldbooks
 * 2. Runs ST-compatible activation logic (keywords, constants, decorators, groups)
 * 3. Executes EJS rendering on activated entries
 * 4. Returns structured before/after lists with entry names
 */
export async function resolveWorldInfo(
  _settings: EwSettings,
  chatMessages: string[],
): Promise<ResolvedWorldInfo> {
  const result: ResolvedWorldInfo = { before: [], after: [] };

  try {
    // 1. Collect all entries
    const allEntries = await collectAllWorldbookEntries();
    if (allEntries.length === 0) return result;

    // 2. Build activation trigger from chat messages
    const trigger = chatMessages.join('\n\n');

    // 3. Run activation logic
    const activated = selectActivatedEntries(allEntries, trigger);
    if (activated.length === 0) return result;

    // 4. Build render context (for EJS getwi calls)
    const allForGetwi = allEntries.map(e => ({
      name: e.name,
      content: e.cleanContent || e.content,
      worldbook: e.worldbook,
    }));
    const renderCtx = createRenderContext(allForGetwi);

    // 5. Render each activated entry and classify by position
    for (const entry of activated) {
      const contentToRender = entry.cleanContent || entry.content;
      let rendered: string;

      try {
        rendered = await evalEjsTemplate(contentToRender, renderCtx);
      } catch (e) {
        console.warn(`[EW WI Engine] EJS render failed for entry '${entry.name}':`, e);
        rendered = contentToRender;
      }

      // Skip empty entries after rendering
      if (!rendered.trim()) continue;

      const bucket = classifyPosition(entry);
      result[bucket].push({ name: entry.name, content: rendered });
    }
  } catch (e) {
    console.error('[EW WI Engine] resolveWorldInfo failed:', e);
  }

  return result;
}
