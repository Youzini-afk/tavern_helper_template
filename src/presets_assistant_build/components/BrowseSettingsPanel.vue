<template>
  <section class="settings-panel">
    <div class="head">
      <h3>生成参数（浏览态）</h3>
      <label class="collapse-toggle">
        <input :checked="open" type="checkbox" @change="$emit('toggle-open', ($event.target as HTMLInputElement).checked)" />
        <span>展开</span>
      </label>
    </div>

    <div v-if="open" class="groups">
      <details
        v-for="group in groups"
        :key="group.id"
        :open="group.id === expandedGroup"
        class="group"
        @toggle="onGroupToggle(group.id, $event)"
      >
        <summary>{{ group.title }}</summary>
        <div class="fields">
          <label v-for="field in group.fields" :key="String(field.key)" class="field">
            <span>
              {{ field.label }}
              <i v-if="isFieldChanged(field)">已改</i>
            </span>

            <input
              v-if="field.type === 'number'"
              :value="toNumberInputValue(stagedSettings[field.key])"
              type="number"
              class="input"
              :min="field.min"
              :max="field.max"
              :step="field.step ?? 1"
              @input="onNumberInput(field, $event)"
            />

            <select
              v-else-if="field.type === 'select'"
              class="input"
              :value="String(stagedSettings[field.key])"
              @change="onSelectInput(field, $event)"
            >
              <option v-for="option in field.options" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>

            <label v-else class="check">
              <input
                :checked="Boolean(stagedSettings[field.key])"
                type="checkbox"
                @change="onBooleanInput(field, $event)"
              />
              <span>{{ Boolean(stagedSettings[field.key]) ? '开启' : '关闭' }}</span>
            </label>
          </label>
        </div>
      </details>
    </div>

    <div v-if="open" class="actions">
      <button class="btn" type="button" :disabled="!dirty || applying" @click="$emit('reset')">重置</button>
      <button class="btn primary" type="button" :disabled="!dirty || applying" @click="$emit('apply')">
        {{ applying ? '应用中...' : '应用' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import _ from 'lodash';

import { presetSettingGroups } from '../core/presetMapper';
import type { SettingField } from '../types';

const props = defineProps<{
  stagedSettings: Preset['settings'];
  baseSettings: Preset['settings'];
  dirty: boolean;
  applying: boolean;
  open: boolean;
  expandedGroup: string;
}>();

const emit = defineEmits<{
  apply: [];
  reset: [];
  'toggle-open': [open: boolean];
  'set-expanded-group': [groupId: string];
  'update-setting': [key: keyof Preset['settings'], value: Preset['settings'][keyof Preset['settings']]];
}>();

const groups = presetSettingGroups;

function isFieldChanged(field: SettingField): boolean {
  return !_.isEqual(props.baseSettings[field.key], props.stagedSettings[field.key]);
}

function toNumberInputValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function onGroupToggle(groupId: string, event: Event): void {
  const target = event.target as HTMLDetailsElement;
  if (target.open) {
    emit('set-expanded-group', groupId);
  }
}

function onNumberInput(field: SettingField, event: Event): void {
  const target = event.target as HTMLInputElement;
  const next = Number(target.value);
  if (Number.isNaN(next)) {
    return;
  }
  emit('update-setting', field.key, next as Preset['settings'][keyof Preset['settings']]);
}

function onSelectInput(field: SettingField, event: Event): void {
  const target = event.target as HTMLSelectElement;
  emit('update-setting', field.key, target.value as Preset['settings'][keyof Preset['settings']]);
}

function onBooleanInput(field: SettingField, event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update-setting', field.key, target.checked as Preset['settings'][keyof Preset['settings']]);
}
</script>

<style scoped>
.settings-panel {
  border: 1px solid rgba(70, 93, 122, 0.7);
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(17, 24, 39, 0.9), rgba(8, 13, 24, 0.95));
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.head {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(70, 93, 122, 0.65);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.head h3 {
  margin: 0;
  font-size: 14px;
  color: #f8fbff;
}

.collapse-toggle {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: #a8c6f0;
  font-size: 12px;
}

.groups {
  overflow: auto;
  max-height: 420px;
  padding: 8px;
  display: grid;
  gap: 8px;
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
  font-size: 13px;
  border-bottom: 1px solid rgba(57, 79, 110, 0.5);
}

.fields {
  display: grid;
  gap: 8px;
  padding: 9px;
}

.field {
  display: grid;
  gap: 4px;
}

.field > span {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: #b8d2f5;
  font-size: 12px;
}

.field > span i {
  font-style: normal;
  color: #fbbf24;
  font-size: 11px;
}

.input {
  border: 1px solid rgba(78, 105, 140, 0.72);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.9);
  color: #f8fbff;
  padding: 5px 8px;
  min-height: 32px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #f4f8ff;
  font-size: 12px;
}

.actions {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(70, 93, 122, 0.65);
  background: rgba(6, 10, 20, 0.9);
  backdrop-filter: blur(6px);
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

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
