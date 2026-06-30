// 中性 UI-IR：hydrate(PageDef) / buildRootIR(自动布局) 都产出 UINode 树。
//   每个框架适配器只需写一个哑渲染器（switch(node.kind)），把 UINode 映射成自己的控件。
//   逻辑（路径重定基、集合按 live state 展开、控件种类判定、栅格/span-all）只在 core 写一次。

export type UINode =
  | FieldUI
  | CellUI
  | ValidationsUI
  | PanelUI
  | CollectionUI
  | GroupUI;

export interface FieldUI {
  kind: 'field';
  path: string;
  label: string;
  control: string;            // 'text' | 'ccy' | 'adjust'
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
  children: UINode[];
  className?: string;
}

export interface CollectionUI {
  kind: 'collection';
  parentPath: string;
  collName: string;
  title: string;
  /** 新增一行的默认值（闭包，适配器在"添加"时调用）。 */
  newItemTemplate: () => any;
  items: { nodePath: string; group: UINode }[];
  className?: string;
}

export interface GroupUI {
  kind: 'group';
  gridClass?: string;
  children: UINode[];
  className?: string;
}
