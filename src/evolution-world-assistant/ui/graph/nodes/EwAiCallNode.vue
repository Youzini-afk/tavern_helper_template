<template>
  <EwBaseNode
    label="AI 调用"
    :color="NODE_TYPE_DEFS.ai_call.color"
    :inputs="NODE_TYPE_DEFS.ai_call.inputs"
    :outputs="NODE_TYPE_DEFS.ai_call.outputs"
  >
    <div class="ew-ai-node__fields">
      <div class="ew-ai-node__row">
        <span class="ew-ai-node__label">API 预设</span>
        <span class="ew-ai-node__value">{{ data.api_preset_id || '默认' }}</span>
      </div>
      <div class="ew-ai-node__row">
        <span class="ew-ai-node__label">温度</span>
        <span class="ew-ai-node__value">{{ data.generation_options?.temperature ?? 1.2 }}</span>
      </div>
      <div class="ew-ai-node__row">
        <span class="ew-ai-node__label">最大回复</span>
        <span class="ew-ai-node__value">{{ data.generation_options?.max_reply_tokens ?? 65535 }}</span>
      </div>
      <div v-if="data.generation_options?.stream === false" class="ew-ai-node__row">
        <span class="ew-ai-node__label">流式</span>
        <span class="ew-ai-node__value ew-ai-node__value--off">关闭</span>
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
.ew-ai-node__fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ew-ai-node__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.ew-ai-node__label {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.4);
}

.ew-ai-node__value {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}

.ew-ai-node__value--off {
  color: #ef4444;
}
</style>
