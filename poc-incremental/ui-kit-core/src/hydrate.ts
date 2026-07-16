// 运行时装配器（中性版）：把【可序列化 PageDef】+【活的引擎 state】装配成中性 UI-IR。
//   职责：① 解析每个节点的绝对 path；② 按当前 state 把集合 itemTemplate 展开成实际行；
//         ③ 计算/外部/覆盖等"种类"从模型推导（不信任编辑器）。
//   不做任何业务逻辑；引擎是计算与校验唯一真相源。框架适配器拿 UINode[] 直接渲染。
import { SessionState } from './engine-types';
import { EngineMeta } from './engine-meta';
import { PageDef, PageNode } from './page-def';
import { UINode } from './ui-ir';
import { COLL_LABEL, COLL_TEMPLATE, FIELD_LABEL, controlOf, gridClass, lastSeg, resolveNode, specAt } from './engine-shared';

interface H { state: SessionState; meta: EngineMeta; }

export function hydratePage(pageDef: PageDef, state: SessionState, meta: EngineMeta): UINode[] {
  const h: H = { state, meta };
  return pageDef.layout.map((n) => hydrateNode(n, 'root', h));
}

const cls = (a: string | undefined, b: string): string => (a ? a + ' ' + b : b);
const leafPath = (n: { path?: string; field?: string }, base: string): string =>
  n.path ?? (n.field ? base + '.' + n.field : base);
const rebase = (base: string, at: string): string => (at.startsWith('root') ? at : base + '.' + at);

/** 栅格里的非叶子（面板/集合/校验）跨整行。 */
function withSpan(node: UINode, grid: string | undefined, srcKind: PageNode['kind']): UINode {
  if (grid && srcKind !== 'field' && srcKind !== 'cell') node.className = cls(node.className, 'span-all');
  return node;
}

function hydrateNode(n: PageNode, base: string, h: H): UINode {
  switch (n.kind) {
    case 'field': {
      const path = leafPath(n, base), f = lastSeg(path), spec = specAt(h.meta, h.state, path);
      return { kind: 'field', path, label: n.label ?? spec.label ?? FIELD_LABEL[f] ?? f, control: n.control ?? controlOf(f), className: n.className };
    }
    case 'cell': {
      const path = leafPath(n, base), f = lastSeg(path), spec = specAt(h.meta, h.state, path);
      return { kind: 'cell', path, label: n.label ?? spec.label ?? FIELD_LABEL[f] ?? f, overridable: !!spec.overridable, external: !!spec.external, big: !!n.emphasis, className: n.className };
    }
    case 'validations':
      return { kind: 'validations', path: n.path ?? base, className: cls(n.className, 'span-all') };
    case 'panel': {
      const childBase = n.at ? rebase(base, n.at) : base;
      return {
        kind: 'panel', label: n.title, badge: n.badge, variant: n.variant, tone: n.tone,
        gridClass: n.grid ? gridClass(n.grid) : undefined,
        children: n.children.map((c) => withSpan(hydrateNode(c, childBase, h), n.grid, c.kind)),
        className: n.className,
      };
    }
    case 'group': {
      const gcls = n.cols ? undefined : (n.grid ? gridClass(n.grid) : undefined);
      return { kind: 'group', gridClass: gcls, cols: n.cols, className: n.className,
        children: n.children.map((c) => withSpan(hydrateNode(c, base, h), n.grid, c.kind)) };
    }
    case 'tabs':
      return { kind: 'tabs', className: n.className,
        tabs: n.tabs.map((t) => ({ label: t.label, children: t.children.map((c) => hydrateNode(c, base, h)) })) };
    case 'collection': {
      const parent = base, node = resolveNode(h.state, parent);
      const rows = node?.collections?.[n.name] ?? [];
      // 用每行携带的真实 path（引擎已跳过墓碑，删后再增时原始下标不连续，如 goodsInfo[2]）；
      //   不能按可见位置 i 重拼 goodsInfo[i]，否则会指到已删除的墓碑 cell → setInput「not an input」。
      const items = rows.map((row: any, i: number) => {
        const itemPath = row?.path ?? `${parent}.${n.name}[${i}]`;
        return { nodePath: itemPath, group: hydrateGroup(n.itemTemplate, itemPath, n.itemGrid ?? 'row', h) };
      });
      const layout = n.layout === 'table' ? 'table' : undefined;
      const itemType = node ? (h.meta.childrenOf(node.type).find((c) => c.name === n.name)?.node ?? node.type) : undefined;
      const columns = layout && itemType ? tableColumns(n.itemTemplate, itemType, h.meta) : undefined;
      return {
        kind: 'collection', parentPath: parent, collName: n.name, title: n.title ?? COLL_LABEL[n.name] ?? n.name,
        layout, columns,
        newItemTemplate: () => (n.newItem ? structuredClone(n.newItem) : (COLL_TEMPLATE[n.name]?.() ?? {})),
        items, className: n.className,
      };
    }
  }
}

// 表格列：从 itemTemplate 递归抽取 field/cell 叶子（label 走 field.label/FIELD_LABEL，kind 由 spec 强制）。
function tableColumns(itemTemplate: PageNode[], itemType: string, meta: EngineMeta) {
  const specs = meta.effectiveFields(itemType);
  const cols: { field?: string; label: string; kind: 'field' | 'cell'; control?: string }[] = [];
  const walk = (nodes: PageNode[]) => {
    for (const n of nodes as any[]) {
      if (n.kind === 'field' || n.kind === 'cell') {
        const f = n.field ?? lastSeg(n.path ?? '');
        const s: any = specs[f] ?? {};
        cols.push({ field: f, label: n.label ?? s.label ?? FIELD_LABEL[f] ?? f, kind: (s.computed || s.external) ? 'cell' : 'field', control: n.control ?? controlOf(f) });
      } else if (Array.isArray(n.children)) walk(n.children);
    }
  };
  walk(itemTemplate);
  return cols;
}

function hydrateGroup(nodes: PageNode[], base: string, grid: string | undefined, h: H): UINode {
  return {
    kind: 'group', gridClass: grid ? gridClass(grid) : undefined,
    children: nodes.map((c) => withSpan(hydrateNode(c, base, h), grid, c.kind)),
  };
}
