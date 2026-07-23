// ★ 自定义节点组件【样板】——CustomerParty「摘要 + 编辑弹窗」。
//   以后写自定义组件照此抄：
//   1) 签名 = ({ node, ctx }) => ReactNode；node 是 PanelUI，含 children(已水化子树) / nodePath(基路径,如 root.buyer) / widgetProps(配置)。
//   2) 值永远经 ctx：读 ctx.valueOf(path)、写 ctx.onInput(path,v)；组件自身只用 useState 存【UI 态】(展开/折叠、草稿快照)，不存业务值。
//   3) 要渲染"编辑器排的子树布局"就用 <UiRenderer ir={node.children} ctx={ctx} />——四端布局逻辑复用，组件不重写表单。
//   4) 事务草稿：打开弹窗时快照叶子字段值，取消→逐字段 ctx.onInput 回滚，完成→保留。
//   5) 用 registerNodeWidget('name', 组件) 注册（见 index.ts）；PageDef 里 panel 设 widget:'name' 即启用；未注册端自动降级为默认 panel。
import { useRef, useState } from 'react';
import type { EngineCtx, ForkHandle, PanelUI } from '@udsl/ui-kit-core';
import { EgModal, UiRenderer, leafControls } from '../components';
import { registerNodeWidget } from '../node-widgets';

function PartyCard({ node, ctx }: { node: PanelUI; ctx: EngineCtx }) {
  const base = node.nodePath ?? 'root';                         // 子树基路径，如 root.buyer
  const props = node.widgetProps ?? {};
  const summaryFields: string[] = Array.isArray(props.summary) ? props.summary : [];
  const title: string = props.title ?? node.label ?? '';

  const [editing, setEditing] = useState(false);
  const forkRef = useRef<ForkHandle | null>(null);
  const [, forceFork] = useState(0);
  const editCtx = forkRef.current ? forkRef.current.ctx : ctx;  // 编辑走 fork 副本，摘要走真 ctx

  // 打开编辑：开隔离事务副本——弹窗里的编辑在副本进行，主页面完全不动。
  const open = () => {
    const f = ctx.forkEdit ? ctx.forkEdit() : null;
    forkRef.current = f;
    if (f) f.ctx.onTick(() => forceFork((x) => x + 1));         // 副本更新 → 弹窗重渲染
    setEditing(true);
  };
  const cancel = () => { forkRef.current = null; setEditing(false); };  // 丢弃副本 = 主页面零变化
  const done = () => {                                          // 完成：把副本里各字段值应用回主会话
    const f = forkRef.current;
    if (f) f.commit(node.children.flatMap((c) => leafControls(c)).filter((l) => l.kind === 'field').map((l) => l.path));
    forkRef.current = null; setEditing(false);
  };

  return (
    <div className="eg-panel panel v-party eg-party-card">
      <div className="ph"><span className="ttl">{title}</span>
        <button type="button" className="edit" onClick={open}>✎ 编辑</button></div>
      {/* 折叠态：只读摘要（几项关键字段），其余字段收在弹窗里 */}
      <div className="eg-party-summary">
        {summaryFields.length === 0
          ? <span className="muted">（未配 summary）</span>
          : summaryFields.map((f) => (
            <div key={f} className="sum-item"><span className="k">{f}</span><span className="v">{ctx.valueOf(`${base}.${f}`) || '—'}</span></div>
          ))}
      </div>
      {editing && (
        <EgModal title={`${title} · 编辑`} onCancel={cancel} onSave={done}>
          {/* 弹窗内容 = 编辑器排的完整 party 布局（node.children）；用 fork 副本 ctx，改动不进主页面直到「完成」 */}
          <UiRenderer ir={node.children} ctx={editCtx} />
        </EgModal>
      )}
    </div>
  );
}

// 内置注册：随包即用；这行同时演示"如何注册自定义组件"。
registerNodeWidget('party-card', PartyCard);

export { PartyCard };
