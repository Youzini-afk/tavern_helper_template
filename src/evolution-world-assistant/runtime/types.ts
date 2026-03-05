import { TextSliceRuleSchema } from './contracts';

export const EwApiPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('API配置'),
  api_url: z.string().default(''),
  api_key: z.string().default(''),
  headers_json: z.string().default(''),
});

export const EwFlowConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Flow'),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().default(100),
  timeout_ms: z.coerce.number().int().positive().default(8000),
  api_preset_id: z.string().default(''),
  // Legacy fields kept for backward-compatible migration from old configs.
  api_url: z.string().default(''),
  api_key: z.string().default(''),
  context_turns: z.coerce.number().int().min(1).default(8),
  extract_rules: z.array(TextSliceRuleSchema).default([]),
  exclude_rules: z.array(TextSliceRuleSchema).default([]),
  request_template: z.string().default(''),
  headers_json: z.string().default(''),
});

export const EwSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  total_timeout_ms: z.coerce.number().int().positive().default(15000),
  dispatch_mode: z.enum(['parallel', 'serial']).default('parallel'),
  failure_policy: z.literal('stop_generation').default('stop_generation'),
  controller_entry_name: z.string().default('EW/Controller'),
  meta_entry_name: z.string().default('EW/Meta'),
  meta_marker: z.string().default('EW_RUNTIME_META'),
  dynamic_entry_prefix: z.string().default('EW/Dyn/'),
  runtime_worldbook_prefix: z.string().default('EW_RUNTIME::'),
  max_scan_worldbooks: z.coerce.number().int().min(1).default(20),
  gate_ttl_ms: z.coerce.number().int().positive().default(12000),
  ui_open: z.boolean().default(false),
  api_presets: z.array(EwApiPresetSchema).default([]),
  flows: z.array(EwFlowConfigSchema).default([]),
});

export const WorldbookOperationSchema = z.object({
  upsert_entries: z.array(
    z.object({
      name: z.string(),
      content: z.string(),
      enabled: z.boolean(),
    }),
  ),
  delete_entries: z.array(z.object({ name: z.string() })),
  toggle_entries: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
});

export const RunSummarySchema = z.object({
  at: z.coerce.number().default(0),
  ok: z.boolean().default(false),
  reason: z.string().default(''),
  request_id: z.string().default(''),
  chat_id: z.string().default(''),
  flow_count: z.coerce.number().int().default(0),
  elapsed_ms: z.coerce.number().int().default(0),
  mode: z.enum(['auto', 'manual']).default('auto'),
  diagnostics: z.record(z.string(), z.any()).default({}),
});

export const FlowIoSummarySchema = z.object({
  flow_id: z.string().default(''),
  flow_name: z.string().default(''),
  priority: z.coerce.number().default(0),
  api_preset_name: z.string().default(''),
  api_url: z.string().default(''),
  ok: z.boolean().default(false),
  elapsed_ms: z.coerce.number().int().default(0),
  error: z.string().default(''),
  request_preview: z.string().default(''),
  response_preview: z.string().default(''),
});

export const LastIoSummarySchema = z.object({
  at: z.coerce.number().default(0),
  request_id: z.string().default(''),
  chat_id: z.string().default(''),
  mode: z.enum(['auto', 'manual']).default('auto'),
  flows: z.array(FlowIoSummarySchema).default([]),
});

export type EwFlowConfig = z.infer<typeof EwFlowConfigSchema>;
export type EwApiPreset = z.infer<typeof EwApiPresetSchema>;
export type EwSettings = z.infer<typeof EwSettingsSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type LastIoSummary = z.infer<typeof LastIoSummarySchema>;

export type DispatchFlowResult = {
  flow: EwFlowConfig;
  flow_order: number;
  response: import('./contracts').FlowResponseV1;
};

export type DispatchFlowAttempt = {
  flow: EwFlowConfig;
  flow_order: number;
  api_preset_id: string;
  api_preset_name: string;
  api_url: string;
  request: import('./contracts').FlowRequestV1;
  response?: import('./contracts').FlowResponseV1;
  ok: boolean;
  elapsed_ms: number;
  error?: string;
};

export type MergeInput = DispatchFlowResult[];

export type Prioritized<T> = {
  value: T;
  priority: number;
  flow_order: number;
};

export type MergedPlan = {
  worldbook: {
    upsert_entries: Array<{ name: string; content: string; enabled: boolean }>;
    delete_entries: Array<{ name: string }>;
    toggle_entries: Array<{ name: string; enabled: boolean }>;
  };
  controller_model: import('./contracts').ControllerModel;
  reply_instruction: string;
  diagnostics: Record<string, any>;
};
