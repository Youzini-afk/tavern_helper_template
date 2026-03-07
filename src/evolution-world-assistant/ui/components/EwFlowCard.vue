<template>
  <article class="ew-flow-card" :data-enabled="flow.enabled ? '1' : '0'" :data-expanded="expanded ? '1' : '0'">
    <header class="ew-flow-card__header">
      <div class="ew-flow-card__summary">
        <strong class="ew-flow-card__name">{{ flow.name || `工作流 ${index + 1}` }}</strong>
        <div class="ew-flow-card__chips">
          <span class="ew-flow-card__chip">{{ flow.enabled ? '启用' : '停用' }}</span>
          <span class="ew-flow-card__chip">优先级 {{ flow.priority }}</span>
          <span class="ew-flow-card__chip">超时 {{ flow.timeout_ms }}ms</span>
          <span class="ew-flow-card__chip">API {{ presetLabel }}</span>
          <span class="ew-flow-card__chip">提示词 {{ flow.prompt_items.length }}</span>
        </div>
        <p class="ew-flow-card__endpoint">接口: {{ endpointSummary }}</p>
      </div>

      <div class="ew-flow-card__actions">
        <label class="ew-checkbox ew-flow-card__enabled">
          <input :checked="flow.enabled" type="checkbox" @change="setEnabled" />
          <span>启用</span>
        </label>
        <button type="button" class="ew-flow-card__action" @click="$emit('toggle-expand')">
          {{ expanded ? '收起' : '编辑' }}
        </button>
        <button type="button" class="ew-flow-card__action ew-flow-card__action--danger" @click="$emit('remove')">
          删除
        </button>
      </div>
    </header>

    <transition name="ew-expand">
      <div v-if="expanded" class="ew-flow-card__body">
        <section class="ew-flow-card__section">
          <h4>基础信息</h4>
          <div class="ew-grid ew-grid--two">
            <EwFieldRow label="名称" :help="help('flow.name')">
              <input :value="flow.name" type="text" @input="setText('name', $event)" />
            </EwFieldRow>
            <EwFieldRow label="工作流ID" :help="help('flow.id')">
              <input :value="flow.id" type="text" @input="setText('id', $event)" />
            </EwFieldRow>
            <EwFieldRow label="API配置预设" :help="help('flow.api_preset_id')">
              <select :value="flow.api_preset_id" @change="setApiPresetId">
                <option v-if="apiPresets.length === 0" value="">无可用API配置</option>
                <option v-for="preset in apiPresets" :key="preset.id" :value="preset.id">
                  {{ preset.name || preset.id }}
                </option>
              </select>
            </EwFieldRow>
            <EwFieldRow label="优先级" :help="help('flow.priority')">
              <input :value="flow.priority" type="number" min="-9999" max="9999" step="1" @input="setFlowNumber('priority', $event)" />
            </EwFieldRow>
            <EwFieldRow label="超时(ms)" :help="help('flow.timeout_ms')">
              <input :value="flow.timeout_ms" type="number" min="1000" step="500" @input="setFlowNumber('timeout_ms', $event)" />
            </EwFieldRow>
            <EwFieldRow label="上下文楼层数" :help="help('flow.context_turns')">
              <input :value="flow.context_turns" type="number" min="1" step="1" @input="setFlowNumber('context_turns', $event)" />
            </EwFieldRow>
          </div>
        </section>

        <section class="ew-flow-card__section">
          <div class="ew-flow-card__section-head">
            <h4>生成参数</h4>
          </div>

          <div class="ew-grid ew-grid--two">
            <EwFieldRow label="解锁上下文长度">
              <label class="ew-switch ew-switch--field">
                <input :checked="flow.generation_options.unlock_context_length" type="checkbox" @change="setGenerationBool('unlock_context_length', $event)" />
                <span class="ew-switch__slider"></span>
                <span class="ew-switch__label">{{ flow.generation_options.unlock_context_length ? '已启用' : '已关闭' }}</span>
              </label>
            </EwFieldRow>
            <EwFieldRow label="流式传输">
              <label class="ew-switch ew-switch--field">
                <input :checked="flow.generation_options.stream" type="checkbox" @change="setGenerationBool('stream', $event)" />
                <span class="ew-switch__slider"></span>
                <span class="ew-switch__label">{{ flow.generation_options.stream ? '已启用' : '已关闭' }}</span>
              </label>
            </EwFieldRow>
            <EwFieldRow label="上下文长度（词符）">
              <div class="ew-range">
                <input :value="flow.generation_options.max_context_tokens" type="range" min="16000" max="500000" step="1000" :disabled="!flow.generation_options.unlock_context_length" @input="setGenerationNumber('max_context_tokens', $event)" />
                <input :value="flow.generation_options.max_context_tokens" type="number" min="16000" step="1000" :disabled="!flow.generation_options.unlock_context_length" @input="setGenerationNumber('max_context_tokens', $event)" />
              </div>
            </EwFieldRow>
            <EwFieldRow label="最大回复长度（词符）">
              <input :value="flow.generation_options.max_reply_tokens" type="number" min="1" step="32" @input="setGenerationNumber('max_reply_tokens', $event)" />
            </EwFieldRow>
            <EwFieldRow label="备选回复数">
              <input :value="flow.generation_options.n_candidates" type="number" min="1" step="1" @input="setGenerationNumber('n_candidates', $event)" />
            </EwFieldRow>
            <EwFieldRow label="温度">
              <div class="ew-range">
                <input :value="flow.generation_options.temperature" type="range" min="0" max="2" step="0.01" @input="setGenerationNumber('temperature', $event)" />
                <input :value="flow.generation_options.temperature" type="number" min="0" max="2" step="0.01" @input="setGenerationNumber('temperature', $event)" />
              </div>
            </EwFieldRow>
            <EwFieldRow label="频率惩罚">
              <div class="ew-range">
                <input :value="flow.generation_options.frequency_penalty" type="range" min="0" max="2" step="0.01" @input="setGenerationNumber('frequency_penalty', $event)" />
                <input :value="flow.generation_options.frequency_penalty" type="number" min="0" max="2" step="0.01" @input="setGenerationNumber('frequency_penalty', $event)" />
              </div>
            </EwFieldRow>
            <EwFieldRow label="存在惩罚">
              <div class="ew-range">
                <input :value="flow.generation_options.presence_penalty" type="range" min="0" max="2" step="0.01" @input="setGenerationNumber('presence_penalty', $event)" />
                <input :value="flow.generation_options.presence_penalty" type="number" min="0" max="2" step="0.01" @input="setGenerationNumber('presence_penalty', $event)" />
              </div>
            </EwFieldRow>
            <EwFieldRow label="Top P">
              <div class="ew-range">
                <input :value="flow.generation_options.top_p" type="range" min="0" max="1" step="0.01" @input="setGenerationNumber('top_p', $event)" />
                <input :value="flow.generation_options.top_p" type="number" min="0" max="1" step="0.01" @input="setGenerationNumber('top_p', $event)" />
              </div>
            </EwFieldRow>
          </div>
        </section>
        <section class="ew-flow-card__section">
          <div class="ew-flow-card__section-head">
            <h4>行为参数</h4>
          </div>

          <!-- Selects row -->
          <div class="ew-grid ew-grid--two">
            <EwFieldRow label="角色名称行为">
              <select :value="flow.behavior_options.name_behavior" @change="setBehaviorSelectByEvent('name_behavior', $event)">
                <option value="none">无</option>
                <option value="default">默认</option>
                <option value="complete_target">补全对象</option>
                <option value="message_content">消息内容</option>
              </select>
            </EwFieldRow>
            <EwFieldRow label="推理强度">
              <select :value="flow.behavior_options.reasoning_effort" @change="setBehaviorSelectByEvent('reasoning_effort', $event)">
                <option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
              </select>
            </EwFieldRow>
            <EwFieldRow label="详细程度">
              <select :value="flow.behavior_options.verbosity" @change="setBehaviorSelectByEvent('verbosity', $event)">
                <option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
              </select>
            </EwFieldRow>
          </div>

          <!-- Toggle switches grid -->
          <div class="ew-toggle-grid">
            <div class="ew-toggle-item">
              <button type="button" class="ew-switch" role="switch"
                :aria-checked="flow.behavior_options.continue_prefill ? 'true' : 'false'"
                @click="setBehaviorToggle('continue_prefill')">
                <span class="ew-switch__track" :data-enabled="flow.behavior_options.continue_prefill ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
              </button>
              <span class="ew-toggle-item__label">继续预填充</span>
            </div>
            <div class="ew-toggle-item">
              <button type="button" class="ew-switch" role="switch"
                :aria-checked="flow.behavior_options.squash_system_messages ? 'true' : 'false'"
                @click="setBehaviorToggle('squash_system_messages')">
                <span class="ew-switch__track" :data-enabled="flow.behavior_options.squash_system_messages ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
              </button>
              <span class="ew-toggle-item__label">压缩系统消息</span>
            </div>
            <div class="ew-toggle-item">
              <button type="button" class="ew-switch" role="switch"
                :aria-checked="flow.behavior_options.enable_function_calling ? 'true' : 'false'"
                @click="setBehaviorToggle('enable_function_calling')">
                <span class="ew-switch__track" :data-enabled="flow.behavior_options.enable_function_calling ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
              </button>
              <span class="ew-toggle-item__label">启用函数调用</span>
            </div>
            <div class="ew-toggle-item">
              <button type="button" class="ew-switch" role="switch"
                :aria-checked="flow.behavior_options.send_inline_media ? 'true' : 'false'"
                @click="setBehaviorToggle('send_inline_media')">
                <span class="ew-switch__track" :data-enabled="flow.behavior_options.send_inline_media ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
              </button>
              <span class="ew-toggle-item__label">发送内联媒体</span>
            </div>
            <div class="ew-toggle-item">
              <button type="button" class="ew-switch" role="switch"
                :aria-checked="flow.behavior_options.request_thinking ? 'true' : 'false'"
                @click="setBehaviorToggle('request_thinking')">
                <span class="ew-switch__track" :data-enabled="flow.behavior_options.request_thinking ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
              </button>
              <span class="ew-toggle-item__label">请求思维链</span>
            </div>
          </div>
        </section>

        <section class="ew-flow-card__section">
          <h4>上下文规则</h4>
          <p class="ew-flow-card__desc">在聊天消息发送给工作流 AI 之前，依次进行：正则处理 → 文本切片。</p>

          <div class="ew-flow-card__subsection">
            <h5>正则处理</h5>
            <div class="ew-toggle-item">
              <button type="button" class="ew-switch" role="switch"
                :aria-checked="flow.use_tavern_regex ? 'true' : 'false'"
                @click="patch({ use_tavern_regex: !flow.use_tavern_regex })">
                <span class="ew-switch__track" :data-enabled="flow.use_tavern_regex ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
              </button>
              <span class="ew-toggle-item__label">使用酒馆已启用的正则</span>
            </div>
            <p class="ew-flow-card__hint-text">开启后，聊天消息会先经过酒馆当前激活的正则脚本处理（全局 + 角色卡正则）。</p>

            <div class="ew-flow-card__custom-regex-head">
              <h6>自定义正则</h6>
              <button type="button" class="ew-mini-btn" @click="addCustomRegex">新增</button>
            </div>
            <div v-if="flow.custom_regex_rules.length === 0" class="ew-empty">暂无自定义正则。</div>
          <transition-group v-else name="ew-list" tag="div" class="ew-regex-list">
            <article
              v-for="(rule, ruleIndex) in flow.custom_regex_rules"
              :key="rule.id"
              class="ew-regex-item"
            >
              <header class="ew-regex-item__head">
                <label class="ew-checkbox"><input :checked="rule.enabled" type="checkbox" @change="setRegexEnabled(ruleIndex, $event)" /></label>
                <span class="ew-regex-item__name" :title="rule.name">{{ rule.name || `规则 ${ruleIndex + 1}` }}</span>
                <button type="button" class="ew-mini-btn ew-mini-btn--danger" @click="removeCustomRegex(ruleIndex)">删除</button>
              </header>
              <div class="ew-regex-item__body">
                <EwFieldRow label="名称"><input :value="rule.name" type="text" placeholder="起个名字..." @input="patchRegexText(ruleIndex, 'name', $event)" /></EwFieldRow>
                <EwFieldRow label="正则表达式"><input :value="rule.find_regex" type="text" placeholder="/pattern/gi" @input="patchRegexText(ruleIndex, 'find_regex', $event)" /></EwFieldRow>
                <EwFieldRow label="替换文本"><input :value="rule.replace_string" type="text" placeholder="留空则删除" @input="patchRegexText(ruleIndex, 'replace_string', $event)" /></EwFieldRow>
              </div>
            </article>
          </transition-group>
          </div>

          <div class="ew-flow-card__subsection">
            <h5>文本切片</h5>
            <div class="ew-grid ew-grid--two">
              <section>
                <div class="ew-subhead"><h6>提取规则</h6></div>
                <p class="ew-flow-card__hint-text">只保留 start～end 之间的文本发给 AI（如：只提取正文）。</p>
                <EwRulesEditor title="提取规则" :model-value="flow.extract_rules" @update:model-value="value => patch({ extract_rules: value })" />
              </section>
              <section>
                <div class="ew-subhead"><h6>排除规则</h6></div>
                <p class="ew-flow-card__hint-text">删掉 start～end 之间的文本（如：去掉思考标记）。</p>
                <EwRulesEditor title="排除规则" :model-value="flow.exclude_rules" @update:model-value="value => patch({ exclude_rules: value })" />
              </section>
            </div>
          </div>
        </section>

        <section class="ew-flow-card__section">
          <div class="ew-flow-card__section-head">
            <h4>提示词编排</h4>
          </div>
          <EwPromptOrderList
            :prompt-order="flow.prompt_order"
            @update:prompt-order="updatePromptOrder"
          />
        </section>


        <EwFieldRow label="请求模板(JSON merge)" :help="help('flow.request_template')">
          <textarea :value="flow.request_template" rows="4" :placeholder="help('flow.request_template')?.placeholder" @input="setText('request_template', $event)" />
        </EwFieldRow>
      </div>
    </transition>
  </article>
</template>

<script setup lang="ts">
import type { EwApiPreset, EwFlowConfig, EwPromptOrderEntry } from '../../runtime/types';
import { simpleHash } from '../../runtime/helpers';
import { getFieldHelp } from '../help-meta';
import EwFieldRow from './EwFieldRow.vue';

import EwRulesEditor from './EwRulesEditor.vue';
import EwPromptOrderList from './EwPromptOrderList.vue';

type FlowNumberKey = 'priority' | 'timeout_ms' | 'context_turns';
type GenerationNumberKey = 'max_context_tokens' | 'max_reply_tokens' | 'n_candidates' | 'temperature' | 'frequency_penalty' | 'presence_penalty' | 'top_p';
type GenerationBoolKey = 'unlock_context_length' | 'stream';
type BehaviorBoolKey = 'continue_prefill' | 'squash_system_messages' | 'enable_function_calling' | 'send_inline_media' | 'request_thinking';
type BehaviorSelectKey = 'name_behavior' | 'reasoning_effort' | 'verbosity';


const props = defineProps<{ modelValue: EwFlowConfig; apiPresets: EwApiPreset[]; index: number; expanded: boolean }>();
const emit = defineEmits<{ (event: 'toggle-expand'): void; (event: 'remove'): void; (event: 'update:modelValue', value: EwFlowConfig): void }>();

const flow = computed(() => props.modelValue);

const selectedPreset = computed(() => props.apiPresets.find(preset => preset.id === flow.value.api_preset_id) ?? null);
const endpointSummary = computed(() => {
  const preset = selectedPreset.value;
  if (!preset) {
    return '未绑定API配置';
  }
  if (preset.mode === 'llm_connector') {
    return '酒馆主API（自动使用当前配置）';
  }
  const endpoint = preset.api_url.trim();
  const model = preset.model.trim() || '未选模型';
  if (!endpoint && !model) {
    return '未配置';
  }
  if (!endpoint) {
    return `URL未配置 / ${model}`;
  }
  const merged = `${endpoint} / ${model}`;
  return merged.length <= 72 ? merged : `${merged.slice(0, 69)}...`;
});
const presetLabel = computed(() => selectedPreset.value?.name?.trim() || '未绑定');

function help(key: string) { return getFieldHelp(key); }
function patch(partial: Partial<EwFlowConfig>) { emit('update:modelValue', { ...flow.value, ...partial }); }
function patchGeneration(partial: Partial<EwFlowConfig['generation_options']>) { patch({ generation_options: { ...flow.value.generation_options, ...partial } }); }
function patchBehavior(partial: Partial<EwFlowConfig['behavior_options']>) { patch({ behavior_options: { ...flow.value.behavior_options, ...partial } }); }
function updatePromptOrder(order: EwPromptOrderEntry[]) { patch({ prompt_order: order }); }
function toNumber(raw: string, fallback: number) { const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function setEnabled(event: Event) { patch({ enabled: (event.target as HTMLInputElement).checked }); }
function setText(key: 'name' | 'id' | 'request_template', event: Event) { patch({ [key]: (event.target as HTMLInputElement | HTMLTextAreaElement).value } as Partial<EwFlowConfig>); }
function setFlowNumber(key: FlowNumberKey, event: Event) { patch({ [key]: Math.trunc(toNumber((event.target as HTMLInputElement).value, flow.value[key] as number)) } as Partial<EwFlowConfig>); }
function setApiPresetId(event: Event) { patch({ api_preset_id: (event.target as HTMLSelectElement).value }); }
function setGenerationNumber(key: GenerationNumberKey, event: Event) {
  const raw = toNumber((event.target as HTMLInputElement).value, flow.value.generation_options[key]);
  if (key === 'max_context_tokens') return patchGeneration({ max_context_tokens: Math.max(16000, Math.trunc(raw)) });
  if (key === 'max_reply_tokens') return patchGeneration({ max_reply_tokens: Math.max(1, Math.trunc(raw)) });
  if (key === 'n_candidates') return patchGeneration({ n_candidates: Math.max(1, Math.trunc(raw)) });
  if (key === 'temperature') return patchGeneration({ temperature: Number(clamp(raw, 0, 2).toFixed(4)) });
  if (key === 'frequency_penalty') return patchGeneration({ frequency_penalty: Number(clamp(raw, 0, 2).toFixed(4)) });
  if (key === 'presence_penalty') return patchGeneration({ presence_penalty: Number(clamp(raw, 0, 2).toFixed(4)) });
  return patchGeneration({ top_p: Number(clamp(raw, 0, 1).toFixed(4)) });
}
function setGenerationBool(key: GenerationBoolKey, event: Event) { patchGeneration({ [key]: (event.target as HTMLInputElement).checked } as Partial<EwFlowConfig['generation_options']>); }
function setBehaviorToggle(key: BehaviorBoolKey) {
  patchBehavior({ [key]: !flow.value.behavior_options[key] } as Partial<EwFlowConfig['behavior_options']>);
}
function setBehaviorSelectByEvent(key: BehaviorSelectKey, event: Event) {
  patchBehavior({ [key]: (event.target as HTMLSelectElement).value as EwFlowConfig['behavior_options'][typeof key] } as Partial<EwFlowConfig['behavior_options']>);
}

function addCustomRegex() {
  const nextRules = [...flow.value.custom_regex_rules, {
    id: `regex_${simpleHash(`${flow.value.id}-${flow.value.custom_regex_rules.length}-${Date.now()}`)}`,
    name: '',
    enabled: true,
    find_regex: '',
    replace_string: '',
  }];
  patch({ custom_regex_rules: nextRules });
}
function removeCustomRegex(index: number) {
  patch({ custom_regex_rules: flow.value.custom_regex_rules.filter((_, i) => i !== index) });
}
function setRegexEnabled(index: number, event: Event) {
  const nextRules = flow.value.custom_regex_rules.map((rule, i) =>
    i === index ? { ...rule, enabled: (event.target as HTMLInputElement).checked } : rule,
  );
  patch({ custom_regex_rules: nextRules });
}
function patchRegexText(index: number, key: 'name' | 'find_regex' | 'replace_string', event: Event) {
  const nextRules = flow.value.custom_regex_rules.map((rule, i) =>
    i === index ? { ...rule, [key]: (event.target as HTMLInputElement).value } : rule,
  );
  patch({ custom_regex_rules: nextRules });
}
</script>

<style scoped>
.ew-flow-card {
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 20%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 5%, rgba(10, 14, 20, 0.4));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  overflow: visible;
  transition: box-shadow 0.3s ease, border-color 0.3s ease, transform 0.3s ease;
}

.ew-flow-card:focus-within,
.ew-flow-card:hover {
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 35%, transparent);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transform: translateY(-2px);
}

.ew-flow-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  border-radius: 12px 12px 0 0;
  border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 10%, transparent);
}

.ew-flow-card__summary {
  min-width: 0;
  flex: 1 1 200px; /* Allow summary to shrink and wrap */
}

.ew-flow-card__name {
  display: block;
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.25;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 98%, transparent);
  letter-spacing: 0.01em;
}

.ew-flow-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.ew-flow-card__chip {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 45%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 15%, transparent);
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 85%, transparent);
  font-size: 0.72rem;
  font-weight: 500;
  padding: 0.15rem 0.6rem;
}

.ew-flow-card__endpoint {
  margin: 0.5rem 0 0;
  font-size: 0.76rem;
  line-height: 1.35;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 65%, transparent);
  word-break: break-all;
}

.ew-flow-card__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex-shrink: 0; /* Prevent action buttons from being compressed */
}

.ew-flow-card__enabled {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 40%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 15%, transparent);
  padding: 0.25rem 0.65rem;
}

.ew-flow-card__action {
  border-radius: 0.7rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 45%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 20%, transparent);
  color: var(--SmartThemeBodyColor, #edf2f9);
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ew-flow-card__action:hover,
.ew-flow-card__action:focus-visible {
  border-color: var(--ew-accent);
  background: color-mix(in srgb, var(--ew-accent) 25%, transparent);
  color: #fff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--ew-accent-glow);
  outline: none;
}

.ew-flow-card__action--danger {
  border-color: color-mix(in srgb, var(--ew-danger) 45%, transparent);
  background: color-mix(in srgb, var(--ew-danger) 15%, transparent);
  color: color-mix(in srgb, var(--ew-danger) 90%, #fff);
}

.ew-flow-card__action--danger:hover,
.ew-flow-card__action--danger:focus-visible {
  background: color-mix(in srgb, var(--ew-danger) 80%, transparent);
  border-color: var(--ew-danger);
  color: #fff;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ew-danger) 30%, transparent);
}

.ew-flow-card__body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0 1.1rem 1.1rem;
  margin-top: 1rem;
}

.ew-flow-card__section {
  padding: 0.5rem 0 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 8%, transparent);
}

.ew-flow-card__section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.ew-flow-card__section h4 {
  margin: 0 0 0.8rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 65%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ew-flow-card__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.65rem;
}

.ew-flow-card__desc {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 70%, transparent);
}

.ew-flow-card__hint-text {
  margin: 0.3rem 0 0.5rem;
  font-size: 0.76rem;
  line-height: 1.4;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 65%, transparent);
}

.ew-flow-card__subsection {
  border-radius: 0.8rem;
  border: 1px dashed color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 30%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 5%, rgba(0, 0, 0, 0.05));
  padding: 0.65rem 0.75rem;
  margin-bottom: 0.65rem;
}

.ew-flow-card__subsection h5 {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 90%, transparent);
}

.ew-flow-card__custom-regex-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0.6rem 0 0.4rem; /* Reduced top margin and added bottom space */
}

.ew-flow-card__custom-regex-head h6 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 85%, transparent);
}

.ew-regex-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
}

.ew-regex-item {
  border-radius: 0.8rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 30%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 8%, rgba(0, 0, 0, 0.15));
  padding: 0.6rem 0.7rem;
}

.ew-regex-item__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.ew-regex-item__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 95%, transparent);
}

.ew-regex-item__body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.ew-grid {
  display: grid;
  gap: 0.75rem;
}

.ew-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* Toggle grid for behavior switches */
.ew-toggle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.65rem;
  margin-top: 0.85rem;
  padding: 0.75rem 0.85rem;
  border-radius: 0.85rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 20%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 5%, rgba(0, 0, 0, 0.08));
}

.ew-toggle-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ew-toggle-item__label {
  font-size: 0.82rem;
  font-weight: 500;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 88%, transparent);
  white-space: nowrap;
}

/* Switch toggle — duplicated from App.vue because scoped CSS can't pierce child components */
.ew-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
}

.ew-switch__track {
  width: 2.8rem;
  height: 1.6rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 58%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 18%, rgba(7, 10, 15, 0.4));
  box-shadow:
    inset 0 1px 4px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.06);
  display: inline-flex;
  align-items: center;
  padding: 0.15rem;
  transition:
    border-color 0.3s ease,
    background 0.3s ease,
    box-shadow 0.3s ease;
}

.ew-switch__track[data-enabled='1'] {
  border-color: color-mix(in srgb, var(--ew-success) 65%, transparent);
  background: color-mix(in srgb, var(--ew-success) 45%, rgba(7, 10, 15, 0.4));
  box-shadow:
    inset 0 1px 4px rgba(0, 0, 0, 0.2),
    0 0 10px color-mix(in srgb, var(--ew-success) 25%, transparent);
}

.ew-switch__thumb {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--SmartThemeBodyColor, #eef3f9) 90%, transparent);
  box-shadow:
    0 2px 5px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(0, 0, 0, 0.1);
  transform: translateX(0);
  transition:
    transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
    background 0.3s ease;
}

.ew-switch__track[data-enabled='1'] .ew-switch__thumb {
  transform: translateX(1.15rem);
  background: #ffffff;
}

.ew-switch:hover .ew-switch__track,
.ew-switch:focus-visible .ew-switch__track {
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 85%, transparent);
}

.ew-switch:focus-visible {
  outline: none;
}

/* ── Field-level slide toggle (slider variant) ── */
.ew-switch--field {
  gap: 0.6rem;
}
.ew-switch--field input { display: none; }
.ew-switch__slider {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}
.ew-switch__slider::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #888;
  top: 2px;
  left: 2px;
  transition: transform 0.2s, background 0.2s;
}
.ew-switch--field input:checked + .ew-switch__slider {
  background: var(--ew-accent, #8b5cf6);
}
.ew-switch--field input:checked + .ew-switch__slider::after {
  transform: translateX(16px);
  background: #fff;
}
.ew-switch__label {
  font-size: 0.82rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 80%, transparent);
  user-select: none;
}

.ew-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 90%, transparent);
}

.ew-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.ew-radio {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 40%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 15%, transparent);
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
}

.ew-range {
  display: grid;
  grid-template-columns: 1fr 6.4rem;
  align-items: center;
  gap: 0.6rem;
}

.ew-check-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.2rem 0;
}

.ew-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.ew-subhead h5 {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 95%, transparent);
}

.ew-subhead h6 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 90%, transparent);
}

.ew-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.ew-empty {
  border-radius: 0.8rem;
  border: 1px dashed color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 45%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 10%, rgba(8, 12, 18, 0.2));
  padding: 0.65rem 0.75rem;
  font-size: 0.82rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 80%, transparent);
}

.ew-prompt-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  position: relative;
}

.ew-prompt-item {
  border-radius: 0.85rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 35%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 8%, rgba(0, 0, 0, 0.18));
  padding: 0.6rem;
}

.ew-prompt-item__head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto auto;
  align-items: center;
  gap: 0.5rem;
}

.ew-prompt-item__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 98%, transparent);
}

.ew-prompt-item__body {
  margin-top: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.ew-mini-btn {
  border-radius: 0.6rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 45%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 15%, transparent);
  color: var(--SmartThemeBodyColor, #edf2f9);
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ew-mini-btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.ew-mini-btn:hover:not([disabled]) {
  border-color: var(--ew-accent);
  background: color-mix(in srgb, var(--ew-accent) 25%, transparent);
  color: #fff;
  transform: translateY(-1px);
}

.ew-mini-btn--danger {
  border-color: color-mix(in srgb, var(--ew-danger) 45%, transparent);
  background: color-mix(in srgb, var(--ew-danger) 15%, transparent);
}

.ew-mini-btn--danger:hover:not([disabled]) {
  background: color-mix(in srgb, var(--ew-danger) 80%, transparent);
  border-color: var(--ew-danger);
  color: #fff;
}

.ew-expand-enter-active,
.ew-expand-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: top center;
}

.ew-expand-enter-from,
.ew-expand-leave-to {
  opacity: 0;
  transform: translateY(-8px) scaleY(0.98);
}

@supports not ((backdrop-filter: blur(1px))) {
  .ew-flow-card__header {
    background: color-mix(in srgb, var(--SmartThemeQuoteColor, #2f4158) 18%, rgba(10, 14, 20, 0.98));
  }
}

@media (max-width: 1200px) {
  .ew-prompt-item__head {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .ew-prompt-item__controls {
    grid-column: 1 / -1;
    margin-top: 0.5rem;
  }
}

@media (max-width: 900px) {
  .ew-flow-card {
    transition: box-shadow 0.3s ease, border-color 0.3s ease,
                margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                border-radius 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .ew-flow-card__header {
    flex-direction: column;
  }
  .ew-flow-card__actions {
    width: 100%;
    justify-content: flex-start;
  }
  /* 展开时左右撑满 — 跳出父容器 0.9rem padding */
  .ew-flow-card[data-expanded='1'] {
    margin-left: -0.9rem;
    margin-right: -0.9rem;
    width: calc(100% + 1.8rem);
    border-radius: 4px;
    border-left: none;
    border-right: none;
  }
  .ew-flow-card[data-expanded='1']:hover,
  .ew-flow-card[data-expanded='1']:focus-within {
    transform: none;
  }
  .ew-grid--two {
    grid-template-columns: 1fr;
  }
  .ew-range {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ew-flow-card,
  .ew-flow-card__action,
  .ew-mini-btn,
  .ew-expand-enter-active,
  .ew-expand-leave-active {
    transition: none;
  }
}
</style>
