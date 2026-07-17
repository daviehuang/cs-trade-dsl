import { useMemo, useState } from 'react';
import { RuleSet } from '@udsl/ui-kit-core';
import { ExprField } from './ExprField';

// 域5 上下文/接缝：把 context 拆成两层——
//   ① 契约层：contextKeys 声明（key + type + desc），跨 ruleset 共享（建议在库里声明）；引擎忽略，纯契约元数据。
//   ② 映射层：ruleSet.context（key → 表达式，root 作用域求值），per-ruleset，切换即换。
//   并反查所有规则/uses/库对 ctx.* 的消费，按契约校验（未声明 / 未映射）。
type Props = { ruleSet: RuleSet; imports: Record<string, RuleSet>; mutateRuleSet: (fn: (rs: RuleSet) => void) => void; };
const TYPES = ['string', 'date', 'decimal', 'int'];

function collectCtxRefs(ruleSet: RuleSet, imports: Record<string, RuleSet>): Record<string, string[]> {
  const hits: Record<string, string[]> = {};
  const scan = (text: any, where: string) => {
    if (typeof text !== 'string') return;
    for (const x of text.matchAll(/\bctx\.(\w+)/g)) { const a = (hits[x[1]] ??= []); if (!a.includes(where)) a.push(where); }
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
  const ctx: Record<string, any> = ruleSet.context ?? {};
  const declared: Record<string, any> = (ruleSet as any).contextKeys ?? {};
  const consumed = useMemo(() => collectCtxRefs(ruleSet, imports), [ruleSet, imports]);

  // 导入库声明的契约 key（只读继承）
  const importedKeys = useMemo(() => {
    const out: Record<string, any> = {};
    for (const ref of (ruleSet.imports ?? []).map((i) => i.ref)) {
      const lib: any = imports[ref];
      for (const [k, def] of Object.entries(lib?.contextKeys ?? {})) if (!out[k]) out[k] = { ...(def as any), from: ref };
    }
    return out;
  }, [ruleSet.imports, imports]);

  // 有效 key 全集 = 本地声明 ∪ 导入声明 ∪ 被消费
  const allKeys = useMemo(() => Array.from(new Set([...Object.keys(declared), ...Object.keys(importedKeys), ...Object.keys(consumed)])).sort(), [declared, importedKeys, consumed]);
  const typeOf = (k: string): string => declared[k]?.type ?? importedKeys[k]?.type ?? '—';
  const descOf = (k: string): string => declared[k]?.desc ?? importedKeys[k]?.desc ?? '';
  const isDeclared = (k: string) => k in declared || k in importedKeys;

  const setKeyDef = (name: string, patch: any) => mutateRuleSet((rs: any) => { (rs.contextKeys ??= {})[name] = { type: 'string', ...(rs.contextKeys[name] ?? {}), ...patch }; });
  const delKeyDef = (name: string) => mutateRuleSet((rs: any) => { if (rs.contextKeys) delete rs.contextKeys[name]; });
  const setMap = (key: string, val: string) => mutateRuleSet((rs: any) => { if (val.trim()) (rs.context ??= {})[key] = val; else if (rs.context) delete rs.context[key]; });

  const [nk, setNk] = useState(''); const [nt, setNt] = useState('string'); const [nd, setNd] = useState('');
  const unmapped = allKeys.filter((k) => k in consumed && !(k in ctx));      // 被用到但没映射 = 断链
  const undeclared = Object.keys(ctx).filter((k) => !isDeclared(k));          // 映射了但没声明

  return (
    <div className="ed-sec">
      {/* ① 契约层 */}
      <h4>① context key 声明（契约 · 建议在库里声明，供各场景共享）</h4>
      <table className="ed-tbl">
        <thead><tr><th>key</th><th>type</th><th>说明</th><th></th></tr></thead>
        <tbody>
          {Object.entries(declared).map(([name, def]: any) => (
            <tr key={name}>
              <td><code>ctx.{name}</code></td>
              <td><select value={def.type ?? 'string'} onChange={(e) => setKeyDef(name, { type: e.target.value })} style={{ width: 110 }}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></td>
              <td><input value={def.desc ?? ''} onChange={(e) => setKeyDef(name, { desc: e.target.value })} placeholder="含义，如 整单基准币种" /></td>
              <td className="ops"><button className="del" onClick={() => delKeyDef(name)}>✕</button></td>
            </tr>
          ))}
          {Object.keys(declared).length === 0 && <tr><td colSpan={4} className="muted">本对象未声明 context key。</td></tr>}
        </tbody>
      </table>
      <div className="ed-row">
        <input value={nk} onChange={(e) => setNk(e.target.value)} placeholder="key，如 baseCcy" style={{ width: 140 }} />
        <select value={nt} onChange={(e) => setNt(e.target.value)} style={{ width: 110 }}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <input value={nd} onChange={(e) => setNd(e.target.value)} placeholder="说明（可选）" />
        <button className="primary" disabled={!nk} onClick={() => { setKeyDef(nk, { type: nt, desc: nd }); setNk(''); setNd(''); }}>加 key</button>
      </div>
      {Object.keys(importedKeys).length > 0 && (
        <div className="hint">继承自 import 库（只读）：{Object.entries(importedKeys).map(([k, d]: any) => <code key={k} style={{ marginRight: 6 }}>ctx.{k}:{d.type}（{d.from}）</code>)}</div>
      )}

      {/* ② 映射层 */}
      <h4 style={{ marginTop: 16 }}>② 本场景映射（ctx.key → 表达式，root 作用域）</h4>
      <table className="ed-tbl">
        <thead><tr><th style={{ width: 150 }}>ctx.key</th><th style={{ width: 90 }}>type</th><th>映射表达式</th><th>状态 / 消费点</th></tr></thead>
        <tbody>
          {allKeys.map((k) => (
            <tr key={k}>
              <td><code>ctx.{k}</code>{descOf(k) && <div className="muted" style={{ fontSize: 16 }}>{descOf(k)}</div>}</td>
              <td className="muted">{typeOf(k)}</td>
              <td><ExprField value={ctx[k] ?? ''} onChange={(v) => setMap(k, v)} placeholder="如 root.baseCcy（留空=不映射）" /></td>
              <td style={{ fontSize: 16 }}>
                {k in ctx ? <span className="lint ok">已映射</span> : <span className="lint bad">未映射</span>}
                {!isDeclared(k) && <span className="lint warn" style={{ marginLeft: 4 }}>未声明</span>}
                {consumed[k] && <div className="muted">用于：{consumed[k].join('、')}</div>}
                {!consumed[k] && k in declared && <div className="muted">（暂未被引用）</div>}
              </td>
            </tr>
          ))}
          {allKeys.length === 0 && <tr><td colSpan={4} className="muted">暂无 context key（先在①声明，或规则里引用 ctx.*）。</td></tr>}
        </tbody>
      </table>
      {unmapped.length > 0 && <div className="lint bad" style={{ display: 'inline-block', marginTop: 6 }}>⛔ 被引用却未映射：{unmapped.map((x) => 'ctx.' + x).join('、')}（本场景必须提供）</div>}
      {undeclared.length > 0 && <div className="lint warn" style={{ display: 'inline-block', marginTop: 6, marginLeft: 8 }}>⚠ 映射了未声明的 key：{undeclared.map((x) => 'ctx.' + x).join('、')}（建议在①补声明或去库里声明）</div>}
    </div>
  );
}
