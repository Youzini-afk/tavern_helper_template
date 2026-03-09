<template>
  <div class="control-area">
    <!-- 工具栏（保留一个基础还原功能） -->
    <div class="control-area__toolbar">
      <button class="control-area__tool-btn" @click="store.refreshFromPreset()" title="刷新状态">
        <i class="fa-solid fa-arrows-rotate" />
      </button>
      <button class="control-area__tool-btn" @click="store.autoGenerateFromPreset()" title="重置基础模式">
        <i class="fa-solid fa-window-restore" />
      </button>
      <button
        class="control-area__tool-btn"
        :class="{ 'control-area__tool-btn--active': store.editMode }"
        title="编辑模式"
        @click="store.editMode = !store.editMode"
      >
        <i class="fa-solid fa-pen" />
      </button>
      <div class="control-area__title">
        {{ store.widgetConfig.title }}
      </div>
    </div>

    <!-- 动态高级 UI 渲染容器 -->
    <div class="control-area__dynamic-root">
      <BlockRenderer :block="store.widgetConfig.root" :is-root="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from './store';
import BlockRenderer from './BlockRenderer.vue';

const store = useStore();
</script>

<style scoped>
.control-area {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: rgba(0, 0, 0, 0.1); /* 稍微深一点的背景区分工作区 */
}

.control-area__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.control-area__tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.control-area__tool-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.85);
}

.control-area__tool-btn--active {
  background: rgba(100, 181, 246, 0.2) !important;
  color: rgba(100, 181, 246, 0.9) !important;
}

.control-area__title {
  margin-left: auto;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 0.5px;
}

.control-area__dynamic-root {
  flex: 1;
  overflow-y: auto;
  padding: 16px; /* 给动态内容充足的边距 */
  display: flex;
  flex-direction: column;
}
</style>
