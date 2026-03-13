<template>
  <EwBaseNode
    label="提示词编排"
    :color="NODE_TYPE_DEFS.prompt_assembler.color"
    :inputs="NODE_TYPE_DEFS.prompt_assembler.inputs"
    :outputs="NODE_TYPE_DEFS.prompt_assembler.outputs"
  >
    <div class="ew-prompt-node__fields">
      <div class="ew-prompt-node__row">
        <span class="ew-prompt-node__label">提示词条目</span>
        <span class="ew-prompt-node__value">{{ promptCount }} 条</span>
      </div>
      <div v-if="customSystem" class="ew-prompt-node__row">
        <span class="ew-prompt-node__label">自定义 System</span>
        <span class="ew-prompt-node__value ew-prompt-node__value--on">✓</span>
      </div>
    </div>
  </EwBaseNode>
</template>

<script setup lang="ts">
import { NODE_TYPE_DEFS } from '../graph-types';
import EwBaseNode from './EwBaseNode.vue';

const props = defineProps<{ data: Record<string, any> }>();

const promptCount = computed(() => {
  const order = props.data.prompt_order ?? [];
  return Array.isArray(order) ? order.filter((e: any) => e.enabled).length : 0;
});

const customSystem = computed(() => !!props.data.system_prompt?.trim());
</script>

<style scoped>
.ew-prompt-node__fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ew-prompt-node__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.ew-prompt-node__label {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.4);
}

.ew-prompt-node__value {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}

.ew-prompt-node__value--on {
  color: #22c55e;
}
</style>
