<template>
  <transition name="ch-fade">
    <div v-if="store.historyOpen" class="ch-overlay" :class="['ub-theme-' + store.settings.theme]" @mousedown.self="store.historyOpen = false">
      <div class="ch-dialog">
        <!-- 标题栏 -->
        <div class="ch-header">
          <span class="ch-title"><i class="fa-solid fa-clock-rotate-left" /> 历史记录</span>
          <button class="ch-close" @click="store.historyOpen = false">
            <i class="fa-solid fa-xmark" />
          </button>
        </div>

        <!-- 空状态 -->
        <div v-if="store.configHistory.length === 0" class="ch-empty">
          <i class="fa-solid fa-inbox" />
          <span>暂无历史记录</span>
        </div>

        <!-- 历史列表 -->
        <div v-else class="ch-list">
          <div v-for="snap in store.configHistory" :key="snap.id" class="ch-item">
            <!-- 缩略预览 -->
            <div class="ch-preview-wrap">
              <div class="ch-preview" :class="['ub-theme-' + store.settings.theme]">
                <BlockRenderer :block="snap.config.root" :is-root="true" />
              </div>
            </div>

            <!-- 信息 & 操作 -->
            <div class="ch-info">
              <span class="ch-snap-title">{{ snap.title }}</span>
              <span class="ch-snap-time">{{ formatTime(snap.timestamp) }}</span>
              <div class="ch-actions">
                <button class="ch-btn ch-btn--primary" @click="rollback(snap.id)">
                  <i class="fa-solid fa-rotate-left" /> 回滚
                </button>
                <button class="ch-btn ch-btn--danger" @click="store.deleteSnapshot(snap.id)">
                  <i class="fa-solid fa-trash" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useStore } from './store';
import BlockRenderer from './BlockRenderer.vue';

const store = useStore();

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function rollback(id: string) {
  store.rollbackTo(id);
  store.historyOpen = false;
}
</script>

<style scoped>
.ch-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.ch-dialog {
  width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: var(--ub-bg-solid);
  border: 1px solid var(--ub-border);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
}

.ch-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--ub-border);
}

.ch-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--ub-text-main);
  display: flex;
  align-items: center;
  gap: 8px;
}

.ch-close {
  background: none;
  border: none;
  color: var(--ub-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.15s;
}
.ch-close:hover {
  background: var(--ub-hover-bg);
  color: var(--ub-text-main);
}

.ch-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--ub-text-muted);
  font-size: 14px;
}
.ch-empty i {
  font-size: 32px;
  opacity: 0.4;
}

.ch-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ch-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--ub-border);
  background: var(--ub-bg-glass);
  transition: border-color 0.15s;
}
.ch-item:hover {
  border-color: var(--ub-accent);
}

.ch-preview-wrap {
  width: 100%;
  height: 120px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--ub-border-light);
  position: relative;
}

.ch-preview {
  position: absolute;
  top: 0;
  left: 0;
  width: 300%;
  height: 360px;
  transform: scale(0.333);
  transform-origin: top left;
  pointer-events: none;
  overflow: hidden;
}

.ch-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ch-snap-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--ub-text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ch-snap-time {
  font-size: 11px;
  color: var(--ub-text-muted);
}

.ch-actions {
  margin-top: auto;
  display: flex;
  gap: 6px;
}

.ch-btn {
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s;
}

.ch-btn--primary {
  background: var(--ub-accent);
  color: #fff;
}
.ch-btn--primary:hover {
  filter: brightness(1.1);
}

.ch-btn--danger {
  background: transparent;
  color: var(--ub-text-muted);
  border: 1px solid var(--ub-border);
}
.ch-btn--danger:hover {
  background: rgba(220, 60, 60, 0.15);
  color: #dc3c3c;
  border-color: rgba(220, 60, 60, 0.3);
}

/* 弹窗动画 */
.ch-fade-enter-active,
.ch-fade-leave-active {
  transition: opacity 0.2s ease;
}
.ch-fade-enter-active .ch-dialog,
.ch-fade-leave-active .ch-dialog {
  transition: transform 0.2s ease;
}
.ch-fade-enter-from,
.ch-fade-leave-to {
  opacity: 0;
}
.ch-fade-enter-from .ch-dialog {
  transform: scale(0.95) translateY(10px);
}
.ch-fade-leave-to .ch-dialog {
  transform: scale(0.95) translateY(10px);
}
</style>
