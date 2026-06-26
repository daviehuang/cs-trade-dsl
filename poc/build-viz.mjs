// 生成自包含的 viz.html：内联 decimal.js(UMD) + 真实 kernel.js/engine.js + 数据 + UI 应用。
// 内核从真实源码生成（剥离 import/export），保证页面与 PoC/BFF 用的是同一份逻辑，不分叉。
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

// 把 ESM 模块剥离成可在 classic <script> 里顺序拼接的普通代码
function strip(src) {
  return src
    .replace(/^[ \t]*import\b[^\n]*\n/gm, "")                        // 删 import 行（\b 不误伤 importX 标识符）
    .replace(/^[ \t]*export[ \t]*\{[^}]*\}[ \t]*;?[ \t]*\n/gm, "")   // 删 export {..}
    .replace(/^([ \t]*)export[ \t]+(function|const|let|class)/gm, "$1$2"); // export fn → fn
}

const decimalUMD = read("js/node_modules/decimal.js/decimal.js");
const kernel = strip(read("js/src/kernel.js"));
const engine = strip(read("js/src/engine.js"));
const app = read("viz-app.js");
const ruleset = read("shared/fxTradeRules.json");
const transaction = read("shared/transaction.json");

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>统一业务规则 DSL · 校验逻辑可视化</title>
<style>
  :root { --bg:#0f1117; --card:#1a1d27; --line:#2a2f3d; --txt:#e6e9ef; --mut:#8a90a2;
          --accent:#5b9dff; --pass:#2ecc71; --fail:#ff5d5d; --warn:#f5a623; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt);
         font-family:"Segoe UI",system-ui,-apple-system,sans-serif; line-height:1.5; }
  .wrap { max-width:1080px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:var(--mut); font-size:13px; margin-bottom:22px; }
  .sub code { color:var(--accent); }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:860px){ .grid{ grid-template-columns:1fr; } }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; }
  .card h2 { font-size:14px; margin:0 0 14px; color:var(--mut); text-transform:uppercase; letter-spacing:.06em; }
  .field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; font-size:13px; }
  .field span { color:var(--mut); }
  input { background:#0f1117; border:1px solid var(--line); color:var(--txt);
          border-radius:7px; padding:7px 9px; font-size:14px; font-family:ui-monospace,monospace; }
  input:focus { outline:none; border-color:var(--accent); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--mut); font-weight:500; padding:6px 8px; border-bottom:1px solid var(--line); font-size:12px; }
  td { padding:5px 8px; border-bottom:1px solid var(--line); }
  td.idx { color:var(--mut); width:24px; }
  td.comp { font-family:ui-monospace,monospace; color:var(--accent); }
  tr.overlimit td.comp[data-kind="charge"] { color:var(--fail); font-weight:700; }
  td input { width:90px; }
  button { background:#222838; border:1px solid var(--line); color:var(--txt);
           border-radius:7px; padding:6px 12px; cursor:pointer; font-size:13px; }
  button:hover { border-color:var(--accent); }
  .del { padding:2px 8px; color:var(--mut); }
  .total { font-size:30px; font-family:ui-monospace,monospace; color:var(--accent); }
  .badge { display:inline-block; padding:2px 9px; border-radius:20px; font-size:12px; font-weight:600; }
  .badge.pass { background:rgba(46,204,113,.15); color:var(--pass); }
  .badge.fail { background:rgba(255,93,93,.15); color:var(--fail); }
  .badge.warn { background:rgba(245,166,35,.15); color:var(--warn); }
  ul.vlist { list-style:none; padding:0; margin:0; }
  .vrow { display:flex; align-items:center; gap:9px; padding:7px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .vrow code { color:var(--txt); }
  .scope { color:var(--mut); font-size:12px; }
  .msg { color:var(--fail); }
  .ok-text { color:var(--mut); }
  .full { grid-column:1 / -1; }
  .srv { display:flex; gap:26px; align-items:center; flex-wrap:wrap; }
  .srv .k { color:var(--mut); font-size:12px; display:block; }
  details { margin-top:10px; } summary { cursor:pointer; color:var(--mut); font-size:13px; }
  pre { background:#0f1117; border:1px solid var(--line); border-radius:8px; padding:12px;
        overflow:auto; font-size:12px; max-height:320px; }
  .err { color:var(--fail); font-size:13px; min-height:18px; }
  .hint { color:var(--mut); font-size:12px; margin-top:6px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>统一业务规则 DSL · 校验逻辑可视化</h1>
  <div class="sub">本页是 <b>UI 运行时</b>，直接调用内联的真实内核 <code>runRuleSet()</code>
    —— 与 PoC / BFF / 中台用的是同一份规则逻辑（ADR-1 路线 B）。改任意输入即实时重算。</div>

  <div class="grid">
    <div class="card">
      <h2>主记录 Transaction</h2>
      <div id="parent"></div>
    </div>

    <div class="card">
      <h2>合计 & 中台裁决</h2>
      <div class="total" id="total">—</div>
      <div class="hint">total = round((Σcharge + Σfee) × (1 + taxRate), 2)</div>
      <div class="srv" style="margin-top:16px;">
        <div><span class="k">中台复算 total</span><span id="serverTotal" style="font-family:ui-monospace,monospace;">—</span></div>
        <div><span class="k">中台裁决</span><span id="serverVerdict">—</span></div>
      </div>
      <div style="margin-top:12px;" id="consistency"></div>
      <div class="hint">中台与 UI 用同一内核 → 同输入必同输出（此处为同进程演示；生产中是 Java/WASM）。</div>
    </div>

    <div class="card full">
      <h2>子项 TradeLine（charge = amount × rate，fee = calcFee(charge) = 1%）</h2>
      <table>
        <thead><tr><th>#</th><th>amount</th><th>rate</th><th>charge（计算）</th><th>fee（计算）</th><th></th></tr></thead>
        <tbody id="childBody"></tbody>
      </table>
      <div style="margin-top:12px;"><button id="addChild">+ 添加子项</button></div>
      <div class="hint">charge 超过 maxCharge 的子项会标红（对应规则 chargeCeiling）。</div>
    </div>

    <div class="card full">
      <h2>校验结果（实时）</h2>
      <ul class="vlist" id="validations"></ul>
      <div class="err" id="error"></div>
      <div class="hint" id="warnings"></div>
    </div>

    <div class="card full">
      <h2>当前规则集 RuleSet</h2>
      <details><summary>展开查看驱动本页的 DSL（点开）</summary><pre id="rulesetDump"></pre></details>
    </div>
  </div>
</div>

<script>
/* ===== 内联 decimal.js (UMD) ===== */
${decimalUMD}
</script>
<script>
/*KERNEL-START*/
/* ===== 真实内核：kernel.js（剥离 import/export 后内联）===== */
${kernel}
/* ===== 真实引擎：engine.js（剥离 import/export 后内联）===== */
${engine}
/*KERNEL-END*/
window.__RULESET__ = ${ruleset};
window.__INIT__ = ${transaction};
</script>
<script>
/* ===== UI 应用 ===== */
${app}
</script>
</body>
</html>`;

writeFileSync(join(here, "viz.html"), html);
console.log(`✅ 已生成 viz.html (${(html.length / 1024).toFixed(0)} KB) —— 双击即可在浏览器打开`);
