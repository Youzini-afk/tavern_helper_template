<template>
  <div class="premium-toggle" @click="toggle">
    <span v-if="label" class="pt-label">{{ label }}</span>
    <div class="pt-track" :class="{ 'pt-track--active': checked }">
      <div class="pt-thumb" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label?: string;
  checked: boolean;
}>();

const emit = defineEmits<{
  'update:checked': [val: boolean];
}>();

function toggle() {
  emit('update:checked', !props.checked);
}
</script>

<style scoped>
.premium-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--ub-bg-glass);
  border: 1px solid var(--ub-border);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  user-select: none;
  width: 100%;
  box-sizing: border-box;
}

.premium-toggle:hover {
  background: var(--ub-bg-hover);
  border-color: var(--ub-border-light);
}

.pt-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ub-text-main);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 12px;
}

.pt-track {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: var(--ub-border);
  box-shadow: inset 0 1px 3px var(--ub-shadow);
  transition: background 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  flex-shrink: 0;
}

.pt-track--active {
  background: var(--ub-accent-active);
  box-shadow: inset 0 1px 3px var(--ub-shadow), 0 0 12px var(--ub-accent-bg);
}

.pt-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.2s;
}

.premium-toggle:active .pt-thumb {
  width: 24px;
}

.pt-track--active .pt-thumb {
  transform: translateX(20px);
}
</style>
