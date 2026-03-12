import { EwWorkflowNoticeInput, showManagedWorkflowNotice } from '../ui/notice';
import { getEffectiveFlows } from './char-flows';
import { disposeFloorBindingEvents, initFloorBindingEvents, rollbackBeforeFloor } from './floor-binding';
import { runIncrementalHideCheck } from './hide-engine';
import { markIntercepted, resetInterceptGuard, wasRecentlyIntercepted } from './intercept-guard';
import { runWorkflow } from './pipeline';
import { getSettings } from './settings';
import {
  clearAfterReplyPending,
  clearSendContext,
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
import { DispatchFlowAttempt, DispatchFlowResult, EwSettings, WorkflowProgressUpdate } from './types';

const EW_FLOOR_WORKFLOW_EXECUTION_KEY = 'ew_workflow_execution';

type FloorWorkflowStoredResult = {
  flow_id: string;
  response: Record<string, any>;
};

type FloorWorkflowExecutionState = {
  at: number;
  request_id: string;
  successful_results: FloorWorkflowStoredResult[];
  failed_flow_ids: string[];
};

const listenerStops: EventOnReturn[] = [];
const domCleanup: Array<() => void> = [];
let warnedEventMakeFirstFallback = false;
const HOOK_RETRY_DELAY_MS = 1200;
let sendIntentRetryTimer: ReturnType<typeof setTimeout> | null = null;
let tavernHelperRetryTimer: ReturnType<typeof setTimeout> | null = null;
const NON_SEND_GENERATION_TYPES = new Set(['continue', 'regenerate', 'swipe']);
const WORKFLOW_NOTICE_COLLAPSE_MS = 5000;
const WORKFLOW_NOTICE_MAX_ISLANDS = 5;
type WorkflowNoticeIslandTone = 'streaming';

type WorkflowNoticeIslandState = {
  id: string;
  entry_name: string;
  content: string;
  tone: WorkflowNoticeIslandTone;
  flow_order: number;
  updated_at: number;
  dismiss_timer: ReturnType<typeof setTimeout> | null;
};

type ProcessingReminderHandle = {
  update: (next: Partial<EwWorkflowNoticeInput>) => void;
  dismiss: () => void;
  collapse: () => void;
  expand: () => void;
};

let activeProcessingReminder: ProcessingReminderHandle | null = null;

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

  return {
    at: Number(obj.at ?? 0),
    request_id: String(obj.request_id ?? '').trim(),
    successful_results: successfulResults,
    failed_flow_ids: _.uniq(failedFlowIds),
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

async function clearFloorWorkflowExecution(messageId: number): Promise<void> {
  await writeFloorWorkflowExecution(messageId, null);
}

function buildFloorWorkflowExecutionState(
  requestId: string,
  attempts: Array<{ flow: { id: string }; ok: boolean; response?: Record<string, any> }>,
  preservedResults: FloorWorkflowStoredResult[] = [],
): FloorWorkflowExecutionState {
  const successfulResults = new Map<string, FloorWorkflowStoredResult>(
    preservedResults.map(result => [result.flow_id, result]),
  );
  const failedFlowIds = new Set<string>();

  for (const attempt of attempts) {
    const flowId = String(attempt.flow.id ?? '').trim();
    if (!flowId) {
      continue;
    }

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
    successful_results: [...successfulResults.values()],
    failed_flow_ids: [...failedFlowIds],
  };
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
  activeProcessingReminder?.dismiss();

  let state: EwWorkflowNoticeInput = {
    title: 'Evolution World',
    message: '正在读取上下文并处理本轮工作流，请稍后…',
    level: 'info',
    persist: true,
    busy: true,
    collapse_after_ms: WORKFLOW_NOTICE_COLLAPSE_MS,
    island: {},
    islands: [],
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
      islands: next.islands ?? state.islands ?? [],
    };
    handle.update(state);
  };

  const reminder: ProcessingReminderHandle = {
    update,
    dismiss: () => {
      handle.dismiss();
      if (activeProcessingReminder === reminder) {
        activeProcessingReminder = null;
      }
    },
    collapse: handle.collapse,
    expand: handle.expand,
  };

  activeProcessingReminder = reminder;

  return reminder;
}

function trimWorkflowNoticeText(text: string | undefined, maxLength: number) {
  const normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function createWorkflowIslandTracker(processingReminder: ReturnType<typeof createProcessingReminder>) {
  const islands = new Map<string, WorkflowNoticeIslandState>();

  const clearDismissTimer = (island: WorkflowNoticeIslandState) => {
    if (island.dismiss_timer) {
      clearTimeout(island.dismiss_timer);
      island.dismiss_timer = null;
    }
  };

  const sync = () => {
    const activeIslands = [...islands.values()]
      .filter(island => island.tone === 'streaming')
      .sort((left, right) => right.updated_at - left.updated_at || left.flow_order - right.flow_order);
    const visibleIslands = activeIslands.slice(0, WORKFLOW_NOTICE_MAX_ISLANDS);

    processingReminder.update({
      island: {
        entry_name: '',
        content: '',
      },
      islands: visibleIslands.map((island, index) => ({
        id: island.id,
        entry_name: island.entry_name,
        content: island.content,
        tone: island.tone,
        flow_order: island.flow_order,
        updated_at: island.updated_at,
        extra_count: index === 0 ? Math.max(0, activeIslands.length - 1) : 0,
      })),
    });
  };

  const upsertIsland = (
    id: string,
    nextState: Omit<WorkflowNoticeIslandState, 'dismiss_timer'>,
  ): WorkflowNoticeIslandState => {
    const current = islands.get(id);
    if (current) {
      clearDismissTimer(current);
      current.entry_name = nextState.entry_name;
      current.content = nextState.content;
      current.tone = nextState.tone;
      current.flow_order = nextState.flow_order;
      current.updated_at = nextState.updated_at;
      return current;
    }

    const created: WorkflowNoticeIslandState = {
      ...nextState,
      dismiss_timer: null,
    };
    islands.set(id, created);
    return created;
  };

  const setIslandState = (input: {
    id: string;
    entry_name: string;
    content: string;
    tone: WorkflowNoticeIslandTone;
    flow_order: number;
  }) => {
    const island = upsertIsland(input.id, {
      id: input.id,
      entry_name: trimWorkflowNoticeText(input.entry_name, 28) || '未命名工作流',
      content: trimWorkflowNoticeText(input.content, 54),
      tone: input.tone,
      flow_order: input.flow_order,
      updated_at: Date.now(),
    });
    sync();
  };

  return {
    markStarted(update: WorkflowProgressUpdate) {
      const flowId = update.flow_id?.trim();
      if (!flowId) {
        return;
      }
      setIslandState({
        id: flowId,
        entry_name: update.flow_name?.trim() || flowId,
        content: '正在等待首段输出…',
        tone: 'streaming',
        flow_order: update.flow_order ?? Number.MAX_SAFE_INTEGER,
      });
    },
    markStreaming(update: WorkflowProgressUpdate) {
      const flowId = update.flow_id?.trim();
      if (!flowId) {
        return;
      }
      const current = islands.get(flowId);
      setIslandState({
        id: flowId,
        entry_name:
          trimWorkflowNoticeText(update.stream_preview?.entry_name, 28) ||
          current?.entry_name ||
          update.flow_name?.trim() ||
          flowId,
        content:
          trimWorkflowNoticeText(update.stream_preview?.content, 54) ||
          trimWorkflowNoticeText(update.stream_text, 54) ||
          current?.content ||
          '正在流式读取输出…',
        tone: 'streaming',
        flow_order: update.flow_order ?? current?.flow_order ?? Number.MAX_SAFE_INTEGER,
      });
    },
    settleAttempts(attempts: DispatchFlowAttempt[]) {
      for (const attempt of attempts) {
        const current = islands.get(attempt.flow.id);
        if (!current) {
          continue;
        }
        clearDismissTimer(current);
        islands.delete(attempt.flow.id);
      }
      sync();
    },
    clear() {
      for (const island of islands.values()) {
        clearDismissTimer(island);
      }
      islands.clear();
      sync();
    },
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
  const workflowIslandTracker = createWorkflowIslandTracker(processingReminder);
  processingReminder.update(buildAbortableReminder(options.reminderMessage));
  let reminderSettled = false;
  let currentPreservedStoredResults = [...(options.preservedResults ?? [])];
  let currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);

  const handleWorkflowProgress = (update: WorkflowProgressUpdate) => {
    if (reminderSettled) {
      return;
    }

    switch (update.phase) {
      case 'preparing':
      case 'dispatching':
      case 'merging':
      case 'committing':
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          level: update.phase === 'merging' || update.phase === 'committing' ? 'info' : 'info',
          persist: true,
          busy: true,
        });
        break;
      case 'flow_started':
        workflowIslandTracker.markStarted(update);
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          persist: true,
          busy: true,
          level: 'info',
        });
        break;
      case 'streaming': {
        workflowIslandTracker.markStreaming(update);
        processingReminder.update({
          message: update.flow_name?.trim() ? `正在流式读取「${update.flow_name}」输出…` : '正在流式读取工作流输出…',
          persist: true,
          busy: true,
          level: 'info',
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
    workflowIslandTracker.clear();
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
      },
      islands: [],
      duration_ms: 2200,
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

  workflowIslandTracker.settleAttempts(result.attempts);

  if (options.trigger.timing === 'after_reply') {
    const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
    const executionState = buildFloorWorkflowExecutionState(
      result.request_id,
      result.attempts,
      currentPreservedStoredResults,
    );
    await writeFloorWorkflowExecution(assistantMessageId, executionState);
    currentPreservedStoredResults = executionState.successful_results;
    currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);
  }

  if (!result.ok) {
    const policy = settings.failure_policy ?? 'stop_generation';

    if (policy === 'retry_once') {
      console.warn('[EW] retry_once: first attempt failed — retrying.');
      const retryReason = formatReasonForDisplay(result.reason, 120);
      processingReminder.update(buildAbortableReminder(`首次处理失败，正在重试… ${retryReason}`, 'warning'));
      toastr.warning(`工作流首次失败，正在重试… (${retryReason})`, 'Evolution World');
      try {
        result = await runWorkflow({
          message_id: options.messageId,
          user_input: options.userInput,
          trigger: options.trigger,
          mode: 'auto',
          inject_reply: options.injectReply,
          flow_ids: options.flowIds,
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

      workflowIslandTracker.settleAttempts(result.attempts);

      if (options.trigger.timing === 'after_reply') {
        const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
        const executionState = buildFloorWorkflowExecutionState(
          result.request_id,
          result.attempts,
          currentPreservedStoredResults,
        );
        await writeFloorWorkflowExecution(assistantMessageId, executionState);
        currentPreservedStoredResults = executionState.successful_results;
        currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);
      }
    }

    if (!result.ok) {
      const displayReason = formatReasonForDisplay(result.reason);
      switch (policy) {
        case 'continue_generation':
          reminderSettled = true;
          processingReminder.update({
            title: 'Evolution World',
            message: `工作流失败：${displayReason}。原消息是否继续发送取决于放行策略。`,
            level: 'warning',
            persist: false,
            busy: false,
            action: undefined,
            duration_ms: 3200,
          });
          toastr.warning(`工作流失败，原消息是否继续发送取决于放行策略: ${displayReason}`, 'Evolution World');
          break;
        case 'allow_partial_success':
        case 'notify_only':
          reminderSettled = true;
          processingReminder.update({
            title: 'Evolution World',
            message: `工作流失败：${displayReason}`,
            level: 'warning',
            persist: false,
            busy: false,
            action: undefined,
            duration_ms: 3200,
          });
          toastr.info(`工作流失败: ${displayReason}`, 'Evolution World');
          break;
        case 'stop_generation':
        case 'retry_once':
        default:
          reminderSettled = true;
          processingReminder.update({
            title: 'Evolution World',
            message: `动态世界流程失败，本轮已中止：${displayReason}`,
            level: 'error',
            persist: false,
            busy: false,
            action: undefined,
            duration_ms: 4200,
          });
          stopGenerationNow();
          toastr.error(`动态世界流程失败，本轮已中止: ${displayReason}`, 'Evolution World');
          return {
            shouldAbortGeneration: true,
            workflowSucceeded: false,
            abortedByUser: false,
          };
      }

      return {
        shouldAbortGeneration: false,
        workflowSucceeded: false,
        abortedByUser: false,
      };
    }
  }

  reminderSettled = true;
  processingReminder.update({
    title: 'Evolution World',
    message: options.successMessage,
    level: 'success',
    persist: false,
    busy: false,
    action: undefined,
    duration_ms: 2200,
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
    if (!settings.enabled || settings.workflow_timing !== 'before_reply' || getRuntimeState().is_processing) {
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
    setProcessing(true);
    try {
      workflowOutcome = await executeWorkflowWithPolicy(settings, {
        messageId,
        userInput,
        injectReply: true,
        trigger: {
          timing: 'before_reply',
          source: 'tavernhelper',
          generation_type: genType,
          user_message_id: getRuntimeState().last_send?.message_id,
        },
        reminderMessage: '正在读取上下文并处理本轮工作流，请稍后…',
        successMessage: '动态世界流程处理完成，已更新本轮上下文。',
      });
    } catch (e) {
      console.error('[Evolution World] Error in TavernHelper.generate hook:', e);
    } finally {
      setProcessing(false);
      clearSendContext();
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
  if (settings.workflow_timing !== 'before_reply') {
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

  clearSendContext();

  console.debug('[Evolution World] GENERATION_AFTER_COMMANDS executing workflow (fallback path)');
  setProcessing(true);
  try {
    // Return value (shouldAbort) is only relevant for the primary path;
    // in the fallback path, stopGenerationNow() inside executeWorkflowWithPolicy
    // handles abort directly since generation is already in progress.
    await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: true,
      trigger: {
        timing: 'before_reply',
        source: 'generation_after_commands',
        generation_type: genType || type,
        user_message_id: getRuntimeState().last_send?.message_id,
      },
      reminderMessage: '正在读取上下文并处理本轮工作流，请稍后…',
      successMessage: '动态世界流程处理完成，已更新本轮上下文。',
    });
  } finally {
    setProcessing(false);
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

async function invalidateAfterReplyExecutionForMessage(messageId: number): Promise<void> {
  if (!Number.isFinite(messageId) || messageId < 0) {
    return;
  }

  if (!isAssistantMessage(messageId)) {
    return;
  }

  const executionState = readFloorWorkflowExecution(messageId);
  if (!executionState) {
    return;
  }

  await clearFloorWorkflowExecution(messageId);
  console.info(`[Evolution World] Cleared stale workflow execution state for floor #${messageId}`);
}

async function onAfterReplyMessage(messageId: number, type: string, source: 'message_received' | 'generation_ended') {
  const settings = getSettings();
  if (settings.workflow_timing !== 'after_reply') {
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

  setProcessing(true);
  try {
    await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: false,
      trigger: {
        timing: 'after_reply',
        source,
        generation_type: generationType,
        user_message_id: runtimeState.after_reply.pending_user_message_id ?? runtimeState.last_send?.message_id,
        assistant_message_id: messageId,
      },
      reminderMessage: '正在根据最新回复更新动态世界，请稍后…',
      successMessage: '动态世界已根据最新回复完成更新。',
    });
    markAfterReplyHandled(messageId, messageText);
  } finally {
    clearAfterReplyPending();
    clearSendContext();
    setProcessing(false);
  }
}

export async function rerollCurrentAfterReplyWorkflow(): Promise<{ ok: boolean; reason?: string }> {
  const settings = getSettings();
  if (settings.workflow_timing !== 'after_reply') {
    return { ok: false, reason: 'workflow timing is not after_reply' };
  }
  if (!settings.enabled) {
    return { ok: false, reason: 'workflow disabled' };
  }
  if (getRuntimeState().is_processing) {
    return { ok: false, reason: 'workflow already processing' };
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

  let flowIds: string[] | undefined;
  let preservedResults: FloorWorkflowStoredResult[] = [];

  if (rerollScope === 'failed_only') {
    const executionState = readFloorWorkflowExecution(messageId);
    if (executionState?.failed_flow_ids.length) {
      const effectiveFlows = await getEffectiveFlows(settings);
      const flowMap = new Map(effectiveFlows.map(flow => [flow.id, flow]));

      flowIds = executionState.failed_flow_ids.filter(flowId => flowMap.has(flowId));
      preservedResults = executionState.successful_results.filter(result => {
        return flowMap.has(result.flow_id) && !flowIds?.includes(result.flow_id);
      });

      if (flowIds.length === 0) {
        return { ok: false, reason: '当前楼记录中的失败工作流已被禁用或删除' };
      }
    } else if (executionState && executionState.failed_flow_ids.length === 0) {
      return { ok: false, reason: '当前楼没有失败的工作流可供重跑' };
    }
  }

  setProcessing(true);
  try {
    if (settings.floor_binding_enabled) {
      await rollbackBeforeFloor(settings, messageId);
    }

    const outcome = await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: false,
      flowIds,
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
          ? `正在重跑当前楼失败的 ${flowIds.length} 条工作流，请稍后…`
          : '正在重跑当前楼的回复后工作流，请稍后…',
      successMessage:
        rerollScope === 'failed_only' && flowIds?.length
          ? '当前楼失败的工作流已重跑完成。'
          : '当前楼的动态世界工作流已重跑完成。',
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
    setProcessing(false);
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
    eventOn(tavern_events.MESSAGE_EDITED, async messageId => {
      await invalidateAfterReplyExecutionForMessage(messageId);
    }),
  );

  listenerStops.push(
    eventOn(tavern_events.MESSAGE_SWIPED, async messageId => {
      await invalidateAfterReplyExecutionForMessage(messageId);
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
