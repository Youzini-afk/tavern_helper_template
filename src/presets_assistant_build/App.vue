<template>
  <div class="preset-root">
    <header class="top">
      <div class="brand">
        <h1>Preset Assistant</h1>
        <p>浏览优先 · 双模式重构 · 连接配置粘性可控</p>
      </div>
      <div class="top-actions">
        <button class="btn" type="button" @click="refreshAll">刷新</button>
        <button class="btn primary" type="button" :disabled="switching || !selectedPresetName" @click="switchSelectedPreset">
          {{ switching ? '切换中...' : '切换为当前预设' }}
        </button>
      </div>
    </header>

    <section class="mode-bar">
      <button class="mode-btn" :class="{ active: uiMode === 'browse' }" type="button" @click="setMode('browse')">浏览模式</button>
      <button class="mode-btn" :class="{ active: uiMode === 'edit' }" type="button" @click="setMode('edit')">编辑模式</button>
    </section>

    <section class="control-grid">
      <label class="field">
        <span>预设</span>
        <select :value="selectedPresetName" class="input" @change="onPresetSelect($event)">
          <option value="" disabled>请选择预设</option>
          <option v-for="name in presetNames" :key="name" :value="name">
            {{ name }}
          </option>
        </select>
      </label>

      <label class="field">
        <span>连接策略</span>
        <select :value="apiBindingMode" class="input" @change="onBindingModeChange($event)">
          <option value="sticky_connection">sticky_connection（默认）</option>
          <option value="follow_preset">follow_preset</option>
        </select>
      </label>

      <label v-if="uiMode === 'edit'" class="field">
        <span>编辑提交</span>
        <select :value="editApplyMode" class="input" @change="onEditApplyModeChange($event)">
          <option value="live">实时</option>
          <option value="draft">草稿</option>
        </select>
      </label>

      <div class="status">
        <span>已加载：{{ loadedPresetName || '-' }}</span>
        <span>当前查看：{{ selectedPresetName || '-' }}</span>
        <span class="saving" :class="{ on: browseListState.saving }">
          {{ browseListState.saving ? '自动保存中...' : '自动保存空闲' }}
        </span>
      </div>
    </section>

    <main class="main">
      <section v-if="uiMode === 'browse'" class="browse-mode">
        <div class="browse-settings-shell">
          <BrowseSettingsPanel
            :open="browseParamPanelOpen"
            :expanded-group="browseParamExpandedGroup"
            :base-settings="browseParamDraft.base_settings"
            :staged-settings="browseParamDraft.staged_settings"
            :dirty="browseParamDraft.dirty"
            :applying="browseParamDraft.applying"
            @toggle-open="setBrowsePanelOpen"
            @set-expanded-group="setBrowseExpandedGroup"
            @update-setting="store.setBrowseStagedSetting"
            @apply="store.applyBrowseSettingsToPreset"
            @reset="store.resetBrowseSettingsDraft"
          />
        </div>

        <div class="browse-prompts-shell">
          <PromptQuickToggleList
            :items="filteredBrowsePromptItems"
            :query="browseListState.query"
            :selected-count="selectedBrowsePromptIndices.length"
            :selected-indices="selectedBrowsePromptIndices"
            :visible-indices="browseVisiblePromptIndices"
            :all-visible-selected="allVisibleSelected"
            :saving="browseListState.saving"
            :last-saved-at="browseListState.last_saved_at"
            :disabled="loadingPreset || switching"
            @update-query="store.setBrowsePromptQuery"
            @toggle="store.toggleBrowsePromptEnabledAndAutoSave"
            @select="store.toggleBrowsePromptSelection"
            @select-visible="store.setBrowsePromptSelectionForVisible"
            @clear-selection="store.clearBrowsePromptSelection"
            @reorder="onBrowseReorder"
            @batch-set-enabled="onBatchSetEnabled"
          />
        </div>
      </section>

      <EditModeShell
        v-else
        :draft-preset="editDraft"
        :dirty="editDraftDirty"
        :apply-mode="editApplyMode"
        :selected-prompt-index="editSelectedPromptIndex"
        :saving="editSaving"
        :prompt-indices="editPromptIndices"
        :prompt-query="editPromptQuery"
        @save="saveEditDraft"
        @discard="store.discardEditDraft"
        @append-prompt="store.appendPromptToEditDraft"
        @remove-prompt="store.removePromptFromEditDraft"
        @move-prompt="store.movePromptInEditDraft"
        @set-selected-prompt-index="setSelectedPromptIndex"
        @update-apply-mode="store.setEditApplyMode"
        @update-prompt-query="store.setEditPromptQuery"
        @update-draft="store.updateEditDraft"
      />
    </main>

    <UnsavedGuardDialog
      :visible="unsavedDialogVisible"
      :reason="unsavedDialogReason"
      @save="store.resolveUnsavedDecision('save')"
      @discard="store.resolveUnsavedDecision('discard')"
      @cancel="store.resolveUnsavedDecision('cancel')"
    />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, watch } from 'vue';

import BrowseSettingsPanel from './components/BrowseSettingsPanel.vue';
import EditModeShell from './components/EditModeShell.vue';
import PromptQuickToggleList from './components/PromptQuickToggleList.vue';
import UnsavedGuardDialog from './components/UnsavedGuardDialog.vue';
import type { ApiBindingMode, EditApplyMode, UiMode } from './types';
import { usePresetAssistantStore } from './store/presetAssistantStore';

const DIRTY_STATE_KEY = '__PRESET_ASSISTANT_HAS_UNSAVED_CHANGES__';

const store = usePresetAssistantStore();
const {
  presetNames,
  selectedPresetName,
  loadedPresetName,
  loadingPreset,
  uiMode,
  apiBindingMode,
  editApplyMode,
  browseParamPanelOpen,
  browseParamExpandedGroup,
  browseParamDraft,
  browseListState,
  filteredBrowsePromptItems,
  browseVisiblePromptIndices,
  selectedBrowsePromptIndices,
  editDraft,
  editDraftDirty,
  editSelectedPromptIndex,
  editPromptQuery,
  editPromptIndices,
  editSaving,
  unsavedDialogVisible,
  unsavedDialogReason,
  hasUnsavedChanges,
} = storeToRefs(store);

const switching = computed(() => loadingPreset.value || browseListState.value.saving);

const allVisibleSelected = computed(() => {
  if (browseVisiblePromptIndices.value.length < 1) {
    return false;
  }
  const selected = new Set(selectedBrowsePromptIndices.value);
  return browseVisiblePromptIndices.value.every(index => selected.has(index));
});

function syncDirtyFlag(value: boolean): void {
  const current = window as unknown as Record<string, unknown>;
  const host = (window.parent || window) as unknown as Record<string, unknown>;
  current[DIRTY_STATE_KEY] = value;
  host[DIRTY_STATE_KEY] = value;
}

function onPresetSelect(event: Event): void {
  const target = event.target as HTMLSelectElement;
  void store.selectPreset(target.value);
}

function onBindingModeChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const next: ApiBindingMode = target.value === 'follow_preset' ? 'follow_preset' : 'sticky_connection';
  apiBindingMode.value = next;
}

function onEditApplyModeChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const next: EditApplyMode = target.value === 'draft' ? 'draft' : 'live';
  editApplyMode.value = next;
}

function setMode(mode: UiMode): void {
  store.setUiMode(mode);
}

function setSelectedPromptIndex(index: number): void {
  editSelectedPromptIndex.value = index;
}

function setBrowsePanelOpen(next: boolean): void {
  browseParamPanelOpen.value = next;
}

function setBrowseExpandedGroup(groupId: string): void {
  browseParamExpandedGroup.value = groupId;
}

function onBrowseReorder(fromIndex: number, toIndex: number): void {
  if (toIndex < 0) {
    return;
  }
  void store.reorderBrowsePromptAndAutoSave(fromIndex, toIndex);
}

function onBatchSetEnabled(indices: number[], enabled: boolean): void {
  void store.batchSetBrowsePromptEnabledAndAutoSave(indices, enabled);
}

async function switchSelectedPreset(): Promise<void> {
  if (!selectedPresetName.value) {
    return;
  }
  await store.switchPresetWithConnectionPolicy(selectedPresetName.value);
}

async function saveEditDraft(): Promise<void> {
  await store.saveEditDraftToPreset();
}

async function refreshAll(): Promise<void> {
  await store.refreshFromHost();
}

async function onPanelRefresh(): Promise<void> {
  await refreshAll();
}

async function onPanelSave(): Promise<void> {
  await store.saveAllPendingChanges();
}

function onPanelDiscard(): void {
  store.discardAllPendingChanges();
}

onMounted(() => {
  void store.initialize();
  window.addEventListener('preset-helper:refresh', onPanelRefresh as EventListener);
  window.addEventListener('preset-helper:save', onPanelSave as EventListener);
  window.addEventListener('preset-helper:discard', onPanelDiscard);
});

onUnmounted(() => {
  syncDirtyFlag(false);
  store.teardown();
  window.removeEventListener('preset-helper:refresh', onPanelRefresh as EventListener);
  window.removeEventListener('preset-helper:save', onPanelSave as EventListener);
  window.removeEventListener('preset-helper:discard', onPanelDiscard);
});

watch(
  hasUnsavedChanges,
  value => {
    syncDirtyFlag(value);
  },
  { immediate: true },
);
</script>

<style scoped>
.preset-root {
  --pa-bg-0: #060b16;
  --pa-bg-1: #091225;
  --pa-bg-2: #0f1a31;
  --pa-border: rgba(76, 102, 143, 0.52);
  --pa-border-strong: rgba(98, 128, 176, 0.76);
  --pa-text-1: #eaf2ff;
  --pa-text-2: #bfd2f2;
  --pa-text-3: #8ea9d1;
  --pa-accent: #3d7ef2;
  --pa-success: #30c58a;
  --pa-warning: #f0b545;
  --pa-danger: #e46574;

  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  box-sizing: border-box;
  color: var(--pa-text-1);
  font-size: 13px;
  line-height: 1.45;
  position: relative;
  pointer-events: auto;
  background:
    radial-gradient(circle at 10% 8%, rgba(49, 89, 182, 0.25), transparent 42%),
    radial-gradient(circle at 88% 16%, rgba(18, 96, 164, 0.2), transparent 35%),
    linear-gradient(168deg, var(--pa-bg-0), var(--pa-bg-1) 44%, var(--pa-bg-2));
}

.preset-root :is(button, input, select, textarea, summary, label, a) {
  pointer-events: auto;
}

.top,
.mode-bar,
.control-grid,
.browse-mode,
:deep(.edit-shell) {
  border: 1px solid var(--pa-border);
  border-radius: 14px;
  background: rgba(8, 15, 29, 0.78);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.36);
}

.top {
  padding: 11px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.brand h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.3px;
}

.brand p {
  margin: 4px 0 0;
  color: var(--pa-text-3);
  font-size: 12px;
}

.top-actions {
  display: inline-flex;
  gap: 8px;
}

.mode-bar {
  padding: 6px;
  display: inline-flex;
  gap: 6px;
  width: fit-content;
}

.mode-btn {
  min-height: 34px;
  min-width: 112px;
  border: 1px solid var(--pa-border-strong);
  border-radius: 9px;
  background: rgba(16, 28, 52, 0.8);
  color: var(--pa-text-2);
  cursor: pointer;
}

.mode-btn.active {
  background: linear-gradient(135deg, #285bbf, #2f73df);
  border-color: #3d7ef2;
  color: #ffffff;
}

.control-grid {
  padding: 10px 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(260px, 1.2fr);
  gap: 10px;
  align-items: end;
}

.field {
  display: grid;
  gap: 5px;
}

.field > span {
  color: var(--pa-text-2);
  font-size: 12px;
}

.input {
  min-height: 34px;
  border: 1px solid var(--pa-border-strong);
  border-radius: 9px;
  background: rgba(13, 24, 45, 0.9);
  color: var(--pa-text-1);
  padding: 0 10px;
  width: 100%;
}

.status {
  display: grid;
  gap: 4px;
  justify-items: end;
  color: var(--pa-text-3);
  font-size: 12px;
}

.status .saving.on {
  color: var(--pa-warning);
}

.main {
  min-height: 0;
}

.browse-mode {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}

.browse-settings-shell {
  min-height: 180px;
  overflow: visible;
}

.browse-prompts-shell {
  min-height: 260px;
  overflow: visible;
}

.btn {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--pa-border-strong);
  border-radius: 9px;
  background: rgba(16, 28, 52, 0.8);
  color: var(--pa-text-1);
  cursor: pointer;
}

.btn.primary {
  background: linear-gradient(135deg, #285bbf, #2f73df);
  border-color: #3d7ef2;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 1260px) {
  .control-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .status {
    justify-items: start;
    grid-column: 1 / -1;
  }
}

@media (max-width: 980px) {
  .mode-bar {
    width: 100%;
    justify-content: stretch;
  }

  .mode-btn {
    flex: 1;
  }
}

@media (max-width: 760px) {
  .control-grid {
    grid-template-columns: 1fr;
  }
}
</style>
