// @udsl/ui-kit-html —— 原生 HTML 渲染 kit（哑渲染器 + 会话管理）。
//   UINode → DOM；引擎是唯一真相源，DOM 经 EngineCtx 委托交互。无框架依赖。
//   样式复用共享的 eg-* class（宿主自行引入 styles.css，与 React/Angular 视觉一致）。
export { renderUINode, h } from './render';
export { mountEngineSession } from './mount';
export type { MountOpts, MountHandle } from './mount';
// 自定义节点组件注册表 + 内置样板 party-card（import 即自注册，同 React 端）。
export { registerNodeWidget, getNodeWidget, nodeWidgetNames } from './node-widgets';
export type { NodeWidget } from './node-widgets';
export { PartyCard } from './widgets/party-card';
