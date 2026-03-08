<template>
  <div class="control-area">
    <!-- 工具栏 -->
    <div class="control-area__toolbar">
      <button class="control-area__tool-btn" @click="store.enableAll()" title="全部开启">
        <i class="fa-solid fa-toggle-on" />
      </button>
      <button class="control-area__tool-btn" @click="store.disableAll()" title="全部关闭">
        <i class="fa-solid fa-toggle-off" />
      </button>
      <button class="control-area__tool-btn" @click="store.refreshFromPreset()" title="刷新状态">
        <i class="fa-solid fa-arrows-rotate" />
      </button>
    </div>

    <!-- 分组列表 -->
    <div class="control-area__groups">
      <div v-if="store.widgetConfig.groups.length === 0" class="control-area__empty">
        <i class="fa-solid fa-sliders" />
        <p>暂无控制项</p>
        <p class="control-area__hint">在左侧对话框中描述面板布局，<br>或点击「从预设扫描」自动生成</p>
      </div>

      <WidgetGroup
        v-for="(group, gIdx) in store.widgetConfig.groups"
        :key="gIdx"
        :group="group"
        @toggle-group="store.toggleGroup(gIdx)"
        @toggle-item="(iIdx: number) => store.toggleItem(gIdx, iIdx)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from './store';
import WidgetGroup from './WidgetGroup.vue';

const store = useStore();
</script>

<style scoped>
.control-area {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

.control-area__toolbar {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.control-area__tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.control-area__tool-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.85);
}

.control-area__groups {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.control-area__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(255, 255, 255, 0.25);
  text-align: center;
  gap: 4px;
}

.control-area__empty i {
  font-size: 28px;
  margin-bottom: 8px;
}

.control-area__empty p {
  margin: 0;
  font-size: 13px;
}

.control-area__hint {
  font-size: 11px !important;
  color: rgba(255, 255, 255, 0.18) !important;
  line-height: 1.6;
}
</style>
