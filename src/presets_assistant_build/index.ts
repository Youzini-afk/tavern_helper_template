import { createApp, type App as VueApp } from 'vue';
import { createPinia } from 'pinia';

import { teleportStyle } from '@util/script';
import PresetAssistantApp from './App.vue';

const MENU_ID = 'preset-assistant-menu-item';
const PANEL_ID = 'preset-assistant-panel';
const PANEL_STYLE_ID = 'preset-assistant-panel-style';
const PANEL_BODY_ID = 'preset-assistant-panel-body';
const EVENT_NS = '.presetAssistantMenu';
const DIRTY_STATE_KEY = '__PRESET_ASSISTANT_HAS_UNSAVED_CHANGES__';

let app: VueApp<Element> | null = null;
let panelRoot: JQuery<HTMLDivElement> | null = null;
let destroyTeleport: (() => void) | null = null;
let menuObserver: MutationObserver | null = null;
let menuRetryTimer: number | null = null;
let panelVisible = false;

function getHostWindow(): Window {
  return window.parent || window;
}

function getHostDocument(): Document {
  return getHostWindow().document;
}

function ensurePanelStyle(): void {
  const doc = getHostDocument();
  if (doc.getElementById(PANEL_STYLE_ID)) {
    return;
  }
  const style = doc.createElement('style');
  style.id = PANEL_STYLE_ID;
  style.textContent = `
#${PANEL_ID} {
  position: fixed;
  z-index: 10020;
  left: 50%;
  transform: translateX(-50%);
  top: 10px;
  width: min(1080px, calc(100vw - 36px));
  height: calc(100vh - 20px);
  min-width: 720px;
  min-height: 620px;
  max-width: calc(100vw - 12px);
  max-height: calc(100vh - 12px);
  display: none;
  border: 1px solid #334866;
  border-radius: 14px;
  background: #070f1f;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  resize: both;
}

#${PANEL_ID}.active {
  display: flex;
  flex-direction: column;
}

#${PANEL_ID} .preset-assistant-header {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 12px;
  background: #101a2f;
  border-bottom: 1px solid #334866;
  cursor: move;
  user-select: none;
}

#${PANEL_ID} .preset-assistant-header-title {
  color: #e7efff;
  font-size: 14px;
  font-weight: 600;
}

#${PANEL_ID} .preset-assistant-header-actions {
  display: inline-flex;
  gap: 6px;
}

#${PANEL_ID} .preset-assistant-tool,
#${PANEL_ID} .preset-assistant-close {
  width: 30px;
  height: 30px;
  border: 1px solid #4b6389;
  border-radius: 7px;
  background: #1a2743;
  color: #e7efff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

#${PANEL_ID} .preset-assistant-tool:hover {
  border-color: #4f85ee;
}

#${PANEL_ID} .preset-assistant-close:hover {
  border-color: #de5f74;
}

#${PANEL_BODY_ID} {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

#${PANEL_BODY_ID} > div {
  height: 100%;
}

#${PANEL_BODY_ID} .preset-assistant-app-root {
  width: 100%;
  height: 100%;
}

#${MENU_ID}.active {
  background-color: rgba(63, 123, 240, 0.16) !important;
}

@media (max-width: 960px) {
  #${PANEL_ID} {
    left: 0;
    transform: none;
    top: 0;
    width: 100vw;
    height: 100vh;
    min-width: unset;
    min-height: unset;
    border-radius: 0;
    max-width: 100vw;
    max-height: 100vh;
    resize: none;
  }
}
`;
  doc.head.append(style);
}

function mountAppIntoPanel(): void {
  if (panelRoot?.length) {
    return;
  }
  const doc = getHostDocument();
  const body = doc.getElementById(PANEL_BODY_ID);
  if (!body) {
    return;
  }
  panelRoot = $(doc.createElement('div')).addClass('preset-assistant-app-root').appendTo(body as unknown as JQuery);
  try {
    destroyTeleport = teleportStyle(doc.head).destroy;
    app = createApp(PresetAssistantApp);
    app.use(createPinia());
    app.mount(panelRoot[0]);
  } catch (error) {
    console.error('[PresetAssistant] mount app failed:', error);
    toastr.error('预设助手初始化失败，请查看控制台报错', 'Preset Assistant');
    app?.unmount();
    app = null;
    destroyTeleport?.();
    destroyTeleport = null;
    panelRoot.remove();
    panelRoot = null;
  }
}

function enablePanelDrag(panel: HTMLDivElement): void {
  const hostWin = getHostWindow();
  const handle = panel.querySelector('.preset-assistant-header') as HTMLDivElement | null;
  if (!handle) {
    return;
  }
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const onMove = (event: MouseEvent) => {
    if (!dragging) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(6, hostWin.innerWidth - rect.width - 6);
    const maxTop = Math.max(6, hostWin.innerHeight - rect.height - 6);
    const nextLeft = Math.min(maxLeft, Math.max(6, event.clientX - offsetX));
    const nextTop = Math.min(maxTop, Math.max(6, event.clientY - offsetY));
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.transform = 'none';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const onUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    hostWin.document.removeEventListener('mousemove', onMove, true);
    hostWin.document.removeEventListener('mouseup', onUp, true);
  };

  handle.addEventListener('mousedown', event => {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    dragging = true;
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.transform = 'none';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    hostWin.document.addEventListener('mousemove', onMove, true);
    hostWin.document.addEventListener('mouseup', onUp, true);
    event.preventDefault();
  });
}

function ensurePanelElement(): JQuery {
  const doc = getHostDocument();
  let $panel = $(`#${PANEL_ID}`, doc);
  if ($panel.length) {
    return $panel;
  }
  ensurePanelStyle();
  $('body', doc).append(`
<div id="${PANEL_ID}">
  <div class="preset-assistant-header">
    <div class="preset-assistant-header-title">预设助手</div>
    <div class="preset-assistant-header-actions">
      <button type="button" class="preset-assistant-tool preset-assistant-refresh" title="刷新">↻</button>
      <button type="button" class="preset-assistant-tool preset-assistant-save" title="保存">💾</button>
      <button type="button" class="preset-assistant-close" title="关闭">✕</button>
    </div>
  </div>
  <div id="${PANEL_BODY_ID}"></div>
</div>
`);
  $panel = $(`#${PANEL_ID}`, doc);
  enablePanelDrag($panel[0] as HTMLDivElement);
  $panel.off(`click${EVENT_NS}`, '.preset-assistant-refresh').on(`click${EVENT_NS}`, '.preset-assistant-refresh', () => {
    window.dispatchEvent(new Event('preset-helper:refresh'));
  });
  $panel.off(`click${EVENT_NS}`, '.preset-assistant-save').on(`click${EVENT_NS}`, '.preset-assistant-save', () => {
    window.dispatchEvent(new Event('preset-helper:save'));
  });
  $panel.off(`click${EVENT_NS}`, '.preset-assistant-close').on(`click${EVENT_NS}`, '.preset-assistant-close', () => {
    hidePanel();
  });
  return $panel;
}

function setMenuActive(active: boolean): void {
  const doc = getHostDocument();
  const $menuItem = $(`#${MENU_ID}`, doc);
  if ($menuItem.length) {
    $menuItem.toggleClass('active', active);
  }
}

function showPanel(): void {
  const doc = getHostDocument();
  const $panel = ensurePanelElement();
  mountAppIntoPanel();
  $panel.addClass('active');
  panelVisible = true;
  setMenuActive(true);
  window.dispatchEvent(new Event('preset-helper:refresh'));
  $(`#${MENU_ID}`, doc).blur();
}

function hasUnsavedChanges(): boolean {
  const current = window as unknown as Record<string, unknown>;
  const host = getHostWindow() as unknown as Record<string, unknown>;
  return current[DIRTY_STATE_KEY] === true || host[DIRTY_STATE_KEY] === true;
}

function hidePanel(): boolean {
  if (hasUnsavedChanges() && !confirm('当前有未保存改动，确认关闭预设助手吗？')) {
    return false;
  }
  if (hasUnsavedChanges()) {
    window.dispatchEvent(new Event('preset-helper:discard'));
    const current = window as unknown as Record<string, unknown>;
    const host = getHostWindow() as unknown as Record<string, unknown>;
    current[DIRTY_STATE_KEY] = false;
    host[DIRTY_STATE_KEY] = false;
  }
  $(`#${PANEL_ID}`, getHostDocument()).removeClass('active');
  panelVisible = false;
  setMenuActive(false);
  return true;
}

function togglePanel(): void {
  if (panelVisible) {
    hidePanel();
    return;
  }
  showPanel();
}

function ensureMenuItem(): boolean {
  const doc = getHostDocument();
  const $menu = $('#extensionsMenu', doc);
  if (!$menu.length) {
    return false;
  }
  const $existing = $(`#${MENU_ID}`, doc);
  if ($existing.length && !$existing.closest('#extensionsMenu').length) {
    $existing.remove();
  }
  if (!$(`#${MENU_ID}`, doc).length) {
    $menu.append(`
<div id="${MENU_ID}" class="list-group-item flex-container flexGap5 interactable" title="预设助手" tabIndex="0">
  <i class="fa-solid fa-sliders"></i>
  <span>预设助手</span>
</div>
`);
  }
  setMenuActive(panelVisible);
  return true;
}

function startMenuObserver(): void {
  const doc = getHostDocument();
  if (menuObserver) {
    return;
  }
  menuObserver = new MutationObserver(() => {
    ensureMenuItem();
  });
  menuObserver.observe(doc.body, { childList: true, subtree: true });
}

function stopMenuObserver(): void {
  menuObserver?.disconnect();
  menuObserver = null;
}

function ensureMenuRetry(): void {
  if (menuRetryTimer !== null) {
    return;
  }
  menuRetryTimer = window.setInterval(() => {
    if (ensureMenuItem()) {
      window.clearInterval(menuRetryTimer as number);
      menuRetryTimer = null;
    }
  }, 1000);
}

function stopMenuRetry(): void {
  if (menuRetryTimer === null) {
    return;
  }
  window.clearInterval(menuRetryTimer);
  menuRetryTimer = null;
}

function init(): void {
  replaceScriptButtons([]);
  const doc = getHostDocument();
  $(doc).off(`click${EVENT_NS}`, `#${MENU_ID}`).on(`click${EVENT_NS}`, `#${MENU_ID}`, event => {
    event.preventDefault();
    togglePanel();
  });

  ensurePanelElement();
  if (!ensureMenuItem()) {
    ensureMenuRetry();
  }
  startMenuObserver();
  toastr.success('预设助手已挂载到扩展菜单', 'Preset Assistant');
}

function cleanup(): void {
  const doc = getHostDocument();
  stopMenuRetry();
  stopMenuObserver();
  $(doc).off(EVENT_NS);
  $(`#${MENU_ID}`, doc).remove();
  $(`#${PANEL_ID}`, doc).remove();
  doc.getElementById(PANEL_STYLE_ID)?.remove();
  app?.unmount();
  app = null;
  panelRoot?.remove();
  panelRoot = null;
  destroyTeleport?.();
  destroyTeleport = null;
}

$(() => {
  errorCatched(init)();
});

$(window).on('pagehide', () => {
  cleanup();
});
