<template>
  <div class="fb-root">
    <!-- 悬浮球 -->
    <div
      ref="ballRef"
      class="fb-ball"
      :class="[{ 'fb-ball--active': store.ballMenuOpen }, 'ub-theme-' + store.settings.theme]"
      :style="ballStyle"
      @mousedown.prevent="onMouseDown"
    >
      <i class="fa-solid fa-sliders" />
    </div>

    <!-- 气泡菜单 -->
    <BubbleMenu
      v-if="store.ballMenuOpen"
      :ball-x="ballPos.x"
      :ball-y="ballPos.y"
      :ball-size="BALL_SIZE"
      @close="store.ballMenuOpen = false"
      @open-panel="openMainPanel"
    />
  </div>
</template>

<script setup lang="ts">
import { useStore } from './store';
import BubbleMenu from './BubbleMenu.vue';

const store = useStore();

const BALL_SIZE = 48;
const CLICK_THRESHOLD = 5; // 拖拽判定阈值（像素）

// ---------- 位置状态 ----------
const ballPos = ref({
  x: store.settings.ball_x >= 0 ? store.settings.ball_x : -1,
  y: store.settings.ball_y >= 0 ? store.settings.ball_y : -1,
});

const ballStyle = computed(() => ({
  left: `${ballPos.value.x}px`,
  top: `${ballPos.value.y}px`,
  width: `${BALL_SIZE}px`,
  height: `${BALL_SIZE}px`,
}));

// ---------- 拖拽逻辑 ----------
const ballRef = ref<HTMLElement>();
const isDragging = ref(false);
const hasMoved = ref(false);
const startPos = { x: 0, y: 0 };
const dragOffset = { x: 0, y: 0 };

function onMouseDown(e: MouseEvent) {
  isDragging.value = true;
  hasMoved.value = false;
  startPos.x = e.clientX;
  startPos.y = e.clientY;
  dragOffset.x = e.clientX - ballPos.value.x;
  dragOffset.y = e.clientY - ballPos.value.y;

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  try {
    window.parent?.document?.addEventListener('mousemove', onMouseMove);
    window.parent?.document?.addEventListener('mouseup', onMouseUp);
  } catch { /* 跨域静默 */ }
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;

  // 用起始位置判断是否真的拖拽了
  const dx = Math.abs(e.clientX - startPos.x);
  const dy = Math.abs(e.clientY - startPos.y);
  if (!hasMoved.value && dx + dy > CLICK_THRESHOLD) {
    hasMoved.value = true;
  }

  if (hasMoved.value) {
    ballPos.value.x = e.clientX - dragOffset.x;
    ballPos.value.y = e.clientY - dragOffset.y;
  }
}

function onMouseUp() {
  isDragging.value = false;
  cleanupDragListeners();

  if (hasMoved.value) {
    // 拖拽结束：保存位置
    store.settings.ball_x = ballPos.value.x;
    store.settings.ball_y = ballPos.value.y;
  } else {
    // 点击：切换菜单
    store.toggleBallMenu();
  }
}

function cleanupDragListeners() {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  try {
    window.parent?.document?.removeEventListener('mousemove', onMouseMove);
    window.parent?.document?.removeEventListener('mouseup', onMouseUp);
  } catch { /* 跨域静默 */ }
}

// ---------- 打开主面板 ----------
function openMainPanel() {
  store.ballMenuOpen = false;
  store.panelOpen = true;
}

// ---------- 初始位置 ----------
onMounted(() => {
  if (ballPos.value.x < 0 || ballPos.value.y < 0) {
    let w = window.innerWidth;
    let h = window.innerHeight;
    try {
      if (window.parent && window.parent !== window) {
        w = window.parent.innerWidth;
        h = window.parent.innerHeight;
      }
    } catch { /* 跨域静默 */ }
    ballPos.value.x = w - BALL_SIZE - 20;
    ballPos.value.y = h / 2 - BALL_SIZE / 2;
  }

  // 首次加载时如果没有保存的配置，自动扫描预设生成基础界面
  if (!store.settings.widget_config) {
    store.autoGenerateFromPreset();
  }
});

onUnmounted(() => {
  cleanupDragListeners();
});
</script>

<style scoped>
.fb-root {
  position: fixed;
  z-index: 99998;
  pointer-events: none;
  inset: 0;
}

.fb-ball {
  position: fixed;
  pointer-events: auto;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(30, 30, 42, 0.88);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  transition: box-shadow 0.25s, transform 0.2s, background 0.25s;
}

.fb-ball:hover {
  background: rgba(38, 38, 52, 0.92);
  box-shadow:
    0 6px 28px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.08) inset,
    0 0 16px rgba(100, 181, 246, 0.15);
  transform: scale(1.08);
}

.fb-ball:active {
  cursor: grabbing;
  transform: scale(0.95);
}

.fb-ball--active {
  background: rgba(100, 181, 246, 0.2);
  border-color: rgba(100, 181, 246, 0.35);
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.4),
    0 0 20px rgba(100, 181, 246, 0.2);
  color: #64b5f6;
}
</style>
