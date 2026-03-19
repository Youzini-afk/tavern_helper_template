import _ from 'lodash';
import { EwWorkflowNoticeInput, showManagedWorkflowNotice } from '../ui/notice';
import { getEffectiveFlows } from './char-flows';
import {
  disposeFloorBindingEvents,
  initFloorBindingEvents,
  pinMessageSnapshotToCurrentVersion,
  rollbackBeforeFloor,
} from './floor-binding';
import { getMessageVersionInfo, simpleHash } from './helpers';
import { resetHideState, runIncrementalHideCheck, scheduleHideSettingsApply } from './hide-engine';
import { markIntercepted, resetInterceptGuard, wasRecentlyIntercepted } from './intercept-guard';
import { runWorkflow, type RunWorkflowOutput } from './pipeline';
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
import {
  DispatchFlowAttempt,
  DispatchFlowResult,
  EwSettings,
  WorkflowFailureDiagnostic,
  WorkflowProgressUpdate,
} from './types';

const EW_FLOOR_WORKFLOW_EXECUTION_KEY = 'ew_workflow_execution';

type FloorWorkflowStoredResult = {
  flow_id: string;
  response: Record<string, any>;
};

type FloorWorkflowExecutionVersionedMap = Record<string, FloorWorkflowExecutionState>;

type FloorWorkflowExecutionState = {
  at: number;
  request_id: string;
  /** 写入时 assistant 消息的 swipe_id，用于版本校验 */
  swipe_id?: number;
  /** 写入时 assistant 消息的内容哈希，检测 edit/update */
  content_hash?: string;
  attempted_flow_ids: string[];
  successful_results: FloorWorkflowStoredResult[];
  failed_flow_ids: string[];
  workflow_failed: boolean;
  execution_status: 'executed' | 'skipped';
  skip_reason?: string;
};

function buildExecutionVersionKey(state: { swipe_id?: number; content_hash?: string }): string {
  return `sw:${Math.max(0, Math.trunc(Number(state.swipe_id ?? 0) || 0))}|${String(state.content_hash ?? '').trim()}`;
}

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
const queuedAfterReplyDedupKeys = new Set<string>();
const failedAfterReplyJobsByChat = new Map<string, FailedAfterReplyQueueJob[]>();
let workflowTaskDrainPromise: Promise<void> | null = null;
/** Time-windowed dedup: prevents onAfterReplyMessage re-triggering within MIN_AFTER_REPLY_INTERVAL_MS */
const lastAfterReplyTriggerByChatKey = new Map<string, number>();
const MIN_AFTER_REPLY_INTERVAL_MS = 3000;

function getHostWindow(): Window & typeof globalThis {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent as Window & typeof globalThis;
    }
  } catch {
    // ignore cross-frame access failures and fall back to current window
  }

  return window as Window & typeof globalThis;
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
  queuedAfterReplyDedupKeys.clear();
  lastAfterReplyTriggerByChatKey.clear();
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

  const executionStatus = obj.execution_status === 'skipped' ? 'skipped' : 'executed';
  const skipReason = typeof obj.skip_reason === 'string' ? String(obj.skip_reason).trim() : '';

  return {
    at: Number(obj.at ?? 0),
    request_id: String(obj.request_id ?? '').trim(),
    swipe_id: typeof obj.swipe_id === 'number' ? obj.swipe_id : undefined,
    content_hash: typeof obj.content_hash === 'string' ? obj.content_hash : undefined,
    attempted_flow_ids: _.uniq(attemptedFlowIds),
    successful_results: successfulResults,
    failed_flow_ids: _.uniq(failedFlowIds),
    workflow_failed: Boolean(obj.workflow_failed),
    execution_status: executionStatus,
    skip_reason: skipReason || undefined,
  };
}

function normalizeFloorWorkflowExecutionMap(raw: unknown): FloorWorkflowExecutionVersionedMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const obj = raw as Record<string, unknown>;
  if (
    Array.isArray(obj.attempted_flow_ids) ||
    Array.isArray(obj.failed_flow_ids) ||
    Array.isArray(obj.successful_results) ||
    typeof obj.request_id === 'string'
  ) {
    const upgraded = normalizeFloorWorkflowExecutionState(raw);
    if (!upgraded) {
      return {};
    }
    const versionInfo = {
      swipe_id: Number(upgraded.swipe_id ?? 0),
      content_hash: String(upgraded.content_hash ?? '').trim(),
    };
    return {
      [buildExecutionVersionKey(versionInfo)]: upgraded,
    };
  }

  const map: FloorWorkflowExecutionVersionedMap = {};
  for (const [key, value] of Object.entries(obj)) {
    const normalized = normalizeFloorWorkflowExecutionState(value);
    if (normalized) {
      map[key] = normalized;
    }
  }
  return map;
}

function readFloorWorkflowExecutionMap(messageId: number): FloorWorkflowExecutionVersionedMap {
  try {
    const message = getChatMessages(messageId)[0];
    return normalizeFloorWorkflowExecutionMap(message?.data?.[EW_FLOOR_WORKFLOW_EXECUTION_KEY]);
  } catch {
    return {};
  }
}

export function readFloorWorkflowExecution(messageId: number): FloorWorkflowExecutionState | null {
  const msg = getChatMessages(messageId)[0];
  if (!msg) {
    return null;
  }
  const versionInfo = getMessageVersionInfo(msg);
  const map = readFloorWorkflowExecutionMap(messageId);
  const exact = map[versionInfo.version_key];
  if (exact) {
    return exact;
  }

  const values = Object.values(map);
  if (values.length === 1) {
    const only = values[0];
    if (!only.content_hash) {
      return only;
    }
  }

  return null;
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
    const map = readFloorWorkflowExecutionMap(messageId);
    map[buildExecutionVersionKey(state)] = state;
    nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY] = map;
  } else {
    delete nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY];
  }

  await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
}

async function pinFloorWorkflowExecutionToCurrentVersion(
  messageId: number,
  state: FloorWorkflowExecutionState | null,
): Promise<boolean> {
  if (!state) {
    return false;
  }

  const message = getChatMessages(messageId)[0];
  if (!message) {
    return false;
  }

  const versionInfo = getMessageVersionInfo(message);
  const targetKey = buildExecutionVersionKey(versionInfo);
  const map = readFloorWorkflowExecutionMap(messageId);
  if (map[targetKey]) {
    return false;
  }

  map[targetKey] = {
    ...state,
    swipe_id: versionInfo.swipe_id,
    content_hash: versionInfo.content_hash,
  };

  const nextData: Record<string, unknown> = {
    ...(message.data ?? {}),
    [EW_FLOOR_WORKFLOW_EXECUTION_KEY]: map,
  };

  await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
  return true;
}

function buildFloorWorkflowExecutionState(
  requestId: string,
  attempts: Array<{ flow: { id: string }; ok: boolean; response?: Record<string, any> }>,
  workflowFailed: boolean,
  preservedResults: FloorWorkflowStoredResult[] = [],
  versionInfo?: { swipe_id?: number; content_hash?: string },
  meta?: { execution_status?: 'executed' | 'skipped'; skip_reason?: string },
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
    swipe_id: versionInfo?.swipe_id,
    content_hash: versionInfo?.content_hash,
    attempted_flow_ids: [...attemptedFlowIds],
    successful_results: [...successfulResults.values()],
    failed_flow_ids: [...failedFlowIds],
    workflow_failed: workflowFailed,
    execution_status: meta?.execution_status ?? 'executed',
    skip_reason: meta?.skip_reason?.trim() ? meta.skip_reason.trim() : undefined,
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

  // readFloorWorkflowExecution 已按当前可见版本读取；这里无需再做二次版本校验。

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

function collectSuccessfulDispatchResultsFromAttempts(attempts: DispatchFlowAttempt[]): DispatchFlowResult[] {
  return attempts
    .filter(attempt => attempt.ok && attempt.response)
    .map(attempt => ({
      flow: attempt.flow,
      flow_order: attempt.flow_order,
      response: attempt.response as any,
    }));
}

function mergePreservedDispatchResults(
  current: DispatchFlowResult[],
  next: DispatchFlowResult[],
): DispatchFlowResult[] {
  const resultByFlowId = new Map<string, DispatchFlowResult>();

  for (const item of current) {
    resultByFlowId.set(item.flow.id, item);
  }

  for (const item of next) {
    resultByFlowId.set(item.flow.id, item);
  }

  return [...resultByFlowId.values()].sort((left, right) => left.flow_order - right.flow_order);
}

function resolveAutoRerollTarget(
  result: RunWorkflowOutput,
): { ok: true; flowIds: string[] } | { ok: false; reason: string } {
  const failedFlowIds = _.uniq(
    result.attempts
      .filter(attempt => !attempt.ok)
      .map(attempt => String(attempt.flow.id ?? '').trim())
      .filter(Boolean),
  );

  if (failedFlowIds.length > 0) {
    return { ok: true, flowIds: failedFlowIds };
  }

  const stage = result.failure?.stage;
  if (stage === 'merge' || stage === 'commit') {
    return { ok: false, reason: '失败发生在合并/写回阶段；自动重roll已跳过，避免重复请求已成功的工作流。' };
  }

  return { ok: false, reason: '未定位到失败工作流；自动重roll已跳过。' };
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
  let currentFlowIds = options.flowIds ? [...options.flowIds] : undefined;

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
  let failedFlowCount = 0;

  const buildFlowProgress = () => {
    if (totalFlowCount <= 0) {
      return undefined;
    }

    return {
      completed: completedFlowCount,
      total: totalFlowCount,
      failed: failedFlowCount,
    };
  };

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
          flow_progress: buildFlowProgress(),
        });
        break;
      case 'merging':
      case 'committing':
        // All flows complete — clear active flows
        completedFlowCount = totalFlowCount > 0 ? totalFlowCount : activeFlows.size;
        activeFlows.clear();
        stopCarousel();
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          level: 'info',
          persist: true,
          busy: true,
          island: { extra_count: 0 },
          flow_progress: buildFlowProgress(),
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
          flow_progress: buildFlowProgress(),
        });
        break;
      }
      case 'flow_finished': {
        const flowId = update.flow_id ?? '';
        if (flowId) {
          activeFlows.delete(flowId);
        }

        completedFlowCount += 1;
        if (update.flow_ok === false) {
          failedFlowCount += 1;
        }

        if (activeFlows.size <= 1) {
          stopCarousel();
        }

        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          persist: true,
          busy: true,
          level: update.flow_ok === false ? 'warning' : 'info',
          island: getRotatedIsland(),
          workflow_name: update.flow_name?.trim() || undefined,
          flow_progress: buildFlowProgress(),
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
          flow_progress: buildFlowProgress(),
        });
        break;
      }
      case 'completed':
        completedFlowCount = totalFlowCount > 0 ? totalFlowCount : completedFlowCount;
        processingReminder.update({
          message: update.message ?? options.successMessage,
          persist: true,
          busy: true,
          level: 'info',
          island: { extra_count: 0 },
          flow_progress: buildFlowProgress(),
        });
        break;
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

  const runWorkflowAttempt = async () => {
    const nextResult = await runWorkflow({
      message_id: options.messageId,
      user_input: options.userInput,
      trigger: options.trigger,
      mode: 'auto',
      inject_reply: options.injectReply,
      flow_ids: currentFlowIds,
      timing_filter: options.timingFilter,
      preserved_results: currentPreservedDispatchResults,
      abortSignal: workflowAbortController.signal,
      isCancelled: () => abortedByUser,
      onProgress: handleWorkflowProgress,
    });

    currentPreservedDispatchResults = mergePreservedDispatchResults(
      currentPreservedDispatchResults,
      collectSuccessfulDispatchResultsFromAttempts(nextResult.attempts),
    );

    if (options.trigger.timing === 'after_reply') {
      const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
      const assistantMsg = getChatMessages(assistantMessageId)[0];
      const versionInfo = assistantMsg ? getMessageVersionInfo(assistantMsg) : undefined;
      const executionState = buildFloorWorkflowExecutionState(
        nextResult.request_id,
        nextResult.attempts,
        !nextResult.ok,
        currentPreservedStoredResults,
        versionInfo,
        {
          execution_status: nextResult.skipped ? 'skipped' : 'executed',
          skip_reason: nextResult.skipped ? nextResult.reason : undefined,
        },
      );
      await writeFloorWorkflowExecution(assistantMessageId, executionState);
      lastAfterReplyExecutionState = executionState;
      if (!nextResult.skipped) {
        currentPreservedStoredResults = executionState.successful_results;
        currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);
      }
    }

    return nextResult;
  };

  const waitForAutoRerollInterval = async (delayMs: number) => {
    const remainingDelayMs = Math.max(0, delayMs);
    if (remainingDelayMs <= 0) {
      return;
    }

    const deadline = Date.now() + remainingDelayMs;
    while (Date.now() < deadline) {
      if (abortedByUser || workflowAbortController.signal.aborted) {
        throw new Error('workflow cancelled by user');
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(200, deadline - Date.now())));
    }
  };

  let result;
  try {
    result = await runWorkflowAttempt();
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

  // 本轮跳过（run_every_n_floors 计数未到），静默成功不显示 UI
  if (result.skipped) {
    reminderSettled = true;
    stopCarousel();
    processingReminder.dismiss();
    return {
      shouldAbortGeneration: false,
      workflowSucceeded: true,
      abortedByUser: false,
    } satisfies WorkflowExecutionOutcome;
  }

  if (!result.ok) {
    const policy = settings.failure_policy ?? 'stop_generation';
    const autoRerollMaxAttempts = Math.max(1, Math.trunc(Number(settings.auto_reroll_max_attempts ?? 1) || 1));
    const autoRerollIntervalMs = Math.max(0, Math.round((settings.auto_reroll_interval_seconds ?? 0) * 1000));
    let autoRerollCount = 0;
    let autoRerollSkippedReason = '';

    if (policy === 'retry_once') {
      while (!result.ok && autoRerollCount < autoRerollMaxAttempts) {
        const rerollTarget = resolveAutoRerollTarget(result);
        if (!rerollTarget.ok) {
          autoRerollSkippedReason = rerollTarget.reason;
          console.warn(`[EW] auto reroll skipped: ${rerollTarget.reason}`);
          break;
        }

        currentFlowIds = rerollTarget.flowIds;
        const nextAttemptNumber = autoRerollCount + 1;
        const retryMessageBase = buildFailureNoticeMessage(result.failure, result.reason, { retrying: true });
        const intervalHint =
          autoRerollIntervalMs > 0
            ? `\n将在 ${settings.auto_reroll_interval_seconds} 秒后开始第 ${nextAttemptNumber} 次自动重roll。`
            : `\n即将开始第 ${nextAttemptNumber} 次自动重roll。`;
        console.warn(
          `[EW] auto reroll: attempt ${nextAttemptNumber}/${autoRerollMaxAttempts} after failure.`,
          result.reason,
        );
        processingReminder.update(buildAbortableReminder(`${retryMessageBase}${intervalHint}`, 'warning'));
        toastr.warning(
          `工作流失败，准备进行第 ${nextAttemptNumber}/${autoRerollMaxAttempts} 次自动重roll: ${buildFailureToastMessage(result.failure, result.reason)}`,
          'Evolution World',
        );

        try {
          await waitForAutoRerollInterval(autoRerollIntervalMs);
          result = await runWorkflowAttempt();
          autoRerollCount = nextAttemptNumber;
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
      }
    }

    if (!result.ok) {
      const exhaustedAutoRerollSuffix = (() => {
        if (policy !== 'retry_once') {
          return '';
        }
        if (autoRerollSkippedReason) {
          return `\n${autoRerollSkippedReason}`;
        }
        if (autoRerollCount > 0) {
          return `\n已自动重roll ${autoRerollCount} 次，仍未成功。`;
        }
        return '';
      })();
      const displayReason = `${buildFailureNoticeMessage(result.failure, result.reason)}${exhaustedAutoRerollSuffix}`;
      const toastReason = `${buildFailureToastMessage(result.failure, result.reason)}${
        policy === 'retry_once' && autoRerollCount > 0 ? `（已自动重roll ${autoRerollCount} 次）` : ''
      }`;
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

  if (options.trigger.timing === 'after_reply') {
    const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
    try {
      await pinMessageSnapshotToCurrentVersion(assistantMessageId);
      await pinFloorWorkflowExecutionToCurrentVersion(assistantMessageId, lastAfterReplyExecutionState);
    } catch (error) {
      console.warn('[Evolution World] Failed to pin after_reply artifacts to current visible version:', error);
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
  } catch (error) {
    console.error('[Evolution World] GENERATION_AFTER_COMMANDS workflow failed:', error);
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

function appendTriggerMessageIds(
  trigger: {
    timing: 'before_reply' | 'after_reply' | 'manual';
    source: string;
    generation_type: string;
    user_message_id?: number;
    assistant_message_id?: number;
  },
  ids: { userMessageId?: number | null; assistantMessageId?: number | null },
) {
  const userMessageId = ids.userMessageId;
  if (typeof userMessageId === 'number' && Number.isFinite(userMessageId)) {
    trigger.user_message_id = userMessageId;
  }

  const assistantMessageId = ids.assistantMessageId;
  if (typeof assistantMessageId === 'number' && Number.isFinite(assistantMessageId)) {
    trigger.assistant_message_id = assistantMessageId;
  }

  return trigger;
}

function buildAfterReplyDedupKey(messageText: string, pendingUserMessageId: number | null): string {
  const normalizedText = String(messageText ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const contentHash = simpleHash(normalizedText);
  const userMessagePart = Number.isFinite(pendingUserMessageId) ? `user:${pendingUserMessageId}` : 'user:unknown';
  return `${getCurrentChatKey()}:${userMessagePart}:${contentHash}`;
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
  const dedupKey = buildAfterReplyDedupKey(messageText, pendingUserMessageId);

  // Time-windowed dedup: if we already triggered for this chat within the interval, skip.
  // This catches cases where MESSAGE_RECEIVED and GENERATION_ENDED both fire but with
  // slightly different messageId values or when the key-based dedup keys have been cleaned up.
  const chatKey = getCurrentChatKey();
  const lastTriggerAt = lastAfterReplyTriggerByChatKey.get(chatKey) ?? 0;
  if (Date.now() - lastTriggerAt < MIN_AFTER_REPLY_INTERVAL_MS) {
    console.debug(
      `[Evolution World] after_reply skipped: time-windowed dedup (${source}, ${Date.now() - lastTriggerAt}ms since last)`,
    );
    return;
  }

  if (queuedAfterReplyJobKeys.has(queueKey) || queuedAfterReplyDedupKeys.has(dedupKey)) {
    console.debug(`[Evolution World] after_reply skipped as duplicate (${source}): ${dedupKey}`);
    return;
  }

  lastAfterReplyTriggerByChatKey.set(chatKey, Date.now());
  queuedAfterReplyJobKeys.add(queueKey);
  queuedAfterReplyDedupKeys.add(dedupKey);
  await enqueueWorkflowTask(`after_reply:${messageId}`, async () => {
    setProcessing(true);
    try {
      await executeWorkflowWithPolicy(settings, {
        messageId,
        userInput,
        injectReply: false,
        timingFilter: 'after_reply',
        trigger: appendTriggerMessageIds(
          {
            timing: 'after_reply',
            source,
            generation_type: generationType,
          },
          {
            userMessageId: pendingUserMessageId,
            assistantMessageId: messageId,
          },
        ),
        reminderMessage: '正在根据最新回复更新动态世界，请稍后…',
        successMessage: '动态世界已根据最新回复完成更新。',
      });
      markAfterReplyHandled(messageId, messageText);
    } finally {
      clearAfterReplyPendingIfMatches(pendingUserMessageId);
      clearSendContextIfMatches(pendingUserMessageId, userInput);
      queuedAfterReplyJobKeys.delete(queueKey);
      queuedAfterReplyDedupKeys.delete(dedupKey);
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
          trigger: appendTriggerMessageIds(
            {
              timing: 'after_reply',
              source: 'fab_double_click',
              generation_type: generationType,
            },
            {
              userMessageId: runtimeState.after_reply.pending_user_message_id ?? runtimeState.last_send?.message_id,
              assistantMessageId: messageId,
            },
          ),
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
      scheduleHideSettingsApply(getSettings().hide_settings, 120);
      await onAfterReplyMessage(messageId, type, 'message_received');
    }),
  );

  listenerStops.push(
    eventOn(tavern_events.GENERATION_ENDED, async messageId => {
      scheduleHideSettingsApply(getSettings().hide_settings, 180);
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
      resetHideState();
      scheduleHideSettingsApply(getSettings().hide_settings, 360);
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
