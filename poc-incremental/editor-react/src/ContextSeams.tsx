import { useMemo, useState } from 'react';
import { RuleSet } from '@udsl/ui-kit-core';
import { ExprField } from './ExprField';

// 域5 上下文/接缝：编辑 context 映射（key→expr，root 作用域求值）；
//   反查所有规则/uses/库里对 ctx.* 的消费，汇总为"本场景需外部提供的参数清单"。
type Props = { ruleSet: RuleSet; imports: Record<string, RuleSet>; mutateRuleSet: (fn: (rs: RuleSet) => void) => void; };

function collectCtxRefs(ruleSet: RuleSet, imports: Record<string, RuleSet>): Record<string, string[]> {
  const hits: Record<string, string[]> = {};
  const scan = (text: any, where: string) => {
    if (typeof text !== 'string') return;
    const m = text.matchAll(/\bctx\.(\w+)/g);
    for (const x of m) (hits[x[1]] ??= []).includes(where) || (hits[x[1]] ??= []).push(where);
  };
  const scanRules = (rs: any, tag: string) => {
    for (const r of rs.rules ?? []) {
      scan(r.expr, `${tag}:${r.id}`); scan(r.when, `${tag}:${r.id}`); scan(r.message, `${tag}:${r.id}`);
      for (const c of r.cases ?? []) { scan(c.when, `${tag}:${r.id}`); scan(c.expr, `${tag}:${r.id}`); }
      for (const s of r.steps ?? []) scan(s.expr, `${tag}:${r.id}`);
      for (const v of Object.values(r.key ?? {})) scan(v, `${tag}:${r.id}`);
    }
    for (const u of rs.uses ?? []) {
      for (const v of Object.values(u.bind ?? {})) scan(v, `${tag}:use ${u.use}`);
      for (const v of Object.values(u.produce ?? {})) scan(v, `${tag}:use ${u.use}`);
    }
    for (const mod of Object.values(rs.modules ?? {}) as any[])
      for (const r of mod.rules ?? []) { scan(r.expr, `模块 ${mod.moduleId}:${r.id}`); for (const v of Object.values(r.key ?? {})) scan(v, `模块 ${mod.moduleId}:${r.id}`); }
  };
  scanRules(ruleSet, '本场景');
  for (const ref of (ruleSet.imports ?? []).map((i) => i.ref)) if (imports[ref]) scanRules(imports[ref], ref);
  return hits;
}

export function ContextSeams({ ruleSet, imports, mutateRuleSet }: Props) {
  const ctx = ruleSet.context ?? {};
  const consumed = useMemo(() => collectCtxRefs(ruleSet, imports), [ruleSet, imports]);
  const [k, setK] = useState('');
  const [expr, setExpr] = useState('');

  const setMap = (key: string, val: string) => mutateRuleSet((rs) => { (rs.context ??= {})[key] = val; });
  const del = (key: string) => mutateRuleSet((rs) => { if (rs.context) delete rs.context[key]; });

  const consumedKeys = Object.keys(consumed).sort();
  const unmapped = consumedKeys.filter((key) => !(key in ctx));

  return (
    <div className="ed-sec">
      <h4>context 映射（ctx.key → 表达式，root 作用域）</h4>
      {Object.keys(ctx).length === 0 && <div className="muted">暂无映射</div>}
      {Object.entries(ctx).map(([key, val]) => (
        <div key={key} className="ed-row" style={{ alignItems: 'flex-start' }}>
          <code style={{ marginTop: 8 }}>ctx.{key}</code> =
          <div style={{ flex: 1 }}><ExprField value={val as string} onChange={(v) => setMap(key, v)} placeholder="如 root.dealCcy" /></div>
          <button className="del" onClick={() => del(key)}>✕</button>
        </div>
      ))}
      <div className="ed-row">
        <input value={k} onChange={(e) => setK(e.target.value)} placeholder="key，如 ccy" style={{ width: 120 }} />=
        <div style={{ flex: 1 }}><ExprField value={expr} onChange={setExpr} placeholder="如 root.dealCcy" /></div>
        <button className="primary" disabled={!k || !expr.trim()} onClick={() => { setMap(k, expr); setK(''); setExpr(''); }}>加映射</button>
      </div>

      <h4>外部参数清单（被消费的 ctx.*）</h4>
      {consumedKeys.length === 0 && <div className="muted">没有规则/模块引用 ctx.*</div>}
      <table className="ed-tbl">
        <thead><tr><th>ctx.key</th><th>是否已映射</th><th>消费点</th></tr></thead>
        <tbody>
          {consumedKeys.map((key) => (
            <tr key={key}>
              <td><code>ctx.{key}</code></td>
              <td>{key in ctx ? <span className="lint ok">已映射</span> : <span className="lint bad">未映射</span>}</td>
              <td className="muted" style={{ fontSize: 11 }}>{consumed[key].join('、')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unmapped.length > 0 && <div className="lint warn" style={{ display: 'inline-block', marginTop: 6 }}>⚠ 未映射：{unmapped.map((x) => 'ctx.' + x).join('、')}（这些是本场景需要外部提供的参数）</div>}
    </div>
  );
}
