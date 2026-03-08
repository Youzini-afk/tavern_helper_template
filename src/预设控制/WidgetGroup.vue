<template>
  <div class="widget-group">
    <div class="widget-group__header" @click="collapsed = !collapsed">
      <div class="widget-group__title-row">
        <i class="fa-solid fa-chevron-right widget-group__chevron" :class="{ 'widget-group__chevron--open': !collapsed }" />
        <span class="widget-group__title">{{ group.title }}</span>
        <span class="widget-group__count">{{ enabledCount }}/{{ group.items.length }}</span>
      </div>
      <label class="widget-group__toggle" @click.stop>
        <input
          type="checkbox"
          :checked="allEnabled"
          :indeterminate="someEnabled && !allEnabled"
          @change="$emit('toggle-group')"
        />
        <span class="widget-group__slider" />
      </label>
    </div>

    <div v-show="!collapsed" class="widget-group__body">
      <p v-if="group.description" class="widget-group__desc">{{ group.description }}</p>
      <WidgetItem
        v-for="(item, idx) in group.items"
        :key="item.preset_entry_id"
        :item="item"
        @toggle="$emit('toggle-item', idx)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WidgetGroup } from './schema';
import WidgetItem from './WidgetItem.vue';

const props = defineProps<{
  group: WidgetGroup;
}>();

defineEmits<{
  'toggle-group': [];
  'toggle-item': [itemIdx: number];
}>();

const collapsed = ref(false);

const enabledCount = computed(() => props.group.items.filter(i => i.enabled).length);
const allEnabled = computed(() => props.group.items.length > 0 && props.group.items.every(i => i.enabled));
const someEnabled = computed(() => props.group.items.some(i => i.enabled));
</script>

<style scoped>
.widget-group {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
}

.widget-group + .widget-group {
  margin-top: 8px;
}

.widget-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: rgba(255, 255, 255, 0.03);
  transition: background 0.2s;
}

.widget-group__header:hover {
  background: rgba(255, 255, 255, 0.06);
}

.widget-group__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.widget-group__chevron {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  transition: transform 0.2s;
  width: 12px;
  text-align: center;
}

.widget-group__chevron--open {
  transform: rotate(90deg);
}

.widget-group__title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.widget-group__count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-left: 4px;
}

.widget-group__body {
  padding: 4px 8px 8px;
}

.widget-group__desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  padding: 2px 10px 6px;
  margin: 0;
}

/* --- Group Toggle --- */
.widget-group__toggle {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
}

.widget-group__toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.widget-group__slider {
  display: block;
  width: 36px;
  height: 20px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  position: relative;
  transition: background 0.25s;
}

.widget-group__slider::after {
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

.widget-group__toggle input:checked + .widget-group__slider {
  background: rgba(76, 175, 80, 0.6);
}

.widget-group__toggle input:checked + .widget-group__slider::after {
  transform: translateX(16px);
  background: #4caf50;
}
</style>
