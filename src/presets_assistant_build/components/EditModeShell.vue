<template>
  <section class="edit-shell">
    <header class="toolbar">
      <div class="mode">
        <span>编辑模式</span>
        <select :value="applyMode" class="select" @change="emitApplyMode(($event.target as HTMLSelectElement).value)">
          <option value="live">实时模式</option>
          <option value="draft">草稿模式</option>
        </select>
      </div>
      <div class="actions">
        <button class="btn" type="button" :disabled="!dirty || saving" @click="$emit('discard')">丢弃改动</button>
        <button class="btn primary" type="button" :disabled="!dirty || saving" @click="$emit('save')">
          {{ saving ? '保存中...' : '保存到预设' }}
        </button>
      </div>
    </header>

    <div v-if="draftPreset" class="content">
      <aside class="prompt-list">
        <div class="prompt-list-head">
          <strong>提示词词条</strong>
          <button class="btn mini" type="button" @click="$emit('append-prompt')">新增</button>
        </div>
        <button
          v-for="(prompt, index) in draftPreset.prompts"
          :key="`${prompt.id}-${index}`"
          class="prompt-item"
          :class="{ active: index === selectedPromptIndex }"
          type="button"
          @click="$emit('set-selected-prompt-index', index)"
        >
          <span>{{ prompt.name || prompt.id }}</span>
          <small>{{ prompt.id }}</small>
        </button>
      </aside>

      <main v-if="selectedPrompt" class="editor">
        <section class="panel">
          <h4>提示词编辑</h4>
          <label class="field">
            <span>名称</span>
            <input class="input" :value="selectedPrompt.name" type="text" @input="updatePromptName($event)" />
          </label>
          <label class="field">
            <span>ID</span>
            <input class="input" :value="selectedPrompt.id" type="text" @input="updatePromptId($event)" />
          </label>
          <div class="row">
            <label class="field">
              <span>角色</span>
              <select class="input" :value="selectedPrompt.role" @change="updatePromptRole($event)">
                <option value="system">system</option>
                <option value="user">user</option>
                <option value="assistant">assistant</option>
              </select>
            </label>
            <label class="field">
              <span>位置</span>
              <select class="input" :value="selectedPositionType" @change="updatePromptPositionType($event)">
                <option value="relative">relative</option>
                <option value="in_chat">in_chat</option>
              </select>
            </label>
          </div>
          <div v-if="selectedPositionType === 'in_chat'" class="row">
            <label class="field">
              <span>深度</span>
              <input
                class="input"
                :value="selectedPrompt.position.type === 'in_chat' ? selectedPrompt.position.depth : 0"
                type="number"
                step="1"
                @input="updatePromptDepth($event)"
              />
            </label>
            <label class="field">
              <span>顺序</span>
              <input
                class="input"
                :value="selectedPrompt.position.type === 'in_chat' ? selectedPrompt.position.order : 0"
                type="number"
                step="1"
                @input="updatePromptOrder($event)"
              />
            </label>
          </div>
          <label class="check">
            <input :checked="selectedPrompt.enabled" type="checkbox" @change="updatePromptEnabled($event)" />
            <span>启用此词条</span>
          </label>
          <label class="field">
            <span>内容</span>
            <textarea class="input textarea" :value="selectedPrompt.content ?? ''" @input="updatePromptContent($event)"></textarea>
          </label>
          <div class="ops">
            <button class="btn mini" type="button" @click="$emit('move-prompt', selectedPromptIndex, -1)">上移</button>
            <button class="btn mini" type="button" @click="$emit('move-prompt', selectedPromptIndex, 1)">下移</button>
            <button class="btn mini danger" type="button" @click="$emit('remove-prompt', selectedPromptIndex)">删除</button>
          </div>
        </section>

        <section class="panel">
          <h4>参数编辑（完整）</h4>
          <details v-for="group in groups" :key="group.id" class="group">
            <summary>{{ group.title }}</summary>
            <div class="fields">
              <label v-for="field in group.fields" :key="String(field.key)" class="field">
                <span>{{ field.label }}</span>
                <input
                  v-if="field.type === 'number'"
                  class="input"
                  type="number"
                  :value="toNumberInputValue(draftPreset.settings[field.key])"
                  :min="field.min"
                  :max="field.max"
                  :step="field.step ?? 1"
                  @input="updateSettingNumber(field.key, $event)"
                />
                <select
                  v-else-if="field.type === 'select'"
                  class="input"
                  :value="String(draftPreset.settings[field.key])"
                  @change="updateSettingSelect(field.key, $event)"
                >
                  <option v-for="option in field.options" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <label v-else class="check">
                  <input
                    :checked="Boolean(draftPreset.settings[field.key])"
                    type="checkbox"
                    @change="updateSettingBoolean(field.key, $event)"
                  />
                  <span>{{ Boolean(draftPreset.settings[field.key]) ? '开启' : '关闭' }}</span>
                </label>
              </label>
            </div>
          </details>
        </section>
      </main>
      <div v-else class="empty">当前预设没有可编辑词条</div>
    </div>

    <div v-else class="empty">请先选择预设</div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { clonePreset, presetSettingGroups } from '../core/presetMapper';
import type { EditApplyMode } from '../types';

const props = defineProps<{
  draftPreset: Preset | null;
  dirty: boolean;
  applyMode: EditApplyMode;
  selectedPromptIndex: number;
  saving: boolean;
}>();

const emit = defineEmits<{
  save: [];
  discard: [];
  'append-prompt': [];
  'remove-prompt': [index: number];
  'move-prompt': [index: number, direction: -1 | 1];
  'set-selected-prompt-index': [index: number];
  'update-apply-mode': [mode: EditApplyMode];
  'update-draft': [preset: Preset];
}>();

const groups = presetSettingGroups;

const selectedPrompt = computed(() => {
  if (!props.draftPreset) {
    return null;
  }
  return props.draftPreset.prompts[props.selectedPromptIndex] ?? null;
});

const selectedPositionType = computed(() => {
  if (!selectedPrompt.value) {
    return 'relative';
  }
  return selectedPrompt.value.position.type;
});

function emitApplyMode(modeRaw: string): void {
  const mode: EditApplyMode = modeRaw === 'draft' ? 'draft' : 'live';
  emit('update-apply-mode', mode);
}

function mutateDraft(mutator: (draft: Preset) => void): void {
  if (!props.draftPreset) {
    return;
  }
  const draft = clonePreset(props.draftPreset);
  mutator(draft);
  emit('update-draft', draft);
}

function toNumberInputValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function updatePromptName(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  mutateDraft(draft => {
    const prompt = draft.prompts[props.selectedPromptIndex];
    if (prompt) {
      prompt.name = value;
    }
  });
}

function updatePromptId(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  mutateDraft(draft => {
    const prompt = draft.prompts[props.selectedPromptIndex];
    if (prompt) {
      prompt.id = value;
    }
  });
}

function updatePromptRole(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as PresetPrompt['role'];
  mutateDraft(draft => {
    const prompt = draft.prompts[props.selectedPromptIndex];
    if (prompt) {
      prompt.role = value;
    }
  });
}

function updatePromptPositionType(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  mutateDraft(draft => {
    const prompt = draft.prompts[props.selectedPromptIndex];
    if (!prompt) {
      return;
    }
    if (value === 'in_chat') {
      prompt.position = { type: 'in_chat', depth: 4, order: 100 };
      return;
    }
    prompt.position = { type: 'relative' };
  });
}

function updatePromptDepth(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isNaN(value)) {
    return;
  }
  mutateDraft(draft => {
    const prompt = draft.prompts[props.selectedPromptIndex];
    if (prompt?.position.type === 'in_chat') {
      prompt.position.depth = Math.max(0, Math.floor(value));
    }
  });
}

function updatePromptOrder(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isNaN(value)) {
    return;
  }
  mutateDraft(draft => {
    const prompt = draft.prompts[props.selectedPromptIndex];
    if (prompt?.position.type === 'in_chat') {
      prompt.position.order = Math.floor(value);
    }
  });
}

function updatePromptEnabled(event: Event): void {
  const value = (event.target as HTMLInputElement).checked;
  mutateDraft(draft => {
    const prompt = draft.prompts[props.selectedPromptIndex];
    if (prompt) {
      prompt.enabled = value;
    }
  });
}

function updatePromptContent(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value;
  mutateDraft(draft => {
    const prompt = draft.prompts[props.selectedPromptIndex];
    if (prompt) {
      prompt.content = value;
    }
  });
}

function updateSettingNumber(key: keyof Preset['settings'], event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isNaN(value)) {
    return;
  }
  mutateDraft(draft => {
    draft.settings[key] = value as Preset['settings'][keyof Preset['settings']];
  });
}

function updateSettingSelect(key: keyof Preset['settings'], event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  mutateDraft(draft => {
    draft.settings[key] = value as Preset['settings'][keyof Preset['settings']];
  });
}

function updateSettingBoolean(key: keyof Preset['settings'], event: Event): void {
  const value = (event.target as HTMLInputElement).checked;
  mutateDraft(draft => {
    draft.settings[key] = value as Preset['settings'][keyof Preset['settings']];
  });
}
</script>

<style scoped>
.edit-shell {
  border: 1px solid rgba(70, 93, 122, 0.7);
  border-radius: 12px;
  overflow: hidden;
  background: linear-gradient(160deg, rgba(17, 24, 39, 0.88), rgba(9, 14, 26, 0.95));
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(70, 93, 122, 0.65);
  flex-wrap: wrap;
}

.mode {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #bfd4f2;
  font-size: 12px;
}

.select,
.input,
.textarea {
  border: 1px solid rgba(78, 105, 140, 0.72);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.9);
  color: #f8fbff;
  padding: 5px 8px;
}

.actions {
  display: inline-flex;
  gap: 8px;
}

.content {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
}

.prompt-list {
  border-right: 1px solid rgba(70, 93, 122, 0.65);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}

.prompt-list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #bfd4f2;
}

.prompt-item {
  border: 1px solid rgba(62, 84, 114, 0.8);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.82);
  color: #e8f2ff;
  text-align: left;
  padding: 7px 8px;
  display: grid;
  gap: 2px;
  cursor: pointer;
}

.prompt-item small {
  color: #8fb2df;
  font-size: 11px;
}

.prompt-item.active {
  border-color: #60a5fa;
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.32) inset;
}

.editor {
  min-height: 0;
  overflow: auto;
  padding: 10px;
  display: grid;
  gap: 12px;
}

.panel {
  border: 1px solid rgba(62, 84, 114, 0.8);
  border-radius: 9px;
  padding: 9px;
  background: rgba(15, 23, 42, 0.75);
  display: grid;
  gap: 8px;
}

.panel h4 {
  margin: 0;
  color: #dbeafe;
  font-size: 13px;
}

.field {
  display: grid;
  gap: 4px;
}

.field > span {
  color: #b8d2f5;
  font-size: 12px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.textarea {
  min-height: 140px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #f4f8ff;
  font-size: 12px;
}

.ops {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
}

.group {
  border: 1px solid rgba(57, 79, 110, 0.62);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.68);
}

.group > summary {
  cursor: pointer;
  list-style: none;
  padding: 8px 10px;
  color: #dbeafe;
  font-size: 12px;
}

.group .fields {
  display: grid;
  gap: 8px;
  padding: 8px;
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

.btn.danger {
  background: #42212a;
  border-color: #fb7185;
}

.btn.mini {
  padding: 4px 10px;
  font-size: 12px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.empty {
  padding: 16px;
  color: #8ba3c7;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .content {
    grid-template-columns: 1fr;
  }

  .prompt-list {
    border-right: none;
    border-bottom: 1px solid rgba(70, 93, 122, 0.65);
    max-height: 220px;
  }

  .row {
    grid-template-columns: 1fr;
  }
}
</style>
