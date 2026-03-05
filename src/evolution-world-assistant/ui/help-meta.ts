export type TabKey = 'overview' | 'api' | 'global' | 'flows' | 'debug';

export type TabMeta = {
  key: TabKey;
  label: string;
};

export type FieldHelpMeta = {
  key: string;
  label: string;
  shortHelp: string;
  detailHelp: string;
  placeholder?: string;
  isAdvanced?: boolean;
};

export const PANEL_TABS: TabMeta[] = [
  { key: 'overview', label: '总览' },
  { key: 'api', label: 'API配置' },
  { key: 'global', label: '全局配置' },
  { key: 'flows', label: '工作流配置' },
  { key: 'debug', label: '调试' },
];

const FIELD_HELP_LIST: FieldHelpMeta[] = [
  {
    key: 'enabled',
    label: '总开关',
    shortHelp: '关闭后不拦截发送，不执行动态世界工作流。',
    detailHelp: '建议先在单聊天内开启验证。出现异常可先关闭总开关快速回退。',
  },
  {
    key: 'dispatch_mode',
    label: '调度模式',
    shortHelp: '并行会同时请求所有工作流，串行会按顺序执行。',
    detailHelp: '串行模式下后续工作流可读取前序结果；并行模式更快，但冲突由优先级和顺序合并。',
  },
  {
    key: 'total_timeout_ms',
    label: '总超时',
    shortHelp: '整轮工作流的最大耗时上限（毫秒）。',
    detailHelp: '超过该时间视为失败并中止本轮发送。建议不小于所有启用工作流超时的最大值。',
  },
  {
    key: 'gate_ttl_ms',
    label: '门控时效',
    shortHelp: '发送链路去重与防重入的有效期（毫秒）。',
    detailHelp: '用于防止快速连点或重复事件触发同一轮工作流，设置过短可能导致重复执行。',
  },
  {
    key: 'runtime_worldbook_prefix',
    label: '运行时世界书前缀',
    shortHelp: '聊天级运行时世界书的命名前缀。',
    detailHelp: '实际名称为“前缀 + chat_id”。建议保留默认前缀以避免与其他脚本冲突。',
    placeholder: 'EW_RUNTIME::',
  },
  {
    key: 'dynamic_entry_prefix',
    label: '动态条目前缀',
    shortHelp: '动态条目写入时使用的命名前缀。',
    detailHelp: '外部返回的 upsert/toggle/delete 条目通常应落在该前缀下，便于识别与清理。',
    placeholder: 'EW/Dyn/',
  },
  {
    key: 'controller_entry_name',
    label: '控制器条目名',
    shortHelp: '控制器 EJS 文本写入的目标条目名。',
    detailHelp: '事务提交时会整条覆盖该条目，请确保该名称仅用于 Evolution World 控制器。',
    placeholder: 'EW/Controller',
  },
  {
    key: 'meta_entry_name',
    label: '元数据条目名',
    shortHelp: '运行时元数据写入的固定条目名。',
    detailHelp: '用于标记运行时世界书身份和状态，自动发现流程会依赖该条目。',
    placeholder: 'EW/Meta',
  },
  {
    key: 'meta_marker',
    label: '元数据标记',
    shortHelp: '用于识别运行时世界书的标记字符串。',
    detailHelp: '自动发现模式会优先查找该标记。通常不建议修改，除非你需要隔离多套系统。',
    isAdvanced: true,
    placeholder: 'EW_RUNTIME_META',
  },
  {
    key: 'max_scan_worldbooks',
    label: '最大扫描世界书数',
    shortHelp: '自动发现时最多扫描的候选世界书数量。',
    detailHelp: '数值越大发现成功率越高，但初始化扫描会更慢。通常保持默认即可。',
    isAdvanced: true,
  },
  {
    key: 'failure_policy',
    label: '失败策略',
    shortHelp: '当前固定为“失败即中止发送”。',
    detailHelp: '任一关键工作流失败、schema 非法或语法校验失败都会停止本轮生成且不提交变更。',
    isAdvanced: true,
  },
  {
    key: 'api_preset.name',
    label: 'API配置名称',
    shortHelp: '用于在工作流里识别和选择该 API 配置。',
    detailHelp: '建议按用途命名，例如“剧情抽取API”“关系更新API”。',
  },
  {
    key: 'api_preset.api_url',
    label: 'API URL',
    shortHelp: '该预设对应的外部工作流接口地址。',
    detailHelp: '应返回符合 ew-flow/v1 的 JSON 响应，建议使用稳定的 HTTPS 地址。',
    placeholder: 'https://example.com/flow',
  },
  {
    key: 'api_preset.api_key',
    label: 'API Key',
    shortHelp: '可选鉴权字段，会放入 Authorization 请求头。',
    detailHelp: '仅在你的服务端要求时填写。前端以密码框显示，但仍建议使用受限密钥。',
  },
  {
    key: 'api_preset.headers_json',
    label: '额外请求头',
    shortHelp: '可附加自定义 HTTP 头（JSON 对象）。',
    detailHelp: '用于网关鉴权或路由标识。格式错误会在调度前被视为配置异常。',
    placeholder: '{"X-Token":"value"}',
  },
  {
    key: 'flow.enabled',
    label: '工作流开关',
    shortHelp: '仅启用的工作流会参与调度。',
    detailHelp: '关闭后该工作流配置会保留，但不会请求外部 API，也不会参与合并。',
  },
  {
    key: 'flow.name',
    label: '名称',
    shortHelp: '仅用于你在界面里识别这条工作流。',
    detailHelp: '建议使用有语义的名称，例如“剧情抽取”“关系更新”。',
  },
  {
    key: 'flow.id',
    label: '工作流ID',
    shortHelp: '请求体中的 flow.id，需在当前工作流配置中唯一。',
    detailHelp: '返回体会带 flow_id 与其对应。重复 ID 会导致调试与合并定位困难。',
  },
  {
    key: 'flow.api_preset_id',
    label: 'API配置预设',
    shortHelp: '选择该工作流要使用的 API 配置预设。',
    detailHelp: '工作流只负责业务参数，接口地址/鉴权/请求头统一从预设读取。',
  },
  {
    key: 'flow.priority',
    label: '优先级',
    shortHelp: '用于多工作流结果合并冲突决策。',
    detailHelp: '按优先级降序合并；同优先级按工作流顺序后者覆盖前者。',
  },
  {
    key: 'flow.timeout_ms',
    label: '超时',
    shortHelp: '单条工作流请求最大耗时（毫秒）。',
    detailHelp: '超时会导致该工作流失败。失败策略固定为中止发送，因此请设置合理值。',
  },
  {
    key: 'flow.context_turns',
    label: '上下文楼层数',
    shortHelp: '发送给该工作流的历史消息楼层数量。',
    detailHelp: '数值越大上下文更完整，但 payload 也更大。建议按模型上下文成本调优。',
  },
  {
    key: 'flow.extract_rules',
    label: '提取规则',
    shortHelp: '按起止标签从文本中提取片段。',
    detailHelp: '每条规则都包含 start/end，提取结果会进入工作流请求的 context 构建流程。',
  },
  {
    key: 'flow.exclude_rules',
    label: '排除规则',
    shortHelp: '按起止标签剔除不应发送的片段。',
    detailHelp: '常用于去掉 thinking 或系统中间内容，减少噪声并降低泄漏风险。',
  },
  {
    key: 'flow.request_template',
    label: '请求模板',
    shortHelp: '对标准请求体进行 JSON merge 扩展。',
    detailHelp: '用于补充额外字段。请确保合并后仍满足外部工作流预期结构。',
    placeholder: '{"context":{"turns":{{context.turns}}}}',
  },
  {
    key: 'manual_message',
    label: '手动运行输入',
    shortHelp: '调试模式手动执行时的输入内容。',
    detailHelp: '留空时默认使用最新楼层文本，适合快速复现实战场景。',
  },
  {
    key: 'import_text',
    label: '导入配置',
    shortHelp: '粘贴完整 JSON 后应用到当前脚本配置。',
    detailHelp: '导入后会立即校验并覆盖当前设置。建议先导出备份再导入。',
  },
];

export const FIELD_HELP: Record<string, FieldHelpMeta> = Object.fromEntries(
  FIELD_HELP_LIST.map(meta => [meta.key, meta]),
);

export function getFieldHelp(key: string): FieldHelpMeta | undefined {
  return FIELD_HELP[key];
}
