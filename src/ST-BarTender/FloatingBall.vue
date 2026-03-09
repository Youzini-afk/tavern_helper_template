<template>
  <div class="fb-root">
    <!-- 悬浮球 -->
    <div
      ref="ballRef"
      class="fb-ball"
      :class="[{ 'fb-ball--active': store.ballMenuOpen }, 'ub-theme-' + store.settings.theme]"
      :style="ballStyle"
      @mousedown.prevent="onPointerDown"
      @touchstart.prevent="onPointerDown"
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

/** 从 MouseEvent 或 TouchEvent 中提取坐标 */
function getPointerXY(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('touches' in e) {
    const t = e.touches[0] ?? e.changedTouches[0];
    return { x: t.clientX, y: t.clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function onPointerDown(e: MouseEvent | TouchEvent) {
  const { x, y } = getPointerXY(e);
  isDragging.value = true;
  hasMoved.value = false;
  startPos.x = x;
  startPos.y = y;
  dragOffset.x = x - ballPos.value.x;
  dragOffset.y = y - ballPos.value.y;

  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('touchend', onPointerUp);
  document.addEventListener('touchcancel', onPointerUp);
  try {
    window.parent?.document?.addEventListener('mousemove', onPointerMove);
    window.parent?.document?.addEventListener('mouseup', onPointerUp);
  } catch { /* 跨域静默 */ }
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  if (!isDragging.value) return;
  if ('cancelable' in e && e.cancelable) e.preventDefault(); // 阻止触摸滚动

  const { x, y } = getPointerXY(e);
  const dx = Math.abs(x - startPos.x);
  const dy = Math.abs(y - startPos.y);
  if (!hasMoved.value && dx + dy > CLICK_THRESHOLD) {
    hasMoved.value = true;
  }

  if (hasMoved.value) {
    ballPos.value.x = x - dragOffset.x;
    ballPos.value.y = y - dragOffset.y;
  }
}

function onPointerUp() {
  isDragging.value = false;
  cleanupDragListeners();

  if (hasMoved.value) {
    store.settings.ball_x = ballPos.value.x;
    store.settings.ball_y = ballPos.value.y;
  } else {
    store.toggleBallMenu();
  }
}

function cleanupDragListeners() {
  document.removeEventListener('mousemove', onPointerMove);
  document.removeEventListener('mouseup', onPointerUp);
  document.removeEventListener('touchmove', onPointerMove);
  document.removeEventListener('touchend', onPointerUp);
  document.removeEventListener('touchcancel', onPointerUp);
  try {
    window.parent?.document?.removeEventListener('mousemove', onPointerMove);
    window.parent?.document?.removeEventListener('mouseup', onPointerUp);
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
  touch-action: none;
  font-size: 18px;
  color: var(--ub-text-main);
  background: var(--ub-bg-solid);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--ub-border);
  box-shadow:
    0 4px 20px var(--ub-shadow),
    0 0 0 1px var(--ub-border-light) inset;
  transition: box-shadow 0.25s, transform 0.2s, background 0.25s;
}

.fb-ball:hover {
  background: var(--ub-bg-hover);
  box-shadow:
    0 6px 28px var(--ub-shadow),
    0 0 0 1px var(--ub-border) inset,
    0 0 16px var(--ub-accent-bg);
  transform: scale(1.08);
}

.fb-ball:active {
  cursor: grabbing;
  transform: scale(0.95);
}

.fb-ball--active {
  background: var(--ub-accent-bg);
  border-color: var(--ub-accent-border);
  box-shadow:
    0 4px 20px var(--ub-shadow),
    0 0 20px var(--ub-accent-bg);
  color: var(--ub-accent-text);
}
</style>
