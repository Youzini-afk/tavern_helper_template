import { simpleHash, now } from './helpers';
import { EwSettings } from './types';

type SendRecord = {
  message_id: number;
  user_input: string;
  hash: string;
  at: number;
};

type SendIntentRecord = {
  user_input: string;
  hash: string;
  at: number;
};

type GenerationRecord = {
  type: string;
  params: {
    automatic_trigger?: boolean;
    quiet_prompt?: string;
    [key: string]: any;
  };
  dry_run: boolean;
  at: number;
};

export type RuntimeState = {
  last_send: SendRecord | null;
  last_send_intent: SendIntentRecord | null;
  last_generation: GenerationRecord | null;
  is_processing: boolean;
};

const state: RuntimeState = {
  last_send: null,
  last_send_intent: null,
  last_generation: null,
  is_processing: false,
};

export function getRuntimeState(): RuntimeState {
  return state;
}

export function recordUserSend(message_id: number, user_input: string) {
  state.last_send = {
    message_id,
    user_input,
    hash: simpleHash(user_input),
    at: now(),
  };
}

export function recordUserSendIntent(user_input: string) {
  state.last_send_intent = {
    user_input,
    hash: simpleHash(user_input),
    at: now(),
  };
}

export function recordGeneration(type: string, params: Record<string, any> | undefined, dry_run: boolean) {
  state.last_generation = {
    type,
    params: (params ?? {}) as GenerationRecord['params'],
    dry_run,
    at: now(),
  };
}

export function setProcessing(processing: boolean) {
  state.is_processing = processing;
}

export function clearSendContext() {
  state.last_send = null;
  state.last_send_intent = null;
}

export function resetRuntimeState() {
  state.last_send = null;
  state.last_send_intent = null;
  state.last_generation = null;
  state.is_processing = false;
}

export function isQuietLike(type: string, params: { quiet_prompt?: string } | undefined): boolean {
  if (type === 'quiet') {
    return true;
  }
  if (params?.quiet_prompt && String(params.quiet_prompt).trim()) {
    return true;
  }
  return false;
}

export function shouldHandleGenerationAfter(
  type: string,
  params: { automatic_trigger?: boolean; quiet_prompt?: string } | undefined,
  dry_run: boolean,
  settings: EwSettings,
): { ok: boolean; reason: string } {
  if (!settings.enabled) {
    return { ok: false, reason: 'disabled' };
  }
  if (state.is_processing) {
    return { ok: false, reason: 'already_processing' };
  }
  if (dry_run) {
    return { ok: false, reason: 'dry_run' };
  }
  if (isQuietLike(type, params)) {
    return { ok: false, reason: 'quiet' };
  }
  if (params?.automatic_trigger) {
    return { ok: false, reason: 'automatic_trigger' };
  }
  // Allow the standard generation types that users can configure trigger_types for.
  const allowedTypes = new Set(['normal', 'continue', 'regenerate', 'swipe']);
  if (!allowedTypes.has(type)) {
    return { ok: false, reason: `unsupported_type:${type}` };
  }

  // CR-2: continue/regenerate/swipe don't create new send records, so the
  // gate_ttl freshness check would almost always reject them. Skip it.
  const noSendTypes = new Set(['continue', 'regenerate', 'swipe']);
  if (noSendTypes.has(type)) {
    return { ok: true, reason: 'ok' };
  }

  const lastSend = state.last_send;
  const lastIntent = state.last_send_intent;
  const hasFreshSend = Boolean(lastSend && now() - lastSend.at <= settings.gate_ttl_ms);
  const hasFreshIntent = Boolean(lastIntent && now() - lastIntent.at <= settings.gate_ttl_ms);

  if (!hasFreshSend && !hasFreshIntent) {
    return { ok: false, reason: 'missing_send_context' };
  }

  return { ok: true, reason: 'ok' };
}
