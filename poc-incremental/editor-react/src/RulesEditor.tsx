import { useState } from 'react';
import { EngineMeta, RuleSet } from '@udsl/ui-kit-core';
import { ExprField } from './ExprField';

// 规则侧（完整规则编写的最小实现）：加模型字段、加 formula、加 validation。
//   表达式用 ExprField（引擎 parser 即时校验）；新规则写入 RuleSet → 预览用新 session 立刻反映。
export function RulesEditor({ ruleSet, meta, addField, addRule }: {
  ruleSet: RuleSet; meta: EngineMeta;
  addField: (nodeType: string, name: string, spec: any) => void;
  addRule: (rule: any) => void;
}) {
  const nodeTypes = Object.keys(meta.nodes);
  const rules: any[] = ruleSet.rules ?? [];

  // 加字段
  const [fNode, setFNode] = useState(meta.root);
  const [fName, setFName] = useState('');
  const [fType, setFType] = useState('decimal');
  const [fComputed, setFComputed] = useState(true);

  // 加 formula
  const [foId, setFoId] = useState('');
  const [foScope, setFoScope] = useState(meta.root);
  const [foTarget, setFoTarget] = useState('');
  const [foExpr, setFoExpr] = useState('');

  // 加 validation
  const [vId, setVId] = useState('');
  const [vScope, setVScope] = useState(meta.root);
  const [vExpr, setVExpr] = useState('');
  const [vMsg, setVMsg] = useState('');

  const targetFields = Object.keys(meta.effectiveFields(foScope));

  return (
    <div className="ed-sec">
      <h4>已有规则（{rules.length}）</h4>
      <table className="ed-tbl">
        <thead><tr><th>id</th><th>type</th><th>scope/target</th><th>expr</th></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td><td><span className={'kind ' + r.type}>{r.type}</span></td>
              <td><code>{r.scope}{r.target ? '.' + r.target : ''}</code></td>
              <td className="ex"><code>{r.expr ?? (r.cases ? 'cases…' : '')}</code></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>＋ 加模型字段</h4>
      <div className="ed-grid">
        <label>节点<select value={fNode} onChange={(e) => setFNode(e.target.value)}>{nodeTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>字段名<input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="如 vatTotal" /></label>
        <label>类型<select value={fType} onChange={(e) => setFType(e.target.value)}><option>decimal</option><option>string</option><option>date</option></select></label>
        <label className="ck"><input type="checkbox" checked={fComputed} onChange={(e) => setFComputed(e.target.checked)} />computed（计算值）</label>
      </div>
      <button className="primary" disabled={!fName} onClick={() => { addField(fNode, fName, { type: fType, ...(fComputed ? { computed: true } : {}) }); setFName(''); }}>加字段</button>

      <h4>＋ 加 formula（计算规则）</h4>
      <div className="ed-grid">
        <label>id<input value={foId} onChange={(e) => setFoId(e.target.value)} placeholder="如 vatCalc" /></label>
        <label>scope<select value={foScope} onChange={(e) => { setFoScope(e.target.value); setFoTarget(''); }}>{nodeTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>target<select value={foTarget} onChange={(e) => setFoTarget(e.target.value)}><option value="">选字段…</option>{targetFields.map((f) => <option key={f}>{f}</option>)}</select></label>
      </div>
      <label className="full">expr<ExprField value={foExpr} onChange={setFoExpr} placeholder="如 round(chargeTotal * 0.06, 2)" /></label>
      <button className="primary" disabled={!foId || !foTarget || !foExpr.trim()} onClick={() => { addRule({ id: foId, type: 'formula', scope: foScope, trigger: 'calc', target: foTarget, expr: foExpr }); setFoId(''); setFoExpr(''); }}>加 formula</button>

      <h4>＋ 加 validation（校验规则）</h4>
      <div className="ed-grid">
        <label>id<input value={vId} onChange={(e) => setVId(e.target.value)} placeholder="如 vatLimit" /></label>
        <label>scope<select value={vScope} onChange={(e) => setVScope(e.target.value)}>{nodeTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
      </div>
      <label className="full">expr<ExprField value={vExpr} onChange={setVExpr} placeholder="如 net <= maxNet" /></label>
      <label className="full">message<input value={vMsg} onChange={(e) => setVMsg(e.target.value)} placeholder="如 净额 {net} 超上限 {maxNet}" /></label>
      <button className="primary" disabled={!vId || !vExpr.trim()} onClick={() => { addRule({ id: vId, type: 'validation', scope: vScope, trigger: 'after-calc', expr: vExpr, severity: 'error', message: vMsg }); setVId(''); setVExpr(''); setVMsg(''); }}>加 validation</button>
    </div>
  );
}
