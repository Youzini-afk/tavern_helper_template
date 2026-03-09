<template>
  <!-- 容器类型 (container) -->
  <div v-if="block.type === 'container'" ref="blockEl" class="ub-container ub-animated" :class="[layoutClasses, appearanceClasses, { 'ub-editable': store.editMode, 'ub-resizable': store.editMode && !isRoot }]" :style="customStyle">
    <div v-if="store.editMode && !isRoot" class="ub-edit-bar" @mousedown.stop>
      <button class="ub-edit-btn" title="上移" @click="store.moveBlock(block.id, 'up')"><i class="fa-solid fa-arrow-up" /></button>
      <button class="ub-edit-btn" title="下移" @click="store.moveBlock(block.id, 'down')"><i class="fa-solid fa-arrow-down" /></button>
      <button class="ub-edit-btn" title="切换布局" @click="toggleLayout"><i :class="block.layout?.direction === 'row' ? 'fa-solid fa-arrows-left-right' : 'fa-solid fa-arrows-up-down'" /></button>
      <button class="ub-edit-btn ub-edit-btn--danger" title="删除" @click="store.removeBlock(block.id)"><i class="fa-solid fa-trash-can" /></button>
    </div>
    <BlockRenderer v-for="child in block.children" :key="child.id" :block="child" />
  </div>

  <!-- 卡片类型 (card) -->
  <div v-else-if="block.type === 'card'" ref="blockEl" class="ub-card ub-animated" :class="[layoutClasses, appearanceClasses, { 'ub-editable': store.editMode, 'ub-resizable': store.editMode }]" :style="customStyle">
    <div v-if="store.editMode" class="ub-edit-bar" @mousedown.stop>
      <button class="ub-edit-btn" title="上移" @click="store.moveBlock(block.id, 'up')"><i class="fa-solid fa-arrow-up" /></button>
      <button class="ub-edit-btn" title="下移" @click="store.moveBlock(block.id, 'down')"><i class="fa-solid fa-arrow-down" /></button>
      <button class="ub-edit-btn" title="切换布局" @click="toggleLayout"><i :class="block.layout?.direction === 'row' ? 'fa-solid fa-arrows-left-right' : 'fa-solid fa-arrows-up-down'" /></button>
      <button class="ub-edit-btn ub-edit-btn--danger" title="删除" @click="store.removeBlock(block.id)"><i class="fa-solid fa-trash-can" /></button>
    </div>
    <BlockRenderer v-for="child in block.children" :key="child.id" :block="child" />
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
  >{{ block.content || block.label }}</div>

  <!-- 开关类型 (toggle) -->
  <div v-else-if="block.type === 'toggle'" class="ub-toggle-wrap" :class="{ 'ub-editable-leaf': store.editMode }">
    <PremiumToggle
      class="ub-animated"
      :label="block.label || block.content"
      :checked="boundValue as boolean"
      @update:checked="execute(block.action, $event)"
    />
    <div v-if="store.editMode" class="ub-leaf-actions" @mousedown.stop>
      <button class="ub-edit-btn" title="上移" @click="store.moveBlock(block.id, 'up')"><i class="fa-solid fa-arrow-up" /></button>
      <button class="ub-edit-btn" title="下移" @click="store.moveBlock(block.id, 'down')"><i class="fa-solid fa-arrow-down" /></button>
      <button class="ub-edit-btn ub-edit-btn--danger" title="删除" @click="store.removeBlock(block.id)"><i class="fa-solid fa-trash-can" /></button>
    </div>
  </div>

  <!-- 滑块类型 (slider) -->
  <div v-else-if="block.type === 'slider'" class="ub-slider-wrap" :class="{ 'ub-editable-leaf': store.editMode }">
    <PremiumSlider
      class="ub-animated"
      :label="block.label || block.content"
      :value="boundValue as number"
      :min="block.slider_meta?.min ?? 0"
      :max="block.slider_meta?.max ?? 2"
      :step="block.slider_meta?.step ?? 0.05"
      @update:value="execute(block.action, $event)"
    />
    <div v-if="store.editMode" class="ub-leaf-actions" @mousedown.stop>
      <button class="ub-edit-btn ub-edit-btn--danger" title="删除" @click="store.removeBlock(block.id)"><i class="fa-solid fa-trash-can" /></button>
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
import { computed } from 'vue';
import type { UIBlock, ActionBinding } from './schema';
import { useStore } from './store';
import PremiumToggle from './PremiumToggle.vue';
import PremiumSlider from './PremiumSlider.vue';

const props = defineProps<{
  block: UIBlock;
  isRoot?: boolean;
}>();

const store = useStore();

const boundValue = computed(() => store.getBoundValue(props.block.action));

function execute(action?: ActionBinding, payload?: any) {
  store.executeAction(action, payload);
}

// ---------- 自定义尺寸 ----------
const blockEl = ref<HTMLElement>();

const customStyle = computed(() => {
  const s: Record<string, string> = {};
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
  if (props.block.type !== 'card' && props.block.type !== 'container') return;

  resizeObs = new ResizeObserver((entries) => {
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

watch(() => store.editMode, (val) => {
  if (val) nextTick(() => setupResizeObserver());
  else cleanupResizeObserver();
});

onMounted(() => {
  if (store.editMode) nextTick(() => setupResizeObserver());
});

onUnmounted(() => {
  cleanupResizeObserver();
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
.ub-container, .ub-card {
  display: flex;
  box-sizing: border-box;
  max-width: 100%;
  overflow: hidden;
}
.ub-card {
  min-width: 0; /* flex 子元素不溢出 */
}

.lo-dir-row { flex-direction: row; }
.lo-dir-column { flex-direction: column; }
.lo-wrap { flex-wrap: wrap; }

.lo-jus-start { justify-content: flex-start; }
.lo-jus-center { justify-content: center; }
.lo-jus-end { justify-content: flex-end; }
.lo-jus-space-between { justify-content: space-between; }

.lo-alg-start { align-items: flex-start; }
.lo-alg-center { align-items: center; }
.lo-alg-end { align-items: flex-end; }
.lo-alg-stretch { align-items: stretch; }

.lo-gap-none { gap: 0; }
.lo-gap-small { gap: 6px; }
.lo-gap-medium { gap: 10px; }
.lo-gap-large { gap: 16px; }

.lo-pad-none { padding: 0; }
.lo-pad-small { padding: 6px; }
.lo-pad-medium { padding: 12px; }
.lo-pad-large { padding: 16px; }

/* 嵌套的 card/container 自动压缩 padding，避免层层叠加 */
.ub-card .ub-card,
.ub-container .ub-card {
  padding: 8px !important;
}
.ub-card .ub-container {
  padding: 0 !important;
}

.lo-w-auto { width: auto; }
.lo-w-full { width: 100%; }
.lo-w-half { width: 50%; }
.lo-w-hug { width: 100%; } /* 防止 AI 用 hug 导致内容过窄 */

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

.ub-text { color: var(--ub-text-main); }
.ap-typo-h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 8px; }
.ap-typo-h2 { font-size: 16px; font-weight: 600; color: var(--ub-text-main); margin-bottom: 6px; }
.ap-typo-body { font-size: 14px; font-weight: 400; line-height: 1.5; color: var(--ub-text-secondary); }
.ap-typo-caption { font-size: 12px; font-weight: 400; color: var(--ub-text-muted); }

.ap-elv-0 { box-shadow: none; }
.ap-elv-1 { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); }
.ap-elv-2 { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
.ap-elv-3 { box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4); }

.ap-crn-sharp { border-radius: 4px; }
.ap-crn-rounded { border-radius: 12px; }
.ap-crn-pill { border-radius: 9999px; }

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
.ub-container > .ub-animated:nth-child(1), .ub-card > .ub-animated:nth-child(1) { animation-delay: 0.03s; }
.ub-container > .ub-animated:nth-child(2), .ub-card > .ub-animated:nth-child(2) { animation-delay: 0.06s; }
.ub-container > .ub-animated:nth-child(3), .ub-card > .ub-animated:nth-child(3) { animation-delay: 0.09s; }
.ub-container > .ub-animated:nth-child(4), .ub-card > .ub-animated:nth-child(4) { animation-delay: 0.12s; }
.ub-container > .ub-animated:nth-child(5), .ub-card > .ub-animated:nth-child(5) { animation-delay: 0.15s; }
.ub-container > .ub-animated:nth-child(6), .ub-card > .ub-animated:nth-child(6) { animation-delay: 0.18s; }
.ub-container > .ub-animated:nth-child(7), .ub-card > .ub-animated:nth-child(7) { animation-delay: 0.21s; }
.ub-container > .ub-animated:nth-child(8), .ub-card > .ub-animated:nth-child(8) { animation-delay: 0.24s; }
.ub-container > .ub-animated:nth-child(n+9), .ub-card > .ub-animated:nth-child(n+9) { animation-delay: 0.27s; }

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

.ub-edit-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ub-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  transition: background 0.15s, color 0.15s;
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

</style>
