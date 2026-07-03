// @udsl/ui-kit-vue —— Vue 渲染 kit（哑渲染器 + 响应式桥）。
//   UINode → Vue 控件；引擎是唯一真相源，组件经 EngineCtx 委托交互。
//   样式复用共享的 eg-* class（宿主自行引入 styles.css，与 React/Angular/HTML 视觉一致）。
export { UiRenderer, renderNode } from './components';
export { useEngineSession } from './ctx-vue';
export type { UseEngineOpts, EngineSession } from './ctx-vue';
