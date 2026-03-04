import { EwFlowConfig, EwFlowConfigSchema, EwSettings, LastIoSummary, RunSummary } from '../runtime/types';
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

function createFlow(index: number): EwFlowConfig {
  return EwFlowConfigSchema.parse({
    id: `flow_${index}_${Date.now()}`,
    name: `Flow ${index}`,
    enabled: true,
    priority: 100,
    timeout_ms: 8000,
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

  function addFlow() {
    const next = klona(settings.value);
    next.flows.push(createFlow(next.flows.length + 1));
    settings.value = next;
  }

  function removeFlow(flowId: string) {
    const next = klona(settings.value);
    _.remove(next.flows, flow => flow.id === flowId);
    if (next.flows.length === 0) {
      next.flows.push(createFlow(1));
    }
    settings.value = next;
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
  }

  return {
    settings,
    lastRun,
    lastIo,
    importText,
    busy,
    addFlow,
    removeFlow,
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
