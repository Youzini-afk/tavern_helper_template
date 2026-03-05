<template>
  <EwPanelShell
    v-if="store.settings.ui_open"
    :busy="store.busy"
    :enabled="store.settings.enabled"
    title="Evolution World Assistant"
    :tabs="PANEL_TABS"
    :active-tab="store.activeTab"
    @change-tab="store.setActiveTab"
    @close="store.closePanel"
  >
    <template #actions>
      <button type="button" class="ew-btn" @click="store.validateConfig">校验配置</button>
      <button type="button" class="ew-btn" @click="openImportFilePicker">导入配置</button>
      <button type="button" class="ew-btn" @click="store.exportConfig">导出配置</button>
      <button type="button" class="ew-btn ew-btn--danger" @click="store.closePanel">关闭</button>
      <input
        ref="importFileInputRef"
        type="file"
        accept=".json,application/json,text/json"
        class="ew-hidden-file-input"
        @change="onImportFileChange"
      />
    </template>

    <div class="ew-content-stack">
      <template v-if="store.activeTab === 'overview'">
        <EwSectionCard title="高频设置" subtitle="先配置最常用项，快速跑通流程。">
          <div class="ew-grid two">
            <EwFieldRow label="总开关" :help="help('enabled')">
              <button
                type="button"
                class="ew-switch"
                role="switch"
                :aria-checked="store.settings.enabled ? 'true' : 'false'"
                @click="store.settings.enabled = !store.settings.enabled"
              >
                <span class="ew-switch__track" :data-enabled="store.settings.enabled ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
                <span class="ew-switch__text">{{ store.settings.enabled ? '已开启' : '已关闭' }}</span>
              </button>
            </EwFieldRow>
            <EwFieldRow label="调度模式" :help="help('dispatch_mode')">
              <select v-model="store.settings.dispatch_mode">
                <option value="parallel">并行</option>
                <option value="serial">串行</option>
              </select>
            </EwFieldRow>
            <EwFieldRow label="总超时(ms)" :help="help('total_timeout_ms')">
              <input v-model.number="store.settings.total_timeout_ms" type="number" min="1000" step="500" />
            </EwFieldRow>
            <EwFieldRow label="门控时效(ms)" :help="help('gate_ttl_ms')">
              <input v-model.number="store.settings.gate_ttl_ms" type="number" min="1000" step="500" />
            </EwFieldRow>
          </div>
        </EwSectionCard>

        <EwSectionCard title="运行摘要" subtitle="当前配置规模和关键参数一览。">
          <div class="ew-summary-grid">
            <article class="ew-summary-card">
              <h4>工作流数量</h4>
              <strong>{{ store.settings.flows.length }}</strong>
              <small>总工作流</small>
            </article>
            <article class="ew-summary-card">
              <h4>启用工作流</h4>
              <strong>{{ enabledFlowCount }}</strong>
              <small>有效工作流</small>
            </article>
            <article class="ew-summary-card">
              <h4>调度模式</h4>
              <strong>{{ store.settings.dispatch_mode === 'parallel' ? '并行' : '串行' }}</strong>
              <small>当前策略</small>
            </article>
            <article class="ew-summary-card">
              <h4>总超时</h4>
              <strong>{{ store.settings.total_timeout_ms }}ms</strong>
              <small>全链路上限</small>
            </article>
          </div>
        </EwSectionCard>
      </template>

      <template v-else-if="store.activeTab === 'api'">
        <EwSectionCard title="API配置" subtitle="统一管理外部接口预设，供工作流复用。">
          <template #actions>
            <button type="button" class="ew-btn" @click="store.addApiPreset">新增API配置</button>
          </template>

          <div class="ew-api-list">
            <EwApiPresetCard
              v-for="(preset, index) in store.settings.api_presets"
              :key="preset.id"
              :index="index"
              :model-value="preset"
              :expanded="store.expandedApiPresetId === preset.id"
              :bind-count="getPresetBindCount(preset.id)"
              @toggle-expand="store.toggleApiPresetExpanded(preset.id)"
              @remove="store.removeApiPreset(preset.id)"
              @update:model-value="value => updateApiPreset(index, value)"
            />
          </div>
        </EwSectionCard>
      </template>

      <template v-else-if="store.activeTab === 'global'">
        <EwSectionCard title="基础配置" subtitle="世界书命名与楼层绑定控制。">
          <div class="ew-grid two">
            <EwFieldRow label="动态条目前缀" :help="help('dynamic_entry_prefix')">
              <input
                v-model="store.settings.dynamic_entry_prefix"
                type="text"
                :placeholder="help('dynamic_entry_prefix')?.placeholder"
              />
            </EwFieldRow>
            <EwFieldRow label="控制器条目名" :help="help('controller_entry_name')">
              <input
                v-model="store.settings.controller_entry_name"
                type="text"
                :placeholder="help('controller_entry_name')?.placeholder"
              />
            </EwFieldRow>
            <EwFieldRow label="楼层绑定" :help="help('floor_binding_enabled')">
              <button
                type="button"
                class="ew-switch"
                role="switch"
                :aria-checked="store.settings.floor_binding_enabled ? 'true' : 'false'"
                @click="store.settings.floor_binding_enabled = !store.settings.floor_binding_enabled"
              >
                <span class="ew-switch__track" :data-enabled="store.settings.floor_binding_enabled ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
                <span class="ew-switch__text">{{ store.settings.floor_binding_enabled ? '已开启' : '已关闭' }}</span>
              </button>
            </EwFieldRow>
            <EwFieldRow label="自动清理孤儿条目" :help="help('auto_cleanup_orphans')">
              <button
                type="button"
                class="ew-switch"
                role="switch"
                :aria-checked="store.settings.auto_cleanup_orphans ? 'true' : 'false'"
                @click="store.settings.auto_cleanup_orphans = !store.settings.auto_cleanup_orphans"
              >
                <span class="ew-switch__track" :data-enabled="store.settings.auto_cleanup_orphans ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
                <span class="ew-switch__text">{{ store.settings.auto_cleanup_orphans ? '已开启' : '已关闭' }}</span>
              </button>
            </EwFieldRow>
          </div>
        </EwSectionCard>

        <EwSectionCard
          v-model="store.globalAdvancedOpen"
          title="高级配置"
          subtitle="默认收起，仅在需要精细调优时展开。"
          collapsible
        >
          <div class="ew-grid two">
            <EwFieldRow label="失败策略" :help="help('failure_policy')">
              <input :value="'失败即中止发送'" type="text" disabled />
            </EwFieldRow>
          </div>
        </EwSectionCard>
      </template>

      <template v-else-if="store.activeTab === 'flows'">
        <EwSectionCard title="工作流编排" subtitle="每条工作流独立配置，按优先级合并结果。">
          <template #actions>
            <button type="button" class="ew-btn" @click="store.addFlow">新增工作流</button>
          </template>

          <div class="ew-flow-list">
            <EwFlowCard
              v-for="(flow, index) in store.settings.flows"
              :key="flow.id"
              :index="index"
              :model-value="flow"
              :api-presets="store.settings.api_presets"
              :expanded="store.expandedFlowId === flow.id"
              @toggle-expand="store.toggleFlowExpanded(flow.id)"
              @remove="store.removeFlow(flow.id)"
              @update:model-value="value => updateFlow(index, value)"
            />
          </div>
        </EwSectionCard>
      </template>

      <template v-else>
        <EwSectionCard title="调试操作" subtitle="手动执行、语法校验与快速回滚。">
          <div class="ew-actions-wrap">
            <button type="button" class="ew-btn" @click="store.runManual(manualMessage)">手动运行</button>
            <button type="button" class="ew-btn" @click="store.validateControllerSyntax">控制器语法校验</button>
            <button type="button" class="ew-btn ew-btn--danger" @click="store.rollbackController">回滚控制器</button>
          </div>

          <EwFieldRow label="手动运行输入" :help="help('manual_message')">
            <textarea v-model="manualMessage" rows="3" placeholder="留空将使用最新楼层文本" />
          </EwFieldRow>
        </EwSectionCard>

        <EwSectionCard title="运行记录" subtitle="最近一次执行与请求响应摘要。">
          <div class="ew-debug-grid">
            <div class="ew-pre-box">
              <strong>最近运行</strong>
              <pre>{{ formattedLastRun }}</pre>
            </div>
            <div class="ew-pre-box">
              <strong>最近请求/响应摘要</strong>
              <pre>{{ formattedLastIo }}</pre>
            </div>
          </div>

          <EwFieldRow label="导入配置(JSON)" :help="help('import_text')">
            <textarea v-model="store.importText" rows="6" placeholder="paste config json" />
          </EwFieldRow>

          <div class="ew-actions-wrap">
            <button type="button" class="ew-btn" @click="store.importConfig">导入配置</button>
          </div>
        </EwSectionCard>
      </template>
    </div>
  </EwPanelShell>
</template>

<script setup lang="ts">
import type { EwApiPreset, EwFlowConfig } from '../runtime/types';
import EwApiPresetCard from './components/EwApiPresetCard.vue';
import EwFieldRow from './components/EwFieldRow.vue';
import EwFlowCard from './components/EwFlowCard.vue';
import EwPanelShell from './components/EwPanelShell.vue';
import EwSectionCard from './components/EwSectionCard.vue';
import { getFieldHelp, PANEL_TABS } from './help-meta';
import { showEwNotice } from './notice';
import { useEwStore } from './store';

const store = useEwStore();
const manualMessage = ref('');
const importFileInputRef = ref<HTMLInputElement | null>(null);

const enabledFlowCount = computed(() => store.settings.flows.filter(flow => flow.enabled).length);
const formattedLastRun = computed(() => JSON.stringify(store.lastRun ?? {}, null, 2));
const formattedLastIo = computed(() => JSON.stringify(store.lastIo ?? {}, null, 2));

function help(key: string) {
  return getFieldHelp(key);
}

function updateFlow(index: number, nextFlow: EwFlowConfig) {
  const previousId = store.settings.flows[index]?.id;
  store.settings.flows.splice(index, 1, nextFlow);
  if (store.expandedFlowId === previousId && previousId !== nextFlow.id) {
    store.setExpandedFlow(nextFlow.id);
  }
}

function updateApiPreset(index: number, nextPreset: EwApiPreset) {
  const previousId = store.settings.api_presets[index]?.id;
  store.settings.api_presets.splice(index, 1, nextPreset);
  if (store.expandedApiPresetId === previousId && previousId !== nextPreset.id) {
    store.setExpandedApiPreset(nextPreset.id);
  }
}

function getPresetBindCount(presetId: string) {
  return store.settings.flows.filter(flow => flow.api_preset_id === presetId).length;
}

function openImportFilePicker() {
  importFileInputRef.value?.click();
}

async function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  try {
    store.importText = await file.text();
    store.importConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showEwNotice({
      title: '文件读取失败',
      message,
      level: 'error',
      duration_ms: 4600,
    });
    toastr.error(`import failed: ${message}`, 'Evolution World');
  } finally {
    if (input) {
      input.value = '';
    }
  }
}

function onEsc(event: KeyboardEvent) {
  if (event.key !== 'Escape') {
    return;
  }
  if (!store.settings.ui_open) {
    return;
  }
  store.closePanel();
}

onMounted(() => {
  window.addEventListener('keydown', onEsc);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onEsc);
});
</script>

<style scoped>
.ew-content-stack {
  display: flex;
  flex-direction: column;
  gap: 0.86rem;
  font-family:
    'Noto Sans SC',
    'PingFang SC',
    'Microsoft YaHei UI',
    'Microsoft YaHei',
    sans-serif;
}

.ew-grid {
  display: grid;
  gap: 0.74rem;
}

.ew-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ew-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.64rem;
}

.ew-summary-card {
  border-radius: 0.9rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 40%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 12%, rgba(0, 0, 0, 0.12));
  padding: 0.62rem 0.68rem;
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
}

.ew-summary-card h4 {
  margin: 0;
  font-size: 0.77rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 74%, transparent);
}

.ew-summary-card strong {
  font-size: 1.2rem;
  line-height: 1;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 95%, transparent);
}

.ew-summary-card small {
  font-size: 0.7rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 64%, transparent);
}

.ew-flow-list {
  display: flex;
  flex-direction: column;
  gap: 0.74rem;
}

.ew-api-list {
  display: flex;
  flex-direction: column;
  gap: 0.74rem;
}

.ew-actions-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.46rem;
}

.ew-btn {
  border-radius: 0.7rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 56%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 24%, transparent);
  color: var(--SmartThemeBodyColor, #edf2f9);
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.32rem 0.68rem;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.14s ease;
}

.ew-btn:hover,
.ew-btn:focus-visible {
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 78%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 38%, transparent);
  transform: translateY(-1px);
  outline: none;
}

.ew-btn--danger {
  border-color: color-mix(in srgb, #d76872 58%, transparent);
  background: color-mix(in srgb, #d76872 24%, transparent);
  color: #ffe5e8;
}

.ew-btn--danger:hover,
.ew-btn--danger:focus-visible {
  background: color-mix(in srgb, #d76872 38%, transparent);
  border-color: color-mix(in srgb, #d76872 74%, transparent);
}

.ew-hidden-file-input {
  display: none;
}

.ew-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.58rem;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}

.ew-switch__track {
  width: 2.7rem;
  height: 1.56rem;
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
    border-color 0.2s ease,
    background 0.2s ease;
}

.ew-switch__track[data-enabled='1'] {
  border-color: color-mix(in srgb, #55cb84 62%, transparent);
  background: color-mix(in srgb, #55cb84 36%, rgba(7, 10, 15, 0.4));
}

.ew-switch__thumb {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--SmartThemeBodyColor, #eef3f9) 96%, transparent);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.38),
    0 0 0 1px rgba(0, 0, 0, 0.12);
  transform: translateX(0);
  transition:
    transform 0.2s ease,
    background 0.2s ease;
}

.ew-switch__track[data-enabled='1'] .ew-switch__thumb {
  transform: translateX(1.12rem);
  background: #f8fffb;
}

.ew-switch__text {
  font-size: 0.8rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 86%, transparent);
}

.ew-switch:hover .ew-switch__track,
.ew-switch:focus-visible .ew-switch__track {
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 78%, transparent);
}

.ew-switch:focus-visible {
  outline: none;
}

.ew-debug-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.72rem;
}

.ew-pre-box {
  border-radius: 0.9rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 42%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 12%, rgba(0, 0, 0, 0.12));
  padding: 0.66rem;
}

.ew-pre-box strong {
  font-size: 0.8rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 88%, transparent);
}

.ew-pre-box pre {
  margin: 0.46rem 0 0;
  max-height: 16rem;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.73rem;
  line-height: 1.42;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 84%, transparent);
}

@media (max-width: 1100px) {
  .ew-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .ew-grid.two {
    grid-template-columns: 1fr;
  }

  .ew-debug-grid {
    grid-template-columns: 1fr;
  }

  .ew-summary-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 560px) {
  .ew-summary-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ew-btn {
    transition: none;
  }
}
</style>
