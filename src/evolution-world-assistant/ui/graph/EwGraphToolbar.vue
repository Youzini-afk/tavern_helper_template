<template>
  <div class="ew-graph-toolbar">
    <div class="ew-graph-toolbar__left">
      <span class="ew-graph-toolbar__title">工作流图</span>
      <select
        v-if="graphs.length > 0"
        class="ew-graph-toolbar__select"
        :value="activeGraphId ?? ''"
        @change="onSelectGraph"
      >
        <option v-for="g in graphs" :key="g.id" :value="g.id">
          {{ g.name }} {{ g.enabled ? '' : '(已禁用)' }}
        </option>
      </select>
    </div>
    <div class="ew-graph-toolbar__right">
      <div class="ew-graph-toolbar__add-menu">
        <button class="ew-graph-toolbar__btn" @click="menuOpen = !menuOpen">
          ＋ 添加节点
        </button>
        <div v-if="menuOpen" class="ew-graph-toolbar__dropdown">
          <button
            v-for="def in nodeTypes"
            :key="def.type"
            class="ew-graph-toolbar__dropdown-item"
            @click="addNode(def.type)"
          >
            <span
              class="ew-graph-toolbar__dot"
              :style="{ background: def.color }"
            />
            {{ def.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NODE_TYPE_DEFS, type NodeTypeName, type EwWorkflowGraph } from './graph-types';
import { useGraphStore } from './graph-store';

defineProps<{
  graph: EwWorkflowGraph | null;
}>();

const emit = defineEmits<{
  (event: 'add-node', type: NodeTypeName): void;
}>();

const graphStore = useGraphStore();
const graphs = computed(() => graphStore.graphs);
const activeGraphId = computed(() => graphStore.activeGraphId);

const menuOpen = ref(false);
const nodeTypes = Object.values(NODE_TYPE_DEFS);

function onSelectGraph(e: Event) {
  const target = e.target as HTMLSelectElement;
  graphStore.setActiveGraph(target.value);
}

function addNode(type: NodeTypeName) {
  emit('add-node', type);
  menuOpen.value = false;
}
</script>

<style scoped>
.ew-graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(15, 18, 30, 0.9);
  backdrop-filter: blur(12px);
}

.ew-graph-toolbar__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ew-graph-toolbar__title {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
}

.ew-graph-toolbar__select {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.85rem;
  outline: none;
  cursor: pointer;
  max-width: 200px;
}

.ew-graph-toolbar__select:focus {
  border-color: rgba(255, 255, 255, 0.25);
}

.ew-graph-toolbar__select option {
  background: #1a1e2e;
  color: #e0e0e0;
}

.ew-graph-toolbar__right {
  display: flex;
  gap: 8px;
}

.ew-graph-toolbar__add-menu {
  position: relative;
}

.ew-graph-toolbar__btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s;
}

.ew-graph-toolbar__btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.ew-graph-toolbar__dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 180px;
  background: rgba(20, 24, 36, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 4px;
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.ew-graph-toolbar__dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.12s;
}

.ew-graph-toolbar__dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ew-graph-toolbar__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
