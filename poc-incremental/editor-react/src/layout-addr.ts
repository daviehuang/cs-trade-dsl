import { EngineMeta } from '@udsl/ui-kit-core';

// 页面布局的"地址"与类型下钻工具（从 LayoutCanvas 抽出，供 PageCanvas / RulesetTree 复用）。
//   Addr = 到某节点的路径：数字=数组下标，字符串=子键（children / itemTemplate / tabs）。
export type Addr = (number | string)[];

// 沿绝对路径 / 槽位 / 子集合名下钻到子节点类型。
export const descendSlotOrPath = (meta: EngineMeta, type: string, at: string): string => {
  if (at.startsWith('root')) {
    let t = meta.root;
    for (const seg of at.split('.').slice(1)) {
      const name = seg.replace(/\[\d+\]|\[\*\]/g, '');
      const s = meta.effectiveSlots(t); if (s[name]) { t = s[name]; continue; }
      const c = meta.childrenOf(t).find((x) => x.name === name); if (c) { t = c.node; continue; }
      return t;
    }
    return t;
  }
  const s = meta.effectiveSlots(type); if (s[at]) return s[at];
  const c = meta.childrenOf(type).find((x) => x.name === at); return c ? c.node : type;
};

// 容器节点存放子节点的键名。tabs 特殊（子在各 tab.children 里），单列返回 null。
export const childKey = (n: any): string | null =>
  (n.kind === 'panel' || n.kind === 'group') ? 'children' : n.kind === 'collection' ? 'itemTemplate' : null;

// 容器把其子节点切到什么类型上下文：collection→元素类型；panel.at→重定基；其余不变。
export const childTypeOf = (meta: EngineMeta, type: string, n: any): string =>
  n.kind === 'collection' ? (meta.childrenOf(type).find((x) => x.name === n.name)?.node ?? type)
    : (n.kind === 'panel' && n.at) ? descendSlotOrPath(meta, type, n.at) : type;

// 定位一个 Addr 到 { 所在数组, 下标, 节点本身 }。
export function resolveAddr(layout: any[], addr: Addr): { arr: any[]; index: number; node: any } {
  let arr = layout, node: any;
  for (const seg of addr) { if (typeof seg === 'number') node = arr[seg]; else arr = node[seg] ?? (node[seg] = []); }
  return { arr, index: addr[addr.length - 1] as number, node };
}

export const labelOf = (n: any): string =>
  n.kind === 'field' || n.kind === 'cell' ? (n.field ?? n.path ?? '?')
    : n.kind === 'panel' ? (n.title ?? 'panel')
      : n.kind === 'collection' ? (n.name ?? 'collection')
        : n.kind === 'tabs' ? 'tabs'
          : n.kind === 'group' ? (n.cols ? `网格${n.cols}` : n.grid === 'row' ? '行' : n.grid === 'col' ? '列' : 'group')
            : n.kind;

// ── 拖拽载荷（规则集树 → 画布）──
export const DND_MIME = 'application/x-udsl-drag';
export type DragPayload =
  | { src: 'field'; field: string; asKind: 'field' | 'cell'; label?: string }
  | { src: 'collection'; name: string; itemTemplate: any[] }
  | { src: 'node'; at: string; label: string; fields: any[] }   // 整体拖入：panel(at) + 预填该节点字段
  | { src: 'palette'; node: any };            // 调色板：直接给一个新容器节点

export const readPayload = (e: React.DragEvent): DragPayload | null => {
  try { const s = e.dataTransfer.getData(DND_MIME); return s ? JSON.parse(s) : null; } catch { return null; }
};
export const writePayload = (e: React.DragEvent, p: DragPayload) => {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(p));
  e.dataTransfer.effectAllowed = 'copy';
};

// 载荷 → 要插入的 PageNode。
export function payloadToNode(p: DragPayload): any {
  switch (p.src) {
    case 'field': return { kind: p.asKind, field: p.field };
    case 'collection': return { kind: 'collection', name: p.name, itemGrid: 'row', itemTemplate: p.itemTemplate };
    case 'node': return { kind: 'panel', title: p.label, at: p.at, grid: 'form', children: p.fields };
    case 'palette': return JSON.parse(JSON.stringify(p.node));
  }
}
