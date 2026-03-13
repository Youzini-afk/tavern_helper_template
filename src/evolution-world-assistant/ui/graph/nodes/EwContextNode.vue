<template>
  <EwBaseNode
    label="上下文构建"
    :color="NODE_TYPE_DEFS.context_builder.color"
    :inputs="NODE_TYPE_DEFS.context_builder.inputs"
    :outputs="NODE_TYPE_DEFS.context_builder.outputs"
  >
    <div class="ew-ctx-node__fields">
      <div class="ew-ctx-node__row">
        <span class="ew-ctx-node__label">上下文轮数</span>
        <span class="ew-ctx-node__value">{{ data.context_turns ?? 8 }}</span>
      </div>
      <div class="ew-ctx-node__row">
        <span class="ew-ctx-node__label">提取规则</span>
        <span class="ew-ctx-node__value">{{ (data.extract_rules ?? []).length }} 条</span>
      </div>
      <div class="ew-ctx-node__row">
        <span class="ew-ctx-node__label">排除规则</span>
        <span class="ew-ctx-node__value">{{ (data.exclude_rules ?? []).length }} 条</span>
      </div>
    </div>
  </EwBaseNode>
</template>

<script setup lang="ts">
import { NODE_TYPE_DEFS } from '../graph-types';
import EwBaseNode from './EwBaseNode.vue';

defineProps<{ data: Record<string, any> }>();
</script>

<style scoped>
.ew-ctx-node__fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ew-ctx-node__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.ew-ctx-node__label {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.4);
}

.ew-ctx-node__value {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}
</style>
