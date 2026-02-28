<template>
  <section class="prompt-panel">
    <div class="head">
      <h3>提示词词条开关</h3>
      <span>{{ items.length }} 条</span>
    </div>
    <div class="list">
      <div v-for="item in items" :key="item.key" class="row" :data-kind="item.kind">
        <div class="main">
          <strong>{{ item.name || item.id }}</strong>
          <small>{{ item.id }} · {{ item.role }}</small>
        </div>
        <div class="actions">
          <span v-if="item.is_saving" class="state saving">保存中...</span>
          <span v-else-if="item.is_recently_saved" class="state saved">已保存</span>
          <label class="switch">
            <input
              :checked="item.enabled"
              :disabled="item.is_saving || disabled"
              type="checkbox"
              @change="emitToggle(item.index, ($event.target as HTMLInputElement).checked)"
            />
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div v-if="!items.length" class="empty">当前预设暂无词条</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PromptQuickItem } from '../types';

const props = defineProps<{
  items: PromptQuickItem[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [index: number, enabled: boolean];
}>();

function emitToggle(index: number, enabled: boolean): void {
  if (props.disabled) {
    return;
  }
  emit('toggle', index, enabled);
}
</script>

<style scoped>
.prompt-panel {
  border: 1px solid rgba(70, 93, 122, 0.7);
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(17, 24, 39, 0.9), rgba(8, 13, 24, 0.95));
  overflow: hidden;
}

.head {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(70, 93, 122, 0.65);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.head h3 {
  margin: 0;
  font-size: 14px;
  color: #f8fbff;
}

.head span {
  color: #9dc1f5;
  font-size: 12px;
}

.list {
  max-height: 320px;
  overflow: auto;
  display: grid;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid rgba(44, 62, 88, 0.42);
}

.row:last-child {
  border-bottom: none;
}

.row[data-kind='system'] {
  background: rgba(30, 64, 175, 0.12);
}

.row[data-kind='placeholder'] {
  background: rgba(15, 118, 110, 0.12);
}

.main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.main strong {
  color: #eef6ff;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.main small {
  color: #9db5d9;
  font-size: 11px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.state {
  font-size: 11px;
  min-width: 42px;
  text-align: right;
}

.state.saving {
  color: #fbbf24;
}

.state.saved {
  color: #34d399;
}

.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(88, 108, 140, 0.6);
  transition: 0.18s;
}

.slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 3px;
  border-radius: 50%;
  background: #f8fbff;
  transition: 0.18s;
}

input:checked + .slider {
  background: #1d4ed8;
}

input:checked + .slider::before {
  transform: translateX(20px);
}

.empty {
  padding: 14px;
  color: #8ba3c7;
  font-size: 12px;
}
</style>
