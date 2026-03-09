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
                <button class="chat-area__bubble-action-btn chat-area__bubble-action-btn--confirm" title="确认 (Ctrl+Enter)" @click="confirmEdit(msg.id)">
                  <i class="fa-solid fa-check" />
                </button>
                <button class="chat-area__bubble-action-btn chat-area__bubble-action-btn--cancel" title="取消 (Esc)" @click="cancelEdit">
                  <i class="fa-solid fa-xmark" />
                </button>
              </div>
            </div>

            <!-- 正常显示 -->
            <div v-else class="chat-area__bubble-content">{{ msg.content }}</div>

            <!-- 操作栏（消息下方） -->
            <div
              v-if="hoveredMsgId === msg.id && editingMsgId !== msg.id && !store.isLoading"
              class="chat-area__bubble-toolbar"
            >
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
              <button class="chat-area__bubble-action-btn chat-area__bubble-action-btn--danger" title="删除" @click="store.deleteMessage(msg.id)">
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
        <div class="chat-area__bubble-content chat-area__bubble-content--streaming">
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
    <div v-if="promptDialogOpen" class="prompt-dialog__backdrop" @mousedown.self="promptDialogOpen = false">
      <div class="prompt-dialog" @mousedown.stop>
        <div class="prompt-dialog__header">
          <span class="prompt-dialog__title">系统提示词</span>
          <button class="prompt-dialog__close" @click="promptDialogOpen = false">
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
        <div class="prompt-dialog__body">
          <textarea
            v-model="effectivePrompt"
            class="prompt-dialog__textarea"
          />
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
      <button
        v-else
        class="chat-area__send-btn"
        :disabled="!inputText.trim()"
        @click="handleSend"
      >
        <i class="fa-solid fa-paper-plane" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from './store';
import type { ChatMessage } from './schema';

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

// 流式输出时也滚动到底部
watch(
  () => store.streamingText,
  async () => {
    await nextTick();
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
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
}

.chat-area__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(255, 255, 255, 0.3);
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
  color: rgba(255, 255, 255, 0.2) !important;
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
  background: rgba(100, 181, 246, 0.2);
  color: #64b5f6;
}

.chat-area__bubble--ai .chat-area__bubble-role {
  background: rgba(129, 199, 132, 0.2);
  color: #81c784;
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
  background: rgba(100, 181, 246, 0.12);
  color: rgba(255, 255, 255, 0.9);
  border-bottom-right-radius: 4px;
}

.chat-area__bubble--ai .chat-area__bubble-content {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
  border-bottom-left-radius: 4px;
}

.chat-area__bubble-content--streaming {
  max-height: 200px;
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
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}

.chat-area__bubble-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition: background 0.12s, color 0.12s;
}

.chat-area__bubble-action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.chat-area__bubble-action-btn--danger:hover {
  background: rgba(244, 67, 54, 0.15);
  color: #ef5350;
}

.chat-area__bubble-action-btn--confirm:hover {
  background: rgba(76, 175, 80, 0.15);
  color: #66bb6a;
}

.chat-area__bubble-action-btn--cancel:hover {
  background: rgba(244, 67, 54, 0.15);
  color: #ef5350;
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
  border: 1px solid rgba(100, 181, 246, 0.35);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s;
}

.chat-area__bubble-edit-textarea:focus {
  border-color: rgba(100, 181, 246, 0.6);
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
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.chat-area__shortcut-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.chat-area__shortcut-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

/* --- Input --- */
.chat-area__input-row {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.chat-area__input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.chat-area__input:focus {
  border-color: rgba(100, 181, 246, 0.4);
}

.chat-area__input::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.chat-area__send-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: rgba(100, 181, 246, 0.2);
  color: #64b5f6;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.1s;
}

.chat-area__send-btn:hover:not(:disabled) {
  background: rgba(100, 181, 246, 0.35);
  transform: scale(1.05);
}

.chat-area__send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* 停止按钮样式 */
.chat-area__send-btn--stop {
  background: rgba(244, 67, 54, 0.2);
  color: #ef5350;
}

.chat-area__send-btn--stop:hover {
  background: rgba(244, 67, 54, 0.35);
  transform: scale(1.05);
}

/* 系统提示词按钮高亮 */
.chat-area__shortcut-btn--active {
  color: #64b5f6 !important;
  border-color: rgba(100, 181, 246, 0.25) !important;
}

/* 系统提示词弹窗 */
.prompt-dialog__backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: prompt-fade-in 0.15s ease-out;
}

@keyframes prompt-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.prompt-dialog {
  width: min(560px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(22, 22, 30, 0.96);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  animation: prompt-dialog-in 0.2s ease-out;
}

@keyframes prompt-dialog-in {
  from { opacity: 0; transform: scale(0.94) translateY(12px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.prompt-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.prompt-dialog__title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.prompt-dialog__close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
}

.prompt-dialog__close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
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
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.85);
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
  border-color: rgba(100, 181, 246, 0.35);
}

.prompt-dialog__textarea::placeholder {
  color: rgba(255, 255, 255, 0.15);
}

.prompt-dialog__footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.prompt-dialog__reset {
  border: none;
  border-radius: 6px;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.prompt-dialog__reset:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
}

.prompt-dialog__hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
}
</style>
