import { FlowRequestSchema, FlowRequestV1, FlowTriggerV1 } from './contracts';
import { uuidv4 } from './helpers';
import { EwFlowConfig, EwSettings } from './types';

export type BuildRequestInput = {
  settings: EwSettings;
  flow: EwFlowConfig;
  message_id: number;
  user_input?: string;
  trigger?: FlowTriggerV1;
  request_id?: string;
  serial_results?: Record<string, any>[];
};

function sanitizeTrigger(trigger: FlowTriggerV1 | undefined): FlowTriggerV1 | undefined {
  if (!trigger) {
    return undefined;
  }

  const next: Record<string, unknown> = {
    timing: trigger.timing,
    source: trigger.source,
    generation_type: trigger.generation_type,
  };

  if (Number.isFinite(trigger.user_message_id)) {
    next.user_message_id = trigger.user_message_id;
  }

  if (Number.isFinite(trigger.assistant_message_id)) {
    next.assistant_message_id = trigger.assistant_message_id;
  }

  return next as FlowTriggerV1;
}

export async function buildFlowRequest(input: BuildRequestInput): Promise<FlowRequestV1> {
  const chatId = String(
    (typeof SillyTavern !== 'undefined' ? (SillyTavern?.getCurrentChatId?.() ?? (SillyTavern as any).chatId) : null) ??
      'unknown',
  );
  const requestId = input.request_id ?? uuidv4();
  const trigger = sanitizeTrigger(input.trigger);

  const payload = FlowRequestSchema.parse({
    version: 'ew-flow/v1',
    request_id: requestId,
    chat_id: chatId,
    message_id: input.message_id,
    ...(input.user_input ? { user_input: input.user_input } : {}),
    ...(trigger ? { trigger } : {}),
    flow: {
      id: input.flow.id,
      name: input.flow.name,
      priority: input.flow.priority,
      timeout_ms: input.flow.timeout_ms,
      generation_options: input.flow.generation_options,
      behavior_options: input.flow.behavior_options,
    },
    context: {
      turns: input.flow.context_turns,
      extract_rules: input.flow.extract_rules,
      exclude_rules: input.flow.exclude_rules,
    },
    serial_results: input.serial_results ?? [],
  });

  return payload;
}
