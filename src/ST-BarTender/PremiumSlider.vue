<template>
  <div class="premium-slider">
    <div v-if="label" class="ps-header">
      <span class="ps-label">{{ label }}</span>
      <span class="ps-value">{{ displayValue }}</span>
    </div>

    <div ref="trackRef" class="ps-track-container" @mousedown="onMouseDown">
      <div class="ps-track-bg" />
      <div class="ps-track-fill" :style="{ width: percent + '%' }" />
      <div class="ps-thumb" :style="{ left: percent + '%' }" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
  }>(),
  {
    min: 0,
    max: 2,
    step: 0.05,
    label: undefined,
  },
);

const emit = defineEmits<{
  'update:value': [val: number];
}>();

const trackRef = ref<HTMLElement>();
const isDragging = ref(false);

const percent = computed(() => {
  let val = props.value;
  if (val < props.min) val = props.min;
  if (val > props.max) val = props.max;
  if (props.max === props.min) return 0;
  return ((val - props.min) / (props.max - props.min)) * 100;
});

const displayValue = computed(() => {
  // 根据 step 精度自动决定小数位数
  const decimals = Math.max(0, -Math.floor(Math.log10(props.step)));
  return Number(props.value).toFixed(decimals);
});

function updateValueFromMouse(e: MouseEvent) {
  if (!trackRef.value) return;
  const rect = trackRef.value.getBoundingClientRect();
  let x = e.clientX - rect.left;
  if (x < 0) x = 0;
  if (x > rect.width) x = rect.width;

  const p = x / rect.width;
  let newVal = props.min + p * (props.max - props.min);
  // 吸附到 step
  newVal = Math.round(newVal / props.step) * props.step;
  // 限制范围
  newVal = Math.max(props.min, Math.min(props.max, newVal));
  emit('update:value', newVal);
}

function onMouseDown(e: MouseEvent) {
  isDragging.value = true;
  updateValueFromMouse(e);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  updateValueFromMouse(e);
}

function onMouseUp() {
  isDragging.value = false;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

// Fix #4: 确保组件卸载时清理事件监听器
onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
});
</script>

<style scoped>
.premium-slider {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 4px 0;
}

.ps-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ps-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ub-text-main);
}

.ps-value {
  font-size: 12px;
  font-family: monospace;
  color: var(--ub-text-main);
  background: var(--ub-accent-bg);
  padding: 2px 6px;
  border-radius: 4px;
}

.ps-track-container {
  position: relative;
  height: 24px;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.ps-track-bg {
  position: absolute;
  left: 0;
  right: 0;
  height: 6px;
  background: var(--ub-border);
  border-radius: 3px;
  box-shadow: inset 0 1px 2px var(--ub-shadow);
}

.ps-track-fill {
  position: absolute;
  left: 0;
  height: 6px;
  background: var(--ub-accent-active);
  border-radius: 3px;
  pointer-events: none;
  box-shadow: 0 0 8px var(--ub-accent-bg);
}

.ps-thumb {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #ffffff;
  border-radius: 50%;
  transform: translateX(-50%);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  transition: box-shadow 0.2s, transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ps-thumb::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  background: var(--ub-accent-bg);
  transform: scale(0);
  transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ps-track-container:hover .ps-thumb::after {
  transform: scale(1);
}

.ps-track-container:active .ps-thumb {
  transform: translateX(-50%) scale(1.05);
}

.ps-track-container:active .ps-thumb::after {
  transform: scale(1.3);
  background: var(--ub-accent-border);
}
</style>
