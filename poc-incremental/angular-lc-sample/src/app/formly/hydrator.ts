// 运行时装配器：把【可序列化 PageDef】+【活的引擎会话】装配成 formly 字段配置。
//   职责：① 把每个 PageDef 节点映射到 eg-* 绑定类型，注入 ctx + 解析出绝对 path；
//         ② 按当前 state 把集合 itemTemplate 展开成实际行（增删后重新装配）；
//         ③ 计算/外部/覆盖等"种类"从模型推导（不信任编辑器），保证绑定行为正确。
// 注意：引擎是计算与校验唯一真相源；hydrator 不做任何业务逻辑。
import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  SessionState, EngineMeta, PageDef, PageNode,
  COLL_LABEL, COLL_TEMPLATE, EngineCtx, FIELD_LABEL,
  controlOf, gridClass, lastSeg, resolveNode, specAt,
} from '@udsl/ui-kit-core';

interface H { ctx: EngineCtx; state: SessionState; meta: EngineMeta; }

/** 入口：PageDef 缺省时请用自动布局（buildRootFields）作为回退。 */
export function hydratePage(pageDef: PageDef, ctx: EngineCtx, state: SessionState, meta: EngineMeta): FormlyFieldConfig[] {
  const h: H = { ctx, state, meta };
  return pageDef.layout.map((n) => hydrateNode(n, 'root', h));
}

const cls = (a: string | undefined, b: string): string => (a ? a + ' ' + b : b);
const leafPath = (n: { path?: string; field?: string }, base: string): string =>
  n.path ?? (n.field ? base + '.' + n.field : base);
const rebase = (base: string, at: string): string => (at.startsWith('root') ? at : base + '.' + at);

function hydrateNode(n: PageNode, base: string, h: H): FormlyFieldConfig {
  switch (n.kind) {
    case 'field': {
      const path = leafPath(n, base), f = lastSeg(path);
      const fc: FormlyFieldConfig = { type: 'eg-field', props: { ctx: h.ctx, path, label: n.label ?? FIELD_LABEL[f] ?? f, control: n.control ?? controlOf(f) } };
      if (n.className) fc.className = n.className;
      return fc;
    }
    case 'cell': {
      const path = leafPath(n, base), f = lastSeg(path), spec = specAt(h.meta, h.state, path);
      const fc: FormlyFieldConfig = { type: 'eg-cell', props: { ctx: h.ctx, path, label: n.label ?? FIELD_LABEL[f] ?? f, overridable: !!spec.overridable, external: !!spec.external, big: !!n.emphasis } };
      if (n.className) fc.className = n.className;
      return fc;
    }
    case 'validations':
      return { type: 'eg-validations', className: cls(n.className, 'span-all'), props: { ctx: h.ctx, path: n.path ?? base } };
    case 'panel': {
      const childBase = n.at ? rebase(base, n.at) : base;
      const fc: FormlyFieldConfig = {
        wrappers: ['eg-panel'], props: { label: n.title, badge: n.badge, variant: n.variant, tone: n.tone },
        ...listGroup(n.children, childBase, n.grid, h),
      };
      if (n.className) fc.className = n.className;
      return fc;
    }
    case 'collection': {
      const parent = base, node = resolveNode(h.state, parent);
      const rows = node?.collections?.[n.name] ?? [];
      const fieldGroup = rows.map((_, i) => {
        const itemPath = `${parent}.${n.name}[${i}]`;
        const g = listGroup(n.itemTemplate, itemPath, n.itemGrid ?? 'row', h);
        g.props = { nodePath: itemPath };                       // 供 eg-collection 删除该行
        return g;
      });
      return {
        type: 'eg-collection',
        props: {
          ctx: h.ctx, parentPath: parent, collName: n.name, title: n.title ?? COLL_LABEL[n.name] ?? n.name,
          template: () => (n.newItem ? structuredClone(n.newItem) : (COLL_TEMPLATE[n.name]?.() ?? {})),
        },
        fieldGroup,
      };
    }
  }
}

/** 一组子节点 → 一个带栅格的 formly group；非叶子（面板/集合/校验）在栅格里跨整行。 */
function listGroup(nodes: PageNode[], base: string, grid: string | undefined, h: H): FormlyFieldConfig {
  return {
    fieldGroupClassName: grid ? gridClass(grid) : undefined,
    fieldGroup: nodes.map((n) => {
      const fc = hydrateNode(n, base, h);
      if (grid && n.kind !== 'field' && n.kind !== 'cell') fc.className = cls(fc.className, 'span-all');
      return fc;
    }),
  };
}
