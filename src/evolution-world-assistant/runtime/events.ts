import { getSettings } from './settings';
import {
  getRuntimeState,
  clearSendContext,
  recordGeneration,
  recordUserSend,
  recordUserSendIntent,
  resetRuntimeState,
  setProcessing,
  shouldHandleGenerationAfter,
} from './state';
import { runWorkflow } from './pipeline';
import { initFloorBindingEvents, disposeFloorBindingEvents } from './floor-binding';
import { runIncrementalHideCheck } from './hide-engine';

const listenerStops: EventOnReturn[] = [];
const domCleanup: Array<() => void> = [];
let warnedEventMakeFirstFallback = false;

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
  const textarea = document.getElementById('send_textarea') as HTMLTextAreaElement | null;
  return String(textarea?.value ?? '');
}

function installSendIntentHooks() {
  for (const cleanup of domCleanup.splice(0, domCleanup.length)) {
    cleanup();
  }

  const sendButton = document.getElementById('send_but');
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

  const sendTextarea = document.getElementById('send_textarea');
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

async function onGenerationAfterCommands(
  type: string,
  params: {
    automatic_trigger?: boolean;
    quiet_prompt?: string;
    [key: string]: any;
  },
  dryRun: boolean,
) {
  const settings = getSettings();
  const decision = shouldHandleGenerationAfter(type, params, dryRun, settings);
  if (!decision.ok) {
    return;
  }

  // Apply incremental hide check before workflow so AI context is up-to-date
  try {
    runIncrementalHideCheck(settings.hide_settings);
  } catch (e) {
    console.warn('[Evolution World] Hide check failed:', e);
  }

  const messageId = getRuntimeState().last_send?.message_id ?? getLastMessageId();
  const userInput = getRuntimeState().last_send?.user_input ?? getRuntimeState().last_send_intent?.user_input ?? '';
  if (!userInput.trim()) {
    console.debug('[Evolution World] skipped workflow: user input is empty (continue/regen may not capture input)');
    return;
  }
  clearSendContext();

  setProcessing(true);
  try {
    let result = await runWorkflow({
      message_id: messageId,
      user_input: userInput,
      mode: 'auto',
      inject_reply: true,
    });

    if (!result.ok) {
      const policy = settings.failure_policy ?? 'stop_generation';

      if (policy === 'retry_once') {
        toastr.warning(`工作流首次失败，正在重试… (${result.reason ?? ''})`, 'Evolution World');
        result = await runWorkflow({
          message_id: messageId,
          user_input: userInput,
          mode: 'auto',
          inject_reply: true,
        });
      }

      if (!result.ok) {
        switch (policy) {
          case 'continue_generation':
            toastr.warning(`工作流失败，AI 继续生成: ${result.reason ?? 'unknown'}`, 'Evolution World');
            break;
          case 'notify_only':
            toastr.info(`工作流失败: ${result.reason ?? 'unknown'}`, 'Evolution World');
            break;
          case 'stop_generation':
          case 'retry_once':
          default:
            stopGenerationNow();
            toastr.error(`动态世界流程失败，本轮已中止: ${result.reason ?? 'unknown error'}`, 'Evolution World');
            return;
        }
      }
    }
  } finally {
    setProcessing(false);
  }
}

export function initRuntimeEvents() {
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
    registerGenerationAfterCommands(async (type, params, dryRun) => {
      await onGenerationAfterCommands(type, params ?? {}, dryRun);
    }),
  );

  listenerStops.push(
    eventOn(tavern_events.CHAT_CHANGED, () => {
      resetRuntimeState();
      setTimeout(() => {
        installSendIntentHooks();
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
  disposeFloorBindingEvents();
}
