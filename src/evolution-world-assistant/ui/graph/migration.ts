/**
 * 迁移层：EwFlowConfig → EwWorkflowGraph
 *
 * 将旧的线性工作流配置转换为节点图格式。
 * 每条 EwFlowConfig 生成一条 5 节点的线性图：
 *   Trigger → Context → Prompt → AI Call → Worldbook Output
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
const NODE_SPACING_X = 280;
/** 节点起始 Y */
const NODE_START_Y = 100;
/** 节点起始 X */
const NODE_START_X = 80;

/**
 * 将一条旧 EwFlowConfig 迁移为 EwWorkflowGraph。
 */
export function migrateFlowConfigToGraph(flow: EwFlowConfig): EwWorkflowGraph {
  const triggerId = `n_${uuidv4().slice(0, 8)}`;
  const contextId = `n_${uuidv4().slice(0, 8)}`;
  const promptId = `n_${uuidv4().slice(0, 8)}`;
  const aiCallId = `n_${uuidv4().slice(0, 8)}`;
  const wbOutputId = `n_${uuidv4().slice(0, 8)}`;

  // ── 节点 ──
  const nodes: EwGraphNode[] = [
    {
      id: triggerId,
      type: 'trigger',
      position: { x: NODE_START_X, y: NODE_START_Y },
      data: {} satisfies TriggerNodeData,
    },
    {
      id: contextId,
      type: 'context_builder',
      position: { x: NODE_START_X + NODE_SPACING_X, y: NODE_START_Y },
      data: {
        context_turns: flow.context_turns,
        extract_rules: flow.extract_rules,
        exclude_rules: flow.exclude_rules,
      } satisfies ContextBuilderNodeData,
    },
    {
      id: promptId,
      type: 'prompt_assembler',
      position: { x: NODE_START_X + NODE_SPACING_X * 2, y: NODE_START_Y },
      data: {
        system_prompt: flow.system_prompt,
        prompt_order: flow.prompt_order,
      } satisfies PromptAssemblerNodeData,
    },
    {
      id: aiCallId,
      type: 'ai_call',
      position: { x: NODE_START_X + NODE_SPACING_X * 3, y: NODE_START_Y },
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
      position: { x: NODE_START_X + NODE_SPACING_X * 4, y: NODE_START_Y },
      data: {
        response_extract_regex: flow.response_extract_regex,
        response_remove_regex: flow.response_remove_regex,
        use_tavern_regex: flow.use_tavern_regex,
        custom_regex_rules: flow.custom_regex_rules.map(r => ({ ...r })),
      } satisfies WorldbookOutputNodeData,
    },
  ];

  // ── 连线 ──
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

  return {
    version: 'ew-graph/v1',
    id: flow.id,
    name: flow.name,
    enabled: flow.enabled,
    timing: flow.timing ?? 'default',
    priority: flow.priority,
    timeout_ms: flow.timeout_ms,
    nodes,
    edges,
  };
}

/**
 * 批量迁移：将 settings.flows 中的所有 EwFlowConfig 转换为 EwWorkflowGraph[]。
 */
export function migrateAllFlowConfigs(flows: EwFlowConfig[]): EwWorkflowGraph[] {
  return flows.map(migrateFlowConfigToGraph);
}
