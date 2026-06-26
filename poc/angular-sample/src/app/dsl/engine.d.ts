// 为内联的真实引擎 engine.js 提供 TypeScript 类型（运行时用 engine.js，类型用本文件）。
export interface RuleSet {
  ruleSetId: string;
  version: string;
  schemaVersion: string;
  status: string;
  model: any;
  functions?: any[];
  rules: any[];
  [k: string]: any;
}

export interface ValidationResult {
  id: string;
  scope: string;
  ok: boolean;
  severity: 'error' | 'warning' | 'info';
  code: string | null;
  message: string | null;
}

export interface RunResult {
  /** 计算后的交易树（含 computed 字段，Decimal 已序列化为字符串） */
  tree: any;
  validations: ValidationResult[];
  warnings: string[];
}

/** 在交易树上执行一个 RuleSet —— 引擎唯一入口，纯函数、无副作用、无 DOM 依赖。 */
export function runRuleSet(ruleSet: RuleSet, rawData: any): RunResult;
