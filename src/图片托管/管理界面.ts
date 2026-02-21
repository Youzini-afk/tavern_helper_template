/**
 * 管理界面挂载逻辑
 *
 * 通过脚本按钮打开管理面板弹窗
 */
import 管理面板 from './管理面板.vue';

let isOpen = false;
let app: ReturnType<typeof createApp> | null = null;
let $overlay: JQuery | null = null;

function openPanel() {
    if (isOpen) return;
    isOpen = true;

    // 创建遮罩层
    $overlay = $('<div>')
        .css({
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 99990,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })
        .appendTo('body')
        .on('click', (e) => {
            if (e.target === $overlay![0]) closePanel();
        });

    // 创建面板容器
    const $panel = $('<div>')
        .css({
            background: 'var(--SmartThemeBlurTintColor, #1a1a2e)',
            borderRadius: '12px',
            border: '1px solid var(--SmartThemeBorderColor, #444)',
            width: 'min(500px, 90vw)',
            maxHeight: '85vh',
            overflow: 'auto',
            padding: '15px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        })
        .appendTo($overlay);

    // 挂载 Vue 组件
    app = createApp(管理面板).use(createPinia());
    app.mount($panel[0]);
}

function closePanel() {
    if (!isOpen) return;
    isOpen = false;

    app?.unmount();
    app = null;
    $overlay?.remove();
    $overlay = null;
}

$(() => {
    // 添加脚本按钮
    appendInexistentScriptButtons([{ name: '图片管理', visible: true }]);

    // 监听按钮点击
    eventOn(getButtonEvent('图片管理'), () => {
        openPanel();
    });

    // 卸载时清理
    $(window).on('pagehide', () => {
        closePanel();
    });
});
