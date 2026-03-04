<template>
  <div v-if="store.settings.ui_open" class="ew-overlay" @click.self="store.closePanel">
    <section class="ew-modal" :data-busy="store.busy ? '1' : '0'">
      <header class="ew-header">
        <div>
          <h2>Evolution World Assistant</h2>
          <p>阻塞式动态世界链路（聊天级单书）</p>
        </div>
        <div class="ew-actions-inline">
          <button type="button" @click="store.validateConfig">校验配置</button>
          <button type="button" @click="store.exportConfig">导出配置</button>
          <button type="button" class="danger" @click="store.closePanel">关闭</button>
        </div>
      </header>

      <main class="ew-main">
        <section class="ew-section">
          <h3>全局设置</h3>
          <div class="ew-grid two">
            <label>
              <span>总开关</span>
              <input v-model="store.settings.enabled" type="checkbox" />
            </label>
            <label>
              <span>调度模式</span>
              <select v-model="store.settings.dispatch_mode">
                <option value="parallel">并行</option>
                <option value="serial">串行</option>
              </select>
            </label>
            <label>
              <span>总超时(ms)</span>
              <input v-model.number="store.settings.total_timeout_ms" type="number" min="1000" step="500" />
            </label>
            <label>
              <span>门控TTL(ms)</span>
              <input v-model.number="store.settings.gate_ttl_ms" type="number" min="1000" step="500" />
            </label>
            <label>
              <span>失败策略</span>
              <input :value="'失败即中止发送'" type="text" disabled />
            </label>
            <label>
              <span>运行时世界书前缀</span>
              <input v-model="store.settings.runtime_worldbook_prefix" type="text" />
            </label>
            <label>
              <span>命名策略</span>
              <input :value="'自动发现优先（当前绑定 -> 前缀扫描 -> 新建）'" type="text" disabled />
            </label>
            <label>
              <span>动态条目前缀</span>
              <input v-model="store.settings.dynamic_entry_prefix" type="text" />
            </label>
            <label>
              <span>控制器条目名</span>
              <input v-model="store.settings.controller_entry_name" type="text" />
            </label>
            <label>
              <span>元数据条目名</span>
              <input v-model="store.settings.meta_entry_name" type="text" />
            </label>
          </div>
        </section>

        <section class="ew-section">
          <header class="ew-sub-header">
            <h3>流配置</h3>
            <button type="button" @click="store.addFlow">新增流</button>
          </header>

          <article v-for="(flow, index) in store.settings.flows" :key="flow.id" class="flow-card">
            <header class="flow-head">
              <strong>{{ flow.name || `Flow ${index + 1}` }}</strong>
              <div class="ew-actions-inline">
                <label class="inline-check">
                  <input v-model="flow.enabled" type="checkbox" />
                  启用
                </label>
                <button type="button" class="danger" @click="store.removeFlow(flow.id)">删除</button>
              </div>
            </header>

            <div class="ew-grid two">
              <label>
                <span>名称</span>
                <input v-model="flow.name" type="text" />
              </label>
              <label>
                <span>流ID</span>
                <input v-model="flow.id" type="text" />
              </label>
              <label>
                <span>API URL</span>
                <input v-model="flow.api_url" type="text" placeholder="https://example.com/flow" />
              </label>
              <label>
                <span>API Key</span>
                <input v-model="flow.api_key" type="password" />
              </label>
              <label>
                <span>优先级</span>
                <input v-model.number="flow.priority" type="number" step="1" />
              </label>
              <label>
                <span>超时(ms)</span>
                <input v-model.number="flow.timeout_ms" type="number" min="1000" step="500" />
              </label>
              <label>
                <span>上下文楼层数</span>
                <input v-model.number="flow.context_turns" type="number" min="1" step="1" />
              </label>
              <label>
                <span>额外请求头(JSON对象)</span>
                <textarea v-model="flow.headers_json" rows="3" placeholder='{"X-Token":"value"}' />
              </label>
            </div>

            <div class="ew-grid two">
              <section class="rule-box">
                <header>
                  <strong>提取规则</strong>
                  <button type="button" @click="addRule(flow.extract_rules)">新增</button>
                </header>
                <div v-for="(rule, ridx) in flow.extract_rules" :key="`e-${ridx}`" class="rule-row">
                  <input v-model="rule.start" type="text" placeholder="start" />
                  <input v-model="rule.end" type="text" placeholder="end" />
                  <button type="button" class="danger" @click="removeRule(flow.extract_rules, ridx)">删</button>
                </div>
              </section>

              <section class="rule-box">
                <header>
                  <strong>排除规则</strong>
                  <button type="button" @click="addRule(flow.exclude_rules)">新增</button>
                </header>
                <div v-for="(rule, ridx) in flow.exclude_rules" :key="`x-${ridx}`" class="rule-row">
                  <input v-model="rule.start" type="text" placeholder="start" />
                  <input v-model="rule.end" type="text" placeholder="end" />
                  <button type="button" class="danger" @click="removeRule(flow.exclude_rules, ridx)">删</button>
                </div>
              </section>
            </div>

            <label>
              <span>request_template(JSON merge)</span>
              <textarea
                v-model="flow.request_template"
                rows="4"
                placeholder='{"context":{"turns":{{context.turns}}}}'
              />
            </label>
          </article>
        </section>

        <section class="ew-section">
          <header class="ew-sub-header">
            <h3>调试</h3>
            <div class="ew-actions-inline">
              <button type="button" @click="store.runManual(manualMessage)">手动运行</button>
              <button type="button" @click="store.validateControllerSyntax">控制器语法校验</button>
              <button type="button" @click="store.rollbackController">回滚控制器</button>
            </div>
          </header>

          <label>
            <span>手动运行输入（留空默认取最新楼层）</span>
            <textarea v-model="manualMessage" rows="3" placeholder="manual user input" />
          </label>

          <div class="run-box">
            <strong>最近运行</strong>
            <pre>{{ formattedLastRun }}</pre>
          </div>

          <div class="run-box">
            <strong>最近请求/响应摘要</strong>
            <pre>{{ formattedLastIo }}</pre>
          </div>

          <label>
            <span>导入配置(JSON)</span>
            <textarea v-model="store.importText" rows="6" placeholder="paste config json" />
          </label>
          <div class="ew-actions-inline">
            <button type="button" @click="store.importConfig">导入配置</button>
          </div>
        </section>
      </main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useEwStore } from './store';

const store = useEwStore();
const manualMessage = ref('');

const formattedLastRun = computed(() => JSON.stringify(store.lastRun ?? {}, null, 2));
const formattedLastIo = computed(() => JSON.stringify(store.lastIo ?? {}, null, 2));

function addRule(target: Array<{ start: string; end: string }>) {
  target.push({ start: '', end: '' });
}

function removeRule(target: Array<{ start: string; end: string }>, index: number) {
  target.splice(index, 1);
}

function onEsc(event: KeyboardEvent) {
  if (event.key !== 'Escape') {
    return;
  }
  if (!store.settings.ui_open) {
    return;
  }
  store.closePanel();
}

onMounted(() => {
  window.addEventListener('keydown', onEsc);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onEsc);
});
</script>

<style scoped>
.ew-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  background: rgb(0 0 0 / 62%);
  display: grid;
  place-items: center;
  padding: 12px;
}

.ew-modal {
  width: min(1040px, 100%);
  max-height: calc(100vh - 24px);
  background: #10161f;
  color: #e6edf3;
  border: 1px solid #2c3948;
  border-radius: 12px;
  box-shadow: 0 24px 48px rgb(0 0 0 / 50%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ew-modal[data-busy='1'] {
  opacity: 0.85;
}

.ew-modal :deep(*) {
  box-sizing: border-box;
}

.ew-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid #223141;
  background: linear-gradient(135deg, #122033 0%, #0f1827 100%);
}

.ew-header h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
  color: #f5f7fa;
}

.ew-header p {
  margin: 4px 0 0;
  font-size: 13px;
  color: #c3d1df;
}

.ew-main {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 16px 18px;
}

.ew-section {
  border: 1px solid #2c3948;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #0d131c;
}

.ew-section h3 {
  margin: 0;
  font-size: 18px;
  color: #d5e2ef;
}

.ew-sub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ew-grid {
  display: grid;
  gap: 8px;
}

.ew-grid.two {
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.flow-card {
  border: 1px solid #2f3d4e;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #111a25;
}

.flow-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.flow-head strong {
  font-size: 20px;
  color: #f0f5fb;
}

.rule-box {
  border: 1px dashed #3a4a5d;
  border-radius: 8px;
  padding: 8px;
  background: #0d1622;
}

.rule-box > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.rule-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 6px;
  margin-bottom: 6px;
}

.ew-actions-inline {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #dde8f3;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

label > span {
  font-size: 13px;
  color: #d4deea;
}

input,
select,
textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #405469;
  border-radius: 8px;
  background: #0b1118;
  color: #ecf2f9;
  outline: none;
  font-size: 14px;
}

input:focus,
select:focus,
textarea:focus {
  border-color: #4ca9ff;
  box-shadow: 0 0 0 2px rgb(76 169 255 / 22%);
}

input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: #4ca9ff;
}

input[disabled] {
  opacity: 0.75;
  cursor: default;
}

textarea {
  resize: vertical;
  min-height: 70px;
}

button {
  border: 1px solid #3c536c;
  border-radius: 8px;
  background: #1c2a3a;
  color: #eaf2fb;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 10px;
  cursor: pointer;
}

button:hover {
  background: #22334a;
}

button.danger {
  border-color: #7a3f45;
  background: #3a1b20;
  color: #ffd8dc;
}

.run-box {
  border: 1px solid #314258;
  border-radius: 8px;
  padding: 10px;
  background: #0a111a;
}

.run-box strong {
  font-size: 14px;
}

pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.4;
  color: #dbe7f5;
}

@media (max-width: 900px) {
  .ew-header h2 {
    font-size: 22px;
  }

  .ew-grid.two {
    grid-template-columns: 1fr;
  }

  .flow-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .rule-row {
    grid-template-columns: 1fr;
  }
}
</style>
