// 中性 UI-IR：hydrate(PageDef) / buildRootIR(自动布局) 都产出 UINode 树。
//   每个框架适配器只需写一个哑渲染器（switch(node.kind)），把 UINode 映射成自己的控件。
//   逻辑（路径重定基、集合按 live state 展开、控件种类判定、栅格/span-all）只在 core 写一次。
import { SessionState } from './engine-types';

export type UINode =
  | FieldUI
  | CellUI
  | ValidationsUI
  | PanelUI
  | CollectionUI
  | GroupUI
  | TabsUI;

export interface FieldUI {
  kind: 'field';
  path: string;
  label: string;
  control: string;            // 'text' | 'ccy' | 'adjust' | 'date' | 'select' | 'party-lookup'
  controlProps?: Record<string, any>;   // 参数化控件属性（如 select 的 options）
  className?: string;
}

export interface CellUI {
  kind: 'cell';
  path: string;
  label: string;
  overridable: boolean;
  external: boolean;
  big: boolean;
  className?: string;
}

export interface ValidationsUI {
  kind: 'validations';
  path: string;
  className?: string;
}

export interface PanelUI {
  kind: 'panel';
  label: string;
  badge?: string;
  variant?: string;           // 'form' | 'cards' | 'flow' | 'stats' | 'party'
  tone?: string;              // 'bank' | 'cust'
  gridClass?: string;         // 内部子节点的布局 class（已解析）
  /** 自定义节点组件名（宿主 registerNodeWidget 注册）。命中则该子树交自定义组件渲染，否则默认 panel。 */
  widget?: string;
  widgetProps?: Record<string, any>;   // 传给自定义组件的配置（如 summary 字段清单）
  nodePath?: string;          // 子树基路径（如 root.buyer）：组件拼 summary 字段路径用
  children: UINode[];
  className?: string;
}

export interface CollectionUI {
  kind: 'collection';
  parentPath: string;
  collName: string;
  title: string;
  /** 记录布局：cards（默认）/ table（列=字段、行=记录）/ modal（摘要行 + 弹窗编辑）。 */
  layout?: 'cards' | 'table' | 'modal';
  /** 表格模式的列（从 itemTemplate 抽取的叶子字段）。 */
  columns?: { field?: string; label: string; kind: 'field' | 'cell'; control?: string }[];
  /** 新增一行的默认值（闭包，适配器在"添加"时调用）。 */
  newItemTemplate: () => any;
  /** 新增一行时按表达式求初值：{字段: 表达式}，在 parentPath（集合所属节点）作用域求值（预填剩余额等）。 */
  newItemInit?: Record<string, string>;
  items: { nodePath: string; group: UINode }[];
  /** 按给定 path 水化「新增行」的编辑 group（弹窗新增走隔离事务：先在副本 addChild 得副本 path，
   *  再用副本 state 在该 path 上水化 group、用副本 ctx 渲染；主会话此刻无此行）。传 state 覆盖默认（主）状态以取到副本行的字段 spec。 */
  newItemGroup?: (itemPath: string, state?: SessionState) => UINode;
  className?: string;
}

export interface GroupUI {
  kind: 'group';
  gridClass?: string;
  /** 多列网格：等分 N 列（cols 优先于 gridClass）。 */
  cols?: number;
  children: UINode[];
  className?: string;
}

export interface TabsUI {
  kind: 'tabs';
  tabs: { label: string; children: UINode[] }[];
  className?: string;
}
