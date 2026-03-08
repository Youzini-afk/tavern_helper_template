<template>
  <div>
    <!-- 点击外部关闭 -->
    <div class="bm-backdrop" @mousedown="emit('close')" />

    <!-- 气泡菜单 -->
    <div ref="menuRef" class="bm-menu" :style="menuStyle" @mousedown.stop>
      <!-- 标题栏 -->
      <div class="bm-header">
        <span class="bm-title">{{ store.widgetConfig.title }}</span>
        <div class="bm-header-actions">
          <button class="bm-header-btn" title="打开设置面板" @click="emit('openPanel')">
            <i class="fa-solid fa-gear" />
          </button>
          <button class="bm-header-btn" title="关闭" @click="emit('close')">
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
      </div>

      <!-- ACT 渲染区 -->
      <div class="bm-body">
        <BlockRenderer :block="store.widgetConfig.root" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from './store';
import BlockRenderer from './BlockRenderer.vue';

const props = defineProps<{
  ballX: number;
  ballY: number;
  ballSize: number;
}>();

const emit = defineEmits<{
  close: [];
  openPanel: [];
}>();

const store = useStore();
const menuRef = ref<HTMLElement>();

const MENU_WIDTH = 320;
const MENU_MAX_HEIGHT = 480;
const MARGIN = 12;

const menuStyle = computed(() => {
  // 获取可视区域
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  try {
    if (window.parent && window.parent !== window) {
      vw = window.parent.innerWidth;
      vh = window.parent.innerHeight;
    }
  } catch { /* 跨域静默 */ }

  const ballCenterX = props.ballX + props.ballSize / 2;
  const ballCenterY = props.ballY + props.ballSize / 2;

  // 水平位置：优先在球的左边，空间不够则放右边
  let left: number;
  if (ballCenterX > vw / 2) {
    // 球在右半边 → 菜单在球左边
    left = props.ballX - MENU_WIDTH - MARGIN;
  } else {
    // 球在左半边 → 菜单在球右边
    left = props.ballX + props.ballSize + MARGIN;
  }

  // 垂直位置：对齐球的中心
  let top = ballCenterY - MENU_MAX_HEIGHT / 2;

  // 边界约束
  if (left < MARGIN) left = MARGIN;
  if (left + MENU_WIDTH > vw - MARGIN) left = vw - MENU_WIDTH - MARGIN;
  if (top < MARGIN) top = MARGIN;
  if (top + MENU_MAX_HEIGHT > vh - MARGIN) top = vh - MENU_MAX_HEIGHT - MARGIN;

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${MENU_WIDTH}px`,
    maxHeight: `${MENU_MAX_HEIGHT}px`,
  };
});
</script>

<style scoped>
.bm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99998;
  pointer-events: auto;
}

.bm-menu {
  position: fixed;
  z-index: 99999;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(22, 22, 30, 0.94);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif;
  color: rgba(255, 255, 255, 0.88);
  animation: bm-fade-in 0.18s ease-out;
}

@keyframes bm-fade-in {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.bm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.bm-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.3px;
}

.bm-header-actions {
  display: flex;
  gap: 2px;
}

.bm-header-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}

.bm-header-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.bm-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
}

/* 自定义滚动条 */
.bm-body::-webkit-scrollbar {
  width: 4px;
}

.bm-body::-webkit-scrollbar-track {
  background: transparent;
}

.bm-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.bm-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
