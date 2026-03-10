<template>
  <!-- 容器类型 (container) -->
  <div
    v-if="block.type === 'container'"
    ref="blockEl"
    class="ub-container ub-animated"
    :class="[
      layoutClasses,
      appearanceClasses,
      {
        'ub-editable': store.editMode,
        'ub-editable--touch': store.editMode && store.isMobile,
        'ub-resizable': store.editMode && !isRoot && !store.isMobile,
      },
    ]"
    :style="customStyle"
  >
    <div v-if="store.editMode && !isRoot" class="ub-edit-bar" @pointerdown.stop @click.stop>
      <button class="ub-edit-btn" title="上移" @click.stop="store.moveBlock(block.id, 'up')">
        <i class="fa-solid fa-arrow-up" />
      </button>
      <button class="ub-edit-btn" title="下移" @click.stop="store.moveBlock(block.id, 'down')">
        <i class="fa-solid fa-arrow-down" />
      </button>
      <button class="ub-edit-btn" title="切换布局" @click.stop="toggleLayout">
        <i
          :class="block.layout?.direction === 'row' ? 'fa-solid fa-arrows-left-right' : 'fa-solid fa-arrows-up-down'"
        />
      </button>
      <button class="ub-edit-btn ub-edit-btn--danger" title="删除" @click.stop="store.removeBlock(block.id)">
        <i class="fa-solid fa-trash-can" />
      </button>
    </div>
    <BlockRenderer v-for="child in block.children" :key="child.id" :block="child" />
    <div
      v-if="showTouchResizeHandle"
      class="ub-touch-resize-handle"
      title="拖动调整尺寸"
      @pointerdown.stop.prevent="onTouchResizeStart"
    />
  </div>

  <!-- 卡片类型 (card) -->
  <div
    v-else-if="block.type === 'card'"
    ref="blockEl"
    class="ub-card ub-animated"
    :class="[
      layoutClasses,
      appearanceClasses,
      {
        'ub-editable': store.editMode,
        'ub-editable--touch': store.editMode && store.isMobile,
        'ub-resizable': store.editMode && !store.isMobile,
      },
    ]"
    :style="customStyle"
  >
    <div v-if="store.editMode" class="ub-edit-bar" @pointerdown.stop @click.stop>
      <button class="ub-edit-btn" title="上移" @click.stop="store.moveBlock(block.id, 'up')">
        <i class="fa-solid fa-arrow-up" />
      </button>
      <button class="ub-edit-btn" title="下移" @click.stop="store.moveBlock(block.id, 'down')">
        <i class="fa-solid fa-arrow-down" />
      </button>
      <button class="ub-edit-btn" title="切换布局" @click.stop="toggleLayout">
        <i
          :class="block.layout?.direction === 'row' ? 'fa-solid fa-arrows-left-right' : 'fa-solid fa-arrows-up-down'"
        />
      </button>
      <button class="ub-edit-btn ub-edit-btn--danger" title="删除" @click.stop="store.removeBlock(block.id)">
        <i class="fa-solid fa-trash-can" />
      </button>
    </div>
    <BlockRenderer v-for="child in block.children" :key="child.id" :block="child" />
    <div
      v-if="showTouchResizeHandle"
      class="ub-touch-resize-handle"
      title="拖动调整尺寸"
      @pointerdown.stop.prevent="onTouchResizeStart"
    />
  </div>

  <!-- 文本类型 (text) -->
  <div
    v-else-if="block.type === 'text'"
    class="ub-text ub-animated"
    :class="[appearanceClasses, { 'ub-text--editable': store.editMode }]"
    :contenteditable="store.editMode"
    :title="store.editMode ? '双击编辑' : ''"
    @blur="onTextBlur"
    @keydown.enter.prevent="($event.target as HTMLElement).blur()"
  >
    {{ block.content || block.label }}
  </div>

  <!-- 开关类型 (toggle) -->
  <div
    v-else-if="block.type === 'toggle'"
    class="ub-toggle-wrap"
    :class="{ 'ub-editable-leaf': store.editMode, 'ub-editable-leaf--touch': store.editMode && store.isMobile }"
  >
    <PremiumToggle
      class="ub-animated"
      :label="block.label || block.content"
      :checked="boundValue as boolean"
      @update:checked="execute(block.action, $event)"
    />
    <span v-if="linkedCount > 0" class="ub-linked-badge" :title="'已绑定 ' + linkedCount + ' 个条目'">
      <i class="fa-solid fa-link" /> {{ linkedCount }}
    </span>
    <div v-if="store.editMode" class="ub-leaf-actions" @pointerdown.stop @click.stop>
      <button class="ub-edit-btn" title="上移" @click.stop="store.moveBlock(block.id, 'up')">
        <i class="fa-solid fa-arrow-up" />
      </button>
      <button class="ub-edit-btn" title="下移" @click.stop="store.moveBlock(block.id, 'down')">
        <i class="fa-solid fa-arrow-down" />
      </button>
      <button
        class="ub-edit-btn"
        :class="{ 'ub-edit-btn--active': showLinkEditor }"
        title="绑定条目"
        @click.stop="showLinkEditor = !showLinkEditor"
      >
        <i class="fa-solid fa-link" />
      </button>
      <button class="ub-edit-btn ub-edit-btn--danger" title="删除" @click.stop="store.removeBlock(block.id)">
        <i class="fa-solid fa-trash-can" />
      </button>
    </div>
    <!-- 绑定编辑器 -->
    <div v-if="showLinkEditor && store.editMode" class="ub-link-editor" @pointerdown.stop @click.stop>
      <div class="ub-link-editor__header">
        <span class="ub-link-editor__title">绑定条目</span>
        <button v-if="linkedCount > 0" class="ub-link-editor__clear" @click.stop="clearAllLinks" title="全部解绑">
          <i class="fa-solid fa-link-slash" /> 全部解绑
        </button>
      </div>
      <input v-model="linkSearch" class="ub-link-editor__search" placeholder="搜索条目..." @keydown.stop />
      <div class="ub-link-editor__list">
        <label
          v-for="entry in filteredLinkEntries"
          :key="entry.id"
          class="ub-link-editor__item"
          :class="{ 'ub-link-editor__item--linked': isLinked(entry.id) }"
        >
          <input type="checkbox" :checked="isLinked(entry.id)" @change="toggleLink(entry.id)" />
          <span>{{ entry.name }}</span>
        </label>
        <div v-if="filteredLinkEntries.length === 0" class="ub-link-editor__empty">无匹配条目</div>
      </div>
    </div>
  </div>

  <!-- 滑块类型 (slider) -->
  <div
    v-else-if="block.type === 'slider'"
    class="ub-slider-wrap"
    :class="{ 'ub-editable-leaf': store.editMode, 'ub-editable-leaf--touch': store.editMode && store.isMobile }"
  >
    <PremiumSlider
      class="ub-animated"
      :label="block.label || block.content"
      :value="boundValue as number"
      :min="block.slider_meta?.min ?? 0"
      :max="block.slider_meta?.max ?? 2"
      :step="block.slider_meta?.step ?? 0.05"
      @update:value="execute(block.action, $event)"
    />
    <div v-if="store.editMode" class="ub-leaf-actions" @pointerdown.stop @click.stop>
      <button class="ub-edit-btn ub-edit-btn--danger" title="删除" @click.stop="store.removeBlock(block.id)">
        <i class="fa-solid fa-trash-can" />
      </button>
    </div>
  </div>

  <!-- 按钮类型 (button) -->
  <button
    v-else-if="block.type === 'button'"
    class="ub-button ub-animated"
    :class="appearanceClasses"
    @click="execute(block.action)"
  >
    {{ block.label || block.content }}
  </button>

  <!-- 分割线 (divider) -->
  <div v-else-if="block.type === 'divider'" class="ub-divider ub-animated" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import PremiumSlider from './PremiumSlider.vue';
import PremiumToggle from './PremiumToggle.vue';
import type { ActionBinding, UIBlock } from './schema';
import { useStore } from './store';

const props = defineProps<{
  block: UIBlock;
  isRoot?: boolean;
}>();

const store = useStore();

const boundValue = computed(() => store.getBoundValue(props.block.action));

function execute(action?: ActionBinding, payload?: any) {
  store.executeAction(action, payload);
}

// ---------- 条目绑定 ----------
const showLinkEditor = ref(false);
const linkSearch = ref('');

const linkedCount = computed(() => {
  const action = props.block.action;
  if (action?.type === 'toggle_preset_entry') {
    return action.linked_entry_ids?.length ?? 0;
  }
  return 0;
});

const linkableEntries = computed(() => {
  const action = props.block.action;
  if (action?.type !== 'toggle_preset_entry') return [];
  return store.presetEntries.filter((e: any) => e.id !== action.entry_id);
});

const filteredLinkEntries = computed(() => {
  const q = linkSearch.value.trim().toLowerCase();
  const entries = linkableEntries.value;
  if (!q) {
    // 无搜索时：已绑定的置顶
    return [...entries].sort((a: any, b: any) => {
      const aLinked = isLinked(a.id) ? 0 : 1;
      const bLinked = isLinked(b.id) ? 0 : 1;
      return aLinked - bLinked;
    });
  }
  return entries.filter((e: any) => e.name.toLowerCase().includes(q));
});

function isLinked(entryId: string): boolean {
  const action = props.block.action;
  if (action?.type !== 'toggle_preset_entry') return false;
  return action.linked_entry_ids?.includes(entryId) ?? false;
}

function toggleLink(entryId: string) {
  const action = props.block.action;
  if (action?.type !== 'toggle_preset_entry') return;
  if (!action.linked_entry_ids) {
    action.linked_entry_ids = [];
  }
  const idx = action.linked_entry_ids.indexOf(entryId);
  if (idx >= 0) {
    action.linked_entry_ids.splice(idx, 1);
  } else {
    action.linked_entry_ids.push(entryId);
  }
  store.persistWidgetConfig();
}

function clearAllLinks() {
  const action = props.block.action;
  if (action?.type !== 'toggle_preset_entry') return;
  action.linked_entry_ids = [];
  store.persistWidgetConfig();
}

// ---------- 自定义尺寸 ----------
const blockEl = ref<HTMLElement>();
const liveResizeStyle = ref<Record<string, string> | null>(null);
const isTouchResizing = ref(false);

const TOUCH_RESIZE_MIN_WIDTH = 140;
const TOUCH_RESIZE_MIN_HEIGHT = 72;
const TOUCH_RESIZE_MARGIN = 12;

const showTouchResizeHandle = computed(
  () =>
    store.editMode &&
    store.isMobile &&
    !props.isRoot &&
    (props.block.type === 'card' || props.block.type === 'container'),
);

let activeResizePointerId: number | null = null;
let touchResizeOrigin: {
  x: number;
  y: number;
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
} | null = null;

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

const customStyle = computed(() => {
  const s: Record<string, string> = liveResizeStyle.value ? { ...liveResizeStyle.value } : {};
  if (props.block._customWidth) {
    s.width = props.block._customWidth;
    s.maxWidth = '100%'; // 不超出父容器
  }
  if (props.block._customHeight) s.height = props.block._customHeight;
  return s;
});

// ResizeObserver: 监听用户通过 CSS resize 调整的尺寸
let resizeObs: ResizeObserver | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function setupResizeObserver() {
  cleanupResizeObserver();
  if (!blockEl.value || !store.editMode) return;
  if (store.isMobile) return;
  if (props.block.type !== 'card' && props.block.type !== 'container') return;

  resizeObs = new ResizeObserver(entries => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      // 只在用户主动 resize 时保存（检查 inline style 是否被浏览器改过）
      if (el.style.width || el.style.height) {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const w = el.style.width || undefined;
          const h = el.style.height || undefined;
          store.updateBlock(props.block.id, { _customWidth: w, _customHeight: h });
        }, 300);
      }
    }
  });
  resizeObs.observe(blockEl.value);
}

function cleanupResizeObserver() {
  if (resizeObs) {
    resizeObs.disconnect();
    resizeObs = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function cleanupTouchResizeListeners() {
  const parentDoc = getParentDoc();
  parentDoc.removeEventListener('pointermove', onTouchResizeMove);
  parentDoc.removeEventListener('pointerup', onTouchResizeEnd);
  parentDoc.removeEventListener('pointercancel', onTouchResizeEnd);
}

function onTouchResizeStart(event: PointerEvent) {
  if (!showTouchResizeHandle.value || !blockEl.value) return;

  const rect = blockEl.value.getBoundingClientRect();
  const parentWindow = getParentWindow();
  const parentRect = blockEl.value.parentElement?.getBoundingClientRect();

  activeResizePointerId = event.pointerId;
  isTouchResizing.value = true;
  liveResizeStyle.value = {
    width: `${Math.round(rect.width)}px`,
    height: `${Math.round(rect.height)}px`,
    maxWidth: '100%',
  };

  touchResizeOrigin = {
    x: event.clientX,
    y: event.clientY,
    width: rect.width,
    height: rect.height,
    maxWidth: Math.max(
      TOUCH_RESIZE_MIN_WIDTH,
      Math.min(parentRect?.width ?? rect.width, parentWindow.innerWidth - TOUCH_RESIZE_MARGIN * 2),
    ),
    maxHeight: Math.max(TOUCH_RESIZE_MIN_HEIGHT, parentWindow.innerHeight - TOUCH_RESIZE_MARGIN * 2),
  };

  blockEl.value.setPointerCapture?.(event.pointerId);

  const parentDoc = getParentDoc();
  parentDoc.addEventListener('pointermove', onTouchResizeMove, { passive: false });
  parentDoc.addEventListener('pointerup', onTouchResizeEnd);
  parentDoc.addEventListener('pointercancel', onTouchResizeEnd);
}

function onTouchResizeMove(event: PointerEvent) {
  if (!isTouchResizing.value || !touchResizeOrigin || event.pointerId !== activeResizePointerId) return;

  if (event.cancelable) event.preventDefault();

  const nextWidth = Math.round(
    Math.max(
      TOUCH_RESIZE_MIN_WIDTH,
      Math.min(touchResizeOrigin.maxWidth, touchResizeOrigin.width + (event.clientX - touchResizeOrigin.x)),
    ),
  );
  const nextHeight = Math.round(
    Math.max(
      TOUCH_RESIZE_MIN_HEIGHT,
      Math.min(touchResizeOrigin.maxHeight, touchResizeOrigin.height + (event.clientY - touchResizeOrigin.y)),
    ),
  );

  liveResizeStyle.value = {
    width: `${nextWidth}px`,
    height: `${nextHeight}px`,
    maxWidth: '100%',
  };
}

function onTouchResizeEnd(event: PointerEvent) {
  if (activeResizePointerId !== null && event.pointerId !== activeResizePointerId) return;

  cleanupTouchResizeListeners();

  const finalWidth = liveResizeStyle.value?.width;
  const finalHeight = liveResizeStyle.value?.height;

  activeResizePointerId = null;
  touchResizeOrigin = null;
  isTouchResizing.value = false;
  liveResizeStyle.value = null;

  if (!finalWidth || !finalHeight) return;

  store.updateBlock(props.block.id, {
    _customWidth: finalWidth,
    _customHeight: finalHeight,
  });
  store.persistWidgetConfig();
}

watch(
  () => store.editMode,
  val => {
    if (val) nextTick(() => setupResizeObserver());
    else cleanupResizeObserver();
  },
);

onMounted(() => {
  if (store.editMode) nextTick(() => setupResizeObserver());
});

onUnmounted(() => {
  cleanupResizeObserver();
  cleanupTouchResizeListeners();
});

/** 切换 row ↔ column 布局 */
function toggleLayout() {
  const current = props.block.layout?.direction ?? 'column';
  store.updateBlock(props.block.id, {
    layout: { ...props.block.layout, direction: current === 'column' ? 'row' : 'column' },
  });
}

/** text 区块编辑完成 */
function onTextBlur(e: FocusEvent) {
  if (!store.editMode) return;
  const newText = (e.target as HTMLElement).textContent?.trim() ?? '';
  if (newText && newText !== (props.block.content || props.block.label)) {
    store.updateBlock(props.block.id, { content: newText });
  }
}

const layoutClasses = computed(() => {
  const l = props.block.layout;
  if (!l) return [];
  const classes: string[] = [];
  if (l.direction) classes.push(`lo-dir-${l.direction}`);
  if (l.wrap) classes.push('lo-wrap');
  if (l.justify) classes.push(`lo-jus-${l.justify}`);
  if (l.align) classes.push(`lo-alg-${l.align}`);
  if (l.gap) classes.push(`lo-gap-${l.gap}`);
  if (l.padding) classes.push(`lo-pad-${l.padding}`);
  if (l.width) classes.push(`lo-w-${l.width}`);
  return classes;
});

const appearanceClasses = computed(() => {
  const a = props.block.appearance;
  if (!a) return [];
  const classes: string[] = [];
  if (a.theme) classes.push(`ap-thm-${a.theme}`);
  if (a.typography) classes.push(`ap-typo-${a.typography}`);
  if (a.elevation !== undefined) classes.push(`ap-elv-${a.elevation}`);
  if (a.corner) classes.push(`ap-crn-${a.corner}`);
  return classes;
});
</script>

<style scoped>
/* =========================================
   Layout Tokens (lo-*)
   ========================================= */
.ub-container,
.ub-card {
  display: flex;
  box-sizing: border-box;
  max-width: 100%;
}
.ub-card {
  min-width: 0; /* flex 子元素不溢出 */
}

.lo-dir-row {
  flex-direction: row;
}
.lo-dir-column {
  flex-direction: column;
}
.lo-wrap {
  flex-wrap: wrap;
}

.lo-jus-start {
  justify-content: flex-start;
}
.lo-jus-center {
  justify-content: center;
}
.lo-jus-end {
  justify-content: flex-end;
}
.lo-jus-space-between {
  justify-content: space-between;
}

.lo-alg-start {
  align-items: flex-start;
}
.lo-alg-center {
  align-items: center;
}
.lo-alg-end {
  align-items: flex-end;
}
.lo-alg-stretch {
  align-items: stretch;
}

.lo-gap-none {
  gap: 0;
}
.lo-gap-small {
  gap: 6px;
}
.lo-gap-medium {
  gap: 10px;
}
.lo-gap-large {
  gap: 16px;
}

.lo-pad-none {
  padding: 0;
}
.lo-pad-small {
  padding: 6px;
}
.lo-pad-medium {
  padding: 12px;
}
.lo-pad-large {
  padding: 16px;
}

/* 嵌套的 card/container 自动压缩 padding，避免层层叠加 */
.ub-card .ub-card,
.ub-container .ub-card {
  padding: 8px !important;
}
.ub-card .ub-container {
  padding: 0 !important;
}

.lo-w-auto {
  width: auto;
}
.lo-w-full {
  width: 100%;
}
.lo-w-half {
  width: 50%;
}
.lo-w-hug {
  width: 100%;
} /* 防止 AI 用 hug 导致内容过窄 */

/* =========================================
   Appearance Tokens (ap-*)
   ========================================= */

.ap-thm-glass {
  background: var(--ub-bg-glass);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  border: 1px solid var(--ub-border);
  box-shadow: 0 4px 24px var(--ub-shadow);
}

.ap-thm-solid {
  background: var(--ub-bg-solid);
  border: 1px solid var(--ub-border-light);
}

.ap-thm-transparent {
  background: transparent;
  border: none;
}

.ub-text {
  color: var(--ub-text-main);
}
.ap-typo-h1 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.ap-typo-h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ub-text-main);
  margin-bottom: 6px;
}
.ap-typo-body {
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--ub-text-secondary);
}
.ap-typo-caption {
  font-size: 12px;
  font-weight: 400;
  color: var(--ub-text-muted);
}

.ap-elv-0 {
  box-shadow: none;
}
.ap-elv-1 {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.ap-elv-2 {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
.ap-elv-3 {
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
}

.ap-crn-sharp {
  border-radius: 4px;
}
.ap-crn-rounded {
  border-radius: 12px;
}
.ap-crn-pill {
  border-radius: 9999px;
}

/* =========================================
   Base Components
   ========================================= */

.ub-divider {
  height: 1px;
  width: 100%;
  background: linear-gradient(90deg, transparent, var(--ub-border) 20%, var(--ub-border) 80%, transparent);
  margin: 12px 0;
}

.ub-button {
  cursor: pointer;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ub-text-main);
  transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  background: var(--ub-accent-bg);
  border: 1px solid var(--ub-accent-border);
  border-radius: 8px;
}

.ub-button:hover {
  background: var(--ub-accent-border);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--ub-accent-bg);
}
.ub-button:active {
  transform: translateY(1px);
  box-shadow: none;
}

/* =========================================
   Entry Animations (Waterfall Stagger)
   ========================================= */

@keyframes ub-stagger-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.ub-animated {
  animation: ub-stagger-in 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

/* 为子元素自动增加层叠延迟，最多支持 20 层深度（通常足够组合） */
.ub-container > .ub-animated:nth-child(1),
.ub-card > .ub-animated:nth-child(1) {
  animation-delay: 0.03s;
}
.ub-container > .ub-animated:nth-child(2),
.ub-card > .ub-animated:nth-child(2) {
  animation-delay: 0.06s;
}
.ub-container > .ub-animated:nth-child(3),
.ub-card > .ub-animated:nth-child(3) {
  animation-delay: 0.09s;
}
.ub-container > .ub-animated:nth-child(4),
.ub-card > .ub-animated:nth-child(4) {
  animation-delay: 0.12s;
}
.ub-container > .ub-animated:nth-child(5),
.ub-card > .ub-animated:nth-child(5) {
  animation-delay: 0.15s;
}
.ub-container > .ub-animated:nth-child(6),
.ub-card > .ub-animated:nth-child(6) {
  animation-delay: 0.18s;
}
.ub-container > .ub-animated:nth-child(7),
.ub-card > .ub-animated:nth-child(7) {
  animation-delay: 0.21s;
}
.ub-container > .ub-animated:nth-child(8),
.ub-card > .ub-animated:nth-child(8) {
  animation-delay: 0.24s;
}
.ub-container > .ub-animated:nth-child(n + 9),
.ub-card > .ub-animated:nth-child(n + 9) {
  animation-delay: 0.27s;
}

/* =========================================
   Edit Mode Overlays
   ========================================= */

.ub-editable {
  position: relative;
}

.ub-resizable {
  resize: both;
  overflow: auto;
  min-width: 80px;
  min-height: 40px;
}

.ub-touch-resize-handle {
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 25;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--ub-bg-overlay);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--ub-border);
  touch-action: none;
}

.ub-touch-resize-handle::before {
  content: '';
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 9px;
  height: 9px;
  border-right: 2px solid var(--ub-text-muted);
  border-bottom: 2px solid var(--ub-text-muted);
}

.ub-edit-bar {
  display: none;
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 20;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: var(--ub-bg-overlay);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.ub-editable:hover > .ub-edit-bar {
  display: flex;
}

.ub-editable--touch > .ub-edit-bar {
  display: flex;
}

.ub-editable--touch.ub-card,
.ub-editable--touch.ub-container {
  padding-bottom: 18px;
}

.ub-edit-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ub-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  transition:
    background 0.15s,
    color 0.15s;
}

.ub-edit-btn:hover {
  background: var(--ub-bg-hover);
  color: var(--ub-text-main);
}

.ub-edit-btn--danger:hover {
  background: var(--ub-danger-bg);
  color: var(--ub-danger-text);
}

/* text 编辑态 */
.ub-text--editable {
  cursor: text;
  border-bottom: 1px dashed var(--ub-accent-border);
  outline: none;
  transition: border-color 0.2s;
}

.ub-text--editable:focus {
  border-bottom-color: var(--ub-accent-active);
}

/* toggle/slider 叶子节点编辑按钮 */
.ub-toggle-wrap,
.ub-slider-wrap {
  position: relative;
  width: 100%;
}

.ub-leaf-actions {
  display: none;
  position: absolute;
  top: 50%;
  right: -4px;
  transform: translateY(-50%);
  z-index: 20;
  gap: 1px;
  padding: 2px;
  border-radius: 4px;
  background: var(--ub-bg-overlay);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.ub-editable-leaf:hover > .ub-leaf-actions {
  display: flex;
}

.ub-editable-leaf--touch > .ub-leaf-actions {
  display: flex;
}

/* 绑定指示器 */
.ub-linked-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 9px;
  color: var(--ub-accent-text);
  background: var(--ub-accent-bg);
  border-radius: 8px;
  padding: 1px 5px;
  pointer-events: none;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 3px;
}

.ub-edit-btn--active {
  background: var(--ub-accent-bg) !important;
  color: var(--ub-accent-text) !important;
}

/* 绑定编辑器 */
.ub-link-editor {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 100;
  width: 280px;
  max-height: 300px;
  background: var(--ub-bg-overlay);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--ub-border);
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 8px 24px var(--ub-shadow);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ub-link-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ub-link-editor__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ub-text-secondary);
}

.ub-link-editor__clear {
  font-size: 10px;
  color: var(--ub-danger-text);
  background: var(--ub-danger-bg);
  border: none;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 3px;
  transition: opacity 0.15s;
}
.ub-link-editor__clear:hover {
  opacity: 0.8;
}

.ub-link-editor__search {
  width: 100%;
  padding: 5px 8px;
  font-size: 11px;
  border: 1px solid var(--ub-border);
  border-radius: 6px;
  background: var(--ub-bg-solid);
  color: var(--ub-text-main);
  outline: none;
  transition: border-color 0.2s;
}
.ub-link-editor__search:focus {
  border-color: var(--ub-accent-active);
}

.ub-link-editor__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  max-height: 200px;
}

.ub-link-editor__item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ub-text-main);
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.ub-link-editor__item:hover {
  background: var(--ub-bg-hover);
}

.ub-link-editor__item--linked {
  background: var(--ub-accent-bg);
  border-left: 2px solid var(--ub-accent-active);
}

.ub-link-editor__empty {
  font-size: 11px;
  color: var(--ub-text-muted);
  text-align: center;
  padding: 12px 0;
}

.ub-link-editor__item input[type='checkbox'] {
  accent-color: var(--ub-accent-active);
}

@media (pointer: coarse) {
  .ub-edit-bar {
    top: 6px;
    right: 6px;
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
  }

  .ub-edit-btn {
    width: 32px;
    height: 32px;
    font-size: 12px;
    border-radius: 6px;
  }

  .ub-touch-resize-handle {
    right: 6px;
    bottom: 6px;
    width: 34px;
    height: 34px;
    border-radius: 10px;
  }

  .ub-touch-resize-handle::before {
    right: 7px;
    bottom: 7px;
    width: 11px;
    height: 11px;
  }

  .ub-leaf-actions {
    right: 4px;
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
  }

  .ub-link-editor {
    width: min(320px, calc(100vw - 32px));
    max-height: min(320px, 45vh);
  }

  .ub-link-editor__item {
    min-height: 36px;
    font-size: 13px;
  }
}
</style>
