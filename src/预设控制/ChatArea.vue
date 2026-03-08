<template>
  <div class="chat-area">
    <!-- 消息列表 -->
    <div ref="messagesRef" class="chat-area__messages">
      <div v-if="store.chatHistory.length === 0" class="chat-area__empty">
        <i class="fa-solid fa-comments" />
        <p>描述你想要的控制面板布局</p>
        <p class="chat-area__hint">例如：「把所有 COT 相关条目放一组，翻译相关放一组」</p>
      </div>

      <div
        v-for="(msg, idx) in store.chatHistory"
        :key="idx"
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
      <button class="chat-area__shortcut-btn" @click="store.autoGenerateFromPreset()" title="从预设扫描">
        <i class="fa-solid fa-magnifying-glass" />
        从预设扫描
      </button>
      <button class="chat-area__shortcut-btn" @click="store.clearChat()" title="清空对话">
        <i class="fa-solid fa-trash-can" />
      </button>
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
</style>
