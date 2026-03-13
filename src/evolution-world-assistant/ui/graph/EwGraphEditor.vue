<template>
  <div class="ew-graph-editor">
    <div class="ew-graph-editor__toolbar">
      <EwGraphToolbar
        :graph="activeGraph"
        @add-node="onAddNode"
      />
    </div>
    <div class="ew-graph-editor__canvas">
      <VueFlow
        v-if="activeGraph"
        :nodes="flowNodes"
        :edges="flowEdges"
        :node-types="nodeTypes"
        :default-viewport="{ x: 0, y: 0, zoom: 0.85 }"
        :snap-to-grid="true"
        :snap-grid="[20, 20]"
        :connection-mode="ConnectionMode.Loose"
        :fit-view-on-init="true"
        @nodes-change="onNodesChange"
        @edges-change="onEdgesChange"
        @connect="onConnect"
      >
        <Background :gap="20" :size="1" pattern-color="rgba(255,255,255,0.04)" />
        <MiniMap
          :node-color="miniMapNodeColor"
          :mask-color="'rgba(0,0,0,0.7)'"
        />
        <Controls />
      </VueFlow>
      <div v-else class="ew-graph-editor__empty">
        <p>暂无工作流图</p>
        <p class="ew-graph-editor__empty-hint">请从左侧列表选择或创建工作流</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { VueFlow, ConnectionMode, type Connection } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';

import { useGraphStore } from './graph-store';
import { NODE_TYPE_DEFS, type NodeTypeName } from './graph-types';
import { injectVueFlowCSS } from './vue-flow-css';
import EwGraphToolbar from './EwGraphToolbar.vue';
import EwTriggerNode from './nodes/EwTriggerNode.vue';
import EwContextNode from './nodes/EwContextNode.vue';
import EwPromptNode from './nodes/EwPromptNode.vue';
import EwAiCallNode from './nodes/EwAiCallNode.vue';
import EwWorldbookOutputNode from './nodes/EwWorldbookOutputNode.vue';

// 注入 Vue Flow 基础 CSS（绕过 webpack 的 node_modules CSS 限制）
injectVueFlowCSS();

const graphStore = useGraphStore();
const activeGraph = computed(() => graphStore.graph);

// 注册自定义节点类型
const nodeTypes = {
  trigger: markRaw(EwTriggerNode),
  context_builder: markRaw(EwContextNode),
  prompt_assembler: markRaw(EwPromptNode),
  ai_call: markRaw(EwAiCallNode),
  worldbook_output: markRaw(EwWorldbookOutputNode),
};

// Vue Flow 使用的节点/边数据
const flowNodes = computed(() => {
  if (!activeGraph.value) return [];
  return activeGraph.value.nodes.map(n => ({
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: { ...n.data },
  }));
});

const flowEdges = computed(() => {
  if (!activeGraph.value) return [];
  return activeGraph.value.edges.map(e => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    animated: true,
    style: { stroke: 'rgba(255,255,255,0.3)', strokeWidth: 2 },
  }));
});

function onNodesChange(changes: any[]) {
  if (!activeGraph.value) return;
  const currentNodes = [...activeGraph.value.nodes];
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      const node = currentNodes.find(n => n.id === change.id);
      if (node) {
        node.position = { ...change.position };
      }
    }
  }
  graphStore.updateNodes(currentNodes);
}

function onEdgesChange(changes: any[]) {
  if (!activeGraph.value) return;
  let currentEdges = [...activeGraph.value.edges];
  for (const change of changes) {
    if (change.type === 'remove') {
      currentEdges = currentEdges.filter(e => e.id !== change.id);
    }
  }
  graphStore.updateEdges(currentEdges);
}

function onConnect(connection: Connection) {
  if (!activeGraph.value || !connection.source || !connection.target) return;
  const newEdge = {
    id: `e_${connection.source}_${connection.target}_${Date.now()}`,
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? undefined,
    target: connection.target,
    targetHandle: connection.targetHandle ?? undefined,
  };
  graphStore.updateEdges([...activeGraph.value.edges, newEdge]);
}

function onAddNode(type: NodeTypeName) {
  if (!activeGraph.value) return;
  const id = `n_${Date.now().toString(36)}`;
  const newNode = {
    id,
    type,
    position: { x: 200, y: 200 },
    data: {},
  };
  graphStore.updateNodes([...activeGraph.value.nodes, newNode]);
}

function miniMapNodeColor(node: any): string {
  const def = NODE_TYPE_DEFS[node.type as NodeTypeName];
  return def?.color ?? '#666';
}
</script>

<style scoped>
.ew-graph-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 600px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(10, 12, 20, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.ew-graph-editor__toolbar {
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ew-graph-editor__canvas {
  flex: 1;
  position: relative;
}

.ew-graph-editor__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(255, 255, 255, 0.3);
  font-size: 1.1rem;
  gap: 8px;
}

.ew-graph-editor__empty-hint {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.15);
}

/* 深色主题覆盖 */
:deep(.vue-flow__minimap) {
  background: rgba(0, 0, 0, 0.5) !important;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

:deep(.vue-flow__controls) {
  background: rgba(20, 24, 36, 0.9) !important;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  padding: 2px;
}

:deep(.vue-flow__controls-button) {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.6) !important;
}

:deep(.vue-flow__controls-button:hover) {
  background: rgba(255, 255, 255, 0.08) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

:deep(.vue-flow__controls-button svg) {
  fill: currentColor;
}
</style>
