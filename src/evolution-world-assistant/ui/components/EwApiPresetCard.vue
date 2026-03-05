<template>
  <article class="ew-api-card" :data-expanded="expanded ? '1' : '0'">
    <header class="ew-api-card__head">
      <div class="ew-api-card__summary">
        <strong class="ew-api-card__name">{{ preset.name || `API配置 ${index + 1}` }}</strong>
        <div class="ew-api-card__chips">
          <span class="ew-api-card__chip">{{ preset.mode === 'workflow_http' ? '工作流HTTP' : '酒馆连接器' }}</span>
          <span v-if="preset.mode === 'llm_connector'" class="ew-api-card__chip">
            {{ preset.use_main_api ? '主API模型' : `模型 ${preset.model || '未选'}` }}
          </span>
          <span class="ew-api-card__chip">工作流引用 {{ bindCount }}</span>
        </div>
        <p class="ew-api-card__endpoint">URL: {{ endpointSummary }}</p>
      </div>

      <div class="ew-api-card__actions">
        <button type="button" class="ew-api-card__action" @click="$emit('toggle-expand')">
          {{ expanded ? '收起' : '编辑' }}
        </button>
        <button type="button" class="ew-api-card__action ew-api-card__action--danger" @click="$emit('remove')">
          删除
        </button>
      </div>
    </header>

    <transition name="ew-api-expand">
      <div v-if="expanded" class="ew-api-card__body">
        <div class="ew-api-card__grid two">
          <EwFieldRow label="预设名称" :help="help('api_preset.name')">
            <input :value="preset.name" type="text" @input="setText('name', $event)" />
          </EwFieldRow>
          <EwFieldRow label="API模式" :help="help('api_preset.mode')">
            <select :value="preset.mode" @change="setMode">
              <option value="workflow_http">自定义工作流API</option>
              <option value="llm_connector">酒馆连接器</option>
            </select>
          </EwFieldRow>

          <EwFieldRow v-if="preset.mode === 'llm_connector'" label="使用主API" :help="help('api_preset.use_main_api')">
            <label class="ew-api-card__check-row">
              <input :checked="preset.use_main_api" type="checkbox" @change="setUseMainApi" />
              <span>直接使用酒馆当前 API 和模型</span>
            </label>
          </EwFieldRow>

          <EwFieldRow
            v-if="preset.mode === 'workflow_http' || !preset.use_main_api"
            label="API URL"
            :help="help('api_preset.api_url')"
          >
            <input
              :value="preset.api_url"
              type="text"
              :placeholder="help('api_preset.api_url')?.placeholder"
              @input="setText('api_url', $event)"
            />
          </EwFieldRow>

          <EwFieldRow
            v-if="preset.mode === 'workflow_http' || !preset.use_main_api"
            label="API Key"
            :help="help('api_preset.api_key')"
          >
            <input :value="preset.api_key" type="password" @input="setText('api_key', $event)" />
          </EwFieldRow>

          <EwFieldRow v-if="preset.mode === 'llm_connector' && !preset.use_main_api" label="模型" :help="help('api_preset.model')">
            <div class="ew-api-card__model-wrap">
              <input
                :value="preset.model"
                type="text"
                :list="modelListId"
                :placeholder="help('api_preset.model')?.placeholder"
                @input="setText('model', $event)"
              />
              <button
                type="button"
                class="ew-api-card__action"
                :disabled="loadingModels"
                @click="loadModels"
              >
                {{ loadingModels ? '加载中...' : '加载模型列表' }}
              </button>
              <datalist :id="modelListId">
                <option v-for="model in preset.model_candidates" :key="model" :value="model" />
              </datalist>
            </div>
          </EwFieldRow>

          <EwFieldRow
            v-if="preset.mode === 'workflow_http'"
            label="额外请求头(JSON对象)"
            :help="help('api_preset.headers_json')"
          >
            <textarea
              :value="preset.headers_json"
              rows="3"
              :placeholder="help('api_preset.headers_json')?.placeholder"
              @input="setText('headers_json', $event)"
            />
          </EwFieldRow>
        </div>
      </div>
    </transition>
  </article>
</template>

<script setup lang="ts">
import type { EwApiPreset } from '../../runtime/types';
import { getFieldHelp } from '../help-meta';
import EwFieldRow from './EwFieldRow.vue';

const props = defineProps<{
  modelValue: EwApiPreset;
  index: number;
  expanded: boolean;
  bindCount: number;
}>();

const emit = defineEmits<{
  (event: 'toggle-expand'): void;
  (event: 'remove'): void;
  (event: 'update:modelValue', value: EwApiPreset): void;
}>();

const preset = computed(() => props.modelValue);
const loadingModels = ref(false);
const modelListId = computed(() => `ew-model-list-${preset.value.id || props.index}`);
const endpointSummary = computed(() => {
  if (preset.value.mode === 'llm_connector') {
    if (preset.value.use_main_api) {
      return '酒馆主API（直接使用当前连接器与模型）';
    }
    const endpoint = preset.value.api_url.trim();
    if (!endpoint) {
      return '连接器未配置（缺少 API URL）';
    }
    const model = preset.value.model.trim() || '未选模型';
    return `${endpoint} / ${model}`;
  }

  const endpoint = preset.value.api_url.trim();
  if (!endpoint) {
    return '未配置';
  }
  if (endpoint.length <= 64) {
    return endpoint;
  }
  return `${endpoint.slice(0, 61)}...`;
});

function help(key: string) {
  return getFieldHelp(key);
}

function patch(partial: Partial<EwApiPreset>) {
  emit('update:modelValue', {
    ...preset.value,
    ...partial,
  });
}

function setText(key: 'name' | 'api_url' | 'api_key' | 'model' | 'headers_json', event: Event) {
  const next = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  patch({ [key]: next } as Partial<EwApiPreset>);
}

function setMode(event: Event) {
  const mode = (event.target as HTMLSelectElement).value;
  if (mode !== 'workflow_http' && mode !== 'llm_connector') {
    return;
  }
  patch({ mode });
}

function setUseMainApi(event: Event) {
  patch({ use_main_api: (event.target as HTMLInputElement).checked });
}

async function loadModels() {
  if (typeof getModelList !== 'function') {
    toastr.error('当前环境不支持 getModelList', 'Evolution World');
    return;
  }

  const apiurl = preset.value.api_url.trim();
  if (!apiurl) {
    toastr.warning('请先填写 API URL', 'Evolution World');
    return;
  }

  loadingModels.value = true;
  try {
    const list = await getModelList({
      apiurl,
      key: preset.value.api_key.trim() || undefined,
    });
    const deduped = Array.from(new Set(list.map(item => item.trim()).filter(Boolean)));
    const current = preset.value.model.trim();
    const model_candidates = current && !deduped.includes(current) ? [current, ...deduped] : deduped;
    patch({
      model_candidates,
      model: current || model_candidates[0] || '',
    });
    toastr.success(`已加载 ${model_candidates.length} 个模型`, 'Evolution World');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(`加载模型失败: ${message}`, 'Evolution World');
  } finally {
    loadingModels.value = false;
  }
}
</script>

<style scoped>
.ew-api-card {
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 42%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #2f4158) 13%, rgba(10, 14, 20, 0.64));
  box-shadow:
    0 14px 30px rgba(0, 0, 0, 0.22),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  backdrop-filter: blur(10px) saturate(120%);
  -webkit-backdrop-filter: blur(10px) saturate(120%);
  overflow: visible;
}

.ew-api-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.78rem 0.86rem;
}

.ew-api-card__summary {
  min-width: 0;
}

.ew-api-card__name {
  display: block;
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.2;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 95%, transparent);
}

.ew-api-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.36rem;
  margin-top: 0.44rem;
}

.ew-api-card__chip {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 52%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 22%, transparent);
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 88%, transparent);
  font-size: 0.7rem;
  padding: 0.14rem 0.48rem;
}

.ew-api-card__endpoint {
  margin: 0.44rem 0 0;
  font-size: 0.74rem;
  line-height: 1.3;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 72%, transparent);
  word-break: break-all;
}

.ew-api-card__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
}

.ew-api-card__action {
  border-radius: 0.65rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 56%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 28%, transparent);
  color: var(--SmartThemeBodyColor, #edf2f9);
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.24rem 0.52rem;
  cursor: pointer;
}

.ew-api-card__action:hover,
.ew-api-card__action:focus-visible {
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 42%, transparent);
  outline: none;
}

.ew-api-card__action--danger {
  border-color: color-mix(in srgb, #d76872 56%, transparent);
  background: color-mix(in srgb, #d76872 24%, transparent);
  color: #ffe5e8;
}

.ew-api-card__action--danger:hover,
.ew-api-card__action--danger:focus-visible {
  background: color-mix(in srgb, #d76872 38%, transparent);
}

.ew-api-card__body {
  padding: 0 0.86rem 0.88rem;
  display: flex;
  flex-direction: column;
  gap: 0.86rem;
}

.ew-api-card__grid {
  display: grid;
  gap: 0.68rem;
}

.ew-api-card__grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ew-api-card__check-row {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 86%, transparent);
  font-size: 0.82rem;
}

.ew-api-card__model-wrap {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.52rem;
}

.ew-api-card__model-wrap datalist {
  display: none;
}

.ew-api-expand-enter-active,
.ew-api-expand-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.ew-api-expand-enter-from,
.ew-api-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@supports not ((backdrop-filter: blur(1px))) {
  .ew-api-card {
    background: color-mix(in srgb, var(--SmartThemeQuoteColor, #2f4158) 18%, rgba(10, 14, 20, 0.92));
  }
}

@media (max-width: 900px) {
  .ew-api-card__head {
    flex-direction: column;
  }

  .ew-api-card__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .ew-api-card__grid.two {
    grid-template-columns: 1fr;
  }

  .ew-api-card__model-wrap {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ew-api-expand-enter-active,
  .ew-api-expand-leave-active {
    transition: none;
  }
}
</style>
