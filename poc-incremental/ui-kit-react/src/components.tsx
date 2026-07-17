// React 渲染 kit：UINode → React 控件，一一镜像 Angular 的 eg-* 组件。
//   受控输入 = 引擎是真相源：value 读 ctx.valueOf(path)，onChange 写 ctx.onInput(path)，
//   不在 React 里存值。复用与 Angular 同名的 CSS class（styles.css），两框架视觉一致。
import React, { useRef, useState } from 'react';
import {
  CellUI, CollectionUI, EngineCtx, FieldUI, GroupUI, PanelUI, TabsUI, UINode, ValidationsUI, buildNewItem,
} from '@udsl/ui-kit-core';
import { getLookupService, LookupCandidate } from './lookup';

const cx = (...xs: (string | undefined | false)[]) => xs.filter(Boolean).join(' ');

export function UINodeView({ node, ctx }: { node: UINode; ctx: EngineCtx }) {
  switch (node.kind) {
    case 'field': return <EgField node={node} ctx={ctx} />;
    case 'cell': return <EgCell node={node} ctx={ctx} />;
    case 'validations': return <EgValidations node={node} ctx={ctx} />;
    case 'panel': return <EgPanel node={node} ctx={ctx} />;
    case 'collection': return <EgCollection node={node} ctx={ctx} />;
    case 'group': return <EgGroup node={node} ctx={ctx} />;
    case 'tabs': return <EgTabs node={node} ctx={ctx} />;
  }
}

// 收集一个子树里的叶子 field/cell UINode（供表格模式按列渲染裸控件）。
function leafControls(node: UINode): (FieldUI | CellUI)[] {
  if (node.kind === 'field' || node.kind === 'cell') return [node];
  if (node.kind === 'group' || node.kind === 'panel') return node.children.flatMap(leafControls);
  return [];
}

/** 顶层渲染入口：UINode[] → React 树。 */
export function UiRenderer({ ir, ctx }: { ir: UINode[]; ctx: EngineCtx }) {
  return <>{ir.map((n, i) => <UINodeView key={i} node={n} ctx={ctx} />)}</>;
}

// 仅控件（无 label 外壳）——供表格单元格复用。
function fieldControl(node: FieldUI, ctx: EngineCtx): React.ReactNode {
  const v = ctx.valueOf(node.path);
  const set = (val: string) => ctx.onInput(node.path, val);
  if (node.control === 'ccy')
    // 值为空时插占位空项：避免受控 select 无匹配值时浏览器"显示第一项、模型却是空"的错位
    return <select value={v} onChange={(e) => set(e.target.value)}>{!v && <option value="">— 请选择 —</option>}{ctx.ccys.map((c) => <option key={c} value={c}>{c}</option>)}</select>;
  if (node.control === 'adjust')
    return (
      <select value={v} onChange={(e) => set(e.target.value)}>
        <option value="auto-high">auto-high（收费50%）</option>
        <option value="auto-low">auto-low（收费10%）</option>
        <option value="manual">manual（人工录入）</option>
      </select>
    );
  if (node.control === 'party-lookup') return <PartyLookup node={node} ctx={ctx} />;
  if (node.control === 'date') return <input type="date" value={v} data-path={node.path} data-value={v} onChange={(e) => set(e.target.value)} />;
  return <input value={v} data-path={node.path} data-value={v} onChange={(e) => set(e.target.value)} />;
}

// 当事方主数据查询控件：名称模糊查 → 候选下拉 → 选中据 key 取记录 → mapping 到同节点各字段。
//   搜索/候选是纯 UI（不进引擎）；选中后只经 ctx.onInput 把记录写进引擎输入字段（可再手改；不选则手工填）。
function PartyLookup({ node, ctx }: { node: FieldUI; ctx: EngineCtx }) {
  const v = ctx.valueOf(node.path);
  const base = node.path.slice(0, node.path.lastIndexOf('.'));   // 同节点（如 root.buyer）→ 兄弟字段路径前缀
  const [cands, setCands] = useState<LookupCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<any>(null);
  const seq = useRef(0);
  const svc = getLookupService();

  const onType = (val: string) => {
    ctx.onInput(node.path, val);                                 // 名称字段本身随输入更新（不选也是手工输入）
    if (timer.current) clearTimeout(timer.current);
    if (!svc || !val.trim()) { setCands([]); setOpen(false); return; }
    const my = ++seq.current;
    setBusy(true);
    timer.current = setTimeout(() => {                            // 防抖 250ms
      svc.search('customer', val.trim()).then((rows) => {
        if (my !== seq.current) return;                          // 丢弃过期结果
        setCands(rows); setOpen(true); setBusy(false);
      });
    }, 250);
  };
  const pick = async (c: LookupCandidate) => {
    setOpen(false); setCands([]);
    if (!svc) return;
    const rec = await svc.get('customer', c.id);                 // 据选中 key 取整条记录
    for (const [k, val] of Object.entries(rec))                  // mapping：记录各字段 → 同节点兄弟字段
      if (k !== 'id') ctx.onInput(`${base}.${k}`, String(val ?? ''));
  };

  return (
    <span className="eg-lookup">
      <input className="eg-lookup-in" value={v} data-path={node.path} placeholder="输入客户名称模糊查询…"
        onChange={(e) => onType(e.target.value)}
        onFocus={() => cands.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {busy && <span className="eg-lookup-busy">⏳</span>}
      {open && cands.length > 0 && (
        <div className="eg-lookup-menu">
          {cands.map((c) => (
            <div key={c.id} className="eg-lookup-item" onMouseDown={() => pick(c)}>{c.label}</div>
          ))}
        </div>
      )}
      {open && !busy && cands.length === 0 && v.trim() && (
        <div className="eg-lookup-menu"><div className="eg-lookup-empty">无匹配客户 —— 直接手工填写各字段</div></div>
      )}
    </span>
  );
}

function cellBody(node: CellUI, ctx: EngineCtx): React.ReactNode {
  const st = ctx.cellState(node.path);
  const txt = ctx.cellText(node.path);
  if (st === 'input')
    return <input className="cond" value={ctx.valueOf(node.path)} title="条件可输入（守卫为假时合法录入）"
                  onChange={(e) => ctx.onInput(node.path, e.target.value)} />;
  if (ctx.overridableFor(node.path))    // 实时可覆盖（随命中分支变化），非静态 node.overridable
    return (
      <span className="row">
        <input className={cx('ovr', st === 'overridden' && 'on')} value={txt} title="可人工覆盖"
               onChange={(e) => ctx.onOverride(node.path, e.target.value)} />
        <button type="button" title="恢复计算" onClick={() => ctx.clearOverride(node.path)}>⟲</button>
      </span>
    );
  return <span className={cx('cv', node.big && 'big', st === 'pending' && 'pend', st === 'error' && 'err')}
               data-path={node.path} data-value={txt}>{txt}</span>;
}

const bareControl = (node: FieldUI | CellUI, ctx: EngineCtx): React.ReactNode =>
  node.kind === 'field' ? fieldControl(node, ctx) : cellBody(node, ctx);

function EgField({ node, ctx }: { node: FieldUI; ctx: EngineCtx }) {
  return <label className={cx('eg-field l', node.className)}>{node.label}{fieldControl(node, ctx)}</label>;
}

function EgCell({ node, ctx }: { node: CellUI; ctx: EngineCtx }) {
  return <label className={cx('eg-cell l', node.className)}>{node.label}{cellBody(node, ctx)}</label>;
}

function EgTabs({ node, ctx }: { node: TabsUI; ctx: EngineCtx }) {
  const [active, setActive] = useState(0);
  const cur = node.tabs[active] ?? node.tabs[0];
  return (
    <div className={cx('eg-tabs', node.className)}>
      <div className="eg-tab-h">
        {node.tabs.map((t, i) => (
          <button key={i} type="button" className={cx('eg-tab', i === active && 'on')} onClick={() => setActive(i)}>{t.label}</button>
        ))}
      </div>
      <div className="eg-tab-body">{cur?.children.map((c, i) => <UINodeView key={i} node={c} ctx={ctx} />)}</div>
    </div>
  );
}

function EgValidations({ node, ctx }: { node: ValidationsUI; ctx: EngineCtx }) {
  const items = ctx.validationsFor(node.path);
  if (!items.length) return null;
  return (
    <div className={cx('eg-validations vl', node.className)}>
      {items.map((vd) => (
        <span key={vd.id + vd.node} className={cx('chip', vd.ok ? 'ok' : 'bad')} title={vd.message || ''}>
          <i>{vd.ok ? '✔' : '✘'}</i> {vd.id}{!vd.ok && <em>：{vd.message}</em>}
        </span>
      ))}
    </div>
  );
}

function EgCollection({ node, ctx }: { node: CollectionUI; ctx: EngineCtx }) {
  const head = (
    <div className="ch"><b>{node.title} <span className="n">{node.items.length}</span></b>
      <button type="button" className="add" onClick={() => ctx.addChild(node.parentPath, node.collName, buildNewItem(node, ctx))}>＋ 添加</button>
    </div>
  );
  // 表格模式：列=字段、行=记录（每格渲染裸控件）。
  if (node.layout === 'table' && node.columns?.length) {
    const cols = node.columns;
    return (
      <div className={cx('eg-collection coll', node.className)}>
        {head}
        {node.items.length === 0
          ? <div className="empty">（暂无，点「＋ 添加」新增一条）</div>
          : <table className="eg-table"><thead><tr><th className="ti">#</th>{cols.map((c, i) => <th key={i}>{c.label}</th>)}<th /></tr></thead>
            <tbody>
              {node.items.map((it, i) => {
                const leaves = leafControls(it.group);
                return (
                  <tr key={it.nodePath}>
                    <td className="ti">{i + 1}</td>
                    {cols.map((_, ci) => <td key={ci}>{leaves[ci] ? bareControl(leaves[ci], ctx) : null}</td>)}
                    <td><button type="button" className="x" title="删除" onClick={() => ctx.removeChild(it.nodePath)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody></table>}
      </div>
    );
  }
  return (
    <div className={cx('eg-collection coll', node.className)}>
      {head}
      {node.items.length === 0
        ? <div className="empty">（暂无，点「＋ 添加」新增一条）</div>
        : node.items.map((it, i) => (
          <div className="item" key={it.nodePath}>
            <span className="idx">{i + 1}</span>
            <div className="body"><UINodeView node={it.group} ctx={ctx} /></div>
            <button type="button" className="x" title="删除" onClick={() => ctx.removeChild(it.nodePath)}>✕</button>
          </div>
        ))}
    </div>
  );
}

function EgPanel({ node, ctx }: { node: PanelUI; ctx: EngineCtx }) {
  const variant = node.variant || 'form';
  return (
    <div className={cx('eg-panel panel', 'v-' + variant, node.tone && 'tone-' + node.tone, node.className)}>
      <div className="ph"><span className="ttl">{node.label}</span>{node.badge && <span className="badge">{node.badge}</span>}</div>
      <div className={cx('body', node.gridClass)}>{node.children.map((c, i) => <UINodeView key={i} node={c} ctx={ctx} />)}</div>
    </div>
  );
}

function EgGroup({ node, ctx }: { node: GroupUI; ctx: EngineCtx }) {
  const style = node.cols ? { display: 'grid', gridTemplateColumns: `repeat(${node.cols}, 1fr)`, gap: '10px' } : undefined;
  return <div className={cx('eg-group', node.gridClass, node.className)} style={style}>{node.children.map((c, i) => <UINodeView key={i} node={c} ctx={ctx} />)}</div>;
}
