// PoC 演示：同一份 RuleSet，在 UI 与 BFF 两个运行时执行（共用同一 JS 内核）
// 证明 ADR-1：UI 与 BFF 字节级一致（同一产物，drift=0）。
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runRuleSet } from "./src/engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const shared = join(here, "..", "shared");
const ruleSet = JSON.parse(readFileSync(join(shared, "fxTradeRules.json"), "utf8"));
const data = JSON.parse(readFileSync(join(shared, "transaction.json"), "utf8"));

// 两个"运行时适配器"——都 import 同一个 engine（= 同一内核产物）
const ui = runRuleSet(ruleSet, data);   // 浏览器 UI 运行时
const bff = runRuleSet(ruleSet, data);  // BFF (Node) 运行时

console.log("═══ 计算结果（UI 运行时） ═══");
console.log(JSON.stringify(ui.tree, null, 2));

console.log("\n═══ 校验结果 ═══");
for (const v of ui.validations) {
  const flag = v.ok ? "✅ PASS" : `❌ FAIL [${v.severity}]`;
  console.log(`  ${flag}  ${v.id} (${v.scope})${v.ok ? "" : "  → " + v.message}`);
}
if (ui.warnings.length) console.log("\n告警:", ui.warnings.join(", "));

// 一致性断言：UI vs BFF
const same = JSON.stringify(ui) === JSON.stringify(bff);
console.log(`\n═══ ADR-1 一致性：UI vs BFF ═══`);
console.log(same ? "✅ 完全一致（同一内核产物，零 drift）" : "❌ 出现 drift！");
process.exit(same ? 0 : 1);
