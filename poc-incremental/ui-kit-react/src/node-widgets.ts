// 自定义节点组件注册表：把一个模型子树（如 CustomerParty 槽位）交给宿主自定义组件渲染。
//   PageDef 里的 panel 设 widget:'name'；宿主启动时 registerNodeWidget('name', 组件)。
//   组件拿到 { node: PanelUI(含 children/nodePath/widgetProps), ctx }，自管展示与行为——
//   值永远经 ctx 读写引擎，children 用 UiRenderer 渲染；未注册的 widget → EgPanel 降级为默认 panel。
import type { ReactNode } from 'react';
import type { EngineCtx, PanelUI } from '@udsl/ui-kit-core';

export type NodeWidget = (p: { node: PanelUI; ctx: EngineCtx }) => ReactNode;

const registry = new Map<string, NodeWidget>();

/** 宿主注册一个自定义节点组件（可覆盖同名）。 */
export function registerNodeWidget(name: string, widget: NodeWidget): void {
  registry.set(name, widget);
}

/** EgPanel 据 panel.widget 查组件；未注册返回 undefined → 降级默认 panel。 */
export function getNodeWidget(name: string): NodeWidget | undefined {
  return registry.get(name);
}

/** 已注册的自定义组件名清单（供页面编辑器下拉选择）。 */
export function nodeWidgetNames(): string[] {
  return [...registry.keys()];
}
