import { showManagedEwNotice } from '../ui/notice';
import { disposeFloorBindingEvents, initFloorBindingEvents } from './floor-binding';
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
import { EwSettings } from './types';

const listenerStops: EventOnReturn[] = [];
const domCleanup: Array<() => void> = [];
let warnedEventMakeFirstFallback = false;
const HOOK_RETRY_DELAY_MS = 1200;
let sendIntentRetryTimer: ReturnType<typeof setTimeout> | null = null;
let tavernHelperRetryTimer: ReturnType<typeof setTimeout> | null = null;
const NON_SEND_GENERATION_TYPES = new Set(['continue', 'regenerate', 'swipe']);

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

function createProcessingReminder(onAbort: () => void) {
  return showManagedEwNotice({
    title: 'Evolution World',
    message: '正在读取上下文并处理本轮工作流，请稍后…',
    level: 'info',
    persist: true,
    busy: true,
    action: {
      label: '终止处理',
      kind: 'danger',
      onClick: onAbort,
    },
  });
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
    });
  };

  const processingReminder = createProcessingReminder(cancelWorkflow);
  processingReminder.update(buildAbortableReminder(options.reminderMessage));

  const finalizeUserAbort = () => {
    processingReminder.update({
      title: 'Evolution World',
      message: '已终止本轮处理。',
      level: 'warning',
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
      abortSignal: workflowAbortController.signal,
      isCancelled: () => abortedByUser,
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
          abortSignal: workflowAbortController.signal,
          isCancelled: () => abortedByUser,
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
    }

    if (!result.ok) {
      const displayReason = formatReasonForDisplay(result.reason);
      switch (policy) {
        case 'continue_generation':
          processingReminder.update({
            title: 'Evolution World',
            message: `工作流失败：${displayReason}。原消息是否继续发送取决于放行策略。`,
            level: 'warning',
            duration_ms: 3200,
          });
          toastr.warning(`工作流失败，原消息是否继续发送取决于放行策略: ${displayReason}`, 'Evolution World');
          break;
        case 'allow_partial_success':
        case 'notify_only':
          processingReminder.update({
            title: 'Evolution World',
            message: `工作流失败：${displayReason}`,
            level: 'warning',
            duration_ms: 3200,
          });
          toastr.info(`工作流失败: ${displayReason}`, 'Evolution World');
          break;
        case 'stop_generation':
        case 'retry_once':
        default:
          processingReminder.update({
            title: 'Evolution World',
            message: `动态世界流程失败，本轮已中止：${displayReason}`,
            level: 'error',
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

  processingReminder.update({
    title: 'Evolution World',
    message: options.successMessage,
    level: 'success',
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

  setProcessing(true);
  try {
    const outcome = await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: false,
      trigger: {
        timing: 'after_reply',
        source: 'fab_double_click',
        generation_type: generationType,
        user_message_id: runtimeState.after_reply.pending_user_message_id ?? runtimeState.last_send?.message_id,
        assistant_message_id: messageId,
      },
      reminderMessage: '正在重跑当前楼的回复后工作流，请稍后…',
      successMessage: '当前楼的动态世界工作流已重跑完成。',
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
