// 打包引擎为第三方可用的发行版：dist/unified-dsl.js
// 一个文件 + 一个全局变量 UnifiedDSL，第三方一个 <script> 标签即可用。
// 内核仍来自真实 kernel.js/engine.js（单源），decimal.js 内联且不污染全局。
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

function strip(src) {
  return src
    .replace(/^[ \t]*import\b[^\n]*\n/gm, "")
    .replace(/^[ \t]*export[ \t]*\{[^}]*\}[ \t]*;?[ \t]*\n/gm, "")
    .replace(/^([ \t]*)export[ \t]+(function|const|let|class)/gm, "$1$2");
}

const decimalUMD = read("js/node_modules/decimal.js/decimal.js");
const kernel = strip(read("js/src/kernel.js"));
const engine = strip(read("js/src/engine.js"));

const bundle = `/*!
 * Unified Business Rule DSL —— Engine (browser distributable)
 * 用法：<script src="unified-dsl.js"></script> 然后调用 window.UnifiedDSL.runRuleSet(ruleSet, data)
 * 本文件由 build-dist.mjs 从真实内核源码生成，请勿手改。
 */
;(function (global) {
  // ── 内联 decimal.js，捕获到闭包内（不污染第三方全局）──
  var Decimal;
  (function () {
    var module = { exports: {} }, exports = module.exports;
    ${decimalUMD}
    Decimal = module.exports;
  })();

  // ── 真实内核 kernel.js（剥离模块语法）──
  ${kernel}

  // ── 真实引擎 engine.js（剥离模块语法）──
  ${engine}

  // ── 对外 API ──
  global.UnifiedDSL = {
    version: "0.1.0",
    runRuleSet: runRuleSet,   // (ruleSet, data) -> { tree, validations, warnings }
    evaluate: evaluate,       // (exprString, ctx) -> { value, warnings }
    fmt: fmt,                 // Decimal/值 -> 显示字符串
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
`;

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist/unified-dsl.js"), bundle);
console.log(`✅ 已生成 dist/unified-dsl.js (${(bundle.length / 1024).toFixed(0)} KB)`);
