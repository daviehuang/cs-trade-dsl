// 中台校验核心（ADR-2/ADR-3）：
//   不信任前端提交的任何计算值。只取【原始输入】，用【同一引擎 + 权威汇率】重算，
//   再把重算结果与前端提交的计算值逐一比对 —— 不一致即判定为"前端计算值被篡改"。
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createSession } from "../src/incremental.js";
import { Decimal } from "../src/kernel.js";

const here = dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(readFileSync(join(here, "../lc-rules.json"), "utf8"));
const model = RULES.model;

// 导入注册表：加载被引用的模块库（生产中由 Rule Bundle API 按 ref 拉取+缓存）
const IMPORTS = {};
for (const f of ["commonFx.json"]) {
  const lib = JSON.parse(readFileSync(join(here, "..", f), "utf8"));
  IMPORTS[`${lib.ruleSetId}@${lib.version}`] = lib;
}

// 中台权威汇率源（生产中是独立权威服务；这里与前端同表，使"未篡改即一致"）
const AUTH_RATES = { "USD-CNY": "7.1234", "EUR-CNY": "7.8901", "HKD-CNY": "0.9123", "GBP-CNY": "9.1234", "JPY-CNY": "0.0481", "SGD-CNY": "5.2710", "CNY-CNY": "1" };
function authResolve(_source, key) {
  const r = AUTH_RATES[`${key.from}-${key.to}`];
  return r ? Promise.resolve({ value: r, asOf: "server", rateId: "srv_" + key.from }) : Promise.reject(new Error("无权威汇率 " + key.from + "→" + key.to));
}

const childColls = (type) => { const c = model.nodes[type].children; return !c ? [] : Array.isArray(c) ? c : [c]; };

// 条件可输入字段集（formula + when + fallback:input）：守卫为假时它们是用户输入，需作为输入喂给引擎。
const conditionalTargets = new Set();
for (const r of RULES.rules) if (r.type === "formula" && r.fallback === "input")
  conditionalTargets.add((r.scope || model.root) + "." + r.target);

// 从提交的数据树抽取"原始输入"（剔除普通 computed / external；条件可输入字段保留）。
// 节点类型由【模型】自顶向下推导，不依赖客户端提供的 _type。
function extractInputs(node, type) {
  const def = model.nodes[type];
  const out = {};
  for (const [f, spec] of Object.entries(def.fields)) {
    if (spec.external) continue;
    if (spec.computed && !conditionalTargets.has(type + "." + f)) continue; // 普通计算字段跳过；条件字段保留为输入
    out[f] = node[f];
  }
  for (const coll of childColls(type))
    if (Array.isArray(node[coll.name])) out[coll.name] = node[coll.name].map((c) => extractInputs(c, coll.node));
  return out;
}

// 并行遍历"提交树"与"中台重算树"，比对所有 computed 字段（计算值篡改）
function compare(sub, srv, out) {
  const def = model.nodes[srv.type];
  for (const [f, spec] of Object.entries(def.fields)) {
    if (!spec.computed) continue;                          // 外部值（汇率）走钉值复核，见下
    const client = sub[f];
    if (client === undefined || client === null) continue; // 客户端未提供该计算值（如纯数据第三方）→ 不比对，以中台重算为准
    const cell = srv.fields[f];
    // resolved=公式态(比对防篡改)；overridden=合法覆盖；input=条件可输入态(中台据守卫判定，持用户值，不算篡改)
    const server = (cell.state === "resolved" || cell.state === "overridden" || cell.state === "input") ? cell.value : `<${cell.state}>`;
    if (String(client) !== String(server))
      out.push({ field: srv.path + "." + f, kind: "computed", client, server });
  }
  for (const coll of childColls(srv.type)) {
    const a = sub[coll.name] || [], b = srv.collections[coll.name] || [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) compare(a[i], b[i], out);
  }
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
function verifyPinned(pinned) {
  const ds = (RULES.dataSources || []).find((d) => d.sourceId === "fxRateService");
  const tol = ds && ds.tolerance;
  const out = [];
  for (const p of pinned || []) {
    const auth = AUTH_RATES[`${p.key.from}-${p.key.to}`];
    if (auth === undefined) { out.push({ field: p.field, kind: "rate-unknown", client: p.value, server: "(无权威汇率)" }); continue; }
    if (!withinTolerance(p.value, auth, tol))
      out.push({ field: p.field, kind: "rate", client: p.value, server: auth }); // 钉值汇率与权威源不符（超容差）
  }
  return out;
}

export async function validateSubmission(payload) {
  const submitted = payload.data || payload.tree;          // 接受纯数据(data)或带状态的树(tree)
  if (!submitted || typeof submitted !== "object") throw new Error("缺少提交数据");

  // 1) 只取原始输入（类型从模型根开始推导）
  const inputs = extractInputs(submitted, model.root);
  // 2) 同一引擎 + 权威汇率，重算
  const session = createSession(RULES, inputs, { resolve: authResolve, imports: IMPORTS });
  await session.idle();

  // 2b) 应用前端声明的【合法覆盖】（仅 overridable 字段；越权覆盖 → 记为不一致）
  const divergences = [];
  for (const ov of payload.overrides || []) {
    try { session.setOverride(ov.field, ov.value); }     // 引擎只允许 overridable 字段
    catch { divergences.push({ field: ov.field, kind: "unauth-override", client: ov.value, server: "(不允许覆盖)" }); }
  }
  const st = session.getState();

  // 3) 比对计算值：被合法覆盖的字段中台已应用同值 → 一致；其余计算值若被改 → 篡改
  compare(submitted, st.tree, divergences);

  // 3b) 钉值汇率权威复核（汇率篡改/过期）
  const rateDivergences = verifyPinned(payload.pinned);
  divergences.push(...rateDivergences);

  // 4) 权威业务校验
  const valFails = st.validations.filter((v) => v.state === "resolved" && !v.ok);

  const verdict = divergences.length ? "REJECT_TAMPER" : valFails.length ? "REJECT_VALIDATION" : "ACCEPT";
  return {
    verdict,
    divergences,
    rateChecked: (payload.pinned || []).length,
    overridesApplied: st.overrides,                       // 中台接受并应用的合法覆盖
    validations: st.validations,
    serverComputed: { chargeTotal: st.tree.fields.chargeTotal.value, paymentTotal: st.tree.fields.paymentTotal.value, net: st.tree.fields.net.value },
    checkedAt: payload.now || null,
  };
}
