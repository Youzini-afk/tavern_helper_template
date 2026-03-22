/**
 * 世界书多Role脚本 v3
 *
 * 将被合并为单条 system 消息的世界书条目拆分为多条独立消息。
 *
 * 工作流程:
 * 1. WORLD_INFO_ACTIVATED: 缓存所有激活条目的原始内容，按 position 分组
 * 2. CHAT_COMPLETION_PROMPT_READY: 拼接出各组的预期合并字符串，在 chat 数组中查找包含该字符串的消息
 * 3. 将匹配到的消息替换为多条独立消息（每条目一条，默认 system，可通过条目名前缀指定 role）
 */

const LOG_PREFIX = '[多Role世界书]';

// ============================================================================
// 常量
// ============================================================================

/** 世界书位置枚举 */
const WI_POSITION = {
  before: 0,
  after: 1,
  ANTop: 2,
  ANBottom: 3,
  atDepth: 4,
  EMTop: 5,
  EMBottom: 6,
} as const;

/** 位置名称映射（用于日志） */
const POSITION_LABELS: Record<number, string> = {
  0: '角色定义前(before)',
  1: '角色定义后(after)',
  2: '作者注释上(ANTop)',
  3: '作者注释下(ANBottom)',
  5: '示例消息上(EMTop)',
  6: '示例消息下(EMBottom)',
};

/** Role 数字到字符串的映射 */
const ROLE_MAP: Record<number, 'system' | 'user' | 'assistant'> = {
  0: 'system',
  1: 'user',
  2: 'assistant',
};

/** Role 前缀正则：匹配条目名开头的 [user]、[assistant]、[system] */
const ROLE_PREFIX_RE = /^\[(user|assistant|system)\]/i;

// ============================================================================
// 类型
// ============================================================================

interface CachedEntry {
  /** 原始内容（未经宏替换） */
  rawContent: string;
  /** 宏替换后的内容（用于匹配） */
  substitutedContent: string;
  /** 解析后的 role */
  role: 'system' | 'user' | 'assistant';
  /** 位置 */
  position: number;
  /** 条目名称 */
  comment: string;
}

interface PositionGroup {
  position: number;
  label: string;
  entries: CachedEntry[];
  /** 各条目替换后内容的拼接（用于在 chat 中定位合并消息） */
  mergedContent: string;
}

// ============================================================================
// 状态
// ============================================================================

let positionGroups: PositionGroup[] = [];

// ============================================================================
// Role 解析
// ============================================================================

function resolveRole(entry: SillyTavern.FlattenedWorldInfoEntry): 'system' | 'user' | 'assistant' {
  const comment = entry.comment ?? '';
  const match = comment.match(ROLE_PREFIX_RE);
  if (match) {
    return match[1].toLowerCase() as 'system' | 'user' | 'assistant';
  }
  // atDepth 条目用自带的 role（但本脚本不处理 atDepth）
  if (entry.position === WI_POSITION.atDepth && entry.role != null) {
    return ROLE_MAP[entry.role] ?? 'system';
  }
  return 'system';
}

// ============================================================================
// 第一阶段：缓存激活的条目
// ============================================================================

async function onWorldInfoActivated(entries: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[]) {
  // 只处理非 atDepth 的条目（atDepth 已经由 SillyTavern 独立注入）
  const nonDepthEntries = entries.filter(
    e => !e.disable && e.content && e.content.trim().length > 0 && e.position !== WI_POSITION.atDepth,
  );

  if (nonDepthEntries.length === 0) {
    positionGroups = [];
    console.log(`${LOG_PREFIX} 无非 atDepth 的激活条目`);
    return;
  }

  // 对每个条目做宏替换
  const cachedEntries: CachedEntry[] = [];
  for (const e of nonDepthEntries) {
    let substituted: string;
    try {
      substituted = await SillyTavern.substituteParams(e.content);
    } catch {
      // 如果替换失败，用原始内容
      substituted = e.content;
    }
    cachedEntries.push({
      rawContent: e.content,
      substitutedContent: substituted,
      role: resolveRole(e),
      position: e.position,
      comment: e.comment ?? '',
    });
  }

  // 按 position 分组
  const groups = new Map<number, CachedEntry[]>();
  for (const entry of cachedEntries) {
    if (!groups.has(entry.position)) {
      groups.set(entry.position, []);
    }
    groups.get(entry.position)!.push(entry);
  }

  // 构建 PositionGroup（含预期合并字符串）
  positionGroups = [];
  for (const [pos, entries] of groups) {
    const label = POSITION_LABELS[pos] ?? `position=${pos}`;
    const mergedContent = entries.map(e => e.substitutedContent).join('\n');
    positionGroups.push({ position: pos, label, entries, mergedContent });
  }

  console.log(`${LOG_PREFIX} 已缓存 ${cachedEntries.length} 个条目，分为 ${positionGroups.length} 组:`);
  for (const g of positionGroups) {
    console.log(`  ${g.label}: ${g.entries.length} 个条目, 合并串长度=${g.mergedContent.length}`);
  }
}

// ============================================================================
// 第二阶段：拆分合并消息
// ============================================================================

function onChatCompletionPromptReady(eventData: { chat: SillyTavern.SendingMessage[]; dryRun: boolean }) {
  if (eventData.dryRun) return;
  if (positionGroups.length === 0) return;

  const chat = eventData.chat;
  console.log(`${LOG_PREFIX} 正在处理 ${chat.length} 条消息...`);

  const newChat: SillyTavern.SendingMessage[] = [];
  let totalSplit = 0;

  for (let i = 0; i < chat.length; i++) {
    const msg = chat[i];
    const content = typeof msg.content === 'string' ? msg.content : '';

    if (!content) {
      newChat.push(msg);
      continue;
    }

    // 尝试匹配各位置组的合并串
    let matched = false;

    for (const group of positionGroups) {
      if (group.entries.length <= 1) continue; // 只有一个条目不需要拆分
      if (group.mergedContent.length === 0) continue;

      // 检查该消息是否包含该组的合并串
      if (content.includes(group.mergedContent)) {
        // 匹配成功！拆分为独立消息
        const splitMessages: SillyTavern.SendingMessage[] = [];

        // 如果合并串之前有 formatWorldInfo 的包裹文本，保留它
        const mergedIdx = content.indexOf(group.mergedContent);
        if (mergedIdx > 0) {
          const prefix = content.slice(0, mergedIdx).trim();
          if (prefix.length > 0) {
            splitMessages.push({ role: msg.role, content: prefix });
          }
        }

        // 每个条目一条消息
        for (const entry of group.entries) {
          splitMessages.push({ role: entry.role, content: entry.substitutedContent });
        }

        // 如果合并串之后有包裹文本，保留它
        const afterIdx = mergedIdx + group.mergedContent.length;
        if (afterIdx < content.length) {
          const suffix = content.slice(afterIdx).trim();
          if (suffix.length > 0) {
            splitMessages.push({ role: msg.role, content: suffix });
          }
        }

        newChat.push(...splitMessages);
        totalSplit += splitMessages.length - 1;
        matched = true;

        console.log(
          `${LOG_PREFIX} ✅ 拆分 ${group.label}: 1条 → ${splitMessages.length}条`,
          splitMessages.map(s => `[${s.role}] ${(typeof s.content === 'string' ? s.content : '').slice(0, 40)}...`),
        );
        break;
      }
    }

    if (!matched) {
      newChat.push(msg);
    }
  }

  if (totalSplit > 0) {
    // 原地替换 chat 数组
    chat.length = 0;
    chat.push(...newChat);
    console.log(`${LOG_PREFIX} 拆分完成：新增 ${totalSplit} 条消息（总计 ${chat.length} 条）`);
  } else {
    console.log(`${LOG_PREFIX} 未匹配到需要拆分的消息`);
    // 调试：输出各组期望内容的前100字符
    for (const group of positionGroups) {
      if (group.entries.length <= 1) continue;
      console.log(`  ${group.label} 期望合并串(前100): "${group.mergedContent.slice(0, 100)}"`);
    }
    // 输出 chat 中所有 system 消息的前100字符
    for (let i = 0; i < chat.length; i++) {
      const c = typeof chat[i].content === 'string' ? chat[i].content : '';
      if (chat[i].role === 'system' && c.length > 50) {
        console.log(`  chat[${i}] [${chat[i].role}] (len=${c.length}): "${c.slice(0, 100)}..."`);
      }
    }
  }
}

// ============================================================================
// 生命周期
// ============================================================================

const stEvents = SillyTavern.eventSource;

$(() => {
  console.log(`${LOG_PREFIX} 🚀 世界书多Role脚本已加载 (v3)`);

  stEvents.on(tavern_events.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
  stEvents.makeLast(tavern_events.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);

  toastr.success('世界书多Role脚本已加载', '多Role世界书');
});

$(window).on('pagehide', () => {
  stEvents.removeListener(tavern_events.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
  stEvents.removeListener(tavern_events.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
  positionGroups = [];
  console.log(`${LOG_PREFIX} 🛑 世界书多Role脚本已卸载`);
});
