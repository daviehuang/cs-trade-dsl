// 宿主 A：Node（代表 UI + BFF）加载同一个 kernel.wasm 执行
import { readFileSync, writeFileSync } from "fs";

const wasmBytes = readFileSync(new URL("./kernel.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const k = instance.exports; // dadd/dsub/dmul/ddiv/dround，i64 ↔ BigInt

const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const SCALE = 1000000n;
const dec = (scaled) => {
  const neg = scaled < 0n; let v = neg ? -scaled : scaled;
  const i = v / SCALE, f = (v % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + i.toString() + (f ? "." + f : "");
};

const results = [];
for (const c of cases) {
  const a = BigInt(c.a);
  let raw;
  switch (c.op) {
    case "dadd": raw = k.dadd(a, BigInt(c.b)); break;
    case "dsub": raw = k.dsub(a, BigInt(c.b)); break;
    case "dmul": raw = k.dmul(a, BigInt(c.b)); break;
    case "ddiv": raw = k.ddiv(a, BigInt(c.b)); break;
    case "dround": raw = k.dround(a, c.n); break;
  }
  const r = raw.toString();
  results.push({ id: c.id, raw: r, decimal: dec(raw) });
  console.log(`  ${c.id.padEnd(18)} raw=${r.padStart(12)}  = ${dec(raw).padEnd(12)} (${c.note})`);
}
writeFileSync(new URL("./results.node.json", import.meta.url), JSON.stringify(results, null, 2));
console.log(`\nNode(UI/BFF) over kernel.wasm: ${results.length} 用例完成`);
