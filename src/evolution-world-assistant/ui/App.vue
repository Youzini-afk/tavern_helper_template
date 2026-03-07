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
      <button
        type="button"
        class="ew-moon-toggle"
        role="switch"
        :aria-checked="store.settings.theme_moon ? 'true' : 'false'"
        :title="store.settings.theme_moon ? '关闭月相主题' : '开启月相主题'"
        @click="store.settings.theme_moon = !store.settings.theme_moon"
      >
        <span class="ew-moon-toggle__moon" :class="{ 'is-full': store.settings.theme_moon }">
          <span class="ew-moon-toggle__shadow" />
        </span>
      </button>
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
    toastr.error(`导入失败: ${message}`, 'Evolution World');
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

/* Moon toggle: CSS crescent → full moon animation */
.ew-moon-toggle {
  display: inline-flex;
  align-items: center;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}

.ew-moon-toggle__moon {
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  box-shadow: 0 0 6px rgba(251, 191, 36, 0.3);
  overflow: hidden;
  transition: box-shadow 0.6s ease, background 0.6s ease;
}

/* Shadow overlay creates the crescent shape */
.ew-moon-toggle__shadow {
  position: absolute;
  top: -2px;
  left: 6px;
  width: 22px;
  height: 28px;
  border-radius: 50%;
  background: #161e2e;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.6s ease;
}

/* Full moon: shadow slides away + glow intensifies */
.ew-moon-toggle__moon.is-full {
  background: linear-gradient(135deg, #fde68a, #fbbf24);
  box-shadow:
    0 0 10px rgba(251, 191, 36, 0.5),
    0 0 24px rgba(251, 191, 36, 0.25);
}

.ew-moon-toggle__moon.is-full .ew-moon-toggle__shadow {
  transform: translateX(22px);
  opacity: 0;
}

/* Hover glow */
.ew-moon-toggle:hover .ew-moon-toggle__moon {
  box-shadow:
    0 0 12px rgba(251, 191, 36, 0.5),
    0 0 30px rgba(251, 191, 36, 0.2);
}

</style>

<!-- Moon Phase theme: MUST be unscoped so selectors can cross component boundaries -->
<style>
/* ═══════════════════════════════════════════════════════════════════
   Moon Phase Theme (unscoped) — Deep Starry Night Aesthetic
   ═══════════════════════════════════════════════════════════════════ */

/* ── Phase 0: CSS Variables & Global Transition ── */
/* 只给需要平滑过渡的关键组件加 transition，避免 input/button/toggle 被影响 */
.ew-panel,
.ew-overlay,
.ew-panel__header,
.ew-panel__tabs,
.ew-panel__tab,
.ew-panel__body,
.ew-section-card,
.ew-section-card__title,
.ew-summary-card,
.ew-flow-card,
.ew-api-card {
  transition: background 0.8s cubic-bezier(0.4, 0, 0.2, 1),
              border-color 0.8s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.8s cubic-bezier(0.4, 0, 0.2, 1),
              color 0.8s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.theme-moon-phase .ew-panel {
  --SmartThemeQuoteColor: #64748b;
  --SmartThemeBodyColor: #e2e8f0;
  --ew-accent: #fbbf24;
  --ew-accent-hover: #fcd34d;
  --ew-accent-glow: rgba(251, 191, 36, 0.35);
  --ew-success: #34d399;
  --ew-danger: #f87171;
  border-color: rgba(148, 163, 184, 0.25) !important;
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.7),
    0 4px 24px rgba(251, 191, 36, 0.1),
    inset 0 1px 0 rgba(148, 163, 184, 0.1) !important;
}

/* ── Phase 0.5: 星空揭晓动画 (Clip-path Reveal) ── */
/* 将星场大背景放到一个底层伪元素上，默认隐藏 (clip-path从左向右压缩到了最左侧边缘) */
.ew-panel::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: -2; /* 确保在最最底层，不遮挡任何内容和 section-card 背景 */
  pointer-events: none;
  border-radius: inherit;
  /* 默认星空完全隐藏 (裁切在最左侧边缘宽度为0) */
  clip-path: inset(0 100% 0 0);
  transition: clip-path 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  background:
    /* 密集繁星 — 每层不同 tile 尺寸避免网格感，大量平铺 */
    radial-gradient(1px 1px at 12% 15%, rgba(251, 191, 36, 0.45) 50%, transparent),
    radial-gradient(1px 1px at 60% 70%, rgba(203, 213, 225, 0.4) 50%, transparent),
    radial-gradient(1.2px 1.2px at 35% 40%, rgba(251, 191, 36, 0.35) 50%, transparent),
    radial-gradient(1px 1px at 80% 25%, rgba(203, 213, 225, 0.45) 50%, transparent),
    radial-gradient(1px 1px at 20% 80%, rgba(251, 191, 36, 0.3) 50%, transparent),
    radial-gradient(1.5px 1.5px at 55% 50%, rgba(253, 224, 71, 0.35) 50%, transparent),
    radial-gradient(1px 1px at 90% 60%, rgba(203, 213, 225, 0.35) 50%, transparent),
    radial-gradient(1px 1px at 45% 90%, rgba(251, 191, 36, 0.3) 50%, transparent),
    radial-gradient(1.2px 1.2px at 70% 15%, rgba(203, 213, 225, 0.4) 50%, transparent),
    radial-gradient(1px 1px at 5% 55%, rgba(251, 191, 36, 0.25) 50%, transparent),
    /* 底层深空渐变 */
    linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%) !important;
  background-size:
    97px 103px, 130px 141px, 167px 179px, 113px 127px, 89px 97px,
    199px 211px, 151px 163px, 109px 119px, 181px 191px, 139px 149px,
    100% 100% !important;
}

/* 激活月相主题时，让星空从左到右滑出 (clip-path展开全屏) */
.theme-moon-phase .ew-panel::before {
  clip-path: inset(0 0 0 0);
}

/* 遮罩层夜空色调 */
.theme-moon-phase.ew-overlay {
  background:
    radial-gradient(circle at 20% 10%, rgba(251, 191, 36, 0.08), transparent 45%),
    rgba(2, 6, 15, 0.78) !important;
}

/* 头部背景融入夜色 */
.theme-moon-phase .ew-panel__header {
  background: color-mix(in srgb, #0f172a 40%, rgba(15, 23, 42, 0.85)) !important;
  border-bottom-color: rgba(148, 163, 184, 0.2) !important;
}

/* ── Phase 2: SVG 新月图标注入标题 ── */
.theme-moon-phase .ew-panel__title {
  background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 50%, #94a3b8 100%) !important;
  -webkit-background-clip: text !important;
  background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  position: relative;
  padding-left: 28px !important;
}
.theme-moon-phase .ew-panel__title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  /* 精绘 SVG 新月 — 纯矢量弯月含内弧 */
  background-color: #fbbf24;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  filter: drop-shadow(0 0 6px rgba(251, 191, 36, 0.8));
  animation: ew-moon-rise 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both,
             ew-icon-glow 4s ease-in-out 0.9s infinite;
}

/* ── Phase 2: SVG 星盘图标注入 Section Card 标题 ── */
.theme-moon-phase .ew-section-card__title {
  color: #f8fafc !important;
  position: relative;
  padding-left: 24px !important;
}
.theme-moon-phase .ew-section-card__title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  /* 精绘 SVG 星盘/罗盘 — 填充型五角星 + 圆环 */
  background-color: #94a3b8;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z'/%3E%3Cpath d='M12 5.5l1.76 3.56 3.93.57-2.84 2.77.67 3.91L12 14.47l-3.52 1.84.67-3.91-2.84-2.77 3.93-.57z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z'/%3E%3Cpath d='M12 5.5l1.76 3.56 3.93.57-2.84 2.77.67 3.91L12 14.47l-3.52 1.84.67-3.91-2.84-2.77 3.93-.57z'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  filter: drop-shadow(0 0 4px rgba(148, 163, 184, 0.6));
  animation: ew-compass-spin-in 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) 0.5s both,
             ew-icon-glow-silver 6s ease-in-out 1.2s infinite;
}

/* ── Phase 2: SVG 卷轴图标注入 Flow/API Card 标题 ── */
.theme-moon-phase .ew-flow-card__title,
.theme-moon-phase .ew-api-card__title {
  position: relative;
  padding-left: 22px !important;
}
.theme-moon-phase .ew-flow-card__title::before,
.theme-moon-phase .ew-api-card__title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  /* 精绘 SVG 卷轴/文件 — 填充型科幻风 */
  background-color: #fbbf24;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.6));
  opacity: 0.8;
  animation: ew-scroll-unroll 0.5s cubic-bezier(0.5, 2, 0.5, 1) 0.6s both;
}

/* 标签栏 */
.theme-moon-phase .ew-panel__tabs {
  background: rgba(15, 23, 42, 0.6) !important;
  border-bottom-color: rgba(148, 163, 184, 0.15) !important;
}

/* ── Phase 3: 激活标签 + 流光扫光效果 ── */
.theme-moon-phase .ew-panel__tab[data-active='1'] {
  border-color: rgba(148, 163, 184, 0.5) !important;
  background: rgba(251, 191, 36, 0.12) !important;
  color: #f8fafc !important;
  box-shadow: 0 4px 16px rgba(251, 191, 36, 0.15) !important;
  position: relative;
  overflow: hidden;
}
.theme-moon-phase .ew-panel__tab[data-active='1']::after {
  content: "";
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(253, 224, 71, 0.08) 30%,
    rgba(251, 191, 36, 0.15) 50%,
    rgba(253, 224, 71, 0.08) 70%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: ew-starlight-sweep 3s ease-in-out infinite;
  pointer-events: none;
}
.theme-moon-phase .ew-panel__tab:hover:not([data-active='1']) {
  background: rgba(251, 191, 36, 0.05) !important;
  color: #e2e8f0 !important;
}

/* ═══════════════════════════════════════════════════════════════════
   Phase 1: 高精度繁星背景 + 精细闪烁动画
   ═══════════════════════════════════════════════════════════════════ */

@keyframes ew-stars-twinkle {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.85; }
}

@keyframes ew-nebula-pulse {
  0%, 100% { opacity: 0.08; transform: scale(1); }
  50% { opacity: 0.18; transform: scale(1.03); }
}

/* Section Card: 深空底色 + 高密度像素级星场 */
.theme-moon-phase .ew-section-card {
  overflow: hidden;
  border-color: rgba(148, 163, 184, 0.15) !important;
}

/* 底层：密集 1px 像素星场 (4 层径向渐变) */
.theme-moon-phase .ew-section-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-image:
    radial-gradient(1px 1px at 15% 25%, rgba(251, 191, 36, 0.4) 50%, transparent),
    radial-gradient(1px 1px at 72% 55%, rgba(203, 213, 225, 0.35) 50%, transparent),
    radial-gradient(1px 1px at 42% 78%, rgba(251, 191, 36, 0.3) 50%, transparent),
    radial-gradient(1px 1px at 88% 18%, rgba(203, 213, 225, 0.35) 50%, transparent),
    radial-gradient(1.2px 1.2px at 30% 50%, rgba(251, 191, 36, 0.25) 50%, transparent),
    radial-gradient(1px 1px at 60% 35%, rgba(203, 213, 225, 0.3) 50%, transparent);
  background-size: 83px 89px, 127px 137px, 109px 113px, 97px 101px, 149px 157px, 71px 79px;
  animation: ew-stars-twinkle 2.5s ease-in-out infinite;
  pointer-events: none;
  z-index: -1;
}

/* 中层：柔和星云弥散 (呼吸光晕) */
.theme-moon-phase .ew-section-card::after {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background:
    radial-gradient(ellipse at 25% 40%, rgba(251, 191, 36, 0.06) 0%, transparent 55%),
    radial-gradient(ellipse at 75% 60%, rgba(123, 164, 235, 0.04) 0%, transparent 55%);
  animation: ew-nebula-pulse 8s ease-in-out infinite;
  pointer-events: none;
  z-index: -1;
}

/* ═══════════════════════════════════════════════════════════════════
   Phase 2: 图标发光动画 (SVG Icons)
   ═══════════════════════════════════════════════════════════════════ */

@keyframes ew-icon-glow {
  0%, 100% {
    filter: drop-shadow(0 0 6px rgba(251, 191, 36, 0.8));
    transform: translateY(-50%) scale(1);
  }
  50% {
    filter: drop-shadow(0 0 12px rgba(251, 191, 36, 1));
    transform: translateY(-50%) scale(1.08);
  }
}

@keyframes ew-icon-glow-silver {
  0%, 100% {
    filter: drop-shadow(0 0 4px rgba(148, 163, 184, 0.6));
    transform: translateY(-50%) scale(1);
  }
  50% {
    filter: drop-shadow(0 0 8px rgba(148, 163, 184, 0.9));
    transform: translateY(-50%) scale(1.05);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Phase 2.5: 装饰元素入场动画 (Entrance Micro-Animations)
   ═══════════════════════════════════════════════════════════════════ */

/* 🌙 新月：破晓升起 — 从下方浮现 + 旋转 + 发光渐入 */
@keyframes ew-moon-rise {
  0% {
    opacity: 0;
    transform: translateY(calc(-50% + 12px)) rotate(-20deg) scale(0.4);
    filter: drop-shadow(0 0 0 transparent);
  }
  60% {
    opacity: 1;
    transform: translateY(calc(-50% - 2px)) rotate(3deg) scale(1.1);
    filter: drop-shadow(0 0 10px rgba(251, 191, 36, 1));
  }
  100% {
    opacity: 1;
    transform: translateY(-50%) rotate(0deg) scale(1);
    filter: drop-shadow(0 0 6px rgba(251, 191, 36, 0.8));
  }
}

/* ⭐ 星盘：魔法阵成型 — 从极小旋转放大展开 */
@keyframes ew-compass-spin-in {
  0% {
    opacity: 0;
    transform: translateY(-50%) scale(0) rotate(-180deg);
    filter: drop-shadow(0 0 0 transparent);
  }
  70% {
    opacity: 1;
    transform: translateY(-50%) scale(1.15) rotate(10deg);
    filter: drop-shadow(0 0 10px rgba(148, 163, 184, 1));
  }
  100% {
    opacity: 1;
    transform: translateY(-50%) scale(1) rotate(0deg);
    filter: drop-shadow(0 0 4px rgba(148, 163, 184, 0.6));
  }
}

/* 📄 卷轴：画轴展开 — Y 轴从压扁到弹出 */
@keyframes ew-scroll-unroll {
  0% {
    opacity: 0;
    transform: translateY(-50%) scaleY(0) scaleX(0.8);
    filter: drop-shadow(0 0 0 transparent);
  }
  50% {
    opacity: 1;
    transform: translateY(-50%) scaleY(1.2) scaleX(1.05);
    filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.9));
  }
  100% {
    opacity: 0.8;
    transform: translateY(-50%) scaleY(1) scaleX(1);
    filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.6));
  }
}

/* ✅❌ Toast 图标：灵光爆现 — 放大闪烁后缩回 */
@keyframes ew-toast-pop {
  0% {
    opacity: 0;
    transform: translateY(-50%) scale(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-50%) scale(1.4);
  }
  100% {
    opacity: 1;
    transform: translateY(-50%) scale(1);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Phase 3: 探照灯 + 流光动画
   ═══════════════════════════════════════════════════════════════════ */

@keyframes ew-starlight-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}

@keyframes ew-spotlight-flicker {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.6; }
}

/* 面板 Body 底层探照灯柔光 */
.theme-moon-phase .ew-panel__body {
  position: relative;
}
.theme-moon-phase .ew-panel__body::before {
  content: "";
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: radial-gradient(
    ellipse at 50% 20%,
    rgba(251, 191, 36, 0.06) 0%,
    rgba(123, 164, 235, 0.03) 30%,
    transparent 65%
  );
  animation: ew-spotlight-flicker 6s ease-in-out infinite;
  pointer-events: none;
  z-index: -1;
}

/* ═══════════════════════════════════════════════════════════════════
   Preserved base styles: switches, buttons, inputs, etc.
   ═══════════════════════════════════════════════════════════════════ */

.theme-moon-phase .ew-switch__track[data-enabled='1'] {
  border-color: rgba(251, 191, 36, 0.5) !important;
  background: rgba(251, 191, 36, 0.25) !important;
}

.theme-moon-phase .ew-panel__status[data-enabled='1'] {
  border-color: rgba(52, 211, 153, 0.4) !important;
  background: rgba(52, 211, 153, 0.15) !important;
  box-shadow: 0 0 12px rgba(52, 211, 153, 0.15) !important;
}

.theme-moon-phase .ew-btn--primary {
  background: var(--ew-accent) !important;
  color: #451a03 !important;
  border-color: var(--ew-accent) !important;
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.3) !important;
}

.theme-moon-phase .ew-btn--danger {
  background: rgba(220, 38, 38, 0.15) !important;
  border: 1px solid rgba(239, 68, 68, 0.3) !important;
  color: #fca5a5 !important;
  box-shadow: none !important;
}
.theme-moon-phase .ew-btn--danger:hover {
  background: rgba(220, 38, 38, 0.25) !important;
  border-color: rgba(239, 68, 68, 0.5) !important;
  box-shadow: 0 0 12px rgba(220, 38, 38, 0.15) !important;
}

.theme-moon-phase .ew-btn {
  border-color: rgba(148, 163, 184, 0.3) !important;
}
.theme-moon-phase .ew-btn:hover {
  background: rgba(251, 191, 36, 0.08) !important;
  border-color: rgba(251, 191, 36, 0.4) !important;
}

.theme-moon-phase input,
.theme-moon-phase select,
.theme-moon-phase textarea {
  background: rgba(15, 23, 42, 0.6) !important;
  border-color: rgba(148, 163, 184, 0.2) !important;
  color: #e2e8f0 !important;
}
.theme-moon-phase input:focus,
.theme-moon-phase select:focus,
.theme-moon-phase textarea:focus {
  border-color: rgba(251, 191, 36, 0.5) !important;
  box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.15) !important;
}

.theme-moon-phase .ew-summary-card {
  background: rgba(15, 23, 42, 0.4) !important;
  border-color: rgba(148, 163, 184, 0.15) !important;
}
.theme-moon-phase .ew-summary-card strong {
  color: #fbbf24 !important;
}

/* ── Phase 2: 卡片展开时的三层悬浮阴影 ── */
.theme-moon-phase .ew-flow-card,
.theme-moon-phase .ew-api-card {
  border-color: rgba(148, 163, 184, 0.2) !important;
  background: rgba(15, 23, 42, 0.35) !important;
}
.theme-moon-phase .ew-flow-card:hover,
.theme-moon-phase .ew-api-card:hover {
  border-color: rgba(251, 191, 36, 0.3) !important;
  box-shadow:
    0 4px 20px rgba(251, 191, 36, 0.12),
    inset 0 1px 0 rgba(148, 163, 184, 0.08) !important;
}

/* 展开态：三重浮雕阴影爆发 (对齐正则美化选项卡效果) */
.theme-moon-phase .ew-flow-card[data-expanded='1'],
.theme-moon-phase .ew-api-card[data-expanded='1'] {
  border-color: rgba(251, 191, 36, 0.4) !important;
  box-shadow:
    0 8px 40px rgba(251, 191, 36, 0.2),
    0 0 40px rgba(251, 191, 36, 0.08),
    inset 0 1px 0 rgba(251, 191, 36, 0.15) !important;
}

/* Scrollbar */
.theme-moon-phase .ew-panel__body::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.3) !important;
}
.theme-moon-phase .ew-panel__body::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.5) !important;
}

/* ═══════════════════════════════════════════════════════════════════
   Phase 4: Toastr Notification Styling (Moon Phase Integration)
   ═══════════════════════════════════════════════════════════════════ */

/* Require the app root to be in the theme for this to safely trigger,
   or just hook into #toast-container directly if it's placed outside.
   Assuming #toast-container is global, we force deep starry aesthetic
   when Moon Phase theme is active anywhere. */
body:has(.theme-moon-phase) #toast-container > div {
  background:
    /* 微型星点 — 让提示框也有星空感 */
    radial-gradient(1px 1px at 15% 20%, rgba(251, 191, 36, 0.4) 50%, transparent),
    radial-gradient(1px 1px at 65% 40%, rgba(203, 213, 225, 0.3) 50%, transparent),
    radial-gradient(1px 1px at 85% 75%, rgba(251, 191, 36, 0.3) 50%, transparent),
    radial-gradient(1px 1px at 35% 85%, rgba(203, 213, 225, 0.25) 50%, transparent),
    /* 底色 */
    linear-gradient(135deg, rgba(15, 23, 42, 0.97) 0%, rgba(30, 41, 59, 0.95) 100%) !important;
  background-size: 67px 71px, 97px 103px, 83px 89px, 113px 119px, 100% 100% !important;
  border: 1px solid rgba(148, 163, 184, 0.25) !important;
  border-top: 2px solid rgba(251, 191, 36, 0.5) !important;
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.8),
    0 0 20px rgba(251, 191, 36, 0.08),
    inset 0 1px 0 rgba(251, 191, 36, 0.15) !important;
  border-radius: 12px !important;
  color: #f8fafc !important;
  backdrop-filter: blur(16px) !important;
  padding: 16px 16px 16px 50px !important;
  background-image: none !important; /* override in specific toast types below */
}

/* Toast title (toastr renders a .toast-title element) */
body:has(.theme-moon-phase) #toast-container .toast-title {
  color: #fbbf24 !important;
  font-weight: 600 !important;
  text-shadow: 0 0 8px rgba(251, 191, 36, 0.3) !important;
}
body:has(.theme-moon-phase) #toast-container .toast-message {
  color: #cbd5e1 !important;
}

/* Success Toast */
body:has(.theme-moon-phase) #toast-container > .toast-success {
  border-left: 4px solid #34d399 !important;
  box-shadow: 0 0 20px rgba(52, 211, 153, 0.15), inset 0 1px 0 rgba(251, 191, 36, 0.15) !important;
}
body:has(.theme-moon-phase) #toast-container > .toast-success::before {
  content: "";
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  background-color: #34d399;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 11.08V12a10 10 0 1 1-5.93-9.14'/%3E%3Cpolyline points='22 4 12 14.01 9 11.01'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 11.08V12a10 10 0 1 1-5.93-9.14'/%3E%3Cpolyline points='22 4 12 14.01 9 11.01'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  filter: drop-shadow(0 0 8px rgba(52, 211, 153, 0.8));
  animation: ew-toast-pop 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both,
             ew-icon-glow 3s ease-in-out 0.4s infinite;
}

/* Error Toast */
body:has(.theme-moon-phase) #toast-container > .toast-error {
  border-left: 4px solid #f87171 !important;
  box-shadow: 0 0 20px rgba(248, 113, 113, 0.15), inset 0 1px 0 rgba(251, 191, 36, 0.15) !important;
}
body:has(.theme-moon-phase) #toast-container > .toast-error::before {
  content: "";
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  background-color: #f87171;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='8' x2='12' y2='12'/%3E%3Cline x1='12' y1='16' x2='12.01' y2='16'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='8' x2='12' y2='12'/%3E%3Cline x1='12' y1='16' x2='12.01' y2='16'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  filter: drop-shadow(0 0 8px rgba(248, 113, 113, 0.8));
  animation: ew-toast-pop 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both,
             ew-icon-glow 3s ease-in-out 0.4s infinite;
}

/* Info/Warning overrides for completeness */
body:has(.theme-moon-phase) #toast-container > .toast-info {
  border-left: 4px solid #60a5fa !important;
}
body:has(.theme-moon-phase) #toast-container > .toast-warning {
  border-left: 4px solid #fbbf24 !important;
}

body:has(.theme-moon-phase) #toast-container > div:hover {
  box-shadow:
    0 15px 50px rgba(0, 0, 0, 0.9),
    0 0 30px rgba(251, 191, 36, 0.15),
    inset 0 1px 0 rgba(251, 191, 36, 0.25) !important;
}

</style>
