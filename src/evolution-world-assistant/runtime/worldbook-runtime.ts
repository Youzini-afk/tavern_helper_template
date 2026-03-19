import { DynSnapshot, DynWorldbookProfile, DynWorldbookProfileSchema, DynWriteConfig, EwSettings } from './types';

export type TargetWorldbook = {
  worldbook_name: string;
  entries: WorldbookEntry[];
  created: boolean;
};

export type FullWorldbookContext = {
  character_name: string;
  character_description: string;
  char_worldbook: {
    worldbook_name: string;
    entries: Array<{ name: string; enabled: boolean; content: string }>;
  };
};

function toEntrySnapshot(entries: WorldbookEntry[]): Array<{ name: string; enabled: boolean; content: string }> {
  return entries.map(entry => ({
    name: entry.name,
    enabled: entry.enabled,
    content: entry.content,
  }));
}

function normalizePositionRole(raw: unknown): DynWorldbookProfile['position']['role'] {
  return raw === 'user' || raw === 'assistant' ? raw : 'system';
}

function normalizeSecondaryLogic(raw: unknown): DynWorldbookProfile['strategy']['keys_secondary']['logic'] {
  return raw === 'and_all' || raw === 'not_any' || raw === 'not_all' ? raw : 'and_any';
}

function normalizeScanDepth(raw: unknown): DynWorldbookProfile['strategy']['scan_depth'] {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.trunc(raw));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return 'same_as_global';
}

function normalizeNullableInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

export function getDefaultDynWorldbookProfile(): DynWorldbookProfile {
  return DynWorldbookProfileSchema.parse({});
}

export function extractDynWorldbookProfile(raw: any): DynWorldbookProfile {
  return DynWorldbookProfileSchema.parse({
    comment: typeof raw?.comment === 'string' ? raw.comment : '',
    position: raw?.position
      ? {
          type: typeof raw.position.type === 'string' && raw.position.type.trim()
            ? raw.position.type.trim()
            : 'before_character_definition',
          role: normalizePositionRole(raw.position.role),
          depth: Math.max(0, Math.trunc(Number(raw.position.depth ?? 0) || 0)),
          order: Math.trunc(Number(raw.position.order ?? 100) || 100),
        }
      : undefined,
    strategy: raw?.strategy
      ? {
          type: typeof raw.strategy.type === 'string' && raw.strategy.type.trim() ? raw.strategy.type.trim() : 'constant',
          keys: Array.isArray(raw.strategy.keys)
            ? raw.strategy.keys.map((value: unknown) => String(value ?? '').trim()).filter(Boolean)
            : [],
          keys_secondary: {
            logic: normalizeSecondaryLogic(raw.strategy.keys_secondary?.logic),
            keys: Array.isArray(raw.strategy.keys_secondary?.keys)
              ? raw.strategy.keys_secondary.keys.map((value: unknown) => String(value ?? '').trim()).filter(Boolean)
              : [],
          },
          scan_depth: normalizeScanDepth(raw.strategy.scan_depth),
        }
      : undefined,
    probability: Number.isFinite(Number(raw?.probability)) ? Number(raw.probability) : undefined,
    effect: raw?.effect
      ? {
          sticky: normalizeNullableInt(raw.effect.sticky),
          cooldown: normalizeNullableInt(raw.effect.cooldown),
          delay: normalizeNullableInt(raw.effect.delay),
        }
      : undefined,
    extra: raw?.extra
      ? {
          caseSensitive: Boolean(raw.extra.caseSensitive),
          matchWholeWords: Boolean(raw.extra.matchWholeWords),
          group: typeof raw.extra.group === 'string' ? raw.extra.group : '',
          groupOverride: Boolean(raw.extra.groupOverride),
          groupWeight: Number.isFinite(Number(raw.extra.groupWeight)) ? Number(raw.extra.groupWeight) : 100,
          useGroupScoring: Boolean(raw.extra.useGroupScoring),
        }
      : undefined,
  });
}

export function normalizeDynSnapshotData(raw: any): DynSnapshot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const name = String(raw.name ?? '').trim();
  if (!name) {
    return null;
  }

  const profile = extractDynWorldbookProfile(raw);
  return {
    name,
    content: String(raw.content ?? ''),
    enabled: Boolean(raw.enabled),
    ...profile,
  };
}

export function buildDynSnapshotFromEntry(entry: any): DynSnapshot {
  const normalized = normalizeDynSnapshotData({
    name: entry?.name,
    content: entry?.content,
    enabled: entry?.enabled,
    comment: entry?.comment,
    position: entry?.position,
    strategy: entry?.strategy,
    probability: entry?.probability,
    effect: entry?.effect,
    extra: entry?.extra,
  });

  if (!normalized) {
    return {
      name: String(entry?.name ?? '').trim(),
      content: String(entry?.content ?? ''),
      enabled: Boolean(entry?.enabled),
      ...getDefaultDynWorldbookProfile(),
    };
  }

  return normalized;
}

export function applyDynSnapshotToEntry(entry: any, snapshot: DynSnapshot): void {
  const normalized = normalizeDynSnapshotData(snapshot);
  if (!normalized) {
    return;
  }

  entry.name = normalized.name;
  entry.content = normalized.content;
  entry.enabled = normalized.enabled;
  entry.comment = normalized.comment;
  entry.position = {
    type: normalized.position.type,
    role: normalized.position.role,
    depth: normalized.position.depth,
    order: normalized.position.order,
  };
  entry.strategy = {
    type: normalized.strategy.type,
    keys: [...normalized.strategy.keys],
    keys_secondary: {
      logic: normalized.strategy.keys_secondary.logic,
      keys: [...normalized.strategy.keys_secondary.keys],
    },
    scan_depth: normalized.strategy.scan_depth,
  };
  entry.probability = normalized.probability;
  entry.effect = {
    sticky: normalized.effect.sticky,
    cooldown: normalized.effect.cooldown,
    delay: normalized.effect.delay,
  };
  entry.extra = {
    caseSensitive: normalized.extra.caseSensitive,
    matchWholeWords: normalized.extra.matchWholeWords,
    group: normalized.extra.group,
    groupOverride: normalized.extra.groupOverride,
    groupWeight: normalized.extra.groupWeight,
    useGroupScoring: normalized.extra.useGroupScoring,
  };
}

export function applyDynWriteConfigToEntry(entry: any, name: string, content: string, dynWrite: DynWriteConfig): void {
  applyDynSnapshotToEntry(entry, {
    name,
    content,
    enabled: dynWrite.activation_mode === 'worldbook_direct',
    ...dynWrite.profile,
  });
}

export function createDynEntryFromWriteConfig(
  name: string,
  content: string,
  entries: WorldbookEntry[],
  dynWrite: DynWriteConfig,
): WorldbookEntry {
  const entry = ensureDefaultEntry(name, content, dynWrite.activation_mode === 'worldbook_direct', entries);
  applyDynWriteConfigToEntry(entry, name, content, dynWrite);
  return entry;
}

export function createDynEntryFromSnapshot(snapshot: DynSnapshot, entries: WorldbookEntry[]): WorldbookEntry {
  const normalized = normalizeDynSnapshotData(snapshot);
  if (!normalized) {
    return ensureDefaultEntry(String(snapshot?.name ?? ''), String(snapshot?.content ?? ''), Boolean(snapshot?.enabled), entries);
  }

  const entry = ensureDefaultEntry(normalized.name, normalized.content, normalized.enabled, entries);
  applyDynSnapshotToEntry(entry, normalized);
  return entry;
}

/**
 * Resolve the target worldbook for reading EW entries.
 *
 * Strategy:
 *  1. Read bound worldbooks in order: character primary, character additional.
 *  2. Return the first worldbook that loads successfully.
 *  3. If no bound worldbook loads, return null.
 */
export async function resolveTargetWorldbook(_settings: EwSettings): Promise<TargetWorldbook | null> {
  const charWb = getCharWorldbookNames('current');

  const candidateNames = _.uniq([...(charWb.primary ? [charWb.primary] : []), ...(charWb.additional ?? [])]);

  for (const wbName of candidateNames) {
    try {
      const entries = await getWorldbook(wbName);
      return { worldbook_name: wbName, entries, created: false };
    } catch (error) {
      console.debug(`[Evolution World] Bound worldbook "${wbName}" failed to load:`, error);
    }
  }

  return null;
}

/**
 * Collect full worldbook context for enriching the ew-flow/v1 request body.
 *
 * Reads:
 *  - Current character card info (name, description)
 *  - Character's primary worldbook entries
 */
export async function getFullWorldbookContext(preloadedTarget?: TargetWorldbook): Promise<FullWorldbookContext> {
  const charName = getCurrentCharacterName() ?? '';
  let charDescription = '';

  try {
    const character = await getCharacter('current');
    charDescription = character.description ?? '';
  } catch (e) {
    console.debug('[Evolution World] character data unavailable:', e);
  }

  let charEntries: Array<{ name: string; enabled: boolean; content: string }> = [];
  let charWbName = '';

  if (preloadedTarget) {
    charWbName = preloadedTarget.worldbook_name;
    charEntries = toEntrySnapshot(preloadedTarget.entries);
  } else {
    const charWb = getCharWorldbookNames('current');
    charWbName = charWb.primary ?? '';
    if (charWb.primary) {
      try {
        charEntries = toEntrySnapshot(await getWorldbook(charWb.primary));
      } catch (e) {
        console.debug(`[Evolution World] cannot read char worldbook '${charWb.primary}':`, e);
      }
    }
  }

  return {
    character_name: charName,
    character_description: charDescription,
    char_worldbook: {
      worldbook_name: charWbName,
      entries: charEntries,
    },
  };
}

function nextUid(entries: WorldbookEntry[]): number {
  const maxUid = _.max(entries.map(entry => entry.uid));
  return (maxUid ?? 0) + 1;
}

export function ensureDefaultEntry(
  name: string,
  content: string,
  enabled: boolean,
  entries: WorldbookEntry[],
  _constant = false,
): WorldbookEntry {
  return {
    uid: nextUid(entries),
    name,
    enabled,
    strategy: {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: {
      type: 'before_character_definition',
      role: 'system',
      depth: 0,
      order: 100,
    },
    content,
    probability: 100,
    recursion: {
      prevent_incoming: true,
      prevent_outgoing: true,
      delay_until: null,
    },
    effect: {
      sticky: null,
      cooldown: null,
      delay: null,
    },
    extra: {},
  };
}
