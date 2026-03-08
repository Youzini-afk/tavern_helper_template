// ============================================================
// 预设控制脚本入口
// ============================================================

import { createScriptIdDiv, createScriptIdIframe, teleportStyle } from '@util/script';
import Panel from './Panel.vue';
import { useStore } from './store';

const SCRIPT_NAME = '预设控制';

$(() => {
  // ============================================================
  // 1. 在魔法棒面板（#extensions_settings2）中注册入口按钮
  // ============================================================
  const $trigger = createScriptIdDiv().appendTo('#extensions_settings2');

  const triggerApp = createApp({
    template: `
      <div class="preset-control-trigger" @click="toggle">
        <i class="fa-solid fa-sliders"></i>
        <span>${SCRIPT_NAME}</span>
      </div>
    `,
    setup() {
      return {
        toggle() {
          togglePanel();
        },
      };
    },
  });
  triggerApp.mount($trigger[0]);

  // 将触发按钮样式注入到酒馆页面
  const { destroy: destroyTriggerStyle } = teleportStyle();

  // ============================================================
  // 2. 悬浮面板（独立 iframe）
  // ============================================================
  let $iframe: JQuery<HTMLIFrameElement> | null = null;
  let panelApp: ReturnType<typeof createApp> | null = null;
  let pinia: ReturnType<typeof createPinia> | null = null;
  let destroyPanelStyle: (() => void) | null = null;

  function togglePanel() {
    if ($iframe) {
      $iframe.toggle();
      return;
    }
    openPanel();
  }

  function openPanel() {
    pinia = createPinia();
    panelApp = createApp(Panel).use(pinia);

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
        mountDiv.style.cssText = 'pointer-events: auto; position: fixed; top: 0; left: 0;';
        iframeDoc.body.appendChild(mountDiv);

        // 注入 Font Awesome
        const faLink = iframeDoc.createElement('link');
        faLink.rel = 'stylesheet';
        faLink.href = 'https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/css/all.min.css';
        iframeDoc.head.appendChild(faLink);

        // 传送样式到 iframe
        const { destroy } = teleportStyle(iframeDoc.head);
        destroyPanelStyle = destroy;

        panelApp!.mount(mountDiv);

        const store = useStore(pinia!);
        store.panelOpen = true;
        store.scanPreset();

        console.info('[预设控制] 面板已挂载');
      });
  }

  // ============================================================
  // 3. 卸载
  // ============================================================
  $(window).on('pagehide', () => {
    panelApp?.unmount();
    $iframe?.remove();
    destroyPanelStyle?.();
    triggerApp.unmount();
    $trigger.remove();
    destroyTriggerStyle();

    panelApp = null;
    $iframe = null;
    pinia = null;
    destroyPanelStyle = null;
  });

  console.info('[预设控制] 脚本已加载');
});
