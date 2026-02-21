/**
 * 管理界面挂载逻辑
 *
 * 在魔法棒菜单 (#extensionsMenu) 中添加「图片管理」入口
 * 点击后打开管理面板弹窗
 */
import { teleportStyle } from '@util/script';
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

    // 创建面板容器 (桌面端更宽)
    const isDesktop = window.innerWidth > window.innerHeight;
    const $panel = $('<div>')
        .css({
            background: 'var(--SmartThemeBlurTintColor, #1a1a2e)',
            borderRadius: '12px',
            border: '1px solid var(--SmartThemeBorderColor, #444)',
            width: isDesktop ? 'min(900px, 95vw)' : 'min(500px, 90vw)',
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
    // 将 <style scoped> 复制到酒馆网页的 <head> 中, 否则样式不会在 iframe 外生效
    const { destroy: destroyStyle } = teleportStyle();

    // 在魔法棒菜单中添加「图片管理」入口
    const $menuItem = $('<div>')
        .addClass('list-group-item flex-container flexGap5 interactable')
        .attr({ tabindex: '0', role: 'listitem' })
        .on('click', () => openPanel())
        .append(
            $('<div>').addClass('fa-fw fa-solid fa-images extensionsMenuExtensionButton'),
            $('<span>').text('图片管理'),
        );

    const $menuContainer = $('<div>')
        .addClass('extension_container')
        .append($menuItem)
        .appendTo('#extensionsMenu');

    // 卸载时清理: 关闭面板、移除菜单项、销毁传送的样式
    $(window).on('pagehide', () => {
        closePanel();
        $menuContainer.remove();
        destroyStyle();
    });
});
