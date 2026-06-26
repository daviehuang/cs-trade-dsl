// 为运行时用的真实增量引擎 incremental.js 提供 TypeScript 类型。
// 运行时跑的是 incremental.js（与 PoC / BFF / 中台同一份源码，ADR-1 单源）；本文件只是类型。

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
  [k: string]: any;
}

/** resolve(source, key) 由宿主提供：返回参考数据（如汇率）。引擎自身从不做 IO。 */
export type ResolveFn = (
  source: string,
  key: Record<string, any>,
) => Promise<{ value: string; asOf?: string; rateId?: string }>;

export interface SessionOpts {
  resolve?: ResolveFn;
  /** 规则集 import 的模块库注册表：{ "commonFx@1.0.0": <模块库 JSON> } */
  imports?: Record<string, RuleSet>;
  onUpdate?: (state: SessionState) => void;
  onLog?: (e: any) => void;
}

export interface Cell {
  value: any;
  state: 'resolved' | 'pending' | 'error' | 'overridden' | 'input';
}

/** getState() 视图节点：字段是 cell，子集合是同构子节点数组，slots 是具名单子节点。 */
export interface ViewNode {
  path: string;
  type: string;
  fields: Record<string, Cell>;
  collections: Record<string, ViewNode[]>;
  /** 具名单节点（如 applicant / advisingBank），每个是一个同构子节点视图。 */
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
  addChild(parentPath: string, collName: string, childObj: any): string;
  removeChild(childPath: string): void;
  getState(): SessionState;
  idle(): Promise<void>;
  _cells: Map<string, any>;
  _nodes: Map<string, any>;
}

export function createSession(ruleSet: RuleSet, data: any, opts?: SessionOpts): Session;
