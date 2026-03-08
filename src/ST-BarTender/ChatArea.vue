<template>
  <div class="chat-area">
    <!-- 消息列表 -->
    <div ref="messagesRef" class="chat-area__messages">
      <div v-if="store.chatHistory.length === 0" class="chat-area__empty">
        <i class="fa-solid fa-comments" />
        <p>描述你想要的控制面板布局</p>
        <p class="chat-area__hint">例如：「把所有 COT 相关条目放一组，文风相关放一组」</p>
      </div>

      <div
        v-for="msg in store.chatHistory"
        :key="msg.id"
        class="chat-area__bubble"
        :class="{ 'chat-area__bubble--user': msg.role === 'user', 'chat-area__bubble--ai': msg.role === 'assistant' }"
      >
        <div class="chat-area__bubble-role">
          <i :class="msg.role === 'user' ? 'fa-solid fa-user' : 'fa-solid fa-robot'" />
        </div>
        <div class="chat-area__bubble-content">{{ msg.content }}</div>
      </div>

      <div v-if="store.isLoading" class="chat-area__loading">
        <i class="fa-solid fa-spinner fa-spin" />
        <span>AI 正在生成...</span>
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
      <button
        class="chat-area__send-btn"
        :disabled="!inputText.trim() || store.isLoading"
        @click="handleSend"
      >
        <i class="fa-solid fa-paper-plane" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from './store';

const store = useStore();
const inputText = ref('');
const promptDialogOpen = ref(false);

// 可写计算属性：显示自定义或默认，只有用户实际编辑时才写入 custom_system_prompt
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
const messagesRef = ref<HTMLElement>();

async function handleSend() {
  const text = inputText.value.trim();
  if (!text || store.isLoading) return;

  inputText.value = '';
  await store.sendChat(text);

  // 滚动到底部
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

.chat-area__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
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
