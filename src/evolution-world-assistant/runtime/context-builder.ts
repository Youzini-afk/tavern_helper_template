import { FlowRequestV1, FlowRequestSchema, TextSliceRule } from './contracts';
import { EwFlowConfig, EwSettings } from './types';
import { extractSlices, removeSlices, uuidv4 } from './helpers';
import { resolveTargetWorldbook, getFullWorldbookContext } from './worldbook-runtime';

export type BuildRequestInput = {
  settings: EwSettings;
  flow: EwFlowConfig;
  message_id: number;
  user_input: string;
  request_id?: string;
  serial_results?: Record<string, any>[];
};

function applyContentFilters(text: string, extractRules: TextSliceRule[], excludeRules: TextSliceRule[]): string {
  let content = text;
  if (extractRules.length > 0) {
    content = extractSlices(content, extractRules);
  }
  if (excludeRules.length > 0) {
    content = removeSlices(content, excludeRules);
  }
  return content;
}

function getMvuSnapshot(messageId: number): { message_id: number; stat_data: Record<string, any> } {
  const mvu = _.get(window, 'Mvu');
  if (!mvu || !_.isFunction(mvu.getMvuData)) {
    return { message_id: messageId, stat_data: {} };
  }

  try {
    const data = mvu.getMvuData({ type: 'message', message_id: -1 });
    return {
      message_id: -1,
      stat_data: _.get(data, 'stat_data', {}),
    };
  } catch {
    return { message_id: messageId, stat_data: {} };
  }
}

function getContextMessages(flow: EwFlowConfig): Array<{ role: 'system' | 'assistant' | 'user'; content: string; message_id: number }> {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return [];
  }

  const messages = getChatMessages(`0-${lastId}`, { hide_state: 'unhidden' })
    .slice(-flow.context_turns)
    .map(msg => ({
      role: msg.role,
      content: applyContentFilters(msg.message ?? '', flow.extract_rules, flow.exclude_rules),
      message_id: msg.message_id,
    }))
    .filter(msg => Boolean(msg.content.trim()));

  return messages;
}

function getPresetSnapshot(): { name: string; enabled_prompts: Array<{ id: string; name: string; role: 'system' | 'user' | 'assistant' }> } {
  try {
    const presetName = getLoadedPresetName();
    const preset = getPreset('in_use');
    const enabledPrompts = preset.prompts
      .filter(p => p.enabled)
      .map(p => ({ id: p.id, name: p.name, role: p.role }));
    return { name: presetName, enabled_prompts: enabledPrompts };
  } catch {
    return { name: '', enabled_prompts: [] };
  }
}

export async function buildFlowRequest(input: BuildRequestInput): Promise<FlowRequestV1> {
  const chatId = String(SillyTavern.getCurrentChatId?.() ?? SillyTavern.chatId ?? 'unknown');
  const requestId = input.request_id ?? uuidv4();

  // Resolve the target worldbook (character card's primary worldbook).
  let worldbookName = '';
  let worldbookEntries: Array<{ name: string; enabled: boolean; content: string }> = [];
  try {
    const target = await resolveTargetWorldbook(input.settings);
    worldbookName = target.worldbook_name;
    worldbookEntries = target.entries.map(entry => ({
      name: entry.name,
      enabled: entry.enabled,
      content: entry.content,
    }));
  } catch {
    // Proceed with empty worldbook snapshot.
  }

  // Collect full character/worldbook/preset context.
  const fullContext = await getFullWorldbookContext();
  const presetInfo = getPresetSnapshot();
  const contextMessages = getContextMessages(input.flow);

  const payload = FlowRequestSchema.parse({
    version: 'ew-flow/v1',
    request_id: requestId,
    chat_id: chatId,
    message_id: input.message_id,
    user_input: input.user_input,
    flow: {
      id: input.flow.id,
      name: input.flow.name,
      priority: input.flow.priority,
      timeout_ms: input.flow.timeout_ms,
      generation_options: input.flow.generation_options,
      behavior_options: input.flow.behavior_options,
      prompt_items: input.flow.prompt_items,
    },
    context: {
      messages: contextMessages,
      turns: input.flow.context_turns,
      extract_rules: input.flow.extract_rules,
      exclude_rules: input.flow.exclude_rules,
    },
    worldbook: {
      worldbook_name: worldbookName,
      entries: worldbookEntries,
    },
    character_context: {
      name: fullContext.character_name,
      description: fullContext.character_description,
      worldbook_entries: fullContext.char_worldbook.entries,
    },
    global_worldbooks: fullContext.global_worldbooks,
    preset_info: presetInfo,
    mvu: getMvuSnapshot(input.message_id),
    serial_results: input.serial_results ?? [],
  });

  return payload;
}
