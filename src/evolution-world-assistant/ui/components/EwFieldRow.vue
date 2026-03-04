<template>
  <div class="ew-field-row">
    <div class="ew-field-row__header">
      <label class="ew-field-row__label" :for="fieldId">{{ label }}</label>
      <EwHelpTip v-if="help" :meta="help" />
    </div>
    <div class="ew-field-row__control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FieldHelpMeta } from '../help-meta';
import EwHelpTip from './EwHelpTip.vue';

defineProps<{
  label: string;
  fieldId?: string;
  help?: FieldHelpMeta;
}>();
</script>

<style scoped>
.ew-field-row {
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
  min-width: 0;
}

.ew-field-row__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.48rem;
}

.ew-field-row__label {
  min-width: 0;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #ecf2f9) 90%, transparent);
  font-size: 0.84rem;
  line-height: 1.2;
  font-weight: 600;
}

.ew-field-row__control {
  min-width: 0;
}

.ew-field-row__control :deep(input),
.ew-field-row__control :deep(select),
.ew-field-row__control :deep(textarea) {
  width: 100%;
  border-radius: 0.72rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 48%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 12%, rgba(8, 12, 18, 0.55));
  color: var(--SmartThemeBodyColor, #eef2f8);
  padding: 0.5rem 0.62rem;
  font-size: 0.86rem;
  line-height: 1.35;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}

.ew-field-row__control :deep(textarea) {
  resize: vertical;
  min-height: 4rem;
}

.ew-field-row__control :deep(input[type='checkbox']) {
  width: 1rem;
  height: 1rem;
  accent-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #5c9dd8) 75%, #ffffff);
}

.ew-field-row__control :deep(input:focus),
.ew-field-row__control :deep(select:focus),
.ew-field-row__control :deep(textarea:focus) {
  outline: none;
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 78%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 28%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 16%, rgba(8, 12, 18, 0.6));
}

.ew-field-row__control :deep(input[disabled]),
.ew-field-row__control :deep(textarea[disabled]),
.ew-field-row__control :deep(select[disabled]) {
  opacity: 0.8;
  cursor: not-allowed;
}
</style>
