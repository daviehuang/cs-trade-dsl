import { useState } from 'react';
import { EngineMeta } from '@udsl/ui-kit-core';
import { DragPayload, writePayload } from './layout-addr';

// 规则集树（页面编辑左栏）：从 meta 递归展开 模型节点 → 字段 / 具名槽位 / 子集合，
//   每项可拖拽到右侧画布。字段种类(field/cell)由 spec 强制。
type Props = { meta: EngineMeta };

const isCell = (s: any) => !!(s?.computed || s?.external);
// 某类型的所有字段 → field/cell 节点（按 spec 定种类）。集合/槽位整体拖入时用它预填。
const fieldsOf = (meta: EngineMeta, itemType: string) =>
  Object.entries(meta.effectiveFields(itemType)).map(([f, s]) => ({ kind: isCell(s) ? 'cell' : 'field', field: f }));

export function RulesetTree({ meta }: Props) {
  return (
    <div className="rs-tree">
      <div className="rs-tree-hint">从这里把<b>字段 / 槽位 / 子集合</b>拖到右侧画布 →</div>
      <TypeBlock meta={meta} type={meta.root} label={meta.root} kk="root" depth={0} defaultOpen />
    </div>
  );
}

function drag(payload: DragPayload) {
  return (e: React.DragEvent) => writePayload(e, payload);
}

function TypeBlock({ meta, type, label, kk, depth, defaultOpen }: {
  meta: EngineMeta; type: string; label: string; kk: string; depth: number; defaultOpen?: boolean;
}) {
  const fields = Object.entries(meta.effectiveFields(type));
  const slots = Object.entries(meta.effectiveSlots(type));
  const colls = meta.childrenOf(type);
  const pad = (d: number) => ({ paddingLeft: 8 + d * 14 });

  return (
    <div className="rs-block">
      {fields.map(([f, s]) => {
        const kind = isCell(s) ? 'cell' : 'field';
        return (
          <div key={f} className="rs-item field" style={pad(depth)} draggable
            onDragStart={drag({ src: 'field', field: f, asKind: kind, label: (s as any).label })}>
            <span className={'kind ' + kind}>{kind}</span>
            <b className="rs-name">{f}</b>
            {(s as any).label && <span className="muted rs-lbl">{(s as any).label}</span>}
          </div>
        );
      })}
      {slots.map(([name, sub]) => (
        <ExpandRow key={'slot:' + name} kk={kk + '.s.' + name} depth={depth} badge="slot" badgeCls="slot"
          name={name} sub={String(sub)}
          dragProps={{ draggable: true, onDragStart: drag({ src: 'node', at: name, label: name, fields: fieldsOf(meta, String(sub)) }) }}>
          <TypeBlock meta={meta} type={String(sub)} label={name} kk={kk + '.s.' + name} depth={depth + 1} />
        </ExpandRow>
      ))}
      {colls.map((c) => (
        <ExpandRow key={'coll:' + c.name} kk={kk + '.c.' + c.name} depth={depth} badge="集合" badgeCls="collection"
          name={c.name} sub={c.node}
          dragProps={{ draggable: true, onDragStart: drag({ src: 'collection', name: c.name, itemTemplate: fieldsOf(meta, c.node) }) }}>
          <TypeBlock meta={meta} type={c.node} label={c.name} kk={kk + '.c.' + c.name} depth={depth + 1} />
        </ExpandRow>
      ))}
      {fields.length === 0 && slots.length === 0 && colls.length === 0 &&
        <div className="muted" style={pad(depth)}>（无字段）</div>}
    </div>
  );
}

function ExpandRow({ kk, depth, badge, badgeCls, name, sub, dragProps, children }: {
  kk: string; depth: number; badge: string; badgeCls: string; name: string; sub: string;
  dragProps: any; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={'rs-item ' + badgeCls} style={{ paddingLeft: 8 + depth * 14 }} {...dragProps}>
        <button className="rs-exp" onClick={() => setOpen((o) => !o)} title={open ? '收起' : '展开'}>{open ? '▾' : '▸'}</button>
        <span className={'kind ' + badgeCls}>{badge}</span>
        <b className="rs-name">{name}</b>
        <span className="muted rs-lbl">{sub}</span>
      </div>
      {open && children}
    </>
  );
}
