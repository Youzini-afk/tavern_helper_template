// ============================================================
// AI 调用模块 — 与 AI 交互，生成抽象组件树
// ============================================================

import { WidgetConfigSchema, type ApiConfig, type PresetEntrySnapshot, type UIBlock, type WidgetConfig } from './schema';
import { parseString } from '@util/common';

/**
 * 构建 system prompt
 */
export function buildSystemPrompt(presetEntries: PresetEntrySnapshot[], presetParams: Record<string, number>): string {
  const entriesJson = JSON.stringify(
    presetEntries.map(e => ({
      id: e.id,
      name: e.name,
      enabled: e.enabled,
      role: e.role,
      position: e.position_type,
    })),
    null,
    2,
  );

  const paramsJson = JSON.stringify(presetParams, null, 2);

  return dedent(`
    你是一个预设的高级 UI 控制台架构师。你的任务是根据用户的需求，自动搭建一个精美的控制面板。
    这个平台提供一套基于 JSON 抽象出的高级组件系统 (Abstract Component Tree)。你的输出将直接由我们的前端渲染引擎转化为极度精美的毛玻璃 UI (Glassmorphism)。

    ## 上下文：酒馆当前状态

    1. 当前预设的提示词条目 (可绑定 \`toggle_preset_entry\` action)：
    \`\`\`json
    ${entriesJson}
    \`\`\`

    2. 当前预设的核心运行参数 (可绑定 \`set_preset_param\` action)：
    \`\`\`json
    ${paramsJson}
    \`\`\`

    ## 输出格式 (完整树状嵌套 JSON)

    \`\`\`typescript
    type WidgetConfig = {
      title: string;
      root: UIBlock;
    }

    type UIBlock = {
      id: string;             // 唯一标识，请用 "b1", "b2" 等简短ID
      type: 'container' | 'card' | 'text' | 'toggle' | 'slider' | 'button' | 'divider';
      content?: string;       // text 类型的文字
      label?: string;         // toggle/slider/button 的标签

      layout?: {              // 仅 container/card 有意义
        direction?: 'row' | 'column';
        wrap?: boolean;
        gap?: 'none' | 'small' | 'medium' | 'large';
        padding?: 'none' | 'small' | 'medium' | 'large';
        justify?: 'start' | 'center' | 'end' | 'space-between';
        align?: 'start' | 'center' | 'end' | 'stretch';
        width?: 'auto' | 'full' | 'half' | 'hug';
      };

      appearance?: {          // 视觉Token
        theme?: 'glass' | 'solid' | 'transparent';
        typography?: 'h1' | 'h2' | 'body' | 'caption';
        elevation?: 0 | 1 | 2 | 3;
        corner?: 'sharp' | 'rounded' | 'pill';
      };

      // 行为绑定
      action?:
        | { type: 'none' }
        | { type: 'toggle_preset_entry', entry_id: '<条目id>' }
        | { type: 'set_preset_param', param_name: '<参数名>' };

      // slider 专用：指定数值范围和步长
      slider_meta?: {
        min: number;   // 默认 0
        max: number;   // 默认 2
        step: number;  // 默认 0.05
      };

      children?: UIBlock[];
    }
    \`\`\`

    ## ⚠️ 布局硬性规则（必须严格遵守！）

    1. **所有 card 和 container 必须设 \`layout.width: 'full'\`**，禁止使用 'hug' 或 'auto'。
    2. **顶层 root** 必须是 \`container\` + \`direction: 'column'\` + \`width: 'full'\` + \`padding: 'medium'\`。
    3. **若用 row 布局并排放卡片**，row container 设 \`width: 'full'\`，内部每个 card 也设 \`width: 'full'\`（flex 自动均分）。
    4. **toggle 的 label** 必须是完整名称，不要缩写或截断。
    5. **所有 card** 至少设置 \`padding: 'medium'\`。

    ## 最佳实践

    1. **只输出纯 JSON**（可包裹在\`\`\`json内），不要有任何其他文字。
    2. **高级感来源于留白与嵌套**：顶层是一个 \`container(column, full)\`，里面是几个 \`card(glass, rounded, full)\`。
    3. **用 \`text\` 做区域标题**（\`appearance.typography: 'h2'\`），放在 card 内部最前面。
    4. **slider 必须设置 \`slider_meta\`**：根据参数类型合理设置区间。例如 temperature 用 \`{min:0, max:2, step:0.05}\`，max_context 用 \`{min:1024, max:200000, step:1024}\`。
    5. **严格引用上下文**：\`entry_id\` 和 \`param_name\` 必须从上面的列表中选取，不要凭空创造。
    6. **分组要智能**：根据条目名称的语义相近度进行分组，功能相关的放在一起。

    ## 完整输出示例

    以下示例展示了一个包含两个卡片的控制台。注意所有 card/container 都用了 \`width: 'full'\`。

    \`\`\`json
    {
      "title": "角色扮演控制台",
      "root": {
        "id": "root",
        "type": "container",
        "layout": { "direction": "column", "gap": "medium", "padding": "medium", "width": "full" },
        "children": [
          {
            "id": "row1",
            "type": "container",
            "layout": { "direction": "row", "gap": "medium", "align": "stretch", "width": "full" },
            "children": [
              {
                "id": "card-prompts",
                "type": "card",
                "appearance": { "theme": "glass", "corner": "rounded", "elevation": 1 },
                "layout": { "direction": "column", "gap": "small", "padding": "medium", "width": "full" },
                "children": [
                  { "id": "t1", "type": "text", "content": "提示词条目", "appearance": { "typography": "h2" } },
                  { "id": "sw1", "type": "toggle", "label": "主系统提示", "action": { "type": "toggle_preset_entry", "entry_id": "main" } },
                  { "id": "sw2", "type": "toggle", "label": "越狱提示", "action": { "type": "toggle_preset_entry", "entry_id": "jailbreak" } }
                ]
              },
              {
                "id": "card-params",
                "type": "card",
                "appearance": { "theme": "glass", "corner": "rounded", "elevation": 1 },
                "layout": { "direction": "column", "gap": "small", "padding": "medium", "width": "full" },
                "children": [
                  { "id": "t2", "type": "text", "content": "生成参数", "appearance": { "typography": "h2" } },
                  { "id": "sl1", "type": "slider", "label": "温度", "action": { "type": "set_preset_param", "param_name": "temperature" }, "slider_meta": { "min": 0, "max": 2, "step": 0.05 } },
                  { "id": "div1", "type": "divider" },
                  { "id": "sl2", "type": "slider", "label": "Top P", "action": { "type": "set_preset_param", "param_name": "top_p" }, "slider_meta": { "min": 0, "max": 1, "step": 0.05 } }
                ]
              }
            ]
          }
        ]
      }
    }
    \`\`\`
  `);
}

/**
 * 从 AI 回复中提取 JSON
 */
function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}

/**
 * 后处理：修正 AI 返回的不合理布局值
 */
function sanitizeBlock(block: UIBlock, isRoot = false): UIBlock {
  const b = { ...block };

  // card 和 container 强制 width: 'full'
  if (b.type === 'card' || b.type === 'container') {
    if (!b.layout) b.layout = {};
    // 'hug' 和 'auto' 会导致内容过窄，强制改为 'full'
    if (!b.layout.width || b.layout.width === 'hug' || b.layout.width === 'auto') {
      b.layout.width = 'full';
    }
    // card 至少要有 padding
    if (b.type === 'card' && !b.layout.padding) {
      b.layout.padding = 'medium';
    }
  }

  // root 节点强制 column + full
  if (isRoot) {
    if (!b.layout) b.layout = {};
    b.layout.direction = 'column';
    b.layout.width = 'full';
    if (!b.layout.padding) b.layout.padding = 'medium';
    if (!b.layout.gap) b.layout.gap = 'medium';
  }

  // 递归处理子节点
  if (b.children) {
    b.children = b.children.map(child => sanitizeBlock(child));
  }

  return b;
}

function sanitizeWidgetConfig(config: WidgetConfig): WidgetConfig {
  return {
    ...config,
    root: sanitizeBlock(config.root, true),
  };
}


export async function callAI(
  userMessage: string,
  presetEntries: PresetEntrySnapshot[],
  presetParams: Record<string, number>,
  apiConfig: ApiConfig,
  customSystemPrompt?: string,
): Promise<WidgetConfig> {
  const systemPrompt = customSystemPrompt?.trim() || buildSystemPrompt(presetEntries, presetParams);

  console.info('[预设控制] system prompt 长度:', systemPrompt.length, '字符');
  console.info('[预设控制] API 模式:', apiConfig.mode, apiConfig.mode === 'custom' ? apiConfig.custom_url : '(使用酒馆API)');

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMessage },
  ];

  let rawResponse: string;

  if (apiConfig.mode === 'custom' && apiConfig.custom_url) {
    // === 自定义 API: 参照 shujuku 的直接 fetch 方式 ===
    // 通过 SillyTavern 后端代理发送请求
    const parentWin = (window.parent && window.parent !== window) ? window.parent : window;
    const stApi = (parentWin as any).SillyTavern;
    if (!stApi?.getRequestHeaders) {
      throw new Error('SillyTavern API 不可用，请检查酒馆版本');
    }

    const requestBody = {
      messages,
      model: apiConfig.custom_model,
      max_tokens: 16000,
      temperature: 0.7,
      top_p: 0.95,
      stream: false,
      chat_completion_source: 'custom',
      custom_prompt_post_processing: 'strict',
      reverse_proxy: apiConfig.custom_url,
      custom_url: apiConfig.custom_url,
      custom_include_headers: apiConfig.custom_key
        ? `Authorization: Bearer ${apiConfig.custom_key}`
        : '',
    };

    console.info('[预设控制] 正在通过自定义 API 调用 (fetch)...');
    const response = await parentWin.fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: { ...stApi.getRequestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errTxt = await response.text();
      throw new Error(`API 请求失败: ${response.status} ${errTxt}`);
    }

    const data = await response.json();
    if (data?.choices?.[0]?.message?.content) {
      rawResponse = data.choices[0].message.content.trim();
    } else if (data?.content) {
      rawResponse = data.content.trim();
    } else {
      throw new Error(`API 返回无效响应: ${JSON.stringify(data).slice(0, 500)}`);
    }
  } else {
    // === 酒馆主 API: 参照 shujuku 使用 TavernHelper.generateRaw ===
    const parentWin = (window.parent && window.parent !== window) ? window.parent : window;
    const th = (parentWin as any).TavernHelper;
    if (typeof th?.generateRaw !== 'function') {
      throw new Error('TavernHelper.generateRaw 不可用，请检查酒馆版本');
    }

    console.info('[预设控制] 正在通过酒馆 API 调用 (TavernHelper.generateRaw)...');
    const response = await th.generateRaw({
      ordered_prompts: messages,
      should_stream: false,
    });

    if (typeof response !== 'string') {
      throw new Error('主API调用未返回预期的文本响应');
    }
    rawResponse = response.trim();
  }

  console.info('[预设控制] AI 返回, 长度:', rawResponse?.length ?? 0);

  const jsonStr = extractJson(rawResponse);

  let parsed: unknown;
  try {
    parsed = parseString(jsonStr);
  } catch (err) {
    throw new Error(`AI 返回的内容无法解析为有效 JSON:\n${jsonStr}`);
  }

  const result = WidgetConfigSchema.safeParse(parsed);
  if (!result.success) {
    const errorInfo = z.prettifyError(result.error);
    throw new Error(`AI 返回的 JSON 不符合预期格式:\n${errorInfo}`);
  }

  // 后处理：自动修正 AI 返回的不合理布局值
  const sanitized = sanitizeWidgetConfig(result.data);
  console.info('[预设控制] 解析并修正成功:', sanitized);
  return sanitized;
}
