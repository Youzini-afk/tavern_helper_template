/**
 * 节点化工作流图 — 类型定义
 *
 * 全新数据格式，替代线性 EwFlowConfig。
 * 支持自由连线、分支、多输出目标。
 */

// ── 端口类型 ──────────────────────────────────────────────────
// 用于连线类型校验：只有相同类型的端口才能连接

export type PortDataType = 'context' | 'messages' | 'prompt' | 'response' | 'result' | 'any';

// ── 端口定义 ──────────────────────────────────────────────────

export interface PortDef {
  readonly id: string;
  readonly label: string;
  readonly dataType: PortDataType;
}

// ── 节点类型注册表 ────────────────────────────────────────────

export const NODE_TYPE_DEFS = {
  trigger: {
    type: 'trigger' as const,
    label: '触发器',
    color: '#3b82f6',       // blue
    inputs: [] as readonly PortDef[],
    outputs: [{ id: 'context', label: '上下文', dataType: 'context' as PortDataType }] as readonly PortDef[],
  },
  context_builder: {
    type: 'context_builder' as const,
    label: '上下文构建',
    color: '#22c55e',       // green
    inputs: [{ id: 'context', label: '上下文', dataType: 'context' as PortDataType }] as readonly PortDef[],
    outputs: [{ id: 'messages', label: '消息列表', dataType: 'messages' as PortDataType }] as readonly PortDef[],
  },
  prompt_assembler: {
    type: 'prompt_assembler' as const,
    label: '提示词编排',
    color: '#a855f7',       // purple
    inputs: [{ id: 'messages', label: '消息列表', dataType: 'messages' as PortDataType }] as readonly PortDef[],
    outputs: [{ id: 'prompt', label: '完整提示词', dataType: 'prompt' as PortDataType }] as readonly PortDef[],
  },
  ai_call: {
    type: 'ai_call' as const,
    label: 'AI 调用',
    color: '#f97316',       // orange
    inputs: [{ id: 'prompt', label: '完整提示词', dataType: 'prompt' as PortDataType }] as readonly PortDef[],
    outputs: [{ id: 'response', label: '模型响应', dataType: 'response' as PortDataType }] as readonly PortDef[],
  },
  worldbook_output: {
    type: 'worldbook_output' as const,
    label: '世界书输出',
    color: '#eab308',       // gold
    inputs: [{ id: 'response', label: '模型响应', dataType: 'response' as PortDataType }] as readonly PortDef[],
    outputs: [{ id: 'result', label: '操作结果', dataType: 'result' as PortDataType }] as readonly PortDef[],
  },
};

export type NodeTypeName = keyof typeof NODE_TYPE_DEFS;

// ── 每种节点的 data 类型 ──────────────────────────────────────

export interface TriggerNodeData {
  flow_name: string;
  flow_id: string;
  enabled: boolean;
  timing: 'default' | 'after_reply' | 'before_reply';
  priority: number;
}

export interface ContextBuilderNodeData {
  context_turns: number;
  extract_rules: { start: string; end: string }[];
  exclude_rules: { start: string; end: string }[];
}

export interface PromptAssemblerNodeData {
  system_prompt: string;
  prompt_order: {
    identifier: string;
    name: string;
    enabled: boolean;
    type: 'marker' | 'prompt';
    role: 'system' | 'user' | 'assistant';
    content: string;
    injection_position: 'relative' | 'in_chat';
    injection_depth: number;
  }[];
}

export interface AiCallNodeData {
  api_preset_id: string;
  generation_options: {
    unlock_context_length: boolean;
    max_context_tokens: number;
    max_reply_tokens: number;
    n_candidates: number;
    stream: boolean;
    temperature: number;
    frequency_penalty: number;
    presence_penalty: number;
    top_p: number;
  };
  behavior_options: {
    name_behavior: 'none' | 'default' | 'complete_target' | 'message_content';
    continue_prefill: boolean;
    squash_system_messages: boolean;
    enable_function_calling: boolean;
    send_inline_media: boolean;
    request_thinking: boolean;
    reasoning_effort: 'auto' | 'low' | 'medium' | 'high';
    verbosity: 'auto' | 'low' | 'medium' | 'high';
  };
  request_template: string;
}

export interface WorldbookOutputNodeData {
  response_extract_regex: string;
  response_remove_regex: string;
  use_tavern_regex: boolean;
  custom_regex_rules: {
    id: string;
    name: string;
    enabled: boolean;
    find_regex: string;
    replace_string: string;
  }[];
}

export type EwNodeData =
  | TriggerNodeData
  | ContextBuilderNodeData
  | PromptAssemblerNodeData
  | AiCallNodeData
  | WorldbookOutputNodeData;

// ── Graph Schema ──────────────────────────────────────────────

export const EwGraphNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.record(z.string(), z.any()).default({}),
});

export const EwGraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string().optional(),
  target: z.string(),
  targetHandle: z.string().optional(),
});

export const EwWorkflowGraphSchema = z.object({
  version: z.string().default('ew-graph/v1'),
  id: z.string().min(1),
  name: z.string().default('工作流'),
  enabled: z.boolean().default(true),
  timing: z.enum(['default', 'after_reply', 'before_reply']).default('default'),
  priority: z.coerce.number().int().default(100),
  timeout_ms: z.coerce.number().int().positive().default(300000),
  nodes: z.array(EwGraphNodeSchema).default([]),
  edges: z.array(EwGraphEdgeSchema).default([]),
});

export type EwGraphNode = z.infer<typeof EwGraphNodeSchema>;
export type EwGraphEdge = z.infer<typeof EwGraphEdgeSchema>;
export type EwWorkflowGraph = z.infer<typeof EwWorkflowGraphSchema>;
