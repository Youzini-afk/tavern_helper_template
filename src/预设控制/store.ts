// ============================================================
// Pinia Store — 所有运行时状态的唯一数据源
// ============================================================

import {
  SettingsSchema,
  WidgetConfigSchema,
  PresetEntrySnapshotSchema,
  type WidgetConfig,
  type ChatMessage,
  type PresetEntrySnapshot,
  type Settings,
} from './schema';
import { callAI } from './ai';

export const useStore = defineStore('preset-control', () => {
  // ========== 持久化设置（存入酒馆脚本变量）==========
  const settings = ref<Settings>(
    SettingsSchema.parse(getVariables({ type: 'script', script_id: getScriptId() })),
  );

  // 自动持久化
  watchEffect(() => {
    insertOrAssignVariables(klona(settings.value), { type: 'script', script_id: getScriptId() });
  });

  // ========== 面板配置 ==========
  const widgetConfig = ref<WidgetConfig>(
    settings.value.widget_config ?? WidgetConfigSchema.parse({}),
  );

  // 当 widgetConfig 变化时，同步回 settings
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

  // ========== 预设条目快照 ==========
  const presetEntries = ref<PresetEntrySnapshot[]>([]);

  /** 扫描当前预设，提取所有条目信息 */
  function scanPreset() {
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
    } catch (err) {
      console.error('[预设控制] 扫描预设失败:', err);
      toastr.error('扫描预设失败，请检查是否有正在使用的预设');
    }
  }

  // ========== AI 加载状态 ==========
  const isLoading = ref(false);

  // ========== 面板显示 ==========
  const panelOpen = ref(settings.value.panel_open);

  watch(panelOpen, open => {
    settings.value.panel_open = open;
  });

  // ========== Actions ==========

  /** 发送对话消息并调用 AI */
  async function sendChat(userMessage: string) {
    // 添加用户消息
    chatHistory.value.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    isLoading.value = true;
    try {
      // 确保预设条目快照是最新的
      scanPreset();

      // 调用 AI
      const result = await callAI(userMessage, presetEntries.value, settings.value.api);

      // 添加 AI 回复
      chatHistory.value.push({
        role: 'assistant',
        content: JSON.stringify(result, null, 2),
        timestamp: Date.now(),
      });

      // 更新面板配置
      widgetConfig.value = result;

      toastr.success('面板已更新');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      chatHistory.value.push({
        role: 'assistant',
        content: `⚠️ 生成失败: ${errorMsg}`,
        timestamp: Date.now(),
      });
      toastr.error(`AI 生成失败: ${errorMsg}`);
    } finally {
      isLoading.value = false;
    }
  }

  /** 切换单个开关 */
  async function toggleItem(groupIdx: number, itemIdx: number) {
    const item = widgetConfig.value.groups[groupIdx]?.items[itemIdx];
    if (!item) return;

    item.enabled = !item.enabled;
    await syncItemToPreset(item.preset_entry_id, item.enabled);
  }

  /** 批量切换整组 */
  async function toggleGroup(groupIdx: number) {
    const group = widgetConfig.value.groups[groupIdx];
    if (!group) return;

    // 如果全部开启则全部关闭，否则全部开启
    const allEnabled = group.items.every(item => item.enabled);
    const newState = !allEnabled;

    for (const item of group.items) {
      item.enabled = newState;
    }

    await syncAllToPreset();
  }

  /** 全部开启 */
  async function enableAll() {
    for (const group of widgetConfig.value.groups) {
      for (const item of group.items) {
        item.enabled = true;
      }
    }
    await syncAllToPreset();
  }

  /** 全部关闭 */
  async function disableAll() {
    for (const group of widgetConfig.value.groups) {
      for (const item of group.items) {
        item.enabled = false;
      }
    }
    await syncAllToPreset();
  }

  /** 同步单个条目到预设 */
  async function syncItemToPreset(entryId: string, enabled: boolean) {
    try {
      await updatePresetWith('in_use', preset => {
        const prompt = preset.prompts.find(p => p.id === entryId);
        if (prompt) {
          prompt.enabled = enabled;
        }
        return preset;
      });
    } catch (err) {
      console.error('[预设控制] 同步条目失败:', err);
      toastr.error('同步到预设失败');
    }
  }

  /** 同步所有开关到预设 */
  async function syncAllToPreset() {
    try {
      const enabledMap = new Map<string, boolean>();
      for (const group of widgetConfig.value.groups) {
        for (const item of group.items) {
          enabledMap.set(item.preset_entry_id, item.enabled);
        }
      }

      await updatePresetWith('in_use', preset => {
        for (const prompt of preset.prompts) {
          if (enabledMap.has(prompt.id)) {
            prompt.enabled = enabledMap.get(prompt.id)!;
          }
        }
        return preset;
      });
    } catch (err) {
      console.error('[预设控制] 批量同步失败:', err);
      toastr.error('批量同步到预设失败');
    }
  }

  /** 从预设自动生成面板（不经过 AI） */
  function autoGenerateFromPreset() {
    scanPreset();

    const normalEntries = presetEntries.value.filter(
      e =>
        !['worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'charDescription',
          'charPersonality', 'scenario', 'dialogueExamples', 'chatHistory'].includes(e.id),
    );

    widgetConfig.value = {
      title: '预设控制',
      groups: [
        {
          title: '提示词条目',
          items: normalEntries.map(e => ({
            label: e.name,
            preset_entry_id: e.id,
            preset_entry_name: e.name,
            enabled: e.enabled,
          })),
        },
      ],
    };
  }

  /** 刷新面板状态（从预设同步回来） */
  function refreshFromPreset() {
    scanPreset();
    for (const group of widgetConfig.value.groups) {
      for (const item of group.items) {
        const entry = presetEntries.value.find(e => e.id === item.preset_entry_id);
        if (entry) {
          item.enabled = entry.enabled;
        }
      }
    }
  }

  /** 清空对话历史 */
  function clearChat() {
    chatHistory.value = [];
  }

  return {
    settings,
    widgetConfig,
    chatHistory,
    presetEntries,
    isLoading,
    panelOpen,
    scanPreset,
    sendChat,
    toggleItem,
    toggleGroup,
    enableAll,
    disableAll,
    syncAllToPreset,
    autoGenerateFromPreset,
    refreshFromPreset,
    clearChat,
  };
});
