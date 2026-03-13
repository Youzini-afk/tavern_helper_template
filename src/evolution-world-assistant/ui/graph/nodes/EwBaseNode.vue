<template>
  <div
    class="ew-node"
    :style="{ '--node-color': color }"
  >
    <div class="ew-node__header">
      <span class="ew-node__dot" />
      <span class="ew-node__label">{{ label }}</span>
    </div>
    <div class="ew-node__body">
      <slot />
    </div>
    <!-- Input handles -->
    <Handle
      v-for="port in inputs"
      :key="port.id"
      type="target"
      :id="port.id"
      :position="Position.Left"
      :style="{ background: handleColor(port.dataType) }"
    />
    <!-- Output handles -->
    <Handle
      v-for="port in outputs"
      :key="port.id"
      type="source"
      :id="port.id"
      :position="Position.Right"
      :style="{ background: handleColor(port.dataType) }"
    />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import type { PortDef, PortDataType } from '../graph-types';

defineProps<{
  label: string;
  color: string;
  inputs: readonly PortDef[];
  outputs: readonly PortDef[];
}>();

const PORT_COLORS: Record<PortDataType, string> = {
  context: '#3b82f6',
  messages: '#22c55e',
  prompt: '#a855f7',
  response: '#f97316',
  result: '#eab308',
  any: '#94a3b8',
};

function handleColor(dt: PortDataType): string {
  return PORT_COLORS[dt] ?? '#94a3b8';
}
</script>

<style scoped>
.ew-node {
  min-width: 180px;
  max-width: 280px;
  background: rgba(18, 22, 36, 0.92);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.4),
    0 0 0 1px var(--node-color, rgba(255, 255, 255, 0.06));
  overflow: visible;
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  transition: box-shadow 0.2s;
}

.ew-node:hover {
  box-shadow:
    0 6px 32px rgba(0, 0, 0, 0.5),
    0 0 0 1.5px var(--node-color, rgba(255, 255, 255, 0.12));
}

.ew-node__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px 10px 0 0;
}

.ew-node__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--node-color, #666);
  flex-shrink: 0;
}

.ew-node__label {
  font-size: 0.8rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
}

.ew-node__body {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.ew-node__body:empty {
  display: none;
}
</style>
