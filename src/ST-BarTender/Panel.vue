<template>
  <transition name="panel-fade">
    <div
      v-show="store.panelOpen"
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
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.pc-panel__header-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.pc-panel__api-config {
  overflow: hidden;
  padding: 0 14px;
  background: rgba(0, 0, 0, 0.15);
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

.pc-panel__api-model-select {
  max-width: none;
}

.pc-panel__api-fetch-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: rgba(100, 181, 246, 0.1);
  color: rgba(100, 181, 246, 0.8);
  cursor: pointer;
  flex-shrink: 0;
  font-size: 12px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.pc-panel__api-fetch-btn:hover:not(:disabled) {
  background: rgba(100, 181, 246, 0.2);
  color: rgba(100, 181, 246, 1);
  border-color: rgba(100, 181, 246, 0.3);
}

.pc-panel__api-fetch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pc-panel__api-sep {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 1px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
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
  background: rgba(255, 255, 255, 0.1);
  transition: background 0.2s;
}

.pc-panel__api-toggle-track.active {
  background: linear-gradient(135deg, #66bb6a, #43a047);
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
  color: rgba(255, 255, 255, 0.6);
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
