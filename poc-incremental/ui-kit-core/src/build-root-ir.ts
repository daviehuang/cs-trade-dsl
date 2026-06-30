// 自动布局（回退生成器，中性版）：PageDef 缺省时按 model 自动产出 UINode[]。
//   等价于原 Angular buildRootFields，只是返回中性 UI-IR。
import { SessionState, ViewNode } from './engine-types';
import { EngineMeta } from './engine-meta';
import { UINode } from './ui-ir';
import { COLL_LABEL, COLL_TEMPLATE, FIELD_LABEL, ROW_TYPES, SLOT_LABEL, controlOf, gridClass, toneOf } from './engine-shared';

/** 一个节点的叶子字段（可编辑 → field；计算/外部值 → cell）。 */
function leafFieldsIR(node: ViewNode, meta: EngineMeta, only?: string[]): UINode[] {
  const specs = meta.effectiveFields(node.type);
  const names = (only ?? Object.keys(node.fields)).filter((f) => f in node.fields);
  return names.map((f): UINode => {
    const s = specs[f] ?? {};
    const path = node.path + '.' + f, label = FIELD_LABEL[f] ?? f;
    if (s.computed || s.external)
      return { kind: 'cell', path, label, overridable: !!s.overridable, external: !!s.external, big: f === 'net' };
    return { kind: 'field', path, label, control: controlOf(f) };
  });
}

const collectionIR = (node: ViewNode, coll: string, meta: EngineMeta): UINode => ({
  kind: 'collection', parentPath: node.path, collName: coll, title: COLL_LABEL[coll] ?? coll,
  newItemTemplate: () => (COLL_TEMPLATE[coll]?.() ?? {}),
  items: (node.collections[coll] ?? []).map((c, i) => ({ nodePath: `${node.path}.${coll}[${i}]`, group: buildNodeGroupIR(c, meta) })),
});

/** 递归把一个节点构建为 group（叶子块 + 校验 + 槽位卡片 + 子集合）。 */
export function buildNodeGroupIR(node: ViewNode, meta: EngineMeta): UINode {
  const children: UINode[] = [];
  const leaves = leafFieldsIR(node, meta);
  if (leaves.length) children.push({ kind: 'group', gridClass: gridClass(ROW_TYPES.has(node.type) ? 'row' : 'col'), children: leaves });
  children.push({ kind: 'validations', path: node.path, className: 'span-all' });
  for (const [name, child] of Object.entries(node.slots ?? {}))
    children.push({
      kind: 'panel', label: SLOT_LABEL[name] ?? name, badge: child.type, variant: 'party', tone: toneOf(child.type),
      children: [buildNodeGroupIR(child, meta)], className: 'span-all',
    });
  for (const coll of Object.keys(node.collections ?? {}))
    children.push({ ...collectionIR(node, coll, meta), className: 'span-all' });
  return { kind: 'group', children };
}

/** 顶层：把根记录分区到 5 个面板（主记录 / 当事方 / 收费 / 付费 / 结算）。 */
export function buildRootIR(state: SessionState, meta: EngineMeta): UINode[] {
  const root = state.tree;
  const isComputed = (f: string) => { const s = meta.effectiveFields(root.type)[f] ?? {}; return !!(s.computed || s.external); };
  const scalarRoot = Object.keys(root.fields).filter((f) => !isComputed(f));
  const computedRoot = Object.keys(root.fields).filter(isComputed);

  return [
    { kind: 'panel', label: '信用证主记录', variant: 'form', gridClass: gridClass('form'), children: leafFieldsIR(root, meta, scalarRoot) },
    {
      kind: 'panel', label: '当事方 Parties', badge: '具名槽位 · 继承自 Party · 校验按子类型分发', variant: 'cards', gridClass: gridClass('cards'),
      children: Object.entries(root.slots ?? {}).map(([name, child]): UINode => ({
        kind: 'panel', label: SLOT_LABEL[name] ?? name, badge: child.type, variant: 'party', tone: toneOf(child.type),
        children: [
          { kind: 'group', gridClass: gridClass('col'), children: leafFieldsIR(child, meta) },
          { kind: 'validations', path: child.path, className: 'span-all' },
        ],
      })),
    },
    { kind: 'panel', label: '收费 Charges', badge: '组 → 明细 · 汇率由 fxConvert 模块异步注入', variant: 'flow', children: [collectionIR(root, 'charges', meta)] },
    { kind: 'panel', label: '付费 Payments', variant: 'flow', children: [collectionIR(root, 'payments', meta)] },
    {
      kind: 'panel', label: '结算 & 校验', badge: '计算值只读 · 引擎增量算出', variant: 'stats',
      children: [
        { kind: 'group', gridClass: gridClass('row'), children: leafFieldsIR(root, meta, computedRoot) },
        { kind: 'validations', path: 'root', className: 'span-all' },
      ],
    },
  ];
}
