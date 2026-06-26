// 跨语言一致性裁决：逐条比对 JS 内核(UI/BFF) 与 Java 内核(中台) 的 golden 产物。
import { readFileSync } from "fs";
const js = JSON.parse(readFileSync(new URL("./shared/golden.actual.js.json", import.meta.url)));
const jv = JSON.parse(readFileSync(new URL("./shared/golden.actual.java.json", import.meta.url)));

const jvById = new Map(jv.map((r) => [r.id, r]));
let agree = 0, diverge = 0;
console.log("ID                  JS(UI/BFF)                       Java(中台)                       一致?");
console.log("─".repeat(95));
for (const r of js) {
  const o = jvById.get(r.id);
  const same = o && o.actual === r.actual;
  if (same) agree++; else diverge++;
  console.log(
    `${r.id.padEnd(20)}${String(r.actual).padEnd(33)}${String(o ? o.actual : "—").padEnd(33)}${same ? "✅" : "❌ DRIFT"}`
  );
}
console.log("─".repeat(95));
console.log(`\n跨语言一致: ${agree}/${js.length}  |  drift: ${diverge}`);
console.log(diverge === 0
  ? "\n✅ ADR-1 验证通过：JS(UI+BFF) 与 Java(中台) 对同一规则逐位一致，零 drift。"
  : "\n❌ 检测到跨语言 drift —— golden 测试成功拦截了它（正是它的职责）。");
process.exit(diverge === 0 ? 0 : 1);
