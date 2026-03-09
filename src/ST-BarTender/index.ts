// ============================================================
// 预设控制脚本入口
// ============================================================

import { createScriptIdDiv, teleportStyle } from '@util/script';
import './theme.css';
import Panel from './Panel.vue';
import FloatingBall from './FloatingBall.vue';
import { useStore } from './store';

const MENU_ITEM_NAME = '预设控制';
const MENU_CONTAINER_ID = 'st-preset-assistant-menu-container';
const MENU_ITEM_ID = 'st-preset-assistant-menu-item';
const MENU_EVENT_NS = '.st_preset_assistant';
const MENU_RETRY_MS = 1500;

let panelApp: ReturnType<typeof createApp> | null = null;
let $panelRoot: JQuery<HTMLDivElement> | null = null;

let ballApp: ReturnType<typeof createApp> | null = null;
let $ballRoot: JQuery<HTMLDivElement> | null = null;

let destroyStyle: (() => void) | null = null;
let menuRetryTimer: ReturnType<typeof setTimeout> | null = null;

/** 获取挂载目标 body —— 优先使用 parent document（绕过 iframe 的触摸事件限制） */
function resolveParentBody(): HTMLElement {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent.document.body;
    }
  } catch { /* 跨域静默 */ }
  return document.body;
}

/** 获取挂载目标 head */
function resolveParentHead(): JQuery {
  try {
    if (window.parent && window.parent !== window) {
      return $('head', window.parent.document);
    }
  } catch { /* 跨域静默 */ }
  return $('head');
}

// 共享 Pinia 实例
const pinia = createPinia();

// ============================================================
// 1. 魔法棒菜单项注入
// ============================================================

function resolveParentDocument(): Document {
  try {
    return (window.parent && window.parent !== window ? window.parent : window).document;
  } catch {
    return document;
  }
}

function clearMenuRetryTimer() {
  if (!menuRetryTimer) return;
  clearTimeout(menuRetryTimer);
  menuRetryTimer = null;
}

function scheduleMenuRetry() {
  if (menuRetryTimer) return;
  menuRetryTimer = setTimeout(() => {
    menuRetryTimer = null;
    installMagicWandMenuItem();
  }, MENU_RETRY_MS);
}

function installMagicWandMenuItem() {
  const parentDoc = resolveParentDocument();
  const $extensionsMenu = $('#extensionsMenu', parentDoc);
  if (!$extensionsMenu.length) {
    scheduleMenuRetry();
    return;
  }

  clearMenuRetryTimer();

  let $menuContainer = $(`#${MENU_CONTAINER_ID}`, $extensionsMenu);
  if (!$menuContainer.length) {
    $menuContainer = $(
      `<div class="extension_container interactable" id="${MENU_CONTAINER_ID}" tabindex="0"></div>`,
    );
    $extensionsMenu.append($menuContainer);
  }

  let $menuItem = $(`#${MENU_ITEM_ID}`, $menuContainer);
  if (!$menuItem.length) {
    $menuItem = $(
      `<div class="list-group-item flex-container flexGap5 interactable" id="${MENU_ITEM_ID}" title="打开预设控制面板"><div class="fa-fw fa-solid fa-sliders extensionsMenuExtensionButton"></div><span>${MENU_ITEM_NAME}</span></div>`,
    );
    $menuContainer.append($menuItem);
  }

  $menuItem
    .off(`click${MENU_EVENT_NS}`)
    .on(`click${MENU_EVENT_NS}`, event => {
      event.stopPropagation();
      const $menuButton = $('#extensionsMenuButton', parentDoc);
      if ($menuButton.length && $extensionsMenu.is(':visible')) {
        $menuButton.trigger('click');
      }
      openMainPanel();
    });
}

function uninstallMagicWandMenuItem() {
  clearMenuRetryTimer();
  const parentDoc = resolveParentDocument();
  const $menuContainer = $(`#${MENU_CONTAINER_ID}`, parentDoc);
  $menuContainer.find(`#${MENU_ITEM_ID}`).off(`click${MENU_EVENT_NS}`);
  $menuContainer.remove();
}

// ============================================================
// 2. 悬浮球（始终挂载）
// ============================================================

function mountFloatingBall() {
  if (ballApp) return;

  ballApp = createApp(FloatingBall).use(pinia);
  // 挂载到 parent document body，绕过 iframe 移动端触摸事件不可达的问题
  $ballRoot = createScriptIdDiv().appendTo(resolveParentBody());
  ballApp.mount($ballRoot[0]);

  const style = teleportStyle(resolveParentHead());
  destroyStyle = style.destroy;

  // 监听 panelOpen → 自动挂载并打开面板（供悬浮球齿轮按钮触发）
  // immediate: true → 如果上次 panel_open=true 被持久化，刷新后自动恢复面板
  const store = useStore(pinia);

  // 初始化文件持久化 (异步，不阻塞 UI)
  store.initConfigStorage();

  watch(() => store.panelOpen, (open) => {
    if (open) {
      openMainPanel();
    }
  }, { immediate: true });

  // 监听 show_in_wand → 动态安装/卸载魔法棒菜单项
  watch(() => store.settings.show_in_wand, (show) => {
    if (show) {
      installMagicWandMenuItem();
    } else {
      uninstallMagicWandMenuItem();
    }
  });

  console.info('[预设控制] 悬浮球已挂载');
}

// ============================================================
// 3. 主面板（按需挂载）
// ============================================================

function openMainPanel() {
  if (!panelApp) {
    mountPanel();
  }

  const store = useStore(pinia);
  store.panelOpen = true;
  store.scanPreset();
}

function mountPanel() {
  if (panelApp) return;

  panelApp = createApp(Panel).use(pinia);
  // 挂载到 parent document body，绕过 iframe 移动端触摸事件不可达的问题
  $panelRoot = createScriptIdDiv().appendTo(resolveParentBody());
  panelApp.mount($panelRoot[0]);

  console.info('[预设控制] 面板已挂载');
}

// ============================================================
// 4. 主流程
// ============================================================

$(() => {
  try {
    mountFloatingBall();
    // 魔法棒菜单仅在设置开启时安装（watcher 会处理后续变更）
    const store = useStore(pinia);
    if (store.settings.show_in_wand) {
      installMagicWandMenuItem();
    }
  } catch (error) {
    console.error('[预设控制] 初始化失败:', error);
  }

  toastr.success('预设控制脚本已加载', '🎛️ 预设助手', { timeOut: 2000 });
  console.info('[预设控制] 脚本已加载');
});

// ============================================================
// 5. 卸载
// ============================================================

$(window).on('pagehide', () => {
  uninstallMagicWandMenuItem();

  ballApp?.unmount();
  ballApp = null;
  $ballRoot?.remove();
  $ballRoot = null;

  panelApp?.unmount();
  panelApp = null;
  $panelRoot?.remove();
  $panelRoot = null;

  destroyStyle?.();
  destroyStyle = null;
});

