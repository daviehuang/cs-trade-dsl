// 从【运行时加载的 RuleSet + import 的类型库】推导节点元数据。
// 与引擎同构：合并 importedNodes + model.nodes，沿 extends 链取有效字段/槽位/子集合（继承感知）。
// 自动布局 / hydrate / linter / 编辑器调色板都用它。
import { RuleSet } from './engine-types';

export interface FieldSpec {
  type?: string;
  computed?: boolean;
  external?: boolean;
  overridable?: boolean;
  /** 字段的人类可读描述（单一事实来源）：页面标签兜底 + 报错 {字段:label} 引用。 */
  label?: string;
}

export interface ChildColl { name: string; node: string; }
export interface SlotDef { node: string; optional: boolean; }

export interface EngineMeta {
  /** 合并后的节点定义表（库节点 + 本规则集节点）。 */
  nodes: Record<string, any>;
  /** 根节点类型（model.root）。 */
  root: string;
  /** 沿 extends 链合并的有效字段（基类在前、子类型在后）。 */
  effectiveFields(type: string): Record<string, FieldSpec>;
  /** 沿 extends 链合并的具名槽位（slot 名 → 子节点类型，归一化）。 */
  effectiveSlots(type: string): Record<string, string>;
  /** 具名槽位完整定义（含 optional）。 */
  effectiveSlotDefs(type: string): Record<string, SlotDef>;
  /** 沿 extends 链合并的子集合定义（去重）。 */
  childrenOf(type: string): ChildColl[];
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
  const normColls = (c: any): ChildColl[] => (!c ? [] : Array.isArray(c) ? c : [c]);
  const slotDefs = (type: string): Record<string, SlotDef> => {
    const raw: Record<string, any> = {};
    for (const t of chain(type)) Object.assign(raw, merged[t]?.slots ?? {});
    const o: Record<string, SlotDef> = {};
    for (const [k, v] of Object.entries(raw)) o[k] = typeof v === 'string' ? { node: v, optional: false } : { node: v.node, optional: !!v.optional };
    return o;
  };

  return {
    nodes: merged,
    root: ruleSet.model?.root,
    effectiveFields(type: string) {
      const o: Record<string, FieldSpec> = {};
      for (const t of chain(type)) Object.assign(o, merged[t]?.fields ?? {});
      return o;
    },
    effectiveSlots(type: string) {
      const o: Record<string, string> = {};
      for (const [k, v] of Object.entries(slotDefs(type))) o[k] = v.node;
      return o;
    },
    effectiveSlotDefs(type: string) { return slotDefs(type); },
    childrenOf(type: string) {
      const out: ChildColl[] = [];
      const seen = new Set<string>();
      for (const t of chain(type))
        for (const c of normColls(merged[t]?.children))
          if (!seen.has(c.name)) { seen.add(c.name); out.push(c); }
      return out;
    },
  };
}
