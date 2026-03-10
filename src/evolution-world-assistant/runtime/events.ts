import { showManagedEwNotice } from '../ui/notice';
import { disposeFloorBindingEvents, initFloorBindingEvents } from './floor-binding';
import { runIncrementalHideCheck } from './hide-engine';
import { markIntercepted, resetInterceptGuard, wasRecentlyIntercepted } from './intercept-guard';
import { runWorkflow } from './pipeline';
import { getSettings } from './settings';
import {
  clearSendContext,
  getRuntimeState,
  isQuietLike,
  recordGeneration,
  recordUserSend,
  recordUserSendIntent,
  resetRuntimeState,
  setProcessing,
  shouldHandleGenerationAfter,
} from './state';
import { EwSettings } from './types';

const listenerStops: EventOnReturn[] = [];
const domCleanup: Array<() => void> = [];
let warnedEventMakeFirstFallback = false;
const HOOK_RETRY_DELAY_MS = 1200;
let sendIntentRetryTimer: ReturnType<typeof setTimeout> | null = null;
let tavernHelperRetryTimer: ReturnType<typeof setTimeout> | null = null;

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

// ---------------------------------------------------------------------------
// Shared workflow execution with failure-policy handling.
// Both the TavernHelper hook and GENERATION_AFTER_COMMANDS fallback call this.
// ---------------------------------------------------------------------------

async function executeWorkflowWithPolicy(settings: EwSettings, messageId: number, userInput: string): Promise<boolean> {
  // Returns true if the caller should ABORT the generation (stop_generation policy).
  // Apply incremental hide check before workflow so AI context is up-to-date
  try {
    runIncrementalHideCheck(settings.hide_settings);
  } catch (e) {
    console.warn('[Evolution World] Hide check failed:', e);
  }

  const workflowAbortController = new AbortController();
  let abortedByUser = false;

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

  const finalizeUserAbort = () => {
    processingReminder.update({
      title: 'Evolution World',
      message: '已终止本轮处理。',
      level: 'warning',
      duration_ms: 2200,
    });
    return true;
  };

  let result;
  try {
    result = await runWorkflow({
      message_id: messageId,
      user_input: userInput,
      mode: 'auto',
      inject_reply: true,
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
      processingReminder.update({
        title: 'Evolution World',
        message: `首次处理失败，正在重试… ${result.reason ?? ''}`,
        level: 'warning',
        persist: true,
        busy: true,
      });
      toastr.warning(`工作流首次失败，正在重试… (${result.reason ?? ''})`, 'Evolution World');
      try {
        result = await runWorkflow({
          message_id: messageId,
          user_input: userInput,
          mode: 'auto',
          inject_reply: true,
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
      switch (policy) {
        case 'continue_generation':
          processingReminder.update({
            title: 'Evolution World',
            message: `工作流失败，已回退为 AI 继续生成：${result.reason ?? 'unknown'}`,
            level: 'warning',
            duration_ms: 3200,
          });
          toastr.warning(`工作流失败，AI 继续生成: ${result.reason ?? 'unknown'}`, 'Evolution World');
          break;
        case 'notify_only':
          processingReminder.update({
            title: 'Evolution World',
            message: `工作流失败：${result.reason ?? 'unknown'}`,
            level: 'warning',
            duration_ms: 3200,
          });
          toastr.info(`工作流失败: ${result.reason ?? 'unknown'}`, 'Evolution World');
          break;
        case 'stop_generation':
        case 'retry_once':
        default:
          processingReminder.update({
            title: 'Evolution World',
            message: `动态世界流程失败，本轮已中止：${result.reason ?? 'unknown error'}`,
            level: 'error',
            duration_ms: 4200,
          });
          stopGenerationNow();
          toastr.error(`动态世界流程失败，本轮已中止: ${result.reason ?? 'unknown error'}`, 'Evolution World');
          return true;
      }

      return false;
    }
  }

  processingReminder.update({
    title: 'Evolution World',
    message: '动态世界流程处理完成，已更新本轮上下文。',
    level: 'success',
    duration_ms: 2200,
  });
  return false;
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
    if (!settings.enabled || getRuntimeState().is_processing) {
      return win._ew_originalGenerate.apply(this, args);
    }

    // M-2: 与 GENERATION_AFTER_COMMANDS 路径保持一致的类型过滤
    const genType = options.type ?? getRuntimeState().last_generation?.type ?? 'normal';
    const allowedTypes = new Set(['normal', 'continue', 'regenerate', 'swipe']);
    if (!allowedTypes.has(genType)) {
      return win._ew_originalGenerate.apply(this, args);
    }

    // Extract user input without modifying it
    let userInput = String(options.user_input || options.prompt || '');
    if (options.injects?.[0]?.content) {
      userInput = String(options.injects[0].content);
    }

    // CR-4: For continue/regenerate/swipe, fall back to the last user message
    if (!userInput.trim()) {
      try {
        const msgs = getChatMessages(`0-${getLastMessageId()}`, { hide_state: 'unhidden' });
        const lastUserMsg = [...msgs].reverse().find((m: any) => m.role === 'user');
        userInput = lastUserMsg?.message ?? '';
      } catch {
        /* ignore */
      }
    }

    if (!userInput.trim()) {
      return win._ew_originalGenerate.apply(this, args);
    }

    // Mark for deduplication before running workflow
    markIntercepted(userInput);

    const messageId = getRuntimeState().last_send?.message_id ?? getLastMessageId();

    let shouldAbort = false;
    setProcessing(true);
    try {
      shouldAbort = await executeWorkflowWithPolicy(settings, messageId, userInput);
    } catch (e) {
      console.error('[Evolution World] Error in TavernHelper.generate hook:', e);
    } finally {
      setProcessing(false);
      clearSendContext();
    }

    // If workflow failed with stop_generation policy, do NOT call original generate
    if (shouldAbort) {
      console.debug('[Evolution World] TavernHelper.generate aborted due to workflow failure (stop_generation)');
      return;
    }

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
  const decision = shouldHandleGenerationAfter(type, params, dryRun, settings);
  if (!decision.ok) {
    return;
  }

  const messageId = getRuntimeState().last_send?.message_id ?? getLastMessageId();
  let userInput = getRuntimeState().last_send?.user_input ?? getRuntimeState().last_send_intent?.user_input ?? '';

  // CR-4: For continue/regenerate/swipe, the user hasn't typed new input.
  // Fall back to the last user message so the workflow has context.
  const genType = getRuntimeState().last_generation?.type ?? '';
  const isNonSendType = ['continue', 'regenerate', 'swipe'].includes(genType);
  if (!userInput.trim() && isNonSendType) {
    try {
      const msgs = getChatMessages(`0-${getLastMessageId()}`, { hide_state: 'unhidden' });
      const lastUserMsg = [...msgs].reverse().find((m: any) => m.role === 'user');
      userInput = lastUserMsg?.message ?? '';
    } catch {
      /* ignore */
    }
  }

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
    await executeWorkflowWithPolicy(settings, messageId, userInput);
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
