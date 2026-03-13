<template>
  <EwBaseNode
    label="世界书输出"
    :color="NODE_TYPE_DEFS.worldbook_output.color"
    :inputs="NODE_TYPE_DEFS.worldbook_output.inputs"
    :outputs="NODE_TYPE_DEFS.worldbook_output.outputs"
  >
    <div class="ew-wb-node__fields">
      <div v-if="data.response_extract_regex" class="ew-wb-node__row">
        <span class="ew-wb-node__label">提取正则</span>
        <span class="ew-wb-node__value ew-wb-node__value--on">✓</span>
      </div>
      <div v-if="data.response_remove_regex" class="ew-wb-node__row">
        <span class="ew-wb-node__label">移除正则</span>
        <span class="ew-wb-node__value ew-wb-node__value--on">✓</span>
      </div>
      <div class="ew-wb-node__row">
        <span class="ew-wb-node__label">自定义正则</span>
        <span class="ew-wb-node__value">{{ regexCount }} 条</span>
      </div>
      <div v-if="data.use_tavern_regex" class="ew-wb-node__row">
        <span class="ew-wb-node__label">酒馆正则脚本</span>
        <span class="ew-wb-node__value ew-wb-node__value--on">启用</span>
      </div>
    </div>
  </EwBaseNode>
</template>

<script setup lang="ts">
import { NODE_TYPE_DEFS } from '../graph-types';
import EwBaseNode from './EwBaseNode.vue';

const props = defineProps<{ data: Record<string, any> }>();

const regexCount = computed(() => {
  const rules = props.data.custom_regex_rules ?? [];
  return Array.isArray(rules) ? rules.filter((r: any) => r.enabled).length : 0;
});
</script>

<style scoped>
.ew-wb-node__fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ew-wb-node__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.ew-wb-node__label {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.4);
}

.ew-wb-node__value {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}

.ew-wb-node__value--on {
  color: #eab308;
}
</style>
