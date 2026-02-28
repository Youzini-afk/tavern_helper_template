import { klona } from 'klona';

import type { SettingGroup } from '../types';

export const presetSettingGroups: SettingGroup[] = [
  {
    id: 'context',
    title: '上下文与输出',
    fields: [
      { key: 'max_context', label: '最大上下文', type: 'number', min: 256, step: 1 },
      { key: 'max_completion_tokens', label: '最大回复', type: 'number', min: 16, step: 1 },
      { key: 'reply_count', label: '回复数量', type: 'number', min: 1, max: 20, step: 1 },
      { key: 'should_stream', label: '流式输出', type: 'boolean' },
    ],
  },
  {
    id: 'sampling',
    title: '采样参数',
    fields: [
      { key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 3, step: 0.01 },
      { key: 'top_p', label: 'Top P', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'top_k', label: 'Top K', type: 'number', min: 0, step: 1 },
      { key: 'top_a', label: 'Top A', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'min_p', label: 'Min P', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'frequency_penalty', label: '频率惩罚', type: 'number', min: -2, max: 2, step: 0.01 },
      { key: 'presence_penalty', label: '存在惩罚', type: 'number', min: -2, max: 2, step: 0.01 },
      { key: 'repetition_penalty', label: '重复惩罚', type: 'number', min: 0, max: 3, step: 0.01 },
      { key: 'seed', label: '随机种子', type: 'number', min: -1, step: 1 },
    ],
  },
  {
    id: 'reasoning',
    title: '思维链与工具',
    fields: [
      {
        key: 'reasoning_effort',
        label: '推理强度',
        type: 'select',
        options: [
          { label: 'auto', value: 'auto' },
          { label: 'min', value: 'min' },
          { label: 'low', value: 'low' },
          { label: 'medium', value: 'medium' },
          { label: 'high', value: 'high' },
          { label: 'max', value: 'max' },
        ],
      },
      { key: 'request_thoughts', label: '请求思维链', type: 'boolean' },
      { key: 'request_images', label: '请求图片', type: 'boolean' },
      { key: 'enable_function_calling', label: '函数调用', type: 'boolean' },
      { key: 'enable_web_search', label: '网络搜索', type: 'boolean' },
      { key: 'squash_system_messages', label: '压缩系统消息', type: 'boolean' },
    ],
  },
  {
    id: 'media',
    title: '多模态与消息格式',
    fields: [
      {
        key: 'allow_sending_images',
        label: '图片传入',
        type: 'select',
        options: [
          { label: 'disabled', value: 'disabled' },
          { label: 'auto', value: 'auto' },
          { label: 'low', value: 'low' },
          { label: 'high', value: 'high' },
        ],
      },
      { key: 'allow_sending_videos', label: '视频传入', type: 'boolean' },
      {
        key: 'character_name_prefix',
        label: '角色名前缀',
        type: 'select',
        options: [
          { label: 'none', value: 'none' },
          { label: 'default', value: 'default' },
          { label: 'content', value: 'content' },
          { label: 'completion', value: 'completion' },
        ],
      },
      { key: 'wrap_user_messages_in_quotes', label: '用户消息加引号', type: 'boolean' },
    ],
  },
];

export function clonePreset(preset: Preset): Preset {
  return klona(preset);
}

export function cloneSettings(settings: Preset['settings']): Preset['settings'] {
  return klona(settings);
}

export function buildPromptKey(prompt: PresetPrompt, index: number): string {
  return `${prompt.id}::${prompt.name}::${index}`;
}

export function getPromptKind(prompt: PresetPrompt): 'normal' | 'system' | 'placeholder' {
  if (isPresetSystemPrompt(prompt)) {
    return 'system';
  }
  if (isPresetPlaceholderPrompt(prompt)) {
    return 'placeholder';
  }
  return 'normal';
}

export function createDefaultPrompt(): PresetPrompt {
  return {
    id: `prompt_${Date.now().toString(36)}`,
    name: '新提示词',
    enabled: true,
    role: 'system',
    position: { type: 'relative' },
    content: '',
  };
}

export function normalizeTags(raw: string): string[] {
  return [...new Set(raw.split(',').map(item => item.trim()).filter(Boolean))];
}

export function parseSettingValue(field: SettingGroup['fields'][number], value: string): Preset['settings'][keyof Preset['settings']] {
  if (field.type === 'boolean') {
    return (value === 'true') as Preset['settings'][keyof Preset['settings']];
  }
  if (field.type === 'number') {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return 0 as Preset['settings'][keyof Preset['settings']];
    }
    return parsed as Preset['settings'][keyof Preset['settings']];
  }
  return value as Preset['settings'][keyof Preset['settings']];
}
