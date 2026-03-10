<template>
  <div>
    <!-- 点击外部关闭 -->
    <div class="bm-backdrop" @pointerdown="emit('close')" @click="emit('close')" />

    <!-- 气泡菜单 -->
    <div
      ref="menuRef"
      class="bm-menu"
      :class="['ub-theme-' + store.settings.theme, { 'bm-menu--mobile': store.isMobile }]"
      :style="menuStyle"
      @pointerdown.stop
      @click.stop
    >
      <!-- 标题栏 -->
      <div class="bm-header">
        <span class="bm-title">{{ store.widgetConfig.title }}</span>
        <div class="bm-header-actions">
          <button
            class="bm-header-btn"
            :class="{ 'bm-header-btn--active': store.editMode }"
            title="编辑模式"
            @click="store.editMode = !store.editMode"
          >
            <i class="fa-solid fa-pen" />
          </button>
          <button
            class="bm-header-btn"
            :class="{ 'bm-header-btn--active': store.settings.show_in_wand }"
            :title="store.settings.show_in_wand ? '已挂载魔法棒菜单（点击关闭）' : '未挂载魔法棒菜单（点击开启）'"
            @click="store.settings.show_in_wand = !store.settings.show_in_wand"
          >
            <i class="fa-solid fa-wand-magic-sparkles" />
          </button>
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
        <BlockRenderer :block="store.widgetConfig.root" :is-root="true" />
      </div>

      <!-- 拖拽缩放手柄 -->
      <div
        v-if="!store.isMobile"
        class="bm-resize bm-resize--bottom"
        @mousedown.prevent="onResizeStart($event, 'bottom')"
      />
      <div
        v-if="expandsLeft && !store.isMobile"
        class="bm-resize bm-resize--left"
        @mousedown.prevent="onResizeStart($event, 'left')"
      />
      <div
        v-else-if="!store.isMobile"
        class="bm-resize bm-resize--right"
        @mousedown.prevent="onResizeStart($event, 'right')"
      />
      <div
        v-if="!store.isMobile"
        class="bm-resize bm-resize--corner"
        :class="expandsLeft ? 'bm-resize--corner-left' : 'bm-resize--corner-right'"
        @mousedown.prevent="onResizeStart($event, expandsLeft ? 'corner-left' : 'corner-right')"
      />

      <!-- 主题切换径向扩散动画覆盖层 -->
      <div v-if="bmOverlayVisible" class="bm-theme-overlay" :style="bmOverlayStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import BlockRenderer from './BlockRenderer.vue';
import { useStore } from './store';

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

// ========== 主题切换动画覆盖层 ==========
const bmOverlayVisible = ref(false);
const bmOverlayStyle = ref<Record<string, string>>({});

watch(
  () => store.themeTransition,
  t => {
    if (t?.active && menuRef.value) {
      const rect = menuRef.value.getBoundingClientRect();
      const x = t.clientX - rect.left;
      const y = t.clientY - rect.top;
      const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
      bmOverlayStyle.value = {
        background: t.targetBg,
        clipPath: `circle(0px at ${x}px ${y}px)`,
        transition: 'none',
      };
      bmOverlayVisible.value = true;
      nextTick(() => {
        requestAnimationFrame(() => {
          bmOverlayStyle.value = {
            background: t.targetBg,
            clipPath: `circle(${radius}px at ${x}px ${y}px)`,
            transition: 'clip-path 800ms ease-in-out',
          };
        });
      });
    } else if (t === null) {
      bmOverlayVisible.value = false;
    }
  },
);

const menuWidth = computed({
  get: () => store.settings.bubble_width,
  set: (v: number) => {
    store.settings.bubble_width = v;
  },
});
const menuHeight = computed({
  get: () => store.settings.bubble_height,
  set: (v: number) => {
    store.settings.bubble_height = v;
  },
});
const MIN_W = 240;
const MAX_W = 500;
const MIN_H = 300;
const MAX_H = 700;
const MARGIN = 12;

// 计算展开方向
const expandsLeft = computed(() => {
  let vw = window.innerWidth;
  try {
    if (window.parent && window.parent !== window) vw = window.parent.innerWidth;
  } catch {}
  const ballCenterX = props.ballX + props.ballSize / 2;
  return ballCenterX > vw / 2;
});

const menuStyle = computed(() => {
  // 获取可视区域
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  try {
    if (window.parent && window.parent !== window) {
      vw = window.parent.innerWidth;
      vh = window.parent.innerHeight;
    }
  } catch {
    /* 跨域静默 */
  }

  const w = store.isMobile ? Math.min(menuWidth.value, vw - MARGIN * 2) : menuWidth.value;
  const h = store.isMobile ? Math.min(menuHeight.value, vh - MARGIN * 2) : menuHeight.value;

  // 水平位置
  let left: number;
  if (store.isMobile) {
    left = (vw - w) / 2;
  } else if (expandsLeft.value) {
    left = props.ballX - w - MARGIN;
  } else {
    left = props.ballX + props.ballSize + MARGIN;
  }

  // 垂直位置
  let top = store.isMobile ? vh - h - MARGIN : props.ballY;

  // 边界约束
  if (left < MARGIN) left = MARGIN;
  if (left + w > vw - MARGIN) left = vw - w - MARGIN;
  if (top < MARGIN) top = MARGIN;
  if (top + h > vh - MARGIN) top = vh - h - MARGIN;

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${w}px`,
    maxHeight: `${h}px`,
  };
});

// ---------- 拖拽缩放 ----------
const isResizing = ref(false);
let resizeDir = '' as string;
let resizeOrigin = { x: 0, y: 0, w: 0, h: 0 };

/** UI 挂载在 parent document 中，事件监听也需要在 parent document 上 */
function getParentDoc(): Document {
  try {
    if (window.parent && window.parent !== window) return window.parent.document;
  } catch {}
  return document;
}

function onResizeStart(e: MouseEvent, dir: string) {
  isResizing.value = true;
  resizeDir = dir;
  resizeOrigin = { x: e.clientX, y: e.clientY, w: menuWidth.value, h: menuHeight.value };
  const parentDoc = getParentDoc();
  parentDoc.addEventListener('mousemove', onResizeMove);
  parentDoc.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e: MouseEvent) {
  if (!isResizing.value) return;
  const dx = e.clientX - resizeOrigin.x;
  const dy = e.clientY - resizeOrigin.y;

  if (resizeDir === 'right' || resizeDir === 'corner-right') {
    menuWidth.value = Math.max(MIN_W, Math.min(MAX_W, resizeOrigin.w + dx));
  }
  if (resizeDir === 'left' || resizeDir === 'corner-left') {
    // 向左拖拽时，dx 为负值表示拓宽
    menuWidth.value = Math.max(MIN_W, Math.min(MAX_W, resizeOrigin.w - dx));
  }
  if (resizeDir === 'bottom' || resizeDir.startsWith('corner')) {
    menuHeight.value = Math.max(MIN_H, Math.min(MAX_H, resizeOrigin.h + dy));
  }
}

function onResizeEnd() {
  isResizing.value = false;
  const parentDoc = getParentDoc();
  parentDoc.removeEventListener('mousemove', onResizeMove);
  parentDoc.removeEventListener('mouseup', onResizeEnd);
}
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
  background: var(--ub-bg-solid);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--ub-border);
  box-shadow:
    0 12px 40px var(--ub-shadow),
    0 0 0 1px var(--ub-border-light) inset;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif;
  color: var(--ub-text-main);
  animation: bm-fade-in 0.18s ease-out;
}

.bm-menu--mobile {
  width: min(100vw - 24px, 420px) !important;
  max-height: min(75vh, 560px) !important;
  border-radius: 16px;
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
  background: var(--ub-bg-glass);
  border-bottom: 1px solid var(--ub-border);
  flex-shrink: 0;
}

.bm-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ub-text-main);
  letter-spacing: 0.3px;
}

.bm-header-actions {
  display: flex;
  gap: 2px;
}

.bm-header-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ub-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition:
    background 0.15s,
    color 0.15s;
}

.bm-header-btn:hover {
  background: var(--ub-bg-hover);
  color: var(--ub-text-main);
}

.bm-header-btn--active {
  color: var(--ub-accent-text);
}

.bm-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px;
  display: flex;
  flex-direction: column;
  overscroll-behavior: contain;
}

@media (pointer: coarse) {
  .bm-header {
    padding: 12px 14px;
  }

  .bm-title {
    font-size: 14px;
  }

  .bm-header-actions {
    gap: 6px;
  }

  .bm-header-btn {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    font-size: 14px;
  }
}

/* 自定义滚动条 */
.bm-body::-webkit-scrollbar {
  width: 4px;
}

.bm-body::-webkit-scrollbar-track {
  background: transparent;
}

.bm-body::-webkit-scrollbar-thumb {
  background: var(--ub-border);
  border-radius: 2px;
}

.bm-body::-webkit-scrollbar-thumb:hover {
  background: var(--ub-bg-hover);
}

/* --- Resize Handles --- */
.bm-resize {
  position: absolute;
  z-index: 10;
}

.bm-resize--right {
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
}

.bm-resize--left {
  top: 0;
  left: 0;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
}

.bm-resize--bottom {
  bottom: 0;
  left: 0;
  width: 100%;
  height: 6px;
  cursor: ns-resize;
}

.bm-resize--corner {
  bottom: 0;
  width: 14px;
  height: 14px;
}

.bm-resize--corner-right {
  right: 0;
  cursor: nwse-resize;
}

.bm-resize--corner-left {
  left: 0;
  cursor: nesw-resize;
}

.bm-resize--corner::after {
  content: '';
  position: absolute;
  bottom: 3px;
  width: 8px;
  height: 8px;
  transition: border-color 0.2s;
}

.bm-resize--corner-right::after {
  right: 3px;
  border-right: 2px solid rgba(255, 255, 255, 0.15);
  border-bottom: 2px solid rgba(255, 255, 255, 0.15);
}

.bm-resize--corner-left::after {
  left: 3px;
  border-left: 2px solid rgba(255, 255, 255, 0.15);
  border-bottom: 2px solid rgba(255, 255, 255, 0.15);
}

.bm-resize--corner:hover::after {
  border-color: rgba(255, 255, 255, 0.35);
}

/* 主题切换覆盖层 */
.bm-theme-overlay {
  position: absolute;
  inset: 0;
  z-index: 999999;
  pointer-events: none;
  border-radius: inherit;
}
</style>
