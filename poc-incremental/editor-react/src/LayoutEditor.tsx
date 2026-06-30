import { useState } from 'react';
import { EngineMeta, PageDef, PageNode } from '@udsl/ui-kit-core';

// 布局侧：编辑某个顶层面板（不带 at，绑 root）的字段子节点——增/删/移/绑定。
//   控件种类由字段 spec 强制（computed/external 只能放 cell），与 lint 一致。
export function LayoutEditor({ pageDef, setPageDef, meta }: {
  pageDef: PageDef; setPageDef: (p: PageDef) => void; meta: EngineMeta;
}) {
  const panels = pageDef.layout
    .map((n, idx) => ({ n, idx }))
    .filter((x) => x.n.kind === 'panel' && !(x.n as any).at);
  const [sel, setSel] = useState(panels.length ? panels[0].idx : 0);
  const panel = pageDef.layout[sel] as Extract<PageNode, { kind: 'panel' }> | undefined;
  const children = (panel?.children ?? []).filter((c) => c.kind === 'field' || c.kind === 'cell') as any[];

  const fieldsOfRoot = meta.effectiveFields(meta.root);
  const usedNames = new Set(children.map((c) => c.field ?? (c.path ? c.path.split('.').pop() : '')));
  const avail = Object.keys(fieldsOfRoot).filter((f) => !usedNames.has(f));
  const [pick, setPick] = useState('');

  const mutate = (fn: (panel: any) => void) => {
    const next = structuredClone(pageDef);
    fn(next.layout[sel]);
    setPageDef(next);
  };
  const addField = () => {
    if (!pick) return;
    const spec = fieldsOfRoot[pick] ?? {};
    const kind = spec.computed || spec.external ? 'cell' : 'field';
    mutate((p) => p.children.push({ kind, field: pick }));
    setPick('');
  };
  const childIndexInPanel = (visibleIdx: number) => {
    // 把"可见 field/cell 列表"的下标映射回 panel.children 真实下标
    let seen = -1;
    for (let i = 0; i < panel!.children.length; i++) {
      const k = panel!.children[i].kind;
      if (k === 'field' || k === 'cell') { seen++; if (seen === visibleIdx) return i; }
    }
    return -1;
  };
  const remove = (vi: number) => mutate((p) => p.children.splice(childIndexInPanel(vi), 1));
  const move = (vi: number, dir: -1 | 1) => mutate((p) => {
    const i = childIndexInPanel(vi), j = childIndexInPanel(vi + dir);
    if (i < 0 || j < 0) return;
    [p.children[i], p.children[j]] = [p.children[j], p.children[i]];
  });

  return (
    <div className="ed-sec">
      <div className="ed-row">
        <label>编辑面板
          <select value={sel} onChange={(e) => setSel(+e.target.value)}>
            {panels.map((x) => <option key={x.idx} value={x.idx}>{(x.n as any).title}</option>)}
          </select>
        </label>
      </div>

      <table className="ed-tbl">
        <thead><tr><th>#</th><th>控件</th><th>字段</th><th>标签</th><th></th></tr></thead>
        <tbody>
          {children.map((c, vi) => (
            <tr key={vi}>
              <td>{vi + 1}</td>
              <td><span className={'kind ' + c.kind}>{c.kind}</span></td>
              <td><code>{c.field ?? c.path}</code></td>
              <td>{c.label ?? '—'}</td>
              <td className="ops">
                <button onClick={() => move(vi, -1)} disabled={vi === 0}>↑</button>
                <button onClick={() => move(vi, 1)} disabled={vi === children.length - 1}>↓</button>
                <button className="del" onClick={() => remove(vi)}>✕</button>
              </td>
            </tr>
          ))}
          {!children.length && <tr><td colSpan={5} className="muted">该面板暂无字段</td></tr>}
        </tbody>
      </table>

      <div className="ed-row">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">＋ 从调色板添加字段（root）…</option>
          {avail.map((f) => {
            const s = fieldsOfRoot[f] ?? {};
            const tag = s.computed ? '（计算→cell）' : s.external ? '（外部→cell）' : '';
            return <option key={f} value={f}>{f}{tag}</option>;
          })}
        </select>
        <button className="primary" onClick={addField} disabled={!pick}>添加</button>
      </div>
      <p className="hint">控件种类由字段 spec 强制：computed/external 自动成只读 cell，其余为可编辑 field。</p>
    </div>
  );
}
