import { ReactNode, useState } from 'react';
import { EngineMeta, RuleSet } from '@udsl/ui-kit-core';
import { Modal } from './Modal';

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

// 新增弹窗外壳：表单在弹窗内，底部「添加并继续」保持弹窗不关、清空表单接着加（连续录入），
//   右侧实时显示本次已添加数量；「添加并关闭」收尾。把新增表单从查看区移出，模型内容保持清爽。
function AddModal({ title, hint, canAdd, added, onAdd, onClose, children }: {
  title: string; hint?: ReactNode; canAdd: boolean; added: number; onAdd: () => void; onClose: () => void; children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {hint && <div className="hint">{hint}</div>}
      <div className="add-form">{children}</div>
      <div className="add-foot">
        <span className="muted">{added > 0 ? `本次已添加 ${added} 项` : '填写后可连续添加'}</span>
        <span>
          <button className="primary" disabled={!canAdd} onClick={onAdd}>添加并继续</button>{' '}
          <button disabled={!canAdd} onClick={() => { onAdd(); onClose(); }}>添加并关闭</button>{' '}
          <button onClick={onClose}>关闭</button>
        </span>
      </div>
    </Modal>
  );
}

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

  // 新增弹窗：哪个打开 + 本次已添加计数（关闭时归零）
  const [modal, setModal] = useState<null | 'node' | 'field' | 'slot' | 'coll'>(null);
  const [added, setAdded] = useState(0);
  const openModal = (m: typeof modal) => { setAdded(0); setModal(m); };
  const closeModal = () => { setModal(null); setAdded(0); };
  const bump = () => setAdded((n) => n + 1);

  const addNode = () => { if (!newNode) return; mutateRuleSet((rs) => { rs.model.nodes[newNode] = { fields: {} }; }); setSel(newNode); setNewNode(''); bump(); };
  const addFieldNow = () => { patchNode((n) => { (n.fields ??= {})[fName] = specOf(fType, fFlag, fLabel); }); setFName(''); setFLabel(''); bump(); };
  const addSlotNow = () => { setSlot(slotName, slotType, slotOptNew); setSlotName(''); setSlotOptNew(false); bump(); };
  const addCollNow = () => { patchNode((n) => { const arr = Array.isArray(n.children) ? n.children : n.children ? [n.children] : []; arr.push({ name: collName, node: collType }); n.children = arr; }); setCollName(''); bump(); };
  const delNode = (t: string) => mutateRuleSet((rs) => { delete rs.model.nodes[t]; });
  const setRoot = (t: string) => mutateRuleSet((rs) => { rs.model.root = t; });
  const patchNode = (fn: (n: any) => void) => mutateRuleSet((rs) => fn(rs.model.nodes[sel]));
  // slot 值可为 "类型" 或 { node, optional }
  const slotNode = (v: any) => (typeof v === 'string' ? v : v.node);
  const slotOpt = (v: any) => (typeof v === 'string' ? false : !!v.optional);
  const setSlot = (name: string, nodeType: string, optional: boolean) => patchNode((n) => { (n.slots ??= {})[name] = optional ? { node: nodeType, optional: true } : nodeType; });

  // 继承而来（祖先类型定义）的字段 / 子集合——本地同名即为「覆盖」
  const inheritedFields: Record<string, any> = {};
  const inheritedColls: Record<string, string> = {};
  if (sel) for (const anc of meta.ancestorsOf(sel)) {
    Object.assign(inheritedFields, meta.nodes[anc]?.fields ?? {});
    const cs = meta.nodes[anc]?.children;
    for (const c of (Array.isArray(cs) ? cs : cs ? [cs] : [])) inheritedColls[c.name] = c.node;
  }

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

      <h4>{isLibrary ? '库节点' : '本地节点'}（{localTypes.length}） <button className="mini primary" onClick={() => openModal('node')}>＋ 加节点</button></h4>
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
      {importedTypes.length > 0 && <div className="hint">import 的库类型（只读）：{importedTypes.join('、')}</div>}

      {node && (
        <div className="rule-form">
          <div className="rf-h"><b>节点 {sel}</b>
            {meta.ancestorsOf(sel).length > 0 && <span className="muted" title="继承链（基类 → 自身）">继承链：{meta.chainOf(sel).join(' ▸ ')}</span>}</div>
          <div className="ed-grid">
            <label>extends（基类）<select value={node.extends || ''} onChange={(e) => patchNode((n) => { const v = e.target.value; if (v) n.extends = v; else delete n.extends; })}>
              <option value="">（无）</option>{allTypes.filter((t) => t !== sel).map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="ck"><input type="checkbox" checked={!!node.abstract} onChange={(e) => patchNode((n) => { if (e.target.checked) n.abstract = true; else delete n.abstract; })} />abstract（不可实例化）</label>
          </div>

          <h4>字段（本地） <button className="mini primary" onClick={() => openModal('field')}>＋ 加字段</button></h4>
          <table className="ed-tbl">
            <thead><tr><th>名</th><th>描述 label</th><th>type</th><th>种类</th><th></th></tr></thead>
            <tbody>
              {Object.entries(node.fields || {}).map(([f, s]: any) => (
                <tr key={f}>
                  <td><code>{f}</code>{inheritedFields[f] && <span className="kind ovr" title={'覆盖基类同名字段'}>覆盖</span>}</td>
                  <td><input value={s.label ?? ''} placeholder={f} title="人类可读描述：页面标签兜底 + 报错 {字段:label} 引用" onChange={(e) => patchNode((n) => { n.fields[f] = specOf(s.type, flagOf(s), e.target.value); })} style={{ width: 130 }} /></td>
                  <td><select value={s.type} onChange={(e) => patchNode((n) => { n.fields[f] = specOf(e.target.value, flagOf(s), s.label); })}><option>decimal</option><option>int</option><option>string</option><option>date</option></select></td>
                  <td><select value={flagOf(s)} onChange={(e) => patchNode((n) => { n.fields[f] = specOf(s.type, e.target.value, s.label); })}>{FLAGS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</select></td>
                  <td className="ops"><button className="del" onClick={() => patchNode((n) => { delete n.fields[f]; })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!!Object.keys(inheritedFields).length &&
            <div className="hint">继承字段（只读，来自 {meta.ancestorsOf(sel).join('、')}）：
              {Object.keys(inheritedFields).map((f) => <code key={f} style={{ marginRight: 6, opacity: node.fields?.[f] ? 0.4 : 1 }}>{f}{node.fields?.[f] ? '(已覆盖)' : ''}</code>)}
              <br />在本地同名重定义即可<b>覆盖</b>（含改 type / 改种类）。</div>}

          <h4>具名槽位 slots（单子节点） <button className="mini primary" onClick={() => openModal('slot')}>＋ 加槽位</button></h4>
          {Object.entries(node.slots || {}).map(([sn, sv]: any) => (
            <div key={sn} className="ed-row">
              <code>{sn}</code> → <b>{slotNode(sv)}</b>
              <label className="ck" style={{ marginLeft: 8 }} title="可选：对象为空时忽略其内部必填校验"><input type="checkbox" checked={slotOpt(sv)} onChange={(e) => setSlot(sn, slotNode(sv), e.target.checked)} />可选</label>
              <button className="del" onClick={() => patchNode((n) => { delete n.slots[sn]; })}>✕</button>
            </div>
          ))}

          <h4>子集合 children（本地） <button className="mini primary" onClick={() => openModal('coll')}>＋ 加集合</button></h4>
          {(Array.isArray(node.children) ? node.children : node.children ? [node.children] : []).map((c: any, i: number) => (
            <div key={i} className="ed-row"><code>{c.name}</code> → <b>{c.node}</b>[]
              {inheritedColls[c.name] && inheritedColls[c.name] !== c.node && <span className="kind ovr" title={'覆盖继承的 ' + inheritedColls[c.name]}>覆盖 ‹{inheritedColls[c.name]}›</span>}
              <button className="del" onClick={() => patchNode((n) => { const arr = Array.isArray(n.children) ? n.children : [n.children]; n.children = arr.filter((_: any, k: number) => k !== i); })}>✕</button></div>
          ))}
          {!!Object.keys(inheritedColls).length &&
            <div className="hint">继承子集合：{Object.entries(inheritedColls).map(([nm, nd]) => <code key={nm} style={{ marginRight: 6 }}>{nm}→{nd as string}</code>)}
              <br />用<b>同名</b>集合指向子类型即可覆盖（如 <code>items→CustomChargeItem</code>），位置不变，只影响本类型实例。</div>}

          <h4>有效字段（沿继承链合并）</h4>
          <div className="hint">{Object.keys(meta.effectiveFields(sel)).join('、') || '（无）'}</div>
        </div>
      )}

      {modal === 'node' && (
        <AddModal title="新增节点类型" added={added} canAdd={!!newNode && !localNodes[newNode]} onAdd={addNode} onClose={closeModal}
          hint={<>新建后自动选中该节点，可继续在此连续新建。已存在同名类型时无法添加。</>}>
          <label>类型名<input autoFocus value={newNode} onChange={(e) => setNewNode(e.target.value)} placeholder="如 InvoiceLine"
            onKeyDown={(e) => { if (e.key === 'Enter' && newNode && !localNodes[newNode]) addNode(); }} /></label>
          {!!newNode && !!localNodes[newNode] && <div className="hint">⚠ 类型 <code>{newNode}</code> 已存在。</div>}
        </AddModal>
      )}

      {modal === 'field' && node && (
        <AddModal title={`为 ${sel} 新增字段`} added={added} canAdd={!!fName} onAdd={addFieldNow} onClose={closeModal}
          hint={<>与继承字段同名 = <b>覆盖</b>基类字段（可改 type / 种类）。</>}>
          <label>字段名<input autoFocus value={fName} onChange={(e) => setFName(e.target.value)} placeholder="如 vatTotal"
            onKeyDown={(e) => { if (e.key === 'Enter' && fName) addFieldNow(); }} /></label>
          <label>描述 label（可选）<input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="页面标签兜底 + 报错引用" /></label>
          <label>type<select value={fType} onChange={(e) => setFType(e.target.value)}><option>decimal</option><option>int</option><option>string</option><option>date</option></select></label>
          <label>种类<select value={fFlag} onChange={(e) => setFFlag(e.target.value)}>{FLAGS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</select></label>
          {!!inheritedFields[fName] && <div className="hint">↑ <code>{fName}</code> 来自基类，添加后为<b>覆盖</b>。</div>}
        </AddModal>
      )}

      {modal === 'slot' && node && (
        <AddModal title={`为 ${sel} 新增槽位`} added={added} canAdd={!!slotName} onAdd={addSlotNow} onClose={closeModal}
          hint={<>槽位 = 挂在本节点下的<b>单个</b>子节点（如 applicant → CustomerParty）。</>}>
          <label>槽位名<input autoFocus value={slotName} onChange={(e) => setSlotName(e.target.value)} placeholder="如 applicant"
            onKeyDown={(e) => { if (e.key === 'Enter' && slotName) addSlotNow(); }} /></label>
          <label>节点类型<select value={slotType} onChange={(e) => setSlotType(e.target.value)}>{allTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="ck" title="可选：对象为空时忽略其内部必填校验"><input type="checkbox" checked={slotOptNew} onChange={(e) => setSlotOptNew(e.target.checked)} />可选（为空时跳过内部校验）</label>
        </AddModal>
      )}

      {modal === 'coll' && node && (
        <AddModal title={`为 ${sel} 新增子集合`} added={added} canAdd={!!collName} onAdd={addCollNow} onClose={closeModal}
          hint={<>与继承子集合<b>同名</b>并指向子类型 = <b>覆盖</b>（如 items→CustomChargeItem），只影响本类型实例。</>}>
          <label>集合名<input autoFocus value={collName} onChange={(e) => setCollName(e.target.value)} placeholder="如 items"
            onKeyDown={(e) => { if (e.key === 'Enter' && collName) addCollNow(); }} /></label>
          <label>元素节点类型<select value={collType} onChange={(e) => setCollType(e.target.value)}>{allTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
          {!!inheritedColls[collName] && <div className="hint">↑ 继承自基类的 <code>{collName}→{inheritedColls[collName]}</code>，添加后为<b>覆盖</b>。</div>}
        </AddModal>
      )}
    </div>
  );
}
