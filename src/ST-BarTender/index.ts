// ============================================================
// 预设控制脚本入口
// ============================================================

import { createScriptIdIframe, teleportStyle } from '@util/script';
import Panel from './Panel.vue';
import { useStore } from './store';

const MENU_ITEM_NAME = '预设控制';
const MENU_CONTAINER_ID = 'st-bartender-menu-container';
const MENU_ITEM_ID = 'st-bartender-menu-item';
const MENU_EVENT_NS = '.st_bartender';
const MENU_RETRY_MS = 1500;

let $iframe: JQuery<HTMLIFrameElement> | null = null;
let app: ReturnType<typeof createApp> | null = null;
let pinia: ReturnType<typeof createPinia> | null = null;
let styleDestroy: (() => void) | null = null;
let menuRetryTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================
// 1. 魔法棒菜单项注入（与 Evolution World 相同模式）
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
      // 点击后关闭魔法棒菜单
      const $menuButton = $('#extensionsMenuButton', parentDoc);
      if ($menuButton.length && $extensionsMenu.is(':visible')) {
        $menuButton.trigger('click');
      }
      togglePanel();
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
// 2. 悬浮面板（独立 iframe）
// ============================================================

function togglePanel() {
  if ($iframe) {
    $iframe.toggle();
    return;
  }
  openPanel();
}

function openPanel() {
  pinia = createPinia();
  app = createApp(Panel).use(pinia);

  $iframe = createScriptIdIframe()
    .css({
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      border: 'none',
      'z-index': '99998',
      'pointer-events': 'none',
      background: 'transparent',
    })
    .appendTo('body')
    .on('load', function () {
      const iframeDoc = this.contentDocument!;

      iframeDoc.body.style.cssText = `
        margin: 0;
        padding: 0;
        background: transparent;
        pointer-events: none;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
      `;

      const mountDiv = iframeDoc.createElement('div');
      mountDiv.style.cssText = 'pointer-events: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;';
      iframeDoc.body.appendChild(mountDiv);

      // 注入 Font Awesome
      const faLink = iframeDoc.createElement('link');
      faLink.rel = 'stylesheet';
      faLink.href = 'https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/css/all.min.css';
      iframeDoc.head.appendChild(faLink);

      // 传送样式
      const { destroy } = teleportStyle(iframeDoc.head);
      styleDestroy = destroy;

      // 挂载 Vue
      app!.mount(mountDiv);

      const store = useStore(pinia!);
      store.panelOpen = true;
      store.scanPreset();

      console.info('[预设控制] 面板已挂载');
    });
}

// ============================================================
// 3. 主流程
// ============================================================

$(() => {
  try {
    installMagicWandMenuItem();
  } catch (error) {
    console.error('[预设控制] 魔法棒菜单挂载失败:', error);
  }

  toastr.success('预设控制脚本已加载', '🍸 BarTender', { timeOut: 2000 });
  console.info('[预设控制] 脚本已加载');
});

// ============================================================
// 4. 卸载
// ============================================================

$(window).on('pagehide', () => {
  uninstallMagicWandMenuItem();
  app?.unmount();
  $iframe?.remove();
  styleDestroy?.();
  app = null;
  $iframe = null;
  pinia = null;
  styleDestroy = null;
});
