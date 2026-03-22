/**
 * 世界书多Role脚本
 *
 * 将被合并为单 role 的世界书条目拆分为多条独立 role 的消息。
 *
 * 工作流程:
 * 1. 监听 WORLD_INFO_ACTIVATED 事件，缓存所有激活条目的原始元数据
 * 2. 监听 CHAT_COMPLETION_PROMPT_READY 事件，在最终消息数组中找到包含世界书内容的消息
 * 3. 将合并的世界书消息拆分为多条不同 role 的消息
 */

const LOG_PREFIX = '[多Role世界书]';

// ============================================================================
// 类型定义
// ============================================================================

/** 世界书位置枚举，对应 SillyTavern 的 world_info_position */
const WI_POSITION = {
  before: 0,   // 角色定义之前
  after: 1,    // 角色定义之后
  ANTop: 2,    // 作者注释之上
  ANBottom: 3, // 作者注释之下
  atDepth: 4,  // 按深度插入
  EMTop: 5,    // 示例消息之上
  EMBottom: 6, // 示例消息之下
} as const;

/** Role 数字到字符串的映射（对应 SillyTavern 的 extension_prompt_roles） */
const ROLE_MAP: Record<number, 'system' | 'user' | 'assistant'> = {
  0: 'system',
  1: 'user',
  2: 'assistant',
};

/** 缓存的条目信息，用于匹配和拆分 */
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
// 状态
// ============================================================================

/** 从 WORLD_INFO_ACTIVATED 事件中缓存的激活条目 */
let activatedEntries: CachedEntry[] = [];

// ============================================================================
// 从条目名称（comment）中解析 Role
// ============================================================================

/** Role 前缀正则：匹配条目名开头的 [user]、[assistant]、[system] */
const ROLE_PREFIX_RE = /^\[(user|assistant|system)\]/i;

/**
 * 解析条目的 role。
 *
 * 优先级：
 * 1. 条目名前缀，如 `[user]条目名` → 'user'
 * 2. atDepth 类型条目：使用条目自带的 `role` 字段
 * 3. 默认：'system'
 */
function resolveRole(entry: { world: string } & SillyTavern.FlattenedWorldInfoEntry): 'system' | 'user' | 'assistant' {
  // 优先检查条目名前缀
  const comment = entry.comment ?? '';
  const match = comment.match(ROLE_PREFIX_RE);
  if (match) {
    return match[1].toLowerCase() as 'system' | 'user' | 'assistant';
  }

  // atDepth 条目使用自带的 role
  if (entry.position === WI_POSITION.atDepth && entry.role != null) {
    return ROLE_MAP[entry.role] ?? 'system';
  }

  // 默认
  return 'system';
}

// ============================================================================
// 第一阶段：缓存激活的条目
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

  console.log(`${LOG_PREFIX} 已缓存 ${activatedEntries.length} 个激活条目`);
  if (activatedEntries.length > 0) {
    const roleCounts = { system: 0, user: 0, assistant: 0 };
    for (const e of activatedEntries) {
      roleCounts[e.role]++;
    }
    console.log(`${LOG_PREFIX} Role 分布:`, roleCounts);
  }
}

// ============================================================================
// 第二阶段：拆分合并的世界书消息
// ============================================================================

/**
 * 将合并后的消息内容按条目边界拆分为多条独立消息。
 *
 * 策略：在合并字符串中精确匹配每个条目的原始内容，按出现顺序拆分。
 */
function splitMergedMessage(
  mergedContent: string,
  entries: CachedEntry[],
  originalRole: 'system' | 'user' | 'assistant',
): SillyTavern.SendingMessage[] {
  if (entries.length === 0) {
    return [{ role: originalRole, content: mergedContent }];
  }

  // 查找每个条目在合并字符串中的位置
  const found: { entry: CachedEntry; startIndex: number; endIndex: number }[] = [];
  for (const entry of entries) {
    const idx = mergedContent.indexOf(entry.content);
    if (idx !== -1) {
      found.push({ entry, startIndex: idx, endIndex: idx + entry.content.length });
    }
  }

  if (found.length === 0) {
    // 没有匹配到任何条目，保持原样
    console.log(`${LOG_PREFIX} 合并内容中未匹配到任何条目，保持原样`);
    return [{ role: originalRole, content: mergedContent }];
  }

  // 按在合并字符串中的位置排序
  found.sort((a, b) => a.startIndex - b.startIndex);

  const result: SillyTavern.SendingMessage[] = [];
  let lastEnd = 0;

  for (const { entry, startIndex, endIndex } of found) {
    // 如果上一个匹配和当前匹配之间有间隔文本，保留为原始 role
    if (startIndex > lastEnd) {
      const gap = mergedContent.slice(lastEnd, startIndex).trim();
      if (gap.length > 0) {
        result.push({ role: originalRole, content: gap });
      }
    }

    // 添加该条目，使用其自身的 role
    result.push({ role: entry.role, content: entry.content });
    lastEnd = endIndex;
  }

  // 如果最后一个匹配之后还有剩余文本
  if (lastEnd < mergedContent.length) {
    const remaining = mergedContent.slice(lastEnd).trim();
    if (remaining.length > 0) {
      result.push({ role: originalRole, content: remaining });
    }
  }

  return result;
}

/**
 * 获取指定位置类型的条目
 */
function getEntriesByPosition(...positions: number[]): CachedEntry[] {
  return activatedEntries.filter(e => positions.includes(e.position));
}

/**
 * 检查是否有非 system role 的条目（如果全是 system 则无需拆分）
 */
function hasNonSystemEntries(): boolean {
  return activatedEntries.some(e => e.role !== 'system');
}

function onChatCompletionPromptReady(eventData: { chat: SillyTavern.SendingMessage[]; dryRun: boolean }) {
  if (eventData.dryRun) return;
  if (activatedEntries.length === 0) return;
  if (!hasNonSystemEntries()) {
    console.log(`${LOG_PREFIX} 所有条目均为 system role，无需拆分`);
    return;
  }

  const chat = eventData.chat;
  console.log(`${LOG_PREFIX} 正在处理 ${chat.length} 条消息`);

  // 按位置类型分组条目
  const beforeEntries = getEntriesByPosition(WI_POSITION.before);
  const afterEntries = getEntriesByPosition(WI_POSITION.after);
  const anTopEntries = getEntriesByPosition(WI_POSITION.ANTop);
  const anBottomEntries = getEntriesByPosition(WI_POSITION.ANBottom);
  const emTopEntries = getEntriesByPosition(WI_POSITION.EMTop);
  const emBottomEntries = getEntriesByPosition(WI_POSITION.EMBottom);
  const depthEntries = getEntriesByPosition(WI_POSITION.atDepth);

  // 遍历消息数组，查找并拆分包含世界书内容的消息
  const newChat: SillyTavern.SendingMessage[] = [];
  let splitCount = 0;

  for (const msg of chat) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (!content) {
      newChat.push(msg);
      continue;
    }

    // 尝试将该消息与各位置组的条目进行匹配
    let matched = false;

    const groups = [
      { entries: beforeEntries, label: '角色定义前(worldInfoBefore)' },
      { entries: afterEntries, label: '角色定义后(worldInfoAfter)' },
      { entries: anTopEntries, label: '作者注释上(ANTop)' },
      { entries: anBottomEntries, label: '作者注释下(ANBottom)' },
      { entries: emTopEntries, label: '示例消息上(EMTop)' },
      { entries: emBottomEntries, label: '示例消息下(EMBottom)' },
      { entries: depthEntries, label: '按深度插入(atDepth)' },
    ];

    for (const group of groups) {
      if (group.entries.length === 0) continue;

      // 检查该消息是否包含了该组中的条目内容
      const matchedEntries = group.entries.filter(e => content.includes(e.content));

      if (matchedEntries.length > 0 && matchedEntries.some(e => e.role !== msg.role)) {
        // 该消息包含需要更改 role 的世界书条目
        const split = splitMergedMessage(content, matchedEntries, msg.role);
        if (split.length > 1 || (split.length === 1 && split[0].role !== msg.role)) {
          newChat.push(...split);
          splitCount += split.length - 1;
          matched = true;
          console.log(
            `${LOG_PREFIX} 已拆分 ${group.label} 消息为 ${split.length} 条:`,
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
    // 原地替换 chat 数组内容
    chat.length = 0;
    chat.push(...newChat);
    console.log(`${LOG_PREFIX} ✅ 拆分完成：新增 ${splitCount} 条消息（总计 ${chat.length} 条）`);
  } else {
    console.log(`${LOG_PREFIX} 无需拆分任何消息`);
  }
}

// ============================================================================
// 生命周期
// ============================================================================

// 使用 SillyTavern.eventSource 直接注册事件（而非 iframe 桥接的 eventOn），
// 确保对 event data（如 chat 数组）的修改能直接反映到 SillyTavern 的原始对象上。
const stEvents = SillyTavern.eventSource;

$(() => {
  console.log(`${LOG_PREFIX} 🚀 世界书多Role脚本已加载`);

  // 第一阶段：缓存激活的世界书条目
  stEvents.on(tavern_events.WORLD_INFO_ACTIVATED, onWorldInfoActivated);

  // 第二阶段：拆分合并的消息（放在最后执行，避免干扰其他监听器）
  stEvents.makeLast(tavern_events.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);

  toastr.success('世界书多Role脚本已加载', '多Role世界书');
});

$(window).on('pagehide', () => {
  // 在父页面的事件源上清理监听器
  stEvents.removeListener(tavern_events.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
  stEvents.removeListener(tavern_events.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
  activatedEntries = [];
  console.log(`${LOG_PREFIX} 🛑 世界书多Role脚本已卸载`);
});
