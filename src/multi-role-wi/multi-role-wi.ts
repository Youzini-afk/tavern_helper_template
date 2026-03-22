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
  // 注意: d.ts 中 substituteParams 返回类型标注为 Promise<void>，实际返回 string
  const cachedEntries: CachedEntry[] = [];
  for (const e of nonDepthEntries) {
    let substituted: string;
    try {
      const result = await (SillyTavern as any).substituteParams(e.content);
      // 如果返回有效字符串就用，否则回退到原始内容
      substituted = (typeof result === 'string' && result.length > 0) ? result : e.content;
    } catch {
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

  // 将所有组的条目合成一个平面列表
  const allEntries = positionGroups.flatMap(g => g.entries);
  if (allEntries.length < 2) {
    console.log(`${LOG_PREFIX} 总条目不足2个，无需拆分`);
    return;
  }

  const chat = eventData.chat;
  console.log(`${LOG_PREFIX} 正在处理 ${chat.length} 条消息（${allEntries.length} 个缓存条目）...`);

  const newChat: SillyTavern.SendingMessage[] = [];
  let totalSplit = 0;

  for (let i = 0; i < chat.length; i++) {
    const msg = chat[i];
    const content = typeof msg.content === 'string' ? msg.content : '';

    if (!content || content.length < 20) {
      newChat.push(msg);
      continue;
    }

    // 查找该消息中包含了哪些缓存条目
    const found: { entry: CachedEntry; startIndex: number; endIndex: number }[] = [];
    for (const entry of allEntries) {
      const idx = content.indexOf(entry.substitutedContent);
      if (idx !== -1) {
        found.push({ entry, startIndex: idx, endIndex: idx + entry.substitutedContent.length });
      }
    }

    // 如果包含 ≥2 个条目，说明是合并的 WI 消息，需要拆分
    if (found.length >= 2) {
      // 按出现位置排序
      found.sort((a, b) => a.startIndex - b.startIndex);

      const splitMessages: SillyTavern.SendingMessage[] = [];
      let lastEnd = 0;

      for (const { entry, startIndex, endIndex } of found) {
        // 条目之前的间隔文本（可能是 formatWorldInfo 包裹或分隔符）
        if (startIndex > lastEnd) {
          const gap = content.slice(lastEnd, startIndex).trim();
          if (gap.length > 0) {
            splitMessages.push({ role: msg.role, content: gap });
          }
        }
        // 条目本身，用其指定的 role
        splitMessages.push({ role: entry.role, content: entry.substitutedContent });
        lastEnd = endIndex;
      }

      // 最后的尾部文本
      if (lastEnd < content.length) {
        const suffix = content.slice(lastEnd).trim();
        if (suffix.length > 0) {
          splitMessages.push({ role: msg.role, content: suffix });
        }
      }

      newChat.push(...splitMessages);
      totalSplit += splitMessages.length - 1;

      console.log(
        `${LOG_PREFIX} ✅ 拆分消息[${i}]: 匹配到 ${found.length} 个条目 → ${splitMessages.length} 条消息`,
        splitMessages.map(s => `[${s.role}] ${(typeof s.content === 'string' ? s.content : '').slice(0, 40)}...`),
      );
    } else {
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
    // 调试日志
    console.log(`${LOG_PREFIX} === 调试信息 ===`);
    console.log(`${LOG_PREFIX} 缓存条目示例(前3):`,
      allEntries.slice(0, 3).map(e => `[${e.comment}] "${e.substitutedContent.slice(0, 60)}..."`));
    const longSysMsgs = chat.filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.length > 100);
    console.log(`${LOG_PREFIX} 长system消息(${longSysMsgs.length}条):`,
      longSysMsgs.slice(0, 3).map(m => `(len=${(m.content as string).length}) "${(m.content as string).slice(0, 80)}..."`));
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
