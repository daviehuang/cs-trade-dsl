// 原生 HTML 哑渲染器：UINode → DOM 元素，一一镜像 React kit 的 eg-* 结构与 class。
//   引擎是唯一真相源：input 的 value 读 ctx.valueOf(path)，事件写回 ctx；不在 DOM 里存值。
//   复用与 React/Angular 同名的 CSS class（宿主引入共享 styles.css），三端视觉一致。
import {
  CellUI, CollectionUI, EngineCtx, FieldUI, GroupUI, PanelUI, UINode, ValidationsUI, buildNewItem,
} from '@udsl/ui-kit-core';

const cx = (...xs: (string | undefined | false)[]) => xs.filter(Boolean).join(' ');

/** 极简元素工厂：h(tag, {class,oninput,...属性}, ...子节点)。 */
function h(tag: string, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') (el as any)[k.toLowerCase()] = v;
    else if (k === 'value') (el as any).value = v;
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid != null) el.append(kid as any);
  return el;
}

/** 单个 UINode → DOM。 */
export function renderUINode(node: UINode, ctx: EngineCtx): HTMLElement {
  switch (node.kind) {
    case 'field': return egField(node, ctx);
    case 'cell': return egCell(node, ctx);
    case 'validations': return egValidations(node, ctx) ?? h('span', { style: 'display:none' });
    case 'panel': return egPanel(node, ctx);
    case 'collection': return egCollection(node, ctx);
    case 'group': return egGroup(node, ctx);
    // tabs：本端暂无交互式标签页，优雅降级为堆叠渲染各 tab 内容（完整 tab UI 见 React 端，四端 parity 后续）。
    case 'tabs': return h('div', { class: cx('eg-tabs') }, ...node.tabs.flatMap((t) => t.children.map((c) => renderUINode(c, ctx))));
  }
}

function egField(node: FieldUI, ctx: EngineCtx): HTMLElement {
  const v = ctx.valueOf(node.path);
  let control: HTMLElement;
  if (node.control === 'ccy') {
    // 值为空时插占位空项：让空值有匹配 option（显示"请选择"），避免回退首项造成"显示≠模型"
    control = h('select', { onchange: (e: any) => ctx.onInput(node.path, e.target.value), 'data-path': node.path },
      ...(v ? [] : [h('option', { value: '' }, '— 请选择 —')]),
      ...ctx.ccys.map((c) => h('option', { value: c }, c)));
    (control as HTMLSelectElement).value = v;   // append 后再设，确保选中项匹配（否则回退首项）
  } else if (node.control === 'adjust') {
    control = h('select', { value: v, onchange: (e: any) => ctx.onInput(node.path, e.target.value), 'data-path': node.path },
      h('option', { value: 'auto-high' }, 'auto-high（收费50%）'),
      h('option', { value: 'auto-low' }, 'auto-low（收费10%）'),
      h('option', { value: 'manual' }, 'manual（人工录入）'));
    (control as HTMLSelectElement).value = v;
  } else if (node.control === 'date') {
    control = h('input', { type: 'date', value: v, 'data-path': node.path, 'data-value': v, oninput: (e: any) => ctx.onInput(node.path, e.target.value) });
  } else {
    control = h('input', { value: v, 'data-path': node.path, 'data-value': v, oninput: (e: any) => ctx.onInput(node.path, e.target.value) });
  }
  return h('label', { class: cx('eg-field l', node.className) }, node.label, control);
}

function egCell(node: CellUI, ctx: EngineCtx): HTMLElement {
  const st = ctx.cellState(node.path);
  const txt = ctx.cellText(node.path);
  let body: HTMLElement;
  if (st === 'input') {
    body = h('input', { class: 'cond', value: ctx.valueOf(node.path), 'data-path': node.path, title: '条件可输入（守卫为假时合法录入）',
      oninput: (e: any) => ctx.onInput(node.path, e.target.value) });
  } else if (ctx.overridableFor(node.path)) {    // 实时可覆盖（随命中分支变化）
    body = h('span', { class: 'row' },
      h('input', { class: cx('ovr', st === 'overridden' && 'on'), value: txt, 'data-path': node.path, title: '可人工覆盖',
        oninput: (e: any) => ctx.onOverride(node.path, e.target.value) }),
      h('button', { type: 'button', title: '恢复计算', onclick: () => ctx.clearOverride(node.path) }, '⟲'));
  } else {
    body = h('span', { class: cx('cv', node.big && 'big', st === 'pending' && 'pend', st === 'error' && 'err'),
      'data-path': node.path, 'data-value': txt }, txt);
  }
  return h('label', { class: cx('eg-cell l', node.className) }, node.label, body);
}

function egValidations(node: ValidationsUI, ctx: EngineCtx): HTMLElement | null {
  const items = ctx.validationsFor(node.path);
  if (!items.length) return null;
  return h('div', { class: cx('eg-validations vl', node.className) },
    ...items.map((vd) => h('span', { class: cx('chip', vd.ok ? 'ok' : 'bad'), title: vd.message || '' },
      h('i', {}, vd.ok ? '✔' : '✘'), ` ${vd.id}`, !vd.ok ? h('em', {}, `：${vd.message}`) : null)));
}

function egPanel(node: PanelUI, ctx: EngineCtx): HTMLElement {
  const variant = node.variant || 'form';
  return h('div', { class: cx('eg-panel panel', 'v-' + variant, node.tone && 'tone-' + node.tone, node.className) },
    h('div', { class: 'ph' }, h('span', { class: 'ttl' }, node.label), node.badge ? h('span', { class: 'badge' }, node.badge) : null),
    h('div', { class: cx('body', node.gridClass) }, ...node.children.map((c) => renderUINode(c, ctx))));
}

function egCollection(node: CollectionUI, ctx: EngineCtx): HTMLElement {
  const rows = node.items.length === 0
    ? [h('div', { class: 'empty' }, '（暂无，点「＋ 添加」新增一条）')]
    : node.items.map((it, i) => h('div', { class: 'item' },
        h('span', { class: 'idx' }, String(i + 1)),
        h('div', { class: 'body' }, renderUINode(it.group, ctx)),
        h('button', { type: 'button', class: 'x', title: '删除', onclick: () => ctx.removeChild(it.nodePath) }, '✕')));
  return h('div', { class: cx('eg-collection coll', node.className) },
    h('div', { class: 'ch' },
      h('b', {}, node.title, ' ', h('span', { class: 'n' }, String(node.items.length))),
      h('button', { type: 'button', class: 'add', onclick: () => ctx.addChild(node.parentPath, node.collName, buildNewItem(node, ctx)) }, '＋ 添加')),
    ...rows);
}

function egGroup(node: GroupUI, ctx: EngineCtx): HTMLElement {
  return h('div', { class: cx('eg-group', node.gridClass, node.className) }, ...node.children.map((c) => renderUINode(c, ctx)));
}
