// ============================================================
// 预设控制脚本入口
// ============================================================

import { createScriptIdDiv } from '@util/script';
import './theme.css';
import AppRoot from './AppRoot.vue';
import { useStore } from './store';

const MENU_ITEM_NAME = '预设控制';
const MENU_CONTAINER_ID = 'st-preset-assistant-menu-container';
const MENU_ITEM_ID = 'st-preset-assistant-menu-item';
const MENU_EVENT_NS = '.st_preset_assistant';
const MENU_RETRY_MS = 1500;

let app: ReturnType<typeof createApp> | null = null;
let $appRoot: JQuery<HTMLDivElement> | null = null;

let destroyStyle: (() => void) | null = null;
let menuRetryTimer: ReturnType<typeof setTimeout> | null = null;
let styleObserver: MutationObserver | null = null;

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
function resolveParentHead(): HTMLElement {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent.document.head;
    }
  } catch { /* 跨域静默 */ }
  return document.head;
}

/**
 * 持续同步 iframe <head> 的 <style> 标签到 parent document <head>
 * vue-style-loader 在组件挂载时才注入 <style>，所以必须持续监控而非一次性复制
 */
function setupContinuousStyleSync() {
  const parentHead = resolveParentHead();
  const iframeHead = document.head;
  const scriptId = getScriptId();

  // 用于追踪已同步的 style 元素（避免重复复制）
  const syncedStyles = new WeakSet<Node>();

  // 获取同步容器（整个生命周期复用）
  let $syncContainer = $(parentHead).find(`div[script_id="${scriptId}"]`);
  if (!$syncContainer.length) {
    $syncContainer = $('<div>').attr('script_id', scriptId).appendTo(parentHead);
  }

  // 同步当前已存在的 style 标签
  function syncExistingStyles() {
    $(iframeHead).find('style').each(function () {
      if (!syncedStyles.has(this)) {
        syncedStyles.add(this);
        $syncContainer.append($(this).clone());
      }
    });
  }

  // 初次同步
  syncExistingStyles();

  // 监控新增的 style 标签
  styleObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLStyleElement && !syncedStyles.has(node)) {
          syncedStyles.add(node);
          $syncContainer.append($(node).clone());
        }
      }
    }
  });

  styleObserver.observe(iframeHead, { childList: true });

  destroyStyle = () => {
    styleObserver?.disconnect();
    styleObserver = null;
    $syncContainer.remove();
  };
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
// 2. 挂载唯一 Vue 应用（含悬浮球 + 面板）
// ============================================================

function mountApp() {
  if (app) return;

  app = createApp(AppRoot).use(pinia);
  // 挂载到 parent document body，绕过 iframe 移动端视口不可见问题
  $appRoot = createScriptIdDiv().appendTo(resolveParentBody());
  app.mount($appRoot[0]);

  // 持续同步样式到 parent document（vue-style-loader 会在组件挂载时动态注入 style 标签）
  setupContinuousStyleSync();

  const store = useStore(pinia);

  // 初始化文件持久化 (异步，不阻塞 UI)
  store.initConfigStorage();

  // 如果上次 panelOpen=true 被持久化，恢复时自动扫描预设
  if (store.panelOpen) {
    store.scanPreset();
  }

  // 监听 show_in_wand → 动态安装/卸载魔法棒菜单项
  watch(() => store.settings.show_in_wand, (show) => {
    if (show) {
      installMagicWandMenuItem();
    } else {
      uninstallMagicWandMenuItem();
    }
  });

  console.info('[预设控制] 应用已挂载');
}

// ============================================================
// 3. 打开主面板（供魔法棒菜单、悬浮球齿轮调用）
// ============================================================

function openMainPanel() {
  const store = useStore(pinia);
  store.panelOpen = true;
  store.scanPreset();
  // DEBUG: 验证魔法棒路径
  try { toastr.info(`[魔法棒] panelOpen=${store.panelOpen}`, '🔧 DEBUG'); } catch {}
}

// ============================================================
// 4. 主流程
// ============================================================

$(() => {
  try {
    mountApp();
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

  app?.unmount();
  app = null;
  $appRoot?.remove();
  $appRoot = null;

  destroyStyle?.();
  destroyStyle = null;
});

