// ============================================================
// Zod Schema 定义 — 数据结构校验与类型推导
// ============================================================

// ---------- Widget 开关面板结构 ----------

/** 单个开关项 */
const WidgetItemSchema = z.object({
  /** 显示名称 */
  label: z.string(),
  /** 映射的预设条目 ID */
  preset_entry_id: z.string(),
  /** 映射的预设条目名称（用于显示） */
  preset_entry_name: z.string(),
  /** 是否启用 */
  enabled: z.boolean().default(true),
  /** 可选颜色标记 */
  color: z.string().optional(),
});
type WidgetItem = z.infer<typeof WidgetItemSchema>;

/** 开关分组 */
const WidgetGroupSchema = z.object({
  /** 分组标题 */
  title: z.string(),
  /** 分组描述 */
  description: z.string().optional(),
  /** 开关列表 */
  items: z.array(WidgetItemSchema),
});
type WidgetGroup = z.infer<typeof WidgetGroupSchema>;

/** 完整面板配置 — AI 返回的结构 */
const WidgetConfigSchema = z.object({
  /** 面板标题 */
  title: z.string().default('预设控制'),
  /** 分组列表 */
  groups: z.array(WidgetGroupSchema).default([]),
});
type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

// ---------- API 配置 ----------

const ApiConfigSchema = z
  .object({
    /** 使用酒馆现有 API 还是自定义 API */
    mode: z.enum(['tavern', 'custom']).default('tavern'),
    /** 自定义 API 地址 */
    custom_url: z.string().default(''),
    /** 自定义 API 密钥 */
    custom_key: z.string().default(''),
    /** 自定义模型名称 */
    custom_model: z.string().default(''),
    /** 自定义 API 源 */
    custom_source: z.string().default('openai'),
  })
  .prefault({});
type ApiConfig = z.infer<typeof ApiConfigSchema>;

// ---------- 对话消息 ----------

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.number(),
});
type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ---------- 脚本设置（持久化） ----------

const SettingsSchema = z
  .object({
    /** API 配置 */
    api: ApiConfigSchema,
    /** 面板是否开启 */
    panel_open: z.boolean().default(false),
    /** 面板位置 */
    panel_x: z.number().default(-1),
    panel_y: z.number().default(-1),
    /** 面板尺寸 */
    panel_width: z.number().default(720),
    panel_height: z.number().default(520),
    /** 对话历史 */
    chat_history: z.array(ChatMessageSchema).default([]),
    /** 当前面板配置 */
    widget_config: WidgetConfigSchema.optional(),
  })
  .prefault({});
type Settings = z.infer<typeof SettingsSchema>;

// ---------- 预设条目快照 ----------

const PresetEntrySnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  role: z.string(),
  position_type: z.string(),
});
type PresetEntrySnapshot = z.infer<typeof PresetEntrySnapshotSchema>;

export {
  WidgetItemSchema,
  WidgetGroupSchema,
  WidgetConfigSchema,
  ApiConfigSchema,
  ChatMessageSchema,
  SettingsSchema,
  PresetEntrySnapshotSchema,
};
export type {
  WidgetItem,
  WidgetGroup,
  WidgetConfig,
  ApiConfig,
  ChatMessage,
  Settings,
  PresetEntrySnapshot,
};
