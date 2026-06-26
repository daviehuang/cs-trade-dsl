// 对 golden 向量求值（JS 内核），与 expect 比对，并把 actual 落盘供跨语言比对。
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Decimal, evaluate, fmt } from "./src/kernel.js";

const here = dirname(fileURLToPath(import.meta.url));
const shared = join(here, "..", "shared");
const vectors = JSON.parse(readFileSync(join(shared, "golden.json"), "utf8"));

function bindVar(v) {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(bindVar);
  return new Decimal(String(v));       // golden 中字符串 = 十进制
}

const results = [];
let pass = 0;
for (const tc of vectors) {
  const self = {};
  for (const [k, v] of Object.entries(tc.vars || {})) self[k] = bindVar(v);
  let actual;
  try {
    actual = fmt(evaluate(tc.expr, { self }).value);
  } catch (e) {
    actual = String(e.message).split(":")[0]; // 错误码
  }
  const ok = actual === tc.expect;
  if (ok) pass++;
  results.push({ id: tc.id, expr: tc.expr, expect: tc.expect, actual, ok });
  console.log(`  ${ok ? "✅" : "❌"} ${tc.id.padEnd(18)} = ${actual}${ok ? "" : `  (期望 ${tc.expect})`}`);
}

writeFileSync(join(shared, "golden.actual.js.json"), JSON.stringify(results, null, 2));
console.log(`\nJS 内核: ${pass}/${vectors.length} 通过`);
process.exit(pass === vectors.length ? 0 : 1);
