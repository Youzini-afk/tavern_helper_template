<template>
  <article class="ew-api-card" :data-expanded="expanded ? '1' : '0'">
    <header class="ew-api-card__head">
      <div class="ew-api-card__summary">
        <strong class="ew-api-card__name">{{ preset.name || `API配置 ${index + 1}` }}</strong>
        <div class="ew-api-card__chips">
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
          <EwFieldRow label="API URL" :help="help('api_preset.api_url')">
            <input
              :value="preset.api_url"
              type="text"
              :placeholder="help('api_preset.api_url')?.placeholder"
              @input="setText('api_url', $event)"
            />
          </EwFieldRow>
          <EwFieldRow label="API Key" :help="help('api_preset.api_key')">
            <input :value="preset.api_key" type="password" @input="setText('api_key', $event)" />
          </EwFieldRow>
          <EwFieldRow label="额外请求头(JSON对象)" :help="help('api_preset.headers_json')">
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
const endpointSummary = computed(() => {
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

function setText(key: keyof EwApiPreset, event: Event) {
  const next = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  patch({ [key]: next } as Partial<EwApiPreset>);
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
}

@media (prefers-reduced-motion: reduce) {
  .ew-api-expand-enter-active,
  .ew-api-expand-leave-active {
    transition: none;
  }
}
</style>
