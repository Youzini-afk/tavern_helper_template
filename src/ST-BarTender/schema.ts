// ============================================================
// Zod Schema 定义 — 抽象组件树 (Abstract Component Tree)
// ============================================================

import { z } from 'zod';

// ---------- 工具函数 ----------

/** 生成唯一 ID（兼容不支持 crypto.randomUUID 的环境） */
export function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'xxxx-xxxx-xxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
  }
}

// ---------- 1. 布局与外观属性 ----------

const LayoutPropsSchema = z.object({
  direction: z.enum(['row', 'column']).optional(),
  wrap: z.boolean().optional(),
  justify: z.enum(['start', 'center', 'end', 'space-between']).optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  gap: z.enum(['none', 'small', 'medium', 'large']).optional(),
  padding: z.enum(['none', 'small', 'medium', 'large']).optional(),
  width: z.enum(['auto', 'full', 'half', 'hug']).optional(),
});
export type LayoutProps = z.infer<typeof LayoutPropsSchema>;

const AppearancePropsSchema = z.object({
  theme: z.enum(['glass', 'solid', 'transparent']).optional(),
  primaryColor: z.string().optional(),
  typography: z.enum(['h1', 'h2', 'body', 'caption']).optional(),
  elevation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  corner: z.enum(['sharp', 'rounded', 'pill']).optional(),
});
export type AppearanceProps = z.infer<typeof AppearancePropsSchema>;

// ---------- 2. 行为绑定 ----------

const ActionBindingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('toggle_preset_entry'),
    entry_id: z.string(),
  }),
  z.object({
    type: z.literal('set_preset_param'),
    param_name: z.string(),
  }),
]);
export type ActionBinding = z.infer<typeof ActionBindingSchema>;

// ---------- 3. Slider 元数据 ----------

const SliderMetaSchema = z.object({
  min: z.number().default(0),
  max: z.number().default(2),
  step: z.number().default(0.05),
});
export type SliderMeta = z.infer<typeof SliderMetaSchema>;

// ---------- 4. UI 区块定义 (支持无限递归嵌套) ----------

export type UIBlock = {
  id: string;
  type: 'container' | 'card' | 'text' | 'toggle' | 'slider' | 'button' | 'divider';
  content?: string;
  label?: string;
  layout?: LayoutProps;
  appearance?: AppearanceProps;
  action?: ActionBinding;
  slider_meta?: SliderMeta;
  children?: UIBlock[];
  _userEdited?: boolean;
  _customWidth?: string;
  _customHeight?: string;
};

export const UIBlockSchema: z.ZodType<UIBlock> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(['container', 'card', 'text', 'toggle', 'slider', 'button', 'divider']),
    content: z.string().optional(),
    label: z.string().optional(),
    layout: LayoutPropsSchema.optional(),
    appearance: AppearancePropsSchema.optional(),
    action: ActionBindingSchema.optional(),
    slider_meta: SliderMetaSchema.optional(),
    children: z.array(UIBlockSchema).optional(),
    _userEdited: z.boolean().optional(),
    _customWidth: z.string().optional(),
    _customHeight: z.string().optional(),
  }),
);

// ---------- Widget 面板结构 ----------

export const WidgetConfigSchema = z.object({
  title: z.string().default('控制中心'),
  root: UIBlockSchema,
});
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

// ---------- API 配置 ----------

export const ApiConfigSchema = z
  .object({
    mode: z.enum(['tavern', 'custom']).default('tavern'),
    custom_url: z.string().default(''),
    custom_key: z.string().default(''),
    custom_model: z.string().default(''),
    custom_source: z.string().default('custom'),
    gen_max_tokens: z.number().default(64000),
    gen_temperature: z.number().default(0.7),
    gen_top_p: z.number().default(0.95),
    gen_stream: z.boolean().default(true),
  })
  .prefault({});
export type ApiConfig = z.infer<typeof ApiConfigSchema>;

// ---------- 对话消息 ----------

export const ChatMessageSchema = z.object({
  id: z.string(), // Fix #7: 添加唯一 ID
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ---------- 脚本设置（持久化） ----------

export const SettingsSchema = z
  .object({
    api: ApiConfigSchema,
    panel_open: z.boolean().default(false),
    panel_x: z.number().default(-1),
    panel_y: z.number().default(-1),
    panel_width: z.number().default(900),
    panel_height: z.number().default(600),
    ball_x: z.number().default(-1),
    ball_y: z.number().default(-1),
    bubble_width: z.number().default(320),
    bubble_height: z.number().default(480),
    show_in_wand: z.boolean().default(true),
    preserve_user_edits: z.boolean().default(true),
    theme: z.enum(['dark', 'parchment']).default('dark'),
    custom_system_prompt: z.string().default(''),
    chat_history: z.array(ChatMessageSchema).default([]),
    widget_config: WidgetConfigSchema.optional(),
  })
  .prefault({});
export type Settings = z.infer<typeof SettingsSchema>;

// ---------- 预设条目快照 ----------

export const PresetEntrySnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  role: z.string(),
  position_type: z.string(),
});
export type PresetEntrySnapshot = z.infer<typeof PresetEntrySnapshotSchema>;
