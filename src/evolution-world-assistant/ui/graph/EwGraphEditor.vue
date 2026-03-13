<template>
  <div class="ew-graph-editor">
    <div class="ew-graph-editor__toolbar">
      <EwGraphToolbar
        :graph="activeGraph"
        @add-node="onAddNode"
      />
    </div>
    <div ref="canvasRef" class="ew-graph-editor__canvas">
      <VueFlow
        v-if="activeGraph"
        v-model:nodes="vfNodes"
        v-model:edges="vfEdges"
        :node-types="nodeTypes"
        :default-viewport="{ x: 0, y: 0, zoom: 0.8 }"
        :snap-to-grid="true"
        :snap-grid="[20, 20]"
        :connection-mode="ConnectionMode.Loose"
        fit-view-on-init
        @connect="onConnect"
      >
        <Background :gap="20" :size="1" pattern-color="rgba(255,255,255,0.05)" />
        <MiniMap :node-color="miniMapNodeColor" />
        <Controls />
      </VueFlow>
      <div v-else class="ew-graph-editor__empty">
        <p>暂无工作流图</p>
        <p class="ew-graph-editor__empty-hint">进入工作流配置后切换至此视图</p>
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

// 注入 Vue Flow 基础 CSS
injectVueFlowCSS();

const graphStore = useGraphStore();
const activeGraph = computed(() => graphStore.graph);

// 自定义节点类型
const nodeTypes = {
  trigger: markRaw(EwTriggerNode),
  context_builder: markRaw(EwContextNode),
  prompt_assembler: markRaw(EwPromptNode),
  ai_call: markRaw(EwAiCallNode),
  worldbook_output: markRaw(EwWorldbookOutputNode),
};

/**
 * 使用 v-model 双向绑定 — Vue Flow 内部管理节点位置、选中态等。
 * 初始化时从 store 加载，变化时同步回 store。
 */
const vfNodes = ref<any[]>([]);
const vfEdges = ref<any[]>([]);
const canvasRef = ref<HTMLElement | null>(null);

// 当 graph 数据加载时填充 Vue Flow
watch(activeGraph, (graph) => {
  if (!graph) {
    vfNodes.value = [];
    vfEdges.value = [];
    return;
  }
  vfNodes.value = graph.nodes.map(n => ({
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: { ...n.data },
    label: n.data?.flow_name || NODE_TYPE_DEFS[n.type as NodeTypeName]?.label || n.type,
  }));
  vfEdges.value = graph.edges.map(e => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle ?? undefined,
    target: e.target,
    targetHandle: e.targetHandle ?? undefined,
    animated: true,
    style: { stroke: 'rgba(255,255,255,0.3)', strokeWidth: 2 },
  }));
}, { immediate: true });

// ── 诊断：挂载后检查 Vue Flow DOM 状态 ──
onMounted(() => {
  setTimeout(() => {
    const el = canvasRef.value;
    if (!el) { console.warn('[EW graph] canvasRef is null'); return; }
    const vf = el.querySelector('.vue-flow');
    if (!vf) { console.warn('[EW graph] .vue-flow not found in canvas'); return; }
    const cs = getComputedStyle(vf);
    console.log('[EW graph] .vue-flow dimensions:', cs.width, cs.height, 'position:', cs.position, 'overflow:', cs.overflow);
    const nodeEls = el.querySelectorAll('.vue-flow__node');
    console.log('[EW graph] .vue-flow__node count:', nodeEls.length);
    if (nodeEls.length > 0) {
      const n0 = nodeEls[0] as HTMLElement;
      const ncs = getComputedStyle(n0);
      console.log('[EW graph] first node:', {
        display: ncs.display,
        visibility: ncs.visibility,
        opacity: ncs.opacity,
        width: ncs.width,
        height: ncs.height,
        position: ncs.position,
        transform: n0.style.transform,
        zIndex: ncs.zIndex,
        innerHTML: n0.innerHTML.substring(0, 300),
      });
    }
    // 检查 viewport 和 transformation pane
    const viewport = el.querySelector('.vue-flow__viewport');
    if (viewport) {
      const vcs = getComputedStyle(viewport);
      console.log('[EW graph] viewport:', vcs.width, vcs.height, 'overflow:', vcs.overflow);
    }
    const tp = el.querySelector('.vue-flow__transformationpane');
    if (tp) {
      const tcs = getComputedStyle(tp);
      console.log('[EW graph] transformationpane:', 'transform:', (tp as HTMLElement).style.transform, 'zIndex:', tcs.zIndex);
    }
    // 检查 CSS 注入
    const cssTag = document.getElementById('ew-vue-flow-css');
    console.log('[EW graph] injected CSS tag exists:', !!cssTag);
  }, 1500);
});

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) return;
  vfEdges.value.push({
    id: `e_${connection.source}_${connection.target}_${Date.now()}`,
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? undefined,
    target: connection.target,
    targetHandle: connection.targetHandle ?? undefined,
    animated: true,
    style: { stroke: 'rgba(255,255,255,0.3)', strokeWidth: 2 },
  });
}

function onAddNode(type: NodeTypeName) {
  const id = `n_${Date.now().toString(36)}`;
  const def = NODE_TYPE_DEFS[type];
  vfNodes.value.push({
    id,
    type,
    position: { x: 200, y: 200 },
    data: {},
    label: def?.label || type,
  });
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
  overflow: hidden;
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

/* 深色主题覆盖 — minimap / controls */
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
  padding: 4px;
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

/* 节点默认样式 */
:deep(.vue-flow__node) {
  color: rgba(255, 255, 255, 0.8);
}

/* 连接线高亮 */
:deep(.vue-flow__edge-path) {
  stroke: rgba(255, 255, 255, 0.25);
  stroke-width: 2;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: rgba(255, 255, 255, 0.6);
}

:deep(.vue-flow__connection-path) {
  stroke: rgba(255, 255, 255, 0.4);
  stroke-width: 2;
}
</style>
