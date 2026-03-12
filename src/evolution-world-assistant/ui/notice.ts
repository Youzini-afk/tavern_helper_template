export type EwNoticeLevel = 'success' | 'error' | 'info' | 'warning';

type EwNoticeAction = {
  label: string;
  onClick: () => void;
  kind?: 'neutral' | 'danger';
};

export type EwNoticeInput = {
  title: string;
  message: string;
  level?: EwNoticeLevel;
  duration_ms?: number;
  persist?: boolean;
  busy?: boolean;
  action?: EwNoticeAction;
};

export type EwWorkflowNoticeIslandInput = {
  id: string;
  entry_name?: string;
  content?: string;
  tone?: 'streaming' | 'success' | 'warning';
  flow_order?: number;
  extra_count?: number;
};

export type EwWorkflowNoticeInput = EwNoticeInput & {
  collapse_after_ms?: number;
  island?: {
    entry_name?: string;
    content?: string;
  };
  islands?: EwWorkflowNoticeIslandInput[];
};

export type EwNoticeHandle = {
  update: (nextInput: EwNoticeInput) => void;
  dismiss: () => void;
};

export type EwWorkflowNoticeHandle = {
  update: (nextInput: EwWorkflowNoticeInput) => void;
  dismiss: () => void;
  collapse: () => void;
  expand: () => void;
};

const STYLE_ID = 'ew-floating-notice-style';
const HOST_ID = 'ew-floating-notice-host';
const WORKFLOW_STYLE_ID = 'ew-workflow-notice-style';
const WORKFLOW_HOST_ID = 'ew-workflow-notice-host';

/** Module-level singleton: ensures only one workflow notice exists at a time. */
let _currentWorkflowHandle: { dismiss: () => void } | null = null;

function resolveNoticeDocument(): Document {
  const runtime = globalThis as Record<string, any>;
  const chatDocument = runtime.SillyTavern?.Chat?.document;
  if (chatDocument && typeof chatDocument.querySelector === 'function') {
    return chatDocument as Document;
  }

  try {
    return (window.parent && window.parent !== window ? window.parent : window).document;
  } catch {
    return document;
  }
}

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) {
    return;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${HOST_ID} {
      position: fixed;
      top: 14px;
      left: 14px;
      z-index: 12000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: min(420px, calc(100vw - 28px));
      pointer-events: none;
    }

    .ew-floating-notice {
      --ew-notice-accent: #73b8ff;
      position: relative;
      pointer-events: auto;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: start;
      gap: 12px;
      padding: 12px 12px 12px 10px;
      border-radius: 14px;
      border: 1px solid color-mix(in srgb, var(--ew-notice-accent) 48%, rgba(255, 255, 255, 0.2));
      background:
        linear-gradient(140deg, rgba(31, 46, 66, 0.9), rgba(16, 27, 40, 0.86)),
        radial-gradient(circle at 10% -10%, color-mix(in srgb, var(--ew-notice-accent) 30%, transparent), transparent 52%);
      color: #e9f0f8;
      box-shadow:
        0 14px 34px rgba(5, 10, 16, 0.52),
        0 0 0 1px rgba(255, 255, 255, 0.06) inset;
      backdrop-filter: blur(10px) saturate(125%);
      -webkit-backdrop-filter: blur(10px) saturate(125%);
      overflow: hidden;
      transform: translateY(-8px) scale(0.985);
      opacity: 0;
      animation: ewNoticeIn 190ms ease forwards;
      font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', sans-serif;
    }

    .ew-floating-notice::after {
      content: '';
      position: absolute;
      inset: 0;
      border-left: 3px solid var(--ew-notice-accent);
      border-radius: 14px;
      pointer-events: none;
      opacity: 0.9;
    }

    .ew-floating-notice--out {
      animation: ewNoticeOut 160ms ease forwards;
    }

    .ew-floating-notice__icon {
      width: 30px;
      height: 30px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      font-weight: 800;
      color: #f4f8ff;
      background: color-mix(in srgb, var(--ew-notice-accent) 28%, rgba(6, 12, 20, 0.6));
      border: 1px solid color-mix(in srgb, var(--ew-notice-accent) 54%, transparent);
      box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.16);
      flex: 0 0 auto;
    }

    .ew-floating-notice[data-busy='true'] .ew-floating-notice__icon {
      animation: ewNoticeBusy 900ms linear infinite;
    }

    .ew-floating-notice__content {
      min-width: 0;
    }

    .ew-floating-notice__title {
      margin: 0;
      font-size: 19px;
      line-height: 1.16;
      font-weight: 800;
      letter-spacing: 0.01em;
      color: #f0f6ff;
    }

    .ew-floating-notice__message {
      margin: 4px 0 0;
      font-size: 15px;
      line-height: 1.34;
      color: color-mix(in srgb, #f0f6ff 86%, #91a6bc);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .ew-floating-notice__actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }

    .ew-floating-notice__action {
      min-height: 30px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.08);
      color: #eef4ff;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
    }

    .ew-floating-notice__action:hover,
    .ew-floating-notice__action:focus-visible {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.24);
      transform: translateY(-1px);
      outline: none;
    }

    .ew-floating-notice__action[data-kind='danger'] {
      background: rgba(245, 123, 143, 0.16);
      border-color: rgba(245, 123, 143, 0.42);
      color: #ffd9df;
    }

    .ew-floating-notice__action[data-kind='danger']:hover,
    .ew-floating-notice__action[data-kind='danger']:focus-visible {
      background: rgba(245, 123, 143, 0.24);
      border-color: rgba(245, 123, 143, 0.58);
    }

    .ew-floating-notice__close {
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.08);
      color: #d7e0ec;
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
      transition: background 140ms ease;
    }

    .ew-floating-notice__close:hover,
    .ew-floating-notice__close:focus-visible {
      background: rgba(255, 255, 255, 0.2);
      outline: none;
    }

    .ew-floating-notice__progress {
      position: absolute;
      left: 0;
      bottom: 0;
      height: 2px;
      width: 100%;
      background: linear-gradient(90deg, var(--ew-notice-accent), rgba(255, 255, 255, 0.25));
      transform-origin: left center;
      animation: ewNoticeProgress linear forwards;
    }

    .ew-floating-notice[data-level='success'] {
      --ew-notice-accent: #65d39c;
    }

    .ew-floating-notice[data-level='error'] {
      --ew-notice-accent: #f57b8f;
    }

    .ew-floating-notice[data-level='warning'] {
      --ew-notice-accent: #eab96f;
    }

    @keyframes ewNoticeIn {
      to {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }

    @keyframes ewNoticeOut {
      to {
        transform: translateY(-6px) scale(0.98);
        opacity: 0;
      }
    }

    @keyframes ewNoticeProgress {
      from {
        transform: scaleX(1);
      }
      to {
        transform: scaleX(0);
      }
    }

    @keyframes ewNoticeBusy {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    @media (max-width: 900px) {
      #${HOST_ID} {
        top: 8px;
        left: 8px;
        width: calc(100vw - 16px);
      }

      .ew-floating-notice__title {
        font-size: 17px;
      }

      .ew-floating-notice__message {
        font-size: 14px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .ew-floating-notice,
      .ew-floating-notice--out,
      .ew-floating-notice__progress {
        animation-duration: 1ms !important;
      }
    }
  `;

  (doc.head || doc.documentElement).appendChild(style);
}

function ensureHost(doc: Document): HTMLElement {
  let host = doc.getElementById(HOST_ID);
  if (host) {
    return host;
  }

  host = doc.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'false');
  (doc.body || doc.documentElement).appendChild(host);
  return host;
}

function ensureWorkflowStyle(doc: Document) {
  // Clean the style from the current document
  const existing = doc.getElementById(WORKFLOW_STYLE_ID);
  if (existing) {
    existing.remove();
  }

  // Also purge old styles from parent/iframe documents to avoid cross-frame contamination
  try {
    const alternateDoc = doc === document ? window.parent?.document : document;
    if (alternateDoc && alternateDoc !== doc) {
      const altStyle = alternateDoc.getElementById(WORKFLOW_STYLE_ID);
      if (altStyle) altStyle.remove();
    }
  } catch { /* cross-origin */ }

  const style = doc.createElement('style');
  style.id = WORKFLOW_STYLE_ID;
  style.textContent = `
    #${WORKFLOW_HOST_ID} {
      position: fixed;
      top: 10px;
      left: 0;
      right: 0;
      z-index: 12010;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 0 12px;
      pointer-events: none;
    }

    /* ── root container ── */
    .ew-workflow-notice {
      --ew-notice-accent: #73b8ff;
      pointer-events: auto;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
      color: #eef5ff;
      transform: translateY(-8px) scale(0.985);
      opacity: 0;
      animation: ewWorkflowNoticeIn 220ms ease forwards;
      transition: transform 220ms ease, opacity 220ms ease;
      font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', sans-serif;
      cursor: pointer;
    }

    .ew-workflow-notice[data-level='success'] { --ew-notice-accent: #65d39c; }
    .ew-workflow-notice[data-level='error']   { --ew-notice-accent: #f57b8f; }
    .ew-workflow-notice[data-level='warning'] { --ew-notice-accent: #eab96f; }

    /* ── controls (close / action) ── */
    .ew-workflow-notice__controls {
      position: absolute;
      top: -2px;
      right: -2px;
      z-index: 2;
      display: flex;
      gap: 6px;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 140ms ease, transform 140ms ease;
    }

    .ew-workflow-notice:hover .ew-workflow-notice__controls,
    .ew-workflow-notice:focus-within .ew-workflow-notice__controls {
      opacity: 1;
      transform: translateY(0);
    }

    .ew-workflow-notice__action,
    .ew-workflow-notice__close {
      pointer-events: auto;
      min-height: 24px;
      padding: 0 10px;
      border: 1px solid rgba(160, 205, 255, 0.28);
      border-radius: 999px;
      background: rgba(7, 20, 39, 0.78);
      color: #e8f2ff;
      font-size: 12px;
      font-weight: 700;
      backdrop-filter: blur(12px) saturate(120%);
      -webkit-backdrop-filter: blur(12px) saturate(120%);
      box-shadow: 0 6px 16px rgba(3, 8, 17, 0.22);
      cursor: pointer;
      transition: background 140ms ease, border-color 140ms ease, opacity 140ms ease;
    }

    .ew-workflow-notice__action[data-kind='danger'] {
      border-color: rgba(245, 123, 143, 0.42);
      color: #ffd7e0;
    }

    .ew-workflow-notice__action:hover,
    .ew-workflow-notice__action:focus-visible,
    .ew-workflow-notice__close:hover,
    .ew-workflow-notice__close:focus-visible {
      background: rgba(18, 38, 66, 0.9);
      outline: none;
    }

    .ew-workflow-notice__close {
      width: 24px;
      min-width: 24px;
      padding: 0;
      font-size: 15px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* ── idle moon orb (v2.1.0 __island-orb, shown when no streaming content yet) ── */
    .ew-workflow-notice__idle-orb {
      display: none;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      position: relative;
      overflow: hidden;
      background: linear-gradient(180deg, rgba(24, 68, 119, 0.96), rgba(12, 36, 67, 0.98));
      border: 2px solid rgba(111, 164, 234, 0.92);
      box-shadow:
        0 10px 24px rgba(3, 8, 17, 0.26),
        0 0 16px rgba(96, 159, 255, 0.18),
        inset 0 1px 0 rgba(255, 255, 255, 0.12);
    }

    .ew-workflow-notice[data-active='false'] .ew-workflow-notice__idle-orb {
      display: block;
    }

    /* shared moon disc + shadow pseudo-elements (used by both idle orb and row orb) */
    .ew-workflow-notice__idle-orb::before,
    .ew-workflow-notice__row-orb::before {
      content: '';
      position: absolute;
      inset: 4px;
      border-radius: 50%;
      background: #ffe27a;
      box-shadow:
        inset 2px 2px 0 rgba(255, 247, 196, 0.95),
        inset -2px -2px 0 rgba(219, 177, 58, 0.45),
        0 0 6px rgba(255, 226, 122, 0.14);
    }

    .ew-workflow-notice__idle-orb::after,
    .ew-workflow-notice__row-orb::after {
      content: '';
      position: absolute;
      top: 4px;
      left: -20px;
      width: 26px;
      height: 24px;
      border-radius: inherit;
      background: #102746;
      box-shadow:
        46px 0 0 #102746,
        inset 1px 0 0 rgba(255, 255, 255, 0.04);
      transform: translate3d(0, 0, 0);
      will-change: transform;
      animation: ewWorkflowMoonPhase 4.8s linear infinite;
    }

    .ew-workflow-notice[data-busy='false'] .ew-workflow-notice__idle-orb::after,
    .ew-workflow-notice__row[data-tone='success'] .ew-workflow-notice__row-orb::after,
    .ew-workflow-notice__row[data-tone='warning'] .ew-workflow-notice__row-orb::after {
      animation-duration: 7.2s;
    }

    /* ── stack container (holds all capsule rows) ── */
    .ew-workflow-notice__stack {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      max-height: min(320px, calc(100vh - 120px));
      overflow: hidden;
    }

    .ew-workflow-notice[data-active='true'] .ew-workflow-notice__stack {
      display: flex;
    }

    /* ── single unified capsule: [ name  🌙  content ] ── */
    .ew-workflow-notice__row {
      --ew-row-accent: rgba(115, 184, 255, 0.9);
      display: grid;
      grid-template-columns: auto 32px 1fr auto;
      align-items: center;
      gap: 0;
      max-width: min(820px, calc(100vw - 32px));
      padding: 6px 16px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--ew-row-accent) 42%, rgba(255, 255, 255, 0.12));
      background:
        linear-gradient(180deg, rgba(16, 34, 58, 0.92), rgba(8, 20, 38, 0.95)),
        radial-gradient(circle at 10% -60%, color-mix(in srgb, var(--ew-row-accent) 18%, transparent), transparent 62%);
      box-shadow:
        0 8px 18px rgba(3, 8, 17, 0.2),
        0 0 0 1px rgba(255, 255, 255, 0.03) inset;
      backdrop-filter: blur(12px) saturate(125%);
      -webkit-backdrop-filter: blur(12px) saturate(125%);
      transform: translateY(6px);
      opacity: 0;
      animation: ewWorkflowStackIn 180ms ease forwards;
      transition: opacity 180ms ease, transform 180ms ease;
    }

    .ew-workflow-notice__row[data-tone='success'] { --ew-row-accent: rgba(101, 211, 156, 0.95); }
    .ew-workflow-notice__row[data-tone='warning'] { --ew-row-accent: rgba(234, 185, 111, 0.95); }

    /* collapsed: only first row visible (JS also sets inline display, this is fallback) */
    .ew-workflow-notice[data-collapsed='true'] .ew-workflow-notice__row:not([data-row-index='0']) {
      display: none !important;
    }

    .ew-workflow-notice__row--out {
      opacity: 0;
      transform: translateY(-10px);
    }

    /* ── name + content: plain text inside the unified capsule ── */
    .ew-workflow-notice__row-slot {
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ew-workflow-notice__row-slot--name {
      padding-right: 10px;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.2;
      color: #edf4ff;
      flex-shrink: 0;
    }

    .ew-workflow-notice__row-slot--content {
      position: relative;
      padding-left: 10px;
      font-size: 13px;
      font-weight: 650;
      line-height: 1.2;
      color: color-mix(in srgb, #f2f7ff 88%, #93abc4);
    }

    /* ── +N badge ── */
    .ew-workflow-notice__row-extra {
      display: none;
      margin-left: 8px;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      height: 20px;
      padding: 0 7px;
      border-radius: 999px;
      border: 1px solid rgba(163, 207, 255, 0.36);
      background: rgba(13, 30, 52, 0.92);
      color: #eef5ff;
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
      box-shadow: 0 6px 14px rgba(3, 8, 17, 0.22);
      flex-shrink: 0;
    }

    .ew-workflow-notice[data-collapsed='true'] .ew-workflow-notice__row[data-has-extra='true'] .ew-workflow-notice__row-extra {
      display: inline-flex;
    }

    /* ── center moon orb in each row (same animation as idle orb) ── */
    .ew-workflow-notice__row-orb {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      position: relative;
      overflow: hidden;
      flex-shrink: 0;
      background: linear-gradient(180deg, rgba(24, 68, 119, 0.96), rgba(12, 36, 67, 0.98));
      border: 2px solid color-mix(in srgb, var(--ew-row-accent) 82%, #7bb1ff);
      box-shadow:
        0 8px 16px rgba(3, 8, 17, 0.24),
        0 0 12px color-mix(in srgb, var(--ew-row-accent) 18%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, 0.12);
    }

    /* ── progress bar ── */
    .ew-workflow-notice__progress {
      display: none;
      width: min(520px, calc(100vw - 36px));
      height: 2px;
      margin-top: 6px;
      border-radius: 999px;
      background: linear-gradient(90deg, rgba(115, 184, 255, 0.92), rgba(255, 255, 255, 0.18));
      transform-origin: left center;
      animation: ewNoticeProgress linear forwards;
      box-shadow: 0 6px 16px rgba(3, 8, 17, 0.18);
    }

    .ew-workflow-notice--out {
      animation: ewNoticeOut 160ms ease forwards;
    }

    @keyframes ewWorkflowNoticeIn {
      to {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }

    @keyframes ewWorkflowMoonPhase {
      0%   { transform: translate3d(0, 0, 0); }
      100% { transform: translate3d(46px, 0, 0); }
    }

    @keyframes ewWorkflowStackIn {
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    @media (max-width: 900px) {
      .ew-workflow-notice__controls {
        position: static;
        opacity: 1;
        transform: none;
        margin-bottom: 2px;
      }

      .ew-workflow-notice__row {
        grid-template-columns: auto 28px 1fr auto;
        padding: 5px 12px;
        gap: 0;
        max-width: calc(100vw - 20px);
      }

      .ew-workflow-notice__row-slot--name { font-size: 12px; }
      .ew-workflow-notice__row-slot--content { font-size: 12px; }

      .ew-workflow-notice__row-orb {
        width: 28px;
        height: 28px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .ew-workflow-notice,
      .ew-workflow-notice--out,
      .ew-workflow-notice__progress,
      .ew-workflow-notice__idle-orb::after,
      .ew-workflow-notice__row,
      .ew-workflow-notice__row-orb::after {
        animation-duration: 1ms !important;
      }
    }

    /* ── kill any leftover v2.1.0 elements ── */
    .ew-workflow-notice__card,
    .ew-workflow-notice__island,
    .ew-workflow-notice__icon,
    .ew-workflow-notice__title,
    .ew-workflow-notice__message,
    .ew-workflow-notice__content,
    .ew-workflow-notice__actions,
    .ew-workflow-notice__island-slot,
    .ew-workflow-notice__island-orb {
      display: none !important;
    }
  `;

  (doc.head || doc.documentElement).appendChild(style);
}

function ensureWorkflowHost(doc: Document): HTMLElement {
  let host = doc.getElementById(WORKFLOW_HOST_ID);
  if (host) {
    return host;
  }

  host = doc.createElement('div');
  host.id = WORKFLOW_HOST_ID;
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'false');
  (doc.body || doc.documentElement).appendChild(host);

  // Also remove stale host from alternate document
  try {
    const alternateDoc = doc === document ? window.parent?.document : document;
    if (alternateDoc && alternateDoc !== doc) {
      const altHost = alternateDoc.getElementById(WORKFLOW_HOST_ID);
      if (altHost) altHost.remove();
    }
  } catch { /* cross-origin */ }

  return host;
}

function getIcon(level: EwNoticeLevel): string {
  switch (level) {
    case 'success':
      return '✓';
    case 'error':
      return '!';
    case 'warning':
      return '?';
    default:
      return 'i';
  }
}

function applyNoticeState(item: HTMLElement, input: EwNoticeInput, progress: HTMLElement) {
  const level = input.level ?? 'info';

  item.dataset.level = level;
  item.dataset.busy = input.busy ? 'true' : 'false';

  const icon = item.querySelector('.ew-floating-notice__icon');
  if (icon) {
    icon.textContent = input.busy ? '◌' : getIcon(level);
  }

  const title = item.querySelector('.ew-floating-notice__title');
  if (title) {
    title.textContent = input.title;
  }

  const message = item.querySelector('.ew-floating-notice__message');
  if (message) {
    message.textContent = input.message;
  }

  const actionButton = item.querySelector('.ew-floating-notice__action') as HTMLButtonElement | null;
  const actionWrap = item.querySelector('.ew-floating-notice__actions') as HTMLElement | null;
  if (actionButton && actionWrap) {
    if (input.action) {
      actionWrap.style.display = '';
      actionButton.style.display = '';
      actionButton.textContent = input.action.label;
      actionButton.dataset.kind = input.action.kind ?? 'neutral';
    } else {
      actionWrap.style.display = 'none';
      actionButton.style.display = 'none';
      actionButton.textContent = '';
      actionButton.dataset.kind = 'neutral';
    }
  }

  if (input.persist) {
    progress.style.display = 'none';
    progress.style.animationDuration = '';
  } else {
    const duration = Math.max(1400, input.duration_ms ?? 3200);
    progress.style.display = '';
    progress.style.animationDuration = `${duration}ms`;
  }
}

export function showManagedEwNotice(input: EwNoticeInput): EwNoticeHandle {
  const initialDuration = Math.max(1400, input.duration_ms ?? 3200);

  const doc = resolveNoticeDocument();
  ensureStyle(doc);
  const host = ensureHost(doc);

  const item = doc.createElement('article');
  item.className = 'ew-floating-notice';

  const icon = doc.createElement('span');
  icon.className = 'ew-floating-notice__icon';

  const content = doc.createElement('div');
  content.className = 'ew-floating-notice__content';

  const title = doc.createElement('h4');
  title.className = 'ew-floating-notice__title';
  title.textContent = input.title;

  const message = doc.createElement('p');
  message.className = 'ew-floating-notice__message';
  message.textContent = input.message;

  const actions = doc.createElement('div');
  actions.className = 'ew-floating-notice__actions';

  const actionButton = doc.createElement('button');
  actionButton.className = 'ew-floating-notice__action';
  actionButton.type = 'button';
  actionButton.style.display = 'none';
  actionButton.dataset.kind = 'neutral';

  const closeButton = doc.createElement('button');
  closeButton.className = 'ew-floating-notice__close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭提示');
  closeButton.textContent = '×';

  const progress = doc.createElement('div');
  progress.className = 'ew-floating-notice__progress';

  content.appendChild(title);
  content.appendChild(message);
  actions.appendChild(actionButton);
  content.appendChild(actions);
  item.appendChild(icon);
  item.appendChild(content);
  item.appendChild(closeButton);
  item.appendChild(progress);

  applyNoticeState(item, input, progress);

  let closed = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let currentAction = input.action?.onClick ?? null;

  const clearCloseTimer = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const close = () => {
    if (closed) {
      return;
    }
    clearCloseTimer();
    closed = true;
    item.classList.add('ew-floating-notice--out');
    setTimeout(() => {
      item.remove();
      if (!host.childElementCount) {
        host.remove();
      }
    }, 170);
  };

  const scheduleAutoClose = (nextInput: EwNoticeInput) => {
    clearCloseTimer();
    if (nextInput.persist) {
      return;
    }

    const duration = Math.max(1400, nextInput.duration_ms ?? initialDuration);
    closeTimer = setTimeout(close, duration);
  };

  const update = (nextInput: EwNoticeInput) => {
    if (closed) {
      return;
    }

    currentAction = nextInput.action?.onClick ?? null;
    applyNoticeState(item, nextInput, progress);
    scheduleAutoClose(nextInput);
  };

  actionButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    currentAction?.();
  });
  closeButton.addEventListener('click', close);
  scheduleAutoClose(input);

  host.appendChild(item);

  return {
    update,
    dismiss: close,
  };
}

export function showEwNotice(input: EwNoticeInput) {
  showManagedEwNotice(input);
}

function applyWorkflowNoticeState(item: HTMLElement, input: EwWorkflowNoticeInput, progress: HTMLElement) {
  const level = input.level ?? 'info';
  const islands = input.islands ?? [];
  const isActive = islands.length > 0;
  const isCollapsed = item.dataset.collapsed !== 'false';

  item.dataset.level = level;
  item.dataset.busy = input.busy ? 'true' : 'false';
  item.dataset.active = isActive ? 'true' : 'false';

  if (!isActive) {
    item.dataset.collapsed = 'true';
  }

  // JS-driven visibility for idle orb vs stack
  const idleOrb = item.querySelector('.ew-workflow-notice__idle-orb') as HTMLElement | null;
  const stack = item.querySelector('.ew-workflow-notice__stack') as HTMLElement | null;
  if (idleOrb) {
    idleOrb.style.display = isActive ? 'none' : 'block';
  }
  if (stack) {
    stack.style.display = isActive ? 'flex' : 'none';
  }

  item.setAttribute('aria-label', isActive ? `${input.title}\uFF0C${input.message}` : input.title);

  const actionButton = item.querySelector('.ew-workflow-notice__action') as HTMLButtonElement | null;
  if (actionButton) {
    if (input.action) {
      actionButton.style.display = '';
      actionButton.textContent = input.action.label;
      actionButton.dataset.kind = input.action.kind ?? 'neutral';
    } else {
      actionButton.style.display = 'none';
      actionButton.textContent = '';
      actionButton.dataset.kind = 'neutral';
    }
  }

  if (stack) {
    reconcileWorkflowNoticeStack(stack, islands, isCollapsed);
  }

  if (input.persist) {
    progress.style.display = 'none';
    progress.style.animationDuration = '';
  } else {
    const duration = Math.max(1400, input.duration_ms ?? 3200);
    progress.style.display = '';
    progress.style.animationDuration = `${duration}ms`;
  }
}

function createWorkflowStackItem(doc: Document, island: EwWorkflowNoticeIslandInput) {
  const row = doc.createElement('div');
  row.className = 'ew-workflow-notice__row';
  row.dataset.itemId = island.id;

  const name = doc.createElement('span');
  name.className = 'ew-workflow-notice__row-slot ew-workflow-notice__row-slot--name';

  const orb = doc.createElement('span');
  orb.className = 'ew-workflow-notice__row-orb';

  const content = doc.createElement('span');
  content.className = 'ew-workflow-notice__row-slot ew-workflow-notice__row-slot--content';

  const contentText = doc.createElement('span');
  contentText.className = 'ew-workflow-notice__row-content-text';

  const extra = doc.createElement('span');
  extra.className = 'ew-workflow-notice__row-extra';
  extra.setAttribute('aria-hidden', 'true');

  row.appendChild(name);
  row.appendChild(orb);
  content.appendChild(contentText);
  row.appendChild(content);
  row.appendChild(extra);

  applyWorkflowStackItemState(row, island);
  return row;
}

function applyWorkflowStackItemState(row: HTMLElement, island: EwWorkflowNoticeIslandInput) {
  row.dataset.itemId = island.id;
  row.dataset.tone = island.tone ?? 'streaming';
  row.dataset.hasExtra = (island.extra_count ?? 0) > 0 ? 'true' : 'false';
  row.classList.remove('ew-workflow-notice__row--out');

  const name = row.querySelector('.ew-workflow-notice__row-slot--name');
  if (name) {
    name.textContent = island.entry_name?.trim() || '未命名工作流';
  }

  const contentText = row.querySelector('.ew-workflow-notice__row-content-text');
  if (contentText) {
    contentText.textContent = island.content?.trim() || '正在等待首段输出…';
  }

  const extra = row.querySelector('.ew-workflow-notice__row-extra');
  if (extra) {
    extra.textContent = (island.extra_count ?? 0) > 0 ? `+${island.extra_count}` : '';
  }
}

function reconcileWorkflowNoticeStack(stack: HTMLElement, islands: EwWorkflowNoticeIslandInput[], collapsed: boolean) {
  const doc = stack.ownerDocument;
  const existing = new Map<string, HTMLElement>();

  Array.from(stack.children).forEach(child => {
    if (child instanceof HTMLElement && child.dataset.itemId) {
      existing.set(child.dataset.itemId, child);
    }
  });

  const nextIds = new Set<string>();
  islands.forEach((island, index) => {
    if (!island.id.trim()) {
      return;
    }

    nextIds.add(island.id);
    const current = existing.get(island.id) ?? createWorkflowStackItem(doc, island);
    applyWorkflowStackItemState(current, island);
    current.dataset.rowIndex = String(index);
    current.dataset.removing = 'false';

    // JS-driven visibility: hide non-first rows when collapsed
    if (collapsed && index > 0) {
      current.style.display = 'none';
    } else {
      current.style.display = '';
    }
    console.warn(`[EW-NOTICE] row ${index}/${islands.length}: id=${island.id}, collapsed=${collapsed}, display=${current.style.display}, extra=${island.extra_count ?? 0}`);

    // JS-driven +N badge visibility: only on first row when collapsed
    const extraBadge = current.querySelector('.ew-workflow-notice__row-extra') as HTMLElement | null;
    if (extraBadge) {
      if (collapsed && index === 0 && (island.extra_count ?? 0) > 0) {
        extraBadge.style.display = 'inline-flex';
      } else {
        extraBadge.style.display = 'none';
      }
    }

    stack.appendChild(current);
  });

  for (const [id, current] of existing) {
    if (nextIds.has(id) || current.dataset.removing === 'true') {
      continue;
    }

    current.dataset.removing = 'true';
    current.classList.add('ew-workflow-notice__row--out');
    setTimeout(() => current.remove(), 190);
  }
}

export function showManagedWorkflowNotice(input: EwWorkflowNoticeInput): EwWorkflowNoticeHandle {
  const initialDuration = Math.max(1400, input.duration_ms ?? 3200);
  const doc = resolveNoticeDocument();
  ensureWorkflowStyle(doc);
  const host = ensureWorkflowHost(doc);

  console.warn('[EW-NOTICE] showManagedWorkflowNotice called. doc:', doc === document ? 'window.document' : 'chat iframe');

  // Module-level singleton: dismiss previous notice (may be in a different document)
  if (_currentWorkflowHandle) {
    try { _currentWorkflowHandle.dismiss(); } catch { /* already removed */ }
    _currentWorkflowHandle = null;
  }

  // Also purge any stale workflow notices from ALL known documents
  const docsToClean: Document[] = [doc];
  try {
    if (doc !== document) docsToClean.push(document);
    const parentDoc = window.parent?.document;
    if (parentDoc && parentDoc !== doc && parentDoc !== document) docsToClean.push(parentDoc);
  } catch { /* cross-origin */ }
  for (const d of docsToClean) {
    try {
      const found = d.querySelectorAll('.ew-workflow-notice');
      console.warn('[EW-NOTICE] purging', found.length, 'articles from', d === document ? 'window.document' : 'other doc');
      found.forEach(el => el.remove());
    } catch { /* */ }
  }

  const item = doc.createElement('article');
  item.className = 'ew-workflow-notice';
  item.dataset.collapsed = 'true';
  item.dataset.active = 'false';

  const controls = doc.createElement('div');
  controls.className = 'ew-workflow-notice__controls';

  const actionButton = doc.createElement('button');
  actionButton.className = 'ew-workflow-notice__action';
  actionButton.type = 'button';
  actionButton.style.display = 'none';
  actionButton.dataset.kind = 'neutral';

  const closeButton = doc.createElement('button');
  closeButton.className = 'ew-workflow-notice__close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭提示');
  closeButton.textContent = '×';

  const idleOrb = doc.createElement('span');
  idleOrb.className = 'ew-workflow-notice__idle-orb';
  idleOrb.setAttribute('aria-hidden', 'true');

  const stack = doc.createElement('div');
  stack.className = 'ew-workflow-notice__stack';

  const progress = doc.createElement('div');
  progress.className = 'ew-workflow-notice__progress';

  controls.appendChild(actionButton);
  controls.appendChild(closeButton);
  item.appendChild(controls);
  item.appendChild(idleOrb);
  item.appendChild(stack);
  item.appendChild(progress);

  let closed = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let currentAction = input.action?.onClick ?? null;
  let currentInput: EwWorkflowNoticeInput = input;

  const clearCloseTimer = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const clearCollapseTimer = () => {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
  };

  const collapse = () => {
    if (closed) {
      return;
    }
    clearCollapseTimer();
    item.dataset.collapsed = 'true';
    applyWorkflowNoticeState(item, currentInput, progress);
  };

  const expand = () => {
    if (closed) {
      return;
    }
    item.dataset.collapsed = 'false';
    applyWorkflowNoticeState(item, currentInput, progress);
  };

  const close = () => {
    if (closed) {
      return;
    }
    clearCloseTimer();
    clearCollapseTimer();
    closed = true;
    item.classList.add('ew-workflow-notice--out');
    setTimeout(() => {
      item.remove();
      if (!host.childElementCount) {
        host.remove();
      }
    }, 170);
  };

  const scheduleAutoClose = (nextInput: EwWorkflowNoticeInput) => {
    clearCloseTimer();
    if (nextInput.persist) {
      return;
    }

    const duration = Math.max(1400, nextInput.duration_ms ?? initialDuration);
    closeTimer = setTimeout(close, duration);
  };

  const scheduleCollapse = (nextInput: EwWorkflowNoticeInput) => {
    if (item.dataset.collapsed === 'true') {
      return;
    }

    if ((nextInput.collapse_after_ms ?? 0) <= 0) {
      clearCollapseTimer();
      return;
    }

    if (collapseTimer) {
      return;
    }

    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      collapse();
    }, nextInput.collapse_after_ms);
  };

  const update = (nextInput: EwWorkflowNoticeInput) => {
    if (closed) {
      return;
    }
    currentInput = nextInput;
    currentAction = nextInput.action?.onClick ?? null;
    applyWorkflowNoticeState(item, nextInput, progress);
    scheduleAutoClose(nextInput);
    scheduleCollapse(nextInput);
  };

  applyWorkflowNoticeState(item, input, progress);
  scheduleAutoClose(input);
  scheduleCollapse(input);

  actionButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    currentAction?.();
  });
  closeButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  item.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.ew-workflow-notice__action') || target?.closest('.ew-workflow-notice__close')) {
      return;
    }
    if (item.dataset.active !== 'true') {
      return;
    }
    if (item.dataset.collapsed === 'true') {
      expand();
      scheduleCollapse(currentInput);
      return;
    }
    collapse();
  });

  host.appendChild(item);
  console.warn('[EW-NOTICE] new article appended. Total articles in host:', host.querySelectorAll('.ew-workflow-notice').length);

  const handle: EwWorkflowNoticeHandle = {
    update,
    dismiss: close,
    collapse,
    expand,
  };

  _currentWorkflowHandle = handle;
  return handle;
}
