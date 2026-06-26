// 打包【增量引擎】为第三方可用发行版：dist/unified-dsl-incremental.js
// 暴露全局 UnifiedDSL.createSession。注意：不含汇率服务——数据源(resolve)由第三方提供。
// 同时把规则集导出成"运行时加载的独立产物" rules/lcSettlement.rules.js（生产中用 fetch Rule Bundle API 取代）。
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const strip = (s) => s
  .replace(/^[ \t]*import\b[^\n]*\n/gm, "")   // \b：只删 import 语句，不误伤 importedModules 等标识符
  .replace(/^[ \t]*export[ \t]*\{[^}]*\}[ \t]*;?[ \t]*\n/gm, "")
  .replace(/^([ \t]*)export[ \t]+(function|const|let|class)/gm, "$1$2");

const decimalUMD = read("node_modules/decimal.js/decimal.js");
const kernel = strip(read("src/kernel.js"));
const incremental = strip(read("src/incremental.js"));

const bundle = `/*!
 * Unified Business Rule DSL —— 增量引擎 (browser distributable)
 * 用法：<script src="unified-dsl-incremental.js"></script>
 *   const session = UnifiedDSL.createSession(ruleSet, data, { resolve, onUpdate, onLog });
 *   session.setInput("charges[0].amount", "8000");
 *   resolve(source, key) 由你提供：返回 Promise<{ value, asOf, rateId }>（你的汇率/参考数据服务）
 * 本文件由 build-dist.mjs 从真实内核源码生成，勿手改。
 */
;(function (global) {
  var Decimal;
  (function () { var module = { exports: {} }, exports = module.exports; ${decimalUMD}
    Decimal = module.exports; })();
  ${kernel}
  ${incremental}
  global.UnifiedDSL = { version: "0.1.0-incremental", createSession: createSession };
})(typeof window !== "undefined" ? window : globalThis);
`;

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist/unified-dsl-incremental.js"), bundle);
console.log(`✅ dist/unified-dsl-incremental.js (${(bundle.length / 1024).toFixed(0)} KB)`);

// 规则集作为"运行时加载的独立产物"导出（页面不含规则内容）
mkdirSync(join(here, "rules"), { recursive: true });
const rules = read("lc-rules.json");
writeFileSync(join(here, "rules/lcSettlement.rules.js"),
  `// 运行时加载的规则产物（生产中由 Rule Bundle API 下发：fetch('/rulesets/lcSettlement@active')）\nwindow.LC_RULES = ${rules};\n`);
writeFileSync(join(here, "rules/lcSettlement.json"), rules); // 同时留 JSON，供 fetch 方式
console.log("✅ rules/lcSettlement.rules.js + lcSettlement.json");

// 模块库作为独立产物导出（被 lcSettlement import）
const commonFx = read("commonFx.json");
writeFileSync(join(here, "rules/commonFx.rules.js"),
  `// 模块库产物（生产中由 Rule Bundle API 下发：fetch('/rulesets/commonFx@1.0.0')）\nwindow.COMMON_FX = ${commonFx};\n`);
writeFileSync(join(here, "rules/commonFx.json"), commonFx);
console.log("✅ rules/commonFx.rules.js + commonFx.json（模块库）");

// 类型库作为独立产物导出（被 lcSettlement import：Party/Customer/Bank 节点类型 + 通用校验）
const commonParty = read("commonParty.json");
writeFileSync(join(here, "rules/commonParty.rules.js"),
  `// 类型库产物（生产中由 Rule Bundle API 下发：fetch('/rulesets/commonParty@1.0.0')）\nwindow.COMMON_PARTY = ${commonParty};\n`);
writeFileSync(join(here, "rules/commonParty.json"), commonParty);
console.log("✅ rules/commonParty.rules.js + commonParty.json（类型库）");
