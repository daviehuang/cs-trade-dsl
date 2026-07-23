// @udsl/ui-kit-react —— React 渲染 kit（哑渲染器）。
//   UINode → React 控件；引擎是唯一真相源，组件经 EngineCtx 委托交互。
export * from './ctx-react';
export { UiRenderer, UINodeView } from './components';
export { setLookupService, getLookupService } from './lookup';
export type { LookupService, LookupCandidate } from './lookup';
// 自定义节点组件注册表 + 内置样板 party-card（import 即自注册）。
export { registerNodeWidget, getNodeWidget } from './node-widgets';
export type { NodeWidget } from './node-widgets';
export { PartyCard } from './widgets/party-card';
import './styles.css';
