// 规则引擎：在交易树上执行一个 RuleSet
// 覆盖 Schema 的 4 类规则 + trigger 阶段 + 父子作用域。
import { Decimal, evaluate, fmt } from "./kernel.js";

// ── Function Registry（架构 §6：受治理的命名函数；PoC 内置少量）──
// 生产中这些实现由「单源内核」编译产物提供，并经 golden tests 双端对齐。
const REGISTRY = {
  "calcFee@1.3.0": (params) => {
    // 费率 1%：fee = base * 0.01
    const base = params.base;
    return base === null ? null : new Decimal(base).times("0.01");
  },
};
function callFunction(id, version, params) {
  const key = `${id}@${version || "1.3.0"}`;
  const fn = REGISTRY[key];
  if (!fn) throw new Error(`E_UNKNOWN_FN: ${key}`);
  return fn(params);
}

// ── 按 model 强制十进制类型（§4.1：从字符串载入，杜绝 JSON 浮点）──
function coerce(raw, nodeType, model) {
  const def = model.nodes[nodeType];
  const out = {};
  for (const [f, spec] of Object.entries(def.fields)) {
    let v = raw[f];
    if (v === undefined || v === null) { out[f] = null; continue; }
    if (spec.type === "decimal" || spec.type === "int") out[f] = new Decimal(String(v));
    else out[f] = v;
  }
  if (def.children) {
    const childType = def.children.node;
    const arr = raw[def.children.name] || [];
    out.__children = arr.map((c) => coerce(c, childType, model));
  }
  return out;
}

// 触发阶段顺序
const PHASE_ORDER = ["before-calc", "on-change", "calc", "after-calc", "on-submit"];
function defaultTrigger(type) {
  if (type === "formula" || type === "pipeline" || type === "function") return "calc";
  return "after-calc"; // validation
}

// 取规则作用的节点列表（Schema §3 scope）
function targetsOf(rule, root, model) {
  const scope = rule.scope || model.root;
  if (scope === model.root) return [root];
  // 收集该类型的所有节点（PoC：仅 root 的直接子集合）
  const res = [];
  if (root.__children) for (const c of root.__children) res.push(c);
  return res;
}

function ctxFor(node, root) {
  // PoC：父就是 root（两层结构）；root 作用域时 parent=null
  const parent = node === root ? null : root;
  return { self: node, parent, root };
}

export function runRuleSet(ruleSet, rawData) {
  const model = ruleSet.model;
  const root = coerce(rawData, model.root, model);
  const validations = [];
  const warnings = [];

  // 按 trigger 阶段、再按"子作用域优先"排序（保证 child.charge 先于 parent.total）
  const rules = [...ruleSet.rules].filter((r) => r.enabled !== false).sort((a, b) => {
    const pa = PHASE_ORDER.indexOf(a.trigger || defaultTrigger(a.type));
    const pb = PHASE_ORDER.indexOf(b.trigger || defaultTrigger(b.type));
    if (pa !== pb) return pa - pb;
    const sa = (a.scope || model.root) === model.root ? 1 : 0;
    const sb = (b.scope || model.root) === model.root ? 1 : 0;
    return sa - sb; // 子作用域(0) 先于 root(1)
  });

  for (const rule of rules) {
    for (const node of targetsOf(rule, root, model)) {
      const ctx = ctxFor(node, root);
      // when 守卫
      if (rule.when) {
        const g = evaluate(rule.when, ctx);
        if (g.value !== true) continue;
      }
      switch (rule.type) {
        case "formula": {
          const r = evaluate(rule.expr, ctx);
          warnings.push(...r.warnings);
          node[rule.target] = r.value;
          break;
        }
        case "function": {
          const params = {};
          for (const [k, expr] of Object.entries(rule.params || {})) {
            params[k] = evaluate(expr, ctx).value;
          }
          const out = callFunction(rule.function, rule.functionVersion, params);
          if (rule.target) node[rule.target] = out;
          break;
        }
        case "pipeline": {
          let value = null;
          for (const step of rule.steps) {
            if (step.expr) {
              value = evaluate(step.expr, { ...ctx, value }).value;
            } else if (step.function) {
              const params = {};
              for (const [k, expr] of Object.entries(step.params || {})) {
                params[k] = evaluate(expr, { ...ctx, value }).value;
              }
              if (params.base === undefined) params.base = value;
              value = callFunction(step.function, step.version, params);
            }
          }
          node[rule.target] = value;
          break;
        }
        case "validation": {
          const r = evaluate(rule.expr, ctx);
          warnings.push(...r.warnings);
          const ok = r.value === true; // null 谓词按失败处理 §5.4
          validations.push({
            id: rule.id,
            scope: rule.scope || model.root,
            ok,
            severity: rule.severity || "error",
            code: rule.code || null,
            message: ok ? null : interpolate(rule.message, ctx),
          });
          break;
        }
      }
    }
  }

  return { tree: serialize(root), validations, warnings: [...new Set(warnings)] };
}

// message 插值 §9：{ expr } → 求值并格式化
function interpolate(tmpl, ctx) {
  if (!tmpl) return null;
  return tmpl.replace(/\{\{|\}\}|\{([^}]*)\}/g, (m, expr) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    return fmt(evaluate(expr, ctx).value);
  });
}

// 将 Decimal 树序列化为可比较的纯字符串结构
function serialize(node) {
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "__children") { out.children = v.map(serialize); continue; }
    out[k] = v === null ? null : (v instanceof Decimal ? v.toFixed() : v);
  }
  return out;
}
