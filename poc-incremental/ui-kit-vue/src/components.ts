// Vue 渲染 kit：UINode → Vue VNode，一一镜像 React/HTML kit 的 eg-* 结构与 class。
//   受控输入 = 引擎是真相源：value 读 ctx.valueOf(path)，事件写 ctx.onInput；不在组件里存值。
//   UiRenderer 内部订阅 ctx.onTick → 自身重渲染（异步 resolver 完成时无 DOM 事件，须主动驱动）。
//   复用与 React/Angular/HTML 同名的 CSS class（宿主引入共享 styles.css），四端视觉一致。
import { defineComponent, h, onMounted, onUnmounted, ref, VNode } from 'vue';
import {
  CellUI, CollectionUI, EngineCtx, FieldUI, GroupUI, PanelUI, UINode, ValidationsUI, buildNewItem,
} from '@udsl/ui-kit-core';

const cx = (...xs: (string | undefined | false)[]) => xs.filter(Boolean).join(' ');

/** 单个 UINode → VNode。 */
export function renderNode(node: UINode, ctx: EngineCtx): VNode {
  switch (node.kind) {
    case 'field': return egField(node, ctx);
    case 'cell': return egCell(node, ctx);
    case 'validations': return egValidations(node, ctx);
    case 'panel': return egPanel(node, ctx);
    case 'collection': return egCollection(node, ctx);
    case 'group': return egGroup(node, ctx);
    // tabs：本端暂无交互式标签页，优雅降级为堆叠渲染各 tab 内容（不丢内容；完整 tab UI 见 React 端，四端 parity 后续）。
    case 'tabs': return h('div', { class: cx('eg-tabs', node.className) }, node.tabs.flatMap((t) => t.children.map((c) => renderNode(c, ctx))));
  }
}

function egField(node: FieldUI, ctx: EngineCtx): VNode {
  const v = ctx.valueOf(node.path);
  const set = (e: Event) => ctx.onInput(node.path, (e.target as HTMLInputElement).value);
  let control: VNode;
  if (node.control === 'ccy')
    // 值为空时插占位空项：避免 select 无匹配值时"显示第一项、模型却是空"的错位
    control = h('select', { value: v, onChange: set, 'data-path': node.path },
      [...(v ? [] : [h('option', { value: '', selected: true }, '— 请选择 —')]),
       ...ctx.ccys.map((c) => h('option', { value: c, selected: c === v }, c))]);
  else if (node.control === 'adjust')
    control = h('select', { value: v, onChange: set, 'data-path': node.path }, [
      h('option', { value: 'auto-high', selected: v === 'auto-high' }, 'auto-high（收费50%）'),
      h('option', { value: 'auto-low', selected: v === 'auto-low' }, 'auto-low（收费10%）'),
      h('option', { value: 'manual', selected: v === 'manual' }, 'manual（人工录入）'),
    ]);
  else
    control = h('input', { value: v, 'data-path': node.path, 'data-value': v, onInput: set });
  return h('label', { class: cx('eg-field l', node.className) }, [node.label, control]);
}

function egCell(node: CellUI, ctx: EngineCtx): VNode {
  const st = ctx.cellState(node.path);
  const txt = ctx.cellText(node.path);
  let body: VNode;
  if (st === 'input')
    body = h('input', { class: 'cond', value: ctx.valueOf(node.path), 'data-path': node.path, title: '条件可输入（守卫为假时合法录入）',
      onInput: (e: Event) => ctx.onInput(node.path, (e.target as HTMLInputElement).value) });
  else if (ctx.overridableFor(node.path))    // 实时可覆盖（随命中分支变化）
    body = h('span', { class: 'row' }, [
      h('input', { class: cx('ovr', st === 'overridden' && 'on'), value: txt, 'data-path': node.path, title: '可人工覆盖',
        onInput: (e: Event) => ctx.onOverride(node.path, (e.target as HTMLInputElement).value) }),
      h('button', { type: 'button', title: '恢复计算', onClick: () => ctx.clearOverride(node.path) }, '⟲'),
    ]);
  else
    body = h('span', { class: cx('cv', node.big && 'big', st === 'pending' && 'pend', st === 'error' && 'err'),
      'data-path': node.path, 'data-value': txt }, txt);
  return h('label', { class: cx('eg-cell l', node.className) }, [node.label, body]);
}

function egValidations(node: ValidationsUI, ctx: EngineCtx): VNode {
  const items = ctx.validationsFor(node.path);
  if (!items.length) return h('span', { style: 'display:none' });
  return h('div', { class: cx('eg-validations vl', node.className) },
    items.map((vd) => h('span', { key: vd.id + vd.node, class: cx('chip', vd.ok ? 'ok' : 'bad'), title: vd.message || '' },
      [h('i', vd.ok ? '✔' : '✘'), ` ${vd.id}`, !vd.ok ? h('em', `：${vd.message}`) : null])));
}

function egPanel(node: PanelUI, ctx: EngineCtx): VNode {
  const variant = node.variant || 'form';
  return h('div', { class: cx('eg-panel panel', 'v-' + variant, node.tone && 'tone-' + node.tone, node.className) }, [
    h('div', { class: 'ph' }, [h('span', { class: 'ttl' }, node.label), node.badge ? h('span', { class: 'badge' }, node.badge) : null]),
    h('div', { class: cx('body', node.gridClass) }, node.children.map((c) => renderNode(c, ctx))),
  ]);
}

function egCollection(node: CollectionUI, ctx: EngineCtx): VNode {
  const rows = node.items.length === 0
    ? [h('div', { class: 'empty' }, '（暂无，点「＋ 添加」新增一条）')]
    : node.items.map((it, i) => h('div', { class: 'item', key: it.nodePath }, [
        h('span', { class: 'idx' }, String(i + 1)),
        h('div', { class: 'body' }, [renderNode(it.group, ctx)]),
        h('button', { type: 'button', class: 'x', title: '删除', onClick: () => ctx.removeChild(it.nodePath) }, '✕'),
      ]));
  return h('div', { class: cx('eg-collection coll', node.className) }, [
    h('div', { class: 'ch' }, [
      h('b', [node.title, ' ', h('span', { class: 'n' }, String(node.items.length))]),
      h('button', { type: 'button', class: 'add', onClick: () => ctx.addChild(node.parentPath, node.collName, buildNewItem(node, ctx)) }, '＋ 添加'),
    ]),
    ...rows,
  ]);
}

function egGroup(node: GroupUI, ctx: EngineCtx): VNode {
  return h('div', { class: cx('eg-group', node.gridClass, node.className) }, node.children.map((c) => renderNode(c, ctx)));
}

/** 顶层渲染入口：UINode[] → Vue 组件。内部订阅 onTick，值刷新时自身重渲染。 */
export const UiRenderer = defineComponent({
  name: 'UiRenderer',
  props: { ir: { type: Array as () => UINode[], required: true }, ctx: { type: Object as () => EngineCtx, required: true } },
  setup(props) {
    const tick = ref(0);
    let un: (() => void) | undefined;
    onMounted(() => { un = props.ctx.onTick(() => { tick.value++; }); });
    onUnmounted(() => un?.());
    return () => { void tick.value; return props.ir.map((n) => renderNode(n, props.ctx)); };
  },
});
