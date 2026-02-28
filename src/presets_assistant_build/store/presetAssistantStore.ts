import { klona } from 'klona';
import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';

import { applyConnectionSnapshot, captureCurrentConnectionSnapshot } from '../core/connectionSticky';
import { mutateAssistantState, readAssistantState, writeAssistantState } from '../core/persistence';
import {
  buildPromptKey,
  clonePreset,
  cloneSettings,
  createDefaultPrompt,
  getPromptKind,
  normalizeTags,
} from '../core/presetMapper';
import type {
  BrowseParamDraftState,
  PendingAction,
  PresetSummary,
  PromptQuickItem,
  QuickPromptToggleState,
  UnsavedDecision,
} from '../types';

type ReplacePresetRender = 'debounced' | 'immediate' | 'none';

interface PresetPreviewInfo {
  prompt_count: number;
  enabled_prompt_count: number;
}

const SAVE_FEEDBACK_MS = 1200;
const EDIT_LIVE_APPLY_DELAY_MS = 260;

export const usePresetAssistantStore = defineStore('preset-assistant', () => {
  const assistantState = ref(readAssistantState());

  const presetNames = ref<string[]>([]);
  const presetPreviewMap = ref<Record<string, PresetPreviewInfo>>({});
  const selectedPresetName = ref('');
  const selectedPreset = ref<Preset | null>(null);
  const loadedPresetName = ref('');
  const loadingPreset = ref(false);
  const initialized = ref(false);

  const editMode = ref(false);
  const editDraft = ref<Preset | null>(null);
  const editDraftDirty = ref(false);
  const editSelectedPromptIndex = ref(0);
  const editSaving = ref(false);
  let editLiveApplyTimer: number | null = null;

  const unsavedDialogVisible = ref(false);
  const unsavedDialogReason = ref('');
  const pendingAction = ref<PendingAction | null>(null);

  const quickPromptToggleState = reactive<QuickPromptToggleState>({
    saving_ids: new Set<string>(),
    last_saved_at_by_id: {},
  });

  const browseParamDraft = reactive<BrowseParamDraftState>({
    base_settings: cloneSettings(default_preset.settings),
    staged_settings: cloneSettings(default_preset.settings),
    dirty: false,
    applying: false,
  });

  const subscriptions = ref<EventOnReturn[]>([]);

  const viewMode = computed({
    get: () => assistantState.value.ui.view_mode,
    set: value => {
      mutateState(draft => {
        draft.ui.view_mode = value;
      });
    },
  });

  const apiBindingMode = computed({
    get: () => assistantState.value.ui.api_binding_mode,
    set: value => {
      mutateState(draft => {
        draft.ui.api_binding_mode = value;
      });
      if (value === 'sticky_connection') {
        void refreshStickyConnectionSnapshot();
      }
    },
  });

  const editApplyMode = computed({
    get: () => assistantState.value.ui.edit_apply_mode,
    set: value => {
      mutateState(draft => {
        draft.ui.edit_apply_mode = value;
      });
    },
  });

  const browseParamPanelOpen = computed({
    get: () => assistantState.value.ui.browse_param_panel_open,
    set: value => {
      mutateState(draft => {
        draft.ui.browse_param_panel_open = value;
      });
    },
  });

  const browseParamExpandedGroup = computed({
    get: () => assistantState.value.ui.browse_param_last_expanded_group,
    set: value => {
      mutateState(draft => {
        draft.ui.browse_param_last_expanded_group = value;
      });
    },
  });

  const hasUnsavedChanges = computed(() => browseParamDraft.dirty || editDraftDirty.value);

  const selectedMeta = computed(() => ensureMeta(selectedPresetName.value));

  const quickPromptItems = computed<PromptQuickItem[]>(() => {
    if (!selectedPreset.value) {
      return [];
    }
    return selectedPreset.value.prompts.map((prompt, index) => {
      const key = buildPromptKey(prompt, index);
      return {
        index,
        key,
        id: prompt.id,
        name: prompt.name,
        role: prompt.role,
        enabled: prompt.enabled,
        kind: getPromptKind(prompt),
        is_saving: quickPromptToggleState.saving_ids.has(key),
        is_recently_saved: _.isNumber(quickPromptToggleState.last_saved_at_by_id[key]),
      };
    });
  });

  const presetSummaries = computed<PresetSummary[]>(() => {
    return presetNames.value.map(name => {
      const meta = ensureMeta(name);
      const preview = presetPreviewMap.value[name] ?? { prompt_count: 0, enabled_prompt_count: 0 };
      return {
        name,
        prompt_count: preview.prompt_count,
        enabled_prompt_count: preview.enabled_prompt_count,
        favorite: meta.favorite,
        tags: meta.tags,
        note: meta.note,
        is_loaded: name === loadedPresetName.value,
        is_selected: name === selectedPresetName.value,
      };
    });
  });

  function mutateState(mutator: (draft: typeof assistantState.value) => void): void {
    const next = mutateAssistantState(assistantState.value, mutator);
    assistantState.value = next;
    writeAssistantState(next);
  }

  function ensureMeta(name: string): typeof selectedMeta.value {
    if (!name) {
      return { favorite: false, tags: [], note: '', updated_at: 0 };
    }
    return (
      assistantState.value.meta_by_preset[name] ?? {
        favorite: false,
        tags: [],
        note: '',
        updated_at: 0,
      }
    );
  }

  function commitMeta(name: string, mutator: (meta: typeof selectedMeta.value) => void): void {
    if (!name) {
      return;
    }
    mutateState(draft => {
      const current = draft.meta_by_preset[name] ?? {
        favorite: false,
        tags: [],
        note: '',
        updated_at: 0,
      };
      const nextMeta = klona(current);
      mutator(nextMeta);
      nextMeta.updated_at = Date.now();
      draft.meta_by_preset[name] = nextMeta;
      draft.tag_catalog = [
        ...new Set(Object.values(draft.meta_by_preset).flatMap(meta => meta.tags).filter(Boolean)),
      ].sort((lhs, rhs) => lhs.localeCompare(rhs, 'zh-Hans-CN'));
    });
  }

  function updatePresetPreview(name: string, preset: Preset): void {
    presetPreviewMap.value = {
      ...presetPreviewMap.value,
      [name]: {
        prompt_count: preset.prompts.length,
        enabled_prompt_count: preset.prompts.filter(prompt => prompt.enabled).length,
      },
    };
  }

  function removePresetPreview(name: string): void {
    const next = { ...presetPreviewMap.value };
    delete next[name];
    presetPreviewMap.value = next;
  }

  function markPromptSaved(promptKey: string): void {
    quickPromptToggleState.last_saved_at_by_id[promptKey] = Date.now();
    window.setTimeout(() => {
      delete quickPromptToggleState.last_saved_at_by_id[promptKey];
    }, SAVE_FEEDBACK_MS);
  }

  function resetBrowseSettingsDraftFromPreset(preset: Preset): void {
    browseParamDraft.base_settings = cloneSettings(preset.settings);
    browseParamDraft.staged_settings = cloneSettings(preset.settings);
    browseParamDraft.dirty = false;
    browseParamDraft.applying = false;
  }

  function resetEditDraftFromPreset(preset: Preset): void {
    editDraft.value = clonePreset(preset);
    editDraftDirty.value = false;
    editSelectedPromptIndex.value = Math.max(
      0,
      Math.min(editSelectedPromptIndex.value, Math.max(0, editDraft.value.prompts.length - 1)),
    );
  }

  async function refreshPresetNames(): Promise<void> {
    const names = [...getPresetNames()].sort((lhs, rhs) => lhs.localeCompare(rhs, 'zh-Hans-CN'));
    loadedPresetName.value = getLoadedPresetName();
    presetNames.value = names;

    const nextPreviews: Record<string, PresetPreviewInfo> = {};
    for (const name of names) {
      try {
        const preset = getPreset(name);
        nextPreviews[name] = {
          prompt_count: preset.prompts.length,
          enabled_prompt_count: preset.prompts.filter(prompt => prompt.enabled).length,
        };
      } catch {
        nextPreviews[name] = { prompt_count: 0, enabled_prompt_count: 0 };
      }
    }
    presetPreviewMap.value = nextPreviews;

    mutateState(draft => {
      for (const key of Object.keys(draft.meta_by_preset)) {
        if (!names.includes(key)) {
          delete draft.meta_by_preset[key];
        }
      }
      draft.tag_catalog = [
        ...new Set(Object.values(draft.meta_by_preset).flatMap(meta => meta.tags).filter(Boolean)),
      ].sort((lhs, rhs) => lhs.localeCompare(rhs, 'zh-Hans-CN'));
    });
  }

  async function loadPresetForBrowse(name: string): Promise<boolean> {
    if (!name) {
      selectedPresetName.value = '';
      selectedPreset.value = null;
      return false;
    }
    loadingPreset.value = true;
    try {
      const preset = getPreset(name);
      selectedPresetName.value = name;
      selectedPreset.value = clonePreset(preset);
      resetBrowseSettingsDraftFromPreset(preset);
      resetEditDraftFromPreset(preset);
      mutateState(draft => {
        draft.ui.last_selected_preset = name;
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`加载预设失败: ${message}`, 'Preset Assistant');
      return false;
    } finally {
      loadingPreset.value = false;
    }
  }

  function queuePendingAction(action: PendingAction, reason: string): void {
    pendingAction.value = action;
    unsavedDialogReason.value = reason;
    unsavedDialogVisible.value = true;
  }

  async function selectPreset(name: string): Promise<void> {
    if (!name || name === selectedPresetName.value) {
      return;
    }
    if (hasUnsavedChanges.value) {
      queuePendingAction({ type: 'select', target_name: name }, '切换预设前有未保存改动');
      return;
    }
    await loadPresetForBrowse(name);
  }

  async function refreshStickyConnectionSnapshot(): Promise<void> {
    if (apiBindingMode.value !== 'sticky_connection') {
      return;
    }
    const snapshot = await captureCurrentConnectionSnapshot();
    mutateState(draft => {
      draft.sticky_connection_snapshot = snapshot;
    });
  }

  async function switchPresetWithConnectionPolicy(targetName = selectedPresetName.value): Promise<boolean> {
    if (!targetName) {
      toastr.warning('请先选择一个预设', 'Preset Assistant');
      return false;
    }
    if (hasUnsavedChanges.value) {
      queuePendingAction({ type: 'switch', target_name: targetName }, '切换启用预设前有未保存改动');
      return false;
    }
    return await performSwitchPreset(targetName);
  }

  async function performSwitchPreset(targetName: string): Promise<boolean> {
    try {
      let stickySnapshot = assistantState.value.sticky_connection_snapshot;
      if (apiBindingMode.value === 'sticky_connection') {
        stickySnapshot = stickySnapshot ?? (await captureCurrentConnectionSnapshot());
        mutateState(draft => {
          draft.sticky_connection_snapshot = stickySnapshot;
        });
      }

      const switched = loadPreset(targetName);
      if (!switched) {
        toastr.error(`切换预设失败: ${targetName}`, 'Preset Assistant');
        return false;
      }

      if (apiBindingMode.value === 'sticky_connection' && stickySnapshot) {
        await applyConnectionSnapshot(stickySnapshot);
        toastr.success(`已切换预设并保持连接配置: ${targetName}`, 'Preset Assistant');
      } else {
        toastr.success(`已切换预设: ${targetName}`, 'Preset Assistant');
      }

      loadedPresetName.value = getLoadedPresetName();
      await loadPresetForBrowse(targetName);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`切换预设失败: ${message}`, 'Preset Assistant');
      return false;
    }
  }

  async function persistSelectedPreset(nextPreset: Preset, render: ReplacePresetRender): Promise<void> {
    if (!selectedPresetName.value) {
      throw new Error('没有选中的预设');
    }
    await replacePreset(selectedPresetName.value, nextPreset, { render });
    const isLoaded = selectedPresetName.value === loadedPresetName.value;
    if (isLoaded) {
      await replacePreset('in_use', clonePreset(nextPreset), { render: 'debounced' });
    }
  }

  async function togglePromptEnabledAndAutoSave(index: number, enabled: boolean): Promise<void> {
    if (!selectedPreset.value) {
      return;
    }
    const currentPrompt = selectedPreset.value.prompts[index];
    if (!currentPrompt) {
      return;
    }

    const promptKey = buildPromptKey(currentPrompt, index);
    const rollbackPreset = clonePreset(selectedPreset.value);
    const optimisticPreset = clonePreset(selectedPreset.value);
    optimisticPreset.prompts[index].enabled = enabled;
    selectedPreset.value = optimisticPreset;
    quickPromptToggleState.saving_ids.add(promptKey);

    try {
      await persistSelectedPreset(clonePreset(optimisticPreset), 'none');
      updatePresetPreview(selectedPresetName.value, optimisticPreset);
      markPromptSaved(promptKey);
    } catch (error) {
      selectedPreset.value = rollbackPreset;
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`提示词开关保存失败: ${message}`, 'Preset Assistant');
    } finally {
      quickPromptToggleState.saving_ids.delete(promptKey);
    }
  }

  function setBrowseStagedSetting(
    key: keyof Preset['settings'],
    value: Preset['settings'][keyof Preset['settings']],
  ): void {
    browseParamDraft.staged_settings = {
      ...browseParamDraft.staged_settings,
      [key]: value,
    };
    browseParamDraft.dirty = !_.isEqual(browseParamDraft.base_settings, browseParamDraft.staged_settings);
  }

  async function applyBrowseSettingsToPreset(): Promise<boolean> {
    if (!selectedPreset.value || !browseParamDraft.dirty || browseParamDraft.applying) {
      return true;
    }
    browseParamDraft.applying = true;
    try {
      const nextPreset = clonePreset(selectedPreset.value);
      nextPreset.settings = cloneSettings(browseParamDraft.staged_settings);
      await persistSelectedPreset(nextPreset, 'none');
      selectedPreset.value = nextPreset;
      browseParamDraft.base_settings = cloneSettings(nextPreset.settings);
      browseParamDraft.staged_settings = cloneSettings(nextPreset.settings);
      browseParamDraft.dirty = false;
      if (!editDraftDirty.value) {
        resetEditDraftFromPreset(nextPreset);
      }
      toastr.success('参数已应用到当前预设', 'Preset Assistant');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`应用参数失败: ${message}`, 'Preset Assistant');
      return false;
    } finally {
      browseParamDraft.applying = false;
    }
  }

  function resetBrowseSettingsDraft(): void {
    browseParamDraft.staged_settings = cloneSettings(browseParamDraft.base_settings);
    browseParamDraft.dirty = false;
  }

  function setMetaFavorite(name: string, favorite: boolean): void {
    commitMeta(name, meta => {
      meta.favorite = favorite;
    });
  }

  function setMetaTags(name: string, rawTags: string): void {
    commitMeta(name, meta => {
      meta.tags = normalizeTags(rawTags);
    });
  }

  function setMetaNote(name: string, note: string): void {
    commitMeta(name, meta => {
      meta.note = note;
    });
  }

  function setEditMode(next: boolean): void {
    editMode.value = next;
    if (next && selectedPreset.value && !editDraft.value) {
      resetEditDraftFromPreset(selectedPreset.value);
    }
  }

  function updateEditDraft(nextPreset: Preset): void {
    editDraft.value = clonePreset(nextPreset);
    editDraftDirty.value = selectedPreset.value ? !_.isEqual(nextPreset, selectedPreset.value) : false;
    editSelectedPromptIndex.value = Math.min(
      editSelectedPromptIndex.value,
      Math.max(0, (editDraft.value.prompts.length || 1) - 1),
    );
    if (editDraftDirty.value && editApplyMode.value === 'live') {
      scheduleEditLiveApply();
    }
  }

  function appendPromptToEditDraft(): void {
    if (!editDraft.value) {
      return;
    }
    const next = clonePreset(editDraft.value);
    next.prompts.push(createDefaultPrompt());
    updateEditDraft(next);
    editSelectedPromptIndex.value = next.prompts.length - 1;
  }

  function removePromptFromEditDraft(index: number): void {
    if (!editDraft.value || !editDraft.value.prompts[index]) {
      return;
    }
    const next = clonePreset(editDraft.value);
    next.prompts.splice(index, 1);
    updateEditDraft(next);
  }

  function movePromptInEditDraft(index: number, direction: -1 | 1): void {
    if (!editDraft.value) {
      return;
    }
    const target = index + direction;
    if (target < 0 || target >= editDraft.value.prompts.length) {
      return;
    }
    const next = clonePreset(editDraft.value);
    const [current] = next.prompts.splice(index, 1);
    next.prompts.splice(target, 0, current);
    updateEditDraft(next);
    editSelectedPromptIndex.value = target;
  }

  function scheduleEditLiveApply(): void {
    if (editLiveApplyTimer !== null) {
      window.clearTimeout(editLiveApplyTimer);
    }
    editLiveApplyTimer = window.setTimeout(() => {
      editLiveApplyTimer = null;
      void applyEditDraftToInUse();
    }, EDIT_LIVE_APPLY_DELAY_MS);
  }

  async function applyEditDraftToInUse(): Promise<void> {
    if (!editDraft.value || !selectedPresetName.value) {
      return;
    }
    if (selectedPresetName.value !== loadedPresetName.value) {
      return;
    }
    try {
      await replacePreset('in_use', clonePreset(editDraft.value), { render: 'debounced' });
    } catch (error) {
      console.warn('[PresetAssistant] live apply failed:', error);
    }
  }

  async function saveEditDraftToPreset(): Promise<boolean> {
    if (!editDraft.value || !selectedPresetName.value || !editDraftDirty.value || editSaving.value) {
      return true;
    }
    editSaving.value = true;
    try {
      await persistSelectedPreset(clonePreset(editDraft.value), 'none');
      selectedPreset.value = clonePreset(editDraft.value);
      editDraftDirty.value = false;
      updatePresetPreview(selectedPresetName.value, selectedPreset.value);
      resetBrowseSettingsDraftFromPreset(selectedPreset.value);
      toastr.success('编辑内容已保存', 'Preset Assistant');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`保存编辑失败: ${message}`, 'Preset Assistant');
      return false;
    } finally {
      editSaving.value = false;
    }
  }

  function discardEditDraft(): void {
    if (!selectedPreset.value) {
      return;
    }
    resetEditDraftFromPreset(selectedPreset.value);
  }

  async function saveAllPendingChanges(): Promise<boolean> {
    if (browseParamDraft.dirty) {
      const ok = await applyBrowseSettingsToPreset();
      if (!ok) {
        return false;
      }
    }
    if (editDraftDirty.value) {
      const ok = await saveEditDraftToPreset();
      if (!ok) {
        return false;
      }
    }
    return true;
  }

  function discardAllPendingChanges(): void {
    resetBrowseSettingsDraft();
    discardEditDraft();
  }

  async function resolveUnsavedDecision(decision: UnsavedDecision): Promise<void> {
    if (decision === 'cancel') {
      unsavedDialogVisible.value = false;
      pendingAction.value = null;
      return;
    }

    if (decision === 'save') {
      const saved = await saveAllPendingChanges();
      if (!saved) {
        return;
      }
    } else {
      discardAllPendingChanges();
    }

    const action = pendingAction.value;
    pendingAction.value = null;
    unsavedDialogVisible.value = false;

    if (!action) {
      return;
    }
    if (action.type === 'select') {
      await loadPresetForBrowse(action.target_name);
      return;
    }
    if (action.type === 'switch') {
      await performSwitchPreset(action.target_name);
    }
  }

  async function refreshFromHost(): Promise<void> {
    const current = selectedPresetName.value;
    await refreshPresetNames();
    if (hasUnsavedChanges.value) {
      return;
    }
    if (!current) {
      return;
    }
    if (!presetNames.value.includes(current)) {
      const fallback = presetNames.value[0] ?? '';
      if (fallback) {
        await loadPresetForBrowse(fallback);
      } else {
        selectedPresetName.value = '';
        selectedPreset.value = null;
      }
      return;
    }
    await loadPresetForBrowse(current);
  }

  function bindTavernEvents(): void {
    if (subscriptions.value.length) {
      return;
    }
    subscriptions.value.push(
      eventOn(tavern_events.PRESET_CHANGED, () => {
        loadedPresetName.value = getLoadedPresetName();
        void refreshFromHost();
      }),
    );
    subscriptions.value.push(
      eventOn(tavern_events.PRESET_DELETED, () => {
        loadedPresetName.value = getLoadedPresetName();
        void refreshFromHost();
      }),
    );
    subscriptions.value.push(
      eventOn(tavern_events.PRESET_RENAMED, () => {
        loadedPresetName.value = getLoadedPresetName();
        void refreshFromHost();
      }),
    );
    subscriptions.value.push(
      eventOn(tavern_events.MAIN_API_CHANGED, () => {
        void refreshStickyConnectionSnapshot();
      }),
    );
    subscriptions.value.push(
      eventOn(tavern_events.CHATCOMPLETION_MODEL_CHANGED, () => {
        void refreshStickyConnectionSnapshot();
      }),
    );
    subscriptions.value.push(
      eventOn(tavern_events.CONNECTION_PROFILE_LOADED, () => {
        void refreshStickyConnectionSnapshot();
      }),
    );
    subscriptions.value.push(
      eventOn(tavern_events.CONNECTION_PROFILE_UPDATED, () => {
        void refreshStickyConnectionSnapshot();
      }),
    );
  }

  function teardown(): void {
    for (const subscription of subscriptions.value) {
      subscription.stop();
    }
    subscriptions.value = [];
    if (editLiveApplyTimer !== null) {
      window.clearTimeout(editLiveApplyTimer);
      editLiveApplyTimer = null;
    }
    initialized.value = false;
  }

  async function initialize(): Promise<void> {
    if (initialized.value) {
      return;
    }
    loadedPresetName.value = getLoadedPresetName();
    await refreshPresetNames();
    const fallback =
      (assistantState.value.ui.last_selected_preset &&
        presetNames.value.includes(assistantState.value.ui.last_selected_preset) &&
        assistantState.value.ui.last_selected_preset) ||
      (loadedPresetName.value && presetNames.value.includes(loadedPresetName.value) && loadedPresetName.value) ||
      presetNames.value[0] ||
      '';
    if (fallback) {
      await loadPresetForBrowse(fallback);
    }
    if (apiBindingMode.value === 'sticky_connection') {
      await refreshStickyConnectionSnapshot();
    }
    bindTavernEvents();
    initialized.value = true;
  }

  return {
    assistantState,
    presetNames,
    presetSummaries,
    selectedPresetName,
    selectedPreset,
    loadedPresetName,
    loadingPreset,
    editMode,
    editDraft,
    editDraftDirty,
    editSelectedPromptIndex,
    editSaving,
    browseParamDraft,
    quickPromptItems,
    selectedMeta,
    hasUnsavedChanges,
    unsavedDialogVisible,
    unsavedDialogReason,
    pendingAction,
    viewMode,
    apiBindingMode,
    editApplyMode,
    browseParamPanelOpen,
    browseParamExpandedGroup,
    initialize,
    teardown,
    refreshFromHost,
    selectPreset,
    switchPresetWithConnectionPolicy,
    resolveUnsavedDecision,
    togglePromptEnabledAndAutoSave,
    setBrowseStagedSetting,
    applyBrowseSettingsToPreset,
    resetBrowseSettingsDraft,
    setMetaFavorite,
    setMetaTags,
    setMetaNote,
    setEditMode,
    updateEditDraft,
    appendPromptToEditDraft,
    removePromptFromEditDraft,
    movePromptInEditDraft,
    saveEditDraftToPreset,
    discardEditDraft,
    saveAllPendingChanges,
    discardAllPendingChanges,
  };
});
