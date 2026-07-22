// 增量依赖图引擎（ADR-8）+ 异步 resolver 层（ADR-7）—— 任意深度嵌套 + 多分支子集合。
// 反应式内核（依赖追踪/脏传播/异步结算/pending 传播）与树形状无关；
// 本版把"实例化层"改为递归：任意深度节点注册表 + 按类型索引 + 真实父子链 + 路径游走。
//
// 模型支持每个节点多个子集合：children 可为 {name,node} 或 [{name,node},...]。
// 表达式按集合名聚合：sum(items.base)、sum(charges.subtotal)（kernel.evalPath 已支持）。
import { Decimal, evaluate, fmt } from "./kernel.js";

const PENDING = Symbol("PENDING");

export function createSession(ruleSet, data, opts = {}) {
  const resolveFn = opts.resolve;
  const onUpdate = opts.onUpdate || (() => {});
  const onLog = opts.onLog || (() => {});

  const model = ruleSet.model;
  const rootType = model.root;

  // ── 跨 RuleSet 导入：类型库（共享节点类型 + 规则 + uses + context，扁平命名空间）
  //    与模块库（modules，按 as 别名）。生产中由 Rule Bundle API 按 ref 拉取并缓存。
  const importRegistry = opts.imports || {};
  const importedNodes = {}, importedRules = [], importedUses = [], importedModules = {}, importedModulesFlat = {};
  let importedContext = {};
  for (const imp of (ruleSet.imports || [])) {
    const lib = importRegistry[imp.ref];
    if (!lib) throw new Error("未找到导入(ref): " + imp.ref);
    Object.assign(importedNodes, lib.nodes || {});        // 共享节点类型（Party / BankParty…）
    if (lib.rules) importedRules.push(...lib.rules);       // 类型自带的通用校验随类型一起来
    if (lib.uses) importedUses.push(...lib.uses);          // 库可声明模块挂载（引用其自身模块，裸名）
    Object.assign(importedContext, lib.context || {});
    Object.assign(importedModulesFlat, lib.modules || {}); // 库内模块扁平表：供库自身 uses 的裸名解析
    if (imp.as) importedModules[imp.as] = lib.modules || {};  // 模块库（按别名，供显式跨库引用 fx.fxConvert）
  }
  // 有效模型/规则 = 导入 + 本地（本地同名覆盖导入；冲突治理见 lint TODO）
  const mergedNodes = { ...importedNodes, ...model.nodes };
  const allRules = [...importedRules, ...(ruleSet.rules || [])];
  const allUses = [...importedUses, ...(ruleSet.uses || [])];
  const mergedContext = { ...importedContext, ...(ruleSet.context || {}) };
  const mergedLocalModules = { ...importedModulesFlat, ...(ruleSet.modules || {}) }; // 裸名解析：本地 + 各库扁平

  const cells = new Map();
  const dirty = new Set();
  let CURRENT = null;
  let outstanding = 0;
  let idleWaiters = [];

  const disp = (v) => (v == null ? null : v instanceof Decimal ? fmt(v) : v);
  const eq = (a, b) => disp(a) === disp(b) && typeof a === typeof b;
  const ser = (o) => JSON.stringify(o, (_, v) => (v instanceof Decimal ? fmt(v) : v));

  // ── 类型系统：继承(extends) + 抽象(abstract) + 具名槽位(slots) ──
  function nodeDef(type) { const d = mergedNodes[type]; if (!d) throw new Error("未知节点类型: " + type); return d; }
  function typeChain(type) { const ch = []; let t = type; while (t) { ch.unshift(t); t = nodeDef(t).extends; } return ch; } // [基类…自身]
  function isA(type, ancestor) { let t = type; while (t) { if (t === ancestor) return true; t = nodeDef(t).extends; } return false; }
  // 沿继承链合并字段（子类可覆盖基类同名字段）
  function effectiveFields(type) { const o = {}; for (const t of typeChain(type)) Object.assign(o, nodeDef(t).fields || {}); return o; }
  // 字段的人类可读标签（用于报错 {字段:label} 引用）；取不到返回 undefined
  function fieldLabel(type, field) { try { return (effectiveFields(type)[field] || {}).label; } catch { return undefined; } }
  // 节点的子集合声明（兼容单对象与数组），沿链合并
  const normColls = (c) => (!c ? [] : Array.isArray(c) ? c : [c]);
  // 同名子集合：子类覆盖基类（node 替换，保持首次出现的位置），与 fields/slots 的覆盖语义一致
  function childCollections(type) {
    const idx = new Map(), out = [];
    for (const t of typeChain(type)) for (const c of normColls(nodeDef(t).children)) {
      if (idx.has(c.name)) out[idx.get(c.name)] = c;
      else { idx.set(c.name, out.length); out.push(c); }
    }
    return out;
  }
  // 具名单节点 slots：{ 槽位名: 子类型 | {node, optional} }，沿链合并；归一化为 { node, optional }
  function effectiveSlots(type) {
    const o = {}; for (const t of typeChain(type)) Object.assign(o, nodeDef(t).slots || {});
    const out = {};
    for (const [name, v] of Object.entries(o)) out[name] = typeof v === "string" ? { node: v, optional: false } : { node: v.node, optional: !!v.optional };
    return out;
  }
  // 可选对象"存在(在用)"守卫表达式：任一输入字段有值（字符串 len>0，其余 != null）。空→null（无输入字段）
  function activeGuardExpr(type) {
    const terms = [];
    for (const [f, spec] of Object.entries(effectiveFields(type))) {
      if (spec.computed || spec.external) continue;
      terms.push(spec.type === "string" ? `len(${f}) > 0` : `${f} != null`);
    }
    return terms.length ? terms.join(" || ") : null;
  }

  // ── 递归节点注册表 ──
  const nodes = new Map();          // path -> { path, type, parentPath, data }
  const typeIndex = new Map();      // type -> [path,...]
  function register(path, type, parentPath, d) {
    nodes.set(path, { path, type, parentPath, data: d });
    (typeIndex.get(type) || typeIndex.set(type, []).get(type)).push(path);
  }
  function buildTree(path, type, parentPath, d) {
    if (nodeDef(type).abstract) throw new Error(`抽象类型 ${type} 不能实例化（请用其子类型）: ${path}`);
    register(path, type, parentPath, d);
    for (const coll of childCollections(type)) {
      const arr = d[coll.name] || [];
      arr.forEach((cd, i) => buildTree(`${path}.${coll.name}[${i}]`, coll.node, path, cd));
    }
    for (const [slotName, slotDef] of Object.entries(effectiveSlots(type))) {   // 具名单节点：data[slotName] 为对象
      const childPath = `${path}.${slotName}`;
      buildTree(childPath, slotDef.node, path, (d && d[slotName]) || {});
      if (slotDef.optional) nodes.get(childPath).optionalSlot = true;           // 可选 slot：空时抑制其校验
    }
  }
  buildTree("root", rootType, null, data);

  // ── 依赖追踪读取 ──
  function readCell(id) {
    const c = cells.get(id);
    if (!c) return null;
    if (CURRENT && id !== CURRENT.id) { CURRENT.deps.add(id); c.dependents.add(CURRENT.id); }
    if (c.state === "pending") throw PENDING;
    if (c.state === "error") return null;
    return c.value;
  }

  // ── 环境上下文 ctx（跨切面头部数据，位置无关，只读）──
  const ctxProxy = new Proxy({}, { get(_, key) { return typeof key === "string" ? readCell("__ctx." + key) : undefined; } });

  // ── 节点 Proxy（字段读取 → readCell；子集合名 → 子 proxy 向量）──
  const proxies = new Map();
  function proxyOf(path) {
    if (proxies.has(path)) return proxies.get(path);
    const node = nodes.get(path);
    const colls = childCollections(node.type);
    const collNames = new Set(colls.map((c) => c.name));
    const slotNames = new Set(Object.keys(effectiveSlots(node.type)));
    const p = new Proxy({}, {
      get(_, prop) {
        if (prop === "ctx") return ctxProxy;               // 头部数据，位置无关
        if (prop === "__children") return colls[0] ? childProxies(path, colls[0]) : undefined;
        if (typeof prop !== "string") return undefined;
        if (slotNames.has(prop)) return proxyOf(`${path}.${prop}`);  // 具名单节点 → 单个子 proxy（applicant.name）
        if (collNames.has(prop)) return childProxies(path, colls.find((c) => c.name === prop));
        return readCell(path + "." + prop);
      },
    });
    proxies.set(path, p);
    return p;
  }
  function childProxies(path, coll) {
    const arr = nodes.get(path).data[coll.name] || [];
    const out = [];
    arr.forEach((d, i) => { if (d != null) out.push(proxyOf(`${path}.${coll.name}[${i}]`)); }); // 跳过墓碑
    return out;
  }
  function ctxFor(path) {
    const node = nodes.get(path);
    return { self: proxyOf(path), parent: node.parentPath ? proxyOf(node.parentPath) : null, root: proxyOf("root") };
  }

  // ── 模块命名空间 proxy / ctx：模块内部规则对"抽象名"求值（self=模块实例，字段在 <ns>.* 下）──
  function moduleProxy(ns) {
    return new Proxy({}, { get(_, prop) {
      if (prop === "ctx") return ctxProxy;
      if (typeof prop !== "string") return undefined;
      return readCell(ns + "." + prop);
    } });
  }
  function moduleCtx(ns, hostPath) {
    const node = nodes.get(hostPath);
    return { self: moduleProxy(ns), parent: node && node.parentPath ? proxyOf(node.parentPath) : null, root: proxyOf("root") };
  }

  // ── 建 cells ──
  const coerce = (type, v) =>
    v === undefined || v === null || v === "" ? (type === "string" ? "" : null)
      : type === "decimal" || type === "int" ? new Decimal(String(v)) : v;
  function addInputCell(path, field, type, raw) {
    cells.set(path + "." + field, { id: path + "." + field, kind: "input", nodePath: path, type, state: "resolved", value: coerce(type, raw), deps: new Set(), dependents: new Set() });
  }
  // 规则按 scope 类型分组（建子树 cell 时复用）；allRules = 导入类型库规则 + 本地规则
  const rulesByScope = new Map();
  for (const rule of allRules) {
    if (rule.enabled === false) continue;
    const sc = rule.scope || rootType;
    if (!rulesByScope.has(sc)) rulesByScope.set(sc, []);
    rulesByScope.get(sc).push(rule);
  }
  function makeRuleCell(rule, path) {
    const base = { nodePath: path, deps: new Set(), dependents: new Set(), state: "stale", value: null };
    const ntype = nodes.get(path).type;
    if (rule.type === "formula") {
      const id = path + "." + rule.target;
      const spec = effectiveFields(ntype)[rule.target] || {};
      // 归一化为 cases 列表：cases 多分支 / 单 when / 无条件，统一成 [{whenExpr, compute}]
      const rawCases = rule.cases || (rule.when ? [{ when: rule.when, expr: rule.expr }] : [{ when: null, expr: rule.expr }]);
      // 每条 case 带 overridable：命中此分支时该字段是否允许人工覆盖（分支级；未标则退化到字段级）。
      const cases = rawCases.map((cs) => ({ whenExpr: cs.when || null, expr: cs.expr, overridable: cs.overridable, compute: () => evaluate(cs.expr, ctxFor(path)).value }));
      cells.set(id, { ...base, id, kind: "computed", type: spec.type, overridable: !!spec.overridable,
        cases, fallback: rule.fallback || null,                                   // 所有 when 都不匹配 → fallback
        manual: rule.fallback === "input" ? nodes.get(path).data[rule.target] : undefined });
    } else if (rule.type === "pipeline") {
      const id = path + "." + rule.target;
      const spec = effectiveFields(ntype)[rule.target] || {};
      cells.set(id, { ...base, id, kind: "computed", type: spec.type, overridable: !!spec.overridable, steps: rule.steps, compute: () => {
        let v = null; const c = ctxFor(path);
        for (const s of rule.steps) if (s.expr) v = evaluate(s.expr, { ...c, value: v }).value;
        return v;
      } });
    } else if (rule.type === "resolver") {
      const id = path + "." + rule.target;
      // pick：数据源返回多字段对象时，本 resolver 取其中一项（res.values[pick]）。缺省=返回值即标量（向后兼容）。
      cells.set(id, { ...base, id, kind: "resolver", source: rule.source, key: rule.key, pick: rule.pick ?? null, lastKey: null, pinned: null });
    } else if (rule.type === "validation") {
      const id = path + ".__val_" + rule.id;
      // 该节点占据可选 slot（optionalSlot）时，包一层"存在才校验"守卫：全空则通过（跳过），填了任一字段则照常校验。
      let expr = rule.expr;
      if (nodes.get(path).optionalSlot) { const g = activeGuardExpr(ntype); if (g) expr = `!(${g}) || (${rule.expr})`; }
      cells.set(id, { ...base, id, kind: "validation", ruleId: rule.id, scope: rule.scope || rootType, expr, message: rule.message || "", severity: rule.severity || "error" });
    }
  }
  // 为一个节点建 input + 规则 cells（初次与动态增子时复用）
  // 规则按继承链收集：scope 命中自身或任一祖先类型（Party 规则作用到 BankParty/CustomerParty）
  // 子类可用 { overrides: 基类ruleId } 替换继承来的规则，或 { overrides: id, disable: true } 停用它。
  // 过滤只发生在「以子类实例化」的节点上 → 基类实例不受影响（per-subtype 隔离）。
  function rulesForType(type) {
    const out = [];
    for (const t of typeChain(type)) out.push(...(rulesByScope.get(t) || []));
    const removed = new Set();
    for (const r of out) if (r.overrides) removed.add(r.overrides);
    return out.filter((r) => !removed.has(r.id) && r.disable !== true);   // disable 条只承载"移除"信号，自身不建 cell
  }
  function buildNodeCells(path, type) {
    for (const [f, spec] of Object.entries(effectiveFields(type))) {   // 含继承字段
      if (spec.computed || spec.external) continue;
      addInputCell(path, f, spec.type, nodes.get(path).data[f]);
    }
    for (const rule of rulesForType(type)) makeRuleCell(rule, path);   // 含基类作用域规则
  }
  for (const node of nodes.values()) buildNodeCells(node.path, node.type);

  // ── 环境上下文 cells：context 映射在 root 作用域求值（如 baseCcy ← root.baseCcy）──
  for (const [key, expr] of Object.entries(mergedContext)) {
    const id = "__ctx." + key;
    cells.set(id, { id, kind: "computed", nodePath: "__ctx", deps: new Set(), dependents: new Set(), state: "stale", value: null,
      cases: [{ whenExpr: null, compute: () => evaluate(expr, ctxFor("root")).value }], fallback: null });
  }

  // ── 跨 RuleSet 模块库解析（importedModules / importRegistry 已在顶部按 ref 解析）──
  function resolveModule(ref) {
    if (ref.includes(".")) {                   // 导入模块：alias.moduleId
      const [alias, modId] = ref.split(".");
      const ns = importedModules[alias];
      if (!ns || !ns[modId]) throw new Error("未找到导入模块: " + ref);
      return ns[modId];
    }
    const local = mergedLocalModules[ref]; // 本地模块 + 各库扁平（库自身 uses 的裸名）
    if (!local) throw new Error("未找到模块: " + ref);
    return local;
  }

  // ── 模块实例化：use 模块 on 某 scope，把抽象 inputs 绑到 host 字段，produce 写回 host ──
  function instantiateUseOnHost(use, hostPath) {
    const mod = resolveModule(use.use);
    const alias = use.as || use.use.split(".").pop();
    const ns = `${hostPath}.${alias}`;
    const mctx = () => moduleCtx(ns, hostPath);
      // 1) 输入端口：alias.<input> = bind 表达式（在 host 作用域求值）
      for (const inp of Object.keys(mod.inputs || {})) {
        const expr = use.bind[inp];
        cells.set(`${ns}.${inp}`, { id: `${ns}.${inp}`, kind: "computed", nodePath: ns, type: mod.inputs[inp],
          deps: new Set(), dependents: new Set(), state: "stale", value: null,
          cases: [{ whenExpr: null, expr, compute: () => evaluate(expr, ctxFor(hostPath)).value }], fallback: null });
      }
      // 2) 模块内部规则：在模块命名空间求值（self=模块实例；只见 inputs/局部/ctx）
      for (const r of (mod.rules || [])) {
        const id = `${ns}.${r.target}`;
        const ftype = (mod.fields[r.target] || {}).type;
        if (r.type === "formula")
          cells.set(id, { id, kind: "computed", nodePath: ns, type: ftype, deps: new Set(), dependents: new Set(), state: "stale", value: null,
            cases: [{ whenExpr: null, expr: r.expr, compute: () => evaluate(r.expr, mctx()).value }], fallback: null });
        else if (r.type === "resolver")
          cells.set(id, { id, kind: "resolver", nodePath: ns, source: r.source, key: r.key, pick: r.pick ?? null, lastKey: null, pinned: null,
            deps: new Set(), dependents: new Set(), state: "stale", value: null, getCtx: mctx });
        else if (r.type === "validation")    // 模块内校验：在模块上下文求值，上浮到 getState().validations（带 host 节点）
          cells.set(`${ns}.__val_${r.id}`, { id: `${ns}.__val_${r.id}`, kind: "validation", nodePath: ns, hostNode: hostPath,
            ruleId: `${alias}.${r.id}`, scope: use.on, expr: r.expr, message: r.message || "", severity: r.severity || "error",
            deps: new Set(), dependents: new Set(), state: "stale", value: null, getCtx: mctx });
      }
      // 3) produce：host 字段 = 模块输出（继承 model 的 overridable，使覆盖/条件等沿用）
      for (const [out, hostField] of Object.entries(use.produce || {})) {
        const id = `${hostPath}.${hostField}`;
        const fspec = effectiveFields(nodes.get(hostPath).type)[hostField] || {};
        cells.set(id, { id, kind: "computed", nodePath: hostPath, type: fspec.type, overridable: !!fspec.overridable,
          deps: new Set(), dependents: new Set(), state: "stale", value: null,
          cases: [{ whenExpr: null, expr: out, compute: () => evaluate(out, mctx()).value }], fallback: null });
      }
  }
  // use.on 可为基类：命中所有 is-a 该类型的具体节点（含子类型）
  function hostsFor(onType) {
    const out = [];
    for (const [t, paths] of typeIndex) if (isA(t, onType)) out.push(...paths);
    return out;
  }
  function instantiateUse(use) {
    for (const hostPath of hostsFor(use.on)) instantiateUseOnHost(use, hostPath);
  }
  // 为单个新节点实例化其类型（含继承）匹配的全部 use 模块（动态增子时复用同一套初始化逻辑）
  function instantiateUsesForNode(path) {
    const type = nodes.get(path).type;
    for (const use of allUses) if (isA(type, use.on)) instantiateUseOnHost(use, path);
  }
  for (const use of allUses) instantiateUse(use);

  // ── 重算单个 cell ──
  function recompute(cell) {
    for (const d of cell.deps) cells.get(d)?.dependents.delete(cell.id);
    cell.deps = new Set();
    const prev = CURRENT; CURRENT = cell;
    let state = "resolved", value = null, fireKey = null;
    try {
      if (cell.kind === "resolver") {
        const gctx = cell.getCtx ? cell.getCtx() : ctxFor(cell.nodePath);   // 模块 cell 用模块上下文
        const keyVals = {};
        for (const [k, expr] of Object.entries(cell.key)) keyVals[k] = evaluate(expr, gctx).value;
        const keyStr = ser(keyVals);
        if (keyStr === cell.lastKey && cell.state === "resolved") { state = "resolved"; value = cell.value; }
        else { cell.lastKey = keyStr; state = "pending"; value = null; fireKey = keyVals; }
      } else if (cell.kind === "validation") {
        const gctx = cell.getCtx ? cell.getCtx() : ctxFor(cell.nodePath);
        const r = evaluate(cell.expr, gctx).value;
        value = r === true;
        cell.failMsg = value ? null : interp(cell.message, gctx, cell.scope);
      } else { // computed
        // 分支级可覆盖：先定位命中的 case，再决定是否应用 override（覆盖性 = 命中分支的属性）。
        let ovr = !!cell.overridable;                  // 无 cases / case 未标记 时的默认（向后兼容字段级）
        if (cell.cases) {
          let matched = false;
          cell.activeCase = -1;                        // 供 explain() 显示命中哪条分支
          for (let ci = 0; ci < cell.cases.length; ci++) {   // 首个 when 成立即停；即便将被覆盖也求 when，使 cell 依赖分支输入
            const cs = cell.cases[ci];
            const ok = cs.whenExpr === null || evaluate(cs.whenExpr, ctxFor(cell.nodePath)).value === true;
            if (ok) {
              ovr = (cs.overridable === undefined ? !!cell.overridable : !!cs.overridable);
              if (ovr && cell.override !== undefined) { value = coerce(cell.type, cell.override); state = "overridden"; }
              else value = cs.compute();
              matched = true; cell.activeCase = ci; break;
            }
          }
          if (!matched) {                              // 都不匹配 → fallback
            ovr = false;
            if (cell.fallback === "input") { value = coerce(cell.type, cell.manual); state = "input"; } // 可输入态
            else value = null;
          }
        } else {                                       // pipeline / produce（单一 compute，无 cases）
          if (cell.overridable && cell.override !== undefined) { value = coerce(cell.type, cell.override); state = "overridden"; }
          else value = cell.compute();
        }
        cell.activeOverridable = ovr;                  // 暴露给 setOverride / viewNode（实时可覆盖）
      }
    } catch (e) {
      if (e === PENDING) { state = "pending"; value = null; }
      else { state = "error"; value = null; cell.error = String(e && e.message || e); }
    } finally { CURRENT = prev; }
    for (const d of cell.deps) cells.get(d)?.dependents.add(cell.id);

    const changed = cell.state !== state || !eq(cell.value, value);
    cell.state = state; cell.value = value;
    onLog({ id: cell.id, kind: cell.kind, state, value: disp(value) });
    if (changed) for (const dep of cell.dependents) dirty.add(dep);
    if (fireKey) fireResolve(cell, fireKey);
  }

  function fireResolve(cell, keyVals) {
    outstanding++;
    onLog({ id: cell.id, kind: "resolver", state: "fetching", key: ser(keyVals) });
    Promise.resolve(resolveFn(cell.source, keyVals)).then(
      (res) => {
        if (cell.dead) { finishFetch(); return; }     // 取数返回时该子记录已被删除
        // pick 时从多字段对象取一项（res.values[pick]，兼容顶层 res[pick]）；否则整个 res.value 即标量。
        const raw = cell.pick != null ? (res.values ? res.values[cell.pick] : res[cell.pick]) : res.value;
        cell.state = "resolved"; cell.value = new Decimal(String(raw));
        cell.pinned = { field: cell.id, value: fmt(cell.value), source: cell.source, key: keyVals, pick: cell.pick ?? undefined, asOf: res.asOf, rateId: res.rateId };
        onLog({ id: cell.id, kind: "resolver", state: "resolved", value: fmt(cell.value), rateId: res.rateId });
        for (const dep of cell.dependents) dirty.add(dep);
        settle(); finishFetch();
      },
      (err) => {
        if (cell.dead) { finishFetch(); return; }
        cell.state = "error"; cell.value = null; cell.error = String(err && err.message || err);
        onLog({ id: cell.id, kind: "resolver", state: "error", error: cell.error });
        for (const dep of cell.dependents) dirty.add(dep);
        settle(); finishFetch();
      }
    );
  }
  function finishFetch() { outstanding--; if (outstanding === 0) { const w = idleWaiters; idleWaiters = []; w.forEach((r) => r()); } onUpdate(getState()); }

  function settle() {
    let guard = 0;
    while (dirty.size) {
      if (++guard > 1e6) throw new Error("settle loop");
      let pick = null;
      for (const id of dirty) { const c = cells.get(id); let ready = true;
        for (const d of c.deps) if (dirty.has(d)) { ready = false; break; }
        if (ready) { pick = id; break; } }
      if (pick === null) pick = dirty.values().next().value;
      dirty.delete(pick);
      const c = cells.get(pick);
      if (c.kind !== "input") recompute(c);
    }
  }

  function interp(tmpl, ctxObj, type) {
    if (!tmpl) return null;
    return tmpl.replace(/\{\{|\}\}|\{([^}]*)\}/g, (m, expr) => {
      if (m === "{{") return "{";
      if (m === "}}") return "}";
      const lm = expr.match(/^\s*([\w.]+)\s*:\s*label\s*$/);   // {字段:label} → 字段的人类可读标签
      if (lm) return fieldLabel(type, lm[1]) || lm[1];
      return fmt(evaluate(expr, ctxObj).value);               // {表达式} → 求值结果（原行为）
    });
  }

  // ── 公共 API ──
  function setInput(id, raw) {
    const c = cells.get(id);
    if (c && c.kind === "computed" && c.fallback === "input") {  // 条件可输入字段：写入用户值（守卫为假时生效）
      if (c.manual === raw) return;
      c.manual = raw; dirty.add(c.id); settle(); onUpdate(getState()); return;
    }
    if (!c || c.kind !== "input") throw new Error("not an input: " + id);
    const nv = coerce(c.type, raw);
    if (eq(c.value, nv)) return;
    c.value = nv;
    for (const dep of c.dependents) dirty.add(dep);
    settle();
    onUpdate(getState());
  }

  // 人工覆盖计算字段（仅 overridable 的计算字段；下游据覆盖值重算）
  function setOverride(id, value) {
    const c = cells.get(id);
    if (!c || c.kind !== "computed") throw new Error("不是计算字段，不能覆盖: " + id);
    // 分支级门槛：以当前命中分支的可覆盖性为准（未算过则退化到字段级）。锁死分支覆盖 → throw（BFF 据此判越权）。
    const canOv = c.activeOverridable !== undefined ? c.activeOverridable : !!c.overridable;
    if (!canOv) throw new Error("该计算字段当前分支不允许覆盖: " + id);
    c.override = value;
    dirty.add(c.id);
    settle();
    onUpdate(getState());
  }
  function clearOverride(id) {
    const c = cells.get(id);
    if (!c || c.override === undefined) return;
    delete c.override;
    dirty.add(c.id);                                  // 恢复公式计算并向下传播
    settle();
    onUpdate(getState());
  }

  // ── 从"已存的字段值"重建覆盖态（无需单独持久化 override 列表）──
  //   逻辑：某计算字段的【存值】≠【重算值】且当前分支可覆盖 → 判定它当初被人工覆盖 → 回放。
  //   默认只对【非外部依赖】字段反推（skipExternalDependent=true）：依赖 resolver 的字段重算含汇率漂移，易误判。
  //   迭代 fixpoint：上游覆盖先落，下游按更新后的重算值再比对——避免"下游值只因上游覆盖而变"被误判为覆盖。
  function reconstructOverrides(data, opts = {}) {
    // pins（存盘时的 resolver 值，如汇率）：先“种”回各 resolver cell → 反推按【存盘汇率】比对，
    //   无漂移，外部依赖字段也能准确判定，无需 skipExternalDependent 启发式。
    //   createSession 初次结算已按当前 key 发起取数（在途）；种回后本次用存盘值重算基线，
    //   在途取数稍后返回即自然刷新（“重新获取 pin 值 → 重算校验”）。
    const pins = opts.pins || null;
    const skipExt = pins ? (opts.skipExternalDependent === true) : (opts.skipExternalDependent !== false);
    if (pins) for (const p of pins) {
      const c = cells.get(p.field);
      if (c && c.kind === "resolver" && p.value != null) {
        c.value = new Decimal(String(p.value)); c.state = "resolved";   // lastKey 已由初次结算按当前 key 落定 → 本次不再重取
        for (const d of c.dependents) dirty.add(d);
      }
    }
    settle();                                          // 干净重算基线（种回存盘汇率后；尚无 override）
    // 传递外部依赖判定（基于纯公式依赖图，预填 memo）
    const extMemo = new Map();
    const dependsOnExternal = (id, seen = new Set()) => {
      if (extMemo.has(id)) return extMemo.get(id);
      if (seen.has(id)) return false; seen.add(id);
      const c = cells.get(id); let r = false;
      if (c) for (const d of c.deps) { const dc = cells.get(d); if (dc && dc.kind === "resolver") { r = true; break; } if (dependsOnExternal(d, seen)) { r = true; break; } }
      extMemo.set(id, r); return r;
    };
    for (const c of cells.values()) if (c.kind === "computed") dependsOnExternal(c.id);
    // 从 raw data 树按 cell.id（如 root.charges[0].items[0].base）取存值
    const storedAt = (id) => {
      let cur = data;
      for (const tok of id.split(".").slice(1)) {
        const m = tok.match(/^(\w+)\[(\d+)\]$/);
        cur = m ? cur?.[m[1]]?.[+m[2]] : cur?.[tok];
        if (cur == null) return undefined;
      }
      return cur;
    };
    const applied = [];
    for (let guard = 0; guard <= cells.size + 2; guard++) {
      let pick = null;
      for (const c of cells.values()) {
        if (c.kind !== "computed" || c.override !== undefined) continue;   // 未覆盖的计算字段
        if (!c.activeOverridable) continue;                                // 当前分支须可覆盖（锁死则不反推）
        if (skipExt && extMemo.get(c.id)) continue;                        // 只反推非外部依赖
        const stored = storedAt(c.id);
        if (stored == null) continue;                                      // 存值缺失 → 无从反推
        if (eq(coerce(c.type, stored), c.value)) continue;                 // 存值 == 当前重算值 → 非覆盖
        pick = { id: c.id, stored }; break;
      }
      if (!pick) break;
      setOverride(pick.id, String(pick.stored));                           // 回放（内部结算，下游按新值更新）
      applied.push(pick.id);
    }
    return applied;                                                        // 返回被重建为覆盖的字段列表
  }

  // 递归视图
  function viewNode(path, type) {
    const fields = {};
    for (const f of Object.keys(effectiveFields(type))) {                 // 含继承字段
      const c = cells.get(path + "." + f);
      fields[f] = c ? { value: disp(c.value), state: c.state, overridable: !!(c.activeOverridable !== undefined ? c.activeOverridable : c.overridable) } : { value: null, state: "resolved", overridable: false };
    }
    const collections = {};
    for (const coll of childCollections(type)) {
      const arr = nodes.get(path).data[coll.name] || [];
      const live = [];
      arr.forEach((d, i) => { if (d != null) live.push(viewNode(`${path}.${coll.name}[${i}]`, coll.node)); }); // 跳过墓碑
      collections[coll.name] = live;
    }
    const slots = {};
    for (const [slotName, slotDef] of Object.entries(effectiveSlots(type))) // 具名单节点
      slots[slotName] = viewNode(`${path}.${slotName}`, slotDef.node);
    return { path, type, fields, collections, slots };
  }
  function getState() {
    const validations = [];
    for (const c of cells.values()) if (c.kind === "validation")
      validations.push({ id: c.ruleId, scope: c.scope, node: c.hostNode || c.nodePath, state: c.state,
        ok: c.state === "resolved" ? c.value === true : null,
        message: c.state === "resolved" && c.value !== true ? c.failMsg : null });
    return {
      tree: viewNode("root", rootType),
      validations,
      pinned: [...cells.values()].filter((c) => c.kind === "resolver" && c.pinned).map((c) => c.pinned),
      overrides: [...cells.values()].filter((c) => c.kind === "computed" && c.override !== undefined).map((c) => ({ field: c.id, value: disp(c.value) })),
      anyPending: [...cells.values()].some((c) => c.state === "pending"),
    };
  }
  function idle() { return outstanding === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r)); }

  // 调试：导出可序列化的"计算图"——每个 cell 的 id/kind/值/态/表达式/依赖边，供 UI 摊开规则计算链。
  function explain() {
    const out = [];
    for (const c of cells.values()) {
      const e = { id: c.id, kind: c.kind, nodePath: c.nodePath, state: c.state, value: disp(c.value), deps: [...c.deps] };
      if (c.kind === "computed") {
        if (c.cases) e.cases = c.cases.map((cs, i) => ({ when: cs.whenExpr, expr: cs.expr, active: i === c.activeCase }));
        if (c.steps) e.steps = c.steps.map((s) => s.expr).filter(Boolean);   // pipeline：逐步表达式（隐式 value=上一步结果）
        e.fallback = c.fallback || null;
        e.overridden = c.state === "overridden";
        e.overridable = !!(c.activeOverridable !== undefined ? c.activeOverridable : c.overridable);
      } else if (c.kind === "resolver") {
        e.source = c.source; e.key = c.key; e.lastKey = c.lastKey; if (c.pick != null) e.pick = c.pick;
      } else if (c.kind === "validation") {
        e.expr = c.expr; e.ruleId = c.ruleId; e.severity = c.severity;
        e.ok = c.state === "resolved" ? c.value === true : null;
        e.message = c.state === "resolved" && c.value !== true ? c.failMsg : null;
      }
      if (c.error) e.error = c.error;
      out.push(e);
    }
    return out;
  }

  // ── 子记录增删 ──
  const subtreePaths = (rootPath) => [...nodes.keys()].filter((p) => p === rootPath || p.startsWith(rootPath + "."));
  const cellsOfNode = (path) => [...cells.values()].filter((c) => c.nodePath === path);
  // 子树内全部 cell：含模块命名空间 cell（nodePath 形如 <path>.<alias>），按前缀匹配（"]"/"." 作边界，不误伤兄弟）
  const cellsInSubtree = (path) => [...cells.values()].filter((c) => c.nodePath === path || c.nodePath.startsWith(path + "."));

  function addChild(parentPath, collName, childObj) {
    const parent = nodes.get(parentPath);
    if (!parent) throw new Error("无此节点: " + parentPath);
    const coll = childCollections(parent.type).find((c) => c.name === collName);
    if (!coll) throw new Error(`节点 ${parentPath} 无子集合 ${collName}`);
    const arr = parent.data[collName] || (parent.data[collName] = []);
    const i = arr.length;                                  // 追加到末尾（下标稳定，删除用墓碑）
    arr.push(childObj);
    const childPath = `${parentPath}.${collName}[${i}]`;
    buildTree(childPath, coll.node, parentPath, childObj); // 注册新子树（可含更深层）
    const newPaths = subtreePaths(childPath);
    for (const p of newPaths) buildNodeCells(p, nodes.get(p).type);
    for (const p of newPaths) instantiateUsesForNode(p);                 // 新节点的 use 模块（fxConvert 等）：补回汇率 resolver 与 produce 字段
    for (const c of cellsInSubtree(childPath)) if (c.kind !== "input") dirty.add(c.id); // 含模块命名空间 cell，确保新子树整体结算
    for (const c of cellsOfNode(parentPath)) if (c.kind !== "input") dirty.add(c.id); // 父聚合重读集合
    settle(); onUpdate(getState());
    return childPath;
  }

  function removeChild(childPath) {
    const m = childPath.match(/^(.*)\.([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/);
    if (!m) throw new Error("非法子路径: " + childPath);
    const parentPath = m[1], collName = m[2], idx = +m[3];
    const removed = subtreePaths(childPath).map((p) => [p, nodes.get(p).type]);
    nodes.get(parentPath).data[collName][idx] = null;      // 墓碑：保持其它兄弟下标不变
    for (const c of cellsInSubtree(childPath)) { c.dead = true; cells.delete(c.id); dirty.delete(c.id); } // 含模块命名空间 cell，避免回收遗漏
    for (const [p, t] of removed) {
      proxies.delete(p);
      nodes.delete(p);
      typeIndex.set(t, (typeIndex.get(t) || []).filter((x) => x !== p));
    }
    for (const c of cellsOfNode(parentPath)) if (c.kind !== "input") dirty.add(c.id); // 父聚合重算（剔除已删）
    settle(); onUpdate(getState());
  }

  // 初次结算
  for (const c of cells.values()) if (c.kind !== "input") dirty.add(c.id);
  settle();

  // 只读求值：在指定节点作用域对表达式求值（供表现层用——新增初值 / 显隐谓词等；不建 cell、不改数据流）
  function evalAt(path, expr) {
    const node = nodes.get(path);
    if (!node) throw new Error("evalAt: 无此节点 " + path);
    return evaluate(expr, ctxFor(path)).value;
  }

  return { setInput, setOverride, clearOverride, reconstructOverrides, addChild, removeChild, getState, explain, evalAt, idle, _cells: cells, _nodes: nodes };
}
