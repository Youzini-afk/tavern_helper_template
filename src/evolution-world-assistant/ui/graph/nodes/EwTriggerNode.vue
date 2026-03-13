<template>
  <EwBaseNode
    label="触发器"
    :color="NODE_TYPE_DEFS.trigger.color"
    :inputs="NODE_TYPE_DEFS.trigger.inputs"
    :outputs="NODE_TYPE_DEFS.trigger.outputs"
  >
    <div class="ew-trigger-node__info">
      工作流入口点
    </div>
  </EwBaseNode>
</template>

<script setup lang="ts">
import { NODE_TYPE_DEFS } from '../graph-types';
import EwBaseNode from './EwBaseNode.vue';

defineProps<{ data: Record<string, any> }>();
</script>

<style scoped>
.ew-trigger-node__info {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.4);
}
</style>
