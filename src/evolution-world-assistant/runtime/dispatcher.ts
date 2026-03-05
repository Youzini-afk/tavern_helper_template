import { buildFlowRequest } from './context-builder';
import { FlowResponseSchema } from './contracts';
import { parseJsonObject } from './helpers';
import { DispatchFlowAttempt, DispatchFlowResult, EwApiPreset, EwFlowConfig, EwSettings } from './types';

type DispatchInput = {
  settings: EwSettings;
  flows: EwFlowConfig[];
  message_id: number;
  user_input: string;
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

async function executeFlowViaLlmConnector(
  flow: EwFlowConfig,
  apiPreset: EwApiPreset,
  body: Record<string, any>,
): Promise<NonNullable<DispatchFlowAttempt['response']>> {
  if (typeof generateRaw !== 'function') {
    throw new Error(`[${flow.id}] generateRaw is unavailable`);
  }

  const prompts = [
    { role: 'system' as const, content: LLM_WORKFLOW_SYSTEM_PROMPT },
    { role: 'user' as const, content: JSON.stringify(body, null, 2) },
  ];

  const generateConfig: Parameters<typeof generateRaw>[0] = {
    should_stream: false,
    should_silence: true,
    ordered_prompts: prompts,
  };

  if (!apiPreset.use_main_api) {
    if (!apiPreset.api_url.trim()) {
      throw new Error(`[${flow.id}] custom api_url is empty`);
    }
    if (!apiPreset.model.trim()) {
      throw new Error(`[${flow.id}] model is empty`);
    }
    generateConfig.custom_api = {
      apiurl: apiPreset.api_url.trim(),
      key: apiPreset.api_key.trim() || undefined,
      model: apiPreset.model.trim(),
      source: apiPreset.api_source.trim() || 'openai',
    };
  }

  const rawText = await generateRaw(generateConfig);
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

async function executeFlow(
  settings: EwSettings,
  flow: EwFlowConfig,
  flowOrder: number,
  messageId: number,
  userInput: string,
  requestId: string,
  serialResults: Record<string, any>[],
): Promise<DispatchFlowAttempt> {
  const startedAt = Date.now();
  const apiPreset = resolveApiPreset(settings, flow);
  const usesTavernMain = apiPreset.mode === 'llm_connector';
  const usesCustomConnector = apiPreset.mode === 'workflow_http' && Boolean(apiPreset.model.trim());
  const usesLegacyWorkflowHttp =
    apiPreset.mode === 'workflow_http' && !apiPreset.model.trim() && Boolean(apiPreset.headers_json.trim());
  const attemptApiUrl = usesTavernMain ? 'tavern://main_api' : apiPreset.api_url;
  const request = await buildFlowRequest({
    settings,
    flow,
    message_id: messageId,
    user_input: userInput,
    request_id: requestId,
    serial_results: serialResults,
  });

  try {
    const body = applyTemplate(request as unknown as Record<string, any>, flow.request_template);

    if (usesTavernMain) {
      const response = await executeFlowViaLlmConnector(
        flow,
        {
          ...apiPreset,
          use_main_api: true,
        },
        body,
      );
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
    }

    if (usesCustomConnector) {
      const response = await executeFlowViaLlmConnector(
        flow,
        {
          ...apiPreset,
          use_main_api: false,
        },
        body,
      );
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
    }

    if (apiPreset.mode === 'workflow_http' && !usesLegacyWorkflowHttp) {
      throw new Error(`[${flow.id}] model is empty (自定义API模式必须选择模型)`);
    }

    if (!apiPreset.api_url.trim()) {
      throw new Error(`[${flow.id}] api_url is empty`);
    }

    const headers = {
      'Content-Type': 'application/json',
      ...parseJsonObject(apiPreset.headers_json),
    };

    if (apiPreset.api_key.trim()) {
      headers.Authorization = `Bearer ${apiPreset.api_key.trim()}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), flow.timeout_ms);

    try {
      const response = await fetch(apiPreset.api_url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`[${flow.id}] HTTP ${response.status}`);
      }

      const json = await response.json();
      const parsed = FlowResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          `[${flow.id}] response schema invalid: ${parsed.error.issues
            .map(issue => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      }

      return {
        flow,
        flow_order: flowOrder,
        api_preset_id: apiPreset.id,
        api_preset_name: apiPreset.name,
        api_url: attemptApiUrl,
        request,
        response: parsed.data,
        ok: true,
        elapsed_ms: Date.now() - startedAt,
      };
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      if (aborted) {
        throw new Error(`[${flow.id}] timeout (${flow.timeout_ms}ms)`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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
        input.user_input,
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
      executeFlow(input.settings, flow, index, input.message_id, input.user_input, input.request_id, []),
    ),
  );

  const failed = attempts.find(attempt => !attempt.ok);
  if (failed) {
    throw new DispatchFlowsError(failed.error ?? `[${failed.flow.id}] failed`, attempts);
  }

  return {
    results: attempts
      .filter((attempt): attempt is DispatchFlowAttempt & { response: NonNullable<DispatchFlowAttempt['response']> } => {
        return attempt.ok && Boolean(attempt.response);
      })
      .map(attempt => ({
        flow: attempt.flow,
        flow_order: attempt.flow_order,
        response: attempt.response,
      })),
    attempts,
  };
}
