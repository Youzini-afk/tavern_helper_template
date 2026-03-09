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
    你是预设 UI 控制台架构师。根据预设条目列表，生成一个精美控制面板的 JSON 配置。

    # 条目列表

    \`\`\`json
    ${entriesJson}
    \`\`\`

    # 组件规格

    UIBlock = { id, type, content?, label?, layout?, appearance?, action?, children? }

    | 属性 | 值 |
    |------|-----|
    | type | container / card / text / toggle / divider |
    | layout.direction | column (禁止 row) |
    | layout.gap / padding | none / small / medium |
    | layout.width | full (固定) |
    | appearance.theme | glass / solid / transparent |
    | appearance.typography | h2 / body / caption |
    | appearance.corner | rounded |
    | action | { type: "toggle_preset_entry", entry_id: "<id>" } |

    输出: \`{ title: string, root: UIBlock }\`

    # 预设结构认知

    预设条目通常由预设作者精心排列成若干功能区：

    - **系统级条目**：main、jailbreak 等系统提示词，通常在列表首尾
    - **功能散项**：作者声明、变量初始化等单独存在的条目
    - **功能分区**：连续出现的语义相近条目构成一个区域，常见的分区有：
      - 角色扮演/视角/人称控制
      - 写作指导/文风/风格要求
      - 破限/越狱/道德设置
      - CoT/思维链/推理引导
      - 输出格式/语言/排版控制
      - 场景/世界观/设定补充

    **识别分区的关键**：看名称的语义聚类和在列表中的位置邻近性。相邻且语义相关的条目属于同一区，语义断裂处就是分区边界。

    # 思考指引 (必须先思考再输出)

    在输出 JSON 之前，你必须在 \`<think>\` 标签中完成以下分析：

    1. **扫描条目**：按顺序浏览所有条目，标记哪些是散项、哪些可归入同一区
    2. **划定边界**：在语义突变处断开分区，给每个分区起一个精确的标题（基于条目实际内容，不要用"其他"）
    3. **确认完整性**：检查每个条目都已分配到某个 card，无遗漏

    # 规则

    1. 保持条目原始顺序，禁止重排
    2. 分组基于相邻性+语义，禁止跨区域拉取条目
    3. 结构严格 2 层：root(container) → card → [text/toggle/divider]
    4. toggle.label = 条目完整名称，不得修改
    5. 每个 card 以 h2 text 作标题，标题基于该组条目的实际功能
    6. 只生成 toggle 控件，禁止 slider/button
    7. 所有条目必须包含，不允许遗漏
    8. 输出纯 JSON（可包裹在 \`\`\`json 内），思考过程放在 <think> 标签中
  `);
}

/**
 * 从 AI 回复中提取 JSON (自动剥离 <think> 思考块)
 */
function extractJson(text: string): string {
  // 剥离 <think>...</think> 思考块
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const fenceMatch = stripped.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return stripped.slice(firstBrace, lastBrace + 1);
  }

  return stripped;
}

/**
 * 后处理：修正 AI 返回的不合理布局值
 */
function sanitizeBlock(block: UIBlock, isRoot = false, depth = 0): UIBlock {
  const b = { ...block };

  // 用户手动编辑过的区块，跳过强制布局修正，仅递归处理子节点
  if (b._userEdited && !isRoot) {
    if (b.children) {
      const flatChildren: UIBlock[] = [];
      for (const child of b.children) {
        if (depth >= 2 && !child._userEdited && (child.type === 'container' || child.type === 'card')) {
          if (child.children) {
            flatChildren.push(...child.children.map(gc => sanitizeBlock(gc, false, depth + 1)));
          }
        } else {
          flatChildren.push(sanitizeBlock(child, false, depth + 1));
        }
      }
      b.children = flatChildren;
    }
    return b;
  }

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

  // 递归处理子节点，同时拍扁过深嵌套
  if (b.children) {
    const flatChildren: UIBlock[] = [];
    for (const child of b.children) {
      // 如果深度 ≥ 2 且子节点是 container/card，把它的 children 提升上来（拍扁）
      if (depth >= 2 && (child.type === 'container' || child.type === 'card')) {
        if (child.children) {
          flatChildren.push(...child.children.map(gc => sanitizeBlock(gc, false, depth + 1)));
        }
      } else {
        flatChildren.push(sanitizeBlock(child, false, depth + 1));
      }
    }
    b.children = flatChildren;
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
  currentConfig?: WidgetConfig | null,
  onStream?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<WidgetConfig> {
  const systemPrompt = customSystemPrompt?.trim() || buildSystemPrompt(presetEntries, presetParams);

  console.info('[预设控制] system prompt 长度:', systemPrompt.length, '字符');
  console.info('[预设控制] API 模式:', apiConfig.mode, apiConfig.mode === 'custom' ? apiConfig.custom_url : '(使用酒馆API)');

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // 注入当前面板配置作为上下文
  if (currentConfig) {
    messages.push({
      role: 'assistant',
      content: `当前面板配置：\n\`\`\`json\n${JSON.stringify(currentConfig)}\n\`\`\``,
    });
  }

  messages.push({ role: 'user', content: userMessage });

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
        signal,
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
        if (signal?.aborted) { reader.cancel(); break; }
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
        signal,
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
