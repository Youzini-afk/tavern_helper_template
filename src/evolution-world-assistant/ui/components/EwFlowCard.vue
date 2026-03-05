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
              <label class="ew-checkbox">
                <input :checked="flow.generation_options.unlock_context_length" type="checkbox" @change="setGenerationBool('unlock_context_length', $event)" />
                <span>启用</span>
              </label>
            </EwFieldRow>
            <EwFieldRow label="流式传输">
              <label class="ew-checkbox">
                <input :checked="flow.generation_options.stream" type="checkbox" @change="setGenerationBool('stream', $event)" />
                <span>{{ flow.generation_options.stream ? '已启用' : '已关闭' }}</span>
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

          <div class="ew-grid ew-grid--two">
            <EwFieldRow label="角色名称行为">
              <div class="ew-radio-group">
                <label class="ew-radio"><input :name="nameBehaviorGroupName" :checked="flow.behavior_options.name_behavior === 'none'" type="radio" @change="setBehaviorSelect('name_behavior', 'none')" /><span>无</span></label>
                <label class="ew-radio"><input :name="nameBehaviorGroupName" :checked="flow.behavior_options.name_behavior === 'default'" type="radio" @change="setBehaviorSelect('name_behavior', 'default')" /><span>默认</span></label>
                <label class="ew-radio"><input :name="nameBehaviorGroupName" :checked="flow.behavior_options.name_behavior === 'complete_target'" type="radio" @change="setBehaviorSelect('name_behavior', 'complete_target')" /><span>补全对象</span></label>
                <label class="ew-radio"><input :name="nameBehaviorGroupName" :checked="flow.behavior_options.name_behavior === 'message_content'" type="radio" @change="setBehaviorSelect('name_behavior', 'message_content')" /><span>消息内容</span></label>
              </div>
            </EwFieldRow>
            <EwFieldRow label="推理强度">
              <select :value="flow.behavior_options.reasoning_effort" @change="setBehaviorSelectByEvent('reasoning_effort', $event)">
                <option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
              </select>
            </EwFieldRow>
            <EwFieldRow label="Verbosity">
              <select :value="flow.behavior_options.verbosity" @change="setBehaviorSelectByEvent('verbosity', $event)">
                <option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
            </EwFieldRow>
            <div class="ew-check-list">
              <label class="ew-checkbox"><input :checked="flow.behavior_options.continue_prefill" type="checkbox" @change="setBehaviorBool('continue_prefill', $event)" /><span>继续预填充</span></label>
              <label class="ew-checkbox"><input :checked="flow.behavior_options.squash_system_messages" type="checkbox" @change="setBehaviorBool('squash_system_messages', $event)" /><span>压缩系统消息</span></label>
              <label class="ew-checkbox"><input :checked="flow.behavior_options.enable_function_calling" type="checkbox" @change="setBehaviorBool('enable_function_calling', $event)" /><span>启用函数调用</span></label>
              <label class="ew-checkbox"><input :checked="flow.behavior_options.send_inline_media" type="checkbox" @change="setBehaviorBool('send_inline_media', $event)" /><span>Send inline media</span></label>
              <label class="ew-checkbox"><input :checked="flow.behavior_options.request_thinking" type="checkbox" @change="setBehaviorBool('request_thinking', $event)" /><span>请求思维链</span></label>
            </div>
          </div>
        </section>

        <section class="ew-flow-card__section">
          <h4>上下文规则</h4>
          <p class="ew-flow-card__desc">在聊天消息发送给工作流 AI 之前，依次进行：正则处理 → 文本切片。</p>

          <div class="ew-flow-card__subsection">
            <h5>正则处理</h5>
            <label class="ew-checkbox">
              <input :checked="flow.use_tavern_regex" type="checkbox" @change="setFlowBool('use_tavern_regex', $event)" />
              <span>使用酒馆已启用的正则</span>
            </label>
            <p class="ew-flow-card__hint-text">开启后，聊天消息会先经过酒馆当前激活的正则脚本处理（全局 + 角色卡正则）。</p>

            <div class="ew-flow-card__custom-regex-head">
              <h6>自定义正则</h6>
              <button type="button" class="ew-mini-btn" @click="addCustomRegex">新增</button>
            </div>
            <div v-if="flow.custom_regex_rules.length === 0" class="ew-empty">暂无自定义正则。</div>
            <div v-else class="ew-regex-list">
              <article v-for="(rule, ruleIndex) in flow.custom_regex_rules" :key="rule.id" class="ew-regex-item">
                <header class="ew-regex-item__head">
                  <label class="ew-checkbox"><input :checked="rule.enabled" type="checkbox" @change="setRegexEnabled(ruleIndex, $event)" /></label>
                  <span class="ew-regex-item__name">{{ rule.name || `正则 ${ruleIndex + 1}` }}</span>
                  <button type="button" class="ew-mini-btn ew-mini-btn--danger" @click="removeCustomRegex(ruleIndex)">删除</button>
                </header>
                <div class="ew-regex-item__body">
                  <EwFieldRow label="名称"><input :value="rule.name" type="text" placeholder="例：去掉OOC标记" @input="patchRegexText(ruleIndex, 'name', $event)" /></EwFieldRow>
                  <EwFieldRow label="正则表达式"><input :value="rule.find_regex" type="text" placeholder="例：\[OOC\].*?\[\/OOC\]" @input="patchRegexText(ruleIndex, 'find_regex', $event)" /></EwFieldRow>
                  <EwFieldRow label="替换为"><input :value="rule.replace_string" type="text" placeholder="留空则删除匹配内容" @input="patchRegexText(ruleIndex, 'replace_string', $event)" /></EwFieldRow>
                </div>
              </article>
            </div>
          </div>

          <div class="ew-flow-card__subsection">
            <h5>文本切片</h5>
            <div class="ew-grid ew-grid--two">
              <section>
                <div class="ew-subhead"><h6>提取规则</h6></div>
                <p class="ew-flow-card__hint-text">只保留 start～end 之间的文本发给 AI（如：只提取状态栏）。</p>
                <EwRulesEditor title="提取规则" :model-value="flow.extract_rules" @update:model-value="value => patch({ extract_rules: value })" />
              </section>
              <section>
                <div class="ew-subhead"><h6>排除规则</h6></div>
                <p class="ew-flow-card__hint-text">删掉 start～end 之间的文本（如：去掉 OOC 标记）。</p>
                <EwRulesEditor title="排除规则" :model-value="flow.exclude_rules" @update:model-value="value => patch({ exclude_rules: value })" />
              </section>
            </div>
          </div>
        </section>

        <section class="ew-flow-card__section">
          <div class="ew-flow-card__section-head">
            <h4>提示词配置</h4>
            <div class="ew-inline">
              <EwHelpTip v-if="help('flow.prompt_items')" :meta="help('flow.prompt_items')!" />
              <button type="button" class="ew-flow-card__action" @click="addPromptItem">新增提示词</button>
            </div>
          </div>

          <div v-if="flow.prompt_items.length === 0" class="ew-empty">暂无提示词，点击“新增提示词”开始配置。</div>
          <div v-else class="ew-prompt-list">
            <article v-for="(item, itemIndex) in flow.prompt_items" :key="item.id" class="ew-prompt-item">
              <header class="ew-prompt-item__head">
                <label class="ew-checkbox"><input :checked="item.enabled" type="checkbox" @change="setPromptEnabled(item.id, $event)" /></label>
                <strong class="ew-prompt-item__name">{{ item.name || `提示词 ${itemIndex + 1}` }}</strong>
                <span class="ew-flow-card__chip">{{ item.role }}</span>
                <span class="ew-flow-card__chip">{{ item.position === 'relative' ? '相对' : '聊天中' }}</span>
                <span class="ew-flow-card__chip">{{ promptTriggerSummary(item) }}</span>
                <div class="ew-inline">
                  <button type="button" class="ew-mini-btn" :disabled="itemIndex === 0" @click="movePromptItem(item.id, -1)">上移</button>
                  <button type="button" class="ew-mini-btn" :disabled="itemIndex >= flow.prompt_items.length - 1" @click="movePromptItem(item.id, 1)">下移</button>
                  <button type="button" class="ew-mini-btn" @click="togglePromptExpand(item.id)">{{ expandedPromptId === item.id ? '收起' : '编辑' }}</button>
                  <button type="button" class="ew-mini-btn ew-mini-btn--danger" @click="removePromptItem(item.id)">删除</button>
                </div>
              </header>

              <div v-if="expandedPromptId === item.id" class="ew-prompt-item__body">
                <div class="ew-grid ew-grid--two">
                  <EwFieldRow label="名称" :help="help('flow.prompt_item.name')"><input :value="item.name" type="text" @input="patchPromptText(item.id, 'name', $event)" /></EwFieldRow>
                  <EwFieldRow label="角色" :help="help('flow.prompt_item.role')">
                    <select :value="item.role" @change="patchPromptRole(item.id, $event)">
                      <option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option>
                    </select>
                  </EwFieldRow>
                  <EwFieldRow label="插入位置" :help="help('flow.prompt_item.position')">
                    <select :value="item.position" @change="patchPromptPosition(item.id, $event)">
                      <option value="relative">相对</option><option value="in_chat">聊天中</option>
                    </select>
                  </EwFieldRow>
                  <EwFieldRow label="触发器">
                    <select :value="getPromptPrimaryTrigger(item)" @change="patchPromptTriggerTypes(item.id, $event)">
                      <option v-for="option in PROMPT_TRIGGER_OPTIONS" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                  </EwFieldRow>
                </div>
                <EwFieldRow label="内容" :help="help('flow.prompt_item.content')"><textarea :value="item.content" rows="4" @input="patchPromptText(item.id, 'content', $event)" /></EwFieldRow>
              </div>
            </article>
          </div>
        </section>

        <EwFieldRow label="请求模板(JSON merge)" :help="help('flow.request_template')">
          <textarea :value="flow.request_template" rows="4" :placeholder="help('flow.request_template')?.placeholder" @input="setText('request_template', $event)" />
        </EwFieldRow>
      </div>
    </transition>
  </article>
</template>

<script setup lang="ts">
import type { EwApiPreset, EwFlowConfig, EwFlowPromptItem } from '../../runtime/types';
import { simpleHash } from '../../runtime/helpers';
import { getFieldHelp } from '../help-meta';
import EwFieldRow from './EwFieldRow.vue';
import EwHelpTip from './EwHelpTip.vue';
import EwRulesEditor from './EwRulesEditor.vue';

type FlowNumberKey = 'priority' | 'timeout_ms' | 'context_turns';
type GenerationNumberKey = 'max_context_tokens' | 'max_reply_tokens' | 'n_candidates' | 'temperature' | 'frequency_penalty' | 'presence_penalty' | 'top_p';
type GenerationBoolKey = 'unlock_context_length' | 'stream';
type BehaviorBoolKey = 'continue_prefill' | 'squash_system_messages' | 'enable_function_calling' | 'send_inline_media' | 'request_thinking';
type BehaviorSelectKey = 'name_behavior' | 'reasoning_effort' | 'verbosity';
type PromptTriggerType = EwFlowPromptItem['trigger_types'][number];

const props = defineProps<{ modelValue: EwFlowConfig; apiPresets: EwApiPreset[]; index: number; expanded: boolean }>();
const emit = defineEmits<{ (event: 'toggle-expand'): void; (event: 'remove'): void; (event: 'update:modelValue', value: EwFlowConfig): void }>();

const flow = computed(() => props.modelValue);
const expandedPromptId = ref<string | null>(null);
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
const nameBehaviorGroupName = computed(() => `name_behavior_${flow.value.id}`);
const PROMPT_TRIGGER_OPTIONS: Array<{ value: PromptTriggerType; label: string }> = [
  { value: 'all', label: 'All types (default)' },
  { value: 'send', label: '发送' },
  { value: 'continue', label: '继续' },
  { value: 'regenerate', label: '重试/重生' },
  { value: 'quiet', label: '静默' },
  { value: 'manual', label: '手动' },
];

watch(() => flow.value.prompt_items.map(item => item.id), ids => {
  if (expandedPromptId.value && !ids.includes(expandedPromptId.value)) expandedPromptId.value = null;
});

function help(key: string) { return getFieldHelp(key); }
function patch(partial: Partial<EwFlowConfig>) { emit('update:modelValue', { ...flow.value, ...partial }); }
function patchGeneration(partial: Partial<EwFlowConfig['generation_options']>) { patch({ generation_options: { ...flow.value.generation_options, ...partial } }); }
function patchBehavior(partial: Partial<EwFlowConfig['behavior_options']>) { patch({ behavior_options: { ...flow.value.behavior_options, ...partial } }); }
function patchPromptItems(promptItems: EwFlowPromptItem[]) { patch({ prompt_items: promptItems }); }
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
function setBehaviorBool(key: BehaviorBoolKey, event: Event) { patchBehavior({ [key]: (event.target as HTMLInputElement).checked } as Partial<EwFlowConfig['behavior_options']>); }
function setBehaviorSelect(key: BehaviorSelectKey, value: EwFlowConfig['behavior_options'][BehaviorSelectKey]) { patchBehavior({ [key]: value } as Partial<EwFlowConfig['behavior_options']>); }
function setBehaviorSelectByEvent(key: Exclude<BehaviorSelectKey, 'name_behavior'>, event: Event) {
  patchBehavior({ [key]: (event.target as HTMLSelectElement).value as EwFlowConfig['behavior_options'][typeof key] } as Partial<EwFlowConfig['behavior_options']>);
}
function makePromptItem(index: number): EwFlowPromptItem {
  return {
    id: `prompt_${simpleHash(`${flow.value.id}-${index}-${Date.now()}`)}`,
    name: `提示词 ${index + 1}`,
    enabled: true,
    role: 'system',
    position: 'relative',
    trigger_types: ['all'],
    content: '',
  };
}
function addPromptItem() {
  const nextItems = [...flow.value.prompt_items, makePromptItem(flow.value.prompt_items.length)];
  patchPromptItems(nextItems);
  expandedPromptId.value = nextItems[nextItems.length - 1]?.id ?? null;
}
function removePromptItem(promptId: string) { patchPromptItems(flow.value.prompt_items.filter(item => item.id !== promptId)); }
function movePromptItem(promptId: string, direction: -1 | 1) {
  const currentIndex = flow.value.prompt_items.findIndex(item => item.id === promptId);
  if (currentIndex < 0) return;
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= flow.value.prompt_items.length) return;
  const nextItems = [...flow.value.prompt_items];
  const [moved] = nextItems.splice(currentIndex, 1);
  if (!moved) return;
  nextItems.splice(nextIndex, 0, moved);
  patchPromptItems(nextItems);
}
function togglePromptExpand(promptId: string) { expandedPromptId.value = expandedPromptId.value === promptId ? null : promptId; }
function patchPromptItem(promptId: string, partial: Partial<EwFlowPromptItem>) {
  patchPromptItems(flow.value.prompt_items.map(item => (item.id === promptId ? { ...item, ...partial } : item)));
}
function setPromptEnabled(promptId: string, event: Event) { patchPromptItem(promptId, { enabled: (event.target as HTMLInputElement).checked }); }
function patchPromptText(promptId: string, key: 'name' | 'content', event: Event) { patchPromptItem(promptId, { [key]: (event.target as HTMLInputElement | HTMLTextAreaElement).value }); }
function patchPromptRole(promptId: string, event: Event) { patchPromptItem(promptId, { role: (event.target as HTMLSelectElement).value as EwFlowPromptItem['role'] }); }
function patchPromptPosition(promptId: string, event: Event) { patchPromptItem(promptId, { position: (event.target as HTMLSelectElement).value as EwFlowPromptItem['position'] }); }
function getPromptPrimaryTrigger(item: EwFlowPromptItem): PromptTriggerType {
  const [first] = item.trigger_types;
  return first ?? 'all';
}
function patchPromptTriggerTypes(promptId: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value as PromptTriggerType;
  patchPromptItem(promptId, { trigger_types: [value] });
}
function promptTriggerSummary(item: EwFlowPromptItem) {
  const value = getPromptPrimaryTrigger(item);
  const matched = PROMPT_TRIGGER_OPTIONS.find(option => option.value === value);
  return matched?.label ?? value;
}

// --- Regex handling ---
type FlowBoolKey = 'use_tavern_regex';
function setFlowBool(key: FlowBoolKey, event: Event) {
  patch({ [key]: (event.target as HTMLInputElement).checked } as Partial<EwFlowConfig>);
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
.ew-flow-card { border-radius: 1rem; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 42%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 12%, rgba(8, 12, 18, 0.32)); box-shadow: 0 14px 30px rgba(0, 0, 0, 0.26), 0 0 0 1px rgba(255, 255, 255, 0.04) inset; }
.ew-flow-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.72rem; padding: 0.76rem 0.82rem; }
.ew-flow-card__summary { min-width: 0; }
.ew-flow-card__name { display: block; margin: 0; font-size: 1rem; line-height: 1.2; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 95%, transparent); }
.ew-flow-card__chips { display: flex; flex-wrap: wrap; gap: 0.36rem; margin-top: 0.42rem; }
.ew-flow-card__chip { border-radius: 999px; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 54%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 22%, transparent); color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 88%, transparent); font-size: 0.7rem; padding: 0.14rem 0.5rem; }
.ew-flow-card__endpoint { margin: 0.44rem 0 0; font-size: 0.74rem; line-height: 1.28; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 70%, transparent); word-break: break-all; }
.ew-flow-card__actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 0.42rem; }
.ew-flow-card__enabled { border-radius: 999px; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 42%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 14%, transparent); padding: 0.2rem 0.5rem; }
.ew-flow-card__action { border-radius: 0.68rem; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 56%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 24%, transparent); color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 95%, transparent); font-size: 0.73rem; font-weight: 600; padding: 0.24rem 0.54rem; cursor: pointer; }
.ew-flow-card__action--danger { border-color: color-mix(in srgb, #de6f78 62%, transparent); background: color-mix(in srgb, #de6f78 24%, transparent); color: #ffe8eb; }
.ew-flow-card__body { display: flex; flex-direction: column; gap: 0.82rem; padding: 0 0.82rem 0.82rem; }
.ew-flow-card__section { border-radius: 0.86rem; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 34%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 8%, rgba(0, 0, 0, 0.12)); padding: 0.62rem; }
.ew-flow-card__section h4 { margin: 0 0 0.58rem; font-size: 0.88rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 92%, transparent); }
.ew-flow-card__section-head { display: flex; align-items: center; justify-content: space-between; gap: 0.52rem; margin-bottom: 0.58rem; }
.ew-flow-card__desc { margin: 0 0 0.56rem; font-size: 0.76rem; line-height: 1.4; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 62%, transparent); }
.ew-flow-card__hint-text { margin: 0.22rem 0 0.46rem; font-size: 0.72rem; line-height: 1.35; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 56%, transparent); }
.ew-flow-card__subsection { border-radius: 0.72rem; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 24%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 5%, rgba(0, 0, 0, 0.08)); padding: 0.52rem; margin-bottom: 0.56rem; }
.ew-flow-card__subsection h5 { margin: 0 0 0.42rem; font-size: 0.84rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 88%, transparent); }
.ew-flow-card__custom-regex-head { display: flex; align-items: center; justify-content: space-between; gap: 0.42rem; margin: 0.52rem 0 0.36rem; }
.ew-flow-card__custom-regex-head h6 { margin: 0; font-size: 0.78rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 82%, transparent); }
.ew-regex-list { display: flex; flex-direction: column; gap: 0.42rem; }
.ew-regex-item { border-radius: 0.64rem; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 32%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 8%, rgba(0, 0, 0, 0.1)); padding: 0.42rem 0.5rem; }
.ew-regex-item__head { display: flex; align-items: center; gap: 0.42rem; margin-bottom: 0.36rem; }
.ew-regex-item__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.78rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 88%, transparent); }
.ew-regex-item__body { display: flex; flex-direction: column; gap: 0.36rem; }
.ew-grid { display: grid; gap: 0.66rem; }
.ew-grid--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.ew-checkbox { display: inline-flex; align-items: center; gap: 0.42rem; font-size: 0.8rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 86%, transparent); }
.ew-radio-group { display: flex; flex-wrap: wrap; gap: 0.44rem; }
.ew-radio { display: inline-flex; align-items: center; gap: 0.3rem; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 42%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 14%, transparent); padding: 0.22rem 0.48rem; font-size: 0.78rem; }
.ew-range { display: grid; grid-template-columns: 1fr 6.4rem; align-items: center; gap: 0.56rem; }
.ew-check-list { display: flex; flex-direction: column; gap: 0.42rem; padding: 0.16rem 0; }
.ew-subhead { display: flex; align-items: center; justify-content: space-between; gap: 0.46rem; margin-bottom: 0.46rem; }
.ew-subhead h5 { margin: 0; font-size: 0.82rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 90%, transparent); }
.ew-subhead h6 { margin: 0; font-size: 0.78rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 86%, transparent); }
.ew-inline { display: inline-flex; align-items: center; gap: 0.4rem; }
.ew-empty { border-radius: 0.72rem; border: 1px dashed color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 44%, transparent); padding: 0.58rem 0.64rem; font-size: 0.78rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 76%, transparent); }
.ew-prompt-list { display: flex; flex-direction: column; gap: 0.54rem; }
.ew-prompt-item { border-radius: 0.78rem; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 38%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 10%, rgba(0, 0, 0, 0.14)); padding: 0.48rem 0.54rem; }
.ew-prompt-item__head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto auto; align-items: center; gap: 0.46rem; }
.ew-prompt-item__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem; color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 94%, transparent); }
.ew-prompt-item__body { margin-top: 0.54rem; display: flex; flex-direction: column; gap: 0.56rem; }
.ew-mini-btn { border-radius: 0.52rem; border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 46%, transparent); background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 18%, transparent); color: var(--SmartThemeBodyColor, #edf2f9); font-size: 0.67rem; padding: 0.14rem 0.42rem; cursor: pointer; }
.ew-mini-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
.ew-mini-btn--danger { border-color: color-mix(in srgb, #de6f78 58%, transparent); background: color-mix(in srgb, #de6f78 22%, transparent); }
.ew-expand-enter-active, .ew-expand-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.ew-expand-enter-from, .ew-expand-leave-to { opacity: 0; transform: translateY(-4px); }
@media (max-width: 1200px) { .ew-prompt-item__head { grid-template-columns: auto minmax(0, 1fr); } }
@media (max-width: 900px) {
  .ew-flow-card__header { flex-direction: column; }
  .ew-flow-card__actions { width: 100%; justify-content: flex-start; }
  .ew-grid--two { grid-template-columns: 1fr; }
  .ew-range { grid-template-columns: 1fr; }
}
</style>
