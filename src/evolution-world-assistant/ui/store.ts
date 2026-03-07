import {
  EwSettings,
  EwSettingsSchema,
  LastIoSummary,
  RunSummary,
} from '../runtime/types';
import { createDefaultApiPreset, createDefaultFlow } from '../runtime/factory';
import type { TabKey } from './help-meta';
import {
  getLastIo,
  getSettings,
  getLastRun,
  patchSettings,
  replaceSettings,
  subscribeLastIo,
  subscribeLastRun,
  subscribeSettings,
} from '../runtime/settings';
import { runWorkflow } from '../runtime/pipeline';
import { showEwNotice } from './notice';



export const useEwStore = defineStore('evolution-world-store', () => {
  const settings = ref<EwSettings>(getSettings());
  const lastRun = ref<RunSummary | null>(getLastRun());
  const lastIo = ref<LastIoSummary | null>(getLastIo());
  const activeTab = ref<TabKey>('overview');
  const globalAdvancedOpen = ref(false);
  const expandedApiPresetId = ref<string | null>(null);
  const expandedFlowId = ref<string | null>(null);
  const importText = ref('');
  const busy = ref(false);

  const syncFromRuntime = subscribeSettings(next => {
    if (!_.isEqual(settings.value, next)) {
      settings.value = next;
    }
  });

  const syncRun = subscribeLastRun(next => {
    lastRun.value = next;
  });
  const syncIo = subscribeLastIo(next => {
    lastIo.value = next;
  });

  // L-3: Properly clean up subscriptions when the store's scope is disposed.
  onScopeDispose(() => {
    syncFromRuntime.stop();
    syncRun.stop();
    syncIo.stop();
  });

  const persistDebounced = _.debounce((next: EwSettings) => {
    replaceSettings(next);
  }, 200);

  watch(
    settings,
    next => {
      persistDebounced(klona(next));
    },
    { deep: true },
  );

  watch(
    () => settings.value.api_presets.map(preset => preset.id),
    presetIds => {
      if (expandedApiPresetId.value && !presetIds.includes(expandedApiPresetId.value)) {
        expandedApiPresetId.value = null;
      }
    },
  );

  watch(
    () => settings.value.flows.map(flow => flow.id),
    flowIds => {
      if (expandedFlowId.value && !flowIds.includes(expandedFlowId.value)) {
        expandedFlowId.value = null;
      }
    },
  );

  function addApiPreset() {
    const next = klona(settings.value);
    const newPreset = createDefaultApiPreset(next.api_presets.length + 1);
    next.api_presets.push(newPreset);
    settings.value = next;
    expandedApiPresetId.value = newPreset.id;
    activeTab.value = 'api';
  }

  function removeApiPreset(presetId: string) {
    const next = klona(settings.value);
    _.remove(next.api_presets, preset => preset.id === presetId);

    if (next.api_presets.length === 0) {
      next.api_presets.push(createDefaultApiPreset(1));
    }

    const fallbackPresetId = next.api_presets[0].id;
    next.flows = next.flows.map(flow => {
      if (flow.api_preset_id !== presetId) {
        return flow;
      }
      return {
        ...flow,
        api_preset_id: fallbackPresetId,
      };
    });

    settings.value = next;
    if (expandedApiPresetId.value === presetId) {
      expandedApiPresetId.value = next.api_presets[0]?.id ?? null;
    }
  }

  function addFlow() {
    const next = klona(settings.value);
    if (next.api_presets.length === 0) {
      next.api_presets.push(createDefaultApiPreset(1));
    }
    const newFlow = createDefaultFlow(next.flows.length + 1, next.api_presets[0].id);
    next.flows.push(newFlow);
    settings.value = next;
    expandedFlowId.value = newFlow.id;
    activeTab.value = 'flows';
  }

  function removeFlow(flowId: string) {
    const next = klona(settings.value);
    _.remove(next.flows, flow => flow.id === flowId);
    if (next.flows.length === 0) {
      if (next.api_presets.length === 0) {
        next.api_presets.push(createDefaultApiPreset(1));
      }
      next.flows.push(createDefaultFlow(1, next.api_presets[0].id));
    }
    settings.value = next;
    if (expandedFlowId.value === flowId) {
      expandedFlowId.value = next.flows[0]?.id ?? null;
    }
  }

  function setActiveTab(tab: TabKey) {
    activeTab.value = tab;
  }

  function setGlobalAdvancedOpen(open: boolean) {
    globalAdvancedOpen.value = open;
  }

  function toggleGlobalAdvancedOpen() {
    globalAdvancedOpen.value = !globalAdvancedOpen.value;
  }

  function toggleApiPresetExpanded(presetId: string) {
    expandedApiPresetId.value = expandedApiPresetId.value === presetId ? null : presetId;
  }

  function toggleFlowExpanded(flowId: string) {
    expandedFlowId.value = expandedFlowId.value === flowId ? null : flowId;
  }

  function setExpandedApiPreset(presetId: string | null) {
    expandedApiPresetId.value = presetId;
  }

  function setExpandedFlow(flowId: string | null) {
    expandedFlowId.value = flowId;
  }

  async function runManual(message: string) {
    busy.value = true;
    try {
      const text = message.trim() || getChatMessages(-1)[0]?.message || '';
      const result = await runWorkflow({
        message_id: getLastMessageId(),
        user_input: text,
        mode: 'manual',
        inject_reply: false,
      });
      if (!result.ok) {
        toastr.error(result.reason ?? '手动运行失败', 'Evolution World');
      } else {
        toastr.success('手动运行成功', 'Evolution World');
      }
    } finally {
      busy.value = false;
    }
  }

  async function rollbackController() {
    busy.value = true;
    try {
      const api = window.EvolutionWorldAPI;
      if (!api) {
        toastr.error('EvolutionWorldAPI 尚未就绪', 'Evolution World');
        return;
      }
      const result = await api.rollbackController();
      if (!result.ok) {
        toastr.error(result.reason ?? '回滚失败', 'Evolution World');
      } else {
        toastr.success('控制器回滚成功', 'Evolution World');
      }
    } finally {
      busy.value = false;
    }
  }

  function exportConfig() {
    const payload = JSON.stringify(settings.value, null, 2);
    navigator.clipboard
      .writeText(payload)
      .then(() => toastr.success('配置已复制到剪贴板', 'Evolution World'))
      .catch(() => toastr.error('复制配置失败', 'Evolution World'));
  }

  function importConfig() {
    if (!importText.value.trim()) {
      showEwNotice({
        title: '导入失败',
        message: '导入内容为空，请先粘贴 JSON 配置。',
        level: 'warning',
        duration_ms: 3600,
      });
      toastr.warning('导入内容为空', 'Evolution World');
      return;
    }

    try {
      const parsed = JSON.parse(importText.value);
      // CR-2: Validate against schema before replacing, so invalid JSON is caught explicitly.
      EwSettingsSchema.parse(parsed);
      replaceSettings(parsed as EwSettings);
      settings.value = getSettings();
      showEwNotice({
        title: '导入成功',
        message: '配置已加载并应用到当前脚本。',
        level: 'success',
        duration_ms: 3200,
      });
      toastr.success('配置已导入', 'Evolution World');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showEwNotice({
        title: '导入失败',
        message,
        level: 'error',
        duration_ms: 4800,
      });
      toastr.error(`导入失败: ${message}`, 'Evolution World');
    }
  }

  function validateConfig() {
    const result = window.EvolutionWorldAPI?.validateConfig();
    if (!result) {
      toastr.error('EvolutionWorldAPI not ready', 'Evolution World');
      return;
    }

    if (result.ok) {
      toastr.success('配置校验通过 ✓', 'Evolution World');
      return;
    }

    toastr.error(result.errors.join('\n'), 'Evolution World');
  }

  async function validateControllerSyntax() {
    busy.value = true;
    try {
      const result = await window.EvolutionWorldAPI?.validateControllerSyntax();
      if (!result) {
        toastr.error('EvolutionWorldAPI 尚未就绪', 'Evolution World');
        return;
      }

      if (result.ok) {
        toastr.success('控制器语法校验通过 ✓', 'Evolution World');
      } else {
        toastr.error(result.reason ?? '控制器语法无效', 'Evolution World');
      }
    } finally {
      busy.value = false;
    }
  }

  function setOpen(open: boolean) {
    patchSettings({ ui_open: open });
  }

  function openPanel() {
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    activeTab.value = 'overview';
  }

  return {
    settings,
    lastRun,
    lastIo,
    activeTab,
    globalAdvancedOpen,
    expandedApiPresetId,
    expandedFlowId,
    importText,
    busy,
    addApiPreset,
    removeApiPreset,
    addFlow,
    removeFlow,
    setActiveTab,
    setGlobalAdvancedOpen,
    toggleGlobalAdvancedOpen,
    toggleApiPresetExpanded,
    toggleFlowExpanded,
    setExpandedApiPreset,
    setExpandedFlow,
    runManual,
    rollbackController,
    exportConfig,
    importConfig,
    validateConfig,
    validateControllerSyntax,
    setOpen,
    openPanel,
    closePanel,
  };
});
