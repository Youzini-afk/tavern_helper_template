<template>
  <div class="ew-prompt-order">
    <div class="ew-prompt-order__list">
      <div
        v-for="(entry, idx) in displayOrder"
        :key="entry.identifier"
        class="ew-prompt-order__item"
        :class="{
          'ew-prompt-order__item--disabled': !entry.enabled,
          'ew-prompt-order__item--marker': entry.type === 'marker',
          'ew-prompt-order__item--editing': editingId === entry.identifier,
        }"
        :draggable="true"
        @dragstart="onDragStart(idx, $event)"
        @dragover.prevent="onDragOver(idx)"
        @dragend="onDragEnd"
      >
        <div class="ew-prompt-order__row">
          <span class="ew-prompt-order__handle" title="拖拽排序">☰</span>
          <span class="ew-prompt-order__icon" :title="entry.type === 'marker' ? '系统标记' : '可编辑提示词'">
            {{ entry.type === 'marker' ? '📌' : '📄' }}
          </span>
          <span class="ew-prompt-order__name">{{ entry.name || entry.identifier }}</span>

          <!-- Inline chips for prompt-type entries -->
          <template v-if="entry.type === 'prompt'">
            <span class="ew-prompt-order__chip">{{ entry.role }}</span>
            <span class="ew-prompt-order__chip">{{ entry.injection_position === 'in_chat' ? '聊天中' : '相对' }}</span>
            <span v-if="entry.injection_position === 'in_chat'" class="ew-prompt-order__chip">深度 {{ entry.injection_depth }}</span>
          </template>
          <span v-else-if="entry.role !== 'system'" class="ew-prompt-order__chip">{{ entry.role }}</span>

          <div class="ew-prompt-order__actions">
            <button
              v-if="entry.type === 'prompt'"
              type="button"
              class="ew-mini-btn"
              title="编辑"
              @click="toggleEdit(entry.identifier)"
            >✎</button>
            <button
              v-if="canDelete(entry)"
              type="button"
              class="ew-mini-btn ew-mini-btn--danger"
              title="删除"
              @click="removeEntry(entry.identifier)"
            >✕</button>
            <label class="ew-switch ew-prompt-order__toggle">
              <input type="checkbox" :checked="entry.enabled" @change="toggleEnabled(entry.identifier)" />
              <span class="ew-switch__slider"></span>
            </label>
          </div>
        </div>

        <!-- Inline editor for 'prompt' type entries -->
        <transition name="ew-expand">
          <div v-if="editingId === entry.identifier && entry.type === 'prompt'" class="ew-prompt-order__editor">
            <div class="ew-prompt-order__editor-grid">
              <label class="ew-prompt-order__editor-label">
                名称
                <input type="text" :value="entry.name" @input="patchEntry(entry.identifier, 'name', ($event.target as HTMLInputElement).value)" />
              </label>
              <label class="ew-prompt-order__editor-label">
                角色
                <select :value="entry.role" @change="patchEntry(entry.identifier, 'role', ($event.target as HTMLSelectElement).value)">
                  <option value="system">system</option>
                  <option value="user">user</option>
                  <option value="assistant">assistant</option>
                </select>
              </label>
              <label class="ew-prompt-order__editor-label">
                插入位置
                <select :value="entry.injection_position" @change="patchEntry(entry.identifier, 'injection_position', ($event.target as HTMLSelectElement).value)">
                  <option value="relative">相对</option>
                  <option value="in_chat">聊天中</option>
                </select>
              </label>
              <label v-if="entry.injection_position === 'in_chat'" class="ew-prompt-order__editor-label">
                注入深度
                <input type="number" min="0" :value="entry.injection_depth" @input="patchEntry(entry.identifier, 'injection_depth', Number(($event.target as HTMLInputElement).value) || 0)" />
              </label>
            </div>
            <label class="ew-prompt-order__editor-label">
              内容
              <textarea
                :value="entry.content"
                rows="4"
                placeholder="在此输入提示词内容..."
                @input="patchEntry(entry.identifier, 'content', ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </label>
          </div>
        </transition>
      </div>
    </div>

    <button type="button" class="ew-prompt-order__add" @click="addCustomEntry">
      + 新增自定义提示词
    </button>
  </div>
</template>

<script setup lang="ts">
import type { EwPromptOrderEntry } from '../../runtime/types';
import { BUILTIN_MARKERS, BUILTIN_PROMPTS } from '../../runtime/types';
import { simpleHash } from '../../runtime/helpers';

const props = defineProps<{
  promptOrder: EwPromptOrderEntry[];
}>();

const emit = defineEmits<{
  (event: 'update:promptOrder', value: EwPromptOrderEntry[]): void;
}>();

const editingId = ref<string | null>(null);
let dragFromIdx = -1;
const dragPreview = ref<EwPromptOrderEntry[] | null>(null);

/** The displayed list: use drag preview during drag, else props */
const displayOrder = computed(() => dragPreview.value ?? props.promptOrder);

function clone(source?: EwPromptOrderEntry[]): EwPromptOrderEntry[] {
  return JSON.parse(JSON.stringify(source ?? props.promptOrder));
}

function toggleEdit(identifier: string) {
  editingId.value = editingId.value === identifier ? null : identifier;
}

function canDelete(entry: EwPromptOrderEntry): boolean {
  return !BUILTIN_MARKERS.has(entry.identifier) && !BUILTIN_PROMPTS.has(entry.identifier);
}

function toggleEnabled(identifier: string) {
  const next = clone();
  const target = next.find(e => e.identifier === identifier);
  if (target) {
    target.enabled = !target.enabled;
    emit('update:promptOrder', next);
  }
}

function patchEntry(identifier: string, field: keyof EwPromptOrderEntry, value: any) {
  const next = clone();
  const target = next.find(e => e.identifier === identifier);
  if (target) {
    (target as any)[field] = value;
    emit('update:promptOrder', next);
  }
}

function removeEntry(identifier: string) {
  const next = clone().filter(e => e.identifier !== identifier);
  if (editingId.value === identifier) {
    editingId.value = null;
  }
  emit('update:promptOrder', next);
}

function addCustomEntry() {
  const next = clone();
  const id = `custom_${simpleHash(String(Date.now()))}`;
  next.push({
    identifier: id,
    name: `自定义提示词 ${next.filter(e => !BUILTIN_MARKERS.has(e.identifier) && !BUILTIN_PROMPTS.has(e.identifier)).length + 1}`,
    enabled: true,
    type: 'prompt',
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  });
  emit('update:promptOrder', next);
  editingId.value = id;
}

// ── Drag-and-drop reorder (PERF-1: only emit on dragend) ───────────────
function onDragStart(idx: number, e: DragEvent) {
  dragFromIdx = idx;
  dragPreview.value = clone();
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
  }
}

function onDragOver(toIdx: number) {
  if (dragFromIdx < 0 || dragFromIdx === toIdx || !dragPreview.value) return;
  const [moved] = dragPreview.value.splice(dragFromIdx, 1);
  dragPreview.value.splice(toIdx, 0, moved);
  dragFromIdx = toIdx;
}

function onDragEnd() {
  if (dragPreview.value) {
    emit('update:promptOrder', dragPreview.value);
    dragPreview.value = null;
  }
  dragFromIdx = -1;
}
</script>

<style scoped>
.ew-prompt-order__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ew-prompt-order__item {
  background: var(--ew-bg-elevated, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--ew-border, rgba(255, 255, 255, 0.08));
  border-radius: 6px;
  transition: opacity 0.15s, box-shadow 0.15s;
  cursor: grab;
}

.ew-prompt-order__item:active {
  cursor: grabbing;
}

.ew-prompt-order__item--disabled {
  opacity: 0.45;
}

.ew-prompt-order__item--editing {
  border-color: var(--ew-accent, #80a0ff);
}

.ew-prompt-order__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  min-height: 36px;
}

.ew-prompt-order__handle {
  cursor: grab;
  opacity: 0.4;
  font-size: 14px;
  user-select: none;
  flex-shrink: 0;
}

.ew-prompt-order__item:hover .ew-prompt-order__handle {
  opacity: 0.8;
}

.ew-prompt-order__icon {
  flex-shrink: 0;
  font-size: 13px;
}

.ew-prompt-order__name {
  flex: 1;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ew-text, #ddd);
}

.ew-prompt-order__item--marker .ew-prompt-order__name {
  color: var(--ew-text-muted, #aaa);
}

.ew-prompt-order__chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--ew-chip-bg, rgba(255, 255, 255, 0.06));
  color: var(--ew-text-muted, #aaa);
  flex-shrink: 0;
}

.ew-prompt-order__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.ew-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ew-text-muted, #888);
  font-size: 14px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  line-height: 1;
}

.ew-mini-btn:hover {
  color: var(--ew-text, #ddd);
  background: rgba(255, 255, 255, 0.08);
}

.ew-mini-btn--danger:hover {
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
}

.ew-prompt-order__toggle {
  margin-left: 2px;
}

/* ── Inline editor ── */
.ew-prompt-order__editor {
  padding: 8px 10px 10px;
  border-top: 1px solid var(--ew-border, rgba(255, 255, 255, 0.08));
}

.ew-prompt-order__editor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

.ew-prompt-order__editor-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--ew-text-muted, #aaa);
}

.ew-prompt-order__editor-label input,
.ew-prompt-order__editor-label select,
.ew-prompt-order__editor-label textarea {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--ew-border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  background: var(--ew-input-bg, rgba(0, 0, 0, 0.2));
  color: var(--ew-text, #ddd);
  resize: vertical;
}

/* ── Add button ── */
.ew-prompt-order__add {
  margin-top: 8px;
  width: 100%;
  padding: 8px;
  border: 1px dashed var(--ew-border, rgba(255, 255, 255, 0.12));
  border-radius: 6px;
  background: transparent;
  color: var(--ew-text-muted, #aaa);
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.15s, color 0.15s;
}

.ew-prompt-order__add:hover {
  border-color: var(--ew-accent, #80a0ff);
  color: var(--ew-accent, #80a0ff);
}

/* ew-switch (scoped duplicate to ensure availability) */
.ew-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.ew-switch input { display: none; }
.ew-switch__slider {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.12);
  position: relative;
  transition: background 0.2s;
}
.ew-switch__slider::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #888;
  top: 2px;
  left: 2px;
  transition: transform 0.2s, background 0.2s;
}
.ew-switch input:checked + .ew-switch__slider {
  background: var(--ew-accent, #80a0ff);
}
.ew-switch input:checked + .ew-switch__slider::after {
  transform: translateX(14px);
  background: #fff;
}

/* ew-expand transition */
.ew-expand-enter-active,
.ew-expand-leave-active {
  transition: max-height 0.2s ease, opacity 0.2s ease;
  overflow: hidden;
}
.ew-expand-enter-from,
.ew-expand-leave-to {
  max-height: 0;
  opacity: 0;
}
.ew-expand-enter-to,
.ew-expand-leave-from {
  max-height: 400px;
  opacity: 1;
}
</style>
