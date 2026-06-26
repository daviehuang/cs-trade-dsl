// 把唯一源码 kernel.wat 编译成单个 kernel.wasm（路线 B 的"单源→产物"）
import wabtInit from "wabt";
import { readFileSync, writeFileSync } from "fs";

const wabt = await wabtInit();
const wat = readFileSync(new URL("./src/kernel.wat", import.meta.url), "utf8");
const mod = wabt.parseWat("kernel.wat", wat);
const { buffer } = mod.toBinary({});
writeFileSync(new URL("./kernel.wasm", import.meta.url), Buffer.from(buffer));
console.log(`✅ 已生成 kernel.wasm (${buffer.length} 字节)`);
