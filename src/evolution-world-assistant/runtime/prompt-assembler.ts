import { renderEjsContent } from './ejs-bridge';
import { collectLatestSnapshotFast } from './floor-binding';
import { applyTavernRegex } from './regex-engine';
import type { EwFlowConfig, EwPromptOrderEntry } from './types';

// SillyTavern 运行时全局变量，在扩展上下文中可用
declare function getCharacterCardFields():
  | {
      description: string;
      personality: string;
      persona: string;
      scenario: string;
      mesExamples: string;
      system: string;
      jailbreak: string;
    }
  | undefined;
declare function getLastMessageId(): number;
declare function getChatMessages(range: string, opts?: Record<string, any>): any[];
declare const SillyTavern: { getContext(): Record<string, any> } | undefined;

function getHostRuntime(): Record<string, any> {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent as unknown as Record<string, any>;
    }
  } catch {
    // ignore cross-frame access failures and fall back to current window
  }

  return globalThis as Record<string, any>;
}

function getRuntimeContext(): Record<string, any> | undefined {
  const hostRuntime = getHostRuntime();

  if (typeof hostRuntime.SillyTavern?.getContext === 'function') {
    return hostRuntime.SillyTavern.getContext();
  }
  if (typeof SillyTavern?.getContext === 'function') {
    return SillyTavern.getContext();
  }

  return undefined;
}

function getRuntimeCharacterCardFields(): ReturnType<typeof getCharacterCardFields> {
  const hostRuntime = getHostRuntime();
  if (typeof hostRuntime.getCharacterCardFields === 'function') {
    return hostRuntime.getCharacterCardFields();
  }

  return getCharacterCardFields?.();
}

function getRuntimeLastMessageId(): number {
  const hostRuntime = getHostRuntime();
  if (typeof hostRuntime.getLastMessageId === 'function') {
    return Number(hostRuntime.getLastMessageId());
  }

  return getLastMessageId();
}

function getRuntimeChatMessages(range: string, opts?: Record<string, any>): any[] {
  const hostRuntime = getHostRuntime();
  if (typeof hostRuntime.getChatMessages === 'function') {
    return hostRuntime.getChatMessages(range, opts);
  }

  return getChatMessages(range, opts);
}

/**
 * Raw prompt components collected from SillyTavern's runtime environment.
 * Marker-type entries in prompt_order will source their content from here.
 */
export type PromptComponents = {
  main: string;
  jailbreak: string;
  charDescription: string;
  charPersonality: string;
  scenario: string;
  personaDescription: string;
  worldInfoBefore: string;
  worldInfoAfter: string;
  dialogueExamples: string;
  chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string; name?: string }>;
  /** Extension prompts that need depth-based injection into chat history (ST position=IN_CHAT) */
  depthInjections: Array<{ content: string; depth: number; role: 'system' | 'user' | 'assistant' }>;
  /** Extension prompts that go before all other prompts (ST position=BEFORE_PROMPT) */
  beforePromptInjections: string[];
};

export type PromptPreviewMessage = AssembledMessage & {
  debugOnly?: boolean;
  previewTitle?: string;
};

type AssemblePreviewOptions = {
  includeMarkerPlaceholders?: boolean;
};

/**
 * Collect all prompt components from SillyTavern's runtime environment.
 *
 * Gathers raw content for every system marker that can appear in a flow's
 * prompt_order: character card fields, world info, jailbreak, and chat messages.
 */
export function collectPromptComponents(flow: EwFlowConfig): PromptComponents {
  const components: PromptComponents = {
    main: '',
    jailbreak: '',
    charDescription: '',
    charPersonality: '',
    scenario: '',
    personaDescription: '',
    worldInfoBefore: '',
    worldInfoAfter: '',
    dialogueExamples: '',
    chatMessages: [],
    depthInjections: [],
    beforePromptInjections: [],
  };

  // ── 1. Character card fields ──────────────────────────────────────────
  try {
    const fields = getRuntimeCharacterCardFields();
    if (fields) {
      components.charDescription = fields.description ?? '';
      components.charPersonality = fields.personality ?? '';
      components.scenario = fields.scenario ?? '';
      components.personaDescription = fields.persona ?? '';
      components.dialogueExamples = fields.mesExamples ?? '';
      components.main = fields.system ?? '';
      components.jailbreak = fields.jailbreak ?? '';
    }
  } catch (e) {
    console.debug('[Evolution World] getCharacterCardFields failed:', e);
  }

  // ── 2. World Info (before/after) from SillyTavern context ───────────────
  // ST computes worldInfoBefore/After via getWorldInfoPrompt() and may expose
  // them on the context object. These are the non-depth WI entries.
  try {
    const ctx = getRuntimeContext();
    if (ctx) {
      // Try to read pre-computed WI strings from context
      if (typeof ctx.worldInfoBefore === 'string' && ctx.worldInfoBefore.trim()) {
        components.worldInfoBefore = ctx.worldInfoBefore;
      }
      if (typeof ctx.worldInfoAfter === 'string' && ctx.worldInfoAfter.trim()) {
        components.worldInfoAfter = ctx.worldInfoAfter;
      }
    }
  } catch (e) {
    console.debug('[Evolution World] context worldInfo read failed:', e);
  }

  // ── 3. Extension prompts (depth injections, before-prompt, etc.) ────────
  // SillyTavern stores computed extension prompts in `extension_prompts`.
  // Each entry: { value: string, position: number, depth: number, role: number }
  //   position: IN_PROMPT(0) = in prompt area, IN_CHAT(1) = depth injection,
  //             BEFORE_PROMPT(2) = before all prompts, NONE(-1) = skip
  //   role:     SYSTEM(0), USER(1), ASSISTANT(2)
  try {
    const ctx2 = getRuntimeContext();
    const extPrompts =
      ctx2?.extensionPrompts ?? getHostRuntime().extension_prompts ?? (globalThis as any).extension_prompts;
    if (extPrompts && typeof extPrompts === 'object') {
      const roleMap: Record<number, 'system' | 'user' | 'assistant'> = {
        0: 'system',
        1: 'user',
        2: 'assistant',
      };
      const inPromptEntries: string[] = [];

      for (const [, prompt] of Object.entries(extPrompts)) {
        const p = prompt as any;
        if (!p || typeof p.value !== 'string' || !p.value.trim()) continue;

        const role = roleMap[p.role] ?? 'system';

        switch (p.position) {
          case 0: // IN_PROMPT — in the prompt area (near character definitions)
            inPromptEntries.push(p.value.trim());
            break;
          case 1: // IN_CHAT — depth-based injection into chat history
            components.depthInjections.push({
              content: p.value.trim(),
              depth: typeof p.depth === 'number' ? p.depth : 0,
              role,
            });
            break;
          case 2: // BEFORE_PROMPT — before all other prompts
            components.beforePromptInjections.push(p.value.trim());
            break;
          // NONE (-1) is intentionally ignored
        }
      }

      // IN_PROMPT entries: append to worldInfoBefore as fallback
      // (only if we didn't already get WI from context)
      if (inPromptEntries.length) {
        components.worldInfoBefore = [components.worldInfoBefore, ...inPromptEntries].filter(s => s).join('\n');
      }
    }
  } catch (e) {
    console.debug('[Evolution World] extension_prompts read failed:', e);
  }

  // ── 3. Chat messages ──────────────────────────────────────────────────
  try {
    const lastId = getRuntimeLastMessageId();
    if (lastId >= 0) {
      const msgs = getRuntimeChatMessages(`0-${lastId}`, { hide_state: 'unhidden' });
      components.chatMessages = msgs
        .slice(-flow.context_turns)
        .map((msg: any) => ({
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.message ?? '',
          name: msg.name,
        }))
        .filter((msg: any) => Boolean(msg.content.trim()));
    }
  } catch (e) {
    console.debug('[Evolution World] getChatMessages failed:', e);
  }

  // ── 4. 正则处理 ─────────────────────────────────────────────────────
  // 当 flow 启用 use_tavern_regex 时，对聊天消息应用酒馆的正则脚本
  // （预设 + 全局 + 角色卡局部，跳过 markdownOnly）
  if (flow.use_tavern_regex && components.chatMessages.length > 0) {
    applyTavernRegex(components.chatMessages);
  }

  return components;
}

export type AssembledMessage = { role: 'system' | 'user' | 'assistant'; content: string; name?: string };

function createMarkerPreviewMessage(title: string, content: string): PromptPreviewMessage {
  return {
    role: 'system',
    content,
    debugOnly: true,
    previewTitle: title,
  };
}

async function buildMarkerPreviewMessage(
  entry: EwPromptOrderEntry,
  components: PromptComponents,
): Promise<PromptPreviewMessage> {
  const markerTitle = entry.name?.trim() || entry.identifier;

  if (entry.identifier === 'chatHistory') {
    const count = components.chatMessages.length;
    const summary =
      count > 0
        ? `已读取 ${count} 条聊天消息。触发工作流时，这里会展开为多条 user/assistant 消息。`
        : '当前没有可用的聊天消息，因此这里不会发送任何历史消息。';
    return createMarkerPreviewMessage(`📌 ${markerTitle}`, summary);
  }

  const rawContent = resolveMarkerContent(entry.identifier, components);
  const renderedContent = rawContent.trim() ? await renderEjsContent(rawContent) : '';
  const summary = renderedContent.trim()
    ? `已读取该段内容（${renderedContent.length} chars）。触发工作流时会发送。`
    : '当前为空，因此这里不会发送任何内容。';

  return createMarkerPreviewMessage(`📌 ${markerTitle}`, summary);
}

/**
 * Assemble an ordered array of prompt messages according to a flow's prompt_order.
 *
 * This mirrors SillyTavern's `populateChatCompletion()` logic: it walks
 * through the user-configured prompt order and fills each slot with the
 * appropriate content — either from automatically-collected PromptComponents
 * (for markers) or from user-written content (for prompt entries).
 *
 * Supports injection_position='in_chat' + injection_depth for prompts
 * that should be inserted at a specific depth inside the chat history.
 */
export async function assembleOrderedPrompts(
  promptOrder: EwPromptOrderEntry[],
  components: PromptComponents,
  options: AssemblePreviewOptions = {},
): Promise<PromptPreviewMessage[]> {
  const result: PromptPreviewMessage[] = [];
  // Deferred injections: prompts with in_chat position that go inside chat history
  const deferredInjections: Array<{ content: string; role: 'system' | 'user' | 'assistant'; depth: number }> = [];
  let chatHistoryStartIdx = -1;

  for (const entry of promptOrder) {
    if (!entry.enabled) continue;

    if (options.includeMarkerPlaceholders && entry.type === 'marker') {
      result.push(await buildMarkerPreviewMessage(entry, components));
    }

    // Defer in_chat injections — they'll be inserted after chat history is placed
    if (entry.injection_position === 'in_chat' && entry.identifier !== 'chatHistory') {
      if (entry.type === 'prompt' && entry.content.trim()) {
        const rendered = await renderEjsContent(entry.content);
        deferredInjections.push({ content: rendered, role: entry.role, depth: entry.injection_depth });
      } else if (entry.type === 'marker') {
        const content = await renderEjsContent(resolveMarkerContent(entry.identifier, components));
        if (content.trim()) {
          deferredInjections.push({ content, role: entry.role, depth: entry.injection_depth });
        }
      }
      continue;
    }

    if (entry.type === 'marker') {
      if (entry.identifier === 'chatHistory') {
        // Mark where chat history starts in result
        chatHistoryStartIdx = result.length;
        // Chat history expands into multiple user/assistant messages
        for (const msg of components.chatMessages) {
          if (msg.content.trim()) {
            result.push({ role: msg.role, content: msg.content, name: msg.name });
          }
        }
        continue;
      }

      const content = await renderEjsContent(resolveMarkerContent(entry.identifier, components));
      if (content.trim()) {
        result.push({ role: entry.role, content });
      }
    } else {
      // User-editable prompt — use entry.content, fallback to marker for 'main'
      const raw = entry.content.trim() || (entry.identifier === 'main' ? components.main : '');
      if (raw.trim()) {
        const content = await renderEjsContent(raw);
        result.push({ role: entry.role, content });
      }
    }
  }

  // ── Merge extension depth injections (WI depth, Author's Note, etc.) ──
  for (const inj of components.depthInjections) {
    deferredInjections.push({ content: inj.content, role: inj.role, depth: inj.depth });
  }

  // ── Insert deferred in_chat injections at the correct depth ──
  // depth=0 means at the end of chat history, depth=1 means before the last
  // chat message, depth=N means before the Nth-from-last message, etc.
  if (deferredInjections.length > 0 && chatHistoryStartIdx >= 0) {
    const chatHistoryEndIdx = result.length;
    const chatLen = chatHistoryEndIdx - chatHistoryStartIdx;

    // Sort by depth descending so deeper injections are inserted first
    // (this preserves correct positions when inserting multiple items)
    // 按 depth 升序排列，从最浅到最深
    deferredInjections.sort((a, b) => a.depth - b.depth);
    // 从后往前插入：每次插入不影响之前已计算的位置
    for (let i = deferredInjections.length - 1; i >= 0; i--) {
      const { role, content, depth } = deferredInjections[i];
      const insertIdx = Math.max(chatHistoryStartIdx, chatHistoryEndIdx - Math.min(depth, chatLen));
      result.splice(insertIdx, 0, { role, content });
    }
  } else if (deferredInjections.length > 0) {
    // No chat history marker — append deferred items at the end
    for (const { role, content } of deferredInjections) {
      result.push({ role, content });
    }
  }

  // ── Prepend BEFORE_PROMPT extension injections ──
  for (let i = components.beforePromptInjections.length - 1; i >= 0; i--) {
    result.unshift({ role: 'system', content: components.beforePromptInjections[i] });
  }

  return result;
}

/**
 * Resolve the content for a marker-type prompt order entry.
 */
function resolveMarkerContent(identifier: string, components: PromptComponents): string {
  switch (identifier) {
    case 'main':
      return components.main;
    case 'enhanceDefinitions':
      return components.main; // CR-1: ST treats this as an extension of main
    case 'charDescription':
      return components.charDescription;
    case 'charPersonality':
      return components.charPersonality;
    case 'scenario':
      return components.scenario;
    case 'personaDescription':
      return components.personaDescription;
    case 'worldInfoBefore':
      return components.worldInfoBefore;
    case 'worldInfoAfter':
      return components.worldInfoAfter;
    case 'dialogueExamples':
      return components.dialogueExamples;
    case 'postHistoryInstructions':
      return components.jailbreak;
    default:
      return '';
  }
}

// ── Entry Name Injection ─────────────────────────────────────

/**
 * Inject EW entry names into assembled prompt messages via content matching.
 *
 * Uses the latest snapshot data (Controller + Dyn entries) to find their
 * content in the assembled messages and prepend `[entry_name]` labels.
 * This lets the AI identify which EW worldbook entry each content block
 * belongs to.
 *
 * @param messages  The assembled prompt messages (mutated in place)
 * @param controllerEntryName  The name of the Controller entry (from settings)
 */
export async function injectEntryNames(messages: AssembledMessage[], controllerEntryName: string): Promise<void> {
  const { controller, dyn } = await collectLatestSnapshotFast();

  // Build a list of { name, content } to match, sorted by content length descending
  // (longer content first to avoid partial substring matches).
  const matchTargets: Array<{ name: string; content: string }> = [];

  if (controller && controller.trim()) {
    matchTargets.push({ name: controllerEntryName, content: controller });
  }

  for (const snap of dyn.values()) {
    if (snap.content && snap.content.trim()) {
      matchTargets.push({ name: snap.name, content: snap.content });
    }
  }

  // Sort longest first for greedy matching.
  matchTargets.sort((a, b) => b.content.length - a.content.length);

  if (matchTargets.length === 0) return;

  // Scan each message and prepend entry names where content matches.
  for (const msg of messages) {
    for (const target of matchTargets) {
      if (msg.content.includes(target.content)) {
        msg.content = msg.content.replace(target.content, `[${target.name}]\n${target.content}`);
      }
    }
  }
}

// ── Prompt Preview (Debug) ───────────────────────────────────

/**
 * Build and return the full prompt messages array for debug preview.
 *
 * Runs the same pipeline as the real dispatch (collect components →
 * assemble ordered prompts → inject entry names) but does NOT send
 * anything to the AI. Returns the messages array for UI display.
 */
export async function previewPrompt(flow: EwFlowConfig, controllerEntryName: string): Promise<PromptPreviewMessage[]> {
  const components = collectPromptComponents(flow);
  const messages = await assembleOrderedPrompts(flow.prompt_order, components, { includeMarkerPlaceholders: true });
  await injectEntryNames(messages, controllerEntryName);
  return messages;
}
