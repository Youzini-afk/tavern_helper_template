<template>
  <EwPanelShell
    v-if="store.settings.ui_open"
    :class="{ 'theme-moon-phase': store.settings.theme_moon }"
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
        <EwSectionCard title="高频设置">
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
            <EwFieldRow label="月相主题" :help="{ shortHelp: '开启深度定制的月相星空主题', detailHelp: '将界面切换为幽暗深邃的月夜星空风格。' }">
              <button
                type="button"
                class="ew-switch"
                role="switch"
                :aria-checked="store.settings.theme_moon ? 'true' : 'false'"
                @click="store.settings.theme_moon = !store.settings.theme_moon"
              >
                <span class="ew-switch__track" :data-enabled="store.settings.theme_moon ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
                <span class="ew-switch__text">{{ store.settings.theme_moon ? '开启 🌙' : '未开启' }}</span>
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

          <transition-group name="ew-list" tag="div" class="ew-api-list">
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
          </transition-group>
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
          subtitle=""
          collapsible
        >
          <div class="ew-grid two">
            <EwFieldRow label="失败策略" :help="help('failure_policy')">
              <select v-model="store.settings.failure_policy">
                <option value="stop_generation">失败即中止发送</option>
                <option value="continue_generation">静默继续生成</option>
                <option value="retry_once">失败重试一次</option>
                <option value="notify_only">仅通知（不中止）</option>
              </select>
            </EwFieldRow>
          </div>
        </EwSectionCard>

        <EwSectionCard title="隐藏设置" subtitle="批量隐藏旧楼层（节省 tokens）或限制界面渲染数量（提升流畅度）。">
          <div class="ew-grid two">
            <EwFieldRow label="隐藏楼层">
              <button
                type="button"
                class="ew-switch"
                role="switch"
                :aria-checked="store.settings.hide_settings.enabled ? 'true' : 'false'"
                @click="store.settings.hide_settings.enabled = !store.settings.hide_settings.enabled"
              >
                <span class="ew-switch__track" :data-enabled="store.settings.hide_settings.enabled ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
                <span class="ew-switch__text">{{ store.settings.hide_settings.enabled ? '已开启' : '已关闭' }}</span>
              </button>
            </EwFieldRow>
            <EwFieldRow label="保留最新 N 条">
              <input
                v-model.number="store.settings.hide_settings.hide_last_n"
                type="number"
                min="0"
                step="1"
                placeholder="0 表示不隐藏"
                :disabled="!store.settings.hide_settings.enabled"
              />
            </EwFieldRow>
            <EwFieldRow label="限制楼层渲染">
              <button
                type="button"
                class="ew-switch"
                role="switch"
                :aria-checked="store.settings.hide_settings.limiter_enabled ? 'true' : 'false'"
                @click="store.settings.hide_settings.limiter_enabled = !store.settings.hide_settings.limiter_enabled"
              >
                <span class="ew-switch__track" :data-enabled="store.settings.hide_settings.limiter_enabled ? '1' : '0'">
                  <span class="ew-switch__thumb" />
                </span>
                <span class="ew-switch__text">{{ store.settings.hide_settings.limiter_enabled ? '已开启' : '已关闭' }}</span>
              </button>
            </EwFieldRow>
            <EwFieldRow label="仅渲染最新 M 条">
              <input
                v-model.number="store.settings.hide_settings.limiter_count"
                type="number"
                min="1"
                step="1"
                placeholder="例如 20"
                :disabled="!store.settings.hide_settings.limiter_enabled"
              />
            </EwFieldRow>
          </div>
          <div class="ew-actions-wrap" style="margin-top: 0.75rem;">
            <button type="button" class="ew-btn" @click="onApplyHide">
              立即应用隐藏
            </button>
            <button type="button" class="ew-btn ew-btn--danger" @click="onUnhideAll">
              取消全部隐藏
            </button>
          </div>
        </EwSectionCard>
      </template>

      <template v-else-if="store.activeTab === 'flows'">
        <EwSectionCard title="工作流编排" subtitle="每条工作流独立配置，按优先级合并结果。">
          <template #actions>
            <button type="button" class="ew-btn" @click="store.addFlow">新增工作流</button>
          </template>

          <transition-group name="ew-list" tag="div" class="ew-flow-list">
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
          </transition-group>
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
import { runFullHideCheck, unhideAll, applyFloorLimit } from '../runtime/hide-engine';
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

function onApplyHide() {
  runFullHideCheck(store.settings.hide_settings);
  applyFloorLimit(store.settings.hide_settings);
  showEwNotice({ title: '隐藏助手', message: '隐藏设置已应用', level: 'success' });
}

function onUnhideAll() {
  store.settings.hide_settings.hide_last_n = 0;
  unhideAll();
  showEwNotice({ title: '隐藏助手', message: '已取消全部隐藏', level: 'info' });
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
  gap: 1rem;
  min-width: 0; /* Prevent flex child overflow from compressing the layout */
  font-family:
    'Inter',
    'Noto Sans SC',
    'PingFang SC',
    'Microsoft YaHei UI',
    sans-serif;
}

.ew-grid {
  display: grid;
  gap: 0.85rem;
}

.ew-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ew-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.8rem;
}

.ew-summary-card {
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 30%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 10%, rgba(0, 0, 0, 0.2));
  padding: 0.8rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.05);
}

.ew-summary-card h4 {
  margin: 0;
  font-size: 0.77rem;
  font-weight: 500;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 65%, transparent);
  letter-spacing: 0.02em;
}

.ew-summary-card strong {
  font-size: 1.4rem;
  line-height: 1;
  font-weight: 700;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 95%, transparent);
}

.ew-summary-card small {
  font-size: 0.72rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 55%, transparent);
}

.ew-flow-list,
.ew-api-list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  position: relative;
}

.ew-actions-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.ew-btn {
  border-radius: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 45%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 20%, transparent);
  color: var(--SmartThemeBodyColor, #edf2f9);
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.2s ease;
}

.ew-btn:hover,
.ew-btn:focus-visible {
  border-color: var(--ew-accent);
  background: color-mix(in srgb, var(--ew-accent) 25%, transparent);
  color: #fff;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px var(--ew-accent-glow);
  outline: none;
}

.ew-btn--danger {
  border-color: color-mix(in srgb, var(--ew-danger) 45%, transparent);
  background: color-mix(in srgb, var(--ew-danger) 15%, transparent);
  color: color-mix(in srgb, var(--ew-danger) 90%, #fff);
}

.ew-btn--danger:hover,
.ew-btn--danger:focus-visible {
  background: color-mix(in srgb, var(--ew-danger) 80%, transparent);
  border-color: var(--ew-danger);
  color: #fff;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ew-danger) 30%, transparent);
}

.ew-hidden-file-input {
  display: none;
}

.ew-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}

.ew-switch__track {
  width: 2.8rem;
  height: 1.6rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 15%, transparent);
  background: rgba(0, 0, 0, 0.3);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.25);
  display: inline-flex;
  align-items: center;
  padding: 0.15rem;
  transition: all 0.3s ease;
}

.ew-switch__track[data-enabled='1'] {
  border-color: color-mix(in srgb, var(--ew-success) 45%, transparent);
  background: color-mix(in srgb, var(--ew-success) 35%, rgba(7, 10, 15, 0.4));
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.2);
}

.ew-switch__thumb {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--SmartThemeBodyColor, #eef3f9) 95%, transparent);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  transform: translateX(0);
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.3s ease;
}

.ew-switch__track[data-enabled='1'] .ew-switch__thumb {
  transform: translateX(1.15rem);
  background: #ffffff;
}

.ew-switch__text {
  font-size: 0.82rem;
  font-weight: 500;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 85%, transparent);
  transition: color 0.2s ease;
}

.ew-switch:hover .ew-switch__track,
.ew-switch:focus-visible .ew-switch__track {
  background: rgba(0, 0, 0, 0.4);
}

.ew-switch:focus-visible {
  outline: none;
}

.ew-debug-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}

.ew-pre-box {
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 30%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 8%, rgba(0, 0, 0, 0.25));
  padding: 0.8rem;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.2);
}

.ew-pre-box strong {
  font-size: 0.82rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 90%, transparent);
}

.ew-pre-box pre {
  margin: 0.55rem 0 0;
  max-height: 18rem;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.75rem;
  line-height: 1.5;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 75%, transparent);
  font-family: 'Fira Code', 'Consolas', monospace;
}
.ew-pre-box pre::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.ew-pre-box pre::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 40%, transparent);
  border-radius: 4px;
}

/* --- Global List Transition Animations --- */
.ew-list-move,
.ew-list-enter-active,
.ew-list-leave-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ew-list-enter-from {
  opacity: 0;
  transform: translateY(15px) scale(0.98);
}

.ew-list-leave-to {
  opacity: 0;
  transform: translateY(-15px) scale(0.98);
}

.ew-list-leave-active {
  position: absolute;
  width: 100%; /* Prevent container collapse during leave animation */
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
  .ew-btn,
  .ew-switch__track,
  .ew-switch__thumb,
  .ew-list-move,
  .ew-list-enter-active,
  .ew-list-leave-active {
    transition: none;
  }
}

/* --- Moon Phase Theme --- */
/* Override the base theme variables that ALL components read via color-mix() */
:deep(.theme-moon-phase) .ew-panel {
  /* 月夜冷蓝色调替换默认灰蓝 */
  --SmartThemeQuoteColor: #4a6fa5;
  --SmartThemeBodyColor: #e0e8f5;
  /* 月相紫色强调 */
  --ew-accent: #a78bfa;
  --ew-accent-hover: #c4b5fd;
  --ew-accent-glow: rgba(167, 139, 250, 0.4);
  --ew-success: #38bdf8;
  --ew-danger: #fb7185;

  /* 更深的面板背景 */
  background:
    radial-gradient(ellipse at 15% 5%, rgba(99, 102, 241, 0.08), transparent 50%),
    radial-gradient(ellipse at 85% 95%, rgba(56, 189, 248, 0.06), transparent 50%),
    color-mix(in srgb, #1e293b 25%, rgba(8, 12, 22, 0.88));
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.6),
    0 0 80px rgba(99, 102, 241, 0.06),
    inset 0 1px 1px rgba(148, 163, 184, 0.1);
}

/* 遮罩层月夜色调 */
:deep(.theme-moon-phase).ew-overlay {
  background:
    radial-gradient(circle at 10% 0%, rgba(99, 102, 241, 0.1), transparent 45%),
    radial-gradient(circle at 90% 100%, rgba(56, 189, 248, 0.08), transparent 40%),
    rgba(2, 6, 15, 0.72);
}

/* 头部渐变月色 */
:deep(.theme-moon-phase) .ew-panel__header {
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #334155 30%, rgba(8, 12, 22, 0.85)),
    color-mix(in srgb, #1e293b 20%, rgba(8, 12, 22, 0.8))
  );
  border-bottom-color: rgba(99, 102, 241, 0.2);
}

/* 标题月光渐变 */
:deep(.theme-moon-phase) .ew-panel__title {
  background: linear-gradient(135deg, #f1f5f9 0%, #c4b5fd 60%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* 标签栏月色 */
:deep(.theme-moon-phase) .ew-panel__tabs {
  background: color-mix(in srgb, #1e293b 18%, rgba(6, 10, 18, 0.6));
  border-bottom-color: rgba(99, 102, 241, 0.15);
}

/* 已激活标签月光紫 */
:deep(.theme-moon-phase) .ew-panel__tab[data-active='1'] {
  border-color: #818cf8;
  background: rgba(99, 102, 241, 0.2);
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);
}

/* 月晕呼吸特效 */
@keyframes ew-halo-breath {
  0%, 100% { opacity: 0.15; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(1.01); }
}

/* Section Card 月光底色 */
:deep(.theme-moon-phase) .ew-section-card {
  position: relative;
  overflow: hidden;
}
:deep(.theme-moon-phase) .ew-section-card::after {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.07) 0%, transparent 50%);
  animation: ew-halo-breath 10s ease-in-out infinite;
  pointer-events: none;
  z-index: 0;
}

/* Switch 月光紫 */
:deep(.theme-moon-phase) .ew-switch__track[data-enabled='1'] {
  border-color: rgba(129, 140, 248, 0.5);
  background: rgba(99, 102, 241, 0.3);
}

</style>

