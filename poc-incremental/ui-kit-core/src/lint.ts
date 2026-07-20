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
      case 'group':                                             // 布局容器：类型上下文不变，递归子节点
        walk(n.children, type, base, meta, out);
        break;
      case 'tabs':                                              // 标签页：每个 tab 的子节点同上下文递归
        for (const tab of n.tabs) walk(tab.children, type, base, meta, out);
        break;
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

// ──────────────────────────────────────────────────────────────────────────
// RuleSet linter：校验【规则集自身】的内在一致性（与 PageDef 无关的另一维度）。
//   把"引擎运行时才会崩/静默失效"的设参错误，提前拦在编辑器设参阶段：
//   ① import/uses/slots 引用完整性（防运行时「未找到导入」崩溃）；
//   ② rule.scope/formula.target 与模型一致（target 应可写回=computed/overridable/external 注入）；
//   ③ resolver.source 已在 dataSources 声明、key 覆盖其 keySchema；
//   ④ 可选 slot（optional）与其类型校验的一致性。
//   场景与类型库都可校验（编辑器两种编辑对象都用它）。纯函数，可 Node 单测。

/** 沿 extends 链取类型祖先（含自身），base 在前。 */
function chainOf(meta: EngineMeta, type: string): string[] {
  const out: string[] = [];
  let t: string | undefined = type;
  while (t) { out.unshift(t); t = meta.nodes[t]?.extends; }
  return out;
}

/** 聚合本规则集 + 被 import 的库的顶层 rules（用于按 scope 判断某类型是否有校验）。 */
function collectRules(ruleSet: RuleSet, imports: Record<string, RuleSet>): any[] {
  const all = [...(ruleSet.rules ?? [])];
  for (const imp of ruleSet.imports ?? []) { const lib = imports[imp.ref]; if (lib?.rules) all.push(...lib.rules); }
  return all;
}

/** 聚合本规则集 + 被 import 的库的 dataSources（resolver.source 在其中查找）。 */
function collectDataSources(ruleSet: RuleSet, imports: Record<string, RuleSet>): any[] {
  const all = [...(ruleSet.dataSources ?? [])];
  for (const imp of ruleSet.imports ?? []) { const lib = imports[imp.ref]; if (lib?.dataSources) all.push(...lib.dataSources); }
  return all;
}

export function lintRuleSet(ruleSet: RuleSet, imports: Record<string, RuleSet>): LintIssue[] {
  const out: LintIssue[] = [];
  const meta = buildMeta(ruleSet, imports);
  const known = new Set(Object.keys(meta.nodes));
  const allRules = collectRules(ruleSet, imports);
  const dataSources = collectDataSources(ruleSet, imports);
  const dsById = new Map<string, any>(dataSources.map((d) => [d.sourceId, d]));

  // ① import 解析 + as 别名表（uses 前缀据此校验）。
  const asToLib = new Map<string, RuleSet>();
  for (const imp of ruleSet.imports ?? []) {
    const lib = imports[imp.ref];
    if (!lib) out.push({ level: 'error', path: `imports/${imp.ref}`, message: `import 未解析：库目录中没有 ${imp.ref}（运行时会崩「未找到导入」）` });
    else asToLib.set(imp.as, lib);
  }

  // ① slots / children 引用类型存在 + ④ 可选 slot 一致性。
  for (const [type, def] of Object.entries(ruleSet.model?.nodes ?? {}) as [string, any][]) {
    for (const [sn, sv] of Object.entries(def.slots ?? {}) as [string, any][]) {
      const nodeType = typeof sv === 'string' ? sv : sv?.node;
      const optional = typeof sv === 'object' && !!sv?.optional;
      if (!known.has(nodeType)) { out.push({ level: 'error', path: `${type}.slots.${sn}`, message: `槽位引用未知类型 ${nodeType}（可能缺 import）` }); continue; }
      if (optional) {
        const chain = new Set(chainOf(meta, nodeType));
        const hasValidation = allRules.some((r) => r.type === 'validation' && r.scope && chain.has(r.scope));
        if (!hasValidation) out.push({ level: 'warn', path: `${type}.slots.${sn}`, message: `${sn} 标为 optional，但 ${nodeType} 无任何校验规则，optional 不产生实际作用` });
        else out.push({ level: 'info', path: `${type}.slots.${sn}`, message: `${sn} 可选：为空时将自动跳过 ${nodeType} 的必填校验，填任一字段即恢复` });
      }
    }
    for (const c of (Array.isArray(def.children) ? def.children : def.children ? [def.children] : []) as any[])
      if (!known.has(c.node)) out.push({ level: 'error', path: `${type}.children.${c.name}`, message: `子集合引用未知类型 ${c.node}` });
  }

  // ② 顶层 rules：scope 有效 + formula.target 可写回 + overrides/disable 合法。
  const rulesById = new Map<string, any>(allRules.map((r) => [r.id, r]));   // 含 import 库规则（覆盖目标常在库里）
  for (const r of ruleSet.rules ?? []) checkRule(r, ruleSet, meta, known, dsById, `rules/${r.id}`, out, true, rulesById);

  // ③ 模块内 rules（含 resolver）：以模块 fields 为作用域校验 target/source/key。
  for (const [mid, mod] of Object.entries(ruleSet.modules ?? {}) as [string, any][]) {
    const mfields = new Set(Object.keys(mod.fields ?? {}));
    for (const r of mod.rules ?? []) {
      if (r.target && !mfields.has(r.target)) out.push({ level: 'error', path: `modules/${mid}/${r.id}`, message: `规则 target=${r.target} 不在模块 ${mid} 的 fields（可用：${[...mfields].join(', ') || '无'}）` });
      if (r.type === 'resolver') checkResolver(r, dsById, `modules/${mid}/${r.id}`, out);
    }
  }

  // ⑤ uses 引用完整性：前缀 as 已 import、模块存在、on 类型有效。
  for (const u of ruleSet.uses ?? []) {
    const dot = String(u.use ?? '').indexOf('.');
    const [alias, modName] = dot >= 0 ? [u.use.slice(0, dot), u.use.slice(dot + 1)] : [null, u.use];
    const lib = alias ? asToLib.get(alias) : ruleSet;
    if (alias && !lib) out.push({ level: 'error', path: `uses/${u.use}`, message: `uses 前缀 "${alias}" 未匹配任何 import 的 as 别名` });
    else if (lib && !(lib.modules ?? {})[modName]) out.push({ level: 'error', path: `uses/${u.use}`, message: `模块 ${modName} 不在${alias ? ` 库 ${alias}` : '本规则集'} 的 modules` });
    if (u.on && !known.has(u.on)) out.push({ level: 'error', path: `uses/${u.use}`, message: `uses.on 类型 ${u.on} 未知` });
  }

  return out;
}

function checkRule(r: any, _rs: RuleSet, meta: EngineMeta, known: Set<string>, dsById: Map<string, any>, path: string, out: LintIssue[], scopeRequired: boolean, byId?: Map<string, any>): void {
  if (r.scope && !known.has(r.scope)) { out.push({ level: 'error', path, message: `scope 类型 ${r.scope} 未知` }); return; }
  if (scopeRequired && !r.scope) { out.push({ level: 'warn', path, message: `规则缺少 scope` }); return; }
  // 继承覆盖：overrides 必须指向【严格祖先 scope】上真实存在的规则；disable 条只是"移除"信号，无 target/expr。
  if (r.overrides) {
    const base = byId?.get(r.overrides);
    if (!base) out.push({ level: 'error', path, message: `overrides=${r.overrides} 指向的规则不存在` });
    else {
      const anc = chainOf(meta, r.scope).slice(0, -1);          // 严格祖先（去掉自身）
      if (!base.scope || !anc.includes(base.scope)) out.push({ level: 'error', path, message: `overrides 只能覆盖继承来的规则：${r.overrides} 的 scope=${base.scope ?? '(无)'} 不是 ${r.scope} 的祖先类型` });
      else if (!r.disable && base.type !== r.type) out.push({ level: 'warn', path, message: `覆盖规则类型(${r.type})与被覆盖规则(${base.type})不一致` });
    }
  } else if (r.disable) {
    out.push({ level: 'warn', path, message: `disable:true 未指定 overrides，该规则不产生任何效果（整条停用请用 enabled:false）` });
  }
  if (r.disable) return;                                        // disable 条无 target/expr，跳过后续检查以免误报
  if (r.type === 'formula' && r.target) {
    const spec = meta.effectiveFields(r.scope)[r.target];
    if (!spec) out.push({ level: 'error', path, message: `formula.target=${r.target} 不在类型 ${r.scope} 的有效字段` });
    // computed / overridable：公式算值；external：外部输入字段，允许被宿主 formula 注入值（host formula injection，见 verify-mixpayment）。
    else if (!spec.computed && !spec.overridable && !spec.external) out.push({ level: 'error', path, message: `formula.target=${r.target} 是输入字段，公式无法写回（应为 computed / overridable / external）` });
  }
  if (r.type === 'resolver') checkResolver(r, dsById, path, out);
}

function checkResolver(r: any, dsById: Map<string, any>, path: string, out: LintIssue[]): void {
  if (!r.source) { out.push({ level: 'error', path, message: `resolver 缺少 source` }); return; }
  const ds = dsById.get(r.source);
  if (!ds) { out.push({ level: 'error', path, message: `resolver.source=${r.source} 未在 dataSources 声明` }); return; }
  const need = Object.keys(ds.keySchema ?? {});
  const have = Object.keys(r.key ?? {});
  const missing = need.filter((k) => !have.includes(k));
  if (missing.length) out.push({ level: 'warn', path, message: `resolver.key 缺少 ${ds.sourceId} 的 keySchema 键：${missing.join(', ')}` });
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
