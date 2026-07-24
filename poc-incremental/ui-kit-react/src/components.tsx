// React 渲染 kit：UINode → React 控件，一一镜像 Angular 的 eg-* 组件。
//   受控输入 = 引擎是真相源：value 读 ctx.valueOf(path)，onChange 写 ctx.onInput(path)，
//   不在 React 里存值。复用与 Angular 同名的 CSS class（styles.css），两框架视觉一致。
import React, { useRef, useState } from 'react';
import {
  CellUI, CollectionUI, EngineCtx, FieldUI, ForkHandle, GroupUI, PanelUI, TabsUI, UINode, ValidationsUI, buildNewItem, selectOptions,
} from '@udsl/ui-kit-core';
import { getLookupService, LookupCandidate } from './lookup';
import { getNodeWidget } from './node-widgets';

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

// 收集一个子树里的叶子 field/cell UINode（供表格模式按列渲染裸控件；自定义组件做草稿快照也复用）。
export function leafControls(node: UINode): (FieldUI | CellUI)[] {
  if (node.kind === 'field' || node.kind === 'cell') return [node];
  if (node.kind === 'group' || node.kind === 'panel') return node.children.flatMap(leafControls);
  return [];
}

/** 顶层渲染入口：UINode[] → React 树。 */
export function UiRenderer({ ir, ctx }: { ir: UINode[]; ctx: EngineCtx }) {
  return <>{ir.map((n, i) => <UINodeView key={i} node={n} ctx={ctx} />)}</>;
}

// 文本类输入：输入过程只改本地草稿，焦点离开（或回车）才提交到引擎（commit-on-blur）——
//   避免每次击键就 setInput 引发 computed 级联/联动重置；未编辑时显示引擎值（含计算/覆盖结果）。
function CommitInput({ path, value, commit, className, title, type }: {
  path: string; value: string; commit: (v: string) => void; className?: string; title?: string; type?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const v = draft ?? value;                                   // 编辑中显示草稿；否则显示引擎值
  const doCommit = () => { if (draft != null && draft !== value) commit(draft); setDraft(null); };
  return (
    <input type={type} className={className} title={title} value={v} data-path={path} data-value={v}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={doCommit}
      onKeyDown={(e) => { if (e.key === 'Enter') { doCommit(); (e.target as HTMLInputElement).blur(); } }} />
  );
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
  if (node.control === 'date') return <CommitInput type="date" path={node.path} value={v} commit={set} />;
  if (node.control === 'select')
    // 值为空时插占位空项：避免受控 select 无匹配值时"显示第一项、模型却是空"的错位
    return <select value={v} data-path={node.path} onChange={(e) => set(e.target.value)}>{!v && <option value="">— 请选择 —</option>}{selectOptions(node.controlProps).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  return <CommitInput path={node.path} value={v} commit={set} />;
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
    return <CommitInput className="cond" path={node.path} value={ctx.valueOf(node.path)} title="条件可输入（守卫为假时合法录入）"
                  commit={(val) => ctx.onInput(node.path, val)} />;
  if (ctx.overridableFor(node.path))    // 实时可覆盖（随命中分支变化），非静态 node.overridable
    return (
      <span className="row">
        <CommitInput className={cx('ovr', st === 'overridden' && 'on')} path={node.path} value={txt} title="可人工覆盖"
               commit={(val) => ctx.onOverride(node.path, val)} />
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

// 只读展示一个叶子字段当前值（供弹窗模式的父页面表格单元格）。
const leafText = (lf: FieldUI | CellUI, ctx: EngineCtx): string =>
  lf.kind === 'cell' ? ctx.cellText(lf.path) : (ctx.valueOf(lf.path) || '—');

// 自包含模态框（渲染 kit 自带，不依赖编辑器 Modal）：背景点击 = 取消。
export function EgModal({ title, onCancel, onSave, children }: { title: string; onCancel: () => void; onSave: () => void; children: React.ReactNode }) {
  return (
    <div className="eg-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="eg-modal-card" role="dialog">
        <div className="eg-modal-h"><b>{title}</b><button type="button" className="x" title="关闭（取消）" onClick={onCancel}>✕</button></div>
        <div className="eg-modal-b">{children}</div>
        <div className="eg-modal-f">
          <button type="button" className="cancel" onClick={onCancel}>取消</button>
          <button type="button" className="done" onClick={onSave}>完成</button>
        </div>
      </div>
    </div>
  );
}

function EgCollection({ node, ctx }: { node: CollectionUI; ctx: EngineCtx }) {
  // 弹窗编辑/新增：优先隔离事务（fork 副本会话，编辑期主页面完全不动，完成才同步、取消零变化）；
  //   无 fork 能力则回退旧「编辑=快照+逐字段回滚，新增=实时 addChild + 取消 removeChild」。
  const [editing, setEditing] = useState<{ path?: string; forkPath?: string; isNew: boolean } | null>(null);
  const snapRef = useRef<Record<string, string>>({});
  const forkRef = useRef<ForkHandle | null>(null);
  const addGroupRef = useRef<UINode | null>(null);               // 新增行的编辑 group（副本里水化，主会话此刻无此行）
  const [, forceFork] = useState(0);

  // ── 弹窗编辑模式：摘要行 + 「编辑 / 新增」弹窗 ──
  if (node.layout === 'modal') {
    const snapshot = (group: UINode) => {
      const snap: Record<string, string> = {};
      for (const lf of leafControls(group)) if (lf.kind === 'field') snap[lf.path] = ctx.valueOf(lf.path);
      return snap;
    };
    const editRow = editing && !editing.isNew ? node.items.find((it) => it.nodePath === editing.path) : null;
    const group = editing?.isNew ? addGroupRef.current : editRow?.group;   // 新增取副本水化的 group，编辑取主 IR 的行 group
    const editCtx = forkRef.current ? forkRef.current.ctx : ctx;   // 编辑/新增走 fork 副本，其余走真 ctx
    const openEdit = (it: { nodePath: string; group: UINode }) => {
      const f = ctx.forkEdit ? ctx.forkEdit() : null;              // 开隔离事务副本
      forkRef.current = f;
      if (f) f.ctx.onTick(() => forceFork((x) => x + 1));          // 副本更新（如小计重算）→ 弹窗重渲染
      else snapRef.current = snapshot(it.group);                   // 回退旧快照
      setEditing({ path: it.nodePath, isNew: false });
    };
    const openAdd = () => {
      const f = ctx.forkEdit ? ctx.forkEdit() : null;
      if (f && node.newItemGroup) {                               // 新增也走隔离事务：行只落副本，主会话此刻不动
        const forkPath = f.addChild(node.parentPath, node.collName, buildNewItem(node, f.ctx));
        forkRef.current = f;
        addGroupRef.current = node.newItemGroup(forkPath, f.getState());   // 用副本 state 水化新行 group
        f.ctx.onTick(() => forceFork((x) => x + 1));
        setEditing({ forkPath, isNew: true });
      } else {                                                    // 回退：无 fork → 实时加行（旧行为）
        const path = ctx.addChild(node.parentPath, node.collName, buildNewItem(node, ctx));
        forkRef.current = null; addGroupRef.current = null; snapRef.current = {};
        setEditing({ path, isNew: true });
      }
    };
    const cancel = () => {
      if (forkRef.current) forkRef.current = null;                 // fork：丢弃即回滚（含副本里的新行——主会话从未被动过）
      else if (editing) { if (editing.isNew && editing.path) ctx.removeChild(editing.path); else for (const [p, v] of Object.entries(snapRef.current)) ctx.onInput(p, v); }
      addGroupRef.current = null;
      setEditing(null);
    };
    const done = () => {
      const f = forkRef.current;
      if (f && editing) {
        if (editing.isNew && editing.forkPath) f.commitAdd(node.parentPath, node.collName, editing.forkPath);         // 新增：副本行 → 主会话真加行
        else if (editRow) f.commit(leafControls(editRow.group).filter((l) => l.kind === 'field').map((l) => l.path));  // 编辑：字段值 → 主会话
      }
      forkRef.current = null; addGroupRef.current = null;
      setEditing(null);
    };
    const cols = node.columns ?? [];
    return (
      <div className={cx('eg-collection coll modal', node.className)}>
        <div className="ch"><b>{node.title} <span className="n">{node.items.length}</span></b>
          <button type="button" className="add" onClick={openAdd}>＋ 添加</button></div>
        {/* 父页面：只读摘要表格（列=字段）+ 每行「编辑 / 删除」；编辑在弹窗内以 form 布局进行 */}
        {node.items.length === 0
          ? <div className="empty">（暂无，点「＋ 添加」新增一条）</div>
          : <table className="eg-table">
            <thead><tr><th className="ti">#</th>{cols.map((c, i) => <th key={i}>{c.label}</th>)}<th /></tr></thead>
            <tbody>
              {node.items.map((it, i) => {
                const leaves = leafControls(it.group);
                return (
                  <tr key={it.nodePath}>
                    <td className="ti">{i + 1}</td>
                    {cols.map((_, ci) => <td key={ci}>{leaves[ci] ? leafText(leaves[ci], ctx) : null}</td>)}
                    <td className="row-ops">
                      <button type="button" className="edit" title="编辑" onClick={() => openEdit(it)}>✎ 编辑</button>
                      <button type="button" className="x" title="删除" onClick={() => ctx.removeChild(it.nodePath)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody></table>}
        {editing && group && (
          <EgModal title={`${node.title} · ${editing.isNew ? '新增' : '编辑'}`} onCancel={cancel} onSave={done}>
            <UINodeView node={group} ctx={editCtx} />
          </EgModal>
        )}
      </div>
    );
  }

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
  // 自定义节点组件：panel 设了 widget 且宿主已注册 → 该子树交自定义组件渲染；未注册 → 降级默认 panel。
  if (node.widget) { const W = getNodeWidget(node.widget); if (W) return <>{W({ node, ctx })}</>; }
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
