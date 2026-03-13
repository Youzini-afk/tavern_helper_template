/**
 * 迁移层：EwFlowConfig[] → EwWorkflowGraph
 *
 * 将所有旧的线性工作流配置合并到 **一个** 节点图中。
 * 每条 EwFlowConfig 在画布上生成一条独立的 5 节点管线链，
 * 多条链纵向排列互不连接。
 */

import { uuidv4 } from '../../runtime/helpers';
import type { EwFlowConfig } from '../../runtime/types';
import type {
  AiCallNodeData,
  ContextBuilderNodeData,
  EwGraphEdge,
  EwGraphNode,
  EwWorkflowGraph,
  PromptAssemblerNodeData,
  TriggerNodeData,
  WorldbookOutputNodeData,
} from './graph-types';

/** 节点间水平间距 */
const NODE_SPACING_X = 300;
/** 管线链间垂直间距 */
const CHAIN_SPACING_Y = 200;
/** 节点起始 X */
const NODE_START_X = 80;
/** 节点起始 Y */
const NODE_START_Y = 80;

/**
 * 为一条 EwFlowConfig 生成 5 个节点 + 4 条连线。
 * @param flow 旧版工作流配置
 * @param chainIndex 管线链在画布上的纵向序号（用于 Y 偏移）
 */
function buildChainFromFlow(
  flow: EwFlowConfig,
  chainIndex: number,
): { nodes: EwGraphNode[]; edges: EwGraphEdge[] } {
  const baseY = NODE_START_Y + chainIndex * CHAIN_SPACING_Y;

  const triggerId = `n_${uuidv4().slice(0, 8)}`;
  const contextId = `n_${uuidv4().slice(0, 8)}`;
  const promptId = `n_${uuidv4().slice(0, 8)}`;
  const aiCallId = `n_${uuidv4().slice(0, 8)}`;
  const wbOutputId = `n_${uuidv4().slice(0, 8)}`;

  const nodes: EwGraphNode[] = [
    {
      id: triggerId,
      type: 'trigger',
      position: { x: NODE_START_X, y: baseY },
      data: {
        flow_name: flow.name,
        flow_id: flow.id,
        enabled: flow.enabled,
        timing: flow.timing ?? 'default',
        priority: flow.priority,
      } satisfies TriggerNodeData,
    },
    {
      id: contextId,
      type: 'context_builder',
      position: { x: NODE_START_X + NODE_SPACING_X, y: baseY },
      data: {
        context_turns: flow.context_turns,
        extract_rules: flow.extract_rules,
        exclude_rules: flow.exclude_rules,
      } satisfies ContextBuilderNodeData,
    },
    {
      id: promptId,
      type: 'prompt_assembler',
      position: { x: NODE_START_X + NODE_SPACING_X * 2, y: baseY },
      data: {
        system_prompt: flow.system_prompt,
        prompt_order: flow.prompt_order,
      } satisfies PromptAssemblerNodeData,
    },
    {
      id: aiCallId,
      type: 'ai_call',
      position: { x: NODE_START_X + NODE_SPACING_X * 3, y: baseY },
      data: {
        api_preset_id: flow.api_preset_id,
        generation_options: { ...flow.generation_options },
        behavior_options: { ...flow.behavior_options },
        request_template: flow.request_template,
      } satisfies AiCallNodeData,
    },
    {
      id: wbOutputId,
      type: 'worldbook_output',
      position: { x: NODE_START_X + NODE_SPACING_X * 4, y: baseY },
      data: {
        response_extract_regex: flow.response_extract_regex,
        response_remove_regex: flow.response_remove_regex,
        use_tavern_regex: flow.use_tavern_regex,
        custom_regex_rules: flow.custom_regex_rules.map(r => ({ ...r })),
      } satisfies WorldbookOutputNodeData,
    },
  ];

  const edges: EwGraphEdge[] = [
    {
      id: `e_${triggerId}_${contextId}`,
      source: triggerId,
      sourceHandle: 'context',
      target: contextId,
      targetHandle: 'context',
    },
    {
      id: `e_${contextId}_${promptId}`,
      source: contextId,
      sourceHandle: 'messages',
      target: promptId,
      targetHandle: 'messages',
    },
    {
      id: `e_${promptId}_${aiCallId}`,
      source: promptId,
      sourceHandle: 'prompt',
      target: aiCallId,
      targetHandle: 'prompt',
    },
    {
      id: `e_${aiCallId}_${wbOutputId}`,
      source: aiCallId,
      sourceHandle: 'response',
      target: wbOutputId,
      targetHandle: 'response',
    },
  ];

  return { nodes, edges };
}

/**
 * 将所有 EwFlowConfig 合并到 **一个** EwWorkflowGraph 中。
 * 每条 flow 变成图内一条独立的管线链。
 */
export function migrateAllFlowsToGraph(flows: EwFlowConfig[]): EwWorkflowGraph {
  const allNodes: EwGraphNode[] = [];
  const allEdges: EwGraphEdge[] = [];

  for (let i = 0; i < flows.length; i++) {
    const { nodes, edges } = buildChainFromFlow(flows[i], i);
    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  return {
    version: 'ew-graph/v1',
    id: uuidv4(),
    name: '工作流图',
    enabled: true,
    timing: 'default',
    priority: 100,
    timeout_ms: 300000,
    nodes: allNodes,
    edges: allEdges,
  };
}

/**
 * 将单条 EwFlowConfig 导入到现有图中（追加一条新管线链）。
 */
export function importFlowIntoGraph(
  graph: EwWorkflowGraph,
  flow: EwFlowConfig,
): void {
  // 计算下一条链的 Y 位置：找到现有节点的最大 Y + 间距
  const maxY = graph.nodes.length > 0
    ? Math.max(...graph.nodes.map(n => n.position.y))
    : NODE_START_Y - CHAIN_SPACING_Y;
  const nextChainY = maxY + CHAIN_SPACING_Y;

  const chainIndex = Math.round((nextChainY - NODE_START_Y) / CHAIN_SPACING_Y);
  const { nodes, edges } = buildChainFromFlow(flow, chainIndex);

  graph.nodes.push(...nodes);
  graph.edges.push(...edges);
}
