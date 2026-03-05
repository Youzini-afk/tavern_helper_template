import { dispatchFlows, DispatchFlowsError } from './dispatcher';
import { renderControllerTemplate } from './controller-renderer';
import { mergeFlowResults } from './merger';
import { commitMergedPlan } from './transaction';
import { injectReplyInstructionOnce } from './injection';
import { getSettings, setLastIo, setLastRun } from './settings';
import { DispatchFlowAttempt, RunSummarySchema } from './types';
import { uuidv4 } from './helpers';

type RunWorkflowInput = {
  message_id: number;
  user_input: string;
  mode: 'auto' | 'manual';
  inject_reply?: boolean;
};

export type RunWorkflowOutput = {
  ok: boolean;
  reason?: string;
  request_id: string;
  diagnostics?: Record<string, any>;
};

function toPreview(value: unknown, maxLen = 3000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen)}\n...truncated`;
  } catch {
    return String(value);
  }
}

function saveIoSummary(
  requestId: string,
  chatId: string,
  mode: 'auto' | 'manual',
  attempts: DispatchFlowAttempt[],
) {
  setLastIo({
    at: Date.now(),
    request_id: requestId,
    chat_id: chatId,
    mode,
    flows: attempts.map(attempt => ({
      flow_id: attempt.flow.id,
      flow_name: attempt.flow.name,
      priority: attempt.flow.priority,
      api_preset_name: attempt.api_preset_name,
      api_url: attempt.api_url,
      ok: attempt.ok,
      elapsed_ms: attempt.elapsed_ms,
      error: attempt.error ?? '',
      request_preview: toPreview(attempt.request),
      response_preview: attempt.response ? toPreview(attempt.response) : '',
    })),
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`workflow timeout (${timeoutMs}ms)`)), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result as T;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function runWorkflow(input: RunWorkflowInput): Promise<RunWorkflowOutput> {
  const startedAt = Date.now();
  const settings = getSettings();
  const requestId = uuidv4();
  const currentChatId = String(SillyTavern.getCurrentChatId?.() ?? SillyTavern.chatId ?? 'unknown');
  let attempts: DispatchFlowAttempt[] = [];

  try {
    const enabledFlows = settings.flows.filter(flow => flow.enabled);
    if (enabledFlows.length === 0) {
      throw new Error('no enabled flows');
    }

    const dispatchOutput = await withTimeout(
      dispatchFlows({
        settings,
        flows: enabledFlows,
        message_id: input.message_id,
        user_input: input.user_input,
        request_id: requestId,
      }),
      settings.total_timeout_ms,
    );
    attempts = dispatchOutput.attempts;
    saveIoSummary(requestId, currentChatId, input.mode, attempts);

    const results = dispatchOutput.results;

    const mergedPlan = mergeFlowResults(results);
    const controllerTemplate = await renderControllerTemplate(mergedPlan.controller_model);

    const commitResult = await commitMergedPlan(settings, mergedPlan, controllerTemplate, requestId);

    if (input.inject_reply !== false) {
      injectReplyInstructionOnce(mergedPlan.reply_instruction);
    }

    const summary = RunSummarySchema.parse({
      at: Date.now(),
      ok: true,
      reason: '',
      request_id: requestId,
      chat_id: commitResult.chat_id,
      flow_count: enabledFlows.length,
      elapsed_ms: Date.now() - startedAt,
      mode: input.mode,
      diagnostics: mergedPlan.diagnostics,
    });
    setLastRun(summary);

    return { ok: true, request_id: requestId, diagnostics: mergedPlan.diagnostics };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof DispatchFlowsError) {
      attempts = error.attempts;
      saveIoSummary(requestId, currentChatId, input.mode, attempts);
    } else if (attempts.length === 0) {
      saveIoSummary(requestId, currentChatId, input.mode, []);
    }

    const summary = RunSummarySchema.parse({
      at: Date.now(),
      ok: false,
      reason,
      request_id: requestId,
      chat_id: currentChatId,
      flow_count: settings.flows.filter(flow => flow.enabled).length,
      elapsed_ms: Date.now() - startedAt,
      mode: input.mode,
      diagnostics: {},
    });
    setLastRun(summary);

    return { ok: false, reason, request_id: requestId };
  }
}
