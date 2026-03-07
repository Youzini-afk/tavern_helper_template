/**
 * hide-engine.ts — Message hiding & floor limiter logic.
 *
 * Two orthogonal features, unified under global settings:
 *
 * 1. **Hide floors** (AI hiding):
 *    Keep the most recent N messages; mark older ones `is_system = true`
 *    so SillyTavern excludes them from the AI context.
 *
 * 2. **Floor limiter** (visual):
 *    Only render the most recent M messages in the chat DOM.
 *    Does NOT affect AI context — purely for UI performance.
 */

declare const SillyTavern: { getContext(): Record<string, any> } | undefined;

// ── Types ─────────────────────────────────────────────────────────────

export interface HideSettings {
  enabled: boolean;
  hide_last_n: number;       // 0 = don't hide
  limiter_enabled: boolean;
  limiter_count: number;
}

interface HideState {
  lastProcessedLength: number;
}

// Module-level state
let hideState: HideState = { lastProcessedLength: 0 };

// ── Helpers ───────────────────────────────────────────────────────────

function getChat(): any[] | null {
  try {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern?.getContext() : undefined;
    return ctx?.chat ?? null;
  } catch {
    return null;
  }
}

function getContextFns(): {
  clearChat?: () => void;
  addOneMessage?: (msg: any, opts: any) => void;
  swipe?: { refresh: () => void };
} {
  try {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern?.getContext() : undefined;
    return {
      clearChat: ctx?.clearChat,
      addOneMessage: ctx?.addOneMessage,
      swipe: ctx?.swipe,
    };
  } catch {
    return {};
  }
}

// ── 1. Full hide check ───────────────────────────────────────────────

/**
 * Performs a full sweep across all messages, toggling `is_system` based on
 * the hide_last_n threshold. Also updates the DOM attribute on each message.
 */
export function runFullHideCheck(settings: HideSettings): void {
  if (!settings.enabled) return;

  const chat = getChat();
  if (!chat || chat.length === 0) return;

  const hideLastN = settings.hide_last_n;
  if (hideLastN <= 0) return; // 0 = hide nothing

  const chatLen = chat.length;
  const visibleStart = hideLastN >= chatLen ? 0 : Math.max(0, chatLen - hideLastN);

  const toHide: number[] = [];
  const toShow: number[] = [];

  for (let i = 0; i < chatLen; i++) {
    const msg = chat[i];
    if (!msg) continue;

    const isHidden = msg.is_system === true;
    const shouldBeHidden = i < visibleStart;

    if (shouldBeHidden && !isHidden) {
      msg.is_system = true;
      toHide.push(i);
    } else if (!shouldBeHidden && isHidden) {
      msg.is_system = false;
      toShow.push(i);
    }
  }

  // Update DOM attributes
  if (typeof $ !== 'undefined') {
    if (toHide.length > 0) {
      const sel = toHide.map(id => `.mes[mesid="${id}"]`).join(',');
      $(sel).attr('is_system', 'true');
    }
    if (toShow.length > 0) {
      const sel = toShow.map(id => `.mes[mesid="${id}"]`).join(',');
      $(sel).attr('is_system', 'false');
    }
  }

  hideState.lastProcessedLength = chatLen;

  if (toHide.length > 0 || toShow.length > 0) {
    console.log(`[EW Hide] Full check: hid ${toHide.length}, showed ${toShow.length} messages`);
  }
}

// ── 2. Incremental hide check ────────────────────────────────────────

/**
 * Optimised path: only hides the messages that newly fell out of the
 * visible window since the last check. Called after each AI generation.
 */
export function runIncrementalHideCheck(settings: HideSettings): void {
  if (!settings.enabled) return;

  const chat = getChat();
  if (!chat || chat.length === 0) return;

  const hideLastN = settings.hide_last_n;
  if (hideLastN <= 0) return;

  const chatLen = chat.length;
  const prevLen = hideState.lastProcessedLength;

  // If chat shrunk (deletion), fall back to full check
  if (chatLen <= prevLen) {
    hideState.lastProcessedLength = chatLen;
    if (chatLen < prevLen) runFullHideCheck(settings);
    return;
  }

  const targetVisibleStart = Math.max(0, chatLen - hideLastN);
  const prevVisibleStart = prevLen > 0 ? Math.max(0, prevLen - hideLastN) : 0;

  if (targetVisibleStart > prevVisibleStart) {
    const indices: number[] = [];
    for (let i = prevVisibleStart; i < targetVisibleStart; i++) {
      if (chat[i] && chat[i].is_system !== true) {
        chat[i].is_system = true;
        indices.push(i);
      }
    }
    if (indices.length > 0 && typeof $ !== 'undefined') {
      const sel = indices.map(id => `.mes[mesid="${id}"]`).join(',');
      $(sel).attr('is_system', 'true');
      console.log(`[EW Hide] Incremental: hid ${indices.length} messages`);
    }
  }

  hideState.lastProcessedLength = chatLen;
}

// ── 3. Unhide all ────────────────────────────────────────────────────

/**
 * Removes hidden status from ALL messages in the current chat.
 */
export function unhideAll(): void {
  const chat = getChat();
  if (!chat) return;

  let count = 0;
  for (let i = 0; i < chat.length; i++) {
    if (chat[i] && chat[i].is_system === true) {
      chat[i].is_system = false;
      count++;
    }
  }

  if (count > 0 && typeof $ !== 'undefined') {
    $('.mes[is_system="true"]').attr('is_system', 'false');
  }

  hideState.lastProcessedLength = chat.length;
  console.log(`[EW Hide] Unhid ${count} messages`);
}

// ── 4. Floor limiter ─────────────────────────────────────────────────

/**
 * Visually limits the chat window to show only the last `limit` messages.
 * Does NOT affect `is_system` — messages are still sent to AI.
 */
export function applyFloorLimit(settings: HideSettings): void {
  if (!settings.limiter_enabled) {
    // If was active, restore
    if (typeof $ !== 'undefined' && $('#chat').attr('data-limiter-active')) {
      runFullHideCheck(settings); // Restore normal view
      $('#chat').removeAttr('data-limiter-active');
    }
    return;
  }

  const limit = settings.limiter_count;
  if (limit <= 0) return;

  const { clearChat, addOneMessage, swipe } = getContextFns();
  const chat = getChat();
  if (!chat || !clearChat || !addOneMessage) return;

  // Don't run if user is editing
  if (typeof $ !== 'undefined' && $('#chat .edit_textarea').length > 0) return;

  clearChat();
  $('#chat').attr('data-limiter-active', 'true');

  const messagesToDisplay = chat.slice(-limit);
  for (const message of messagesToDisplay) {
    const originalIndex = chat.indexOf(message);
    addOneMessage(message, { scroll: false, forceId: originalIndex });
  }

  if (swipe?.refresh) swipe.refresh();
  console.log(`[EW Hide] Limiter: displaying ${messagesToDisplay.length}/${chat.length} messages`);
}

// ── 5. Reset state ───────────────────────────────────────────────────

export function resetHideState(): void {
  hideState = { lastProcessedLength: 0 };
}
