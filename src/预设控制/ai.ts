// ============================================================
// AI 调用模块 — 与 AI 交互，解析结构化返回
// ============================================================

import { WidgetConfigSchema, type ApiConfig, type PresetEntrySnapshot, type WidgetConfig } from './schema';
import { parseString } from '@util/common';

/**
 * 构建 system prompt
 */
function buildSystemPrompt(presetEntries: PresetEntrySnapshot[]): string {
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
    你是一个预设条目控制面板生成助手。你的任务是根据用户的自然语言描述，将预设中的提示词条目分组，生成一个 JSON 控制面板配置。

    ## 当前预设条目列表

    \`\`\`json
    ${entriesJson}
    \`\`\`

    ## 输出格式

    你必须且只能返回以下 JSON 格式（不要包含任何其他文字或解释）：

    \`\`\`json
    {
      "title": "面板标题",
      "groups": [
        {
          "title": "分组标题",
          "description": "可选的分组描述",
          "items": [
            {
              "label": "开关显示名称",
              "preset_entry_id": "条目的id",
              "preset_entry_name": "条目的name",
              "enabled": true,
              "color": "可选的颜色标记 (如 #4CAF50)"
            }
          ]
        }
      ]
    }
    \`\`\`

    ## 规则

    1. 根据用户的描述，将条目按功能/用途/主题智能分组
    2. \`preset_entry_id\` 和 \`preset_entry_name\` 必须与上面列表中的 \`id\` 和 \`name\` 完全一致
    3. \`enabled\` 的值应该反映条目当前的启用状态
    4. 如果用户想开启或关闭某些条目，更新对应的 \`enabled\` 值
    5. 如果用户没有指定分组方式，请根据条目名称和角色智能推断合理分组
    6. 分组标题应该简洁明了
    7. 只返回 JSON 格式数据，不要有任何其他内容
  `);
}

/**
 * 从 AI 回复中提取 JSON
 */
function extractJson(text: string): string {
  // 尝试从 markdown fence 中提取
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // 尝试直接找 JSON 对象
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
  apiConfig: ApiConfig,
): Promise<WidgetConfig> {
  const systemPrompt = buildSystemPrompt(presetEntries);

  // 构建请求配置
  const config: GenerateRawConfig = {
    user_input: userMessage,
    should_silence: true,
    ordered_prompts: [
      { role: 'system', content: systemPrompt },
      'user_input',
    ],
  };

  // 如果使用自定义 API
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
  console.info('[预设控制] AI 原始回复:', rawResponse);

  // 提取 JSON
  const jsonStr = extractJson(rawResponse);

  // 解析 JSON（使用 parseString 支持 JSON5/YAML 兼容）
  let parsed: unknown;
  try {
    parsed = parseString(jsonStr);
  } catch (err) {
    throw new Error(`AI 返回的内容无法解析为有效 JSON:\n${jsonStr}`);
  }

  // Zod 校验
  const result = WidgetConfigSchema.safeParse(parsed);
  if (!result.success) {
    const errorInfo = z.prettifyError(result.error);
    throw new Error(`AI 返回的 JSON 不符合预期格式:\n${errorInfo}`);
  }

  console.info('[预设控制] 解析成功:', result.data);
  return result.data;
}
