/**
 * 节点化工作流图 — Pinia Store
 *
 * 管理单一的工作流图状态。
 * 图内包含多条独立的管线链，每条链对应一个旧 EwFlowConfig。
 */

import type { EwWorkflowGraph, EwGraphNode, EwGraphEdge } from './graph-types';

export const useGraphStore = defineStore('ew-graph', () => {
  /** 当前工作流图（唯一一个） */
  const graph = ref<EwWorkflowGraph | null>(null);

  /** 加载图 */
  function loadGraph(data: EwWorkflowGraph) {
    graph.value = data;
  }

  /** 更新节点 */
  function updateNodes(nodes: EwGraphNode[]) {
    if (graph.value) {
      graph.value.nodes = nodes;
    }
  }

  /** 更新连线 */
  function updateEdges(edges: EwGraphEdge[]) {
    if (graph.value) {
      graph.value.edges = edges;
    }
  }

  /** 更新某个节点的 data */
  function updateNodeData(nodeId: string, data: Record<string, any>) {
    if (!graph.value) return;
    const node = graph.value.nodes.find(n => n.id === nodeId);
    if (node) {
      node.data = { ...node.data, ...data };
    }
  }

  return {
    graph,
    loadGraph,
    updateNodes,
    updateEdges,
    updateNodeData,
  };
});
