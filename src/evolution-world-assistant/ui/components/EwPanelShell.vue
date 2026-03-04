<template>
  <div class="ew-overlay" @click.self="$emit('close')">
    <section class="ew-panel" :data-busy="busy ? '1' : '0'">
      <header class="ew-panel__header">
        <div class="ew-panel__title-wrap">
          <h2 class="ew-panel__title">{{ title }}</h2>
          <p v-if="subtitle" class="ew-panel__subtitle">{{ subtitle }}</p>
          <span class="ew-panel__status" :data-enabled="enabled ? '1' : '0'">
            {{ enabled ? '已启用' : '未启用' }}
          </span>
        </div>
        <div class="ew-panel__actions">
          <slot name="actions" />
        </div>
      </header>

      <nav class="ew-panel__tabs" aria-label="配置分区">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="ew-panel__tab"
          :data-active="tab.key === activeTab ? '1' : '0'"
          @click="$emit('change-tab', tab.key)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <main class="ew-panel__body">
        <slot />
      </main>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { TabKey, TabMeta } from '../help-meta';

defineProps<{
  busy: boolean;
  enabled: boolean;
  title: string;
  subtitle?: string;
  tabs: TabMeta[];
  activeTab: TabKey;
}>();

defineEmits<{
  (event: 'change-tab', tab: TabKey): void;
  (event: 'close'): void;
}>();
</script>

<style scoped>
.ew-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  padding: 12px;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 10% 0%, rgba(120, 150, 220, 0.16), transparent 42%),
    radial-gradient(circle at 95% 0%, rgba(96, 120, 178, 0.15), transparent 40%),
    rgba(4, 8, 14, 0.58);
}

.ew-panel {
  /* Plugin-local default palette: cool gray */
  --SmartThemeQuoteColor: #7e8c9f;
  --SmartThemeBodyColor: #e8edf5;

  width: min(1120px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  border-radius: 1.2rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 44%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #3b4e68) 16%, rgba(8, 12, 18, 0.66));
  box-shadow:
    0 22px 50px rgba(0, 0, 0, 0.42),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  backdrop-filter: blur(16px) saturate(125%);
  -webkit-backdrop-filter: blur(16px) saturate(125%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ew-panel[data-busy='1'] {
  opacity: 0.9;
}

.ew-panel__header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.9rem;
  padding: 0.95rem 1rem 0.88rem;
  border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 25%, transparent);
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--SmartThemeQuoteColor, #3b4e68) 26%, rgba(10, 16, 24, 0.76)),
    color-mix(in srgb, var(--SmartThemeQuoteColor, #3b4e68) 16%, rgba(10, 16, 24, 0.72))
  );
}

.ew-panel__title-wrap {
  min-width: 0;
}

.ew-panel__title {
  margin: 0;
  font-size: clamp(1.36rem, 2.2vw, 1.8rem);
  line-height: 1.08;
  letter-spacing: 0.01em;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 96%, transparent);
}

.ew-panel__subtitle {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 72%, transparent);
}

.ew-panel__status {
  display: inline-flex;
  align-items: center;
  margin-top: 0.5rem;
  padding: 0.17rem 0.58rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 48%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 18%, transparent);
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 92%, transparent);
  font-size: 0.74rem;
  font-weight: 600;
}

.ew-panel__status[data-enabled='1'] {
  border-color: color-mix(in srgb, #54c980 56%, transparent);
  background: color-mix(in srgb, #54c980 20%, transparent);
}

.ew-panel__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.48rem;
  flex-wrap: wrap;
  max-width: 50%;
}

.ew-panel__tabs {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  gap: 0.48rem;
  padding: 0.58rem 0.92rem 0.62rem;
  overflow-x: auto;
  border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 22%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #3b4e68) 12%, rgba(8, 12, 18, 0.45));
}

.ew-panel__tab {
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 46%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 17%, transparent);
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 90%, transparent);
  padding: 0.3rem 0.88rem;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform 0.14s ease,
    background 0.2s ease,
    border-color 0.2s ease;
}

.ew-panel__tab[data-active='1'] {
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 82%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 38%, transparent);
  transform: translateY(-1px);
}

.ew-panel__tab:hover,
.ew-panel__tab:focus-visible {
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 72%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 30%, transparent);
  outline: none;
}

.ew-panel__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.88rem 0.92rem 1rem;
}

@supports not ((backdrop-filter: blur(1px))) {
  .ew-panel {
    background: color-mix(in srgb, var(--SmartThemeQuoteColor, #3b4e68) 20%, rgba(8, 12, 18, 0.96));
  }
}

@media (max-width: 900px) {
  .ew-overlay {
    padding: 0;
    place-items: stretch;
  }

  .ew-panel {
    width: 100vw;
    height: 100dvh;
    max-height: none;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }

  .ew-panel__header {
    padding: 0.82rem 0.72rem;
  }

  .ew-panel__actions {
    max-width: none;
  }

  .ew-panel__tabs {
    padding-inline: 0.72rem;
  }

  .ew-panel__body {
    padding: 0.72rem 0.72rem 0.92rem;
  }
}
</style>
