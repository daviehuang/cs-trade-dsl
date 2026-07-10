import { useMemo, useState } from 'react';
import { EngineMeta, RuleSet } from '@udsl/ui-kit-core';
import { ExprField } from './ExprField';

// 完整规则编写：formula(单/when/cases+fallback) · validation(severity/code) · resolver(source+key) · pipeline(steps)
//   + 列表编辑/删除/复制/enable。表达式全用 ExprField（引擎 parser 即时校验）；新规则写入 RuleSet → 预览用新 session 立刻反映。
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

type Props = {
  ruleSet: RuleSet; imports: Record<string, RuleSet>; meta: EngineMeta;
  addField: (nodeType: string, name: string, spec: any) => void;
  addRule: (rule: any) => void;
  updateRule: (i: number, rule: any) => void;
  deleteRule: (i: number) => void;
  duplicateRule: (i: number) => void;
  toggleRule: (i: number) => void;
};

function collectDataSources(ruleSet: RuleSet, imports: Record<string, RuleSet>) {
  const out: any[] = [], seen = new Set<string>();
  const add = (ds: any[]) => (ds || []).forEach((d) => { if (!seen.has(d.sourceId)) { seen.add(d.sourceId); out.push(d); } });
  add(ruleSet.dataSources as any);
  for (const ref of (ruleSet.imports ?? []).map((i) => i.ref)) if (imports[ref]) add(imports[ref].dataSources as any);
  return out;
}

const blankRule = (scope: string) => ({ id: '', type: 'formula', scope, trigger: 'calc', target: '', expr: '' });
const summary = (r: any) => r.type === 'validation' ? (r.expr || '') : r.cases ? `cases[${r.cases.length}]${r.fallback ? ' · fallback:' + r.fallback : ''}` : r.steps ? `steps[${r.steps.length}]` : r.source ? `source:${r.source}` : (r.expr || '');

export function RulesEditor({ ruleSet, imports, meta, addField, addRule, updateRule, deleteRule, duplicateRule, toggleRule }: Props) {
  const nodeTypes = Object.keys(meta.nodes);
  const rules: any[] = ruleSet.rules ?? [];
  const dataSources = useMemo(() => collectDataSources(ruleSet, imports), [ruleSet, imports]);

  // 加模型字段
  const [fNode, setFNode] = useState(meta.root);
  const [fName, setFName] = useState('');
  const [fType, setFType] = useState('decimal');
  const [fFlag, setFFlag] = useState<'input' | 'computed' | 'external' | 'overridable'>('computed');

  // 规则草稿：editing = 索引(编辑) / -1(新增) / null(关闭)
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const startAdd = () => { setDraft(blankRule(meta.root)); setEditing(-1); };
  const startEdit = (i: number) => { setDraft(clone(rules[i])); setEditing(i); };
  const cancel = () => { setEditing(null); setDraft(null); };
  const save = () => { if (editing === -1) addRule(draft); else if (editing !== null) updateRule(editing, draft); cancel(); };
  const set = (patch: any) => setDraft({ ...draft, ...patch });

  const targetFields = draft ? Object.keys(meta.effectiveFields(draft.scope)) : [];

  return (
    <div className="ed-sec">
      <h4>规则（{rules.length}） <button className="mini primary" onClick={startAdd}>＋ 新增规则</button></h4>
      <table className="ed-tbl">
        <thead><tr><th></th><th>id</th><th>type</th><th>scope/target</th><th>摘要</th><th></th></tr></thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i} className={r.enabled === false ? 'off' : ''}>
              <td><input type="checkbox" checked={r.enabled !== false} onChange={() => toggleRule(i)} title="enabled" /></td>
              <td>{r.id}</td><td><span className={'kind ' + r.type}>{r.type}</span></td>
              <td><code>{r.scope}{r.target ? '.' + r.target : ''}</code></td>
              <td className="ex"><code>{summary(r)}</code></td>
              <td className="ops">
                <button onClick={() => startEdit(i)}>改</button>
                <button onClick={() => duplicateRule(i)}>复制</button>
                <button className="del" onClick={() => deleteRule(i)}>✕</button>
              </td>
            </tr>
          ))}
          {!rules.length && <tr><td colSpan={6} className="muted">暂无规则</td></tr>}
        </tbody>
      </table>

      {draft && (
        <div className="rule-form">
          <div className="rf-h"><b>{editing === -1 ? '新增规则' : '编辑规则'}</b>
            <span><button className="primary" disabled={!draft.id} onClick={save}>保存</button> <button onClick={cancel}>取消</button></span></div>
          <div className="ed-grid">
            <label>id<input value={draft.id} onChange={(e) => set({ id: e.target.value })} placeholder="唯一 id" /></label>
            <label>type
              <select value={draft.type} onChange={(e) => { const t = e.target.value; const b: any = { id: draft.id, type: t, scope: draft.scope }; if (t === 'formula') { b.trigger = 'calc'; b.target = draft.target || ''; b.expr = ''; } if (t === 'validation') { b.trigger = 'after-calc'; b.expr = ''; b.severity = 'error'; b.message = ''; } if (t === 'resolver') { b.target = draft.target || ''; b.source = ''; b.key = {}; } if (t === 'pipeline') { b.trigger = 'calc'; b.target = draft.target || ''; b.steps = [{ expr: '' }]; } setDraft(b); }}>
                <option value="formula">formula</option><option value="validation">validation</option>
                <option value="resolver">resolver</option><option value="pipeline">pipeline</option>
              </select>
            </label>
            <label>scope（作用域节点）<select value={draft.scope} onChange={(e) => set({ scope: e.target.value, target: '' })}>{nodeTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>trigger（触发时机）
              <select value={draft.trigger ?? (draft.type === 'validation' ? 'after-calc' : 'calc')} onChange={(e) => set({ trigger: e.target.value })}>
                <option value="calc">calc（计算期）</option>
                <option value="after-calc">after-calc（计算后）</option>
              </select>
            </label>
            {draft.type !== 'validation' &&
              <label>target（目标字段）
                <input list="rf-target-dl" value={draft.target ?? ''} onChange={(e) => set({ target: e.target.value })} placeholder="选或输入字段名" />
                <datalist id="rf-target-dl">{targetFields.map((f) => <option key={f} value={f} />)}</datalist>
              </label>}
          </div>
          {draft.type !== 'validation' && draft.target && !targetFields.includes(draft.target) &&
            <div className="hint">⚠ 目标字段 <code>{draft.target}</code> 不在 <code>{draft.scope}</code> 的有效字段中——记得到「模型」为该节点添加此字段。</div>}

          {draft.type === 'formula' && <FormulaBody draft={draft} set={set} />}
          {draft.type === 'validation' && <ValidationBody draft={draft} set={set} />}
          {draft.type === 'resolver' && <ResolverBody draft={draft} set={set} dataSources={dataSources} />}
          {draft.type === 'pipeline' && <PipelineBody draft={draft} set={set} />}
        </div>
      )}

      <h4>＋ 加模型字段</h4>
      <div className="ed-grid">
        <label>节点<select value={fNode} onChange={(e) => setFNode(e.target.value)}>{nodeTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>字段名<input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="如 vatTotal" /></label>
        <label>类型<select value={fType} onChange={(e) => setFType(e.target.value)}><option>decimal</option><option>int</option><option>string</option><option>date</option></select></label>
        <label>种类<select value={fFlag} onChange={(e) => setFFlag(e.target.value as any)}><option value="input">input（可编辑）</option><option value="computed">computed（计算）</option><option value="external">external（外部注入）</option><option value="overridable">computed+overridable</option></select></label>
      </div>
      <button className="primary" disabled={!fName} onClick={() => {
        const spec: any = { type: fType };
        if (fFlag === 'computed') spec.computed = true;
        if (fFlag === 'external') spec.external = true;
        if (fFlag === 'overridable') { spec.computed = true; spec.overridable = true; }
        addField(fNode, fName, spec); setFName('');
      }}>加字段</button>
    </div>
  );
}

// ── formula：单 expr / when+expr / cases[] + fallback ──
function FormulaBody({ draft, set }: any) {
  const mode = draft.cases ? 'cases' : draft.when !== undefined ? 'when' : 'single';
  const setMode = (m: string) => {
    if (m === 'single') set({ cases: undefined, when: undefined, fallback: undefined, expr: draft.expr || '' });
    else if (m === 'when') set({ cases: undefined, fallback: undefined, when: draft.when || '', expr: draft.expr || '' });
    else set({ when: undefined, expr: undefined, cases: draft.cases || [{ when: '', expr: '' }], fallback: draft.fallback || undefined });
  };
  const cases: any[] = draft.cases || [];
  const setCase = (i: number, patch: any) => { const cs = cases.map((c, k) => k === i ? { ...c, ...patch } : c); set({ cases: cs }); };
  return (
    <>
      <div className="ed-row"><label>形态
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="single">单表达式</option><option value="when">条件 when + expr</option><option value="cases">多分支 cases + fallback</option>
        </select></label>
      </div>
      {mode === 'single' && <label className="full">expr<ExprField value={draft.expr || ''} onChange={(v) => set({ expr: v })} placeholder="如 round(sum(items.amount), 2)" /></label>}
      {mode === 'when' && <>
        <label className="full">when（守卫）<ExprField value={draft.when || ''} onChange={(v) => set({ when: v })} placeholder="如 adjustMode == &quot;auto-high&quot;" /></label>
        <label className="full">expr<ExprField value={draft.expr || ''} onChange={(v) => set({ expr: v })} /></label>
      </>}
      {mode === 'cases' && <>
        {cases.map((c, i) => (
          <div key={i} className="case-row">
            <div className="case-n">#{i + 1}</div>
            <div style={{ flex: 1 }}>
              <label className="full">when（省略=else，须放最后）<ExprField value={c.when || ''} onChange={(v) => setCase(i, { when: v || undefined })} /></label>
              <label className="full">expr<ExprField value={c.expr || ''} onChange={(v) => setCase(i, { expr: v })} /></label>
              <label className="ck" title="命中此分支时允许人工覆盖；中台对覆盖值不做计算比对（锁死分支则权威验算）"><input type="checkbox" checked={!!c.overridable} onChange={(e) => setCase(i, { overridable: e.target.checked || undefined })} />可覆盖（命中此分支时）</label>
            </div>
            <button className="del" onClick={() => set({ cases: cases.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
        <button onClick={() => set({ cases: [...cases, { when: '', expr: '' }] })}>＋ 分支</button>
        <label className="ed-row">fallback
          <select value={draft.fallback || ''} onChange={(e) => set({ fallback: e.target.value || undefined })}>
            <option value="">无（→ null）</option><option value="input">input（条件可输入）</option>
          </select></label>
      </>}
    </>
  );
}

function ValidationBody({ draft, set }: any) {
  return (
    <>
      <label className="full">expr（须 ==true）<ExprField value={draft.expr || ''} onChange={(v) => set({ expr: v })} placeholder="如 net <= maxNet" /></label>
      <label className="full">message（可插值 {'{expr}'}）<input value={draft.message || ''} onChange={(e) => set({ message: e.target.value })} placeholder="如 净额 {net} 超上限 {maxNet}" /></label>
      <div className="ed-grid">
        <label>severity<select value={draft.severity || 'error'} onChange={(e) => set({ severity: e.target.value })}><option>error</option><option>warn</option></select></label>
        <label>code（治理）<input value={draft.code || ''} onChange={(e) => set({ code: e.target.value })} placeholder="如 E_NET_LIMIT" /></label>
      </div>
    </>
  );
}

function ResolverBody({ draft, set, dataSources }: any) {
  const src = dataSources.find((d: any) => d.sourceId === draft.source);
  const keyNames: string[] = src ? Object.keys(src.keySchema || {}) : Object.keys(draft.key || {});
  const setKey = (k: string, v: string) => set({ key: { ...(draft.key || {}), [k]: v } });
  return (
    <>
      <div className="ed-grid">
        <label>source（dataSource）
          <select value={draft.source || ''} onChange={(e) => set({ source: e.target.value })}>
            <option value="">选数据源…</option>{dataSources.map((d: any) => <option key={d.sourceId} value={d.sourceId}>{d.sourceId}</option>)}
          </select></label>
      </div>
      {src && <div className="hint">keySchema：{keyNames.join(', ') || '（无）'}</div>}
      {keyNames.map((k) => (
        <label key={k} className="full">key.{k}<ExprField value={(draft.key || {})[k] || ''} onChange={(v) => setKey(k, v)} placeholder="如 ctx.baseCcy / ccy / root.valueDate" /></label>
      ))}
      {!src && <div className="hint">先登记 dataSources（Phase 2）或选已有源；预览需宿主 resolver 支持该 source 才能取到值。</div>}
    </>
  );
}

function PipelineBody({ draft, set }: any) {
  const steps: any[] = draft.steps || [];
  const setStep = (i: number, v: string) => set({ steps: steps.map((s, k) => k === i ? { expr: v } : s) });
  return (
    <>
      <div className="hint">每步 expr 可用隐式变量 <code>value</code>（上一步结果）。</div>
      {steps.map((s, i) => (
        <div key={i} className="case-row">
          <div className="case-n">#{i + 1}</div>
          <div style={{ flex: 1 }}><label className="full">expr<ExprField value={s.expr || ''} onChange={(v) => setStep(i, v)} /></label></div>
          <button className="del" onClick={() => set({ steps: steps.filter((_, k) => k !== i) })}>✕</button>
        </div>
      ))}
      <button onClick={() => set({ steps: [...steps, { expr: '' }] })}>＋ 步骤</button>
    </>
  );
}
