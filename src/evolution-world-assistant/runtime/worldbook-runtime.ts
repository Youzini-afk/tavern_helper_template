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
