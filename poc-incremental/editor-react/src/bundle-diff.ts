import { RuleSet } from '@udsl/ui-kit-core';

// 域11 结构 diff：比较两份 RuleSet（now=当前草稿 vs base=已发布快照），
//   聚焦有治理意义的变化——规则(by id)、节点(by type)、模块(by id)、版本/状态。
export interface DiffEntry { key: string; kind: 'added' | 'removed' | 'changed'; detail?: string; }
export interface BundleDiff {
  versionChanged?: { from: string; to: string };
  statusChanged?: { from: string; to: string };
  rules: DiffEntry[];
  nodes: DiffEntry[];
  modules: DiffEntry[];
  uses: DiffEntry[];
}

const byId = (arr: any[] | undefined, idKey: string): Map<string, any> => {
  const m = new Map<string, any>();
  for (const x of arr ?? []) m.set(String(x[idKey] ?? JSON.stringify(x)), x);
  return m;
};

function diffCollection(base: Map<string, any>, now: Map<string, any>): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const [k, v] of now) {
    if (!base.has(k)) out.push({ key: k, kind: 'added' });
    else if (JSON.stringify(base.get(k)) !== JSON.stringify(v)) out.push({ key: k, kind: 'changed' });
  }
  for (const k of base.keys()) if (!now.has(k)) out.push({ key: k, kind: 'removed' });
  return out;
}

function diffKeyed(base: Record<string, any> | undefined, now: Record<string, any> | undefined): DiffEntry[] {
  const b = new Map(Object.entries(base ?? {})); const n = new Map(Object.entries(now ?? {}));
  return diffCollection(b, n);
}

/** now 相对 base 的结构变化（base=已发布快照，now=当前草稿）。 */
export function diffRuleSet(base: RuleSet, now: RuleSet): BundleDiff {
  const d: BundleDiff = { rules: [], nodes: [], modules: [], uses: [] };
  if ((base as any).version !== (now as any).version) d.versionChanged = { from: (base as any).version ?? '—', to: (now as any).version ?? '—' };
  if ((base as any).status !== (now as any).status) d.statusChanged = { from: (base as any).status ?? '—', to: (now as any).status ?? '—' };
  d.rules = diffCollection(byId(base.rules as any, 'id'), byId(now.rules as any, 'id'));
  d.nodes = diffKeyed(base.model?.nodes, now.model?.nodes);
  d.modules = diffKeyed((base as any).modules, (now as any).modules);
  d.uses = diffCollection(byId(base.uses as any, 'use'), byId(now.uses as any, 'use'));
  return d;
}

export const diffTotal = (d: BundleDiff): number =>
  d.rules.length + d.nodes.length + d.modules.length + d.uses.length + (d.versionChanged ? 1 : 0) + (d.statusChanged ? 1 : 0);
