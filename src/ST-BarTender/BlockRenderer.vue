<template>
  <!-- 容器类型 (container) — Fix #1: 加上 appearanceClasses -->
  <div v-if="block.type === 'container'" class="ub-container" :class="[layoutClasses, appearanceClasses]">
    <BlockRenderer v-for="child in block.children" :key="child.id" :block="child" />
  </div>

  <!-- 卡片类型 (card) -->
  <div v-else-if="block.type === 'card'" class="ub-card" :class="[layoutClasses, appearanceClasses]">
    <BlockRenderer v-for="child in block.children" :key="child.id" :block="child" />
  </div>

  <!-- 文本类型 (text) -->
  <div v-else-if="block.type === 'text'" class="ub-text" :class="appearanceClasses">
    {{ block.content || block.label }}
  </div>

  <!-- 开关类型 (toggle) -->
  <PremiumToggle
    v-else-if="block.type === 'toggle'"
    :label="block.label || block.content"
    :checked="boundValue as boolean"
    @update:checked="execute(block.action, $event)"
  />

  <!-- 滑块类型 (slider) — Fix #5: 传入 slider_meta -->
  <PremiumSlider
    v-else-if="block.type === 'slider'"
    :label="block.label || block.content"
    :value="boundValue as number"
    :min="block.slider_meta?.min ?? 0"
    :max="block.slider_meta?.max ?? 2"
    :step="block.slider_meta?.step ?? 0.05"
    @update:value="execute(block.action, $event)"
  />

  <!-- 按钮类型 (button) -->
  <button
    v-else-if="block.type === 'button'"
    class="ub-button"
    :class="appearanceClasses"
    @click="execute(block.action)"
  >
    {{ block.label || block.content }}
  </button>

  <!-- 分割线 (divider) -->
  <div v-else-if="block.type === 'divider'" class="ub-divider" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { UIBlock, ActionBinding } from './schema';
import { useStore } from './store';
import PremiumToggle from './PremiumToggle.vue';
import PremiumSlider from './PremiumSlider.vue';

const props = defineProps<{
  block: UIBlock;
}>();

const store = useStore();

const boundValue = computed(() => store.getBoundValue(props.block.action));

function execute(action?: ActionBinding, payload?: any) {
  store.executeAction(action, payload);
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
}
.ub-card {
  min-width: 180px; /* 防止卡片被极端压缩 */
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
.lo-gap-small { gap: 8px; }
.lo-gap-medium { gap: 16px; }
.lo-gap-large { gap: 24px; }

.lo-pad-none { padding: 0; }
.lo-pad-small { padding: 8px; }
.lo-pad-medium { padding: 16px; }
.lo-pad-large { padding: 24px; }

.lo-w-auto { width: auto; }
.lo-w-full { width: 100%; }
.lo-w-half { width: 50%; }
.lo-w-hug { width: 100%; } /* 防止 AI 用 hug 导致内容过窄 */

/* =========================================
   Appearance Tokens (ap-*)
   ========================================= */

.ap-thm-glass {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
}

.ap-thm-solid {
  background: rgba(30, 30, 38, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.ap-thm-transparent {
  background: transparent;
  border: none;
}

.ub-text { color: rgba(255, 255, 255, 0.9); }
.ap-typo-h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 8px; }
.ap-typo-h2 { font-size: 16px; font-weight: 600; color: rgba(255, 255, 255, 0.85); margin-bottom: 6px; }
.ap-typo-body { font-size: 14px; font-weight: 400; line-height: 1.5; color: rgba(255, 255, 255, 0.75); }
.ap-typo-caption { font-size: 12px; font-weight: 400; color: rgba(255, 255, 255, 0.4); }

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
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1) 20%, rgba(255, 255, 255, 0.1) 80%, transparent);
  margin: 12px 0;
}

.ub-button {
  cursor: pointer;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: white;
  transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  background: rgba(100, 181, 246, 0.2);
  border: 1px solid rgba(100, 181, 246, 0.3);
  border-radius: 8px;
}

.ub-button:hover {
  background: rgba(100, 181, 246, 0.3);
  transform: translateY(-1px);
}
.ub-button:active {
  transform: translateY(1px);
}
</style>
