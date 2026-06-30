// 发布期 linter：拿 RuleSet 的 model 静态校验编辑器产出的 PageDef，把"引擎认不了的页面"拦在发布前。
//   检查：① 绑定字段存在于对应节点类型（含继承）；② 控件种类匹配（computed/external 不能用输入）；
//         ③ 子集合/重定基(at) 结构合法。纯函数，可在 Node 单测，不依赖任何框架。
import { RuleSet } from './engine-types';
import { buildMeta, EngineMeta } from './engine-meta';
import { PageDef, PageNode } from './page-def';
import { lastSeg } from './engine-shared';

export interface LintIssue { level: 'error' | 'warn' | 'info'; path: string; message: string; }

export function lintPageDef(pageDef: PageDef, ruleSet: RuleSet, imports: Record<string, RuleSet>): LintIssue[] {
  const meta = buildMeta(ruleSet, imports);
  const issues: LintIssue[] = [];
  walk(pageDef.layout, meta.root, 'root', meta, issues);
  return issues;
}

const fieldName = (n: { field?: string; path?: string }): string | undefined =>
  n.field ?? (n.path ? lastSeg(n.path) : undefined);

function walk(nodes: PageNode[], type: string, base: string, meta: EngineMeta, out: LintIssue[]): void {
  for (const n of nodes) {
    switch (n.kind) {
      case 'panel': {
        let t = type, b = base;
        if (n.at) {
          const r = descend(meta, type, base, n.at);
          if (!r) { out.push({ level: 'error', path: base, message: `面板 at="${n.at}" 在类型 ${type} 上不是有效的槽位/节点路径` }); break; }
          t = r.type; b = r.base;
        }
        walk(n.children, t, b, meta, out);
        break;
      }
      case 'field':
      case 'cell': {
        const f = fieldName(n);
        if (!f) { out.push({ level: 'error', path: base, message: `${n.kind} 节点缺少 path/field` }); break; }
        const p = base + '.' + f;
        const spec = meta.effectiveFields(type)[f];
        if (!spec) {
          out.push({ level: 'error', path: p, message: `字段 ${f} 不在类型 ${type}（可用：${Object.keys(meta.effectiveFields(type)).join(', ') || '无'}）` });
          break;
        }
        if (n.kind === 'field' && (spec.computed || spec.external))
          out.push({ level: 'error', path: p, message: `${f} 是${spec.external ? '外部' : '计算'}值，必须用 cell（只读），不能用 field（输入框）` });
        if (n.kind === 'cell' && !spec.computed && !spec.external && !spec.overridable)
          out.push({ level: 'warn', path: p, message: `${f} 是普通输入字段，用 cell 会变成只读不可编辑` });
        break;
      }
      case 'collection': {
        const child = meta.childrenOf(type).find((c) => c.name === n.name);
        if (!child) {
          out.push({ level: 'error', path: base, message: `子集合 ${n.name} 不在类型 ${type}（可用：${meta.childrenOf(type).map((c) => c.name).join(', ') || '无'}）` });
          break;
        }
        walk(n.itemTemplate, child.node, `${base}.${n.name}[*]`, meta, out);
        break;
      }
      case 'validations':
        break;                                                  // 路径可选，宽松处理
    }
  }
}

/** 把 at（槽位名 / 子集合名 / 绝对节点路径）解析成 { 子类型, 新基路径 }。 */
function descend(meta: EngineMeta, type: string, base: string, at: string): { type: string; base: string } | null {
  if (at.startsWith('root')) {
    const t = typeAtNodePath(meta, at);
    return t ? { type: t, base: at } : null;
  }
  const slots = meta.effectiveSlots(type);
  if (slots[at]) return { type: slots[at], base: `${base}.${at}` };
  const child = meta.childrenOf(type).find((c) => c.name === at);
  if (child) return { type: child.node, base: `${base}.${at}[*]` };
  return null;
}

/** 沿绝对节点路径解析末端节点类型（忽略下标）。 */
function typeAtNodePath(meta: EngineMeta, path: string): string | undefined {
  let type = meta.root;
  const toks = path.split('.');
  for (let k = 1; k < toks.length; k++) {
    const name = toks[k].replace(/\[\d+\]|\[\*\]/g, '');
    const slots = meta.effectiveSlots(type);
    if (slots[name]) { type = slots[name]; continue; }
    const child = meta.childrenOf(type).find((c) => c.name === name);
    if (child) { type = child.node; continue; }
    return undefined;
  }
  return type;
}
