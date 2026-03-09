// ============================================================
// Pinia Store — 所有运行时状态的唯一数据源，提供树状 UI 状态与行为绑定
// ============================================================

import {
  SettingsSchema,
  WidgetConfigSchema,
  PresetEntrySnapshotSchema,
  uid,
  type WidgetConfig,
  type UIBlock,
  type ChatMessage,
  type PresetEntrySnapshot,
  type Settings,
  type ActionBinding,
} from './schema';
import { callAI, buildSystemPrompt } from './ai';
import {
  loadMapping,
  savePresetConfig,
  loadPresetConfig,
  detectAndFixRenames,
  type PresetMapping,
} from './config-storage';

export const useStore = defineStore('preset-control', () => {
  // ========== 持久化设置（存入酒馆脚本变量）==========
  const settings = ref<Settings>(
    SettingsSchema.parse(getVariables({ type: 'script', script_id: getScriptId() })),
  );

  // Fix #6: 用 debounce 代替 watchEffect 避免持久化风暴
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  watch(
    settings,
    () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        insertOrAssignVariables(klona(settings.value), { type: 'script', script_id: getScriptId() });
      }, 500);
    },
    { deep: true },
  );

  // ========== 面板配置 ==========
  const widgetConfig = ref<WidgetConfig>(
    settings.value.widget_config ?? WidgetConfigSchema.parse({
      title: '控制中心',
      root: { id: uid(), type: 'container', layout: { direction: 'column', gap: 'medium', padding: 'medium' } }
    }),
  );

  watch(
    widgetConfig,
    config => {
      settings.value.widget_config = klona(config);
    },
    { deep: true },
  );

  // ========== 对话历史 ==========
  const chatHistory = ref<ChatMessage[]>(settings.value.chat_history ?? []);

  watch(
    chatHistory,
    history => {
      settings.value.chat_history = klona(history);
    },
    { deep: true },
  );

  // ========== 预设持久化状态 ==========
  const currentPresetName = ref<string>('');
  const presetMapping = ref<PresetMapping>({});
  let configStorageReady = false;

  /** 初始化文件存储，读取映射表，迁移旧数据 */
  async function initConfigStorage() {
    try {
      presetMapping.value = await loadMapping();

      // 检测改名
      const { mapping: fixed } = await detectAndFixRenames(presetMapping.value);
      presetMapping.value = fixed;

      // 记录当前预设名
      try {
        currentPresetName.value = getLoadedPresetName();
      } catch { /* 静默 */ }

      // 迁移: 如果 settings 中有旧的 widget_config 且映射表中没有当前预设，则将其写入文件
      if (currentPresetName.value && settings.value.widget_config && !presetMapping.value[currentPresetName.value]) {
        console.info('[BarTender] 迁移旧版 widget_config 到文件存储');
        presetMapping.value = await savePresetConfig(
          currentPresetName.value,
          presetMapping.value,
          widgetConfig.value,
          chatHistory.value,
        );
      }

      // 尝试从文件加载当前预设的配置
      if (currentPresetName.value) {
        const saved = await loadPresetConfig(currentPresetName.value, presetMapping.value);
        if (saved) {
          widgetConfig.value = WidgetConfigSchema.parse(saved.widget_config);
          chatHistory.value = saved.chat_history ?? [];
        }
      }

      configStorageReady = true;
    } catch (err) {
      console.error('[BarTender] 配置存储初始化失败:', err);
      configStorageReady = true; // 失败也继续运行
    }
  }

  // ========== 预设条目快照 ==========
  const presetEntries = ref<PresetEntrySnapshot[]>([]);

  // Fix #2: 预设参数的响应式缓存
  const presetParams = ref<Record<string, number>>({});

  /** 扫描当前预设，提取所有条目信息和运行参数。如果预设已切换，自动保存旧配置并加载新配置 */
  async function scanPreset() {
    try {
      const preset = getPreset('in_use');
      presetEntries.value = preset.prompts.map(p =>
        PresetEntrySnapshotSchema.parse({
          id: p.id,
          name: p.name,
          enabled: p.enabled,
          role: p.role,
          position_type: p.position?.type ?? 'relative',
        }),
      );
      refreshParamsCache(preset);

      // 预设切换检测
      if (configStorageReady) {
        let newPresetName = '';
        try { newPresetName = getLoadedPresetName(); } catch { /* */ }

        if (newPresetName && newPresetName !== currentPresetName.value) {
          // 保存旧预设配置
          if (currentPresetName.value) {
            presetMapping.value = await savePresetConfig(
              currentPresetName.value,
              presetMapping.value,
              widgetConfig.value,
              chatHistory.value,
            );
          }

          // 加载新预设配置
          const saved = await loadPresetConfig(newPresetName, presetMapping.value);
          if (saved) {
            widgetConfig.value = WidgetConfigSchema.parse(saved.widget_config);
            chatHistory.value = saved.chat_history ?? [];
            console.info(`[BarTender] 已恢复预设 "${newPresetName}" 的 UI 配置`);
          } else {
            // 新预设没有保存的配置，重置为默认
            widgetConfig.value = WidgetConfigSchema.parse({
              title: '控制中心',
              root: { id: uid(), type: 'container', layout: { direction: 'column', gap: 'medium', padding: 'medium' } }
            });
            chatHistory.value = [];
            console.info(`[BarTender] 预设 "${newPresetName}" 无保存配置，已重置`);
          }

          currentPresetName.value = newPresetName;
        }
      }
    } catch (err) {
      console.error('[预设控制] 扫描预设失败:', err);
      toastr.error('扫描预设失败，请检查是否有正在使用的预设');
    }
  }

  function refreshParamsCache(preset?: Preset) {
    try {
      const p = preset ?? getPreset('in_use');
      const s = p.settings;
      presetParams.value = {
        temperature: s.temperature,
        max_context: s.max_context,
        max_completion_tokens: s.max_completion_tokens,
        frequency_penalty: s.frequency_penalty,
        presence_penalty: s.presence_penalty,
        top_p: s.top_p,
        min_p: s.min_p,
        top_k: s.top_k,
        repetition_penalty: s.repetition_penalty,
      };
    } catch {
      // 静默失败
    }
  }

  // ========== AI 加载状态 ==========
  const isLoading = ref(false);
  const streamingText = ref(''); // 流式输出的实时文本
  let currentAbortController: AbortController | null = null;

  // ========== 模型列表 ==========
  const modelCandidates = ref<string[]>([]);
  const isLoadingModels = ref(false);

  /** 从自定义 API 端点获取模型列表 */
  async function loadModels() {
    const api = settings.value.api;
    if (api.mode !== 'custom') {
      toastr.info('当前使用酒馆 API，模型由酒馆管理');
      return;
    }

    if (!api.custom_url?.trim()) {
      toastr.warning('请先填写 API 地址');
      return;
    }

    isLoadingModels.value = true;
    try {
      const base = api.custom_url.replace(/\/+$/, '');
      const modelsUrl = base.endsWith('/models') ? base : `${base}/models`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (api.custom_key?.trim()) {
        headers['Authorization'] = `Bearer ${api.custom_key.trim()}`;
      }

      try {
        const resp = await fetch(modelsUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

        const json = await resp.json();

        // 响应格式规范化（兼容多种 API 实现）
        let rawList: string[] = [];
        if (json.data && Array.isArray(json.data)) {
          // OpenAI 标准格式: { data: [{ id: "model-name" }] }
          rawList = json.data.map((m: any) => String(m.id ?? m.name ?? ''));
        } else if (Array.isArray(json)) {
          // 纯数组格式: ["model1", "model2"] 或 [{ id: "model1" }]
          rawList = json.map((m: any) => (typeof m === 'string' ? m : String(m.id ?? m.name ?? '')));
        }

        const models = Array.from(new Set(rawList.map(s => s.trim()).filter(Boolean)));
        modelCandidates.value = models;

        if (models.length > 0) {
          toastr.success(`已获取 ${models.length} 个模型`);
          // 如果当前没有选中模型，自动选中第一个
          if (!api.custom_model?.trim()) {
            api.custom_model = models[0];
          }
        } else {
          toastr.warning('未获取到任何模型');
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error('获取模型列表超时 (10s)');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toastr.error(`获取模型列表失败: ${msg}`);
      console.error('[预设控制] 获取模型列表失败:', err);
    } finally {
      isLoadingModels.value = false;
    }
  }

  // ========== 面板显示 ==========
  const panelOpen = ref(settings.value.panel_open);

  watch(panelOpen, open => {
    settings.value.panel_open = open;
  });

  // ========== 悬浮球菜单 ==========
  const ballMenuOpen = ref(false);

  function toggleBallMenu() {
    ballMenuOpen.value = !ballMenuOpen.value;
    if (ballMenuOpen.value) {
      // 打开菜单时刷新预设状态
      scanPreset();
    }
  }

  // ========== Actions ==========

  async function sendChat(userMessage: string) {
    chatHistory.value.push({
      id: uid(), // Fix #7: 唯一 ID
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    isLoading.value = true;
    streamingText.value = '';
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    try {
      scanPreset();

      const result = await callAI(
        userMessage, presetEntries.value, presetParams.value,
        settings.value.api, settings.value.custom_system_prompt,
        widgetConfig.value,
        (chunk: string) => {
          streamingText.value += chunk;
        },
        signal,
      );

      streamingText.value = '';
      chatHistory.value.push({
        id: uid(),
        role: 'assistant',
        content: `✅ 成功生成新面板「${result.title}」`,
        timestamp: Date.now(),
      });

      applyNewWidgetConfig(result);
      toastr.success('面板已更新');
    } catch (err) {
      streamingText.value = '';
      // 用户主动中断不弹错误
      if (signal.aborted) return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      chatHistory.value.push({
        id: uid(),
        role: 'assistant',
        content: `⚠️ 生成失败: ${errorMsg}`,
        timestamp: Date.now(),
      });
      toastr.error(`AI 生成失败: ${errorMsg}`);
    } finally {
      isLoading.value = false;
      currentAbortController = null;
    }
  }

  /** 中断当前 AI 生成 */
  function abortGeneration() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    streamingText.value = '';
    isLoading.value = false;
    chatHistory.value.push({
      id: uid(),
      role: 'assistant',
      content: '⏹ 已中断生成',
      timestamp: Date.now(),
    });
  }

  /** 删除指定消息 */
  function deleteMessage(msgId: string) {
    const idx = chatHistory.value.findIndex(m => m.id === msgId);
    if (idx !== -1) chatHistory.value.splice(idx, 1);
  }

  /** 编辑指定消息内容 */
  function editMessage(msgId: string, newContent: string) {
    const msg = chatHistory.value.find(m => m.id === msgId);
    if (msg) msg.content = newContent;
  }

  /** 重新生成最后一条 AI 回复 */
  async function rerollLastAI() {
    if (isLoading.value) return;
    // 找到最后一条 assistant 消息
    const lastAiIdx = chatHistory.value.findLastIndex(m => m.role === 'assistant');
    if (lastAiIdx === -1) return;
    // 找到它之前最近的 user 消息
    let lastUserMsg = '';
    for (let i = lastAiIdx - 1; i >= 0; i--) {
      if (chatHistory.value[i].role === 'user') {
        lastUserMsg = chatHistory.value[i].content;
        break;
      }
    }
    if (!lastUserMsg) return;
    // 删掉这条 AI 消息
    chatHistory.value.splice(lastAiIdx, 1);
    // 重新发送（sendChat 会自动 push 一条 user 消息，所以我们也删掉对应的 user 消息避免重复）
    // 但不用删 user 消息，因为 sendChat 会追加新的 user 消息——这里我们直接内部调用 AI
    // 实际上我们不希望重复 user 消息，所以直接复用内部逻辑
    isLoading.value = true;
    streamingText.value = '';
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    try {
      scanPreset();
      const result = await callAI(
        lastUserMsg, presetEntries.value, presetParams.value,
        settings.value.api, settings.value.custom_system_prompt,
        widgetConfig.value,
        (chunk: string) => { streamingText.value += chunk; },
        signal,
      );
      streamingText.value = '';
      chatHistory.value.push({
        id: uid(),
        role: 'assistant',
        content: `✅ 成功生成新面板「${result.title}」`,
        timestamp: Date.now(),
      });
      applyNewWidgetConfig(result);
      toastr.success('面板已更新');
    } catch (err) {
      streamingText.value = '';
      if (signal.aborted) return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      chatHistory.value.push({
        id: uid(),
        role: 'assistant',
        content: `⚠️ 生成失败: ${errorMsg}`,
        timestamp: Date.now(),
      });
      toastr.error(`AI 生成失败: ${errorMsg}`);
    } finally {
      isLoading.value = false;
      currentAbortController = null;
    }
  }

  // ========== Abstract UI Engine API ==========

  /**
   * Fix #2: 引擎获取绑定状态值（全部走响应式缓存）
   */
  function getBoundValue(action?: ActionBinding): any {
    if (!action || action.type === 'none') return null;

    if (action.type === 'toggle_preset_entry') {
      const entry = presetEntries.value.find(e => e.id === action.entry_id);
      return entry ? entry.enabled : false;
    }

    if (action.type === 'set_preset_param') {
      return presetParams.value[action.param_name] ?? 0;
    }

    return null;
  }

  /**
   * 引擎派发修改
   */
  async function executeAction(action?: ActionBinding, payload?: any) {
    if (!action || action.type === 'none') return;

    if (action.type === 'toggle_preset_entry') {
      const state = Boolean(payload);
      try {
        await updatePresetWith('in_use', preset => {
          const prompt = preset.prompts.find(p => p.id === action.entry_id);
          if (prompt) {
            prompt.enabled = state;
          }
          return preset;
        });
        scanPreset();
      } catch (err) {
        toastr.error('同步条目到预设失败');
      }
      return;
    }

    if (action.type === 'set_preset_param') {
      try {
        // 先更新本地缓存保证 UI 即时响应
        presetParams.value[action.param_name] = payload;

        await updatePresetWith('in_use', preset => {
          if (action.param_name in preset.settings) {
            (preset.settings as any)[action.param_name] = payload;
          }
          return preset;
        });
      } catch (err) {
        toastr.error('设置预设参数失败');
        refreshParamsCache(); // 回滚缓存
      }
      return;
    }
  }

  /** 无 AI 也能自动生成基础界面 */
  function autoGenerateFromPreset() {
    scanPreset();

    const normalEntries = presetEntries.value.filter(
      e =>
        !['worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'charDescription',
          'charPersonality', 'scenario', 'dialogueExamples', 'chatHistory'].includes(e.id),
    );

    widgetConfig.value = WidgetConfigSchema.parse({
      title: '默认条目控制',
      root: {
        id: uid(),
        type: 'container',
        layout: { direction: 'column', gap: 'small', padding: 'none' },
        children: normalEntries.map(e => ({
          id: uid(),
          type: 'toggle',
          label: e.name,
          action: { type: 'toggle_preset_entry', entry_id: e.id }
        }))
      }
    });
  }

  /** 收集树中所有 _userEdited 的区块 */
  function collectUserEdited(block: UIBlock): UIBlock[] {
    const result: UIBlock[] = [];
    if (block._userEdited) result.push(block);
    if (block.children) {
      for (const child of block.children) {
        result.push(...collectUserEdited(child));
      }
    }
    return result;
  }

  /** 应用新的 widgetConfig，可选保留用户编辑 */
  function applyNewWidgetConfig(newConfig: WidgetConfig) {
    if (settings.value.preserve_user_edits) {
      const userBlocks = collectUserEdited(widgetConfig.value.root);
      if (userBlocks.length > 0 && newConfig.root.children) {
        // 过滤掉新树中与用户编辑区块相同 action 的区块（避免重复）
        const userActionIds = new Set(
          userBlocks
            .filter(b => b.action && 'entry_id' in b.action)
            .map(b => (b.action as any).entry_id),
        );
        newConfig.root.children = newConfig.root.children.filter(child => {
          if (!child.action || !('entry_id' in child.action)) return true;
          return !userActionIds.has((child.action as any).entry_id);
        });
        newConfig.root.children.push(...userBlocks);
      }
    }
    widgetConfig.value = newConfig;
  }

  function refreshFromPreset() {
    scanPreset();
  }

  function clearChat() {
    chatHistory.value = [];
  }

  // ========== 编辑模式 ==========
  const editMode = ref(false);

  // ========== 主题切换动画状态 (跨组件共享) ==========
  const themeTransition = ref<{
    active: boolean;
    clientX: number;
    clientY: number;
    targetBg: string;
  } | null>(null);

  /** 在 widgetConfig 树中递归查找区块及其父节点 */
  function findBlock(
    root: UIBlock,
    id: string,
    parent: UIBlock | null = null,
  ): { block: UIBlock; parent: UIBlock | null; index: number } | null {
    if (root.id === id) return { block: root, parent, index: -1 };
    if (root.children) {
      for (let i = 0; i < root.children.length; i++) {
        if (root.children[i].id === id) {
          return { block: root.children[i], parent: root, index: i };
        }
        const found = findBlock(root.children[i], id, root.children[i]);
        if (found) return found;
      }
    }
    return null;
  }

  /** 按 ID 修改区块属性 */
  function updateBlock(blockId: string, patch: Partial<UIBlock>) {
    const found = findBlock(widgetConfig.value.root, blockId);
    if (!found) return;
    Object.assign(found.block, patch, { _userEdited: true });
  }

  /** 按 ID 删除区块 */
  function removeBlock(blockId: string) {
    const found = findBlock(widgetConfig.value.root, blockId);
    if (!found || !found.parent || found.index < 0) return;
    found.parent.children!.splice(found.index, 1);
  }

  /** 按 ID 上移/下移区块 */
  function moveBlock(blockId: string, direction: 'up' | 'down') {
    const found = findBlock(widgetConfig.value.root, blockId);
    if (!found || !found.parent || found.index < 0) return;
    const arr = found.parent.children!;
    const newIdx = direction === 'up' ? found.index - 1 : found.index + 1;
    if (newIdx < 0 || newIdx >= arr.length) return;
    [arr[found.index], arr[newIdx]] = [arr[newIdx], arr[found.index]];
  }

  /** 在指定父区块中插入新区块 */
  function addBlock(parentId: string, newBlock: UIBlock, index?: number) {
    const found = findBlock(widgetConfig.value.root, parentId);
    if (!found) return;
    if (!found.block.children) found.block.children = [];
    const idx = index ?? found.block.children.length;
    found.block.children.splice(idx, 0, newBlock);
  }

  return {
    settings,
    widgetConfig,
    chatHistory,
    presetEntries,
    presetParams,
    isLoading,
    streamingText,
    modelCandidates,
    isLoadingModels,
    panelOpen,
    ballMenuOpen,
    editMode,
    scanPreset,
    sendChat,
    loadModels,
    toggleBallMenu,
    getBoundValue,
    executeAction,
    autoGenerateFromPreset,
    refreshFromPreset,
    clearChat,
    abortGeneration,
    deleteMessage,
    editMessage,
    rerollLastAI,
    updateBlock,
    removeBlock,
    moveBlock,
    addBlock,
    findBlock,
    themeTransition,
    currentPresetName,
    presetMapping,
    initConfigStorage,
    getDefaultSystemPrompt: () => buildSystemPrompt(presetEntries.value, presetParams.value),
  };
});
