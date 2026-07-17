// 引擎类型契约（与 poc-incremental/src/incremental.js 对应；运行时跑的是同一份 JS）。
// ui-kit-core 只依赖这些【类型】，不依赖任何框架；createSession 的实现由宿主从引擎 JS 引入。

export interface RuleSet {
  ruleSetId: string;
  version: string;
  model: any;
  dataSources?: any[];
  context?: Record<string, string>;
  imports?: { ref: string; as: string }[];
  uses?: any[];
  rules?: any[];
  modules?: Record<string, any>;
  nodes?: Record<string, any>;
  [k: string]: any;
}

/** resolve(source, key) 由宿主提供：返回参考数据（如汇率）。引擎自身从不做 IO。 */
export type ResolveFn = (
  source: string,
  key: Record<string, any>,
) => Promise<{ value: string; asOf?: string; rateId?: string }>;

export interface SessionOpts {
  resolve?: ResolveFn;
  imports?: Record<string, RuleSet>;
  onUpdate?: (state: SessionState) => void;
  onLog?: (e: any) => void;
}

export interface Cell {
  value: any;
  state: 'resolved' | 'pending' | 'error' | 'overridden' | 'input';
  /** 该字段此刻是否允许人工覆盖（分支级，随命中的 cases 分支变化）。 */
  overridable?: boolean;
}

export interface ViewNode {
  path: string;
  type: string;
  fields: Record<string, Cell>;
  collections: Record<string, ViewNode[]>;
  slots: Record<string, ViewNode>;
}

export interface ValidationView {
  id: string;
  scope: string;
  node: string;
  state: string;
  ok: boolean | null;
  message: string | null;
}

export interface PinnedView {
  field: string;
  value: string;
  key: Record<string, any>;
  rateId: string;
}

export interface SessionState {
  tree: ViewNode;
  validations: ValidationView[];
  pinned: PinnedView[];
  overrides: { field: string; value: string }[];
  anyPending: boolean;
}

export interface Session {
  setInput(path: string, raw: any): void;
  setOverride(path: string, raw: any): void;
  clearOverride(path: string): void;
  /** 从已存字段值重建覆盖态；返回被反推为覆盖的字段列表。opts.skipExternalDependent 默认 true。 */
  reconstructOverrides(data: any, opts?: { skipExternalDependent?: boolean }): string[];
  addChild(parentPath: string, collName: string, childObj: any): string;
  removeChild(childPath: string): void;
  getState(): SessionState;
  /** 调试：导出计算图（每个 cell 的 id/kind/值/态/表达式/依赖边），供 UI 摊开规则计算链。 */
  explain(): ExplainCell[];
  /** 只读求值：在指定节点作用域对表达式求值（表现层用——新增初值 / 显隐谓词；不建 cell、不改数据流）。 */
  evalAt(path: string, expr: string): any;
  idle(): Promise<void>;
  _cells: Map<string, any>;
  _nodes: Map<string, any>;
}

/** explain() 导出的单个 cell 的调试信息。 */
export interface ExplainCell {
  id: string;
  kind: 'input' | 'computed' | 'resolver' | 'validation';
  nodePath: string;
  state: string;
  value: string | null;
  deps: string[];
  cases?: { when: string | null; expr: string; active: boolean }[];
  fallback?: string | null;
  overridden?: boolean;
  overridable?: boolean;
  source?: string;
  key?: Record<string, string>;
  lastKey?: string | null;
  expr?: string;
  ruleId?: string;
  severity?: string;
  ok?: boolean | null;
  message?: string | null;
  error?: string;
}

export type CreateSession = (ruleSet: RuleSet, data: any, opts?: SessionOpts) => Session;
