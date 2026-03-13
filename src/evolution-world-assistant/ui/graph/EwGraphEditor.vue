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
          class="ew-graph-editor__minimap"
        />
        <Controls class="ew-graph-editor__controls" />
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
// NOTE: Vue Flow CSS is NOT imported from node_modules because webpack
// excludes node_modules from CSS loaders. We provide all necessary styles
// via scoped CSS overrides below.

import { useGraphStore } from './graph-store';
import { NODE_TYPE_DEFS, type NodeTypeName } from './graph-types';
import EwGraphToolbar from './EwGraphToolbar.vue';
import EwTriggerNode from './nodes/EwTriggerNode.vue';
import EwContextNode from './nodes/EwContextNode.vue';
import EwPromptNode from './nodes/EwPromptNode.vue';
import EwAiCallNode from './nodes/EwAiCallNode.vue';
import EwWorldbookOutputNode from './nodes/EwWorldbookOutputNode.vue';

const graphStore = useGraphStore();
const activeGraph = computed(() => graphStore.activeGraph);

// 注册自定义节点类型
const nodeTypes = {
  trigger: markRawCompat(EwTriggerNode),
  context_builder: markRawCompat(EwContextNode),
  prompt_assembler: markRawCompat(EwPromptNode),
  ai_call: markRawCompat(EwAiCallNode),
  worldbook_output: markRawCompat(EwWorldbookOutputNode),
};

function markRawCompat(component: any) {
  return markRaw(component);
}

// Vue Flow 使用的节点/边数据
const flowNodes = computed(() => {
  if (!activeGraph.value) return [];
  return activeGraph.value.nodes.map(n => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
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
  // 处理位置/选中等变化
  const currentNodes = [...activeGraph.value.nodes];
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      const node = currentNodes.find(n => n.id === change.id);
      if (node) {
        node.position = { ...change.position };
      }
    }
  }
  graphStore.updateNodes(activeGraph.value.id, currentNodes);
}

function onEdgesChange(changes: any[]) {
  if (!activeGraph.value) return;
  let currentEdges = [...activeGraph.value.edges];
  for (const change of changes) {
    if (change.type === 'remove') {
      currentEdges = currentEdges.filter(e => e.id !== change.id);
    }
  }
  graphStore.updateEdges(activeGraph.value.id, currentEdges);
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
  graphStore.updateEdges(activeGraph.value.id, [...activeGraph.value.edges, newEdge]);
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
  graphStore.updateNodes(activeGraph.value.id, [...activeGraph.value.nodes, newNode]);
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
  height: 100%;
  min-height: 500px;
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
  min-height: 400px;
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

/* ── Vue Flow 基础 CSS（替代 node_modules CSS 导入）────────── */

/* 画布容器 */
:deep(.vue-flow) {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: transparent;
}

:deep(.vue-flow__container) {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
}

:deep(.vue-flow__viewport) {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

:deep(.vue-flow__transformationpane) {
  transform-origin: 0 0;
  pointer-events: all;
}

/* 节点 */
:deep(.vue-flow__node) {
  position: absolute;
  user-select: none;
  pointer-events: all;
  cursor: grab;
}

:deep(.vue-flow__node.dragging) {
  cursor: grabbing;
  z-index: 10;
}

:deep(.vue-flow__node.selected) {
  z-index: 10;
}

/* 连接点 */
:deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  background: rgba(30, 34, 50, 0.9);
  position: absolute;
  pointer-events: all;
  cursor: crosshair;
  z-index: 5;
}

:deep(.vue-flow__handle-left) {
  left: -5px;
  top: 50%;
  transform: translateY(-50%);
}

:deep(.vue-flow__handle-right) {
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
}

:deep(.vue-flow__handle-top) {
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
}

:deep(.vue-flow__handle-bottom) {
  bottom: -5px;
  left: 50%;
  transform: translateX(-50%);
}

/* 边/连线 */
:deep(.vue-flow__edges) {
  pointer-events: none;
  overflow: visible;
  position: absolute;
  width: 100%;
  height: 100%;
  z-index: 0;
}

:deep(.vue-flow__edge-path) {
  stroke: rgba(255, 255, 255, 0.2);
  stroke-width: 2;
  fill: none;
}

:deep(.vue-flow__edge.animated .vue-flow__edge-path) {
  stroke-dasharray: 5;
  animation: ew-edge-flow 0.6s linear infinite;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: rgba(255, 255, 255, 0.6);
}

:deep(.vue-flow__connection-path) {
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 2;
  fill: none;
}

@keyframes ew-edge-flow {
  to {
    stroke-dashoffset: -10;
  }
}

/* 背景网格 */
:deep(.vue-flow__background) {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: transparent;
}

/* 小地图 */
:deep(.vue-flow__minimap) {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 5;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

/* 控件 */
:deep(.vue-flow__controls) {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(20, 24, 36, 0.9);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  padding: 2px;
}

:deep(.vue-flow__controls-button) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
}

:deep(.vue-flow__controls-button:hover) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

:deep(.vue-flow__controls-button svg) {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

/* 选择框 */
:deep(.vue-flow__selection) {
  background: rgba(59, 130, 246, 0.08);
  border: 1px dashed rgba(59, 130, 246, 0.4);
}

/* 面板层级 */
:deep(.vue-flow__panel) {
  position: absolute;
  z-index: 5;
}
</style>

