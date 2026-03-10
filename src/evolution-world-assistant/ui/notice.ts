export type EwNoticeLevel = 'success' | 'error' | 'info' | 'warning';

export type EwNoticeInput = {
  title: string;
  message: string;
  level?: EwNoticeLevel;
  duration_ms?: number;
  persist?: boolean;
  busy?: boolean;
  action?: {
    label: string;
    onClick: () => void;
    kind?: 'neutral' | 'danger';
  };
};

export type EwNoticeHandle = {
  update: (nextInput: EwNoticeInput) => void;
  dismiss: () => void;
};

const STYLE_ID = 'ew-floating-notice-style';
const HOST_ID = 'ew-floating-notice-host';

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
