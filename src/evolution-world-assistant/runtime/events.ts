import { EwWorkflowNoticeInput, showManagedWorkflowNotice } from '../ui/notice';
import { getEffectiveFlows } from './char-flows';
import { disposeFloorBindingEvents, initFloorBindingEvents, rollbackBeforeFloor } from './floor-binding';
import { runIncrementalHideCheck } from './hide-engine';
import { markIntercepted, resetInterceptGuard, wasRecentlyIntercepted } from './intercept-guard';
import { runWorkflow } from './pipeline';
import { getSettings, patchSettings } from './settings';
import {
  clearAfterReplyPendingIfMatches,
  clearSendContextIfMatches,
  getRuntimeState,
  isQuietLike,
  markAfterReplyHandled,
  recordGeneration,
  recordUserSend,
  recordUserSendIntent,
  resetRuntimeState,
  setProcessing,
  shouldHandleAfterReply,
  shouldHandleGenerationAfter,
  wasAfterReplyHandled,
} from './state';
import { DispatchFlowResult, EwSettings, WorkflowFailureDiagnostic, WorkflowProgressUpdate } from './types';

const EW_FLOOR_WORKFLOW_EXECUTION_KEY = 'ew_workflow_execution';

type FloorWorkflowStoredResult = {
  flow_id: string;
  response: Record<string, any>;
};

type FloorWorkflowExecutionState = {
  at: number;
  request_id: string;
  attempted_flow_ids: string[];
  successful_results: FloorWorkflowStoredResult[];
  failed_flow_ids: string[];
  workflow_failed: boolean;
};

type FailedAfterReplyQueueJob = {
  chat_key: string;
  message_id: number;
  user_input: string;
  generation_type: string;
  failed_at: number;
};

const listenerStops: EventOnReturn[] = [];
const domCleanup: Array<() => void> = [];
let warnedEventMakeFirstFallback = false;
const HOOK_RETRY_DELAY_MS = 1200;
let sendIntentRetryTimer: ReturnType<typeof setTimeout> | null = null;
let tavernHelperRetryTimer: ReturnType<typeof setTimeout> | null = null;
const NON_SEND_GENERATION_TYPES = new Set(['continue', 'regenerate', 'swipe']);
const WORKFLOW_NOTICE_COLLAPSE_MS = 5000;
const workflowTaskQueue: Array<{
  label: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];
const queuedAfterReplyJobKeys = new Set<string>();
const failedAfterReplyJobsByChat = new Map<string, FailedAfterReplyQueueJob[]>();
let workflowTaskDrainPromise: Promise<void> | null = null;

function getHostWindow(): Window & typeof globalThis {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent;
    }
  } catch {
    // ignore cross-frame access failures and fall back to current window
  }

  return window;
}

function getChatDocument(): Document {
  const hostWindow = getHostWindow() as Record<string, any>;
  return hostWindow.SillyTavern?.Chat?.document ?? hostWindow.document ?? document;
}

function getCurrentChatKey(): string {
  try {
    return String(SillyTavern?.getCurrentChatId?.() ?? (SillyTavern as any)?.chatId ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

function clearQueuedWorkflowTasks(reason: string) {
  for (const task of workflowTaskQueue.splice(0, workflowTaskQueue.length)) {
    task.reject(new Error(reason));
  }
  queuedAfterReplyJobKeys.clear();
}

function enqueueWorkflowTask<T>(label: string, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    workflowTaskQueue.push({
      label,
      run: run as () => Promise<unknown>,
      resolve: value => resolve(value as T),
      reject,
    });

    if (!workflowTaskDrainPromise) {
      workflowTaskDrainPromise = (async () => {
        while (workflowTaskQueue.length > 0) {
          const task = workflowTaskQueue.shift();
          if (!task) {
            continue;
          }

          try {
            task.resolve(await task.run());
          } catch (error) {
            task.reject(error);
          }
        }
      })().finally(() => {
        workflowTaskDrainPromise = null;
      });
    }
  });
}

function getFailedAfterReplyJobs(chatKey: string): FailedAfterReplyQueueJob[] {
  return [...(failedAfterReplyJobsByChat.get(chatKey) ?? [])].sort((left, right) => left.failed_at - right.failed_at);
}

function upsertFailedAfterReplyJob(job: FailedAfterReplyQueueJob): void {
  const current = failedAfterReplyJobsByChat.get(job.chat_key) ?? [];
  const next = current.filter(item => item.message_id !== job.message_id);
  next.push(job);
  failedAfterReplyJobsByChat.set(
    job.chat_key,
    next.sort((left, right) => left.failed_at - right.failed_at),
  );
}

function removeFailedAfterReplyJob(chatKey: string, messageId: number): void {
  const current = failedAfterReplyJobsByChat.get(chatKey);
  if (!current?.length) {
    return;
  }

  const next = current.filter(item => item.message_id !== messageId);
  if (next.length > 0) {
    failedAfterReplyJobsByChat.set(chatKey, next);
  } else {
    failedAfterReplyJobsByChat.delete(chatKey);
  }
}

function scheduleSendIntentHooksRetry() {
  if (sendIntentRetryTimer) {
    return;
  }

  sendIntentRetryTimer = setTimeout(() => {
    sendIntentRetryTimer = null;
    installSendIntentHooks();
  }, HOOK_RETRY_DELAY_MS);
}

function scheduleTavernHelperHookRetry() {
  if (tavernHelperRetryTimer) {
    return;
  }

  tavernHelperRetryTimer = setTimeout(() => {
    tavernHelperRetryTimer = null;
    installTavernHelperHook();
  }, HOOK_RETRY_DELAY_MS);
}

function registerGenerationAfterCommands(
  handler: (type: string, params: Record<string, any>, dryRun: boolean) => Promise<void>,
): EventOnReturn {
  const runtime = globalThis as Record<string, unknown>;
  const makeFirst = runtime.eventMakeFirst;
  if (typeof makeFirst === 'function') {
    return (makeFirst as typeof eventOn)(tavern_events.GENERATION_AFTER_COMMANDS, handler);
  }

  if (!warnedEventMakeFirstFallback) {
    warnedEventMakeFirstFallback = true;
    console.warn('[Evolution World] eventMakeFirst unavailable, fallback to eventOn for GENERATION_AFTER_COMMANDS');
  }

  return eventOn(tavern_events.GENERATION_AFTER_COMMANDS, handler);
}

function getSendTextareaValue(): string {
  const textarea = getChatDocument().getElementById('send_textarea') as HTMLTextAreaElement | null;
  return String(textarea?.value ?? '');
}

function firstNonEmptyText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '');
    if (text.trim()) {
      return text;
    }
  }

  return '';
}

function getLatestUserMessageText(): string {
  try {
    const msgs = getChatMessages(`0-${getLastMessageId()}`, { hide_state: 'unhidden' });
    const lastUserMsg = [...msgs].reverse().find((message: any) => message.role === 'user');
    return String(lastUserMsg?.message ?? '');
  } catch {
    return '';
  }
}

function getInterceptedUserInput(options: Record<string, any>): string {
  const runtimeState = getRuntimeState();
  return firstNonEmptyText(
    options.user_input,
    options.prompt,
    runtimeState.last_send_intent?.user_input,
    options.injects?.[0]?.content,
  );
}

function resolveWorkflowUserInput(options: Record<string, any>, generationType: string): string {
  const interceptedInput = getInterceptedUserInput(options);
  if (interceptedInput) {
    return interceptedInput;
  }

  if (NON_SEND_GENERATION_TYPES.has(generationType)) {
    return getLatestUserMessageText();
  }

  return '';
}

function resolveFallbackWorkflowUserInput(generationType: string): string {
  const runtimeState = getRuntimeState();
  const interceptedInput = firstNonEmptyText(
    runtimeState.last_send?.user_input,
    runtimeState.last_send_intent?.user_input,
  );
  if (interceptedInput) {
    return interceptedInput;
  }

  if (NON_SEND_GENERATION_TYPES.has(generationType)) {
    return getLatestUserMessageText();
  }

  return '';
}

function resolveAfterReplyUserInput(): string {
  const runtimeState = getRuntimeState();
  return firstNonEmptyText(
    runtimeState.after_reply.pending_user_input,
    runtimeState.last_send?.user_input,
    runtimeState.last_send_intent?.user_input,
    getLatestUserMessageText(),
  );
}

function installSendIntentHooks() {
  for (const cleanup of domCleanup.splice(0, domCleanup.length)) {
    cleanup();
  }

  const doc = getChatDocument();
  const sendButton = doc.getElementById('send_but');
  if (sendButton) {
    const onSendIntent = () => {
      recordUserSendIntent(getSendTextareaValue());
    };
    sendButton.addEventListener('click', onSendIntent, true);
    sendButton.addEventListener('pointerup', onSendIntent, true);
    sendButton.addEventListener('touchend', onSendIntent, true);
    domCleanup.push(() => {
      sendButton.removeEventListener('click', onSendIntent, true);
      sendButton.removeEventListener('pointerup', onSendIntent, true);
      sendButton.removeEventListener('touchend', onSendIntent, true);
    });
  }

  const sendTextarea = doc.getElementById('send_textarea');
  if (sendTextarea) {
    const onKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if ((keyboardEvent.key === 'Enter' || keyboardEvent.key === 'NumpadEnter') && !keyboardEvent.shiftKey) {
        recordUserSendIntent(getSendTextareaValue());
      }
    };
    sendTextarea.addEventListener('keydown', onKeyDown, true);
    domCleanup.push(() => sendTextarea.removeEventListener('keydown', onKeyDown, true));
  }

  if (!sendButton || !sendTextarea) {
    scheduleSendIntentHooksRetry();
  }
}

function stopGenerationNow() {
  try {
    SillyTavern.stopGeneration?.();
  } catch {
    // ignore
  }

  try {
    stopAllGeneration();
  } catch {
    // ignore
  }
}

function formatReasonForDisplay(reason: string | undefined, maxLen = 160): string {
  const text = String(reason ?? 'unknown')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}...`;
}

function getFailureStageLabel(stage: WorkflowFailureDiagnostic['stage'] | undefined): string {
  switch (stage) {
    case 'dispatch':
      return '请求阶段';
    case 'merge':
      return '合并阶段';
    case 'commit':
      return '写回阶段';
    case 'cancelled':
      return '已取消';
    case 'config':
      return '配置阶段';
    case 'unknown':
    default:
      return '未知阶段';
  }
}

function buildFailureNoticeMessage(
  failure: WorkflowFailureDiagnostic | null | undefined,
  fallbackReason: string | undefined,
  options?: { includeReleaseHint?: boolean; retrying?: boolean },
): string {
  if (!failure) {
    return options?.retrying
      ? `首次处理失败，正在重试… ${formatReasonForDisplay(fallbackReason, 120)}`
      : `工作流失败：${formatReasonForDisplay(fallbackReason)}`;
  }

  const lines = [
    options?.retrying ? `首次处理失败，正在重试：${failure.summary}` : `工作流失败：${failure.summary}`,
    `阶段：${getFailureStageLabel(failure.stage)}`,
  ];

  if (failure.flow_name || failure.flow_id) {
    lines.push(`工作流：${failure.flow_name || failure.flow_id}`);
  }
  if (failure.api_preset_name) {
    lines.push(`接口：${failure.api_preset_name}`);
  }
  if (failure.suggestion) {
    lines.push(`建议：${failure.suggestion}`);
  }
  if (options?.includeReleaseHint) {
    lines.push('原消息是否继续发送取决于当前放行策略。');
  }

  return lines.join('\n');
}

function buildFailureToastMessage(
  failure: WorkflowFailureDiagnostic | null | undefined,
  fallbackReason: string | undefined,
): string {
  if (!failure) {
    return formatReasonForDisplay(fallbackReason);
  }

  const parts = [failure.summary, getFailureStageLabel(failure.stage)];
  if (failure.flow_name || failure.flow_id) {
    parts.push(failure.flow_name || failure.flow_id);
  }
  if (failure.suggestion) {
    parts.push(failure.suggestion);
  }
  return parts.join(' · ');
}

function buildFailureNoticeAction(failure: WorkflowFailureDiagnostic | null | undefined) {
  if (!failure) {
    return undefined;
  }

  return {
    label: '打开面板',
    kind: 'neutral' as const,
    onClick: () => {
      patchSettings({ ui_open: true });
    },
  };
}

function normalizeFloorWorkflowExecutionState(raw: unknown): FloorWorkflowExecutionState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const successfulResults = Array.isArray(obj.successful_results)
    ? obj.successful_results
        .filter(item => item && typeof item === 'object' && !Array.isArray(item))
        .map(item => {
          const result = item as Record<string, unknown>;
          return {
            flow_id: String(result.flow_id ?? '').trim(),
            response:
              result.response && typeof result.response === 'object' ? (result.response as Record<string, any>) : {},
          };
        })
        .filter(item => item.flow_id)
    : [];

  const failedFlowIds = Array.isArray(obj.failed_flow_ids)
    ? obj.failed_flow_ids.map(value => String(value ?? '').trim()).filter(Boolean)
    : [];

  const attemptedFlowIds = Array.isArray(obj.attempted_flow_ids)
    ? obj.attempted_flow_ids.map(value => String(value ?? '').trim()).filter(Boolean)
    : [];

  return {
    at: Number(obj.at ?? 0),
    request_id: String(obj.request_id ?? '').trim(),
    attempted_flow_ids: _.uniq(attemptedFlowIds),
    successful_results: successfulResults,
    failed_flow_ids: _.uniq(failedFlowIds),
    workflow_failed: Boolean(obj.workflow_failed),
  };
}

function readFloorWorkflowExecution(messageId: number): FloorWorkflowExecutionState | null {
  try {
    const message = getChatMessages(messageId)[0];
    return normalizeFloorWorkflowExecutionState(message?.data?.[EW_FLOOR_WORKFLOW_EXECUTION_KEY]);
  } catch {
    return null;
  }
}

async function writeFloorWorkflowExecution(
  messageId: number,
  state: FloorWorkflowExecutionState | null,
): Promise<void> {
  const message = getChatMessages(messageId)[0];
  if (!message) {
    return;
  }

  const nextData: Record<string, unknown> = {
    ...(message.data ?? {}),
  };

  if (state) {
    nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY] = state;
  } else {
    delete nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY];
  }

  await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
}

function buildFloorWorkflowExecutionState(
  requestId: string,
  attempts: Array<{ flow: { id: string }; ok: boolean; response?: Record<string, any> }>,
  workflowFailed: boolean,
  preservedResults: FloorWorkflowStoredResult[] = [],
): FloorWorkflowExecutionState {
  const successfulResults = new Map<string, FloorWorkflowStoredResult>(
    preservedResults.map(result => [result.flow_id, result]),
  );
  const failedFlowIds = new Set<string>();
  const attemptedFlowIds = new Set<string>();

  for (const attempt of attempts) {
    const flowId = String(attempt.flow.id ?? '').trim();
    if (!flowId) {
      continue;
    }

    attemptedFlowIds.add(flowId);

    if (attempt.ok && attempt.response) {
      successfulResults.set(flowId, {
        flow_id: flowId,
        response: klona(attempt.response),
      });
      failedFlowIds.delete(flowId);
    } else {
      successfulResults.delete(flowId);
      failedFlowIds.add(flowId);
    }
  }

  return {
    at: Date.now(),
    request_id: requestId,
    attempted_flow_ids: [...attemptedFlowIds],
    successful_results: [...successfulResults.values()],
    failed_flow_ids: [...failedFlowIds],
    workflow_failed: workflowFailed,
  };
}

type FailedOnlyRerollResolution =
  | {
      ok: true;
      flowIds: string[];
      preservedResults: FloorWorkflowStoredResult[];
      fallbackToAll?: boolean;
    }
  | {
      ok: false;
      reason: string;
    };

async function resolveFailedOnlyRerollTarget(
  settings: EwSettings,
  messageId: number,
): Promise<FailedOnlyRerollResolution> {
  const executionState = readFloorWorkflowExecution(messageId);
  if (!executionState) {
    return { ok: false, reason: '当前楼还没有可用的失败执行记录' };
  }

  if (executionState.failed_flow_ids.length === 0) {
    if (executionState.workflow_failed && executionState.attempted_flow_ids.length > 0) {
      const effectiveFlows = await getEffectiveFlows(settings);
      const flowMap = new Map(effectiveFlows.map(flow => [flow.id, flow]));
      const flowIds = executionState.attempted_flow_ids.filter(flowId => flowMap.has(flowId));

      if (flowIds.length === 0) {
        return { ok: false, reason: '当前楼失败时涉及的工作流已被禁用或删除' };
      }

      return {
        ok: true,
        flowIds,
        preservedResults: [],
        fallbackToAll: true,
      };
    }

    return { ok: false, reason: '当前楼没有失败的工作流可供重跑' };
  }

  const effectiveFlows = await getEffectiveFlows(settings);
  const flowMap = new Map(effectiveFlows.map(flow => [flow.id, flow]));
  const flowIds = executionState.failed_flow_ids.filter(flowId => flowMap.has(flowId));
  if (flowIds.length === 0) {
    return { ok: false, reason: '当前楼记录中的失败工作流已被禁用或删除' };
  }

  return {
    ok: true,
    flowIds,
    preservedResults: executionState.successful_results.filter(result => {
      return flowMap.has(result.flow_id) && !flowIds.includes(result.flow_id);
    }),
  };
}

function syncAfterReplyFailureQueue(
  options: ExecuteWorkflowOptions,
  executionState: FloorWorkflowExecutionState | null,
  workflowSucceeded: boolean,
): void {
  if (options.trigger.timing !== 'after_reply') {
    return;
  }

  const chatKey = getCurrentChatKey();
  const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
  if (
    workflowSucceeded ||
    !executionState ||
    (!executionState.workflow_failed && executionState.failed_flow_ids.length === 0)
  ) {
    removeFailedAfterReplyJob(chatKey, assistantMessageId);
    return;
  }

  upsertFailedAfterReplyJob({
    chat_key: chatKey,
    message_id: assistantMessageId,
    user_input: String(options.userInput ?? ''),
    generation_type: options.trigger.generation_type,
    failed_at: executionState.at || Date.now(),
  });
}

async function buildPreservedDispatchResults(
  settings: EwSettings,
  preservedResults: FloorWorkflowStoredResult[],
): Promise<DispatchFlowResult[]> {
  if (preservedResults.length === 0) {
    return [];
  }

  const effectiveFlows = await getEffectiveFlows(settings);
  const flowOrderById = new Map(effectiveFlows.map((flow, index) => [flow.id, index]));
  const flowById = new Map(effectiveFlows.map(flow => [flow.id, flow]));

  return preservedResults
    .map(result => {
      const flow = flowById.get(result.flow_id);
      if (!flow) {
        return null;
      }

      return {
        flow,
        flow_order: flowOrderById.get(result.flow_id) ?? 0,
        response: result.response as any,
      } satisfies DispatchFlowResult;
    })
    .filter((result): result is DispatchFlowResult => Boolean(result));
}

function createProcessingReminder(onAbort: () => void) {
  let state: EwWorkflowNoticeInput = {
    title: 'Evolution World',
    message: '正在读取上下文并处理本轮工作流，请稍后…',
    level: 'info',
    persist: true,
    busy: true,
    collapse_after_ms: WORKFLOW_NOTICE_COLLAPSE_MS,
    island: {},
    action: {
      label: '终止处理',
      kind: 'danger',
      onClick: onAbort,
    },
  };

  const handle = showManagedWorkflowNotice(state);

  const update = (next: Partial<EwWorkflowNoticeInput>) => {
    state = {
      ...state,
      ...next,
      island: {
        ...(state.island ?? {}),
        ...(next.island ?? {}),
      },
    };
    handle.update(state);
  };

  return {
    update,
    dismiss: handle.dismiss,
    collapse: handle.collapse,
    expand: handle.expand,
  };
}

type WorkflowExecutionOutcome = {
  shouldAbortGeneration: boolean;
  workflowSucceeded: boolean;
  abortedByUser: boolean;
};

type ExecuteWorkflowOptions = {
  messageId: number;
  userInput?: string;
  injectReply: boolean;
  flowIds?: string[];
  timingFilter?: 'before_reply' | 'after_reply';
  preservedResults?: FloorWorkflowStoredResult[];
  trigger: {
    timing: 'before_reply' | 'after_reply' | 'manual';
    source: string;
    generation_type: string;
    user_message_id?: number;
    assistant_message_id?: number;
  };
  reminderMessage: string;
  successMessage: string;
};

function setSendTextareaValue(text: string): void {
  const textarea = getChatDocument().getElementById('send_textarea') as HTMLTextAreaElement | null;
  if (!textarea) {
    return;
  }

  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function restoreOriginalGenerateInput(options: Record<string, any>, userInput: string): void {
  if (Array.isArray(options.injects) && options.injects[0] && typeof options.injects[0] === 'object') {
    options.injects[0].content = userInput;
    return;
  }

  if (typeof options.prompt === 'string') {
    options.prompt = userInput;
    return;
  }

  options.user_input = userInput;
}

function shouldReleaseInterceptedMessage(settings: EwSettings, outcome: WorkflowExecutionOutcome): boolean {
  if (outcome.abortedByUser) {
    return false;
  }

  const policy = settings.intercept_release_policy ?? 'success_only';
  if (policy === 'never') {
    return false;
  }
  if (policy === 'always') {
    return true;
  }

  return outcome.workflowSucceeded;
}

// ---------------------------------------------------------------------------
// Per-flow timing gate (fast sync check).
// Returns true if there are potentially matching flows for the given timing.
// This only checks global flows as a fast-path; char-flows are filtered by
// the pipeline's timing_filter after getEffectiveFlows().
// ---------------------------------------------------------------------------

function hasFlowsForTiming(settings: EwSettings, timing: 'before_reply' | 'after_reply'): boolean {
  // Fast path: any global flow explicitly or effectively matches
  const globalMatch = settings.flows.some(f => {
    if (!f.enabled) return false;
    const effective = f.timing === 'default' ? settings.workflow_timing : f.timing;
    return effective === timing;
  });
  if (globalMatch) return true;
  // Fallback: if the global default equals the requested timing,
  // char-flows with timing:'default' would resolve to it — proceed
  // and let the pipeline's timing_filter do the authoritative check.
  return settings.workflow_timing === timing;
}

// ---------------------------------------------------------------------------
// Shared workflow execution with failure-policy handling.
// Both the TavernHelper hook and GENERATION_AFTER_COMMANDS fallback call this.
// ---------------------------------------------------------------------------

async function executeWorkflowWithPolicy(
  settings: EwSettings,
  options: ExecuteWorkflowOptions,
): Promise<WorkflowExecutionOutcome> {
  // Returns the workflow outcome so the primary interception path can decide
  // whether the original user message should be released after EW processing.
  // Apply incremental hide check before workflow so AI context is up-to-date
  try {
    runIncrementalHideCheck(settings.hide_settings);
  } catch (e) {
    console.warn('[Evolution World] Hide check failed:', e);
  }

  const workflowAbortController = new AbortController();
  let abortedByUser = false;

  const buildAbortableReminder = (message: string, level: 'info' | 'warning' = 'info') => ({
    title: 'Evolution World',
    message,
    level,
    persist: true,
    busy: true,
    action: {
      label: '终止处理',
      kind: 'danger' as const,
      onClick: cancelWorkflow,
    },
  });

  const cancelWorkflow = () => {
    if (abortedByUser) {
      return;
    }
    abortedByUser = true;
    workflowAbortController.abort();
    stopGenerationNow();
    processingReminder.update({
      title: 'Evolution World',
      message: '正在终止本轮处理，请稍后…',
      level: 'warning',
      persist: true,
      busy: true,
      action: undefined,
    });
  };

  const processingReminder = createProcessingReminder(cancelWorkflow);
  processingReminder.update(buildAbortableReminder(options.reminderMessage));
  let reminderSettled = false;
  let currentPreservedStoredResults = [...(options.preservedResults ?? [])];
  let currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);
  let lastAfterReplyExecutionState: FloorWorkflowExecutionState | null = null;

  const trimPreview = (text: string | undefined, maxLength: number) => {
    const normalized = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength)}...`;
  };

  // D: multi-flow tracking
  type FlowIslandData = { flow_id: string; entry_name?: string; content?: string; flow_order: number };
  const activeFlows = new Map<string, FlowIslandData>();
  let carouselIndex = 0;
  let carouselTimer: ReturnType<typeof setInterval> | null = null;
  let totalFlowCount = 0;
  let completedFlowCount = 0;

  const getRotatedIsland = (): { entry_name?: string; content?: string; extra_count: number } => {
    const flows = [...activeFlows.values()].sort((a, b) => a.flow_order - b.flow_order);
    if (flows.length === 0) {
      return { extra_count: 0 };
    }
    const idx = carouselIndex % flows.length;
    const current = flows[idx];
    return {
      entry_name: current.entry_name,
      content: current.content,
      extra_count: Math.max(0, flows.length - 1),
    };
  };

  const startCarousel = () => {
    if (carouselTimer) return;
    carouselTimer = setInterval(() => {
      if (activeFlows.size > 1) {
        carouselIndex++;
        processingReminder.update({
          island: getRotatedIsland(),
        });
      }
    }, 3000);
  };

  const stopCarousel = () => {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  };

  const handleWorkflowProgress = (update: WorkflowProgressUpdate) => {
    if (reminderSettled) {
      return;
    }

    switch (update.phase) {
      case 'preparing':
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          level: 'info',
          persist: true,
          busy: true,
        });
        break;
      case 'dispatching':
        // extract total flow count from message (e.g. "已装载 3 条工作流")
        {
          const match = update.message?.match(/装载\s*(\d+)\s*条/);
          if (match) {
            totalFlowCount = parseInt(match[1], 10);
          }
        }
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          level: 'info',
          persist: true,
          busy: true,
          flow_progress: totalFlowCount > 0 ? { completed: completedFlowCount, total: totalFlowCount } : undefined,
        });
        break;
      case 'merging':
      case 'committing':
        // All flows complete — clear active flows
        completedFlowCount = activeFlows.size;
        activeFlows.clear();
        stopCarousel();
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          level: 'info',
          persist: true,
          busy: true,
          island: { extra_count: 0 },
          flow_progress: totalFlowCount > 0 ? { completed: completedFlowCount, total: totalFlowCount } : undefined,
        });
        break;
      case 'flow_started': {
        const flowId = update.flow_id ?? '';
        if (flowId) {
          activeFlows.set(flowId, {
            flow_id: flowId,
            entry_name: update.flow_name?.trim() || undefined,
            content: undefined,
            flow_order: update.flow_order ?? 0,
          });
          if (activeFlows.size > 1) {
            startCarousel();
          }
        }
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          persist: true,
          busy: true,
          level: 'info',
          island: getRotatedIsland(),
          workflow_name: update.flow_name?.trim() || undefined,
          flow_progress: totalFlowCount > 0 ? { completed: completedFlowCount, total: totalFlowCount } : undefined,
        });
        break;
      }
      case 'streaming': {
        const flowId = update.flow_id ?? '';
        const previewName = trimPreview(update.stream_preview?.entry_name, 28);
        const previewContent = trimPreview(update.stream_preview?.content, 54);

        // Update the active flow's data
        if (flowId && activeFlows.has(flowId)) {
          const flow = activeFlows.get(flowId)!;
          flow.entry_name = previewName || flow.entry_name;
          flow.content = previewContent || flow.content;
        }

        processingReminder.update({
          message: update.flow_name?.trim() ? `正在流式读取「${update.flow_name}」输出…` : '正在流式读取工作流输出…',
          persist: true,
          busy: true,
          level: 'info',
          island: getRotatedIsland(),
          workflow_name: update.flow_name?.trim() || undefined,
          flow_progress: totalFlowCount > 0 ? { completed: completedFlowCount, total: totalFlowCount } : undefined,
        });
        break;
      }
      case 'completed':
      case 'failed':
      default:
        break;
    }
  };

  const finalizeUserAbort = () => {
    reminderSettled = true;
    stopCarousel();
    processingReminder.update({
      title: 'Evolution World',
      message: '已终止本轮处理。',
      level: 'warning',
      persist: false,
      busy: false,
      action: undefined,
      island: {
        entry_name: '',
        content: '',
        extra_count: 0,
      },
      collapse_after_ms: 0,
      duration_ms: 3500,
    });
    return {
      shouldAbortGeneration: true,
      workflowSucceeded: false,
      abortedByUser: true,
    } satisfies WorkflowExecutionOutcome;
  };

  let result;
  try {
    result = await runWorkflow({
      message_id: options.messageId,
      user_input: options.userInput,
      trigger: options.trigger,
      mode: 'auto',
      inject_reply: options.injectReply,
      flow_ids: options.flowIds,
      timing_filter: options.timingFilter,
      preserved_results: currentPreservedDispatchResults,
      abortSignal: workflowAbortController.signal,
      isCancelled: () => abortedByUser,
      onProgress: handleWorkflowProgress,
    });
  } catch (error) {
    if (abortedByUser) {
      return finalizeUserAbort();
    }
    processingReminder.dismiss();
    throw error;
  }

  if (abortedByUser) {
    return finalizeUserAbort();
  }

  if (options.trigger.timing === 'after_reply') {
    const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
    const executionState = buildFloorWorkflowExecutionState(
      result.request_id,
      result.attempts,
      !result.ok,
      currentPreservedStoredResults,
    );
    await writeFloorWorkflowExecution(assistantMessageId, executionState);
    lastAfterReplyExecutionState = executionState;
    currentPreservedStoredResults = executionState.successful_results;
    currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);
  }

  if (!result.ok) {
    const policy = settings.failure_policy ?? 'stop_generation';

    if (policy === 'retry_once') {
      console.warn('[EW] retry_once: first attempt failed — retrying.');
      const retryMessage = buildFailureNoticeMessage(result.failure, result.reason, { retrying: true });
      processingReminder.update(buildAbortableReminder(retryMessage, 'warning'));
      toastr.warning(buildFailureToastMessage(result.failure, result.reason), 'Evolution World');
      try {
        result = await runWorkflow({
          message_id: options.messageId,
          user_input: options.userInput,
          trigger: options.trigger,
          mode: 'auto',
          inject_reply: options.injectReply,
          flow_ids: options.flowIds,
          timing_filter: options.timingFilter,
          preserved_results: currentPreservedDispatchResults,
          abortSignal: workflowAbortController.signal,
          isCancelled: () => abortedByUser,
          onProgress: handleWorkflowProgress,
        });
      } catch (error) {
        if (abortedByUser) {
          return finalizeUserAbort();
        }
        processingReminder.dismiss();
        throw error;
      }

      if (abortedByUser) {
        return finalizeUserAbort();
      }

      if (options.trigger.timing === 'after_reply') {
        const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
        const executionState = buildFloorWorkflowExecutionState(
          result.request_id,
          result.attempts,
          !result.ok,
          currentPreservedStoredResults,
        );
        await writeFloorWorkflowExecution(assistantMessageId, executionState);
        lastAfterReplyExecutionState = executionState;
        currentPreservedStoredResults = executionState.successful_results;
        currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);
      }
    }

    if (!result.ok) {
      const displayReason = buildFailureNoticeMessage(result.failure, result.reason);
      const toastReason = buildFailureToastMessage(result.failure, result.reason);
      const noticeAction = buildFailureNoticeAction(result.failure);
      switch (policy) {
        case 'continue_generation':
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: 'Evolution World',
            message: buildFailureNoticeMessage(result.failure, result.reason, { includeReleaseHint: true }),
            level: 'warning',
            persist: false,
            busy: false,
            action: noticeAction,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          toastr.warning(`工作流失败，原消息是否继续发送取决于放行策略: ${toastReason}`, 'Evolution World');
          break;
        case 'allow_partial_success':
        case 'notify_only':
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: 'Evolution World',
            message: displayReason,
            level: 'warning',
            persist: false,
            busy: false,
            action: noticeAction,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          toastr.info(`工作流失败: ${toastReason}`, 'Evolution World');
          break;
        case 'stop_generation':
        case 'retry_once':
        default:
          syncAfterReplyFailureQueue(options, lastAfterReplyExecutionState, false);
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: 'Evolution World',
            message: displayReason,
            level: 'error',
            persist: false,
            busy: false,
            action: noticeAction,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          stopGenerationNow();
          toastr.error(`动态世界流程失败，本轮已中止: ${toastReason}`, 'Evolution World');
          return {
            shouldAbortGeneration: true,
            workflowSucceeded: false,
            abortedByUser: false,
          };
      }

      syncAfterReplyFailureQueue(options, lastAfterReplyExecutionState, false);

      return {
        shouldAbortGeneration: false,
        workflowSucceeded: false,
        abortedByUser: false,
      };
    }
  }

  syncAfterReplyFailureQueue(options, lastAfterReplyExecutionState, true);
  reminderSettled = true;
  stopCarousel();
  processingReminder.update({
    title: 'Evolution World',
    message: options.successMessage,
    level: 'success',
    persist: false,
    busy: false,
    action: undefined,
    collapse_after_ms: 0,
    duration_ms: 4000,
  });
  return {
    shouldAbortGeneration: false,
    workflowSucceeded: true,
    abortedByUser: false,
  };
}

// ---------------------------------------------------------------------------
// Primary path: TavernHelper.generate monkey-patch
// ---------------------------------------------------------------------------

function installTavernHelperHook() {
  const win = getHostWindow() as Record<string, any>;

  // Already installed or TavernHelper not available
  if (win._ew_originalGenerate) return;
  if (!win.TavernHelper || typeof win.TavernHelper.generate !== 'function') {
    console.debug('[Evolution World] TavernHelper.generate not available, skipping hook installation');
    scheduleTavernHelperHookRetry();
    return;
  }

  win._ew_originalGenerate = win.TavernHelper.generate;

  win.TavernHelper.generate = async function (this: unknown, ...args: any[]) {
    const options = (args[0] || {}) as Record<string, any>;

    // Pass through: quiet / automatic_trigger / streaming
    if (isQuietLike('tavernhelper', { quiet_prompt: options.quiet_prompt }) || options.automatic_trigger) {
      return win._ew_originalGenerate.apply(this, args);
    }

    const settings = getSettings();
    if (!settings.enabled || !hasFlowsForTiming(settings, 'before_reply')) {
      return win._ew_originalGenerate.apply(this, args);
    }

    // M-2: 与 GENERATION_AFTER_COMMANDS 路径保持一致的类型过滤
    const genType = options.type ?? getRuntimeState().last_generation?.type ?? 'normal';
    const allowedTypes = new Set(['normal', 'continue', 'regenerate', 'swipe']);
    if (!allowedTypes.has(genType)) {
      return win._ew_originalGenerate.apply(this, args);
    }

    const userInput = resolveWorkflowUserInput(options, genType);

    if (!userInput.trim()) {
      return win._ew_originalGenerate.apply(this, args);
    }

    // Mark for deduplication before running workflow
    markIntercepted(userInput);

    const messageId = getRuntimeState().last_send?.message_id ?? getLastMessageId();

    let workflowOutcome: WorkflowExecutionOutcome = {
      shouldAbortGeneration: false,
      workflowSucceeded: false,
      abortedByUser: false,
    };
    try {
      workflowOutcome = await enqueueWorkflowTask(`before_reply:tavernhelper:${messageId}`, async () => {
        setProcessing(true);
        try {
          return await executeWorkflowWithPolicy(settings, {
            messageId,
            userInput,
            injectReply: true,
            timingFilter: 'before_reply',
            trigger: {
              timing: 'before_reply',
              source: 'tavernhelper',
              generation_type: genType,
              user_message_id: messageId,
            },
            reminderMessage: '正在读取上下文并处理本轮工作流，请稍后…',
            successMessage: '动态世界流程处理完成，已更新本轮上下文。',
          });
        } finally {
          clearSendContextIfMatches(messageId, userInput);
          setProcessing(false);
        }
      });
    } catch (e) {
      console.error('[Evolution World] Error in TavernHelper.generate hook:', e);
    }

    // If workflow failed with stop_generation policy, do NOT call original generate
    if (workflowOutcome.shouldAbortGeneration) {
      console.debug('[Evolution World] TavernHelper.generate aborted due to workflow failure (stop_generation)');
      return;
    }

    if (!shouldReleaseInterceptedMessage(settings, workflowOutcome)) {
      setSendTextareaValue(userInput);
      console.debug('[Evolution World] Original intercepted message was not released due to intercept_release_policy');
      return '';
    }

    restoreOriginalGenerateInput(options, userInput);
    setSendTextareaValue(userInput);
    recordUserSendIntent(userInput);

    // Flag for GENERATION_AFTER_COMMANDS dedup
    options._ew_processed = true;

    // Call original generate WITHOUT modifying prompt
    return win._ew_originalGenerate.apply(this, args);
  };

  console.debug('[Evolution World] TavernHelper.generate hook installed (primary path)');
}

function uninstallTavernHelperHook() {
  const win = getHostWindow() as Record<string, any>;
  if (win._ew_originalGenerate && win.TavernHelper) {
    win.TavernHelper.generate = win._ew_originalGenerate;
    delete win._ew_originalGenerate;
    console.debug('[Evolution World] TavernHelper.generate hook uninstalled');
  }
}

// ---------------------------------------------------------------------------
// Fallback path: GENERATION_AFTER_COMMANDS event
// ---------------------------------------------------------------------------

async function onGenerationAfterCommands(
  type: string,
  params: {
    automatic_trigger?: boolean;
    quiet_prompt?: string;
    _ew_processed?: boolean;
    [key: string]: any;
  },
  dryRun: boolean,
) {
  // Dedup check 1: already handled by TavernHelper hook
  if (params?._ew_processed) {
    console.debug('[Evolution World] GENERATION_AFTER_COMMANDS skipped: already processed by TavernHelper hook');
    return;
  }

  const settings = getSettings();
  if (!hasFlowsForTiming(settings, 'before_reply')) {
    return;
  }
  const decision = shouldHandleGenerationAfter(type, params, dryRun, settings);
  if (!decision.ok) {
    return;
  }

  const messageId = getRuntimeState().last_send?.message_id ?? getLastMessageId();
  const genType = getRuntimeState().last_generation?.type ?? '';
  const userInput = resolveFallbackWorkflowUserInput(genType);
  const isNonSendType = NON_SEND_GENERATION_TYPES.has(genType);

  // Only block on empty input for normal send — continue/regen/swipe can proceed without it
  if (!userInput.trim() && !isNonSendType) {
    console.debug('[Evolution World] skipped workflow: user input is empty');
    return;
  }

  // Dedup check 2: hash-based guard against recent TavernHelper interception
  if (wasRecentlyIntercepted(userInput)) {
    console.debug(
      '[Evolution World] GENERATION_AFTER_COMMANDS skipped: recently intercepted by TavernHelper hook (hash match)',
    );
    return;
  }

  console.debug('[Evolution World] GENERATION_AFTER_COMMANDS executing workflow (fallback path)');
  try {
    await enqueueWorkflowTask(`before_reply:fallback:${messageId}`, async () => {
      setProcessing(true);
      try {
        // Return value (shouldAbort) is only relevant for the primary path;
        // in the fallback path, stopGenerationNow() inside executeWorkflowWithPolicy
        // handles abort directly since generation is already in progress.
        await executeWorkflowWithPolicy(settings, {
          messageId,
          userInput,
          injectReply: true,
          timingFilter: 'before_reply',
          trigger: {
            timing: 'before_reply',
            source: 'generation_after_commands',
            generation_type: genType || type,
            user_message_id: getRuntimeState().last_send?.message_id ?? messageId,
          },
          reminderMessage: '正在读取上下文并处理本轮工作流，请稍后…',
          successMessage: '动态世界流程处理完成，已更新本轮上下文。',
        });
      } finally {
        clearSendContextIfMatches(messageId, userInput);
        setProcessing(false);
      }
    });
  } finally {
  }
}

function getMessageText(messageId: number): string {
  try {
    const message = getChatMessages(messageId)[0];
    return String(message?.message ?? '');
  } catch {
    return '';
  }
}

function isAssistantMessage(messageId: number): boolean {
  try {
    const message = getChatMessages(messageId)[0];
    return message?.role === 'assistant';
  } catch {
    return false;
  }
}

async function onAfterReplyMessage(messageId: number, type: string, source: 'message_received' | 'generation_ended') {
  const settings = getSettings();
  if (!hasFlowsForTiming(settings, 'after_reply')) {
    return;
  }

  const decision = shouldHandleAfterReply(messageId, type, settings);
  if (!decision.ok) {
    return;
  }

  if (!isAssistantMessage(messageId)) {
    return;
  }

  const messageText = getMessageText(messageId);
  if (!messageText.trim() || wasAfterReplyHandled(messageId, messageText)) {
    return;
  }

  const runtimeState = getRuntimeState();
  const generationType = runtimeState.after_reply.pending_generation_type || runtimeState.last_generation?.type || type;
  const userInput = resolveAfterReplyUserInput();
  const pendingUserMessageId =
    runtimeState.after_reply.pending_user_message_id ?? runtimeState.last_send?.message_id ?? null;
  const queueKey = `${getCurrentChatKey()}:${messageId}`;

  if (queuedAfterReplyJobKeys.has(queueKey)) {
    return;
  }

  queuedAfterReplyJobKeys.add(queueKey);
  await enqueueWorkflowTask(`after_reply:${messageId}`, async () => {
    setProcessing(true);
    try {
      await executeWorkflowWithPolicy(settings, {
        messageId,
        userInput,
        injectReply: false,
        timingFilter: 'after_reply',
        trigger: {
          timing: 'after_reply',
          source,
          generation_type: generationType,
          user_message_id: pendingUserMessageId,
          assistant_message_id: messageId,
        },
        reminderMessage: '正在根据最新回复更新动态世界，请稍后…',
        successMessage: '动态世界已根据最新回复完成更新。',
      });
      markAfterReplyHandled(messageId, messageText);
    } finally {
      clearAfterReplyPendingIfMatches(pendingUserMessageId);
      clearSendContextIfMatches(pendingUserMessageId, userInput);
      queuedAfterReplyJobKeys.delete(queueKey);
      setProcessing(false);
    }
  });
}

async function rerollQueuedFailedAfterReplyWorkflows(settings: EwSettings): Promise<{ ok: boolean; reason?: string }> {
  const chatKey = getCurrentChatKey();
  const jobs = getFailedAfterReplyJobs(chatKey);
  if (jobs.length === 0) {
    return { ok: false, reason: '当前聊天没有失败队列可供重跑' };
  }

  try {
    const outcome = await enqueueWorkflowTask(`reroll_failed_queue:${chatKey}`, async () => {
      setProcessing(true);
      try {
        let retriedCount = 0;
        let successCount = 0;
        let failedCount = 0;
        let skippedCount = 0;

        for (let index = 0; index < jobs.length; index += 1) {
          const job = jobs[index];
          const resolved = await resolveFailedOnlyRerollTarget(settings, job.message_id);
          if (!resolved.ok) {
            removeFailedAfterReplyJob(chatKey, job.message_id);
            skippedCount += 1;
            continue;
          }

          retriedCount += 1;
          if (settings.floor_binding_enabled) {
            await rollbackBeforeFloor(settings, job.message_id);
          }

          const outcome = await executeWorkflowWithPolicy(settings, {
            messageId: job.message_id,
            userInput: job.user_input,
            injectReply: false,
            flowIds: resolved.flowIds,
            timingFilter: 'after_reply',
            preservedResults: resolved.preservedResults,
            trigger: {
              timing: 'after_reply',
              source: 'queued_failed_reroll',
              generation_type: job.generation_type,
              assistant_message_id: job.message_id,
            },
            reminderMessage: `正在重跑失败队列 ${index + 1}/${jobs.length}，请稍后…`,
            successMessage: `失败队列 ${index + 1}/${jobs.length} 已处理完成。`,
          });

          if (outcome.abortedByUser) {
            return {
              ok: false,
              reason: `已终止失败队列重跑，已完成 ${successCount}/${retriedCount} 条。`,
            };
          }

          if (outcome.workflowSucceeded) {
            const messageText = getMessageText(job.message_id);
            if (messageText.trim()) {
              markAfterReplyHandled(job.message_id, messageText);
            }
            successCount += 1;
          } else {
            failedCount += 1;
          }
        }

        if (retriedCount === 0) {
          return { ok: false, reason: '失败队列中的楼层记录已失效，已自动清理。' };
        }

        if (failedCount > 0) {
          return {
            ok: false,
            reason: `失败队列已重跑 ${retriedCount} 条，其中 ${successCount} 条成功，${failedCount} 条仍失败${skippedCount > 0 ? `，${skippedCount} 条已跳过` : ''}。`,
          };
        }

        return {
          ok: true,
          reason:
            skippedCount > 0
              ? `失败队列已重跑完成，共成功 ${successCount} 条，另有 ${skippedCount} 条失效记录已跳过。`
              : `失败队列已重跑完成，共成功 ${successCount} 条。`,
        };
      } finally {
        setProcessing(false);
      }
    });

    return outcome;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function rerollCurrentAfterReplyWorkflow(): Promise<{ ok: boolean; reason?: string }> {
  const settings = getSettings();
  if (!hasFlowsForTiming(settings, 'after_reply')) {
    return { ok: false, reason: 'no flows configured for after_reply timing' };
  }
  if (!settings.enabled) {
    return { ok: false, reason: 'workflow disabled' };
  }
  const messageId = getLastMessageId();
  if (!Number.isFinite(messageId) || messageId < 0) {
    return { ok: false, reason: 'no current floor found' };
  }
  if (!isAssistantMessage(messageId)) {
    return { ok: false, reason: 'current floor is not an assistant reply' };
  }

  const messageText = getMessageText(messageId);
  if (!messageText.trim()) {
    return { ok: false, reason: 'current assistant reply is empty' };
  }

  const runtimeState = getRuntimeState();
  const generationType = runtimeState.last_generation?.type || 'manual';
  const userInput = resolveAfterReplyUserInput();
  const rerollScope = settings.reroll_scope ?? 'all';

  if (rerollScope === 'queued_failed') {
    return rerollQueuedFailedAfterReplyWorkflows(settings);
  }

  let flowIds: string[] | undefined;
  let preservedResults: FloorWorkflowStoredResult[] = [];
  let failedOnlyFallbackToAll = false;

  if (rerollScope === 'failed_only') {
    const resolved = await resolveFailedOnlyRerollTarget(settings, messageId);
    if (!resolved.ok) {
      return { ok: false, reason: resolved.reason };
    }

    flowIds = resolved.flowIds;
    preservedResults = resolved.preservedResults;
    failedOnlyFallbackToAll = Boolean(resolved.fallbackToAll);
  }

  try {
    const outcome = await enqueueWorkflowTask(`reroll_after_reply:${messageId}`, async () => {
      setProcessing(true);
      try {
        if (settings.floor_binding_enabled) {
          await rollbackBeforeFloor(settings, messageId);
        }

        return await executeWorkflowWithPolicy(settings, {
          messageId,
          userInput,
          injectReply: false,
          flowIds,
          timingFilter: 'after_reply',
          preservedResults,
          trigger: {
            timing: 'after_reply',
            source: 'fab_double_click',
            generation_type: generationType,
            user_message_id: runtimeState.after_reply.pending_user_message_id ?? runtimeState.last_send?.message_id,
            assistant_message_id: messageId,
          },
          reminderMessage:
            rerollScope === 'failed_only' && flowIds?.length
              ? failedOnlyFallbackToAll
                ? `当前楼上次失败发生在合并或写回阶段，正在回退重跑该楼关联的 ${flowIds.length} 条工作流，请稍后…`
                : `正在重跑当前楼失败的 ${flowIds.length} 条工作流，请稍后…`
              : '正在重跑当前楼的回复后工作流，请稍后…',
          successMessage:
            rerollScope === 'failed_only' && flowIds?.length
              ? failedOnlyFallbackToAll
                ? '当前楼因整轮失败而回退重跑的工作流已完成。'
                : '当前楼失败的工作流已重跑完成。'
              : '当前楼的动态世界工作流已重跑完成。',
        });
      } finally {
        setProcessing(false);
      }
    });

    if (outcome.workflowSucceeded) {
      markAfterReplyHandled(messageId, messageText);
      return { ok: true };
    }

    if (outcome.abortedByUser) {
      return { ok: false, reason: 'workflow cancelled by user' };
    }

    return { ok: false, reason: 'workflow failed' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
  }
}

export function initRuntimeEvents() {
  // Primary path: TavernHelper.generate hook
  installTavernHelperHook();

  installSendIntentHooks();

  listenerStops.push(
    eventOn(tavern_events.MESSAGE_SENT, messageId => {
      const msg = getChatMessages(messageId)[0];
      if (!msg || msg.role !== 'user') {
        return;
      }

      recordUserSend(messageId, msg.message ?? '');
    }),
  );

  listenerStops.push(
    eventOn(tavern_events.GENERATION_STARTED, (type, params, dryRun) => {
      recordGeneration(type, params ?? {}, dryRun);
    }),
  );

  listenerStops.push(
    eventOn(tavern_events.MESSAGE_RECEIVED, async (messageId, type) => {
      await onAfterReplyMessage(messageId, type, 'message_received');
    }),
  );

  listenerStops.push(
    eventOn(tavern_events.GENERATION_ENDED, async messageId => {
      const type = getRuntimeState().last_generation?.type ?? 'normal';
      await onAfterReplyMessage(messageId, type, 'generation_ended');
    }),
  );

  // Fallback path: GENERATION_AFTER_COMMANDS event
  listenerStops.push(
    registerGenerationAfterCommands(async (type, params, dryRun) => {
      await onGenerationAfterCommands(type, params ?? {}, dryRun);
    }),
  );

  listenerStops.push(
    eventOn(tavern_events.CHAT_CHANGED, () => {
      clearQueuedWorkflowTasks('workflow queue cleared because chat changed');
      resetRuntimeState();
      resetInterceptGuard();
      setTimeout(() => {
        installSendIntentHooks();
        // Re-install TavernHelper hook in case it was overwritten during chat change
        installTavernHelperHook();
      }, 300);
    }),
  );

  // Initialize floor binding event listeners for automatic cleanup.
  initFloorBindingEvents(getSettings);
}

export function disposeRuntimeEvents() {
  for (const stopper of listenerStops.splice(0, listenerStops.length)) {
    stopper.stop();
  }
  for (const cleanup of domCleanup.splice(0, domCleanup.length)) {
    cleanup();
  }
  if (sendIntentRetryTimer) {
    clearTimeout(sendIntentRetryTimer);
    sendIntentRetryTimer = null;
  }
  if (tavernHelperRetryTimer) {
    clearTimeout(tavernHelperRetryTimer);
    tavernHelperRetryTimer = null;
  }
  uninstallTavernHelperHook();
  resetInterceptGuard();
  disposeFloorBindingEvents();
}
