// 统一业务规则 DSL —— 表达式内核（JS）
// 实现「表达式语言规范」unified_dsl_expression.md：
//   - 十进制语义（禁浮点，HALF_UP）  §4
//   - null 传播                       §5
//   - 内置函数                        §6
//   - 确定性                          §7
// 该文件是「单源内核」(ADR-1) 的 JS 目标产物，UI 与 BFF 共用同一份。
import Decimal from "decimal.js";

// §4.2/§4.4：精度 ≥28（这里 34 有效位），舍入 HALF_UP（除法标度同步 34 有效位）
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

// ───────────────────────── Lexer ─────────────────────────
const KEYWORDS = new Set(["true", "false", "null", "root", "parent", "children", "value"]);

function lex(src) {
  const toks = [];
  let i = 0;
  const push = (type, value) => toks.push({ type, value });
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    // 字符串
    if (c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\") { s += src[j + 1]; j += 2; }
        else { s += src[j]; j++; }
      }
      if (j >= src.length) throw new Error("E_PARSE: 未闭合字符串");
      push("string", s); i = j + 1; continue;
    }
    // 数字（十进制字面量，绝不丢精度）
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      push("number", src.slice(i, j)); i = j; continue;
    }
    // 标识符 / 关键字
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      push(KEYWORDS.has(w) ? w : "ident", w); i = j; continue;
    }
    // 多字符运算符
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) { push("op", two); i += 2; continue; }
    if ("+-*/%<>!?:.,()".includes(c)) { push("op", c); i++; continue; }
    throw new Error(`E_PARSE: 非法字符 '${c}'`);
  }
  push("eof", null);
  return toks;
}

// ───────────────────────── Parser (递归下降) ─────────────────────────
function parse(src) {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v) => peek().type === "op" && peek().value === v;
  const eat = (v) => { if (!isOp(v)) throw new Error(`E_PARSE: 期望 '${v}'`); next(); };

  function expression() { return ternary(); }

  function ternary() {
    const cond = logicalOr();
    if (isOp("?")) {
      next();
      const a = expression();
      eat(":");
      const b = expression();
      return { k: "ternary", cond, a, b };
    }
    return cond;
  }
  function binLeft(sub, ops) {
    let left = sub();
    while (peek().type === "op" && ops.includes(peek().value)) {
      const op = next().value;
      left = { k: "bin", op, left, right: sub() };
    }
    return left;
  }
  const logicalOr = () => binLeft(logicalAnd, ["||"]);
  const logicalAnd = () => binLeft(equality, ["&&"]);
  const equality = () => binLeft(comparison, ["==", "!="]);
  const comparison = () => binLeft(additive, ["<", "<=", ">", ">="]);
  const additive = () => binLeft(multiplicative, ["+", "-"]);
  const multiplicative = () => binLeft(unary, ["*", "/", "%"]);

  function unary() {
    if (isOp("!") || isOp("-")) {
      const op = next().value;
      return { k: "unary", op, expr: unary() };
    }
    return primary();
  }

  function primary() {
    const t = peek();
    if (t.type === "number") { next(); return { k: "num", value: t.value }; }
    if (t.type === "string") { next(); return { k: "str", value: t.value }; }
    if (t.type === "true") { next(); return { k: "bool", value: true }; }
    if (t.type === "false") { next(); return { k: "bool", value: false }; }
    if (t.type === "null") { next(); return { k: "null" }; }
    if (isOp("(")) { next(); const e = expression(); eat(")"); return e; }
    // 函数调用 或 路径
    if (t.type === "ident" || ["root", "parent", "children", "value"].includes(t.type)) {
      const head = next().value;
      // 函数调用
      if (isOp("(")) {
        next();
        const args = [];
        if (!isOp(")")) {
          args.push(expression());
          while (isOp(",")) { next(); args.push(expression()); }
        }
        eat(")");
        return { k: "call", name: head, args };
      }
      // 路径
      const segs = [head];
      while (isOp(".")) { next(); segs.push(next().value); }
      return { k: "path", segs };
    }
    throw new Error(`E_PARSE: 非预期 token '${JSON.stringify(t)}'`);
  }

  const ast = expression();
  if (peek().type !== "eof") throw new Error("E_PARSE: 多余输入");
  return ast;
}

const astCache = new Map();
function parseCached(src) {
  let a = astCache.get(src);
  if (!a) { a = parse(src); astCache.set(src, a); }
  return a;
}

// ───────────────────────── Evaluator ─────────────────────────
// 值域: Decimal | string | boolean | null | Array(vector)
const isNum = (v) => v instanceof Decimal;

function toDec(v) {
  if (v === null) return null;
  if (isNum(v)) return v;
  if (typeof v === "string") return new Decimal(v);
  throw new Error("E_TYPE: 期望数值");
}

// ctx: { self, parent, root, value, warnings:[] }
function evalNode(n, ctx) {
  switch (n.k) {
    case "num": return new Decimal(n.value);     // §4.1 十进制字面量
    case "str": return n.value;
    case "bool": return n.value;
    case "null": return null;
    case "path": return evalPath(n.segs, ctx);
    case "call": return evalCall(n.name, n.args, ctx);
    case "unary": return evalUnary(n, ctx);
    case "bin": return evalBin(n, ctx);
    case "ternary": {
      const c = evalNode(n.cond, ctx);
      if (c === null) { ctx.warnings.push("W_NULL_PREDICATE"); return evalNode(n.b, ctx); } // §5.5
      return c === true ? evalNode(n.a, ctx) : evalNode(n.b, ctx);
    }
  }
  throw new Error("E_EVAL: 未知节点");
}

function evalPath(segs, ctx) {
  const head = segs[0];
  if (head === "value") return ctx.value;            // pipeline 隐式变量 §3
  let base;
  if (head === "root") base = ctx.root;
  else if (head === "parent") base = ctx.parent;
  else if (head === "children") {
    // children.field → vector
    const arr = ctx.self && ctx.self.__children ? ctx.self.__children : [];
    const field = segs[1];
    return arr.map((c) => (c[field] === undefined ? null : c[field]));
  } else {
    // 无前缀 → self 字段
    return readField(ctx.self, head, segs, 1);
  }
  // root./parent. 前缀
  return readField(base, segs[1], segs, 2);
}

function readField(obj, field, segs, nextIdx) {
  if (obj == null) return null;
  let v = obj[field];
  if (v === undefined) throw new Error(`E_UNKNOWN_PATH: ${segs.join(".")}`);
  return v === undefined ? null : v;
}

function evalUnary(n, ctx) {
  const v = evalNode(n.expr, ctx);
  if (v === null) return null;                       // §5.1
  if (n.op === "-") return toDec(v).neg();
  if (n.op === "!") return !(v === true);
}

function evalBin(n, ctx) {
  const op = n.op;
  // 逻辑短路 §5.4
  if (op === "&&") {
    const l = evalNode(n.left, ctx);
    if (l === false) return false;
    const r = evalNode(n.right, ctx);
    if (l === null || r === null) return null;
    return l === true && r === true;
  }
  if (op === "||") {
    const l = evalNode(n.left, ctx);
    if (l === true) return true;
    const r = evalNode(n.right, ctx);
    if (l === null || r === null) return null;
    return l === true || r === true;
  }
  const l = evalNode(n.left, ctx);
  const r = evalNode(n.right, ctx);
  // 相等：唯一能探测 null 的算子 §5.3
  if (op === "==" || op === "!=") {
    const eq = valueEq(l, r);
    return op === "==" ? eq : !eq;
  }
  // 算术 / 比较：任一 null
  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
    if (l === null || r === null) return null;        // §5.1
    const a = toDec(l), b = toDec(r);
    switch (op) {
      case "+": return a.plus(b);
      case "-": return a.minus(b);
      case "*": return a.times(b);
      case "/": if (b.isZero()) throw new Error("E_DIV_ZERO"); return a.div(b);
      case "%": if (b.isZero()) throw new Error("E_DIV_ZERO"); return a.mod(b);
    }
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    if (l === null || r === null) return false;       // §5.2
    const a = toDec(l), b = toDec(r);
    switch (op) {
      case "<": return a.lt(b);
      case "<=": return a.lte(b);
      case ">": return a.gt(b);
      case ">=": return a.gte(b);
    }
  }
  throw new Error(`E_EVAL: 未知算子 ${op}`);
}

function valueEq(l, r) {
  if (l === null || r === null) return l === null && r === null; // §5.3
  if (isNum(l) && isNum(r)) return l.eq(r);
  return l === r;
}

// ───────────────────────── Builtins §6 ─────────────────────────
function evalCall(name, argNodes, ctx) {
  // 聚合函数实参是 vector
  const args = argNodes.map((a) => evalNode(a, ctx));
  const fn = BUILTINS[name];
  if (!fn) throw new Error(`E_UNKNOWN_FN: ${name}`);
  return fn(args, ctx);
}

const nonNull = (vec) => vec.filter((x) => x !== null).map(toDec);

const BUILTINS = {
  // 聚合 §6.1
  sum: ([vec]) => nonNull(vec).reduce((a, b) => a.plus(b), new Decimal(0)),
  avg: ([vec]) => { const xs = nonNull(vec); return xs.length ? xs.reduce((a, b) => a.plus(b), new Decimal(0)).div(xs.length) : null; },
  min: ([vec]) => { const xs = nonNull(vec); return xs.length ? xs.reduce((a, b) => (a.lt(b) ? a : b)) : null; },
  max: ([vec]) => { const xs = nonNull(vec); return xs.length ? xs.reduce((a, b) => (a.gt(b) ? a : b)) : null; },
  count: ([vec]) => new Decimal(vec.length),
  countNonNull: ([vec]) => new Decimal(vec.filter((x) => x !== null).length),
  // 数学 §6.2
  round: ([x, n]) => (x === null ? null : toDec(x).toDecimalPlaces(Number(n.toString()), Decimal.ROUND_HALF_UP)),
  roundEven: ([x, n]) => (x === null ? null : toDec(x).toDecimalPlaces(Number(n.toString()), Decimal.ROUND_HALF_EVEN)),
  floor: ([x]) => (x === null ? null : toDec(x).floor()),
  ceil: ([x]) => (x === null ? null : toDec(x).ceil()),
  truncate: ([x]) => (x === null ? null : toDec(x).trunc()),
  abs: ([x]) => (x === null ? null : toDec(x).abs()),
  pow: ([x, n]) => (x === null ? null : toDec(x).pow(toDec(n))),
  clamp: ([x, lo, hi]) => { if (x === null) return null; let v = toDec(x); const a = toDec(lo), b = toDec(hi); if (v.lt(a)) v = a; if (v.gt(b)) v = b; return v; },
  idiv: ([a, b]) => { if (a === null || b === null) return null; const bb = toDec(b); if (bb.isZero()) throw new Error("E_DIV_ZERO"); return toDec(a).div(bb).trunc(); },
  // 字符串/集合 §6.3
  len: ([s]) => (s === null ? null : new Decimal([...String(s)].length)),
  contains: ([s, sub]) => (s === null || sub === null ? null : String(s).includes(String(sub))),
  startsWith: ([s, sub]) => (s === null || sub === null ? null : String(s).startsWith(String(sub))),
  endsWith: ([s, sub]) => (s === null || sub === null ? null : String(s).endsWith(String(sub))),
  in: (args) => { const [x, ...rest] = args; return rest.some((r) => valueEq(x, r)); },
  // 空值/类型 §6.4
  coalesce: (args) => { for (const a of args) if (a !== null) return a; return null; },
  isNull: ([x]) => x === null,
  isNotNull: ([x]) => x !== null,
  toDecimal: ([x]) => (x === null ? null : new Decimal(String(x))),
  toInt: ([x]) => (x === null ? null : toDec(x).trunc()),
  toString: ([x]) => (x === null ? null : fmt(x)),
};

// 输出格式化（Decimal → string），用于 message 插值/结果序列化 §9
function fmt(v) {
  if (v === null) return "null";
  if (isNum(v)) return v.toFixed();   // 定点字符串，无指数、无 locale
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

// ───────────────────────── 公共 API ─────────────────────────
export function evaluate(exprSrc, ctx) {
  const c = { self: null, parent: null, root: null, value: null, warnings: [], ...ctx };
  const ast = parseCached(exprSrc);
  const v = evalNode(ast, c);
  return { value: v, warnings: c.warnings };
}

export { fmt, parseCached };
