<template>
  <div class="widget-item" :class="{ 'widget-item--disabled': !item.enabled }">
    <div class="widget-item__info">
      <span class="widget-item__label">{{ item.label }}</span>
      <span class="widget-item__entry-name">{{ item.preset_entry_name }}</span>
    </div>
    <label class="widget-item__toggle">
      <input
        type="checkbox"
        :checked="item.enabled"
        @change="$emit('toggle')"
      />
      <span class="widget-item__slider" />
    </label>
  </div>
</template>

<script setup lang="ts">
import type { WidgetItem } from './schema';

defineProps<{
  item: WidgetItem;
}>();

defineEmits<{
  toggle: [];
}>();
</script>

<style scoped>
.widget-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  transition: background 0.2s, opacity 0.2s;
  gap: 8px;
}

.widget-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.widget-item--disabled {
  opacity: 0.55;
}

.widget-item__info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.widget-item__label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.widget-item__entry-name {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.38);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- Toggle Switch --- */
.widget-item__toggle {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
}

.widget-item__toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.widget-item__slider {
  display: block;
  width: 36px;
  height: 20px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  position: relative;
  transition: background 0.25s;
}

.widget-item__slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  transition: transform 0.25s, background 0.25s;
}

.widget-item__toggle input:checked + .widget-item__slider {
  background: rgba(76, 175, 80, 0.6);
}

.widget-item__toggle input:checked + .widget-item__slider::after {
  transform: translateX(16px);
  background: #4caf50;
}
</style>
