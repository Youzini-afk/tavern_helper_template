/**
 * 节点化工作流图 — Pinia Store
 *
 * 管理当前编辑的工作流图状态。
 */

import type { EwWorkflowGraph, EwGraphNode, EwGraphEdge } from './graph-types';

export const useGraphStore = defineStore('ew-graph', () => {
  /** 当前正在编辑的 graph ID（null = 未选择） */
  const activeGraphId = ref<string | null>(null);

  /** 所有工作流图 */
  const graphs = ref<EwWorkflowGraph[]>([]);

  /** 当前 graph */
  const activeGraph = computed(() =>
    graphs.value.find(g => g.id === activeGraphId.value) ?? null,
  );

  /** 设置活跃图 */
  function setActiveGraph(id: string | null) {
    activeGraphId.value = id;
  }

  /** 更新某个 graph 的节点 */
  function updateNodes(graphId: string, nodes: EwGraphNode[]) {
    const graph = graphs.value.find(g => g.id === graphId);
    if (graph) {
      graph.nodes = nodes;
    }
  }

  /** 更新某个 graph 的连线 */
  function updateEdges(graphId: string, edges: EwGraphEdge[]) {
    const graph = graphs.value.find(g => g.id === graphId);
    if (graph) {
      graph.edges = edges;
    }
  }

  /** 更新某个节点的 data */
  function updateNodeData(graphId: string, nodeId: string, data: Record<string, any>) {
    const graph = graphs.value.find(g => g.id === graphId);
    if (!graph) return;
    const node = graph.nodes.find(n => n.id === nodeId);
    if (node) {
      node.data = { ...node.data, ...data };
    }
  }

  /** 删除某个 graph */
  function removeGraph(graphId: string) {
    const idx = graphs.value.findIndex(g => g.id === graphId);
    if (idx >= 0) {
      graphs.value.splice(idx, 1);
      if (activeGraphId.value === graphId) {
        activeGraphId.value = graphs.value[0]?.id ?? null;
      }
    }
  }

  /** 加载 graphs（从 settings 或迁移结果） */
  function loadGraphs(data: EwWorkflowGraph[]) {
    graphs.value = data;
    if (!activeGraphId.value && data.length > 0) {
      activeGraphId.value = data[0].id;
    }
  }

  return {
    activeGraphId,
    graphs,
    activeGraph,
    setActiveGraph,
    updateNodes,
    updateEdges,
    updateNodeData,
    removeGraph,
    loadGraphs,
  };
});
