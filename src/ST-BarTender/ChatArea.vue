<template>
  <div class="chat-area">
    <!-- 消息列表 -->
    <div ref="messagesRef" class="chat-area__messages">
      <div v-if="store.chatHistory.length === 0" class="chat-area__empty">
        <i class="fa-solid fa-comments" />
        <p>描述你想要的控制面板布局</p>
        <p class="chat-area__hint">例如：「把所有 COT 相关条目放一组，文风相关放一组」</p>
      </div>

      <transition-group name="chat-bubble">
        <div
          v-for="msg in store.chatHistory"
          :key="msg.id"
          class="chat-area__bubble"
          :class="{ 'chat-area__bubble--user': msg.role === 'user', 'chat-area__bubble--ai': msg.role === 'assistant' }"
          @mouseenter="hoveredMsgId = msg.id"
          @mouseleave="hoveredMsgId = ''"
        >
          <div class="chat-area__bubble-role">
            <i :class="msg.role === 'user' ? 'fa-solid fa-user' : 'fa-solid fa-robot'" />
          </div>

          <div class="chat-area__bubble-body">
            <!-- 编辑模式 -->
            <div v-if="editingMsgId === msg.id" class="chat-area__bubble-edit-wrap">
              <textarea
                ref="editTextareaRef"
                v-model="editDraft"
                class="chat-area__bubble-edit-textarea"
                @keydown.ctrl.enter="confirmEdit(msg.id)"
                @keydown.escape="cancelEdit"
              />
              <div class="chat-area__bubble-edit-actions">
                <button
                  class="chat-area__bubble-action-btn chat-area__bubble-action-btn--confirm"
                  title="确认 (Ctrl+Enter)"
                  @click="confirmEdit(msg.id)"
                >
                  <i class="fa-solid fa-check" />
                </button>
                <button
                  class="chat-area__bubble-action-btn chat-area__bubble-action-btn--cancel"
                  title="取消 (Esc)"
                  @click="cancelEdit"
                >
                  <i class="fa-solid fa-xmark" />
                </button>
              </div>
            </div>

            <!-- 正常显示 -->
            <div v-else class="chat-area__bubble-content">{{ msg.content }}</div>

            <!-- 操作栏（消息下方，常驻显示） -->
            <div v-if="editingMsgId !== msg.id && !store.isLoading" class="chat-area__bubble-toolbar">
              <template v-if="msg.role === 'user'">
                <button class="chat-area__bubble-action-btn" title="编辑" @click="startEdit(msg)">
                  <i class="fa-solid fa-pen" />
                </button>
              </template>
              <template v-else>
                <button class="chat-area__bubble-action-btn" title="重新生成" @click="store.rerollLastAI()">
                  <i class="fa-solid fa-rotate" />
                </button>
              </template>
              <button
                class="chat-area__bubble-action-btn chat-area__bubble-action-btn--danger"
                title="删除"
                @click="store.deleteMessage(msg.id)"
              >
                <i class="fa-solid fa-trash-can" />
              </button>
            </div>
          </div>
        </div>
      </transition-group>

      <!-- 流式输出气泡 -->
      <div v-if="store.isLoading" class="chat-area__bubble chat-area__bubble--ai">
        <div class="chat-area__bubble-role">
          <i class="fa-solid fa-robot" />
        </div>
        <div ref="streamingRef" class="chat-area__bubble-content chat-area__bubble-content--streaming">
          <template v-if="store.streamingText">{{ store.streamingText }}</template>
          <template v-else><i class="fa-solid fa-spinner fa-spin" /> AI 正在生成...</template>
        </div>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div class="chat-area__shortcuts">
      <button class="chat-area__shortcut-btn" title="从预设扫描" @click="store.autoGenerateFromPreset()">
        <i class="fa-solid fa-magnifying-glass" />
        从预设扫描
      </button>
      <button
        class="chat-area__shortcut-btn"
        :class="{ 'chat-area__shortcut-btn--active': store.settings.custom_system_prompt }"
        title="系统提示词"
        @click="openPromptDialog"
      >
        <i class="fa-solid fa-scroll" />
      </button>
      <button class="chat-area__shortcut-btn" title="清空对话" @click="store.clearChat()">
        <i class="fa-solid fa-trash-can" />
      </button>
    </div>

    <!-- 系统提示词弹窗 -->
    <div
      v-if="promptDialogOpen"
      class="prompt-dialog__backdrop"
      @pointerdown.self="promptDialogOpen = false"
      @click.self="promptDialogOpen = false"
    >
      <div class="prompt-dialog" @pointerdown.stop @click.stop>
        <div class="prompt-dialog__header">
          <span class="prompt-dialog__title">系统提示词</span>
          <button class="prompt-dialog__close" @click="promptDialogOpen = false">
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
        <div class="prompt-dialog__body">
          <textarea v-model="effectivePrompt" class="prompt-dialog__textarea" />
        </div>
        <div class="prompt-dialog__footer">
          <button class="prompt-dialog__reset" @click="resetPrompt">
            <i class="fa-solid fa-rotate-left" /> 恢复默认
          </button>
          <span class="prompt-dialog__hint">编辑后自动保存，恢复默认将使用自动生成的提示词</span>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="chat-area__input-row">
      <input
        v-model="inputText"
        class="chat-area__input"
        placeholder="描述你想要的面板..."
        :disabled="store.isLoading"
        @keydown.enter.prevent="handleSend"
      />
      <!-- 发送 / 停止 按钮 -->
      <button
        v-if="store.isLoading"
        class="chat-area__send-btn chat-area__send-btn--stop"
        title="停止生成"
        @click="store.abortGeneration()"
      >
        <i class="fa-solid fa-stop" />
      </button>
      <button v-else class="chat-area__send-btn" :disabled="!inputText.trim()" @click="handleSend">
        <i class="fa-solid fa-paper-plane" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessage } from './schema';
import { useStore } from './store';

const store = useStore();
const inputText = ref('');
const promptDialogOpen = ref(false);

// ========== 消息 hover & 编辑状态 ==========
const hoveredMsgId = ref('');
const editingMsgId = ref('');
const editDraft = ref('');
const editTextareaRef = ref<HTMLTextAreaElement[]>();

function startEdit(msg: ChatMessage) {
  editingMsgId.value = msg.id;
  editDraft.value = msg.content;
  nextTick(() => {
    const el = editTextareaRef.value?.[0];
    if (el) {
      el.focus();
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  });
}

function confirmEdit(msgId: string) {
  const trimmed = editDraft.value.trim();
  if (trimmed) {
    store.editMessage(msgId, trimmed);
  }
  editingMsgId.value = '';
  editDraft.value = '';
}

function cancelEdit() {
  editingMsgId.value = '';
  editDraft.value = '';
}

// ========== 系统提示词 ==========
const effectivePrompt = computed({
  get: () => {
    if (store.settings.custom_system_prompt) {
      return store.settings.custom_system_prompt;
    }
    store.scanPreset();
    return store.getDefaultSystemPrompt();
  },
  set: (val: string) => {
    store.settings.custom_system_prompt = val;
  },
});

function openPromptDialog() {
  promptDialogOpen.value = true;
}

function resetPrompt() {
  store.settings.custom_system_prompt = '';
}

// ========== 发送 ==========
const messagesRef = ref<HTMLElement>();

async function handleSend() {
  const text = inputText.value.trim();
  if (!text || store.isLoading) return;

  inputText.value = '';
  await store.sendChat(text);

  await nextTick();
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}

// 自动滚动
watch(
  () => store.chatHistory.length,
  async () => {
    await nextTick();
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
    }
  },
);

// 流式输出时智能滚动——同时处理外层消息列表和内层流式气泡
function isNearBottom(): boolean {
  const el = messagesRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

const streamingRef = ref<HTMLElement>();

function isStreamingNearBottom(): boolean {
  const el = streamingRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
}

watch(
  () => store.streamingText,
  async () => {
    const scrollOuter = isNearBottom();
    const scrollInner = isStreamingNearBottom();
    await nextTick();
    if (scrollOuter && messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
    }
    if (scrollInner && streamingRef.value) {
      streamingRef.value.scrollTop = streamingRef.value.scrollHeight;
    }
  },
);
</script>

<style scoped>
.chat-area {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

.chat-area__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overscroll-behavior: contain;
}

.chat-area__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--ub-text-muted);
  text-align: center;
  gap: 4px;
}

.chat-area__empty i {
  font-size: 28px;
  margin-bottom: 8px;
}

.chat-area__empty p {
  margin: 0;
  font-size: 13px;
}

.chat-area__hint {
  font-size: 11px !important;
  color: var(--ub-text-muted) !important;
}

/* --- Bubbles --- */
.chat-area__bubble {
  display: flex;
  gap: 8px;
  max-width: 95%;
  transition: all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* 列表过渡动画 */
.chat-bubble-enter-active,
.chat-bubble-leave-active,
.chat-bubble-move {
  transition: all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.chat-bubble-leave-active {
  position: absolute;
}

.chat-bubble-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.chat-bubble-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

.chat-area__bubble--user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.chat-area__bubble--ai {
  align-self: flex-start;
}

.chat-area__bubble-role {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

.chat-area__bubble--user .chat-area__bubble-role {
  background: var(--ub-accent-bg);
  color: var(--ub-accent-text);
}

.chat-area__bubble--ai .chat-area__bubble-role {
  background: var(--ub-success-bg);
  color: var(--ub-success-text);
}

.chat-area__bubble-content {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-area__bubble--user .chat-area__bubble-content {
  background: var(--ub-accent-bg);
  color: var(--ub-text-main);
  border-bottom-right-radius: 4px;
}

.chat-area__bubble--ai .chat-area__bubble-content {
  background: var(--ub-bg-glass);
  color: var(--ub-text-secondary);
  border-bottom-left-radius: 4px;
}

.chat-area__bubble-content--streaming {
  max-height: 300px;
  overflow-y: auto;
  font-size: 11px;
  opacity: 0.7;
}

/* --- Bubble Body (wraps content + toolbar) --- */
.chat-area__bubble-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* --- Bubble Toolbar (below message) --- */
.chat-area__bubble-toolbar {
  display: flex;
  gap: 2px;
  padding: 2px 0;
  animation: toolbar-in 0.12s ease-out;
}

.chat-area__bubble--user .chat-area__bubble-toolbar {
  justify-content: flex-end;
}

@keyframes toolbar-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.chat-area__bubble-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ub-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition:
    background 0.12s,
    color 0.12s;
}

.chat-area__bubble-action-btn:hover {
  background: var(--ub-bg-hover);
  color: var(--ub-text-main);
}

.chat-area__bubble-action-btn--danger:hover {
  background: var(--ub-danger-bg);
  color: var(--ub-danger-text);
}

.chat-area__bubble-action-btn--confirm:hover {
  background: var(--ub-success-bg);
  color: var(--ub-success-text);
}

.chat-area__bubble-action-btn--cancel:hover {
  background: var(--ub-danger-bg);
  color: var(--ub-danger-text);
}

/* --- Bubble Edit --- */
.chat-area__bubble-edit-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.chat-area__bubble-edit-textarea {
  width: 100%;
  min-height: 40px;
  max-height: 200px;
  padding: 8px 10px;
  border: 1px solid var(--ub-accent-border);
  border-radius: 8px;
  background: var(--ub-input-bg);
  color: var(--ub-text-main);
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s;
}

.chat-area__bubble-edit-textarea:focus {
  border-color: var(--ub-accent-active);
}

.chat-area__bubble-edit-actions {
  display: flex;
  gap: 4px;
  align-self: flex-end;
}

/* --- Shortcuts --- */
.chat-area__shortcuts {
  display: flex;
  gap: 4px;
  padding: 4px 12px;
  border-top: 1px solid var(--ub-border);
}

.chat-area__shortcut-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: var(--ub-border);
  color: var(--ub-text-muted);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  touch-action: manipulation;
}

.chat-area__shortcut-btn:hover {
  background: var(--ub-bg-hover);
  color: var(--ub-text-main);
}

/* --- Input --- */
.chat-area__input-row {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--ub-border);
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
}

.chat-area__input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--ub-border) !important;
  border-radius: 8px;
  background: var(--ub-input-bg) !important;
  color: var(--ub-text-main) !important;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.chat-area__input:focus {
  border-color: var(--ub-accent-border);
}

.chat-area__input::placeholder {
  color: var(--ub-text-muted);
}

.chat-area__send-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: var(--ub-accent-bg);
  color: var(--ub-accent-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    transform 0.1s;
  touch-action: manipulation;
}

.chat-area__send-btn:hover:not(:disabled) {
  background: var(--ub-accent-border);
  transform: scale(1.05);
}

.chat-area__send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* 停止按钮样式 */
.chat-area__send-btn--stop {
  background: var(--ub-danger-bg);
  color: var(--ub-danger-text);
}

.chat-area__send-btn--stop:hover {
  background: var(--ub-danger-text);
  transform: scale(1.05);
}

/* 系统提示词按钮高亮 */
.chat-area__shortcut-btn--active {
  color: var(--ub-accent-text) !important;
  border-color: var(--ub-accent-bg) !important;
}

/* 系统提示词弹窗 */
.prompt-dialog__backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: var(--ub-bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: prompt-fade-in 0.15s ease-out;
}

@keyframes prompt-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.prompt-dialog {
  width: min(560px, 90vw);
  max-height: min(80vh, calc(100dvh - 24px));
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: var(--ub-bg-solid);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--ub-border);
  box-shadow: 0 16px 48px var(--ub-shadow);
  animation: prompt-dialog-in 0.2s ease-out;
}

@keyframes prompt-dialog-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(12px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.prompt-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ub-border);
}

.prompt-dialog__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ub-text-main);
}

.prompt-dialog__close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ub-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  transition:
    background 0.15s,
    color 0.15s;
}

.prompt-dialog__close:hover {
  background: var(--ub-bg-hover);
  color: var(--ub-text-main);
}

.prompt-dialog__body {
  flex: 1;
  padding: 12px 16px;
  overflow: hidden;
}

.prompt-dialog__textarea {
  width: 100%;
  height: 320px;
  resize: vertical;
  padding: 10px;
  border: 1px solid var(--ub-border);
  border-radius: 8px;
  background: var(--ub-shadow);
  color: var(--ub-text-main);
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  line-height: 1.6;
  outline: none;
  transition: border-color 0.2s;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.prompt-dialog__textarea:focus {
  border-color: var(--ub-accent-border);
}

.prompt-dialog__textarea::placeholder {
  color: var(--ub-text-muted);
}

.prompt-dialog__footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--ub-border);
}

.prompt-dialog__reset {
  border: none;
  border-radius: 6px;
  padding: 5px 10px;
  background: var(--ub-border);
  color: var(--ub-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}

.prompt-dialog__reset:hover {
  background: var(--ub-bg-hover);
  color: var(--ub-text-main);
}

.prompt-dialog__hint {
  font-size: 11px;
  color: var(--ub-text-muted);
}

@media (pointer: coarse) {
  .chat-area__bubble-action-btn {
    width: 32px;
    height: 32px;
    font-size: 13px;
  }

  .chat-area__shortcut-btn {
    min-height: 36px;
    padding: 6px 10px;
    font-size: 12px;
  }

  .chat-area__input {
    min-height: 40px;
    font-size: 14px;
  }

  .chat-area__send-btn {
    width: 40px;
    height: 40px;
  }

  .prompt-dialog__close,
  .prompt-dialog__reset {
    min-height: 36px;
  }
}

@media (max-width: 768px) {
  .chat-area__shortcuts {
    flex-wrap: wrap;
  }

  .chat-area__shortcut-btn {
    flex: 1 1 calc(50% - 4px);
    justify-content: center;
  }

  .prompt-dialog {
    width: calc(100vw - 20px);
    max-height: calc(100dvh - 20px);
    border-radius: 12px;
  }

  .prompt-dialog__body {
    padding: 10px 12px;
  }

  .prompt-dialog__textarea {
    height: min(48vh, 360px);
    font-size: 13px;
  }

  .prompt-dialog__footer {
    flex-wrap: wrap;
    align-items: stretch;
  }
}
</style>
