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
  const cells = new Map();
  const dirty = new Set();
  let CURRENT = null;
  let outstanding = 0;
  let idleWaiters = [];

  const disp = (v) => (v == null ? null : v instanceof Decimal ? fmt(v) : v);
  const eq = (a, b) => disp(a) === disp(b) && typeof a === typeof b;
  const ser = (o) => JSON.stringify(o, (_, v) => (v instanceof Decimal ? fmt(v) : v));

  // 节点的子集合声明（兼容单对象与数组）
  function childCollections(type) {
    const c = model.nodes[type].children;
    return !c ? [] : Array.isArray(c) ? c : [c];
  }

  // ── 递归节点注册表 ──
  const nodes = new Map();          // path -> { path, type, parentPath, data }
  const typeIndex = new Map();      // type -> [path,...]
  function register(path, type, parentPath, d) {
    nodes.set(path, { path, type, parentPath, data: d });
    (typeIndex.get(type) || typeIndex.set(type, []).get(type)).push(path);
  }
  function buildTree(path, type, parentPath, d) {
    register(path, type, parentPath, d);
    for (const coll of childCollections(type)) {
      const arr = d[coll.name] || [];
      arr.forEach((cd, i) => buildTree(`${path}.${coll.name}[${i}]`, coll.node, path, cd));
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
    const p = new Proxy({}, {
      get(_, prop) {
        if (prop === "ctx") return ctxProxy;               // 头部数据，位置无关
        if (prop === "__children") return colls[0] ? childProxies(path, colls[0]) : undefined;
        if (typeof prop !== "string") return undefined;
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
  // 规则按 scope 类型分组（建子树 cell 时复用）
  const rulesByScope = new Map();
  for (const rule of ruleSet.rules) {
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
      const spec = model.nodes[ntype].fields[rule.target] || {};
      // 归一化为 cases 列表：cases 多分支 / 单 when / 无条件，统一成 [{whenExpr, compute}]
      const rawCases = rule.cases || (rule.when ? [{ when: rule.when, expr: rule.expr }] : [{ when: null, expr: rule.expr }]);
      const cases = rawCases.map((cs) => ({ whenExpr: cs.when || null, compute: () => evaluate(cs.expr, ctxFor(path)).value }));
      cells.set(id, { ...base, id, kind: "computed", type: spec.type, overridable: !!spec.overridable,
        cases, fallback: rule.fallback || null,                                   // 所有 when 都不匹配 → fallback
        manual: rule.fallback === "input" ? nodes.get(path).data[rule.target] : undefined });
    } else if (rule.type === "pipeline") {
      const id = path + "." + rule.target;
      const spec = model.nodes[ntype].fields[rule.target] || {};
      cells.set(id, { ...base, id, kind: "computed", type: spec.type, overridable: !!spec.overridable, compute: () => {
        let v = null; const c = ctxFor(path);
        for (const s of rule.steps) if (s.expr) v = evaluate(s.expr, { ...c, value: v }).value;
        return v;
      } });
    } else if (rule.type === "resolver") {
      const id = path + "." + rule.target;
      cells.set(id, { ...base, id, kind: "resolver", source: rule.source, key: rule.key, lastKey: null, pinned: null });
    } else if (rule.type === "validation") {
      const id = path + ".__val_" + rule.id;
      cells.set(id, { ...base, id, kind: "validation", ruleId: rule.id, scope: rule.scope || rootType, expr: rule.expr, message: rule.message || "", severity: rule.severity || "error" });
    }
  }
  // 为一个节点建 input + 规则 cells（初次与动态增子时复用）
  function buildNodeCells(path, type) {
    const def = model.nodes[type];
    for (const [f, spec] of Object.entries(def.fields)) {
      if (spec.computed || spec.external) continue;
      addInputCell(path, f, spec.type, nodes.get(path).data[f]);
    }
    for (const rule of (rulesByScope.get(type) || [])) makeRuleCell(rule, path);
  }
  for (const node of nodes.values()) buildNodeCells(node.path, node.type);

  // ── 环境上下文 cells：context 映射在 root 作用域求值（如 baseCcy ← root.baseCcy）──
  for (const [key, expr] of Object.entries(ruleSet.context || {})) {
    const id = "__ctx." + key;
    cells.set(id, { id, kind: "computed", nodePath: "__ctx", deps: new Set(), dependents: new Set(), state: "stale", value: null,
      cases: [{ whenExpr: null, compute: () => evaluate(expr, ctxFor("root")).value }], fallback: null });
  }

  // ── 跨 RuleSet imports：按 ref(id@version) 解析模块库，命名空间别名 ──
  // opts.imports: { "commonFx@1.0.0": <ruleSetObj>, ... }（生产中由 Rule Bundle API 拉取+缓存）
  const importRegistry = opts.imports || {};
  const importedModules = {};                  // alias → { moduleId → moduleDef }
  for (const imp of (ruleSet.imports || [])) {
    const lib = importRegistry[imp.ref];
    if (!lib) throw new Error("未找到导入(ref): " + imp.ref);
    importedModules[imp.as] = lib.modules || {};
  }
  function resolveModule(ref) {
    if (ref.includes(".")) {                   // 导入模块：alias.moduleId
      const [alias, modId] = ref.split(".");
      const ns = importedModules[alias];
      if (!ns || !ns[modId]) throw new Error("未找到导入模块: " + ref);
      return ns[modId];
    }
    const local = (ruleSet.modules || {})[ref]; // 本地模块
    if (!local) throw new Error("未找到模块: " + ref);
    return local;
  }

  // ── 模块实例化：use 模块 on 某 scope，把抽象 inputs 绑到 host 字段，produce 写回 host ──
  function instantiateUse(use) {
    const mod = resolveModule(use.use);
    const alias = use.as || use.use.split(".").pop();
    for (const hostPath of (typeIndex.get(use.on) || [])) {
      const ns = `${hostPath}.${alias}`;
      const mctx = () => moduleCtx(ns, hostPath);
      // 1) 输入端口：alias.<input> = bind 表达式（在 host 作用域求值）
      for (const inp of Object.keys(mod.inputs || {})) {
        const expr = use.bind[inp];
        cells.set(`${ns}.${inp}`, { id: `${ns}.${inp}`, kind: "computed", nodePath: ns, type: mod.inputs[inp],
          deps: new Set(), dependents: new Set(), state: "stale", value: null,
          cases: [{ whenExpr: null, compute: () => evaluate(expr, ctxFor(hostPath)).value }], fallback: null });
      }
      // 2) 模块内部规则：在模块命名空间求值（self=模块实例；只见 inputs/局部/ctx）
      for (const r of (mod.rules || [])) {
        const id = `${ns}.${r.target}`;
        const ftype = (mod.fields[r.target] || {}).type;
        if (r.type === "formula")
          cells.set(id, { id, kind: "computed", nodePath: ns, type: ftype, deps: new Set(), dependents: new Set(), state: "stale", value: null,
            cases: [{ whenExpr: null, compute: () => evaluate(r.expr, mctx()).value }], fallback: null });
        else if (r.type === "resolver")
          cells.set(id, { id, kind: "resolver", nodePath: ns, source: r.source, key: r.key, lastKey: null, pinned: null,
            deps: new Set(), dependents: new Set(), state: "stale", value: null, getCtx: mctx });
        else if (r.type === "validation")    // 模块内校验：在模块上下文求值，上浮到 getState().validations（带 host 节点）
          cells.set(`${ns}.__val_${r.id}`, { id: `${ns}.__val_${r.id}`, kind: "validation", nodePath: ns, hostNode: hostPath,
            ruleId: `${alias}.${r.id}`, scope: use.on, expr: r.expr, message: r.message || "", severity: r.severity || "error",
            deps: new Set(), dependents: new Set(), state: "stale", value: null, getCtx: mctx });
      }
      // 3) produce：host 字段 = 模块输出（继承 model 的 overridable，使覆盖/条件等沿用）
      for (const [out, hostField] of Object.entries(use.produce || {})) {
        const id = `${hostPath}.${hostField}`;
        const fspec = model.nodes[nodes.get(hostPath).type].fields[hostField] || {};
        cells.set(id, { id, kind: "computed", nodePath: hostPath, type: fspec.type, overridable: !!fspec.overridable,
          deps: new Set(), dependents: new Set(), state: "stale", value: null,
          cases: [{ whenExpr: null, compute: () => evaluate(out, mctx()).value }], fallback: null });
      }
    }
  }
  for (const use of (ruleSet.uses || [])) instantiateUse(use);

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
        cell.failMsg = value ? null : interp(cell.message, gctx);
      } else { // computed
        if (cell.override !== undefined) {
          value = coerce(cell.type, cell.override);   // 人工覆盖：持有该值，不跑公式
          state = "overridden";
        } else if (cell.cases) {                       // 多分支：按序取首个 when 成立的 expr
          let matched = false;
          for (const cs of cell.cases) {
            const ok = cs.whenExpr === null || evaluate(cs.whenExpr, ctxFor(cell.nodePath)).value === true;
            if (ok) { value = cs.compute(); matched = true; break; }
          }
          if (!matched) {                              // 都不匹配 → fallback
            if (cell.fallback === "input") { value = coerce(cell.type, cell.manual); state = "input"; } // 可输入态
            else value = null;
          }
        } else {
          value = cell.compute();                      // pipeline
        }
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
        cell.state = "resolved"; cell.value = new Decimal(String(res.value));
        cell.pinned = { field: cell.id, value: fmt(cell.value), source: cell.source, key: keyVals, asOf: res.asOf, rateId: res.rateId };
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

  function interp(tmpl, ctxObj) {
    if (!tmpl) return null;
    return tmpl.replace(/\{\{|\}\}|\{([^}]*)\}/g, (m, expr) =>
      m === "{{" ? "{" : m === "}}" ? "}" : fmt(evaluate(expr, ctxObj).value));
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
    if (!c.overridable) throw new Error("该计算字段不允许覆盖: " + id);
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

  // 递归视图
  function viewNode(path, type) {
    const def = model.nodes[type];
    const fields = {};
    for (const f of Object.keys(def.fields)) {
      const c = cells.get(path + "." + f);
      fields[f] = c ? { value: disp(c.value), state: c.state } : { value: null, state: "resolved" };
    }
    const collections = {};
    for (const coll of childCollections(type)) {
      const arr = nodes.get(path).data[coll.name] || [];
      const live = [];
      arr.forEach((d, i) => { if (d != null) live.push(viewNode(`${path}.${coll.name}[${i}]`, coll.node)); }); // 跳过墓碑
      collections[coll.name] = live;
    }
    return { path, type, fields, collections };
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

  // ── 子记录增删 ──
  const subtreePaths = (rootPath) => [...nodes.keys()].filter((p) => p === rootPath || p.startsWith(rootPath + "."));
  const cellsOfNode = (path) => [...cells.values()].filter((c) => c.nodePath === path);

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
    for (const p of newPaths) for (const c of cellsOfNode(p)) if (c.kind !== "input") dirty.add(c.id);
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
    for (const [p, t] of removed) {
      for (const c of cellsOfNode(p)) { c.dead = true; cells.delete(c.id); dirty.delete(c.id); }
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

  return { setInput, setOverride, clearOverride, addChild, removeChild, getState, idle, _cells: cells, _nodes: nodes };
}
