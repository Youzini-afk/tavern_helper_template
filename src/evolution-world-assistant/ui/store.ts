import {
  EwApiPreset,
  EwApiPresetSchema,
  EwFlowConfig,
  EwFlowConfigSchema,
  EwSettings,
  LastIoSummary,
  RunSummary,
} from '../runtime/types';
import { simpleHash } from '../runtime/helpers';
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

function createApiPreset(index: number): EwApiPreset {
  return EwApiPresetSchema.parse({
    id: `api_${index}_${simpleHash(`ui-api-${index}-${Date.now()}`)}`,
    name: `API配置 ${index}`,
    api_url: '',
    api_key: '',
    headers_json: '',
  });
}

function createFlow(index: number, apiPresetId: string): EwFlowConfig {
  return EwFlowConfigSchema.parse({
    id: `flow_${index}_${simpleHash(`ui-flow-${index}-${Date.now()}`)}`,
    name: `工作流 ${index}`,
    enabled: true,
    priority: 100,
    timeout_ms: 8000,
    api_preset_id: apiPresetId,
    api_url: '',
    api_key: '',
    context_turns: 8,
    extract_rules: [],
    exclude_rules: [],
    request_template: '',
    headers_json: '',
  });
}

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
  void syncFromRuntime;
  void syncRun;
  void syncIo;

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
    const newPreset = createApiPreset(next.api_presets.length + 1);
    next.api_presets.push(newPreset);
    settings.value = next;
    expandedApiPresetId.value = newPreset.id;
    activeTab.value = 'flows';
  }

  function removeApiPreset(presetId: string) {
    const next = klona(settings.value);
    _.remove(next.api_presets, preset => preset.id === presetId);

    if (next.api_presets.length === 0) {
      next.api_presets.push(createApiPreset(1));
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
      next.api_presets.push(createApiPreset(1));
    }
    const newFlow = createFlow(next.flows.length + 1, next.api_presets[0].id);
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
        next.api_presets.push(createApiPreset(1));
      }
      next.flows.push(createFlow(1, next.api_presets[0].id));
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
        toastr.error(result.reason ?? 'manual run failed', 'Evolution World');
      } else {
        toastr.success('manual run succeeded', 'Evolution World');
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
        toastr.error('EvolutionWorldAPI not ready', 'Evolution World');
        return;
      }
      const result = await api.rollbackController();
      if (!result.ok) {
        toastr.error(result.reason ?? 'rollback failed', 'Evolution World');
      } else {
        toastr.success('controller rollback succeeded', 'Evolution World');
      }
    } finally {
      busy.value = false;
    }
  }

  function exportConfig() {
    const payload = JSON.stringify(settings.value, null, 2);
    navigator.clipboard
      .writeText(payload)
      .then(() => toastr.success('config copied to clipboard', 'Evolution World'))
      .catch(() => toastr.error('failed to copy config', 'Evolution World'));
  }

  function importConfig() {
    if (!importText.value.trim()) {
      toastr.warning('import text is empty', 'Evolution World');
      return;
    }

    try {
      const parsed = JSON.parse(importText.value);
      replaceSettings(parsed as EwSettings);
      settings.value = getSettings();
      toastr.success('config imported', 'Evolution World');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`import failed: ${message}`, 'Evolution World');
    }
  }

  function validateConfig() {
    const result = window.EvolutionWorldAPI?.validateConfig();
    if (!result) {
      toastr.error('EvolutionWorldAPI not ready', 'Evolution World');
      return;
    }

    if (result.ok) {
      toastr.success('config is valid', 'Evolution World');
      return;
    }

    toastr.error(result.errors.join('\n'), 'Evolution World');
  }

  async function validateControllerSyntax() {
    busy.value = true;
    try {
      const result = await window.EvolutionWorldAPI?.validateControllerSyntax();
      if (!result) {
        toastr.error('EvolutionWorldAPI not ready', 'Evolution World');
        return;
      }

      if (result.ok) {
        toastr.success('controller syntax is valid', 'Evolution World');
      } else {
        toastr.error(result.reason ?? 'controller syntax invalid', 'Evolution World');
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
