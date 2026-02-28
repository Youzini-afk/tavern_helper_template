<template>
  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>预设</th>
          <th>词条启用</th>
          <th>标签</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="preset in presets"
          :key="preset.name"
          :class="{ selected: preset.is_selected }"
          @click="$emit('select', preset.name)"
        >
          <td class="name-cell">
            <button
              class="star"
              type="button"
              :title="preset.favorite ? '取消收藏' : '收藏'"
              @click.stop="$emit('toggle-favorite', preset.name, !preset.favorite)"
            >
              {{ preset.favorite ? '★' : '☆' }}
            </button>
            <span :title="preset.name">{{ preset.name }}</span>
          </td>
          <td>{{ preset.enabled_prompt_count }}/{{ preset.prompt_count }}</td>
          <td class="tags-cell">{{ preset.tags.join(', ') || '-' }}</td>
          <td>
            <span class="status" :class="{ loaded: preset.is_loaded }">{{ preset.is_loaded ? '生效中' : '待切换' }}</span>
          </td>
          <td>
            <button class="switch" type="button" :disabled="preset.is_loaded" @click.stop="$emit('switch', preset.name)">
              切换
            </button>
          </td>
        </tr>
        <tr v-if="!presets.length">
          <td colspan="5" class="empty">没有匹配的预设</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { PresetSummary } from '../types';

defineProps<{
  presets: PresetSummary[];
}>();

defineEmits<{
  select: [name: string];
  switch: [name: string];
  'toggle-favorite': [name: string, favorite: boolean];
}>();
</script>

<style scoped>
.table-wrap {
  border: 1px solid rgba(70, 93, 122, 0.7);
  border-radius: 12px;
  overflow: auto;
  background: rgba(8, 13, 24, 0.72);
}

.table {
  width: 100%;
  border-collapse: collapse;
  min-width: 540px;
}

th,
td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(44, 62, 88, 0.52);
  text-align: left;
  color: #d9e8ff;
  font-size: 12px;
  vertical-align: middle;
}

thead th {
  background: rgba(17, 24, 39, 0.94);
  color: #9cc4fa;
  position: sticky;
  top: 0;
  z-index: 1;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover {
  background: rgba(30, 64, 175, 0.14);
}

tbody tr.selected {
  background: rgba(59, 130, 246, 0.18);
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.name-cell > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.star {
  border: none;
  background: transparent;
  color: #fbbf24;
  font-size: 16px;
  cursor: pointer;
}

.status {
  color: #93a4be;
}

.status.loaded {
  color: #34d399;
}

.tags-cell {
  color: #a8c2e7;
}

.switch {
  border: 1px solid rgba(86, 114, 156, 0.72);
  border-radius: 7px;
  background: #1f2a44;
  color: #f5f8ff;
  padding: 4px 9px;
  cursor: pointer;
}

.switch:disabled {
  opacity: 0.45;
  cursor: default;
}

.empty {
  color: #8ba3c7;
}
</style>
