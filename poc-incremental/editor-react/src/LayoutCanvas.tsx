import { useState } from 'react';
import { EngineMeta, PageDef } from '@udsl/ui-kit-core';

// 域7 页面布局 WYSIWYG：整棵 PageDef 树可编辑——全节点类型 + 属性 Inspector + 类型感知调色板 + 拖拽/上下移。
//   控件种类由字段 spec 强制（computed/external→cell）。类型上下文沿 at(槽位)/collection(元素) 推导。
type Props = { pageDef: PageDef; meta: EngineMeta; mutatePageDef: (fn: (pd: PageDef) => void) => void; };
type Addr = (number | string)[];
type Row = { node: any; addr: Addr; depth: number; type: string };

const descendSlotOrPath = (meta: EngineMeta, type: string, at: string): string => {
  if (at.startsWith('root')) { // 绝对路径：走到末端类型
    let t = meta.root;
    for (const seg of at.split('.').slice(1)) {
      const name = seg.replace(/\[\d+\]|\[\*\]/g, '');
      const s = meta.effectiveSlots(t); if (s[name]) { t = s[name]; continue; }
      const c = meta.childrenOf(t).find((x) => x.name === name); if (c) { t = c.node; continue; }
      return t;
    }
    return t;
  }
  const s = meta.effectiveSlots(type); if (s[at]) return s[at];
  const c = meta.childrenOf(type).find((x) => x.name === at); return c ? c.node : type;
};
const childKey = (n: any): string | null => (n.kind === 'panel' || n.kind === 'group') ? 'children' : n.kind === 'collection' ? 'itemTemplate' : null;
const childTypeOf = (meta: EngineMeta, type: string, n: any): string =>
  n.kind === 'collection' ? (meta.childrenOf(type).find((x) => x.name === n.name)?.node ?? type)
    : (n.kind === 'panel' && n.at) ? descendSlotOrPath(meta, type, n.at) : type;

function flatten(layout: any[], meta: EngineMeta, type: string, base: Addr, depth: number, out: Row[]) {
  layout.forEach((n, i) => {
    const addr = [...base, i];
    out.push({ node: n, addr, depth, type });
    const key = childKey(n);
    if (key && Array.isArray(n[key])) flatten(n[key], meta, childTypeOf(meta, type, n), [...addr, key], depth + 1, out);
  });
  return out;
}
function resolveAddr(layout: any[], addr: Addr): { arr: any[]; index: number; node: any } {
  let arr = layout, node: any;
  for (const seg of addr) { if (typeof seg === 'number') node = arr[seg]; else arr = node[seg] ?? (node[seg] = []); }
  return { arr, index: addr[addr.length - 1] as number, node };
}
const sameParent = (a: Addr, b: Addr) => a.length === b.length && a.slice(0, -1).join('.') === b.slice(0, -1).join('.');
const labelOf = (n: any) => n.kind === 'field' || n.kind === 'cell' ? (n.field ?? n.path ?? '?')
  : n.kind === 'panel' ? (n.title ?? 'panel') : n.kind === 'collection' ? (n.name ?? 'collection') : n.kind;

export function LayoutCanvas({ pageDef, meta, mutatePageDef }: Props) {
  const rows = flatten(pageDef.layout, meta, meta.root, [], 0, []);
  const [selKey, setSelKey] = useState<string>('');
  const sel = rows.find((r) => r.addr.join('.') === selKey) ?? null;
  const [drag, setDrag] = useState<string>('');

  const move = (addr: Addr, dir: -1 | 1) => mutatePageDef((pd) => { const { arr, index } = resolveAddr(pd.layout, addr); const j = index + dir; if (j < 0 || j >= arr.length) return; [arr[index], arr[j]] = [arr[j], arr[index]]; });
  const remove = (addr: Addr) => mutatePageDef((pd) => { const { arr, index } = resolveAddr(pd.layout, addr); arr.splice(index, 1); });
  const patch = (addr: Addr, p: any) => mutatePageDef((pd) => { const { node } = resolveAddr(pd.layout, addr); for (const [k, v] of Object.entries(p)) { if (v === '' || v === undefined) delete node[k]; else node[k] = v; } });
  const addChild = (container: Row, child: any) => mutatePageDef((pd) => { const { node } = resolveAddr(pd.layout, container.addr); const key = childKey(node)!; (node[key] ??= []).push(child); });
  const addTop = (child: any) => mutatePageDef((pd) => { pd.layout.push(child); });
  const onDrop = (target: Addr) => { if (!drag) return; const from = drag.split('.').map((s) => /^\d+$/.test(s) ? +s : s); if (!sameParent(from, target)) { setDrag(''); return; } mutatePageDef((pd) => { const { arr } = resolveAddr(pd.layout, from); const fi = from[from.length - 1] as number, ti = target[target.length - 1] as number; const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m); }); setDrag(''); };

  return (
    <div className="ed-sec layout-canvas">
      <h4>页面结构树
        <button className="mini primary" onClick={() => addTop({ kind: 'panel', title: '新面板', variant: 'form', grid: 'form', children: [] })}>＋ 顶层面板</button>
      </h4>
      <div className="tree">
        {rows.map((r) => {
          const k = r.addr.join('.');
          return (
            <div key={k} draggable onDragStart={() => setDrag(k)} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(r.addr)}
              className={'tree-row' + (k === selKey ? ' sel' : '')} style={{ paddingLeft: 6 + r.depth * 16 }} onClick={() => setSelKey(k)}>
              <span className={'kind ' + r.node.kind}>{r.node.kind}</span>
              <b className="tr-label">{labelOf(r.node)}</b>
              <span className="muted tr-type">{r.type}</span>
              <span className="tr-ops">
                <button onClick={(e) => { e.stopPropagation(); move(r.addr, -1); }}>↑</button>
                <button onClick={(e) => { e.stopPropagation(); move(r.addr, 1); }}>↓</button>
                <button className="del" onClick={(e) => { e.stopPropagation(); remove(r.addr); if (k === selKey) setSelKey(''); }}>✕</button>
              </span>
            </div>
          );
        })}
        {rows.length === 0 && <div className="muted" style={{ padding: 8 }}>空页面，点「＋ 顶层面板」开始</div>}
      </div>

      {sel && <Inspector row={sel} meta={meta} patch={patch} addChild={addChild} />}
    </div>
  );
}

function Inspector({ row, meta, patch, addChild }: { row: Row; meta: EngineMeta; patch: (a: Addr, p: any) => void; addChild: (c: Row, child: any) => void }) {
  const n = row.node, a = row.addr;
  const isContainer = childKey(n) !== null;
  const childType = isContainer ? childTypeOf(meta, row.type, n) : row.type;
  const fieldSpecs = meta.effectiveFields(childType);
  const [pick, setPick] = useState('');
  const [addName, setAddName] = useState('');

  return (
    <div className="rule-form">
      <div className="rf-h"><b>{n.kind} · <span className="muted">{row.type}</span></b></div>

      {(n.kind === 'field' || n.kind === 'cell') && <>
        <div className="ed-grid">
          <label>field（相对）<input value={n.field ?? ''} onChange={(e) => patch(a, { field: e.target.value, path: undefined })} /></label>
          <label>path（绝对，覆盖 field）<input value={n.path ?? ''} onChange={(e) => patch(a, { path: e.target.value })} /></label>
          <label>label<input value={n.label ?? ''} onChange={(e) => patch(a, { label: e.target.value })} /></label>
          {n.kind === 'field' && <label>control<select value={n.control ?? 'text'} onChange={(e) => patch(a, { control: e.target.value })}><option>text</option><option>ccy</option><option>adjust</option></select></label>}
          {n.kind === 'cell' && <label className="ck"><input type="checkbox" checked={!!n.emphasis} onChange={(e) => patch(a, { emphasis: e.target.checked || undefined })} />emphasis（大字）</label>}
        </div>
      </>}

      {n.kind === 'panel' && <div className="ed-grid">
        <label>title<input value={n.title ?? ''} onChange={(e) => patch(a, { title: e.target.value })} /></label>
        <label>badge<input value={n.badge ?? ''} onChange={(e) => patch(a, { badge: e.target.value })} /></label>
        <label>variant<select value={n.variant ?? 'form'} onChange={(e) => patch(a, { variant: e.target.value })}><option>form</option><option>cards</option><option>flow</option><option>stats</option><option>party</option></select></label>
        <label>grid<select value={n.grid ?? ''} onChange={(e) => patch(a, { grid: e.target.value })}><option value="">（无）</option><option>form</option><option>cards</option><option>row</option><option>col</option></select></label>
        <label>tone<select value={n.tone ?? ''} onChange={(e) => patch(a, { tone: e.target.value })}><option value="">（无）</option><option>bank</option><option>cust</option></select></label>
        <label>at（重定基槽位/路径）<input value={n.at ?? ''} onChange={(e) => patch(a, { at: e.target.value })} placeholder="如 applicant / root.applicant" /></label>
      </div>}

      {n.kind === 'collection' && <div className="ed-grid">
        <label>name（子集合）<select value={n.name ?? ''} onChange={(e) => patch(a, { name: e.target.value })}><option value="">选…</option>{meta.childrenOf(row.type).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
        <label>title<input value={n.title ?? ''} onChange={(e) => patch(a, { title: e.target.value })} /></label>
        <label>itemGrid<select value={n.itemGrid ?? 'row'} onChange={(e) => patch(a, { itemGrid: e.target.value })}><option>row</option><option>col</option></select></label>
      </div>}

      {n.kind === 'validations' && <div className="ed-grid"><label>path（缺省=当前节点）<input value={n.path ?? ''} onChange={(e) => patch(a, { path: e.target.value })} /></label></div>}

      {isContainer && <>
        <h4>添加子节点（类型上下文：{childType}）</h4>
        <div className="ed-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">字段…</option>
            {Object.keys(fieldSpecs).map((f) => { const s: any = fieldSpecs[f]; return <option key={f} value={f}>{f}{s.computed || s.external ? '（→cell）' : ''}</option>; })}
          </select>
          <button className="primary" disabled={!pick} onClick={() => { const s: any = fieldSpecs[pick]; addChild(row, { kind: s.computed || s.external ? 'cell' : 'field', field: pick }); setPick(''); }}>加字段</button>
        </div>
        <div className="ed-row">
          <button onClick={() => addChild(row, { kind: 'validations' })}>＋ validations</button>
          <button onClick={() => addChild(row, { kind: 'panel', title: '子面板', grid: 'form', children: [] })}>＋ 子面板</button>
          <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="集合名" style={{ width: 110 }} />
          <button disabled={!addName} onClick={() => { addChild(row, { kind: 'collection', name: addName, itemGrid: 'row', itemTemplate: [] }); setAddName(''); }}>＋ 集合</button>
        </div>
        <p className="hint">字段种类按 spec 强制（computed/external 自动为只读 cell）。at/collection 会切换子节点的类型上下文。</p>
      </>}
    </div>
  );
}
