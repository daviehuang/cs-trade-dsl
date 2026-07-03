import { useState } from 'react';
import { RuleSet } from '@udsl/ui-kit-core';
import { Snapshot } from './store/editorStore';
import { diffRuleSet, diffTotal, BundleDiff } from './bundle-diff';

// 域11 版本 / 发布 / 回滚 / diff：
//   工件的 version + status(draft/active/deprecated) 编辑；「发布」= 打一个工作区快照；
//   每个快照可与当前草稿做结构 diff（规则/节点/模块/uses 增删改）、回滚、删除。
type Props = {
  ruleSet: RuleSet;
  mutateRuleSet: (fn: (rs: RuleSet) => void) => void;
  snapshots: Snapshot[];
  publish: (label: string) => void;
  rollback: (id: string) => void;
  deleteSnapshot: (id: string) => void;
};

const STATUSES = ['draft', 'active', 'deprecated'];

export function VersionPanel({ ruleSet, mutateRuleSet, snapshots, publish, rollback, deleteSnapshot }: Props) {
  const [label, setLabel] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const version = (ruleSet as any).version ?? '';
  const status = (ruleSet as any).status ?? 'draft';

  return (
    <div className="ed-sec">
      <h4>当前工件版本</h4>
      <div className="ed-grid">
        <label>ruleSetId<input value={ruleSet.ruleSetId ?? ''} readOnly style={{ background: '#f1f5f9' }} /></label>
        <label>version<input value={version} onChange={(e) => mutateRuleSet((rs: any) => { rs.version = e.target.value; })} /></label>
        <label>status<select value={status} onChange={(e) => mutateRuleSet((rs: any) => { rs.status = e.target.value; })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>

      <h4>发布快照</h4>
      <div className="ed-row">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="发布说明，如 v5.1.0 上线转通知行可选" style={{ flex: 1, minWidth: 240 }} />
        <button className="primary" onClick={() => { publish(label || `${ruleSet.ruleSetId}@${version}`); setLabel(''); }}>发布（打快照）</button>
      </div>
      <p className="hint">发布 = 冻结当前整份工作区（RuleSet + 库 + PageDef + 数据 + mocks）为一个带时间戳的版本；可随时对比/回滚。快照独立于 undo 历史。</p>

      <h4>版本历史（{snapshots.length}）</h4>
      {snapshots.length === 0 && <div className="muted">暂无已发布版本。改动后点「发布」留存一个可回滚的基线。</div>}
      {snapshots.map((snap) => {
        const d = diffRuleSet(snap.bundle.ruleSet, ruleSet);
        const n = diffTotal(d);
        const open = openId === snap.id;
        return (
          <div key={snap.id} className="rule-form" style={{ marginTop: 8 }}>
            <div className="rf-h">
              <b>{snap.label}</b>
              <span className="kind" style={{ marginLeft: 8 }}>v{snap.version}</span>
              <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{new Date(snap.at).toLocaleString()}</span>
              <span style={{ flex: 1 }} />
              <span className={n ? 'lint warn' : 'lint ok'} style={{ marginRight: 8 }}>{n ? `与当前差异 ${n}` : '与当前一致'}</span>
              <button className="mini" onClick={() => setOpenId(open ? null : snap.id)}>{open ? '收起' : '对比当前'}</button>
              <button className="mini" onClick={() => { if (confirm(`回滚到「${snap.label}」？当前未发布改动将进入历史（可 undo）。`)) rollback(snap.id); }}>回滚</button>
              <button className="del" onClick={() => { if (confirm('删除该快照？')) deleteSnapshot(snap.id); }}>✕</button>
            </div>
            {open && <DiffView d={d} />}
          </div>
        );
      })}
    </div>
  );
}

function DiffView({ d }: { d: BundleDiff }) {
  const sections: [string, typeof d.rules][] = [['规则 rules', d.rules], ['节点 nodes', d.nodes], ['模块 modules', d.modules], ['装配 uses', d.uses]];
  const icon = (k: string) => (k === 'added' ? '＋' : k === 'removed' ? '－' : '~');
  const tone = (k: string) => (k === 'added' ? '#0e7a4f' : k === 'removed' ? '#c0392b' : '#a86609');
  if (diffTotal(d) === 0) return <div className="muted" style={{ padding: '4px 2px' }}>与当前草稿完全一致。</div>;
  return (
    <div style={{ padding: '4px 2px' }}>
      {d.versionChanged && <div className="ed-row">version：<code>{d.versionChanged.from}</code> → <code>{d.versionChanged.to}</code></div>}
      {d.statusChanged && <div className="ed-row">status：<code>{d.statusChanged.from}</code> → <code>{d.statusChanged.to}</code></div>}
      {sections.map(([title, entries]) => entries.length > 0 && (
        <div key={title} style={{ marginTop: 4 }}>
          <div className="ds-sub">{title}（{entries.length}）</div>
          <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {entries.map((e) => <span key={e.kind + e.key} style={{ color: tone(e.kind), fontSize: 12 }} title={e.kind}>{icon(e.kind)} <code>{e.key}</code></span>)}
          </div>
        </div>
      ))}
      <p className="hint" style={{ marginTop: 6 }}>差异方向：相对该已发布快照，<b>当前草稿</b>的增(＋)/删(－)/改(~)。</p>
    </div>
  );
}
