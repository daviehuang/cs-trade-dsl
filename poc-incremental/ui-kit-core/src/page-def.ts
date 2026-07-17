// PageDef：页面编辑器产出的【可序列化】页面定义（纯 JSON，不含运行时 ctx）。
//   编辑器只负责"布局 + 每个控件绑哪个引擎字段"；运行时的 hydrate 注入 ctx、展开集合。
//   绑定契约：① 受算/校验的控件必须带 path（绝对）或 field（相对当前节点）；
//             ② 改动一律走 session（绑定层接好），引擎是计算与校验唯一真相源。

export interface PageDef {
  /** 信息性：本页面针对的规则集（"lcSettlement@5.1.0"）。 */
  ruleSetRef: string;
  title?: string;
  layout: PageNode[];
}

export type PageNode = PanelNode | GroupNode | TabsNode | FieldNode | CellNode | CollectionNode | ValidationsNode;

interface BaseNode {
  /** 透传到渲染层的 className（如自定义栅格/对齐）。 */
  className?: string;
}

/** 面板/分组容器。可选 at 把内部子节点"重定基"到某个具名槽位或绝对节点路径。 */
export interface PanelNode extends BaseNode {
  kind: 'panel';
  title: string;
  badge?: string;
  variant?: 'form' | 'cards' | 'flow' | 'stats' | 'party';
  tone?: 'bank' | 'cust';
  /** 内部子节点的布局栅格：form/cards/row/col。 */
  grid?: 'form' | 'cards' | 'row' | 'col';
  /** 重定基：槽位名（相对当前节点，如 'applicant'）或绝对节点路径（'root.applicant'）。 */
  at?: string;
  children: PageNode[];
}

/** 无外壳布局容器：行(grid:'row')/列(grid:'col')/多列网格(cols:N)。子节点类型上下文不变（同当前基）。 */
export interface GroupNode extends BaseNode {
  kind: 'group';
  /** 内部子节点栅格：row(横排)/col(竖排)/form/cards。 */
  grid?: 'form' | 'cards' | 'row' | 'col';
  /** 多列网格：等分 N 列（与 grid 二选一，cols 优先）。 */
  cols?: number;
  children: PageNode[];
}

/** 标签页容器：每个 tab 一组子节点，运行时只显示当前激活页。类型上下文同当前基。 */
export interface TabsNode extends BaseNode {
  kind: 'tabs';
  tabs: { label: string; children: PageNode[] }[];
}

/** 可编辑字段（普通输入）。绑定的字段不能是 computed/external（linter 会拦）。 */
export interface FieldNode extends BaseNode {
  kind: 'field';
  /** 绝对路径（'root.maxNet'）。与 field 二选一。 */
  path?: string;
  /** 相对字段名（相对当前节点类型，如 'taxId'）。与 path 二选一。 */
  field?: string;
  label?: string;
  /** 控件种类；缺省按字段名推导（ccy→币种下拉，adjustMode→调整方式下拉，其余文本）。 */
  control?: 'text' | 'ccy' | 'adjust';
}

/** 计算/外部值展示（只读）。overridable 字段自动给覆盖输入；条件可输入字段自动可编辑。 */
export interface CellNode extends BaseNode {
  kind: 'cell';
  path?: string;
  field?: string;
  label?: string;
  /** 突出展示（大字，如净额）。 */
  emphasis?: boolean;
}

/** 同构子集合：itemTemplate 是"一条记录的子表单模板"，运行时按实际行数实例化。 */
export interface CollectionNode extends BaseNode {
  kind: 'collection';
  /** 子集合名（相对当前节点类型，如 'charges' / 'items'）。 */
  name: string;
  title?: string;
  /** 记录布局：cards（每条一张卡片，默认）/ table（列=字段、行=记录）。 */
  layout?: 'cards' | 'table';
  /** 单行内字段布局：row（横排）/ col（竖排）。 */
  itemGrid?: 'row' | 'col';
  /** 新增一行的默认值；缺省用内置模板。 */
  newItem?: Record<string, any>;
  /** 新增一行时按表达式求初值：{字段: 表达式}，在【集合所属节点】作用域求值（如 { amount: "diff" } 预填剩余额）。 */
  newItemInit?: Record<string, string>;
  itemTemplate: PageNode[];
}

/** 校验结果展示。绑定到某节点（缺省=当前节点），渲染该节点路径上引擎算出的校验。 */
export interface ValidationsNode extends BaseNode {
  kind: 'validations';
  /** 节点路径（缺省=当前基路径）。 */
  path?: string;
}
