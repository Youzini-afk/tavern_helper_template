<template>
  <div
    ref="panelRef"
    class="pc-panel"
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
          :title="apiConfigOpen ? '收起 API 配置' : '展开 API 配置'"
          @click="apiConfigOpen = !apiConfigOpen"
        >
          <i class="fa-solid fa-gear" />
        </button>
        <button class="pc-panel__header-btn" title="关闭" @click="store.panelOpen = false">
          <i class="fa-solid fa-xmark" />
        </button>
      </div>
    </div>

    <!-- API 配置折叠面板 -->
    <div v-show="apiConfigOpen" class="pc-panel__api-config">
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
          <input v-model="store.settings.api.custom_model" class="pc-panel__api-input" placeholder="gpt-4o-mini" />
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
  </div>
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

// Fix #11: 合并为一个 onMounted
onMounted(() => {
  // 初始位置居中
  if (panelPos.value.x < 0 || panelPos.value.y < 0) {
    const doc = document;
    const w = doc.documentElement.clientWidth || window.innerWidth;
    const h = doc.documentElement.clientHeight || window.innerHeight;
    panelPos.value.x = Math.max(40, (w - store.settings.panel_width) / 2);
    panelPos.value.y = Math.max(40, (h - store.settings.panel_height) / 2);
  }

  // 注册拖拽
  headerRef.value?.addEventListener('mousedown', onMouseDown);
});

onUnmounted(() => {
  headerRef.value?.removeEventListener('mousedown', onMouseDown);
  cleanupDragListeners();
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
  background: rgba(22, 22, 30, 0.92);
  backdrop-filter: blur(18px) saturate(180%);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif;
  color: rgba(255, 255, 255, 0.88);
}

.pc-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
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
  color: rgba(100, 181, 246, 0.7);
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
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
}

.pc-panel__header-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.pc-panel__api-config {
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pc-panel__api-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pc-panel__api-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  width: 40px;
  flex-shrink: 0;
  text-align: right;
}

.pc-panel__api-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  outline: none;
  transition: border-color 0.2s;
}

.pc-panel__api-input:focus {
  border-color: rgba(100, 181, 246, 0.4);
}

.pc-panel__api-select {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: rgba(30, 30, 40, 0.9);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  outline: none;
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
  background: rgba(255, 255, 255, 0.06);
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
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

:deep(::-webkit-scrollbar-thumb:hover) {
  background: rgba(255, 255, 255, 0.2);
}
</style>
