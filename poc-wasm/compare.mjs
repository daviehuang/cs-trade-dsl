// 路线 B 真身裁决：同一个 kernel.wasm，在 Node(UI/BFF) 与 JVM(中台) 两个宿主的输出逐条比对。
import { readFileSync } from "fs";
const node = JSON.parse(readFileSync(new URL("./results.node.json", import.meta.url)));
const java = JSON.parse(readFileSync(new URL("./results.java.json", import.meta.url)));
const jById = new Map(java.map((r) => [r.id, r]));

let agree = 0, diverge = 0;
console.log("用例                 Node(UI/BFF) raw     JVM(中台) raw        十进制         一致?");
console.log("─".repeat(86));
for (const r of node) {
  const o = jById.get(r.id);
  const same = o && o.raw === r.raw;
  if (same) agree++; else diverge++;
  console.log(
    `${r.id.padEnd(20)}${String(r.raw).padStart(14)}     ${String(o ? o.raw : "—").padStart(14)}     ${String(r.decimal).padEnd(12)} ${same ? "✅" : "❌ DRIFT"}`
  );
}
console.log("─".repeat(86));
console.log(`\n同一 wasm 二进制 · 跨宿主一致: ${agree}/${node.length} | drift: ${diverge}`);
console.log(diverge === 0
  ? "\n✅ 路线 B 真身验证通过：单一 kernel.wasm 在 Node 与 JVM 上逐位一致——\n   不是两套实现互相对齐，而是同一份编译产物跑两处。"
  : "\n❌ 跨宿主出现 drift。");
process.exit(diverge === 0 ? 0 : 1);
