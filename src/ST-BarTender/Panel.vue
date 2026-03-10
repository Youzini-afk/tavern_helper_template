<template>
  <div ref="panelRef" class="pc-panel" :class="['ub-theme-' + store.settings.theme]" :style="panelStyle">
    <!-- 标题栏（拖拽手柄） -->
    <div ref="headerRef" class="pc-panel__header" :class="{ 'pc-panel__header--mobile': store.isMobile }">
      <div class="pc-panel__header-left">
        <i class="fa-solid fa-sliders pc-panel__icon" />
        <span class="pc-panel__title">预设控制</span>
      </div>
      <div class="pc-panel__header-actions">
        <button class="pc-panel__header-btn" title="历史记录" @click="store.historyOpen = true">
          <i class="fa-solid fa-clock-rotate-left" />
        </button>
        <button class="pc-panel__header-btn" title="导出面板" @click="store.exportConfig()">
          <i class="fa-solid fa-file-export" />
        </button>
        <button class="pc-panel__header-btn" title="导入面板" @click="store.importConfig()">
          <i class="fa-solid fa-file-import" />
        </button>
        <button
          class="pc-panel__header-btn"
          :title="store.settings.theme === 'dark' ? '切换羊皮纸主题' : '切换暗色主题'"
          @click="toggleTheme"
        >
          <i class="fa-solid fa-palette" />
        </button>
        <button class="pc-panel__header-btn" title="API 配置" @click="apiConfigOpen = !apiConfigOpen">
          <i
            class="fa-solid fa-gear"
            :class="{ 'icon-rotated': apiConfigOpen }"
            style="transition: transform 0.3s ease"
          />
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
            <input
              v-model="store.settings.api.custom_url"
              class="pc-panel__api-input"
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">密钥</label>
            <input
              v-model="store.settings.api.custom_key"
              class="pc-panel__api-input"
              type="password"
              placeholder="sk-..."
            />
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
            <input
              v-model.number="store.settings.api.gen_max_tokens"
              class="pc-panel__api-input"
              type="number"
              min="1024"
              max="200000"
              step="1024"
            />
          </div>
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">温度</label>
            <input
              v-model.number="store.settings.api.gen_temperature"
              class="pc-panel__api-input"
              type="number"
              min="0"
              max="2"
              step="0.05"
            />
          </div>
          <div class="pc-panel__api-row">
            <label class="pc-panel__api-label">Top P</label>
            <input
              v-model.number="store.settings.api.gen_top_p"
              class="pc-panel__api-input"
              type="number"
              min="0"
              max="1"
              step="0.05"
            />
          </div>
        </template>
        <div class="pc-panel__api-row">
          <label class="pc-panel__api-label">流式</label>
          <div class="pc-panel__api-toggle" @click="store.settings.api.gen_stream = !store.settings.api.gen_stream">
            <div class="pc-panel__api-toggle-track" :class="{ active: store.settings.api.gen_stream }">
              <div class="pc-panel__api-toggle-thumb" />
            </div>
            <span class="pc-panel__api-toggle-text">{{ store.settings.api.gen_stream ? '开启' : '关闭' }}</span>
          </div>
        </div>
        <div class="pc-panel__api-row">
          <label class="pc-panel__api-label">保留用户编辑</label>
          <div
            class="pc-panel__api-toggle"
            @click="store.settings.preserve_user_edits = !store.settings.preserve_user_edits"
          >
            <div class="pc-panel__api-toggle-track" :class="{ active: store.settings.preserve_user_edits }">
              <div class="pc-panel__api-toggle-thumb" />
            </div>
            <span class="pc-panel__api-toggle-text">{{ store.settings.preserve_user_edits ? '开启' : '关闭' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 移动端标签页切换 -->
    <div v-if="store.isMobile" class="pc-panel__mobile-tabs">
      <button class="pc-panel__mobile-tab-btn" :class="{ active: mobileTab === 'chat' }" @click="mobileTab = 'chat'">
        <i class="fa-regular fa-comments" />
        <span>对话</span>
      </button>
      <button
        class="pc-panel__mobile-tab-btn"
        :class="{ active: mobileTab === 'control' }"
        @click="mobileTab = 'control'"
      >
        <i class="fa-solid fa-sliders" />
        <span>控制</span>
      </button>
    </div>

    <!-- 主体分栏 -->
    <div class="pc-panel__body">
      <div v-show="!store.isMobile || mobileTab === 'chat'" class="pc-panel__chat-col">
        <ChatArea />
      </div>
      <div v-if="!store.isMobile" class="pc-panel__divider" />
      <div v-show="!store.isMobile || mobileTab === 'control'" class="pc-panel__control-col">
        <ControlArea />
      </div>
    </div>

    <!-- 拖拽缩放手柄 -->
    <template v-if="!store.isMobile">
      <div class="pc-panel__resize pc-panel__resize--right" @mousedown.prevent="onResizeStart($event, 'right')" />
      <div class="pc-panel__resize pc-panel__resize--bottom" @mousedown.prevent="onResizeStart($event, 'bottom')" />
      <div class="pc-panel__resize pc-panel__resize--corner" @mousedown.prevent="onResizeStart($event, 'corner')" />
    </template>

    <!-- 主题切换径向扩散动画覆盖层 -->
    <div v-if="themeOverlayVisible" class="pc-panel__theme-overlay" :style="themeOverlayStyle" />
  </div>

  <!-- 历史记录弹窗 -->
  <ConfigHistory />
</template>

<script setup lang="ts">
import ChatArea from './ChatArea.vue';
import ConfigHistory from './ConfigHistory.vue';
import ControlArea from './ControlArea.vue';
import { useStore } from './store';

const store = useStore();
const apiConfigOpen = ref(false);
const headerRef = ref<HTMLElement>();
const mobileTab = ref<'chat' | 'control'>('control');
const mobileViewportHeight = ref(0);

// ---------- 拖拽 ----------
const isDragging = ref(false);
const dragOffset = { x: 0, y: 0 };

/** UI 挂载在 parent document 中，事件监听也需要在 parent document 上 */
function getParentDoc(): Document {
  try {
    if (window.parent && window.parent !== window) return window.parent.document;
  } catch {}
  return document;
}

function getParentWindow(): Window {
  try {
    if (window.parent && window.parent !== window) return window.parent;
  } catch {}
  return window;
}

function updateMobileViewportHeight() {
  const parentWindow = getParentWindow();
  const viewport = parentWindow.visualViewport;
  mobileViewportHeight.value = Math.round(viewport?.height ?? parentWindow.innerHeight);
}

const panelPos = ref({
  x: store.settings.panel_x >= 0 ? store.settings.panel_x : -1,
  y: store.settings.panel_y >= 0 ? store.settings.panel_y : -1,
});

const panelStyle = computed(() => {
  // 所有关键布局属性作为内联样式，不依赖 scoped CSS 跨文档同步
  const base: Record<string, string> = {
    position: 'fixed',
    zIndex: '99999',
    pointerEvents: 'auto',
    display: store.panelOpen ? 'flex' : 'none',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: '12px',
    background: 'var(--ub-bg-solid, rgba(15, 23, 42, 0.95))',
    backdropFilter: 'blur(18px) saturate(180%)',
    WebkitBackdropFilter: 'blur(18px) saturate(180%)',
    border: '1px solid var(--ub-border, rgba(148, 163, 184, 0.15))',
    boxShadow:
      '0 8px 32px var(--ub-shadow, rgba(0,0,0,0.4)), 0 0 0 1px var(--ub-border-light, rgba(255,255,255,0.05)) inset',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif",
    color: 'var(--ub-text-main, #e2e8f0)',
  };

  if (store.isMobile) {
    return {
      ...base,
      left: '0px',
      right: '0px',
      bottom: '0px',
      top: 'auto',
      width: '100%',
      maxWidth: '100%',
      height: `${Math.max(320, mobileViewportHeight.value || getParentWindow().innerHeight)}px`,
      maxHeight: `${Math.max(320, mobileViewportHeight.value || getParentWindow().innerHeight)}px`,
      borderTopLeftRadius: '16px',
      borderTopRightRadius: '16px',
      borderBottomLeftRadius: '0px',
      borderBottomRightRadius: '0px',
    };
  }
  return {
    ...base,
    left: `${panelPos.value.x}px`,
    top: `${panelPos.value.y}px`,
    width: `${store.settings.panel_width}px`,
    height: `${store.settings.panel_height}px`,
  };
});

function onMouseDown(e: MouseEvent) {
  if (store.isMobile) return;
  if (!(e.target as HTMLElement).closest('.pc-panel__header')) return;
  if ((e.target as HTMLElement).closest('.pc-panel__header-btn')) return;
  isDragging.value = true;
  dragOffset.x = e.clientX - panelPos.value.x;
  dragOffset.y = e.clientY - panelPos.value.y;

  // 在 parent document 上添加事件监听（UI 挂载在 parent document 中）
  const parentDoc = getParentDoc();
  parentDoc.addEventListener('mousemove', onMouseMove);
  parentDoc.addEventListener('mouseup', onMouseUp);
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
  const parentDoc = getParentDoc();
  parentDoc.removeEventListener('mousemove', onMouseMove);
  parentDoc.removeEventListener('mouseup', onMouseUp);
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
  if (store.isMobile) return;
  isResizing.value = true;
  resizeDir = dir;
  resizeOrigin = {
    x: e.clientX,
    y: e.clientY,
    w: store.settings.panel_width,
    h: store.settings.panel_height,
  };
  const parentDoc = getParentDoc();
  parentDoc.addEventListener('mousemove', onResizeMove);
  parentDoc.addEventListener('mouseup', onResizeEnd);
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
  const parentDoc = getParentDoc();
  parentDoc.removeEventListener('mousemove', onResizeMove);
  parentDoc.removeEventListener('mouseup', onResizeEnd);
}

// ============================================================
// 主题切换: 径向扩散动画
// ============================================================
const themeOverlayVisible = ref(false);
const themeOverlayStyle = ref<Record<string, string>>({});

function toggleTheme(e: MouseEvent) {
  if (themeOverlayVisible.value) return;

  const nextTheme = store.settings.theme === 'dark' ? 'parchment' : 'dark';
  const targetBg = nextTheme === 'parchment' ? 'rgb(246, 239, 221)' : 'rgb(30, 30, 38)';

  const panel = (e.currentTarget as HTMLElement).closest('.pc-panel') as HTMLElement | null;
  if (!panel) {
    store.settings.theme = nextTheme;
    return;
  }

  const panelRect = panel.getBoundingClientRect();
  const x = e.clientX - panelRect.left;
  const y = e.clientY - panelRect.top;
  const endRadius = Math.hypot(Math.max(x, panelRect.width - x), Math.max(y, panelRect.height - y));

  // 1. 面板覆盖层 (初始状态)
  themeOverlayStyle.value = {
    background: targetBg,
    clipPath: `circle(0px at ${x}px ${y}px)`,
    transition: 'none',
  };
  themeOverlayVisible.value = true;

  // 2. 通知 BubbleMenu (通过共享 store)
  store.themeTransition = {
    active: true,
    clientX: e.clientX,
    clientY: e.clientY,
    targetBg,
  };

  // 3. 开始面板动画
  nextTick(() => {
    requestAnimationFrame(() => {
      themeOverlayStyle.value = {
        background: targetBg,
        clipPath: `circle(${endRadius}px at ${x}px ${y}px)`,
        transition: 'clip-path 800ms ease-in-out',
      };

      // 动画结束后切换主题并清理
      setTimeout(() => {
        store.settings.theme = nextTheme;
        nextTick(() => {
          themeOverlayVisible.value = false;
          store.themeTransition = null;
        });
      }, 820);
    });
  });
}

// Fix #11: 合并为一个 onMounted
onMounted(() => {
  updateMobileViewportHeight();

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
    } catch {
      /* 跨域静默 */
    }
    panelPos.value.x = Math.max(40, (w - store.settings.panel_width) / 2);
    panelPos.value.y = Math.max(40, (h - store.settings.panel_height) / 2);
  }

  // 注册拖拽
  headerRef.value?.addEventListener('mousedown', onMouseDown);

  const parentWindow = getParentWindow();
  parentWindow.addEventListener('resize', updateMobileViewportHeight);
  parentWindow.visualViewport?.addEventListener('resize', updateMobileViewportHeight);
  parentWindow.visualViewport?.addEventListener('scroll', updateMobileViewportHeight);
});

onUnmounted(() => {
  headerRef.value?.removeEventListener('mousedown', onMouseDown);
  cleanupDragListeners();
  onResizeEnd();

  const parentWindow = getParentWindow();
  parentWindow.removeEventListener('resize', updateMobileViewportHeight);
  parentWindow.visualViewport?.removeEventListener('resize', updateMobileViewportHeight);
  parentWindow.visualViewport?.removeEventListener('scroll', updateMobileViewportHeight);
});
</script>

<style scoped>
/* 核心布局属性已通过 panelStyle 内联（确保跨文档渲染正常） */
.pc-panel {
  /* 仅保留不影响布局的装饰性样式 */
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

.pc-panel__header--mobile {
  cursor: default;
  touch-action: manipulation;
  padding-top: max(12px, env(safe-area-inset-top));
}

.pc-panel__header:active:not(.pc-panel__header--mobile) {
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
  width: 32px;
  height: 28px;
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

/* --- Panel Fade Transition (CSS-only, no Vue <transition>) --- */
.pc-panel {
  animation: panel-appear 0.25s ease-out;
}

@keyframes panel-appear {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
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
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
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

/* --- Mobile Tabs --- */
.pc-panel__mobile-tabs {
  display: flex;
  border-bottom: 1px solid var(--ub-border);
  background: var(--ub-bg-glass);
  padding: 4px 10px 0;
  gap: 8px;
}

.pc-panel__mobile-tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 0;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ub-text-muted);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  touch-action: manipulation;
}

.pc-panel__mobile-tab-btn.active {
  color: var(--ub-accent-text);
  border-bottom-color: var(--ub-accent-active);
}

.pc-panel__mobile-tab-btn i {
  font-size: 15px;
}

.pc-panel__body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
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

@media (pointer: coarse) {
  .pc-panel__header {
    padding: 12px 14px;
  }

  .pc-panel__header-actions {
    gap: 6px;
  }

  .pc-panel__header-btn {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    font-size: 14px;
  }

  .pc-panel__api-row {
    align-items: stretch;
    gap: 10px;
  }

  .pc-panel__api-input,
  .pc-panel__api-select {
    min-height: 38px;
    font-size: 14px;
  }

  .pc-panel__api-fetch-btn {
    width: 38px;
    height: 38px;
  }

  .pc-panel__api-toggle {
    min-height: 38px;
  }
}

@media (max-width: 768px) {
  .pc-panel__header-left {
    min-width: 0;
  }

  .pc-panel__title {
    font-size: 15px;
  }

  .pc-panel__icon {
    font-size: 15px;
  }

  .pc-panel__api-row {
    flex-wrap: wrap;
  }

  .pc-panel__api-label {
    width: auto;
    text-align: left;
  }

  .pc-panel__body {
    flex-direction: column;
  }

  .pc-panel__chat-col,
  .pc-panel__control-col {
    flex: 1;
    min-height: 0;
  }

  .pc-panel__mobile-tabs {
    padding-top: 6px;
  }

  .pc-panel__mobile-tab-btn {
    min-height: 44px;
  }
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
