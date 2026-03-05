<template>
  <article class="ew-flow-card" :data-enabled="flow.enabled ? '1' : '0'" :data-expanded="expanded ? '1' : '0'">
    <header class="ew-flow-card__head">
      <div class="ew-flow-card__summary">
        <strong class="ew-flow-card__name">{{ flow.name || `工作流 ${index + 1}` }}</strong>
        <div class="ew-flow-card__chips">
          <span class="ew-flow-card__chip">{{ flow.enabled ? '启用' : '停用' }}</span>
          <span class="ew-flow-card__chip">优先级 {{ flow.priority }}</span>
          <span class="ew-flow-card__chip">超时 {{ flow.timeout_ms }}ms</span>
          <span class="ew-flow-card__chip">API {{ presetLabel }}</span>
        </div>
        <p class="ew-flow-card__endpoint">接口: {{ endpointSummary }}</p>
      </div>

      <div class="ew-flow-card__actions">
        <label class="ew-flow-card__switch">
          <input :checked="flow.enabled" type="checkbox" @change="setEnabled($event)" />
          启用
        </label>
        <button type="button" class="ew-flow-card__action" @click="$emit('toggle-expand')">
          {{ expanded ? '收起' : '编辑' }}
        </button>
        <button type="button" class="ew-flow-card__action ew-flow-card__action--danger" @click="$emit('remove')">
          删除
        </button>
      </div>
    </header>

    <transition name="ew-flow-expand">
      <div v-if="expanded" class="ew-flow-card__body">
        <div class="ew-flow-card__grid two">
          <EwFieldRow label="名称" :help="help('flow.name')">
            <input :value="flow.name" type="text" @input="setText('name', $event)" />
          </EwFieldRow>
          <EwFieldRow label="工作流ID" :help="help('flow.id')">
            <input :value="flow.id" type="text" @input="setText('id', $event)" />
          </EwFieldRow>
          <EwFieldRow label="API配置预设" :help="help('flow.api_preset_id')">
            <select :value="flow.api_preset_id" @change="setApiPresetId($event)">
              <option v-if="apiPresets.length === 0" value="">无可用API配置</option>
              <option v-for="preset in apiPresets" :key="preset.id" :value="preset.id">
                {{ preset.name || preset.id }}
              </option>
            </select>
          </EwFieldRow>
          <EwFieldRow label="优先级" :help="help('flow.priority')">
            <input :value="flow.priority" type="number" step="1" @input="setNumber('priority', $event)" />
          </EwFieldRow>
          <EwFieldRow label="超时(ms)" :help="help('flow.timeout_ms')">
            <input :value="flow.timeout_ms" type="number" min="1000" step="500" @input="setNumber('timeout_ms', $event)" />
          </EwFieldRow>
          <EwFieldRow label="上下文楼层数" :help="help('flow.context_turns')">
            <input :value="flow.context_turns" type="number" min="1" step="1" @input="setNumber('context_turns', $event)" />
          </EwFieldRow>
        </div>

        <div class="ew-flow-card__grid two ew-flow-card__rules-grid">
          <section class="ew-flow-card__rules-block">
            <div class="ew-flow-card__rules-head">
              <h4>提取规则</h4>
              <EwHelpTip :meta="help('flow.extract_rules')!" />
            </div>
            <EwRulesEditor
              title="提取规则"
              :model-value="flow.extract_rules"
              @update:model-value="value => patch({ extract_rules: value })"
            />
          </section>

          <section class="ew-flow-card__rules-block">
            <div class="ew-flow-card__rules-head">
              <h4>排除规则</h4>
              <EwHelpTip :meta="help('flow.exclude_rules')!" />
            </div>
            <EwRulesEditor
              title="排除规则"
              :model-value="flow.exclude_rules"
              @update:model-value="value => patch({ exclude_rules: value })"
            />
          </section>
        </div>

        <EwFieldRow label="请求模板(JSON merge)" :help="help('flow.request_template')">
          <textarea
            :value="flow.request_template"
            rows="4"
            :placeholder="help('flow.request_template')?.placeholder"
            @input="setText('request_template', $event)"
          />
        </EwFieldRow>
      </div>
    </transition>
  </article>
</template>

<script setup lang="ts">
import type { EwApiPreset, EwFlowConfig } from '../../runtime/types';
import { getFieldHelp } from '../help-meta';
import EwFieldRow from './EwFieldRow.vue';
import EwHelpTip from './EwHelpTip.vue';
import EwRulesEditor from './EwRulesEditor.vue';

const props = defineProps<{
  modelValue: EwFlowConfig;
  apiPresets: EwApiPreset[];
  index: number;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggle-expand'): void;
  (event: 'remove'): void;
  (event: 'update:modelValue', value: EwFlowConfig): void;
}>();

const flow = computed(() => props.modelValue);
const selectedPreset = computed(() => {
  return props.apiPresets.find(preset => preset.id === flow.value.api_preset_id) ?? null;
});
const endpointSummary = computed(() => {
  const endpoint = selectedPreset.value?.api_url.trim() ?? '';
  if (!endpoint) {
    return '未配置';
  }
  if (endpoint.length <= 60) {
    return endpoint;
  }
  return `${endpoint.slice(0, 57)}...`;
});
const presetLabel = computed(() => {
  const label = selectedPreset.value?.name?.trim() ?? '';
  if (label) {
    return label;
  }
  return '未绑定';
});

function help(key: string) {
  return getFieldHelp(key);
}

function patch(partial: Partial<EwFlowConfig>) {
  emit('update:modelValue', {
    ...flow.value,
    ...partial,
  });
}

function toNumber(rawValue: string, fallback: number) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function setEnabled(event: Event) {
  const next = (event.target as HTMLInputElement).checked;
  patch({ enabled: next });
}

function setText(key: 'name' | 'id' | 'request_template', event: Event) {
  const next = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  patch({ [key]: next } as Partial<EwFlowConfig>);
}

function setNumber(key: 'priority' | 'timeout_ms' | 'context_turns', event: Event) {
  const rawValue = (event.target as HTMLInputElement).value;
  const currentValue = flow.value[key];
  const fallback = typeof currentValue === 'number' ? currentValue : 0;
  patch({ [key]: toNumber(rawValue, fallback) } as Partial<EwFlowConfig>);
}

function setApiPresetId(event: Event) {
  const nextId = (event.target as HTMLSelectElement).value;
  patch({ api_preset_id: nextId });
}
</script>

<style scoped>
.ew-flow-card {
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 44%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #2f4158) 15%, rgba(10, 14, 20, 0.66));
  box-shadow:
    0 14px 30px rgba(0, 0, 0, 0.24),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  backdrop-filter: blur(10px) saturate(120%);
  -webkit-backdrop-filter: blur(10px) saturate(120%);
  overflow: visible;
}

.ew-flow-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.78rem 0.86rem;
}

.ew-flow-card__summary {
  min-width: 0;
}

.ew-flow-card__name {
  display: block;
  margin: 0;
  font-size: 1rem;
  line-height: 1.2;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 95%, transparent);
}

.ew-flow-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.36rem;
  margin-top: 0.44rem;
}

.ew-flow-card__chip {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 52%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 22%, transparent);
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 88%, transparent);
  font-size: 0.7rem;
  padding: 0.14rem 0.48rem;
}

.ew-flow-card__endpoint {
  margin: 0.44rem 0 0;
  font-size: 0.74rem;
  line-height: 1.3;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 72%, transparent);
  word-break: break-all;
}

.ew-flow-card__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
}

.ew-flow-card__switch {
  display: inline-flex;
  align-items: center;
  gap: 0.34rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 42%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 14%, transparent);
  padding: 0.2rem 0.5rem;
  font-size: 0.74rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 90%, transparent);
}

.ew-flow-card__action {
  border-radius: 0.65rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 56%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 28%, transparent);
  color: var(--SmartThemeBodyColor, #edf2f9);
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.24rem 0.52rem;
  cursor: pointer;
}

.ew-flow-card__action:hover,
.ew-flow-card__action:focus-visible {
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 42%, transparent);
  outline: none;
}

.ew-flow-card__action--danger {
  border-color: color-mix(in srgb, #d76872 56%, transparent);
  background: color-mix(in srgb, #d76872 24%, transparent);
  color: #ffe5e8;
}

.ew-flow-card__action--danger:hover,
.ew-flow-card__action--danger:focus-visible {
  background: color-mix(in srgb, #d76872 38%, transparent);
}

.ew-flow-card__body {
  padding: 0 0.86rem 0.88rem;
  display: flex;
  flex-direction: column;
  gap: 0.86rem;
}

.ew-flow-card__grid {
  display: grid;
  gap: 0.68rem;
}

.ew-flow-card__grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ew-flow-card__rules-grid {
  align-items: start;
}

.ew-flow-card__rules-block {
  min-width: 0;
}

.ew-flow-card__rules-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  margin-bottom: 0.42rem;
}

.ew-flow-card__rules-head h4 {
  margin: 0;
  font-size: 0.82rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 90%, transparent);
}

.ew-flow-expand-enter-active,
.ew-flow-expand-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.ew-flow-expand-enter-from,
.ew-flow-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@supports not ((backdrop-filter: blur(1px))) {
  .ew-flow-card {
    background: color-mix(in srgb, var(--SmartThemeQuoteColor, #2f4158) 20%, rgba(10, 14, 20, 0.92));
  }
}

@media (max-width: 900px) {
  .ew-flow-card__head {
    flex-direction: column;
  }

  .ew-flow-card__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .ew-flow-card__grid.two {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ew-flow-expand-enter-active,
  .ew-flow-expand-leave-active {
    transition: none;
  }
}
</style>
