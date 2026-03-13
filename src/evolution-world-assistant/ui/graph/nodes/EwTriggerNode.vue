<template>
  <EwBaseNode
    :label="data.flow_name || '触发器'"
    :color="NODE_TYPE_DEFS.trigger.color"
    :inputs="NODE_TYPE_DEFS.trigger.inputs"
    :outputs="NODE_TYPE_DEFS.trigger.outputs"
  >
    <div class="ew-trigger-node__fields">
      <div v-if="data.flow_id" class="ew-trigger-node__row">
        <span class="ew-trigger-node__label">管线 ID</span>
        <span class="ew-trigger-node__value">{{ data.flow_id }}</span>
      </div>
      <div class="ew-trigger-node__row">
        <span class="ew-trigger-node__label">状态</span>
        <span
          class="ew-trigger-node__value"
          :class="data.enabled !== false ? 'ew-trigger-node__value--on' : 'ew-trigger-node__value--off'"
        >
          {{ data.enabled !== false ? '已启用' : '已禁用' }}
        </span>
      </div>
      <div v-if="data.timing && data.timing !== 'default'" class="ew-trigger-node__row">
        <span class="ew-trigger-node__label">时机</span>
        <span class="ew-trigger-node__value">
          {{ data.timing === 'after_reply' ? '回复后' : '回复前' }}
        </span>
      </div>
      <div v-if="data.priority && data.priority !== 100" class="ew-trigger-node__row">
        <span class="ew-trigger-node__label">优先级</span>
        <span class="ew-trigger-node__value">{{ data.priority }}</span>
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
.ew-trigger-node__fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ew-trigger-node__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.ew-trigger-node__label {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.4);
}

.ew-trigger-node__value {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}

.ew-trigger-node__value--on {
  color: #22c55e;
}

.ew-trigger-node__value--off {
  color: #ef4444;
}
</style>
