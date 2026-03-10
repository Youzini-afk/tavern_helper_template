import {
  EwFlowConfig,
  EwFlowConfigSchema,
  EwSettings,
  EwSettingsSchema,
  LastIoSummary,
  RunSummary,
} from '../runtime/types';
import { createDefaultApiPreset, createDefaultFlow } from '../runtime/factory';
import { isSillyTavernPreset, convertStPresetToFlow } from './convertStPreset';
import { readCharFlows, writeCharFlows } from '../runtime/char-flows';
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
import { previewPrompt, type AssembledMessage } from '../runtime/prompt-assembler';
import {
  collectLatestSnapshots,
  collectAllFloorSnapshots,
  rollbackToFloor,
  type DynSnapshot,
  type FloorSnapshot,
} from '../runtime/floor-binding';



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

  // ── 角色卡绑定工作流 ──
  const charFlows = ref<EwFlowConfig[]>([]);
  const activeCharName = ref<string>('');
  const flowScope = ref<'global' | 'character'>('global');
  const charFlowsLoading = ref(false);

  // ── 调试预览 ──
  const promptPreview = ref<AssembledMessage[] | null>(null);
  const snapshotPreview = ref<{ controller: string | null; dyn: Map<string, DynSnapshot> } | null>(null);
  const previewFlowId = ref<string>('');

  // ── 历史记录 ──
  const floorSnapshots = ref<FloorSnapshot[]>([]);
  const selectedFloorId = ref<number | null>(null);
  const compareFloorId = ref<number | null>(null);

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
    // 安全导出：去除所有 API 敏感信息
    const safeSettings = klona(settings.value);
    for (const preset of safeSettings.api_presets) {
      preset.api_key = '';
      preset.api_url = '';
      preset.headers_json = '';
    }
    for (const flow of safeSettings.flows) {
      (flow as any).api_url = '';
      (flow as any).api_key = '';
      (flow as any).headers_json = '';
      (flow as any).api_preset_id = '';
    }
    const payload = JSON.stringify(safeSettings, null, 2);
    navigator.clipboard
      .writeText(payload)
      .then(() => toastr.success('配置已复制到剪贴板（已去除 API 密钥）', 'Evolution World'))
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

  // ── Flow-level import / export ──

  function downloadJson(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildFlowExportPayload(flows: EwFlowConfig[]) {
    // 安全导出：去除每条 flow 的 api_url / api_key / headers_json 敏感字段
    const safeFlows = flows.map(flow => {
      const copy = klona(flow) as Record<string, unknown>;
      delete copy.api_url;
      delete copy.api_key;
      delete copy.headers_json;
      delete copy.api_preset_id;
      return copy;
    });
    return { ew_flow_export: true, version: 1, flows: safeFlows };
  }

  function sanitizeFilename(name: string) {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'flow';
  }

  function exportSingleFlow(flowId: string) {
    const flow = settings.value.flows.find(f => f.id === flowId);
    if (!flow) {
      toastr.error('找不到该工作流', 'Evolution World');
      return;
    }
    const payload = buildFlowExportPayload([flow]);
    downloadJson(payload, `ew_flow_${sanitizeFilename(flow.name)}.json`);
    toastr.success(`已导出工作流「${flow.name}」`, 'Evolution World');
  }

  function exportAllFlows() {
    if (settings.value.flows.length === 0) {
      toastr.warning('没有工作流可导出', 'Evolution World');
      return;
    }
    const payload = buildFlowExportPayload(settings.value.flows);
    downloadJson(payload, `ew_flows_all_${settings.value.flows.length}.json`);
    toastr.success(`已导出全部 ${settings.value.flows.length} 条工作流`, 'Evolution World');
  }

  function importFlowsFromText(jsonText: string, filename?: string) {
    if (!jsonText.trim()) {
      toastr.warning('导入内容为空', 'Evolution World');
      return;
    }

    try {
      const parsed = JSON.parse(jsonText);

      let validated: EwFlowConfig[];

      if (parsed && parsed.ew_flow_export === true && Array.isArray(parsed.flows)) {
        // ── EW 原生格式 ──
        validated = [];
        for (const raw of parsed.flows) {
          validated.push(EwFlowConfigSchema.parse(raw));
        }
      } else if (isSillyTavernPreset(parsed)) {
        // ── ST 预设 → 转换为单个 flow ──
        const flowName = filename?.replace(/\.json$/i, '') || 'ST Preset';
        const flow = EwFlowConfigSchema.parse(
          convertStPresetToFlow(parsed, flowName),
        );
        validated = [flow];
        toastr.info('已识别为酒馆预设并转换', 'Evolution World');
      } else {
        toastr.error('无效的工作流导出文件，缺少 ew_flow_export 标识且非酒馆预设', 'Evolution World');
        return;
      }

      if (validated.length === 0) {
        toastr.warning('导出文件中没有工作流', 'Evolution World');
        return;
      }

      // Deduplicate IDs: if conflict, append timestamp suffix
      const existingIds = new Set(settings.value.flows.map(f => f.id));
      for (const flow of validated) {
        if (existingIds.has(flow.id)) {
          flow.id = `${flow.id}_${Date.now()}`;
        }
        existingIds.add(flow.id);
      }

      const next = klona(settings.value);
      next.flows.push(...validated);
      settings.value = next;
      toastr.success(`已导入 ${validated.length} 条工作流`, 'Evolution World');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`工作流导入失败: ${message}`, 'Evolution World');
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

  // ── 角色卡工作流操作 ──────────────────────────────────────────

  async function loadCharFlows() {
    charFlowsLoading.value = true;
    try {
      const name = getCurrentCharacterName?.() ?? '';
      activeCharName.value = name;
      charFlows.value = await readCharFlows(settings.value);
    } catch (e) {
      console.warn('[Evolution World] loadCharFlows failed:', e);
      charFlows.value = [];
    } finally {
      charFlowsLoading.value = false;
    }
  }

  async function saveCharFlows() {
    try {
      await writeCharFlows(settings.value, charFlows.value);
      showEwNotice({ title: 'Evolution World', message: '角色卡工作流已保存到世界书', level: 'success' });
    } catch (e) {
      console.error('[Evolution World] saveCharFlows failed:', e);
      showEwNotice({ title: 'Evolution World', message: '角色卡工作流保存失败: ' + (e as Error).message, level: 'error' });
    }
  }

  function addCharFlow() {
    const apiPresets = settings.value.api_presets;
    if (apiPresets.length === 0) {
      const next = klona(settings.value);
      next.api_presets.push(createDefaultApiPreset(1));
      settings.value = next;
    }
    const newFlow = createDefaultFlow(
      charFlows.value.length + 1,
      settings.value.api_presets[0].id,
    );
    charFlows.value = [...charFlows.value, newFlow];
    expandedFlowId.value = newFlow.id;
  }

  function removeCharFlow(flowId: string) {
    charFlows.value = charFlows.value.filter(f => f.id !== flowId);
    if (expandedFlowId.value === flowId) {
      expandedFlowId.value = charFlows.value[0]?.id ?? null;
    }
  }

  function setFlowScope(scope: 'global' | 'character') {
    flowScope.value = scope;
    if (scope === 'character') {
      loadCharFlows();
    }
  }

  // ── 调试预览 ──────────────────────────────────────────

  async function loadPromptPreview() {
    const flowId = previewFlowId.value;
    // Find target flow from global or character flows
    const allFlows = [...settings.value.flows, ...charFlows.value];
    const flow = allFlows.find(f => f.id === flowId) ?? allFlows.find(f => f.enabled) ?? allFlows[0];
    if (!flow) {
      showEwNotice({ title: '调试', message: '没有可用的工作流', level: 'warning' });
      return;
    }
    previewFlowId.value = flow.id;
    busy.value = true;
    try {
      promptPreview.value = await previewPrompt(flow, settings.value.controller_entry_name);
      showEwNotice({ title: '调试', message: `Prompt 预览已生成（${promptPreview.value.length} 条消息）`, level: 'success' });
    } catch (e) {
      console.error('[Evolution World] previewPrompt failed:', e);
      showEwNotice({ title: '调试', message: 'Prompt 预览失败: ' + (e as Error).message, level: 'error' });
    } finally {
      busy.value = false;
    }
  }

  async function loadSnapshotPreview() {
    busy.value = true;
    try {
      snapshotPreview.value = await collectLatestSnapshots();
      const dynCount = snapshotPreview.value.dyn.size;
      const hasCtrl = snapshotPreview.value.controller ? '✅' : '❌';
      showEwNotice({ title: '调试', message: `Controller: ${hasCtrl} | Dyn 条目: ${dynCount}`, level: 'success' });
    } catch (e) {
      console.error('[Evolution World] loadSnapshotPreview failed:', e);
      showEwNotice({ title: '调试', message: '快照读取失败: ' + (e as Error).message, level: 'error' });
    } finally {
      busy.value = false;
    }
  }

  // ── 历史记录 ──────────────────────────────────────────────

  async function loadFloorSnapshots() {
    busy.value = true;
    try {
      floorSnapshots.value = await collectAllFloorSnapshots();
      showEwNotice({ title: '历史', message: `已加载 ${floorSnapshots.value.length} 个楼层`, level: 'success' });
    } catch (e) {
      console.error('[Evolution World] loadFloorSnapshots failed:', e);
      showEwNotice({ title: '历史', message: '楼层快照加载失败: ' + (e as Error).message, level: 'error' });
    } finally {
      busy.value = false;
    }
  }

  async function doRollbackToFloor(messageId: number) {
    busy.value = true;
    try {
      await rollbackToFloor(settings.value, messageId);
      showEwNotice({ title: '历史', message: `已回滚到楼层 #${messageId}`, level: 'success' });
    } catch (e) {
      console.error('[Evolution World] doRollbackToFloor failed:', e);
      showEwNotice({ title: '历史', message: '回滚失败: ' + (e as Error).message, level: 'error' });
    } finally {
      busy.value = false;
    }
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
    charFlows,
    activeCharName,
    flowScope,
    charFlowsLoading,
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
    exportSingleFlow,
    exportAllFlows,
    importFlowsFromText,
    validateConfig,
    validateControllerSyntax,
    setOpen,
    openPanel,
    closePanel,
    loadCharFlows,
    saveCharFlows,
    addCharFlow,
    removeCharFlow,
    setFlowScope,
    // debug
    promptPreview,
    snapshotPreview,
    previewFlowId,
    loadPromptPreview,
    loadSnapshotPreview,
    // history
    floorSnapshots,
    selectedFloorId,
    compareFloorId,
    loadFloorSnapshots,
    doRollbackToFloor,
  };
});
