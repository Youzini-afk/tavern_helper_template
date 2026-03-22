/**
 * 世界书多Role脚本
 *
 * 将被合并为单 role 的世界书条目拆分为多条独立 role 的消息。
 *
 * 工作流程:
 * 1. 监听 WORLD_INFO_ACTIVATED 事件, 缓存所有激活条目的原始元数据
 * 2. 监听 CHAT_COMPLETION_PROMPT_READY 事件, 在最终消息数组中找到包含 WI 内容的消息
 * 3. 将合并的 WI 消息拆分为多条不同 role 的消息
 */

const LOG_PREFIX = '[MultiRoleWI]';

// ============================================================================
// Types
// ============================================================================

/** WI position enum matching SillyTavern's world_info_position */
const WI_POSITION = {
  before: 0,
  after: 1,
  ANTop: 2,
  ANBottom: 3,
  atDepth: 4,
  EMTop: 5,
  EMBottom: 6,
} as const;

/** Role number to string mapping (matching SillyTavern's extension_prompt_roles) */
const ROLE_MAP: Record<number, 'system' | 'user' | 'assistant'> = {
  0: 'system',
  1: 'user',
  2: 'assistant',
};

/** Role string to number mapping */
const ROLE_NUM: Record<string, number> = {
  system: 0,
  user: 1,
  assistant: 2,
};

/** Cached entry info for matching and splitting */
interface CachedEntry {
  content: string;
  role: 'system' | 'user' | 'assistant';
  position: number;
  comment: string;
  depth: number;
  order: number;
  world: string;
}

// ============================================================================
// State
// ============================================================================

/** Cached activated entries from WORLD_INFO_ACTIVATED */
let activatedEntries: CachedEntry[] = [];

// ============================================================================
// Role parsing from entry comment (name)
// ============================================================================

/** Role prefix regex pattern: matches [user], [assistant], [system] at start of comment */
const ROLE_PREFIX_RE = /^\[(user|assistant|system)\]/i;

/**
 * Parse role from entry comment prefix or fall back to entry's native role.
 *
 * Priority:
 * 1. Comment prefix like `[user]条目名` → 'user'
 * 2. For atDepth entries: use the entry's native `role` field
 * 3. Default: 'system'
 */
function resolveRole(entry: { world: string } & SillyTavern.FlattenedWorldInfoEntry): 'system' | 'user' | 'assistant' {
  // Check comment prefix first
  const comment = entry.comment ?? '';
  const match = comment.match(ROLE_PREFIX_RE);
  if (match) {
    return match[1].toLowerCase() as 'system' | 'user' | 'assistant';
  }

  // For atDepth entries, use native role
  if (entry.position === WI_POSITION.atDepth && entry.role != null) {
    return ROLE_MAP[entry.role] ?? 'system';
  }

  // Default
  return 'system';
}

// ============================================================================
// Phase 1: Cache activated entries
// ============================================================================

function onWorldInfoActivated(entries: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[]) {
  activatedEntries = entries
    .filter(e => !e.disable && e.content && e.content.trim().length > 0)
    .map(e => ({
      content: e.content,
      role: resolveRole(e),
      position: e.position,
      comment: e.comment ?? '',
      depth: e.depth ?? 4,
      order: e.order ?? 100,
      world: e.world,
    }));

  console.log(`${LOG_PREFIX} Cached ${activatedEntries.length} activated entries`);
  if (activatedEntries.length > 0) {
    const roleCounts = { system: 0, user: 0, assistant: 0 };
    for (const e of activatedEntries) {
      roleCounts[e.role]++;
    }
    console.log(`${LOG_PREFIX} Role distribution:`, roleCounts);
  }
}

// ============================================================================
// Phase 2: Split merged WI messages
// ============================================================================

/**
 * Given a merged message content string and a list of entries that were merged into it,
 * split the content back into individual entries and return them as separate messages.
 *
 * Strategy: try to match each entry's content within the merged string.
 * Entries are matched in the order they appear in the merged string.
 */
function splitMergedMessage(
  mergedContent: string,
  entries: CachedEntry[],
  originalRole: 'system' | 'user' | 'assistant',
): SillyTavern.SendingMessage[] {
  if (entries.length === 0) {
    return [{ role: originalRole, content: mergedContent }];
  }

  // Find which entries are present in the merged content and their positions
  const found: { entry: CachedEntry; startIndex: number; endIndex: number }[] = [];
  for (const entry of entries) {
    const idx = mergedContent.indexOf(entry.content);
    if (idx !== -1) {
      found.push({ entry, startIndex: idx, endIndex: idx + entry.content.length });
    }
  }

  if (found.length === 0) {
    // No entries matched, return original message unchanged
    console.log(`${LOG_PREFIX} No entries matched in merged content, keeping original`);
    return [{ role: originalRole, content: mergedContent }];
  }

  // Sort by position in the merged string
  found.sort((a, b) => a.startIndex - b.startIndex);

  const result: SillyTavern.SendingMessage[] = [];
  let lastEnd = 0;

  for (const { entry, startIndex, endIndex } of found) {
    // If there's text between last match and current match, keep it as original role
    if (startIndex > lastEnd) {
      const gap = mergedContent.slice(lastEnd, startIndex).trim();
      if (gap.length > 0) {
        result.push({ role: originalRole, content: gap });
      }
    }

    // Add the entry with its own role
    result.push({ role: entry.role, content: entry.content });
    lastEnd = endIndex;
  }

  // If there's remaining text after the last match
  if (lastEnd < mergedContent.length) {
    const remaining = mergedContent.slice(lastEnd).trim();
    if (remaining.length > 0) {
      result.push({ role: originalRole, content: remaining });
    }
  }

  return result;
}

/**
 * Get entries matching a specific WI position type
 */
function getEntriesByPosition(...positions: number[]): CachedEntry[] {
  return activatedEntries.filter(e => positions.includes(e.position));
}

/**
 * Check if any cached entries have a non-system role
 * (if all are system, no splitting is needed)
 */
function hasNonSystemEntries(): boolean {
  return activatedEntries.some(e => e.role !== 'system');
}

function onChatCompletionPromptReady(eventData: { chat: SillyTavern.SendingMessage[]; dryRun: boolean }) {
  if (eventData.dryRun) return;
  if (activatedEntries.length === 0) return;
  if (!hasNonSystemEntries()) {
    console.log(`${LOG_PREFIX} All entries are system role, no splitting needed`);
    return;
  }

  const chat = eventData.chat;
  console.log(`${LOG_PREFIX} Processing ${chat.length} messages in chat array`);

  // Entries for before/after positions (these get merged into worldInfoBefore/worldInfoAfter)
  const beforeEntries = getEntriesByPosition(WI_POSITION.before);
  const afterEntries = getEntriesByPosition(WI_POSITION.after);

  // Entries for AN positions
  const anTopEntries = getEntriesByPosition(WI_POSITION.ANTop);
  const anBottomEntries = getEntriesByPosition(WI_POSITION.ANBottom);

  // Entries for EM positions
  const emTopEntries = getEntriesByPosition(WI_POSITION.EMTop);
  const emBottomEntries = getEntriesByPosition(WI_POSITION.EMBottom);

  // atDepth entries are handled differently — they're already injected at specific depths
  // but still merged by same depth+role. We handle those too.
  const depthEntries = getEntriesByPosition(WI_POSITION.atDepth);

  // Process the chat array — find and split WI messages
  const newChat: SillyTavern.SendingMessage[] = [];
  let splitCount = 0;

  for (const msg of chat) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (!content) {
      newChat.push(msg);
      continue;
    }

    // Try to match this message against known entry groups
    let matched = false;

    // Check against each position group
    const groups = [
      { entries: beforeEntries, label: 'worldInfoBefore' },
      { entries: afterEntries, label: 'worldInfoAfter' },
      { entries: anTopEntries, label: 'ANTop' },
      { entries: anBottomEntries, label: 'ANBottom' },
      { entries: emTopEntries, label: 'EMTop' },
      { entries: emBottomEntries, label: 'EMBottom' },
      { entries: depthEntries, label: 'atDepth' },
    ];

    for (const group of groups) {
      if (group.entries.length === 0) continue;

      // Check if this message contains ALL entries from this group
      // (or at least a significant number of them)
      const matchedEntries = group.entries.filter(e => content.includes(e.content));

      if (matchedEntries.length > 0 && matchedEntries.some(e => e.role !== msg.role)) {
        // This message contains WI entries that need role changes
        const split = splitMergedMessage(content, matchedEntries, msg.role);
        if (split.length > 1 || (split.length === 1 && split[0].role !== msg.role)) {
          newChat.push(...split);
          splitCount += split.length - 1;
          matched = true;
          console.log(
            `${LOG_PREFIX} Split ${group.label} message into ${split.length} messages:`,
            split.map(s => `[${s.role}] ${(typeof s.content === 'string' ? s.content : '').slice(0, 50)}...`),
          );
          break;
        }
      }
    }

    if (!matched) {
      newChat.push(msg);
    }
  }

  if (splitCount > 0) {
    // Replace the chat array contents in-place
    chat.length = 0;
    chat.push(...newChat);
    console.log(`${LOG_PREFIX} ✅ Split complete: ${splitCount} additional messages created (total: ${chat.length})`);
  } else {
    console.log(`${LOG_PREFIX} No messages needed splitting`);
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

$(() => {
  console.log(`${LOG_PREFIX} 🚀 Multi-Role World Info script loaded`);

  // Phase 1: cache activated WI entries
  eventOn(tavern_events.WORLD_INFO_ACTIVATED, onWorldInfoActivated);

  // Phase 2: split merged messages (run last to not interfere with other listeners)
  eventMakeLast(tavern_events.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);

  toastr.success('世界书多Role脚本已加载', 'Multi-Role WI');
});

$(window).on('pagehide', () => {
  activatedEntries = [];
  console.log(`${LOG_PREFIX} 🛑 Multi-Role World Info script unloaded`);
});
