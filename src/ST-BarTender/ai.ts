// ============================================================
// AI 调用模块 — 与 AI 交互，生成抽象组件树
// ============================================================

import { WidgetConfigSchema, type ApiConfig, type PresetEntrySnapshot, type WidgetConfig } from './schema';
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

    ## 最佳实践

    1. **只输出纯 JSON**（可包裹在\`\`\`json内），不要有任何其他文字。
    2. **高级感来源于留白与嵌套**：顶层是一个 \`container(column)\`，里面是几个 \`card(glass, rounded)\`。
    3. **用 \`text\` 做区域标题**（\`appearance.typography: 'h2'\`），放在 card 内部最前面。
    4. **slider 必须设置 \`slider_meta\`**：根据参数类型合理设置区间。例如 temperature 用 \`{min:0, max:2, step:0.05}\`，max_context 用 \`{min:1024, max:200000, step:1024}\`。
    5. **严格引用上下文**：\`entry_id\` 和 \`param_name\` 必须从上面的列表中选取，不要凭空创造。
    6. **分组要智能**：根据条目名称的语义相近度进行分组，功能相关的放在一起。

    ## 完整输出示例

    以下示例展示了一个包含两个卡片的控制台：左边是条目开关，右边是参数调节。

    \`\`\`json
    {
      "title": "角色扮演控制台",
      "root": {
        "id": "root",
        "type": "container",
        "layout": { "direction": "column", "gap": "medium", "padding": "medium" },
        "children": [
          {
            "id": "row1",
            "type": "container",
            "layout": { "direction": "row", "gap": "medium", "align": "stretch" },
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
 * 调用 AI 生成面板配置
 */
export async function callAI(
  userMessage: string,
  presetEntries: PresetEntrySnapshot[],
  presetParams: Record<string, number>,
  apiConfig: ApiConfig,
  customSystemPrompt?: string,
): Promise<WidgetConfig> {
  let systemPrompt: string;
  if (customSystemPrompt?.trim()) {
    // 用户自定义 prompt：追加当前预设上下文，确保 AI 有数据可用
    const entriesJson = JSON.stringify(
      presetEntries.map(e => ({ id: e.id, name: e.name, enabled: e.enabled, role: e.role, position: e.position_type })),
      null, 2,
    );
    const paramsJson = JSON.stringify(presetParams, null, 2);
    systemPrompt = `${customSystemPrompt.trim()}

---
## 当前预设条目
\`\`\`json
${entriesJson}
\`\`\`

## 当前预设参数
\`\`\`json
${paramsJson}
\`\`\`
`;
  } else {
    systemPrompt = buildSystemPrompt(presetEntries, presetParams);
  }

  const config: GenerateRawConfig = {
    user_input: userMessage,
    should_silence: true,
    ordered_prompts: [
      { role: 'system', content: systemPrompt },
      'user_input',
    ],
  };

  if (apiConfig.mode === 'custom' && apiConfig.custom_url) {
    config.custom_api = {
      apiurl: apiConfig.custom_url,
      key: apiConfig.custom_key || undefined,
      model: apiConfig.custom_model,
      source: apiConfig.custom_source || 'openai',
    };
  }

  console.info('[预设控制] 正在调用 AI...');
  const rawResponse = await generateRaw(config);

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

  console.info('[预设控制] 解析成功:', result.data);
  return result.data;
}
