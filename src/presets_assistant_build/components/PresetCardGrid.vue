<template>
  <div class="grid">
    <article
      v-for="preset in presets"
      :key="preset.name"
      class="card"
      :class="{ selected: preset.is_selected, loaded: preset.is_loaded }"
      @click="$emit('select', preset.name)"
    >
      <header>
        <h4 :title="preset.name">{{ preset.name }}</h4>
        <button
          class="star"
          type="button"
          :title="preset.favorite ? '取消收藏' : '收藏'"
          @click.stop="$emit('toggle-favorite', preset.name, !preset.favorite)"
        >
          {{ preset.favorite ? '★' : '☆' }}
        </button>
      </header>
      <p>{{ preset.enabled_prompt_count }}/{{ preset.prompt_count }} 个词条启用</p>
      <div class="tags">
        <span v-for="tag in preset.tags.slice(0, 4)" :key="`${preset.name}-${tag}`">{{ tag }}</span>
      </div>
      <footer>
        <span class="status" :class="{ loaded: preset.is_loaded }">
          {{ preset.is_loaded ? '当前生效' : '未生效' }}
        </span>
        <button class="switch" type="button" :disabled="preset.is_loaded" @click.stop="$emit('switch', preset.name)">
          切换
        </button>
      </footer>
    </article>
    <div v-if="!presets.length" class="empty">没有匹配的预设</div>
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
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(218px, 1fr));
  gap: 10px;
}

.card {
  border: 1px solid rgba(74, 98, 132, 0.72);
  border-radius: 12px;
  background: linear-gradient(160deg, rgba(17, 24, 39, 0.84), rgba(9, 14, 26, 0.96));
  padding: 10px;
  display: grid;
  gap: 9px;
  cursor: pointer;
}

.card.selected {
  border-color: #60a5fa;
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.38) inset;
}

.card.loaded {
  border-color: #34d399;
}

header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: start;
}

h4 {
  margin: 0;
  color: #f8fbff;
  font-size: 13px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.star {
  border: none;
  background: transparent;
  color: #fbbf24;
  font-size: 17px;
  cursor: pointer;
  line-height: 1;
}

p {
  margin: 0;
  font-size: 12px;
  color: #a9c5ed;
}

.tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tags span {
  border: 1px solid rgba(71, 97, 132, 0.74);
  border-radius: 999px;
  padding: 2px 7px;
  color: #cdddf6;
  font-size: 11px;
}

footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.status {
  font-size: 11px;
  color: #93a4be;
}

.status.loaded {
  color: #34d399;
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
  grid-column: 1 / -1;
  color: #8ba3c7;
  padding: 16px 8px;
  font-size: 12px;
}
</style>
