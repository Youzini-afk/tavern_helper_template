import { buildFlowRequest } from './context-builder';
import { FlowResponseSchema } from './contracts';
import { collectPromptComponents, assembleOrderedPrompts, PromptComponents } from './prompt-assembler';
import { DispatchFlowAttempt, DispatchFlowResult, EwApiPreset, EwFlowConfig, EwSettings } from './types';

type DispatchInput = {
  settings: EwSettings;
  flows: EwFlowConfig[];
  message_id: number;
  request_id: string;
};

export type DispatchFlowsOutput = {
  results: DispatchFlowResult[];
  attempts: DispatchFlowAttempt[];
};

export class DispatchFlowsError extends Error {
  attempts: DispatchFlowAttempt[];

  constructor(message: string, attempts: DispatchFlowAttempt[]) {
    super(message);
    this.name = 'DispatchFlowsError';
    this.attempts = attempts;
  }
}

const LLM_WORKFLOW_SYSTEM_PROMPT = [
  '你是 Evolution World 的工作流执行器。',
  '你会收到一个 FlowRequestV1 JSON，请返回一个严格符合 ew-flow/v1 的 FlowResponseV1 JSON。',
  '必须只输出 JSON 对象，不允许 markdown、不允许代码块、不允许额外解释。',
  'status 必须为 ok，operations.worldbook 字段必须存在（允许为空数组）。',
  'flow_id 必须与请求.flow.id 一致，priority 必须与请求.flow.priority 一致。',
].join('\n');

function applyTemplate(base: Record<string, any>, templateText: string): Record<string, any> {
  if (!templateText.trim()) {
    return base;
  }

  const replaced = templateText.replace(/\{\{\s*([a-zA-Z0-9_.$]+)\s*\}\}/g, (_match, path) => {
    const value = _.get(base, path);
    if (_.isPlainObject(value) || Array.isArray(value)) {
      return JSON.stringify(value);
    }
    return value === undefined ? '' : String(value);
  });

  let templateObject: Record<string, any>;
  try {
    const parsed = JSON.parse(replaced);
    if (!_.isPlainObject(parsed)) {
      throw new Error('request_template must parse to JSON object');
    }
    templateObject = parsed as Record<string, any>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`flow request_template invalid: ${message}`);
  }

  return _.merge({}, base, templateObject);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseJsonFromText(rawText: string, flowId: string): Record<string, any> {
  // CR-10: Try direct parse first — handles clean JSON output without regex issues
  try {
    const direct = JSON.parse(rawText.trim());
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct;
    }
  } catch { /* fall through to regex extraction */ }
  const trimmed = rawText.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(withoutFence);
    if (!_.isPlainObject(parsed)) {
      throw new Error('model output is not a JSON object');
    }
    return parsed as Record<string, any>;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const sliced = withoutFence.slice(start, end + 1);
        const parsed = JSON.parse(sliced);
        if (!_.isPlainObject(parsed)) {
          throw new Error('model output is not a JSON object');
        }
        return parsed as Record<string, any>;
      } catch (error) {
        throw new Error(`[${flowId}] model output invalid JSON: ${toErrorMessage(error)}`);
      }
    }
    throw new Error(`[${flowId}] model output does not contain JSON object`);
  }
}

function resolveApiPreset(settings: EwSettings, flow: EwFlowConfig): EwApiPreset {
  const matchedPreset = settings.api_presets.find(preset => preset.id === flow.api_preset_id);
  if (matchedPreset) {
    return matchedPreset;
  }

  const hasLegacyApiConfig = Boolean(flow.api_url.trim() || flow.api_key.trim() || flow.headers_json.trim());
  if (hasLegacyApiConfig) {
    return {
      id: '__legacy__',
      name: '兼容旧配置',
      mode: 'workflow_http',
      use_main_api: false,
      api_url: flow.api_url,
      api_key: flow.api_key,
      model: '',
      api_source: 'openai',
      model_candidates: [],
      headers_json: flow.headers_json,
    };
  }

  if (settings.api_presets.length > 0) {
    return settings.api_presets[0];
  }

  throw new Error(`[${flow.id}] api preset not found`);
}

/**
 * 主 API 路径：通过 TavernHelper.generateRaw 使用酒馆当前配置的 API。
 */
async function executeFlowViaLlmConnector(
  flow: EwFlowConfig,
  body: Record<string, any>,
  components: PromptComponents,
): Promise<NonNullable<DispatchFlowAttempt['response']>> {
  if (typeof generateRaw !== 'function') {
    throw new Error(`[${flow.id}] generateRaw is unavailable`);
  }

  const orderedPrompts = await assembleOrderedPrompts(flow.prompt_order, components);
  orderedPrompts.push({ role: 'system', content: LLM_WORKFLOW_SYSTEM_PROMPT });
  orderedPrompts.push({ role: 'user', content: JSON.stringify(body, null, 2) });

  const rawText = await generateRaw({
    should_stream: false,
    should_silence: true,
    ordered_prompts: orderedPrompts,
  });

  const parsedJson = parseJsonFromText(rawText, flow.id);
  const parsed = FlowResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `[${flow.id}] response schema invalid: ${parsed.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * 自定义 API 路径：通过 ST 后端代理 /api/backends/chat-completions/generate 转发请求。
 * 直接控制 model / temperature / max_tokens 等参数，不依赖 TavernHelper。
 * 参考 shujuku(神·数据库) 的 callApi_ACU 实现。
 */
async function executeFlowViaStBackend(
  flow: EwFlowConfig,
  apiPreset: EwApiPreset,
  body: Record<string, any>,
  components: PromptComponents,
): Promise<NonNullable<DispatchFlowAttempt['response']>> {
  if (!apiPreset.api_url.trim()) {
    throw new Error(`[${flow.id}] custom api_url is empty`);
  }
  if (!apiPreset.model.trim()) {
    throw new Error(`[${flow.id}] model is empty`);
  }

  const orderedPrompts = await assembleOrderedPrompts(flow.prompt_order, components);
  orderedPrompts.push({ role: 'system', content: LLM_WORKFLOW_SYSTEM_PROMPT });
  orderedPrompts.push({ role: 'user', content: JSON.stringify(body, null, 2) });

  const genOpts = flow.generation_options;
  const requestBody = {
    messages: orderedPrompts,
    model: apiPreset.model.trim().replace(/^models\//, ''),
    max_tokens: genOpts.max_reply_tokens,
    temperature: genOpts.temperature,
    top_p: genOpts.top_p,
    frequency_penalty: genOpts.frequency_penalty,
    presence_penalty: genOpts.presence_penalty,
    stream: false,
    chat_completion_source: 'custom',
    reverse_proxy: apiPreset.api_url.trim(),
    custom_url: apiPreset.api_url.trim(),
    custom_include_headers: apiPreset.api_key.trim()
      ? `Authorization: Bearer ${apiPreset.api_key.trim()}`
      : '',
    custom_prompt_post_processing: 'strict',
  };

  const stHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof SillyTavern !== 'undefined' && SillyTavern.getRequestHeaders) {
    Object.assign(stHeaders, SillyTavern.getRequestHeaders());
    stHeaders['Content-Type'] = 'application/json'; // ensure not overwritten
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), flow.timeout_ms);

  try {
    const response = await fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: stHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errTxt = await response.text();
      throw new Error(`[${flow.id}] ST backend error: ${response.status} ${errTxt}`);
    }

    const data = await response.json();

    // 提取 AI 回复文本 — 兼容 OpenAI 格式和简化格式
    const rawText =
      data?.choices?.[0]?.message?.content?.trim() ??
      data?.content?.trim() ??
      '';

    if (!rawText) {
      throw new Error(`[${flow.id}] API returned empty response: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const parsedJson = parseJsonFromText(rawText, flow.id);
    const parsed = FlowResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(
        `[${flow.id}] response schema invalid: ${parsed.error.issues
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`[${flow.id}] timeout (${flow.timeout_ms}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function executeFlow(
  settings: EwSettings,
  flow: EwFlowConfig,
  flowOrder: number,
  messageId: number,
  requestId: string,
  serialResults: Record<string, any>[],
): Promise<DispatchFlowAttempt> {
  const startedAt = Date.now();
  const apiPreset = resolveApiPreset(settings, flow);
  const usesTavernMain = apiPreset.mode === 'llm_connector';
  const attemptApiUrl = usesTavernMain ? 'tavern://main_api' : apiPreset.api_url;

  // Collect prompt components once — shared by buildFlowRequest (metadata) and assembler (messages)
  const promptComponents = collectPromptComponents(flow);

  const request = await buildFlowRequest({
    settings,
    flow,
    message_id: messageId,
    request_id: requestId,
    serial_results: serialResults,
  });

  try {
    const body = applyTemplate(request as unknown as Record<string, any>, flow.request_template);

    let response: NonNullable<DispatchFlowAttempt['response']>;

    if (usesTavernMain) {
      // 主 API：通过 TavernHelper.generateRaw，使用酒馆当前配置
      response = await executeFlowViaLlmConnector(flow, body, promptComponents);
    } else {
      // 自定义 API：通过 ST 后端代理，完全控制参数
      response = await executeFlowViaStBackend(flow, apiPreset, body, promptComponents);
    }

    return {
      flow,
      flow_order: flowOrder,
      api_preset_id: apiPreset.id,
      api_preset_name: apiPreset.name,
      api_url: attemptApiUrl,
      request,
      response,
      ok: true,
      elapsed_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      flow,
      flow_order: flowOrder,
      api_preset_id: apiPreset.id,
      api_preset_name: apiPreset.name,
      api_url: attemptApiUrl,
      request,
      ok: false,
      error: toErrorMessage(error),
      elapsed_ms: Date.now() - startedAt,
    };
  }
}

export async function dispatchFlows(input: DispatchInput): Promise<DispatchFlowsOutput> {
  const flows = input.flows.filter(flow => flow.enabled);
  if (flows.length === 0) {
    throw new Error('no enabled flows');
  }

  if (input.settings.dispatch_mode === 'serial') {
    const serialResults: Record<string, any>[] = [];
    const attempts: DispatchFlowAttempt[] = [];
    const outputs: DispatchFlowResult[] = [];

    for (const [index, flow] of flows.entries()) {
      const attempt = await executeFlow(
        input.settings,
        flow,
        index,
        input.message_id,
        input.request_id,
        serialResults,
      );
      attempts.push(attempt);

      if (!attempt.ok || !attempt.response) {
        throw new DispatchFlowsError(attempt.error ?? `[${flow.id}] failed`, attempts);
      }

      const output: DispatchFlowResult = {
        flow: attempt.flow,
        flow_order: attempt.flow_order,
        response: attempt.response,
      };
      outputs.push(output);
      serialResults.push({
        flow_id: output.response.flow_id,
        priority: output.response.priority,
        reply_instruction: output.response.reply_instruction,
        operations: output.response.operations,
        diagnostics: output.response.diagnostics,
      });
    }

    return { results: outputs, attempts };
  }

  const attempts = await Promise.all(
    flows.map((flow, index) =>
      executeFlow(input.settings, flow, index, input.message_id, input.request_id, []),
    ),
  );

  const succeeded = attempts.filter(
    (attempt): attempt is DispatchFlowAttempt & { response: NonNullable<DispatchFlowAttempt['response']> } =>
      attempt.ok && Boolean(attempt.response),
  );
  const failed = attempts.filter(attempt => !attempt.ok);

  if (failed.length > 0) {
    // CR-3: allow_partial_success — use whatever succeeded, only throw if nothing worked
    if (input.settings.failure_policy === 'allow_partial_success') {
      if (succeeded.length === 0) {
        throw new DispatchFlowsError(
          failed.map(f => f.error ?? `[${f.flow.id}] failed`).join('; '),
          attempts,
        );
      }
      console.warn(
        `[EW] allow_partial_success: ${failed.length} flow(s) failed, ${succeeded.length} succeeded — using partial results`,
      );
    } else {
      // Default: any failure → throw
      const first = failed[0];
      throw new DispatchFlowsError(first.error ?? `[${first.flow.id}] failed`, attempts);
    }
  }

  return {
    results: succeeded.map(attempt => ({
      flow: attempt.flow,
      flow_order: attempt.flow_order,
      response: attempt.response,
    })),
    attempts,
  };
}
