import { useMemo, useState } from 'react';
import { EngineMeta, RuleSet } from '@udsl/ui-kit-core';

// 域3 模块与装配（Modules & uses）：
//   A. modules 定义：moduleId/version/inputs/context/fields/rules(resolver·formula·validation)/outputs。
//      模块是「可复用切面」——自带输入契约 + 内部计算/取数/校验 + 输出，被 uses 挂到宿主节点类型上。
//   B. uses 装配：use(选模块，本地裸名 / alias.mod) + on(宿主类型) + as + bind(入参←宿主 expr) + produce(输出→宿主字段)。
//   作用于当前编辑对象（场景或库）的 ruleSet.modules / ruleSet.uses。
type Props = { ruleSet: RuleSet; meta: EngineMeta; imports: Record<string, RuleSet>; mutateRuleSet: (fn: (rs: RuleSet) => void) => void; };

const TYPES = ['decimal', 'int', 'string', 'date'];

export function ModulesEditor({ ruleSet, meta, imports, mutateRuleSet }: Props) {
  const modules: Record<string, any> = (ruleSet.modules as any) ?? {};
  const localIds = Object.keys(modules);
  const [sel, setSel] = useState(localIds[0] ?? '');
  const [newMod, setNewMod] = useState('');
  const mod = modules[sel];

  // 可装配模块清单：本地模块(裸名) + 各 import 库的模块(alias.mod)。
  const catalog = useMemo(() => {
    const out: { use: string; def: any }[] = [];
    for (const id of Object.keys(modules)) out.push({ use: id, def: modules[id] });
    for (const imp of ruleSet.imports ?? []) {
      const lib: any = imports[imp.ref];
      for (const id of Object.keys(lib?.modules ?? {})) out.push({ use: `${imp.as}.${id}`, def: lib.modules[id] });
    }
    return out;
  }, [modules, ruleSet.imports, imports]);
  const resolveUseDef = (useStr: string) => catalog.find((c) => c.use === useStr)?.def;

  const dataSources: any[] = useMemo(() => {
    const all = [...((ruleSet.dataSources as any) ?? [])];
    for (const imp of ruleSet.imports ?? []) { const lib: any = imports[imp.ref]; if (lib?.dataSources) all.push(...lib.dataSources); }
    return all;
  }, [ruleSet.dataSources, ruleSet.imports, imports]);

  const patchMod = (fn: (m: any) => void) => mutateRuleSet((rs: any) => fn((rs.modules ??= {})[sel]));
  const addModule = () => { if (!newMod) return; mutateRuleSet((rs: any) => { (rs.modules ??= {})[newMod] = { moduleId: newMod, version: '1.0.0', inputs: {}, fields: {}, rules: [], outputs: [] }; }); setSel(newMod); setNewMod(''); };
  const delModule = (id: string) => mutateRuleSet((rs: any) => { delete rs.modules[id]; });

  const allTypes = Object.keys(meta.nodes);

  return (
    <div className="ed-sec">
      <h4>模块 modules（本地 {localIds.length}）</h4>
      <table className="ed-tbl">
        <thead><tr><th>moduleId</th><th>version</th><th>inputs·fields·rules·outputs</th><th></th></tr></thead>
        <tbody>
          {localIds.map((id) => {
            const m = modules[id];
            return (
              <tr key={id} className={id === sel ? 'selrow' : ''} onClick={() => setSel(id)} style={{ cursor: 'pointer' }}>
                <td><b>{id}</b></td><td>{m.version || '—'}</td>
                <td className="muted">{Object.keys(m.inputs || {}).length}i · {Object.keys(m.fields || {}).length}f · {(m.rules || []).length}r · {(m.outputs || []).length}o</td>
                <td className="ops"><button className="del" onClick={(e) => { e.stopPropagation(); delModule(id); if (sel === id) setSel(localIds.find((x) => x !== id) ?? ''); }}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="ed-row"><input value={newMod} onChange={(e) => setNewMod(e.target.value)} placeholder="新模块 moduleId，如 vatConvert" /><button className="primary" onClick={addModule} disabled={!newMod}>加模块</button></div>

      {mod && <ModuleForm mod={mod} dataSources={dataSources} patchMod={patchMod} />}

      <UsesEditor ruleSet={ruleSet} allTypes={allTypes} meta={meta} catalog={catalog} resolveUseDef={resolveUseDef} mutateRuleSet={mutateRuleSet} />
    </div>
  );
}

function ModuleForm({ mod, dataSources, patchMod }: { mod: any; dataSources: any[]; patchMod: (fn: (m: any) => void) => void }) {
  const [inName, setInName] = useState(''); const [inType, setInType] = useState('decimal');
  const [fName, setFName] = useState(''); const [fKind, setFKind] = useState('computed');
  const fieldNames = Object.keys(mod.fields ?? {});

  return (
    <div className="rule-form" style={{ marginTop: 10 }}>
      <div className="rf-h"><b>模块 {mod.moduleId}</b></div>
      <div className="ed-grid">
        <label>moduleId<input value={mod.moduleId ?? ''} onChange={(e) => patchMod((m) => { m.moduleId = e.target.value; })} /></label>
        <label>version<input value={mod.version ?? ''} onChange={(e) => patchMod((m) => { m.version = e.target.value; })} /></label>
        <label className="full">description<input value={mod.description ?? ''} onChange={(e) => patchMod((m) => { m.description = e.target.value; })} /></label>
      </div>

      <div className="ds-sub">inputs（入参契约）</div>
      {Object.entries(mod.inputs ?? {}).map(([n, t]: any) => (
        <div key={n} className="ed-row"><code style={{ minWidth: 90 }}>{n}</code>:
          <select value={t} onChange={(e) => patchMod((m) => { m.inputs[n] = e.target.value; })} style={{ width: 110 }}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select>
          <button className="del" onClick={() => patchMod((m) => { delete m.inputs[n]; })}>✕</button>
        </div>
      ))}
      <div className="ed-row">
        <input value={inName} onChange={(e) => setInName(e.target.value)} placeholder="入参名，如 amount" style={{ width: 130 }} />:
        <select value={inType} onChange={(e) => setInType(e.target.value)} style={{ width: 110 }}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select>
        <button className="primary" disabled={!inName} onClick={() => { patchMod((m) => { (m.inputs ??= {})[inName] = inType; }); setInName(''); }}>加入参</button>
      </div>

      <div className="ds-sub">fields（模块内字段）</div>
      {Object.entries(mod.fields ?? {}).map(([n, s]: any) => (
        <div key={n} className="ed-row"><code style={{ minWidth: 90 }}>{n}</code>
          <select value={s.external ? 'external' : 'computed'} onChange={(e) => patchMod((m) => { m.fields[n] = e.target.value === 'external' ? { type: s.type ?? 'decimal', external: true } : { type: s.type ?? 'decimal', computed: true }; })} style={{ width: 150 }}>
            <option value="computed">computed（公式算）</option><option value="external">external（resolver 取）</option></select>
          <select value={s.type ?? 'decimal'} onChange={(e) => patchMod((m) => { m.fields[n].type = e.target.value; })} style={{ width: 100 }}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select>
          <button className="del" onClick={() => patchMod((m) => { delete m.fields[n]; })}>✕</button>
        </div>
      ))}
      <div className="ed-row">
        <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="字段名，如 conv" style={{ width: 130 }} />
        <select value={fKind} onChange={(e) => setFKind(e.target.value)} style={{ width: 150 }}><option value="computed">computed（公式算）</option><option value="external">external（resolver 取）</option></select>
        <button className="primary" disabled={!fName} onClick={() => { patchMod((m) => { (m.fields ??= {})[fName] = fKind === 'external' ? { type: 'decimal', external: true } : { type: 'decimal', computed: true }; }); setFName(''); }}>加字段</button>
      </div>

      <ModuleRules mod={mod} dataSources={dataSources} fieldNames={fieldNames} patchMod={patchMod} />

      <div className="ds-sub">outputs（对宿主暴露的输出）</div>
      <div className="ed-row" style={{ flexWrap: 'wrap' }}>
        {fieldNames.map((f) => {
          const on = (mod.outputs ?? []).includes(f);
          return <label key={f} className="ck"><input type="checkbox" checked={on} onChange={() => patchMod((m) => { const o = new Set(m.outputs ?? []); on ? o.delete(f) : o.add(f); m.outputs = [...o]; })} />{f}</label>;
        })}
        {fieldNames.length === 0 && <span className="muted">（先加字段）</span>}
      </div>
    </div>
  );
}

function ModuleRules({ mod, dataSources, fieldNames, patchMod }: { mod: any; dataSources: any[]; fieldNames: string[]; patchMod: (fn: (m: any) => void) => void }) {
  const [rt, setRt] = useState<'resolver' | 'formula' | 'validation'>('formula');
  const rules: any[] = mod.rules ?? [];
  const addRule = () => patchMod((m) => {
    const id = rt + (m.rules?.length ?? 0);
    const base = rt === 'resolver' ? { id, type: 'resolver', target: fieldNames[0] ?? '', source: dataSources[0]?.sourceId ?? '', key: {} }
      : rt === 'formula' ? { id, type: 'formula', target: fieldNames[0] ?? '', expr: '' }
        : { id, type: 'validation', expr: '', severity: 'error', message: '' };
    (m.rules ??= []).push(base);
  });
  const patchRule = (i: number, p: any) => patchMod((m) => { m.rules[i] = { ...m.rules[i], ...p }; });
  const delRule = (i: number) => patchMod((m) => { m.rules.splice(i, 1); });

  return (
    <>
      <div className="ds-sub">rules（模块内规则）</div>
      {rules.map((r, i) => (
        <div key={i} className="ed-row" style={{ flexWrap: 'wrap', borderBottom: '1px dashed #e6ebf2', paddingBottom: 6 }}>
          <span className="kind">{r.type}</span>
          <input value={r.id ?? ''} onChange={(e) => patchRule(i, { id: e.target.value })} placeholder="id" style={{ width: 90 }} />
          {r.type !== 'validation' && (
            <label>target<select value={r.target ?? ''} onChange={(e) => patchRule(i, { target: e.target.value })}>{fieldNames.map((f) => <option key={f}>{f}</option>)}</select></label>
          )}
          {r.type === 'resolver' ? (
            <>
              <label>source<select value={r.source ?? ''} onChange={(e) => patchRule(i, { source: e.target.value })}><option value="">（选数据源）</option>{dataSources.map((d) => <option key={d.sourceId}>{d.sourceId}</option>)}</select></label>
              <ResolverKey r={r} dataSources={dataSources} onChange={(key) => patchRule(i, { key })} />
            </>
          ) : r.type === 'formula' ? (
            <input value={r.expr ?? ''} onChange={(e) => patchRule(i, { expr: e.target.value })} placeholder="expr，如 amount * rate" style={{ flex: 1, minWidth: 200 }} />
          ) : (
            <>
              <input value={r.expr ?? ''} onChange={(e) => patchRule(i, { expr: e.target.value })} placeholder="expr（校验），如 sanctionScore < 50" style={{ flex: 1, minWidth: 180 }} />
              <input value={r.message ?? ''} onChange={(e) => patchRule(i, { message: e.target.value })} placeholder="message" style={{ width: 150 }} />
            </>
          )}
          <button className="del" onClick={() => delRule(i)}>✕</button>
        </div>
      ))}
      <div className="ed-row">
        <select value={rt} onChange={(e) => setRt(e.target.value as any)}><option value="formula">formula</option><option value="resolver">resolver</option><option value="validation">validation</option></select>
        <button className="primary" onClick={addRule}>加规则</button>
      </div>
    </>
  );
}

// resolver.key：按所选 source 的 keySchema 引导，每个 schema 键映射一个表达式（模块 input 名 / ctx.*）。
function ResolverKey({ r, dataSources, onChange }: { r: any; dataSources: any[]; onChange: (key: any) => void }) {
  const ds = dataSources.find((d) => d.sourceId === r.source);
  const schema = Object.keys(ds?.keySchema ?? {});
  if (!schema.length) return <span className="muted" style={{ fontSize: 12 }}>（选 source 后按 keySchema 填映射）</span>;
  return (
    <span className="ed-row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {schema.map((k) => (
        <label key={k} style={{ fontSize: 12 }}>{k}=<input value={r.key?.[k] ?? ''} onChange={(e) => onChange({ ...(r.key ?? {}), [k]: e.target.value })} placeholder="expr" style={{ width: 90 }} /></label>
      ))}
    </span>
  );
}

function UsesEditor({ ruleSet, allTypes, meta, catalog, resolveUseDef, mutateRuleSet }: {
  ruleSet: RuleSet; allTypes: string[]; meta: EngineMeta; catalog: { use: string; def: any }[];
  resolveUseDef: (u: string) => any; mutateRuleSet: (fn: (rs: RuleSet) => void) => void;
}) {
  const uses: any[] = (ruleSet.uses as any) ?? [];
  const addUse = () => mutateRuleSet((rs: any) => { (rs.uses ??= []).push({ use: catalog[0]?.use ?? '', on: allTypes[0] ?? '', as: 'm', bind: {}, produce: {} }); });
  const patchUse = (i: number, p: any) => mutateRuleSet((rs: any) => { rs.uses[i] = { ...rs.uses[i], ...p }; });
  const delUse = (i: number) => mutateRuleSet((rs: any) => { rs.uses.splice(i, 1); });

  return (
    <div style={{ marginTop: 14 }}>
      <h4>装配 uses（模块挂到宿主类型，{uses.length}）</h4>
      {uses.length === 0 && <div className="muted">暂无装配。把模块挂到某宿主节点类型，bind 入参、produce 输出到宿主字段。</div>}
      {uses.map((u, i) => {
        const def = resolveUseDef(u.use);
        const inputs = Object.keys(def?.inputs ?? {});
        const outputs: string[] = def?.outputs ?? [];
        const hostFields = u.on ? Object.entries(meta.effectiveFields(u.on)) : [];
        return (
          <div key={i} className="rule-form" style={{ marginTop: 8 }}>
            <div className="rf-h"><b>{u.use || '(选模块)'} → {u.on || '(宿主)'}</b><button className="del" onClick={() => delUse(i)}>删除</button></div>
            <div className="ed-grid">
              <label>use（模块）<select value={u.use ?? ''} onChange={(e) => patchUse(i, { use: e.target.value })}>{catalog.map((c) => <option key={c.use}>{c.use}</option>)}</select></label>
              <label>on（宿主类型）<select value={u.on ?? ''} onChange={(e) => patchUse(i, { on: e.target.value })}>{allTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>as（别名）<input value={u.as ?? ''} onChange={(e) => patchUse(i, { as: e.target.value })} style={{ width: 90 }} /></label>
            </div>

            <div className="ds-sub">bind（入参 ← 宿主表达式）</div>
            {inputs.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>（该模块无 inputs）</span> : inputs.map((inp) => (
              <div key={inp} className="ed-row"><code style={{ minWidth: 90 }}>{inp}</code>←
                <input value={u.bind?.[inp] ?? ''} onChange={(e) => patchUse(i, { bind: { ...(u.bind ?? {}), [inp]: e.target.value } })} placeholder="宿主字段 / ctx.*，如 amount 或 ctx.baseCcy" style={{ flex: 1, minWidth: 200 }} />
              </div>
            ))}

            <div className="ds-sub">produce（输出 → 宿主字段）</div>
            {outputs.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>（该模块无 outputs）</span> : outputs.map((o) => (
              <div key={o} className="ed-row"><code style={{ minWidth: 90 }}>{o}</code>→
                <select value={u.produce?.[o] ?? ''} onChange={(e) => patchUse(i, { produce: { ...(u.produce ?? {}), [o]: e.target.value } })}>
                  <option value="">（不写回）</option>
                  {hostFields.filter(([, s]: any) => s.external || s.computed || s.overridable).map(([f]) => <option key={f}>{f}</option>)}
                </select>
              </div>
            ))}
          </div>
        );
      })}
      <div className="ed-row"><button className="primary" onClick={addUse} disabled={!catalog.length}>＋ 新增装配 use</button></div>
    </div>
  );
}
