// ★ 自定义节点组件【HTML 样板】——CustomerParty「摘要 + 编辑弹窗」，与 React 端 party-card 同构。
//   HTML 端要点（区别于 React 的组件局部 state）：
//   1) 签名 = ({ node, ctx }) => HTMLElement；node 是 PanelUI，含 children(已水化子树) / nodePath / widgetProps。
//   2) 值永远经 ctx：摘要读 ctx.valueOf(path)；组件不在 DOM 里存业务值。
//   3) 弹窗做成【挂到 document.body 的浮层】——主页面全量重渲染（mount 的 render）不会连带销毁它；
//      而 fork 事务保证编辑期主会话不变→主页面根本不重渲染，浮层稳定存在，由【副本 onTick】独立重渲染弹窗体。
//   4) 事务隔离：open 开 fork 副本 → 弹窗渲 node.children 用副本 ctx；取消丢弃副本（主会话零变化）、
//      完成 commit(叶子 field 路径) 应用回主会话（随后主页面 render 刷新摘要）。
//   5) registerNodeWidget('party-card', ...) 注册；PageDef 里 panel 设 widget:'party-card' 即启用；未注册端降级默认 panel。
import type { EngineCtx, PanelUI, UINode } from '@udsl/ui-kit-core';
import { h, renderUINode } from '../render';
import { registerNodeWidget } from '../node-widgets';

/** 收集子树里的叶子 field 路径（弹窗完成时把这些值从副本提交回主会话；cell 是计算值无需提交）。 */
function fieldPaths(n: UINode): string[] {
  if (n.kind === 'field') return [n.path];
  if (n.kind === 'group' || n.kind === 'panel') return n.children.flatMap(fieldPaths);
  return [];
}

/** 自包含模态浮层（挂到 body，复用共享 eg-modal-* class）：背景点击 = 取消。返回弹窗体元素 + 移除函数。 */
function openModal(title: string, cb: { onCancel: () => void; onSave: () => void }): { body: HTMLElement; remove: () => void } {
  const body = h('div', { class: 'eg-modal-b' });
  const card = h('div', { class: 'eg-modal-card', role: 'dialog' },
    h('div', { class: 'eg-modal-h' }, h('b', {}, title),
      h('button', { type: 'button', class: 'x', title: '关闭（取消）', onclick: () => cb.onCancel() }, '✕')),
    body,
    h('div', { class: 'eg-modal-f' },
      h('button', { type: 'button', class: 'cancel', onclick: () => cb.onCancel() }, '取消'),
      h('button', { type: 'button', class: 'done', onclick: () => cb.onSave() }, '完成')));
  const backdrop = h('div', { class: 'eg-modal-backdrop' }, card);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) cb.onCancel(); });   // 背景点击 = 取消
  document.body.append(backdrop);
  return { body, remove: () => backdrop.remove() };
}

function PartyCard({ node, ctx }: { node: PanelUI; ctx: EngineCtx }): HTMLElement {
  const base = node.nodePath ?? 'root';                         // 子树基路径，如 root.buyer
  const props = node.widgetProps ?? {};
  const summaryFields: string[] = Array.isArray(props.summary) ? props.summary : [];
  const title: string = props.title ?? node.label ?? '';

  // 打开编辑：开隔离事务副本——弹窗里的编辑在副本进行，主页面完全不动。
  const open = () => {
    const f = ctx.forkEdit ? ctx.forkEdit() : null;
    const editCtx = f ? f.ctx : ctx;                            // 有 fork 走副本；否则直接改主会话（降级）
    let off = () => {};
    const close = () => { off(); modal.remove(); };
    const modal = openModal(`${title} · 编辑`, {
      onCancel: () => close(),                                  // 丢弃副本（不 commit）= 主页面零变化
      onSave: () => { if (f) f.commit(node.children.flatMap(fieldPaths)); close(); },  // 副本 → 主会话
    });
    // 弹窗体渲染（副本更新→重渲染；commit-on-blur 提交后做焦点保护，避免多字段编辑丢焦点）。
    const renderBody = () => {
      const active = document.activeElement as HTMLElement | null;
      const keep = active && modal.body.contains(active) ? (active as HTMLElement).dataset?.['path'] : null;
      modal.body.replaceChildren(...node.children.map((c) => renderUINode(c, editCtx)));
      if (keep) modal.body.querySelector<HTMLElement>(`[data-path="${CSS.escape(keep)}"]`)?.focus();
    };
    off = f ? f.ctx.onTick(renderBody) : () => {};
    renderBody();
  };

  // 折叠态：只读摘要（几项关键字段）+「编辑」按钮；其余字段收在弹窗里。
  return h('div', { class: 'eg-panel panel v-party eg-party-card' },
    h('div', { class: 'ph' },
      h('span', { class: 'ttl' }, title),
      h('button', { type: 'button', class: 'edit', onclick: open }, '✎ 编辑')),
    h('div', { class: 'eg-party-summary' },
      ...(summaryFields.length === 0
        ? [h('span', { class: 'muted' }, '（未配 summary）')]
        : summaryFields.map((fld) => h('div', { class: 'sum-item' },
            h('span', { class: 'k' }, fld),
            h('span', { class: 'v' }, ctx.valueOf(`${base}.${fld}`) || '—'))))));
}

// 内置注册：import '@udsl/ui-kit-html' 即自注册（同 React 端）。
registerNodeWidget('party-card', PartyCard);

export { PartyCard };
