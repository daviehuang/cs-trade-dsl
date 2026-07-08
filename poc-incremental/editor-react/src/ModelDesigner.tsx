import { useState } from 'react';
import { EngineMeta, RuleSet } from '@udsl/ui-kit-core';

// 域1 数据模型设计：本地节点 CRUD + 字段(type/computed/external/overridable) + extends/abstract + slots + children + 有效字段预览。
//   仅编辑本规则集的 model.nodes；import 的库节点只读展示。
type Props = { ruleSet: RuleSet; meta: EngineMeta; mutateRuleSet: (fn: (rs: RuleSet) => void) => void; isLibrary?: boolean; };
const FLAGS = [
  { k: 'input', label: 'input（可编辑）' }, { k: 'computed', label: 'computed（计算）' },
  { k: 'external', label: 'external（外部注入）' }, { k: 'overridable', label: 'computed+overridable' },
];
const flagOf = (s: any) => s?.overridable ? 'overridable' : s?.external ? 'external' : s?.computed ? 'computed' : 'input';
const specOf = (type: string, flag: string, label?: string) => {
  const s: any = { type };
  if (flag === 'computed') s.computed = true;
  if (flag === 'external') s.external = true;
  if (flag === 'overridable') { s.computed = true; s.overridable = true; }
  if (label) s.label = label;
  return s;
};

export function ModelDesigner({ ruleSet, meta, mutateRuleSet, isLibrary }: Props) {
  const localNodes = ruleSet.model?.nodes ?? {};
  const localTypes = Object.keys(localNodes);
  const allTypes = Object.keys(meta.nodes);
  const importedTypes = allTypes.filter((t) => !localTypes.includes(t));
  const [sel, setSel] = useState(localTypes[0] ?? '');
  const node = localNodes[sel];

  const [newNode, setNewNode] = useState('');
  const [fName, setFName] = useState(''); const [fType, setFType] = useState('decimal'); const [fFlag, setFFlag] = useState('input'); const [fLabel, setFLabel] = useState('');
  const [slotName, setSlotName] = useState(''); const [slotType, setSlotType] = useState(allTypes[0] ?? ''); const [slotOptNew, setSlotOptNew] = useState(false);
  const [collName, setCollName] = useState(''); const [collType, setCollType] = useState(allTypes[0] ?? '');

  const addNode = () => { if (!newNode) return; mutateRuleSet((rs) => { rs.model.nodes[newNode] = { fields: {} }; }); setSel(newNode); setNewNode(''); };
  const delNode = (t: string) => mutateRuleSet((rs) => { delete rs.model.nodes[t]; });
  const setRoot = (t: string) => mutateRuleSet((rs) => { rs.model.root = t; });
  const patchNode = (fn: (n: any) => void) => mutateRuleSet((rs) => fn(rs.model.nodes[sel]));
  // slot 值可为 "类型" 或 { node, optional }
  const slotNode = (v: any) => (typeof v === 'string' ? v : v.node);
  const slotOpt = (v: any) => (typeof v === 'string' ? false : !!v.optional);
  const setSlot = (name: string, nodeType: string, optional: boolean) => patchNode((n) => { (n.slots ??= {})[name] = optional ? { node: nodeType, optional: true } : nodeType; });

  return (
    <div className="ed-sec">
      {!isLibrary ? (
        <div className="ed-row">
          <label>根节点 root<select value={meta.root} onChange={(e) => setRoot(e.target.value)}>{allTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
      ) : (
        <div className="hint">库 = 可被场景 import 的<b>类型 / 模块集合</b>，<b>无需根节点 root</b>——库不是要独立实例化的树。
          场景按<b>类型名</b>（如 <code>CustomerParty</code>）用 slot / children 引用库节点即可。此处只维护节点类型与字段。</div>
      )}

      <h4>{isLibrary ? '库节点' : '本地节点'}（{localTypes.length}）</h4>
      <table className="ed-tbl">
        <thead><tr><th>类型</th><th>extends</th><th>abstract</th><th>字段/槽位/集合</th><th></th></tr></thead>
        <tbody>
          {localTypes.map((t) => {
            const n = localNodes[t];
            return (
              <tr key={t} className={t === sel ? 'selrow' : ''} onClick={() => setSel(t)} style={{ cursor: 'pointer' }}>
                <td><b>{t}</b>{!isLibrary && meta.root === t && <span className="kind" style={{ marginLeft: 6 }}>root</span>}</td>
                <td>{n.extends || '—'}</td><td>{n.abstract ? '✔' : ''}</td>
                <td className="muted">{Object.keys(n.fields || {}).length}f · {Object.keys(n.slots || {}).length}s · {(Array.isArray(n.children) ? n.children.length : n.children ? 1 : 0)}c</td>
                <td className="ops"><button className="del" onClick={(e) => { e.stopPropagation(); delNode(t); if (sel === t) setSel(localTypes.find((x) => x !== t) ?? ''); }}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="ed-row"><input value={newNode} onChange={(e) => setNewNode(e.target.value)} placeholder="新节点类型名，如 InvoiceLine" /><button className="primary" onClick={addNode} disabled={!newNode}>加节点</button></div>

      {importedTypes.length > 0 && <div className="hint">import 的库类型（只读）：{importedTypes.join('、')}</div>}

      {node && (
        <div className="rule-form">
          <div className="rf-h"><b>节点 {sel}</b></div>
          <div className="ed-grid">
            <label>extends（基类）<select value={node.extends || ''} onChange={(e) => patchNode((n) => { const v = e.target.value; if (v) n.extends = v; else delete n.extends; })}>
              <option value="">（无）</option>{allTypes.filter((t) => t !== sel).map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="ck"><input type="checkbox" checked={!!node.abstract} onChange={(e) => patchNode((n) => { if (e.target.checked) n.abstract = true; else delete n.abstract; })} />abstract（不可实例化）</label>
          </div>

          <h4>字段</h4>
          <table className="ed-tbl">
            <thead><tr><th>名</th><th>描述 label</th><th>type</th><th>种类</th><th></th></tr></thead>
            <tbody>
              {Object.entries(node.fields || {}).map(([f, s]: any) => (
                <tr key={f}>
                  <td><code>{f}</code></td>
                  <td><input value={s.label ?? ''} placeholder={f} title="人类可读描述：页面标签兜底 + 报错 {字段:label} 引用" onChange={(e) => patchNode((n) => { n.fields[f] = specOf(s.type, flagOf(s), e.target.value); })} style={{ width: 130 }} /></td>
                  <td><select value={s.type} onChange={(e) => patchNode((n) => { n.fields[f] = specOf(e.target.value, flagOf(s), s.label); })}><option>decimal</option><option>int</option><option>string</option><option>date</option></select></td>
                  <td><select value={flagOf(s)} onChange={(e) => patchNode((n) => { n.fields[f] = specOf(s.type, e.target.value, s.label); })}>{FLAGS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</select></td>
                  <td className="ops"><button className="del" onClick={() => patchNode((n) => { delete n.fields[f]; })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ed-row">
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="字段名" style={{ width: 110 }} />
            <input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="描述 label（可选）" style={{ width: 130 }} />
            <select value={fType} onChange={(e) => setFType(e.target.value)}><option>decimal</option><option>int</option><option>string</option><option>date</option></select>
            <select value={fFlag} onChange={(e) => setFFlag(e.target.value)}>{FLAGS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</select>
            <button className="primary" disabled={!fName} onClick={() => { patchNode((n) => { (n.fields ??= {})[fName] = specOf(fType, fFlag, fLabel); }); setFName(''); setFLabel(''); }}>加字段</button>
          </div>

          <h4>具名槽位 slots（单子节点）</h4>
          {Object.entries(node.slots || {}).map(([sn, sv]: any) => (
            <div key={sn} className="ed-row">
              <code>{sn}</code> → <b>{slotNode(sv)}</b>
              <label className="ck" style={{ marginLeft: 8 }} title="可选：对象为空时忽略其内部必填校验"><input type="checkbox" checked={slotOpt(sv)} onChange={(e) => setSlot(sn, slotNode(sv), e.target.checked)} />可选</label>
              <button className="del" onClick={() => patchNode((n) => { delete n.slots[sn]; })}>✕</button>
            </div>
          ))}
          <div className="ed-row">
            <input value={slotName} onChange={(e) => setSlotName(e.target.value)} placeholder="槽位名" style={{ width: 110 }} />→
            <select value={slotType} onChange={(e) => setSlotType(e.target.value)}>{allTypes.map((t) => <option key={t}>{t}</option>)}</select>
            <label className="ck"><input type="checkbox" checked={slotOptNew} onChange={(e) => setSlotOptNew(e.target.checked)} />可选</label>
            <button className="primary" disabled={!slotName} onClick={() => { setSlot(slotName, slotType, slotOptNew); setSlotName(''); setSlotOptNew(false); }}>加槽位</button>
          </div>

          <h4>子集合 children</h4>
          {(Array.isArray(node.children) ? node.children : node.children ? [node.children] : []).map((c: any, i: number) => (
            <div key={i} className="ed-row"><code>{c.name}</code> → <b>{c.node}</b>[]<button className="del" onClick={() => patchNode((n) => { const arr = Array.isArray(n.children) ? n.children : [n.children]; n.children = arr.filter((_: any, k: number) => k !== i); })}>✕</button></div>
          ))}
          <div className="ed-row">
            <input value={collName} onChange={(e) => setCollName(e.target.value)} placeholder="集合名" style={{ width: 120 }} />→
            <select value={collType} onChange={(e) => setCollType(e.target.value)}>{allTypes.map((t) => <option key={t}>{t}</option>)}</select>
            <button className="primary" disabled={!collName} onClick={() => { patchNode((n) => { const arr = Array.isArray(n.children) ? n.children : n.children ? [n.children] : []; arr.push({ name: collName, node: collType }); n.children = arr; }); setCollName(''); }}>加集合</button>
          </div>

          <h4>有效字段（沿继承链合并）</h4>
          <div className="hint">{Object.keys(meta.effectiveFields(sel)).join('、') || '（无）'}</div>
        </div>
      )}
    </div>
  );
}
