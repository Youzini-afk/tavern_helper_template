/**
 * Vue Flow CSS 注入工具
 *
 * webpack 的 CSS loader 排除了 node_modules，pnpm 的目录结构
 * 让 include 规则难以匹配。我们直接把 Vue Flow 必需的 CSS
 * 以字符串形式嵌入并在运行时注入到 DOM 中。
 */

const VUE_FLOW_STYLE_ID = 'ew-vue-flow-css';

/** 只注入一次 */
let injected = false;

/**
 * @vue-flow/core/dist/style.css + theme-default.css + minimap + controls 合并版
 */
const VUE_FLOW_CSS = `
/* === @vue-flow/core — !important to override SillyTavern CSS resets === */
.vue-flow {
  position: relative !important;
  width: 100% !important;
  height: 100% !important;
  overflow: hidden !important;
  z-index: 0;
  direction: ltr;
}
.vue-flow__container {
  position: absolute !important;
  height: 100% !important;
  width: 100% !important;
  left: 0 !important;
  top: 0 !important;
}
.vue-flow__pane {
  z-index: 1;
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  left: 0 !important;
}
.vue-flow__pane.draggable { cursor: grab; }
.vue-flow__pane.selection { cursor: pointer; }
.vue-flow__pane.dragging { cursor: grabbing; }
.vue-flow__transformationpane {
  transform-origin: 0 0 !important;
  z-index: 2;
  pointer-events: none !important;
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  left: 0 !important;
}
.vue-flow__viewport {
  z-index: 4;
  overflow: visible !important;
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  left: 0 !important;
}
.vue-flow__selection { z-index: 6; }
.vue-flow__edge-labels {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  pointer-events: none !important;
  user-select: none;
}
.vue-flow__nodesselection-rect:focus,
.vue-flow__nodesselection-rect:focus-visible { outline: none; }
.vue-flow .vue-flow__edges {
  pointer-events: none !important;
  overflow: visible !important;
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
}
.vue-flow__edges svg {
  overflow: visible !important;
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  left: 0 !important;
}
.vue-flow__edge-path,
.vue-flow__connection-path {
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 2;
  fill: none;
}
.vue-flow__edge {
  pointer-events: visibleStroke;
  cursor: pointer;
}
.vue-flow__edge.animated path {
  stroke-dasharray: 5;
  animation: dashdraw 0.5s linear infinite;
}
.vue-flow__edge.animated path.vue-flow__edge-interaction {
  stroke-dasharray: none;
  animation: none;
}
.vue-flow__edge.inactive { pointer-events: none; }
.vue-flow__edge.selected,
.vue-flow__edge:focus,
.vue-flow__edge:focus-visible { outline: none; }
.vue-flow__edge.selected .vue-flow__edge-path { stroke: rgba(255, 255, 255, 0.6); }
.vue-flow__edge-textwrapper { pointer-events: all; }
.vue-flow__edge-textbg { fill: rgba(20, 24, 36, 0.9); }
.vue-flow__edge-text { pointer-events: none; user-select: none; }
.vue-flow__connection { pointer-events: none; }
.vue-flow__connection .animated {
  stroke-dasharray: 5;
  animation: dashdraw 0.5s linear infinite;
}
.vue-flow__connectionline { z-index: 1001; }
.vue-flow__nodes {
  pointer-events: none !important;
  transform-origin: 0 0 !important;
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
}
.vue-flow__node {
  position: absolute !important;
  user-select: none;
  pointer-events: all !important;
  transform-origin: 0 0 !important;
  box-sizing: border-box;
  cursor: default;
}
.vue-flow__node.draggable { cursor: grab; pointer-events: all !important; }
.vue-flow__node.draggable.dragging { cursor: grabbing; }
.vue-flow__nodesselection {
  z-index: 3;
  transform-origin: left top;
  pointer-events: none;
}
.vue-flow__nodesselection-rect {
  position: absolute !important;
  pointer-events: all;
  cursor: grab;
}
.vue-flow__nodesselection-rect.dragging { cursor: grabbing; }
.vue-flow__handle {
  position: absolute !important;
  pointer-events: none;
  min-width: 5px;
  min-height: 5px;
  width: 10px;
  height: 10px;
  background: rgba(255, 255, 255, 0.5);
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 100%;
}
.vue-flow__handle.connectable {
  pointer-events: all !important;
  cursor: crosshair;
}
.vue-flow__handle-bottom { left: 50%; bottom: 0; transform: translate(-50%, 50%); }
.vue-flow__handle-top { left: 50%; top: 0; transform: translate(-50%, -50%); }
.vue-flow__handle-left { top: 50%; left: 0; transform: translate(-50%, -50%); }
.vue-flow__handle-right { top: 50%; right: 0; transform: translate(50%, -50%); }
.vue-flow__edgeupdater { cursor: move; pointer-events: all; }
.vue-flow__panel {
  position: absolute !important;
  z-index: 5;
  margin: 15px;
}
.vue-flow__panel.top { top: 0 !important; }
.vue-flow__panel.bottom { bottom: 0 !important; }
.vue-flow__panel.left { left: 0 !important; }
.vue-flow__panel.right { right: 0 !important; }
.vue-flow__panel.center { left: 50% !important; transform: translateX(-50%); }
@keyframes dashdraw { from { stroke-dashoffset: 10; } }

/* === dark theme === */
:root {
  --vf-node-bg: rgba(20, 24, 36, 0.95);
  --vf-node-text: rgba(255, 255, 255, 0.8);
  --vf-connection-path: rgba(255, 255, 255, 0.3);
  --vf-handle: rgba(255, 255, 255, 0.5);
}
.vue-flow__edge-text { font-size: 10px; }
.vue-flow__node { cursor: grab; }
.vue-flow__node.selectable:focus,
.vue-flow__node.selectable:focus-visible { outline: none; }
.vue-flow__nodesselection-rect,
.vue-flow__selection {
  background: rgba(59, 130, 246, 0.08);
  border: 1px dotted rgba(59, 130, 246, 0.6);
}

/* === minimap === */
.vue-flow__minimap {
  pointer-events: all !important;
  background: rgba(0, 0, 0, 0.5) !important;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.vue-flow__minimap svg { display: block !important; overflow: visible !important; }

/* === controls === */
.vue-flow__controls {
  display: flex !important;
  flex-direction: column;
  gap: 2px;
  background: rgba(20, 24, 36, 0.9) !important;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  padding: 4px;
}
.vue-flow__controls-button {
  display: flex !important;
  align-items: center;
  justify-content: center;
  width: 26px !important;
  height: 26px !important;
  background: transparent !important;
  border: none !important;
  cursor: pointer;
  padding: 0 !important;
  color: rgba(255, 255, 255, 0.6);
}
.vue-flow__controls-button:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  color: rgba(255, 255, 255, 0.9);
}
.vue-flow__controls-button svg {
  width: 12px !important;
  height: 12px !important;
  max-width: 12px !important;
  max-height: 12px !important;
  fill: currentColor !important;
  display: block !important;
}
`;

export function injectVueFlowCSS(): void {
  if (injected) return;
  
  let style = document.getElementById(VUE_FLOW_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = VUE_FLOW_STYLE_ID;
    document.head.appendChild(style);
  }
  
  // 关键：如果样式内容不是最新的（例如 HMR 热更新或重新加载插件），则覆盖它
  if (style.textContent !== VUE_FLOW_CSS) {
    style.textContent = VUE_FLOW_CSS;
  }
  
  injected = true;
}
