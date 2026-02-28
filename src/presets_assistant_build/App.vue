<template>
  <div class="preset-root">
    <header class="top">
      <div class="brand">
        <h1>Preset Assistant</h1>
        <p>浏览优先 · 快速开关词条 · 参数应用提交</p>
      </div>
      <div class="top-actions">
        <button class="btn" type="button" @click="refreshAll">刷新</button>
        <button class="btn primary" type="button" :disabled="switching" @click="switchSelectedPreset">
          {{ switching ? '切换中...' : '切换为当前预设' }}
        </button>
        <button class="btn" type="button" :class="{ active: editMode }" @click="store.setEditMode(!editMode)">
          {{ editMode ? '退出编辑' : '进入编辑' }}
        </button>
      </div>
    </header>

    <section class="controls">
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
          <option value="sticky_connection">连接粘性（默认）</option>
          <option value="follow_preset">原生跟随</option>
        </select>
      </label>
      <label class="field">
        <span>浏览视图</span>
        <select :value="viewMode" class="input" @change="onViewModeChange($event)">
          <option value="cards">卡片</option>
          <option value="list">列表</option>
        </select>
      </label>
      <label class="field">
        <span>编辑提交</span>
        <select :value="editApplyMode" class="input" @change="onEditApplyModeChange($event)">
          <option value="live">实时模式</option>
          <option value="draft">草稿模式</option>
        </select>
      </label>
    </section>

    <section class="filters">
      <input v-model="searchText" class="input" type="text" placeholder="搜索预设名 / 备注..." />
      <input v-model="tagFilterText" class="input" type="text" placeholder="按标签筛选（逗号分隔）" />
      <label class="check">
        <input v-model="favoriteOnly" type="checkbox" />
        <span>仅收藏</span>
      </label>
      <span class="summary">已加载: {{ loadedPresetName || '-' }} ｜ 当前查看: {{ selectedPresetName || '-' }}</span>
    </section>

    <main class="main" :class="{ browsing: !editMode }">
      <EditModeShell
        v-if="editMode"
        :draft-preset="editDraft"
        :dirty="editDraftDirty"
        :apply-mode="editApplyMode"
        :selected-prompt-index="editSelectedPromptIndex"
        :saving="editSaving"
        @save="saveEditDraft"
        @discard="store.discardEditDraft"
        @append-prompt="store.appendPromptToEditDraft"
        @remove-prompt="store.removePromptFromEditDraft"
        @move-prompt="store.movePromptInEditDraft"
        @set-selected-prompt-index="setSelectedPromptIndex"
        @update-apply-mode="setEditApplyMode"
        @update-draft="store.updateEditDraft"
      />

      <template v-else>
        <section class="preset-list">
          <PresetCardGrid
            v-if="viewMode === 'cards'"
            :presets="filteredSummaries"
            @select="store.selectPreset"
            @switch="switchPresetByName"
            @toggle-favorite="store.setMetaFavorite"
          />
          <PresetListTable
            v-else
            :presets="filteredSummaries"
            @select="store.selectPreset"
            @switch="switchPresetByName"
            @toggle-favorite="store.setMetaFavorite"
          />
        </section>

        <section v-if="selectedPreset" class="detail">
          <div class="detail-head">
            <div>
              <h2>{{ selectedPresetName }}</h2>
              <p>
                {{ selectedPreset.prompts.length }} 条词条
                <span class="state" :class="{ loaded: selectedPresetName === loadedPresetName }">
                  {{ selectedPresetName === loadedPresetName ? '当前生效' : '未生效' }}
                </span>
              </p>
            </div>
            <button
              class="star"
              type="button"
              :title="selectedMeta.favorite ? '取消收藏' : '收藏'"
              @click="store.setMetaFavorite(selectedPresetName, !selectedMeta.favorite)"
            >
              {{ selectedMeta.favorite ? '★' : '☆' }}
            </button>
          </div>

          <div class="meta">
            <label class="field">
              <span>标签</span>
              <input
                :value="selectedMeta.tags.join(', ')"
                class="input"
                type="text"
                placeholder="剧情, 通用, 角色扮演"
                @change="store.setMetaTags(selectedPresetName, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="field">
              <span>备注</span>
              <textarea
                :value="selectedMeta.note"
                class="input note"
                placeholder="写点使用备注，方便浏览检索"
                @change="store.setMetaNote(selectedPresetName, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </label>
          </div>

          <PromptQuickToggleList
            :items="quickPromptItems"
            :disabled="loadingPreset || switching"
            @toggle="store.togglePromptEnabledAndAutoSave"
          />

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
        </section>

        <section v-else class="detail empty">
          <p>暂无预设，请先在左侧选择一个预设。</p>
        </section>
      </template>
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import BrowseSettingsPanel from './components/BrowseSettingsPanel.vue';
import EditModeShell from './components/EditModeShell.vue';
import PresetCardGrid from './components/PresetCardGrid.vue';
import PresetListTable from './components/PresetListTable.vue';
import PromptQuickToggleList from './components/PromptQuickToggleList.vue';
import UnsavedGuardDialog from './components/UnsavedGuardDialog.vue';
import type { ApiBindingMode, BrowseViewMode, EditApplyMode } from './types';
import { usePresetAssistantStore } from './store/presetAssistantStore';

const DIRTY_STATE_KEY = '__PRESET_ASSISTANT_HAS_UNSAVED_CHANGES__';

const store = usePresetAssistantStore();
const {
  presetNames,
  presetSummaries,
  selectedPresetName,
  selectedPreset,
  loadedPresetName,
  loadingPreset,
  quickPromptItems,
  selectedMeta,
  browseParamDraft,
  editMode,
  editDraft,
  editDraftDirty,
  editSelectedPromptIndex,
  editSaving,
  unsavedDialogVisible,
  unsavedDialogReason,
  viewMode,
  apiBindingMode,
  editApplyMode,
  browseParamPanelOpen,
  browseParamExpandedGroup,
  hasUnsavedChanges,
} = storeToRefs(store);

const searchText = ref('');
const tagFilterText = ref('');
const favoriteOnly = ref(false);
const switching = ref(false);

const filteredSummaries = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  const tagTokens = [...new Set(tagFilterText.value.split(',').map(token => token.trim().toLowerCase()).filter(Boolean))];
  return presetSummaries.value.filter(item => {
    if (favoriteOnly.value && !item.favorite) {
      return false;
    }
    if (keyword) {
      const matched =
        item.name.toLowerCase().includes(keyword) ||
        item.note.toLowerCase().includes(keyword) ||
        item.tags.some(tag => tag.toLowerCase().includes(keyword));
      if (!matched) {
        return false;
      }
    }
    if (tagTokens.length > 0) {
      const existing = item.tags.map(tag => tag.toLowerCase());
      if (!tagTokens.every(token => existing.includes(token))) {
        return false;
      }
    }
    return true;
  });
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

function onViewModeChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const next: BrowseViewMode = target.value === 'list' ? 'list' : 'cards';
  viewMode.value = next;
}

function onEditApplyModeChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const next: EditApplyMode = target.value === 'draft' ? 'draft' : 'live';
  editApplyMode.value = next;
}

function setEditApplyMode(mode: EditApplyMode): void {
  editApplyMode.value = mode;
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

async function switchPresetByName(name: string): Promise<void> {
  switching.value = true;
  try {
    await store.switchPresetWithConnectionPolicy(name);
  } finally {
    switching.value = false;
  }
}

async function switchSelectedPreset(): Promise<void> {
  switching.value = true;
  try {
    await store.switchPresetWithConnectionPolicy(selectedPresetName.value);
  } finally {
    switching.value = false;
  }
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

watch(hasUnsavedChanges, value => {
  syncDirtyFlag(value);
}, { immediate: true });
</script>

<style scoped>
.preset-root {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  box-sizing: border-box;
  color: #e8f1ff;
  font-size: 13px;
  line-height: 1.45;
  font-family: 'HarmonyOS Sans SC', 'Noto Sans SC', 'Source Han Sans SC', sans-serif;
  background:
    radial-gradient(circle at 16% 10%, rgba(30, 64, 175, 0.22), transparent 42%),
    radial-gradient(circle at 82% 20%, rgba(8, 145, 178, 0.16), transparent 35%),
    linear-gradient(168deg, #090f1f, #0a1328 42%, #0b1122);
}

.top {
  border: 1px solid rgba(77, 102, 139, 0.62);
  border-radius: 12px;
  background: rgba(11, 18, 34, 0.78);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.brand h1 {
  margin: 0;
  font-size: 18px;
  color: #f8fbff;
}

.brand p {
  margin: 2px 0 0;
  color: #9ec4f8;
  font-size: 12px;
}

.top-actions {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
}

.controls,
.filters {
  border: 1px solid rgba(72, 95, 129, 0.58);
  border-radius: 11px;
  background: rgba(10, 16, 30, 0.72);
  padding: 9px 10px;
  display: grid;
  gap: 9px;
}

.controls {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.filters {
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.1fr) auto 1fr;
  align-items: center;
}

.main {
  min-height: 0;
  flex: 1;
  display: grid;
}

.main > :deep(*) {
  min-height: 0;
}

.main > .preset-list,
.main > .detail {
  min-height: 0;
}

.main.browsing {
  grid-template-columns: minmax(320px, 44%) minmax(0, 1fr);
  gap: 10px;
}

.preset-list,
.detail {
  border: 1px solid rgba(70, 93, 122, 0.7);
  border-radius: 12px;
  background: rgba(9, 14, 26, 0.74);
  padding: 10px;
  min-height: 0;
  overflow: auto;
}

.detail {
  display: grid;
  gap: 10px;
  align-content: start;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: start;
}

.detail-head h2 {
  margin: 0;
  font-size: 16px;
  color: #f8fbff;
}

.detail-head p {
  margin: 2px 0 0;
  color: #9ec4f8;
  font-size: 12px;
}

.state {
  margin-left: 8px;
  color: #93a4be;
}

.state.loaded {
  color: #34d399;
}

.star {
  border: none;
  background: transparent;
  color: #fbbf24;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.meta {
  display: grid;
  gap: 8px;
}

.field {
  display: grid;
  gap: 4px;
}

.field > span {
  color: #b8d2f5;
  font-size: 12px;
}

.input,
.note {
  border: 1px solid rgba(78, 105, 140, 0.72);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.9);
  color: #f8fbff;
  padding: 6px 8px;
  min-height: 34px;
  box-sizing: border-box;
  width: 100%;
}

.note {
  min-height: 72px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #bfd4f2;
  font-size: 12px;
}

.summary {
  justify-self: end;
  color: #94b4de;
  font-size: 12px;
}

.btn {
  border: 1px solid rgba(91, 123, 175, 0.62);
  border-radius: 8px;
  background: #1f2a44;
  color: #f5f8ff;
  padding: 6px 12px;
  cursor: pointer;
}

.btn.primary {
  background: #1e5ab8;
  border-color: #3b82f6;
}

.btn.active {
  border-color: #38bdf8;
  background: rgba(30, 90, 184, 0.42);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8ba3c7;
}

@media (max-width: 1220px) {
  .controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filters {
    grid-template-columns: 1fr 1fr;
  }

  .summary {
    justify-self: start;
    grid-column: 1 / -1;
  }
}

@media (max-width: 960px) {
  .main.browsing {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .controls,
  .filters {
    grid-template-columns: 1fr;
  }

  .top {
    align-items: start;
  }
}
</style>
