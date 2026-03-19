import type { FlowTriggerV1 } from './contracts';

export type WorkflowRequestContext = {
  chat_id: string;
  request_id?: string;
  message_id: number;
  user_input?: string;
  trigger?: FlowTriggerV1;
};

function resolveParentWindow(): (Window & typeof globalThis) | null {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent as Window & typeof globalThis;
    }
  } catch {
    // ignore cross-frame access failures and fall back to current window
  }

  return null;
}

export function getHostRuntime(): Record<string, any> {
  return (resolveParentWindow() ?? globalThis) as Record<string, any>;
}

export function getHostWindow(): Window & typeof globalThis {
  return (resolveParentWindow() ?? window) as Window & typeof globalThis;
}

export function getSillyTavernRuntime(): Record<string, any> | undefined {
  const hostRuntime = getHostRuntime();
  const localRuntime = globalThis as Record<string, any>;
  return hostRuntime.SillyTavern ?? localRuntime.SillyTavern;
}

export function getCurrentChatIdSafe(): string {
  try {
    return (
      String(getSillyTavernRuntime()?.getCurrentChatId?.() ?? getSillyTavernRuntime()?.chatId ?? 'unknown').trim() ||
      'unknown'
    );
  } catch {
    return 'unknown';
  }
}

export function sanitizeFlowTrigger(trigger: FlowTriggerV1 | undefined): FlowTriggerV1 | undefined {
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

export function createWorkflowRequestContext(input: WorkflowRequestContext): WorkflowRequestContext {
  return {
    chat_id: String(input.chat_id ?? '').trim() || 'unknown',
    request_id: typeof input.request_id === 'string' ? input.request_id.trim() || undefined : undefined,
    message_id: Number(input.message_id ?? -1),
    user_input: typeof input.user_input === 'string' ? input.user_input : undefined,
    trigger: sanitizeFlowTrigger(input.trigger),
  };
}
