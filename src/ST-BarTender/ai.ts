// ============================================================
// AI 调用模块 — 与 AI 交互，生成抽象组件树
// ============================================================

import { WidgetConfigSchema, type ApiConfig, type PresetEntrySnapshot, type UIBlock, type WidgetConfig } from './schema';
import { parseString } from '@util/common';

/**
 * 构建 system prompt
 */
export function buildSystemPrompt(presetEntries: PresetEntrySnapshot[], _presetParams: Record<string, number>): string {
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

  return dedent(`
    你是一个预设的高级 UI 控制台架构师。你的任务是根据用户的需求，自动搭建一个精美的控制面板。
    这个平台提供一套基于 JSON 抽象出的高级组件系统 (Abstract Component Tree)。你的输出将直接由我们的前端渲染引擎转化为极度精美的毛玻璃 UI (Glassmorphism)。

    ## 上下文：酒馆当前状态

    当前预设的提示词条目 (可绑定 \`toggle_preset_entry\` action)：
    \`\`\`json
    ${entriesJson}
    \`\`\`

    ## 输出格式 (完整树状嵌套 JSON)

    \`\`\`typescript
    type WidgetConfig = {
      title: string;
      root: UIBlock;
    }

    type UIBlock = {
      id: string;             // 唯一标识，请用 "b1", "b2" 等简短ID
      type: 'container' | 'card' | 'text' | 'toggle' | 'button' | 'divider';
      content?: string;       // text 类型的文字
      label?: string;         // toggle/button 的标签

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

      // 行为绑定（只支持 toggle_preset_entry）
      action?:
        | { type: 'none' }
        | { type: 'toggle_preset_entry', entry_id: '<条目id>' };

      children?: UIBlock[];
    }
    \`\`\`

    ## ⚠️ 硬性规则（必须严格遵守！）

    1. **禁止使用 row 布局**！所有卡片必须垂直排列（\`direction: 'column'\`）。
    2. **所有 card 和 container 必须设 \`layout.width: 'full'\`**，禁止 'hug' 或 'auto'。
    3. **顶层 root** 必须是 \`container\` + \`direction: 'column'\` + \`width: 'full'\` + \`padding: 'medium'\`。
    4. **toggle 的 label 必须是条目的完整名称**，不允许缩写、截断或修改。
    5. **所有 card** 至少设置 \`padding: 'medium'\`。
    6. **必须包含所有条目**！上面列出的每一个预设条目都必须生成对应的 toggle，不允许遗漏。
    7. **禁止生成 slider**！不要生成任何生成参数相关的调节控件。只生成提示词条目的 toggle 开关。
    8. **严格保持条目原始顺序**！条目列表是预设作者精心排列的，你必须按原始顺序放置 toggle，不允许打乱、重新排序或把距离很远的条目拆开重组到一起。
    9. **分组基于相邻性**！只把列表中相邻的、语义相近的条目归入同一个 card。禁止把列表中距离很远的条目强行拉到一个分组里。如果连续几个条目之间看不出明确的语义关联，宁可每个条目单独一个 card 或把它们按原始顺序依次放在同一个 card 里，也不要自编一个笼统的分类名把不相关的条目塞在一起。

    ## 最佳实践

    1. **只输出纯 JSON**（可包裹在\`\`\`json内），不要有任何其他文字。
    2. **高级感来源于留白与嵌套**：顶层是一个 \`container(column, full)\`，里面是几个 \`card(glass, rounded, full)\`。
    3. **用 \`text\` 做区域标题**（\`appearance.typography: 'h2'\`），放在 card 内部最前面。标题应基于该组条目的实际含义，不要用笼统的"其他"或随意总结的名称。
    4. **严格引用上下文**：\`entry_id\` 必须从上面的列表中选取。
    5. **尊重预设作者的分区意图**：预设作者把条目排在一起通常意味着它们功能相关。按顺序扫描条目列表，遇到语义断点（功能明显不同）时断开为新的 card。

    ## 完整输出示例

    以下示例展示了一个单栏布局的控制台。注意只有 toggle，没有 slider。

    \`\`\`json
    {
      "title": "角色扮演控制台",
      "root": {
        "id": "root",
        "type": "container",
        "layout": { "direction": "column", "gap": "medium", "padding": "medium", "width": "full" },
        "children": [
          {
            "id": "card-core",
            "type": "card",
            "appearance": { "theme": "glass", "corner": "rounded", "elevation": 1 },
            "layout": { "direction": "column", "gap": "small", "padding": "medium", "width": "full" },
            "children": [
              { "id": "t1", "type": "text", "content": "核心提示词", "appearance": { "typography": "h2" } },
              { "id": "sw1", "type": "toggle", "label": "主系统提示", "action": { "type": "toggle_preset_entry", "entry_id": "main" } },
              { "id": "sw2", "type": "toggle", "label": "越狱提示", "action": { "type": "toggle_preset_entry", "entry_id": "jailbreak" } }
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

  // card 和 container 强制 width: 'full' + direction: 'column'
  if (b.type === 'card' || b.type === 'container') {
    if (!b.layout) b.layout = {};
    // 强制 column 布局，禁止 row（悬浮窗口窄小时 row 会溢出）
    if (b.layout.direction === 'row') {
      b.layout.direction = 'column';
    }
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
  onStream?: (chunk: string) => void,
): Promise<WidgetConfig> {
  const systemPrompt = customSystemPrompt?.trim() || buildSystemPrompt(presetEntries, presetParams);

  console.info('[预设控制] system prompt 长度:', systemPrompt.length, '字符');
  console.info('[预设控制] API 模式:', apiConfig.mode, apiConfig.mode === 'custom' ? apiConfig.custom_url : '(使用酒馆API)');

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMessage },
  ];

  // === 解析可用 API 源 ===
  const parentWin = (() => {
    try {
      return (window.parent && window.parent !== window) ? window.parent : window;
    } catch { return window; }
  })();

  const stApi = (typeof SillyTavern !== 'undefined' ? SillyTavern : (parentWin as any).SillyTavern) as typeof SillyTavern | undefined;
  const thApi = (typeof TavernHelper !== 'undefined' ? TavernHelper : (parentWin as any).TavernHelper) as typeof TavernHelper | undefined;
  const fetchFn = parentWin.fetch.bind(parentWin);

  console.info('[预设控制] API 源检测:', {
    SillyTavern: !!stApi?.getRequestHeaders,
    TavernHelper: !!thApi?.generateRaw,
    generateRaw: typeof generateRaw === 'function',
    mode: apiConfig.mode,
    stream: apiConfig.gen_stream,
  });

  let rawResponse: string;

  if (apiConfig.mode === 'custom' && apiConfig.custom_url) {
    // === 自定义 API ===
    const useStream = !!(apiConfig.gen_stream && onStream);

    if (useStream) {
      // === 流式：直接调用自定义 API（绕过 ST 代理，因为 ST 代理不转发 SSE） ===
      const baseUrl = apiConfig.custom_url.replace(/\/+$/, '');
      const streamUrl = `${baseUrl}/chat/completions`;

      const streamBody = {
        messages,
        model: (apiConfig.custom_model || '').replace(/^models\//, ''),
        max_tokens: apiConfig.gen_max_tokens || 64000,
        temperature: apiConfig.gen_temperature ?? 0.7,
        top_p: apiConfig.gen_top_p ?? 0.95,
        stream: true,
      };

      const streamHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiConfig.custom_key) {
        streamHeaders['Authorization'] = `Bearer ${apiConfig.custom_key}`;
      }

      console.info('[预设控制] 流式直接调用:', streamUrl);
      const response = await fetchFn(streamUrl, {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify(streamBody),
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`API 请求失败: ${response.status} ${errTxt}`);
      }

      // === SSE 流式读取 ===
      rawResponse = '';
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              rawResponse += delta;
              onStream(delta);
            }
          } catch {
            // 非 JSON 行，忽略
          }
        }
      }
    } else {
      // === 非流式：通过 ST 代理 ===
      if (!stApi?.getRequestHeaders) {
        throw new Error('SillyTavern.getRequestHeaders 不可用');
      }

      const requestBody = {
        messages: messages,
        model: (apiConfig.custom_model || '').replace(/^models\//, ''),
        max_tokens: apiConfig.gen_max_tokens || 64000,
        temperature: apiConfig.gen_temperature ?? 0.7,
        top_p: apiConfig.gen_top_p ?? 0.95,
        stream: false,
        chat_completion_source: 'custom',
        group_names: [],
        include_reasoning: false,
        reasoning_effort: 'medium',
        enable_web_search: false,
        request_images: false,
        custom_prompt_post_processing: 'strict',
        reverse_proxy: apiConfig.custom_url,
        proxy_password: '',
        custom_url: apiConfig.custom_url,
        custom_include_headers: apiConfig.custom_key
          ? `Authorization: Bearer ${apiConfig.custom_key}`
          : '',
      };

      console.info('[预设控制] 非流式通过 ST 代理调用...');
      const response = await fetchFn('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...stApi.getRequestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`API 请求失败: ${response.status} ${errTxt}`);
      }

      const data = await response.json();
      if (data?.choices?.[0]) {
        rawResponse = (data.choices[0].message?.content || '').trim();
      } else if (data?.content) {
        rawResponse = data.content.trim();
      } else {
        const errorMessage = data?.error?.message || JSON.stringify(data).slice(0, 500);
        throw new Error(`API 返回无效响应: ${errorMessage}`);
      }
    }
  } else {
    // === 酒馆主 API ===
    const genRawFn =
      (typeof thApi?.generateRaw === 'function' ? thApi.generateRaw : undefined) ||
      (typeof generateRaw === 'function' ? generateRaw : undefined);

    if (!genRawFn) {
      throw new Error('generateRaw 不可用 — 请确认已安装酒馆助手(TavernHelper)扩展');
    }

    console.info('[预设控制] 正在通过酒馆 API 调用 generateRaw...');
    const response = await genRawFn({
      ordered_prompts: messages,
      should_stream: apiConfig.gen_stream ?? true,
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
