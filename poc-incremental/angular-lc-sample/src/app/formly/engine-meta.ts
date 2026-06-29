// 从【运行时加载的 RuleSet + import 的类型库】推导节点字段元数据。
// 与引擎同构：合并 importedNodes + model.nodes，沿 extends 链取有效字段（继承字段 + 自有字段）。
// formly 版用它判断「哪些字段可编辑 / 哪些是计算值 / 哪些可覆盖」，从而模型驱动地生成表单。
import { RuleSet } from '../dsl/incremental';

export interface FieldSpec {
  type?: string;
  computed?: boolean;
  external?: boolean;
  overridable?: boolean;
}

export interface EngineMeta {
  /** 合并后的节点定义表（库节点 + 本规则集节点）。 */
  nodes: Record<string, any>;
  /** 沿 extends 链合并的有效字段（基类在前、子类型在后）。 */
  effectiveFields(type: string): Record<string, FieldSpec>;
}

/** 构建元数据：合并各 import 类型库的 nodes 与本规则集 model.nodes。 */
export function buildMeta(ruleSet: RuleSet, imports: Record<string, RuleSet>): EngineMeta {
  const merged: Record<string, any> = {};
  for (const ref of (ruleSet.imports ?? []).map((i) => i.ref)) {
    const lib = imports[ref];
    if (lib?.nodes) Object.assign(merged, lib.nodes);
  }
  Object.assign(merged, ruleSet.model?.nodes ?? {});

  const chain = (type: string): string[] => {
    const out: string[] = [];
    let t: string | undefined = type;
    while (t) { out.unshift(t); t = merged[t]?.extends; }
    return out;
  };
  return {
    nodes: merged,
    effectiveFields(type: string) {
      const o: Record<string, FieldSpec> = {};
      for (const t of chain(type)) Object.assign(o, merged[t]?.fields ?? {});
      return o;
    },
  };
}
