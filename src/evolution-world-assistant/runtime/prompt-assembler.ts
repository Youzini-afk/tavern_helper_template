import { EwPromptOrderEntry, EwFlowConfig } from './types';

// SillyTavern globals available at runtime in extension context
declare function getCharacterCardFields(): {
  description: string;
  personality: string;
  persona: string;
  scenario: string;
  mesExamples: string;
  system: string;
  jailbreak: string;
} | undefined;
declare function getLastMessageId(): number;
declare function getChatMessages(range: string, opts?: Record<string, any>): any[];
declare const SillyTavern: { getContext(): Record<string, any> } | undefined;

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
  };

  // ── 1. Character card fields ──────────────────────────────────────────
  try {
    const fields = getCharacterCardFields?.();
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

  // ── 2. World Info ─────────────────────────────────────────────────────
  // At GENERATION_AFTER_COMMANDS, WI has already been computed by SillyTavern
  // and stored in extension_prompts. We read the WI content from there.
  try {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern?.getContext() : undefined;
    const extPrompts = ctx?.extensionPrompts ?? (globalThis as any).extension_prompts;
    if (extPrompts && typeof extPrompts === 'object') {
      const wiBefore: string[] = [];
      const wiAfter: string[] = [];
      for (const [, prompt] of Object.entries(extPrompts)) {
        const p = prompt as any;
        if (!p || typeof p.value !== 'string' || !p.value.trim()) continue;
        // SillyTavern extension_prompts position: 0 = before char defs, 1 = after char defs
        // We group them into before/after WI slots
        if (p.position === 0) {
          wiBefore.push(p.value.trim());
        } else if (p.position === 1) {
          wiAfter.push(p.value.trim());
        }
      }
      components.worldInfoBefore = wiBefore.join('\n');
      components.worldInfoAfter = wiAfter.join('\n');
    }
  } catch (e) {
    console.debug('[Evolution World] extension_prompts read failed:', e);
  }

  // ── 3. Chat messages ──────────────────────────────────────────────────
  try {
    const lastId = getLastMessageId();
    if (lastId >= 0) {
      const msgs = getChatMessages(`0-${lastId}`, { hide_state: 'unhidden' });
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

  return components;
}

type AssembledMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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
export function assembleOrderedPrompts(
  promptOrder: EwPromptOrderEntry[],
  components: PromptComponents,
): AssembledMessage[] {
  const result: AssembledMessage[] = [];
  // Deferred injections: prompts with in_chat position that go inside chat history
  const deferredInjections: Array<{ entry: EwPromptOrderEntry; depth: number }> = [];
  let chatHistoryStartIdx = -1;

  for (const entry of promptOrder) {
    if (!entry.enabled) continue;

    // Defer in_chat injections — they'll be inserted after chat history is placed
    if (entry.injection_position === 'in_chat' && entry.identifier !== 'chatHistory') {
      if (entry.type === 'prompt' && entry.content.trim()) {
        deferredInjections.push({ entry, depth: entry.injection_depth });
      } else if (entry.type === 'marker') {
        const content = resolveMarkerContent(entry.identifier, components);
        if (content.trim()) {
          deferredInjections.push({
            entry: { ...entry, content },
            depth: entry.injection_depth,
          });
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
            result.push({ role: msg.role, content: msg.content });
          }
        }
        continue;
      }

      const content = resolveMarkerContent(entry.identifier, components);
      if (content.trim()) {
        result.push({ role: entry.role, content });
      }
    } else if (entry.content.trim()) {
      // User-editable prompt — content is entry.content
      result.push({ role: entry.role, content: entry.content });
    }
  }

  // ── Insert deferred in_chat injections at the correct depth ──
  // depth=0 means at the end of chat history, depth=1 means before the last
  // chat message, depth=N means before the Nth-from-last message, etc.
  if (deferredInjections.length > 0 && chatHistoryStartIdx >= 0) {
    const chatHistoryEndIdx = result.length;
    const chatLen = chatHistoryEndIdx - chatHistoryStartIdx;

    // Sort by depth descending so deeper injections are inserted first
    // (this preserves correct positions when inserting multiple items)
    deferredInjections.sort((a, b) => b.depth - a.depth);

    for (const { entry, depth } of deferredInjections) {
      // Calculate insertion point: end of chat minus depth
      const insertIdx = Math.max(
        chatHistoryStartIdx,
        chatHistoryEndIdx - Math.min(depth, chatLen),
      );
      result.splice(insertIdx, 0, { role: entry.role, content: entry.content });
    }
  } else if (deferredInjections.length > 0) {
    // No chat history marker — append deferred items at the end
    for (const { entry } of deferredInjections) {
      result.push({ role: entry.role, content: entry.content });
    }
  }

  return result;
}

/**
 * Resolve the content for a marker-type prompt order entry.
 */
function resolveMarkerContent(identifier: string, components: PromptComponents): string {
  switch (identifier) {
    case 'main':               return components.main;
    case 'charDescription':    return components.charDescription;
    case 'charPersonality':    return components.charPersonality;
    case 'scenario':           return components.scenario;
    case 'personaDescription': return components.personaDescription;
    case 'worldInfoBefore':    return components.worldInfoBefore;
    case 'worldInfoAfter':     return components.worldInfoAfter;
    case 'dialogueExamples':   return components.dialogueExamples;
    case 'postHistoryInstructions': return components.jailbreak;
    default:                   return '';
  }
}
