// 中台校验核心（ADR-2/ADR-3）：
//   不信任前端提交的任何计算值。只取【原始输入】，用【同一引擎 + 权威汇率】重算，
//   再把重算结果与前端提交的计算值逐一比对 —— 不一致即判定为"前端计算值被篡改"。
//
// 【动态规则】：不再写死某一套规则。按提交里的 ruleSetId 运行时从规则仓库（store-server）
//   拉取 bundle（规则集 + import 库），现场编译该套规则的校验上下文再重算——
//   与前端各端「运行时按 feature 加载」完全对称：规则不编译进服务端，随仓库版本一致。
import { createSession } from "../src/incremental.js";
import { Decimal } from "../src/kernel.js";

// 规则仓库地址（与前端 runtime-loader 同一个 store-server）
const STORE = process.env.STORE_URL || "http://localhost:8788/api";

// 中台权威数据源（ruleset 无关；生产中是独立权威服务；这里与前端同表，使"未篡改即一致"）
const AUTH_RATES = { "USD-CNY": "7.1234", "EUR-CNY": "7.8901", "HKD-CNY": "0.9123", "GBP-CNY": "9.1234", "JPY-CNY": "0.0481", "SGD-CNY": "5.2710", "CNY-CNY": "1" };
const AUTH_SANCTIONS = { SDNXKP01: "95", OFACUS00: "88" };
// 复杂计费权威源（一次返回多字段对象）；与 fx.ts / editor mock 同表，保证"未篡改即一致"。
const AUTH_CHARGE = { "LC|gold": { base: "120.00", tax: "60.00", fee: "15.00" }, "LC|silver": { base: "100.00", tax: "60.00", fee: "15.00" }, "LC|": { base: "80.00", tax: "60.00", fee: "15.00" } };
function authResolve(source, key) {
  if (source === "sanctionsService")
    return Promise.resolve({ value: AUTH_SANCTIONS[key.bic] || "0", asOf: "server", rateId: "scr_" + (key.bic || "none") });
  if (source === "chargeService") {                       // 多字段：回 { values }，供 resolver.pick 摊到各字段
    const v = AUTH_CHARGE[`${key.productType}|${key.tier}`] || AUTH_CHARGE[`${key.productType}|`];
    return v ? Promise.resolve({ values: v, asOf: "server", rateId: "chg_" + key.productType }) : Promise.reject(new Error("无权威计费 " + key.productType));
  }
  const r = AUTH_RATES[`${key.from}-${key.to}`];
  return r ? Promise.resolve({ value: r, asOf: "server", rateId: "srv_" + key.from }) : Promise.reject(new Error("无权威汇率 " + key.from + "→" + key.to));
}

// ── 按 ruleSet 现场编译校验上下文（含 import 类型库 + 继承感知 + 条件字段 + 数据源）──
//   与引擎同构：否则 slots 引用的 CustomerParty 等不在本地 model.nodes 里、继承字段取不到。
function compile(ruleSet, imports) {
  const model = ruleSet.model;
  const importedNodes = {};
  for (const imp of ruleSet.imports || []) { const lib = imports[imp.ref]; if (lib?.nodes) Object.assign(importedNodes, lib.nodes); }
  const mergedNodes = { ...importedNodes, ...model.nodes };

  const typeChain = (t) => { const ch = []; let x = t; while (x) { ch.unshift(x); x = mergedNodes[x]?.extends; } return ch; };            // [基类…自身]
  const effFields = (t) => { const o = {}; for (const x of typeChain(t)) Object.assign(o, mergedNodes[x]?.fields || {}); return o; };
  const normColls = (c) => (!c ? [] : Array.isArray(c) ? c : [c]);
  // 与引擎 childCollections 等价：同名子集合由子类覆盖（node 替换，位置不变）
  const childColls = (t) => { const idx = new Map(), out = []; for (const x of typeChain(t)) for (const c of normColls(mergedNodes[x]?.children)) { if (idx.has(c.name)) out[idx.get(c.name)] = c; else { idx.set(c.name, out.length); out.push(c); } } return out; };
  const effSlots = (t) => { const o = {}; for (const x of typeChain(t)) for (const [k, v] of Object.entries(mergedNodes[x]?.slots || {})) o[k] = (typeof v === "string" ? v : v.node); return o; };

  // 条件可输入字段（formula + fallback:input）：守卫为假时是用户输入，需作为输入喂给引擎。
  const conditionalTargets = new Set();
  for (const r of ruleSet.rules || []) if (r.type === "formula" && r.fallback === "input")
    conditionalTargets.add((r.scope || model.root) + "." + r.target);

  // 合并数据源（规则集 + 各 import 库，如 commonFx 的 fxRateService）→ 供钉值容差复核。
  const dataSources = {};
  for (const src of ruleSet.dataSources || []) dataSources[src.sourceId] = src;
  for (const imp of ruleSet.imports || []) for (const src of (imports[imp.ref]?.dataSources || [])) dataSources[src.sourceId] = src;

  return { ruleSet, imports, model, rootType: model.root, effFields, childColls, effSlots, conditionalTargets, dataSources };
}

// 运行时从仓库按 featureId 拉 bundle → 编译。每次请求都拉，保证与仓库当前版本一致（编辑器一存即生效）。
async function loadCompiled(featureId) {
  const url = `${STORE}/bundle/${encodeURIComponent(featureId)}`;
  let bundle;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`仓库返回 HTTP ${resp.status}`);
    bundle = await resp.json();
  } catch (e) {
    throw new Error(`无法从规则仓库加载 feature「${featureId}」：${e.message}（store-server 是否已启动？node store-server.js）`);
  }
  if (!bundle || !bundle.ruleSet) throw new Error(`仓库 bundle 缺少 ruleSet（feature「${featureId}」）`);
  return compile(bundle.ruleSet, bundle.imports || {});
}

// 从提交的数据树抽取"原始输入"（剔除普通 computed / external；条件可输入字段保留）。
// 节点类型由【模型】自顶向下推导，不依赖客户端提供的 _type。
function extractInputs(ctx, node, type) {
  const out = {};
  for (const [f, spec] of Object.entries(ctx.effFields(type))) {
    if (spec.external) continue;
    if (spec.computed && !ctx.conditionalTargets.has(type + "." + f)) continue; // 普通计算字段跳过；条件字段保留为输入
    out[f] = node?.[f];
  }
  for (const coll of ctx.childColls(type))
    if (Array.isArray(node?.[coll.name])) out[coll.name] = node[coll.name].map((c) => extractInputs(ctx, c, coll.node));
  for (const [slotName, sub] of Object.entries(ctx.effSlots(type)))            // 具名槽位（当事方等）：递归抽取其输入
    if (node?.[slotName]) out[slotName] = extractInputs(ctx, node[slotName], sub);
  return out;
}

// 并行遍历"提交树"与"中台重算树"，比对所有 computed 字段（计算值篡改）
function compare(ctx, sub, srv, out) {
  for (const [f, spec] of Object.entries(ctx.effFields(srv.type))) {
    if (!spec.computed) continue;                          // 外部值（汇率）走钉值复核，见下
    const client = sub?.[f];
    if (client === undefined || client === null) continue; // 客户端未提供该计算值（如纯数据第三方）→ 不比对，以中台重算为准
    const cell = srv.fields[f];
    // resolved=公式态(比对防篡改)；overridden=合法覆盖；input=条件可输入态(中台据守卫判定，持用户值，不算篡改)
    const server = (cell.state === "resolved" || cell.state === "overridden" || cell.state === "input") ? cell.value : `<${cell.state}>`;
    if (String(client) !== String(server))
      out.push({ field: srv.path + "." + f, kind: "computed", client, server });
  }
  for (const coll of ctx.childColls(srv.type)) {
    const a = sub?.[coll.name] || [], b = srv.collections[coll.name] || [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) compare(ctx, a[i], b[i], out);
  }
  for (const slotName of Object.keys(ctx.effSlots(srv.type)))                 // 递归比对槽位（当事方）里的计算值
    if (sub?.[slotName] && srv.slots?.[slotName]) compare(ctx, sub[slotName], srv.slots[slotName], out);
}

// 钉值汇率权威复核（ADR-9）：拿中台权威汇率源，按容差复核前端提交的每条钉值。
function withinTolerance(client, auth, tol) {
  let c, a;
  try { c = new Decimal(String(client)); a = new Decimal(String(auth)); } catch { return false; }
  const diff = c.minus(a).abs();
  if (!tol) return diff.isZero();
  if (tol.type === "relative") return a.isZero() ? c.isZero() : diff.div(a.abs()).lte(new Decimal(tol.value));
  return diff.lte(new Decimal(tol.value)); // absolute
}
//   源无关：每条钉值按 p.source 走权威 resolver 重取（多字段源用 p.pick 取项），按该源 tolerance 复核。
//   按 (source,key) 记忆化 → 多字段源的 N 个 pick 只打 1 次权威后台。
async function verifyPinned(ctx, pinned) {
  const out = [];
  const memo = new Map();
  const authFetch = (source, key) => {
    const k = source + "|" + JSON.stringify(key);
    if (!memo.has(k)) memo.set(k, Promise.resolve(authResolve(source, key)).then((r) => r, () => null));
    return memo.get(k);
  };
  for (const p of pinned || []) {
    const source = p.source || "fxRateService";
    const tol = (ctx.dataSources[source] || {}).tolerance;
    const res = await authFetch(source, p.key);
    const auth = res == null ? undefined : (p.pick != null ? (res.values ? res.values[p.pick] : res[p.pick]) : res.value);
    if (auth === undefined || auth === null) { out.push({ field: p.field, kind: "rate-unknown", client: p.value, server: "(无权威值)" }); continue; }
    if (!withinTolerance(p.value, auth, tol))
      out.push({ field: p.field, kind: p.pick != null ? "resolver" : "rate", client: p.value, server: auth }); // 钉值与权威源不符（超容差）
  }
  return out;
}

export async function validateSubmission(payload) {
  const submitted = payload.data || payload.tree;          // 接受纯数据(data)或带状态的树(tree)
  if (!submitted || typeof submitted !== "object") throw new Error("缺少提交数据");
  const featureId = String(payload.ruleSetId || payload.featureId || "").split("@")[0];
  if (!featureId) throw new Error("提交缺少 ruleSetId —— 无法确定用哪套规则校验");

  // 0) 运行时按 ruleSetId 动态加载规则并编译校验上下文（不写死某套规则）
  const ctx = await loadCompiled(featureId);

  // 1) 只取原始输入（类型从模型根开始推导）
  const inputs = extractInputs(ctx, submitted, ctx.rootType);
  // 2) 同一引擎 + 权威汇率，重算
  const session = createSession(ctx.ruleSet, inputs, { resolve: authResolve, imports: ctx.imports });
  await session.idle();

  // 2b) 应用前端声明的【合法覆盖】（仅 overridable 字段；越权覆盖 → 记为不一致）
  const divergences = [];
  for (const ov of payload.overrides || []) {
    try { session.setOverride(ov.field, ov.value); }     // 引擎只允许 overridable 字段
    catch { divergences.push({ field: ov.field, kind: "unauth-override", client: ov.value, server: "(不允许覆盖)" }); }
  }
  const st = session.getState();

  // 3) 比对计算值：被合法覆盖的字段中台已应用同值 → 一致；其余计算值若被改 → 篡改
  compare(ctx, submitted, st.tree, divergences);
  // 3b) 钉值权威复核（汇率/多字段计费 篡改或过期）
  divergences.push(...(await verifyPinned(ctx, payload.pinned)));

  // 4) 权威业务校验（本套规则 + 其 import 库声明的所有 validation）
  const valFails = st.validations.filter((v) => v.state === "resolved" && !v.ok);

  const verdict = divergences.length ? "REJECT_TAMPER" : valFails.length ? "REJECT_VALIDATION" : "ACCEPT";

  // serverComputed：动态列出根节点所有计算字段的重算值（不再写死 chargeTotal/net，适配任意规则集）
  const serverComputed = {};
  for (const [f, spec] of Object.entries(ctx.effFields(ctx.rootType)))
    if (spec.computed && st.tree.fields[f]) serverComputed[f] = st.tree.fields[f].value;

  return {
    verdict,
    divergences,
    ruleSetId: featureId,                                 // 回显：用哪套规则校验的
    rateChecked: (payload.pinned || []).length,
    overridesApplied: st.overrides,                       // 中台接受并应用的合法覆盖
    validations: st.validations,
    serverComputed,
    checkedAt: payload.now || null,
  };
}
