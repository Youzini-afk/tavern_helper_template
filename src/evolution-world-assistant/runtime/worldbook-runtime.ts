import { EwSettings } from './types';

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

/**
 * Resolve the target worldbook for reading EW entries.
 *
 * Options:
 *  - autoCreate (default false): when true, auto-create an EW worldbook
 *    if no primary worldbook exists.
 *
 * Strategy:
 *  1. Read the current character's primary worldbook — if it exists and loads, use it directly.
 *  2. If autoCreate is false and no primary loads, return null (no side effects).
 *  3. If autoCreate is true:
 *     a. If NO primary worldbook is set at all, auto-create EW_charName and set as primary.
 *     b. If primary is set but fails to load, create EW_charName in `additional` (preserve primary).
 */
export async function resolveTargetWorldbook(
  _settings: EwSettings,
  options?: { autoCreate?: boolean },
): Promise<TargetWorldbook | null> {
  const autoCreate = options?.autoCreate ?? false;
  const charWb = getCharWorldbookNames('current');

  // ── Case 1: Primary worldbook exists and loads → use it directly ──
  if (charWb.primary) {
    try {
      const entries = await getWorldbook(charWb.primary);
      return { worldbook_name: charWb.primary, entries, created: false };
    } catch {
      // Primary worldbook name is set but fails to load.
      if (!autoCreate) {
        console.debug(
          `[Evolution World] Primary worldbook "${charWb.primary}" failed to load, skipping (autoCreate=false)`,
        );
        return null;
      }
      console.warn(
        `[Evolution World] Primary worldbook "${charWb.primary}" failed to load, using EW auxiliary book`,
      );
    }
  } else if (!autoCreate) {
    // No primary worldbook and autoCreate is false → return null
    return null;
  }

  // ── Case 2 & 3: autoCreate=true, need an EW worldbook ──
  const charName = getCurrentCharacterName() ?? 'unknown';
  const autoName = `EW_${charName}`;

  let exists = false;
  try {
    await getWorldbook(autoName);
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    await createWorldbook(autoName, []);
  }

  // Only set as primary if the character has NO worldbook at all.
  // If primary already exists (but failed to load), add EW book to additional.
  if (!charWb.primary) {
    // No primary → safe to set EW book as primary
    await rebindCharWorldbooks('current', {
      primary: autoName,
      additional: charWb.additional ?? [],
    });
  } else {
    // Primary already exists (failed to load case) → add EW book to additional
    const additionals = charWb.additional ?? [];
    if (!additionals.includes(autoName)) {
      await rebindCharWorldbooks('current', {
        primary: charWb.primary, // preserve the original primary!
        additional: [...additionals, autoName],
      });
    }
  }

  const entries = await getWorldbook(autoName);
  return { worldbook_name: autoName, entries, created: true };
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
    // 以空描述继续。
  }

  // 如有预加载目标则复用，否则从头读取。
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
        // 无法读取 —— 以空内容继续。
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
