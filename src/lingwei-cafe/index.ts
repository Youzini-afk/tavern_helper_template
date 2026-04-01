/**
 * 铃尾咖啡厅 — 入口文件（脚本模式）
 *
 * 与前端界面模式不同，脚本模式不使用 index.html，
 * 而是直接在宿主页面上创建挂载点并初始化 Vue 应用。
 * CSS 由 style-loader 注入到 document.head。
 */

import { waitUntil } from 'async-wait-until';
import App from './App.vue';
import './global.css';
import './theme.css';

$(async () => {
  await waitGlobalInitialized('Mvu');
  await waitUntil(() => _.has(getVariables({ type: 'chat' }), 'stat_data'));

  // 清理旧实例
  document.getElementById('lingwei-cafe-app')?.remove();

  // 在宿主页面上创建挂载点
  const mountEl = document.createElement('div');
  mountEl.id = 'lingwei-cafe-app';
  document.body.appendChild(mountEl);

  createApp(App).use(createPinia()).mount(mountEl);
  console.info('[铃尾咖啡厅] UI 挂载完成 ☕');
});
