import { useState } from 'react';
import { EngineMeta, PageDef, ResetRule } from '@udsl/ui-kit-core';
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
          : <PageInspector pageDef={pageDef} meta={meta} mutate={mutatePageDef} />}
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

// select 控件 options（string | {value,label}）↔ 紧凑字符串「A, manual=人工」互转，供 Inspector 单行编辑。
const optToStr = (o?: any[]) => (Array.isArray(o)
  ? o.map((x) => (x && typeof x === 'object') ? (x.label && x.label !== x.value ? `${x.value}=${x.label}` : x.value) : x).join(', ')
  : '');
const strToOpt = (s: string) => {
  const arr = s.split(/[,\n]/).map((p) => p.trim()).filter(Boolean)
    .map((p) => { const i = p.indexOf('='); return i > 0 ? { value: p.slice(0, i).trim(), label: p.slice(i + 1).trim() } : p; });
  return arr.length ? { options: arr } : undefined;
};

// newItemInit（{字段:表达式}）↔ 紧凑字符串「amount=diff; desc=...」互转，供 Inspector 单行编辑。
const initToStr = (o?: Record<string, string>) => (o ? Object.entries(o).map(([k, v]) => `${k}=${v}`).join('; ') : '');
const strToInit = (s: string) => {
  const o: Record<string, string> = {};
  for (const part of s.split(/[;\n]/)) { const i = part.indexOf('='); if (i > 0) { const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim(); if (k && v) o[k] = v; } }
  return Object.keys(o).length ? o : undefined;
};

// 页面级 Inspector（未选中任何块 = 选中「页面」时展示）：编辑联动重置 resetRules（计划 ②）。
//   输入框用 defaultValue + 稳定 key（非受控）——避免每次 mutatePageDef 重渲染时清掉正在输入的字符（同 newItemInit）。
function PageInspector({ pageDef, meta, mutate }: { pageDef: PageDef; meta: EngineMeta; mutate: (fn: (pd: PageDef) => void) => void }) {
  const rules = pageDef.resetRules ?? [];
  const setRule = (i: number, p: Partial<ResetRule>) => mutate((pd) => { const l = pd.resetRules ?? (pd.resetRules = []); l[i] = { ...l[i], ...p }; });
  const addRule = () => mutate((pd) => { (pd.resetRules ?? (pd.resetRules = [])).push({ scope: meta.root, when: '', targets: [] }); });
  const delRule = (i: number) => mutate((pd) => { pd.resetRules?.splice(i, 1); if (pd.resetRules && !pd.resetRules.length) delete pd.resetRules; });
  return (
    <div className="rule-form pc-inspector">
      <div className="pc-side-empty"><b>页面（顶层 {meta.root}）</b>已选中。<br />点上方「＋元素」把面板/行/列等加到页面；点选画布中的元素可编辑其属性。</div>
      <div className="rf-h" style={{ marginTop: 12 }}><b>联动重置 resetRules</b></div>
      <div className="hint">触发后重置 targets：字段名→清值、slot 名→递归清子树、集合名→删所有行（纯前端便利，BFF 不感知）。<b>两种触发</b>：when 布尔由假变真 / watch 值变化即触发。表达式里字符串用双引号。删行不可逆，注意触发稳定性。</div>
      {rules.length === 0 && <div className="pc-side-empty">（暂无规则，点下方「＋ 新增规则」）</div>}
      {rules.map((r, i) => (
        <div key={i} className="ed-grid" style={{ borderTop: '1px solid #eee', paddingTop: 8, marginTop: 8 }}>
          <label style={{ gridColumn: '1 / -1' }}>scope（作用域：节点类型 / root / 绝对路径）
            <input key={'rs-' + i} defaultValue={r.scope} placeholder="root 或 ChargeItem"
              onChange={(e) => setRule(i, { scope: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}>触发方式
            <select key={'rmode-' + i} value={r.watch != null ? 'watch' : 'when'} onChange={(e) => {
              const expr = r.watch ?? r.when ?? '';
              if (e.target.value === 'watch') setRule(i, { watch: expr, when: undefined });
              else setRule(i, { when: expr, watch: undefined });
            }}>
              <option value="when">值变真（when 由假变真时触发）</option>
              <option value="watch">值变化（watch 值改变即触发）</option>
            </select></label>
          {r.watch != null ? (
            <label style={{ gridColumn: '1 / -1' }}>watch（监视表达式，值变化即清空 targets）
              <input key={'rwatch-' + i} defaultValue={r.watch} placeholder={'如 trxCCY（切币种即重置金额）'}
                onChange={(e) => setRule(i, { watch: e.target.value })} /></label>
          ) : (
            <label style={{ gridColumn: '1 / -1' }}>when（触发表达式，由假变真时清空 targets）
              <input key={'rw-' + i} defaultValue={r.when} placeholder={'如 settleType == "wire"'}
                onChange={(e) => setRule(i, { when: e.target.value })} /></label>
          )}
          <label style={{ gridColumn: '1 / -1' }}>targets（逗号/空格分隔；字段名=清值，slot 名=递归清子树，集合名=删所有行）
            <input key={'rt-' + i} defaultValue={r.targets.join(', ')} placeholder="lcNo, applicant, charges"
              onChange={(e) => setRule(i, { targets: e.target.value.split(/[,\s]+/).filter(Boolean) })} /></label>
          <label className="ck" style={{ gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={!!r.confirm} onChange={(e) => setRule(i, { confirm: e.target.checked || undefined })} />
            重置前二次确认（删 children / 重置 slot 等不可逆操作建议开）</label>
          {r.confirm && <label style={{ gridColumn: '1 / -1' }}>确认提示语（可选，留空用默认）
            <input key={'rc-' + i} defaultValue={typeof r.confirm === 'string' ? r.confirm : ''} placeholder="确认清空申请人并删除所有收费明细？"
              onChange={(e) => setRule(i, { confirm: e.target.value || true })} /></label>}
          <button className="del" style={{ gridColumn: '1 / -1' }} onClick={() => delRule(i)}>✕ 删除此规则</button>
        </div>
      ))}
      <button className="pc-pal" style={{ marginTop: 8 }} onClick={addRule}>＋ 新增规则</button>
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
        {n.kind === 'field' && <label>control<select value={n.control ?? 'text'} onChange={(e) => patch(a, { control: e.target.value })}><option>text</option><option>ccy</option><option>adjust</option><option value="date">date（日历）</option><option value="select">select（下拉）</option><option value="party-lookup">party-lookup（主数据查询）</option></select></label>}
        {n.kind === 'field' && n.control === 'select' && <label style={{ gridColumn: '1 / -1' }}>options（逗号/换行分隔，可写 值=显示名）
          <input key={'opt-' + a.join('.')} defaultValue={optToStr(n.controlProps?.options)} placeholder="如 A, B, manual=人工录入"
            onChange={(e) => patch(a, { controlProps: strToOpt(e.target.value) })} /></label>}
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
        <label>布局<select value={n.layout ?? 'cards'} onChange={(e) => patch(a, { layout: e.target.value === 'cards' ? undefined : e.target.value })}><option value="cards">卡片</option><option value="table">表格</option><option value="modal">弹窗编辑</option></select></label>
        <label>itemGrid<select value={n.itemGrid ?? 'row'} onChange={(e) => patch(a, { itemGrid: e.target.value })}><option>row</option><option>col</option></select></label>
        <label style={{ gridColumn: '1 / -1' }}>新增初值 newItemInit
          {/* 非受控：value 经 strToInit/initToStr 往返会丢中间态（打字被清空），用 defaultValue+key 保留原文，切换节点时 remount 重置 */}
          <input key={'nii-' + a.join('.')} defaultValue={initToStr(n.newItemInit)}
            placeholder="字段=表达式，多个用 ; 分隔，如 amount=diff; ccy=root.payCcy（本集合所属节点作用域）"
            onChange={(e) => patch(a, { newItemInit: strToInit(e.target.value) })} /></label>
      </div>}

      {n.kind === 'validations' && <div className="ed-grid"><label>path（缺省=当前节点）<input value={n.path ?? ''} onChange={(e) => patch(a, { path: e.target.value })} /></label></div>}
      {n.kind === 'tabs' && <p className="hint">在画布上编辑标签页：切换/新增/删除标签，拖字段到激活标签的放置区。</p>}
    </div>
  );
}
