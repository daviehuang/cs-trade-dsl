import { useState } from 'react';
import { EngineMeta, PageDef } from '@udsl/ui-kit-core';
import { Addr, childTypeOf, resolveAddr, readPayload, payloadToNode, labelOf } from './layout-addr';

// 页面画布（拖拽式搭建）：右侧结构块画布。从规则集树拖字段/槽位/集合到容器放置区；
//   顶部调色板加容器（面板/行/列/网格/表格/标签页/校验）；点选块 → Inspector 改属性。布局在画布进行。
type Props = { pageDef: PageDef; meta: EngineMeta; mutatePageDef: (fn: (pd: PageDef) => void) => void };

// 解析到"子节点数组"（addr 末段为键名 children/itemTemplate 或 [tabs,i,children]；[] = 顶层 layout）。
function resolveArr(layout: any[], arrAddr: Addr): any[] {
  let arr = layout, node: any;
  for (const seg of arrAddr) { if (typeof seg === 'number') node = arr[seg]; else arr = node[seg] ?? (node[seg] = []); }
  return arr;
}
// 容器 → 其子数组地址（供调色板 click-add）。
function childArrAddr(addr: Addr, n: any): Addr | null {
  if (n.kind === 'panel' || n.kind === 'group') return [...addr, 'children'];
  if (n.kind === 'collection') return [...addr, 'itemTemplate'];
  if (n.kind === 'tabs') return [...addr, 'tabs', 0, 'children'];
  return null;
}
const isPrefix = (a: Addr, b: Addr) => a.length <= b.length && a.every((v, i) => v === b[i]);

const PALETTE: { label: string; node: any }[] = [
  { label: '面板', node: { kind: 'panel', title: '新面板', grid: 'form', children: [] } },
  { label: '行', node: { kind: 'group', grid: 'row', children: [] } },
  { label: '列', node: { kind: 'group', grid: 'col', children: [] } },
  { label: '网格', node: { kind: 'group', cols: 2, children: [] } },
  { label: '表格', node: { kind: 'collection', name: '', layout: 'table', itemGrid: 'row', itemTemplate: [] } },
  { label: '标签页', node: { kind: 'tabs', tabs: [{ label: '标签1', children: [] }, { label: '标签2', children: [] }] } },
  { label: '校验', node: { kind: 'validations' } },
];

export function PageCanvas({ pageDef, meta, mutatePageDef }: Props) {
  const [selKey, setSelKey] = useState('');
  const [dragAddr, setDragAddr] = useState<Addr | null>(null);

  const pushInto = (arrAddr: Addr, node: any) => mutatePageDef((pd) => { resolveArr(pd.layout, arrAddr).push(node); });
  const move = (from: Addr, toArr: Addr) => {
    if (isPrefix(from, toArr)) return;                       // 禁止拖入自身子树
    mutatePageDef((pd) => {
      // 先按引用取到目标数组，再删源——否则删源会让目标 addr 的下标错位（如同层 panel 拖进 tabs）。
      const target = resolveArr(pd.layout, toArr);
      const { arr, index } = resolveAddr(pd.layout, from);
      const [m] = arr.splice(index, 1);
      target.push(m);
    });
  };
  const onDropInto = (arrAddr: Addr) => (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const p = readPayload(e);
    if (p) pushInto(arrAddr, payloadToNode(p));
    else if (dragAddr) move(dragAddr, arrAddr);
    setDragAddr(null);
  };
  const move2 = (addr: Addr, dir: -1 | 1) => mutatePageDef((pd) => { const { arr, index } = resolveAddr(pd.layout, addr); const j = index + dir; if (j < 0 || j >= arr.length) return; [arr[index], arr[j]] = [arr[j], arr[index]]; });
  const remove = (addr: Addr) => mutatePageDef((pd) => { const { arr, index } = resolveAddr(pd.layout, addr); arr.splice(index, 1); });
  const patch = (addr: Addr, p: any) => mutatePageDef((pd) => { const { node } = resolveAddr(pd.layout, addr); for (const [k, v] of Object.entries(p)) { if (v === '' || v === undefined) delete node[k]; else node[k] = v; } });

  const sel = selKey ? resolveAddr(pageDef.layout, selKey.split('.').map((s) => /^\d+$/.test(s) ? +s : s)) : null;
  const addFromPalette = (pn: any) => {
    const node = JSON.parse(JSON.stringify(pn));
    if (sel?.node) { const ca = childArrAddr(selKey.split('.').map((s) => /^\d+$/.test(s) ? +s : s), sel.node); if (ca) { pushInto(ca, node); return; } }
    mutatePageDef((pd) => { pd.layout.push(node); });
  };

  const ctxOf = (addr: Addr): string => {                    // 该 addr 处的类型上下文
    let type = meta.root;
    for (let i = 0; i < addr.length; i++) {
      const seg = addr[i];
      if (typeof seg === 'number' && i > 0 && addr[i - 1] === 'itemTemplate') continue;
      if (typeof seg === 'number') { const { node } = resolveAddr(pageDef.layout, addr.slice(0, i + 1)); if (node) type = childTypeOf(meta, type, node); }
    }
    return type;
  };

  const selAddr = selKey.split('.').map((s) => /^\d+$/.test(s) ? +s : s);
  return (
    <div className="page-canvas">
      <div className="pc-main">
        <div className="pc-palette">
          <span className="muted">元素：</span>
          {PALETTE.map((p) => <button key={p.label} className="pc-pal" onClick={() => addFromPalette(p.node)}>＋{p.label}</button>)}
          <span className="hint" style={{ marginLeft: 8 }}>（加到选中容器；点画布空白处选中「页面」→ 加到页面顶层；字段从左树拖入）</span>
        </div>

        <div className={'pc-drop pc-root' + (selKey === '' ? ' page-sel' : '')}
          onClick={() => setSelKey('')}
          onDragOver={(e) => e.preventDefault()} onDrop={onDropInto([])}>
          {pageDef.layout.length === 0 && <div className="pc-empty">空页面：点上方元素或从左侧拖字段进来</div>}
          {pageDef.layout.map((n, i) => (
            <BlockView key={i} node={n} addr={[i]} type={meta.root} meta={meta}
              selKey={selKey} setSel={setSelKey} onDropInto={onDropInto} setDragAddr={setDragAddr}
              move2={move2} remove={remove} patch={patch} pushInto={pushInto} />
          ))}
        </div>
      </div>

      <div className="pc-side">
        <div className="pc-side-h">属性</div>
        {sel?.node
          ? <Inspector node={sel.node} addr={selAddr} type={ctxOf(selAddr)} meta={meta} patch={patch} />
          : <div className="pc-side-empty"><b>页面（顶层 {meta.root}）</b>已选中。<br />点上方「＋元素」把面板/行/列等加到页面；点选画布中的元素可编辑其属性。</div>}
      </div>
    </div>
  );
}

// 容器放置区的布局方向类（所见即所得：行→横排 / 列→竖排 / 网格→N 列）。
function dzLayout(node: any): { cls: string; style?: any } {
  if (node.kind === 'group') {
    if (node.cols) return { cls: 'pc-dz-grid', style: { gridTemplateColumns: `repeat(${node.cols}, 1fr)` } };
    if (node.grid === 'row' || node.grid === 'cards') return { cls: 'pc-dz-row' };
    if (node.grid === 'form') return { cls: 'pc-dz-grid', style: { gridTemplateColumns: 'repeat(2, 1fr)' } };
    return { cls: 'pc-dz-col' };
  }
  if (node.kind === 'panel') {
    if (node.grid === 'row' || node.grid === 'cards') return { cls: 'pc-dz-row' };
    if (node.grid === 'form') return { cls: 'pc-dz-grid', style: { gridTemplateColumns: 'repeat(2, 1fr)' } };
    return { cls: 'pc-dz-col' };
  }
  // 表格：编辑区里每个列定义（拖入的"行"）各占一行（竖排）；卡片集合按 itemGrid。
  if (node.kind === 'collection') return { cls: (node.layout === 'table' || node.itemGrid !== 'row') ? 'pc-dz-col' : 'pc-dz-row' };
  return { cls: 'pc-dz-col' };
}

function BlockView({ node, addr, type, meta, selKey, setSel, onDropInto, setDragAddr, move2, remove, patch, pushInto }: any) {
  const key = addr.join('.');
  const sel = key === selKey;
  const isLeaf = node.kind === 'field' || node.kind === 'cell' || node.kind === 'validations';
  const childType = childTypeOf(meta, type, node);

  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.stopPropagation(); setDragAddr(addr); },
    onDragEnd: () => setDragAddr(null),
  };
  const ops = (
    <span className="pc-ops">
      <button title="上移" onClick={(e) => { e.stopPropagation(); move2(addr, -1); }}>↑</button>
      <button title="下移" onClick={(e) => { e.stopPropagation(); move2(addr, 1); }}>↓</button>
      <button className="del" title="删除" onClick={(e) => { e.stopPropagation(); remove(addr); if (sel) setSel(''); }}>✕</button>
    </span>
  );

  // 叶子：单行紧凑芯片
  if (isLeaf) {
    return (
      <div className={'pc-chip kind-' + node.kind + (sel ? ' sel' : '')} {...dragProps} onClick={(e) => { e.stopPropagation(); setSel(key); }}>
        <span className={'kind ' + node.kind}>{node.kind}</span>
        <b className="pc-chip-name">{node.kind === 'validations' ? '校验' : (node.field ?? node.path ?? '?')}</b>
        {node.label && <span className="muted pc-chip-lbl">{node.label}</span>}
        {ops}
      </div>
    );
  }

  const dz = dzLayout(node);
  const dropZone = (arrAddr: Addr, children: any[], childT: string) => (
    <div className={'pc-drop ' + dz.cls} style={dz.style} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={onDropInto(arrAddr)}>
      {(!children || children.length === 0) && <div className="pc-dz-hint">拖字段/元素到此（{childT}）</div>}
      {(children ?? []).map((c: any, i: number) => (
        <BlockView key={i} node={c} addr={[...arrAddr, i]} type={childT} meta={meta}
          selKey={selKey} setSel={setSel} onDropInto={onDropInto} setDragAddr={setDragAddr}
          move2={move2} remove={remove} patch={patch} pushInto={pushInto} />
      ))}
    </div>
  );

  const shareWidth = node.kind === 'group' && node.grid === 'col';   // 只有「列」并排分享宽度；其它容器独占一行
  return (
    <div className={'pc-block kind-' + node.kind + (shareWidth ? ' g-col' : '') + (sel ? ' sel' : '')} onClick={(e) => { e.stopPropagation(); setSel(key); }}>
      <div className="pc-toolbar">
        <span className="pc-grip" title="拖动" draggable onDragStart={(e) => { e.stopPropagation(); setDragAddr(addr); }} onDragEnd={() => setDragAddr(null)}>⠿</span>
        <span className={'kind ' + node.kind}>{node.kind}</span>
        <b>{labelOf(node)}</b>
        {node.kind === 'group' && <span className="muted">{node.cols ? `网格${node.cols}` : node.grid === 'row' ? '横排' : node.grid === 'col' ? '竖排' : node.grid}</span>}
        {node.kind === 'collection' && node.layout === 'table' && <span className="muted">表格</span>}
        {ops}
      </div>
      {node.kind === 'panel' && node.title && (
        <div className="pc-block-title" title="面板标题（Panel.title）—— 运行时显示在面板头部">
          <span className="kind panel">panel</span>
          <b>{node.title}</b>
          {node.badge && <span className="pc-bt-badge">{node.badge}</span>}
        </div>
      )}
      {node.kind === 'panel' && dropZone([...addr, 'children'], node.children, childType)}
      {node.kind === 'group' && dropZone([...addr, 'children'], node.children, childType)}
      {node.kind === 'collection' && dropZone([...addr, 'itemTemplate'], node.itemTemplate, childType)}
      {node.kind === 'tabs' && <TabsBlock node={node} addr={addr} childType={type} dropZone={dropZone} patch={patch} />}
    </div>
  );
}

function TabsBlock({ node, addr, childType, dropZone, patch }: any) {
  const [active, setActive] = useState(0);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const tabs = node.tabs ?? [];
  const cur = tabs[active] ?? tabs[0];
  const ai = tabs[active] ? active : 0;

  const commit = (i: number) => { const t = tabs.slice(); t[i] = { ...t[i], label: draft || `标签${i + 1}` }; patch(addr, { tabs: t }); setEditIdx(null); };
  const startEdit = (i: number) => { setDraft(tabs[i].label ?? ''); setEditIdx(i); };

  return (
    <div className="pc-tabs">
      <div className="pc-tab-h">
        {tabs.map((t: any, i: number) => (
          <span key={i} className={'pc-tab' + (i === ai ? ' on' : '')} title="双击改名">
            {editIdx === i
              ? <input className="pc-tab-edit" autoFocus value={draft}
                  onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(i)} onKeyDown={(e) => { if (e.key === 'Enter') commit(i); if (e.key === 'Escape') setEditIdx(null); }} />
              : <button onClick={(e) => { e.stopPropagation(); setActive(i); }} onDoubleClick={(e) => { e.stopPropagation(); startEdit(i); }}>{t.label || `标签${i + 1}`}</button>}
            <button className="del" title="删除标签" onClick={(e) => { e.stopPropagation(); patch(addr, { tabs: tabs.filter((_: any, k: number) => k !== i) }); setActive(0); setEditIdx(null); }}>✕</button>
          </span>
        ))}
        <button className="pc-tab-add" onClick={(e) => { e.stopPropagation(); patch(addr, { tabs: [...tabs, { label: `标签${tabs.length + 1}`, children: [] }] }); }}>＋标签</button>
      </div>
      {cur && <div className="pc-tab-body">
        {dropZone([...addr, 'tabs', ai, 'children'], cur.children, childType)}
      </div>}
    </div>
  );
}

// 属性 Inspector：各 kind 分支（含新 group/tabs）。
function Inspector({ node, addr, type, meta, patch }: any) {
  const n = node, a = addr;
  return (
    <div className="rule-form pc-inspector">
      <div className="rf-h"><b>{n.kind} · <span className="muted">{type}</span></b></div>

      {(n.kind === 'field' || n.kind === 'cell') && <div className="ed-grid">
        <label>field（相对）<input value={n.field ?? ''} onChange={(e) => patch(a, { field: e.target.value, path: undefined })} /></label>
        <label>path（绝对，覆盖 field）<input value={n.path ?? ''} onChange={(e) => patch(a, { path: e.target.value })} /></label>
        <label>label<input value={n.label ?? ''} onChange={(e) => patch(a, { label: e.target.value })} /></label>
        {n.kind === 'field' && <label>control<select value={n.control ?? 'text'} onChange={(e) => patch(a, { control: e.target.value })}><option>text</option><option>ccy</option><option>adjust</option><option value="party-lookup">party-lookup（主数据查询）</option></select></label>}
        {n.kind === 'cell' && <label className="ck"><input type="checkbox" checked={!!n.emphasis} onChange={(e) => patch(a, { emphasis: e.target.checked || undefined })} />emphasis（大字）</label>}
      </div>}

      {n.kind === 'panel' && <div className="ed-grid">
        <label>title<input value={n.title ?? ''} onChange={(e) => patch(a, { title: e.target.value })} /></label>
        <label>badge<input value={n.badge ?? ''} onChange={(e) => patch(a, { badge: e.target.value })} /></label>
        <label>variant<select value={n.variant ?? 'form'} onChange={(e) => patch(a, { variant: e.target.value })}><option>form</option><option>cards</option><option>flow</option><option>stats</option><option>party</option></select></label>
        <label>grid<select value={n.grid ?? ''} onChange={(e) => patch(a, { grid: e.target.value })}><option value="">（无）</option><option>form</option><option>cards</option><option>row</option><option>col</option></select></label>
        <label>at（重定基槽位/路径）<input value={n.at ?? ''} onChange={(e) => patch(a, { at: e.target.value })} placeholder="如 applicant / root.applicant" /></label>
      </div>}

      {n.kind === 'group' && <div className="ed-grid">
        <label>grid<select value={n.grid ?? ''} onChange={(e) => patch(a, { grid: e.target.value, cols: undefined })}><option value="">（无）</option><option>row</option><option>col</option><option>form</option><option>cards</option></select></label>
        <label>cols（多列网格，优先）<input type="number" min={0} value={n.cols ?? ''} onChange={(e) => patch(a, { cols: e.target.value ? +e.target.value : undefined, grid: undefined })} /></label>
      </div>}

      {n.kind === 'collection' && <div className="ed-grid">
        <label>name（子集合）<select value={n.name ?? ''} onChange={(e) => patch(a, { name: e.target.value })}><option value="">选…</option>{meta.childrenOf(type).map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
        <label>title<input value={n.title ?? ''} onChange={(e) => patch(a, { title: e.target.value })} /></label>
        <label>布局<select value={n.layout ?? 'cards'} onChange={(e) => patch(a, { layout: e.target.value === 'cards' ? undefined : e.target.value })}><option value="cards">卡片</option><option value="table">表格</option></select></label>
        <label>itemGrid<select value={n.itemGrid ?? 'row'} onChange={(e) => patch(a, { itemGrid: e.target.value })}><option>row</option><option>col</option></select></label>
      </div>}

      {n.kind === 'validations' && <div className="ed-grid"><label>path（缺省=当前节点）<input value={n.path ?? ''} onChange={(e) => patch(a, { path: e.target.value })} /></label></div>}
      {n.kind === 'tabs' && <p className="hint">在画布上编辑标签页：切换/新增/删除标签，拖字段到激活标签的放置区。</p>}
    </div>
  );
}
