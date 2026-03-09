<template>
  <transition name="panel-fade">
    <div
      v-show="store.panelOpen"
      ref="panelRef"
      class="pc-panel"
      :class="['ub-theme-' + store.settings.theme]"
      :style="panelStyle"
  >
    <!-- 标题栏（拖拽手柄） -->
    <div
      ref="headerRef"
      class="pc-panel__header"
    >
      <div class="pc-panel__header-left">
        <i class="fa-solid fa-sliders pc-panel__icon" />
        <span class="pc-panel__title">预设控制</span>
      </div>
      <div class="pc-panel__header-actions">
        <button
          class="pc-panel__header-btn"
          :title="store.settings.theme === 'dark' ? '切换羊皮纸主题' : '切换暗色主题'"
          @click="toggleTheme"
        >
          <i class="fa-solid fa-palette" />
        </button>
        <button
          class="pc-panel__header-btn"
          title="API 配置"
          @click="apiConfigOpen = !apiConfigOpen"
        >
          <i class="fa-solid fa-gear" :class="{ 'icon-rotated': apiConfigOpen }" style="transition: transform 0.3s ease" />
        </button>
        <button class="pc-panel__header-btn" title="关闭" @click="store.panelOpen = false">
          <i class="fa-solid fa-xmark" />
        </button>
      </div>
    </div>

    <!-- API 配置折叠面板 (Grid Transition) -->
    <div class="pc-panel__api-config-wrapper" :class="{ 'pc-panel__api-config-wrapper--open': apiConfigOpen }">
      <div class="pc-panel__api-config">
        <div class="pc-panel__api-row">
          <label class="pc-panel__api-label">API 模式</label>
          <select v-model="store.settings.api.mode" class="pc-panel__api-select">
            <option value="tavern">使用酒馆 API</option>
            <option value="custom">自定义 API</option>
          </select>
        </div>
        <template v-if="store.settings.api.mode === 'custom'">
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">地址</label>
            <input v-model="store.settings.api.custom_url" class="pc-panel__api-input" placeholder="https://api.example.com/v1" />
          </div>
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">密钥</label>
            <input v-model="store.settings.api.custom_key" class="pc-panel__api-input" type="password" placeholder="sk-..." />
          </div>
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">模型</label>
            <select
              v-if="store.modelCandidates.length > 0"
              v-model="store.settings.api.custom_model"
              class="pc-panel__api-select pc-panel__api-model-select"
            >
              <option v-for="m in store.modelCandidates" :key="m" :value="m">{{ m }}</option>
            </select>
            <input
              v-else
              v-model="store.settings.api.custom_model"
              class="pc-panel__api-input"
              placeholder="gpt-4o-mini"
            />
            <button
              class="pc-panel__api-fetch-btn"
              :disabled="store.isLoadingModels"
              title="获取模型列表"
              @click="store.loadModels()"
            >
              <i :class="store.isLoadingModels ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-rotate'" />
            </button>
          </div>
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">源</label>
            <select v-model="store.settings.api.custom_source" class="pc-panel__api-select">
              <option value="openai">OpenAI</option>
              <option value="claude">Claude</option>
              <option value="google">Google</option>
              <option value="deepseek">DeepSeek</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </template>

        <!-- 生成参数（自定义API时显示完整参数，酒馆API仅显示流式开关） -->
        <div class="pc-panel__api-sep">生成参数</div>
        <template v-if="store.settings.api.mode === 'custom'">
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">最大Tokens</label>
            <input v-model.number="store.settings.api.gen_max_tokens" class="pc-panel__api-input" type="number" min="1024" max="200000" step="1024" />
          </div>
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">温度</label>
            <input v-model.number="store.settings.api.gen_temperature" class="pc-panel__api-input" type="number" min="0" max="2" step="0.05" />
          </div>
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">Top P</label>
            <input v-model.number="store.settings.api.gen_top_p" class="pc-panel__api-input" type="number" min="0" max="1" step="0.05" />
          </div>
        </template>
        <div class="pc-panel__api-row">
          <label class="pc-panel__api-label">流式</label>
          <div class="pc-panel__api-toggle" @click="store.settings.api.gen_stream = !store.settings.api.gen_stream">
            <div class="pc-panel__api-toggle-track" :class="{ 'active': store.settings.api.gen_stream }">
              <div class="pc-panel__api-toggle-thumb" />
            </div>
            <span class="pc-panel__api-toggle-text">{{ store.settings.api.gen_stream ? '开启' : '关闭' }}</span>
          </div>
        </div>
        <div class="pc-panel__api-row">
          <label class="pc-panel__api-label">保留用户编辑</label>
          <div class="pc-panel__api-toggle" @click="store.settings.preserve_user_edits = !store.settings.preserve_user_edits">
            <div class="pc-panel__api-toggle-track" :class="{ 'active': store.settings.preserve_user_edits }">
              <div class="pc-panel__api-toggle-thumb" />
            </div>
            <span class="pc-panel__api-toggle-text">{{ store.settings.preserve_user_edits ? '开启' : '关闭' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 主体分栏 -->
    <div class="pc-panel__body">
      <div class="pc-panel__chat-col">
        <ChatArea />
      </div>
      <div class="pc-panel__divider" />
      <div class="pc-panel__control-col">
        <ControlArea />
      </div>
    </div>

    <!-- 拖拽缩放手柄 -->
    <div class="pc-panel__resize pc-panel__resize--right" @mousedown.prevent="onResizeStart($event, 'right')" />
    <div class="pc-panel__resize pc-panel__resize--bottom" @mousedown.prevent="onResizeStart($event, 'bottom')" />
    <div class="pc-panel__resize pc-panel__resize--corner" @mousedown.prevent="onResizeStart($event, 'corner')" />

    <!-- 主题切换径向扩散动画覆盖层 -->
    <div v-if="themeOverlayVisible" class="pc-panel__theme-overlay" :style="themeOverlayStyle" />
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useStore } from './store';
import ChatArea from './ChatArea.vue';
import ControlArea from './ControlArea.vue';

const store = useStore();
const apiConfigOpen = ref(false);
const headerRef = ref<HTMLElement>();

// ---------- 拖拽 ----------
const isDragging = ref(false);
const dragOffset = { x: 0, y: 0 };
const panelPos = ref({
  x: store.settings.panel_x >= 0 ? store.settings.panel_x : -1,
  y: store.settings.panel_y >= 0 ? store.settings.panel_y : -1,
});

const panelStyle = computed(() => ({
  left: `${panelPos.value.x}px`,
  top: `${panelPos.value.y}px`,
  width: `${store.settings.panel_width}px`,
  height: `${store.settings.panel_height}px`,
}));

function onMouseDown(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.pc-panel__header')) return;
  if ((e.target as HTMLElement).closest('.pc-panel__header-btn')) return;
  isDragging.value = true;
  dragOffset.x = e.clientX - panelPos.value.x;
  dragOffset.y = e.clientY - panelPos.value.y;

  // Fix #3: 同时在 iframe document 和 parent document 上添加事件监听
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  try {
    window.parent?.document?.addEventListener('mousemove', onMouseMove);
    window.parent?.document?.addEventListener('mouseup', onMouseUp);
  } catch {
    // 跨域时静默忽略
  }
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  panelPos.value.x = e.clientX - dragOffset.x;
  panelPos.value.y = e.clientY - dragOffset.y;
}

function onMouseUp() {
  isDragging.value = false;
  store.settings.panel_x = panelPos.value.x;
  store.settings.panel_y = panelPos.value.y;
  cleanupDragListeners();
}

function cleanupDragListeners() {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  try {
    window.parent?.document?.removeEventListener('mousemove', onMouseMove);
    window.parent?.document?.removeEventListener('mouseup', onMouseUp);
  } catch {
    // 跨域时静默忽略
  }
}

// ---------- 拖拽缩放 ----------
const MIN_W = 400;
const MIN_H = 300;
const MAX_W = 1400;
const MAX_H = 900;

const isResizing = ref(false);
let resizeDir: 'right' | 'bottom' | 'corner' = 'corner';
let resizeOrigin = { x: 0, y: 0, w: 0, h: 0 };

function onResizeStart(e: MouseEvent, dir: 'right' | 'bottom' | 'corner') {
  isResizing.value = true;
  resizeDir = dir;
  resizeOrigin = {
    x: e.clientX,
    y: e.clientY,
    w: store.settings.panel_width,
    h: store.settings.panel_height,
  };
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
  try {
    window.parent?.document?.addEventListener('mousemove', onResizeMove);
    window.parent?.document?.addEventListener('mouseup', onResizeEnd);
  } catch { /* 跨域静默 */ }
}

function onResizeMove(e: MouseEvent) {
  if (!isResizing.value) return;
  const dx = e.clientX - resizeOrigin.x;
  const dy = e.clientY - resizeOrigin.y;
  if (resizeDir === 'right' || resizeDir === 'corner') {
    store.settings.panel_width = Math.max(MIN_W, Math.min(MAX_W, resizeOrigin.w + dx));
  }
  if (resizeDir === 'bottom' || resizeDir === 'corner') {
    store.settings.panel_height = Math.max(MIN_H, Math.min(MAX_H, resizeOrigin.h + dy));
  }
}

function onResizeEnd() {
  isResizing.value = false;
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  try {
    window.parent?.document?.removeEventListener('mousemove', onResizeMove);
    window.parent?.document?.removeEventListener('mouseup', onResizeEnd);
  } catch { /* 跨域静默 */ }
}

// ============================================================
// 主题切换: 径向扩散 + 全元素 CSS 过渡
// ============================================================
const themeOverlayVisible = ref(false);
const themeOverlayStyle = ref<Record<string, string>>({});

function toggleTheme(e: MouseEvent) {
  if (themeOverlayVisible.value) return;

  const nextTheme = store.settings.theme === 'dark' ? 'parchment' : 'dark';

  // 目标主题的半透明背景色 (让图标透过)
  const targetBg = nextTheme === 'parchment'
    ? 'rgba(246, 239, 221, 0.55)'
    : 'rgba(30, 30, 38, 0.55)';

  // 获取面板和悬浮球
  const btn = (e.currentTarget as HTMLElement).closest('.pc-panel') as HTMLElement | null;
  if (!btn) { store.settings.theme = nextTheme; return; }
  const ball = document.querySelector('.fb-ball')?.closest('[class*="ub-theme"]') as HTMLElement | null;

  const rect = btn.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const endRadius = Math.hypot(
    Math.max(x, rect.width - x),
    Math.max(y, rect.height - y)
  );

  // 1. 启用全元素 CSS 过渡
  btn.classList.add('ub-theme-transitioning');
  ball?.classList.add('ub-theme-transitioning');

  // 2. 显示覆盖层 (半透明，不遮挡图标)
  themeOverlayStyle.value = {
    background: targetBg,
    clipPath: `circle(0px at ${x}px ${y}px)`,
    transition: 'none',
  };
  themeOverlayVisible.value = true;

  // 3. 开始动画
  nextTick(() => {
    requestAnimationFrame(() => {
      themeOverlayStyle.value = {
        background: targetBg,
        clipPath: `circle(${endRadius}px at ${x}px ${y}px)`,
        transition: 'clip-path 800ms ease-in-out',
      };

      // 在动画进行到 60% 时切换真正的主题 (让 CSS 过渡接管)
      setTimeout(() => {
        store.settings.theme = nextTheme;
      }, 480);

      // 动画完全结束后清理
      setTimeout(() => {
        themeOverlayVisible.value = false;
        // 延迟移除过渡类 (等 CSS 过渡完成)
        setTimeout(() => {
          btn.classList.remove('ub-theme-transitioning');
          ball?.classList.remove('ub-theme-transitioning');
        }, 600);
      }, 820);
    });
  });
}

// Fix #11: 合并为一个 onMounted
onMounted(() => {
  // 初始位置居中
  if (panelPos.value.x < 0 || panelPos.value.y < 0) {
    // 获取可视区域尺寸（兼容 iframe 和主文档）
    let w = window.innerWidth;
    let h = window.innerHeight;
    try {
      if (window.parent && window.parent !== window) {
        w = window.parent.innerWidth;
        h = window.parent.innerHeight;
      }
    } catch { /* 跨域静默 */ }
    panelPos.value.x = Math.max(40, (w - store.settings.panel_width) / 2);
    panelPos.value.y = Math.max(40, (h - store.settings.panel_height) / 2);
  }

  // 注册拖拽
  headerRef.value?.addEventListener('mousedown', onMouseDown);
});

onUnmounted(() => {
  headerRef.value?.removeEventListener('mousedown', onMouseDown);
  cleanupDragListeners();
  onResizeEnd();
});
</script>

<style scoped>
.pc-panel {
  position: fixed;
  z-index: 99999;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: var(--ub-bg-solid);
  backdrop-filter: blur(18px) saturate(180%);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid var(--ub-border);
  box-shadow:
    0 8px 32px var(--ub-shadow),
    0 0 0 1px var(--ub-border-light) inset;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif;
  color: var(--ub-text-main);
}

.pc-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--ub-bg-glass);
  border-bottom: 1px solid var(--ub-border);
  cursor: grab;
  user-select: none;
}

.pc-panel__header:active {
  cursor: grabbing;
}

.pc-panel__header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pc-panel__icon {
  font-size: 14px;
  color: var(--ub-accent-text);
}

.pc-panel__title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.pc-panel__header-actions {
  display: flex;
  gap: 4px;
}

.pc-panel__header-btn {
  width: 28px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ub-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.pc-panel__header-btn:hover {
  background: var(--ub-bg-hover);
  color: var(--ub-text-main);
  transform: scale(1.05);
}

.pc-panel__header-btn:active {
  transform: scale(0.95);
}

.icon-rotated {
  transform: rotate(90deg);
}

/* --- Panel Fade Transition --- */
.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
              transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: center center;
}

.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(10px);
}

/* --- API Config Drawer (Grid transition) --- */
.pc-panel__api-config-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  border-bottom: 1px solid transparent;
}

.pc-panel__api-config-wrapper--open {
  grid-template-rows: 1fr;
  border-bottom: 1px solid var(--ub-border);
}

.pc-panel__api-config {
  overflow: hidden;
  padding: 0 14px;
  background: var(--ub-shadow);
  display: flex;
  flex-direction: column;
}

.pc-panel__api-config-wrapper--open .pc-panel__api-config {
  padding: 10px 14px;
}

.pc-panel__api-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.pc-panel__api-row:last-child {
  margin-bottom: 0;
}

.pc-panel__api-label {
  font-size: 12px;
  color: var(--ub-text-muted);
  width: 40px;
  flex-shrink: 0;
  text-align: right;
}

.pc-panel__api-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--ub-border) !important;
  border-radius: 5px;
  background: var(--ub-input-bg) !important;
  color: var(--ub-text-main) !important;
  font-size: 12px;
  outline: none;
  transition: border-color 0.2s;
}

.pc-panel__api-input:focus {
  border-color: var(--ub-accent-border);
}

.pc-panel__api-select {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--ub-border) !important;
  border-radius: 5px;
  background: var(--ub-input-bg) !important;
  color: var(--ub-text-main);
  font-size: 12px;
  outline: none;
}

.pc-panel__api-model-select {
  max-width: none;
}

.pc-panel__api-fetch-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--ub-border);
  border-radius: 5px;
  background: var(--ub-accent-bg);
  color: var(--ub-accent-text);
  cursor: pointer;
  flex-shrink: 0;
  font-size: 12px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.pc-panel__api-fetch-btn:hover:not(:disabled) {
  background: var(--ub-accent-border);
  color: var(--ub-accent-active);
  border-color: var(--ub-accent-border);
}

.pc-panel__api-fetch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pc-panel__api-sep {
  font-size: 11px;
  color: var(--ub-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  padding-top: 6px;
  border-top: 1px solid var(--ub-border);
}

.pc-panel__api-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.pc-panel__api-toggle-track {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--ub-border);
  transition: background 0.2s;
}

.pc-panel__api-toggle-track.active {
  background: var(--ub-accent-active);
}

.pc-panel__api-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.pc-panel__api-toggle-track.active .pc-panel__api-toggle-thumb {
  transform: translateX(16px);
}

.pc-panel__api-toggle-text {
  font-size: 12px;
  color: var(--ub-text-muted);
}

.pc-panel__body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.pc-panel__chat-col {
  flex: 1;
  min-width: 0;
}

.pc-panel__divider {
  width: 1px;
  background: var(--ub-border);
}

.pc-panel__control-col {
  flex: 1;
  min-width: 0;
}

:deep(::-webkit-scrollbar) {
  width: 4px;
}

:deep(::-webkit-scrollbar-track) {
  background: transparent;
}

:deep(::-webkit-scrollbar-thumb) {
  background: var(--ub-border);
  border-radius: 2px;
}

:deep(::-webkit-scrollbar-thumb:hover) {
  background: var(--ub-bg-hover);
}

/* --- Resize Handles --- */
.pc-panel__resize {
  position: absolute;
  z-index: 10;
}

.pc-panel__resize--right {
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
}

.pc-panel__resize--bottom {
  bottom: 0;
  left: 0;
  width: 100%;
  height: 6px;
  cursor: ns-resize;
}

.pc-panel__resize--corner {
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
}

.pc-panel__resize--corner::after {
  content: '';
  position: absolute;
  bottom: 3px;
  right: 3px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--ub-border);
  border-bottom: 2px solid var(--ub-border);
  transition: border-color 0.2s;
}

.pc-panel__resize--corner:hover::after {
  border-color: var(--ub-text-muted);
}

/* 主题切换径向扩散覆盖层 */
.pc-panel__theme-overlay {
  position: absolute;
  inset: 0;
  z-index: 999999;
  pointer-events: none;
  border-radius: inherit;
}
</style>
