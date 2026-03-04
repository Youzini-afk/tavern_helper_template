<template>
  <section class="ew-section-card" :data-open="resolvedOpen ? '1' : '0'">
    <header class="ew-section-card__header">
      <div class="ew-section-card__title-group">
        <h3 class="ew-section-card__title">{{ title }}</h3>
        <p v-if="subtitle" class="ew-section-card__subtitle">{{ subtitle }}</p>
      </div>
      <div class="ew-section-card__actions">
        <slot name="actions" />
        <button
          v-if="collapsible"
          type="button"
          class="ew-section-card__toggle"
          :aria-expanded="resolvedOpen ? 'true' : 'false'"
          @click="toggleOpen"
        >
          {{ resolvedOpen ? '收起' : '展开' }}
        </button>
      </div>
    </header>

    <transition name="ew-fold">
      <div v-if="resolvedOpen" class="ew-section-card__body">
        <slot />
      </div>
    </transition>
  </section>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    collapsible?: boolean;
    modelValue?: boolean;
  }>(),
  {
    subtitle: '',
    collapsible: false,
    modelValue: true,
  },
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
}>();

const resolvedOpen = computed(() => {
  return props.collapsible ? props.modelValue : true;
});

function toggleOpen() {
  if (!props.collapsible) {
    return;
  }
  emit('update:modelValue', !resolvedOpen.value);
}
</script>

<style scoped>
.ew-section-card {
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 44%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #334457) 12%, rgba(8, 12, 18, 0.62));
  box-shadow:
    0 14px 32px rgba(0, 0, 0, 0.24),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  backdrop-filter: blur(12px) saturate(120%);
  -webkit-backdrop-filter: blur(12px) saturate(120%);
  overflow: visible;
}

.ew-section-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 0.9rem;
  border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 26%, transparent);
}

.ew-section-card__title-group {
  min-width: 0;
}

.ew-section-card__title {
  margin: 0;
  font-size: 1rem;
  line-height: 1.2;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 94%, transparent);
}

.ew-section-card__subtitle {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  line-height: 1.35;
  color: color-mix(in srgb, var(--SmartThemeBodyColor, #edf2f9) 70%, transparent);
}

.ew-section-card__actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.ew-section-card__toggle {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 56%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 28%, transparent);
  color: var(--SmartThemeBodyColor, #edf2f9);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.24rem 0.62rem;
  cursor: pointer;
}

.ew-section-card__toggle:hover,
.ew-section-card__toggle:focus-visible {
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 44%, transparent);
  outline: none;
}

.ew-section-card__body {
  padding: 0.9rem;
}

.ew-fold-enter-active,
.ew-fold-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.ew-fold-enter-from,
.ew-fold-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@supports not ((backdrop-filter: blur(1px))) {
  .ew-section-card {
    background: color-mix(in srgb, var(--SmartThemeQuoteColor, #334457) 18%, rgba(8, 12, 18, 0.92));
  }
}

@media (prefers-reduced-motion: reduce) {
  .ew-fold-enter-active,
  .ew-fold-leave-active {
    transition: none;
  }
}
</style>
