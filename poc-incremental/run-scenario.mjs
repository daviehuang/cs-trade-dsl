// 场景：验证「任意深度增量 + 异步 resolver」。L/C → 收费组 → 收费明细（3 层）+ 付费分支。
import { readFileSync } from "fs";
import { createSession } from "./src/incremental.js";
import { makeFxService } from "./src/fx-service.js";

const rules = JSON.parse(readFileSync(new URL("./lc-rules.json", import.meta.url)));
const data = JSON.parse(readFileSync(new URL("./lc-data.json", import.meta.url)));
const commonFx = JSON.parse(readFileSync(new URL("./commonFx.json", import.meta.url)));
const imports = { [`${commonFx.ruleSetId}@${commonFx.version}`]: commonFx };

let log = [];
const session = createSession(rules, data, { resolve: makeFxService({ delay: 200 }), imports, onLog: (e) => log.push(e) });
const banner = (t) => console.log("\n" + "═".repeat(66) + "\n" + t + "\n" + "═".repeat(66));
const ids = (entries) => [...new Set(entries.filter((e) => e.state !== "fetching").map((e) => e.id))];
const fxv = (c) => (c.state === "pending" ? "⏳" : c.state === "error" ? "✗" : c.value);

function dump(s) {
  const t = s.tree;
  console.log(`  LC ${t.fields.lcNo.value}  base=${t.fields.baseCcy.value}`);
  t.collections.charges.forEach((g, gi) => {
    console.log(`    收费组[${gi}] ${g.fields.groupName.value}  subtotal=${fxv(g.fields.subtotal)}`);
    g.collections.items.forEach((it, ii) =>
      console.log(`        明细[${ii}] ${it.fields.desc.value}  ${it.fields.ccy.value} ${it.fields.amount.value} × ${fxv(it.fields.fxRate)} = ${fxv(it.fields.base)}`));
  });
  t.collections.payments.forEach((p, pi) =>
    console.log(`    付费[${pi}] ${p.fields.ccy.value} ${p.fields.amount.value} → ${fxv(p.fields.base)}`));
  console.log(`  chargeTotal=${fxv(t.fields.chargeTotal)}  paymentTotal=${fxv(t.fields.paymentTotal)}  net=${fxv(t.fields.net)}`);
  console.log(`  校验: ` + s.validations.map((v) => `${v.id}:${v.state === "pending" ? "计算中" : v.ok ? "PASS" : "FAIL"}`).join("  "));
}

banner("T0  初次加载（所有 fxRate 异步取数，下游 pending）");
dump(session.getState());
await session.idle();
banner("T0'  汇率取回后结算");
dump(session.getState());

// T1：改最深层一条明细的金额 → 只应触及该明细链
banner("T1  改 root.charges[0].items[0].amount = 12000（三层深的一条明细）");
log = [];
session.setInput("root.charges[0].items[0].amount", "12000");
const touched = ids(log);
console.log("  → 重算字段:\n     " + touched.join("\n     "));
// 黑名单：只要不碰"其它明细 / 其它收费组 / 付费分支"即为增量正确
// （含本明细的模块子图 items[0].fx.* 与依赖 chargeTotal 的 adjustment，均属合法链路）
const leaked = touched.filter((id) =>
  /charges\[0\]\.items\[[1-9]/.test(id) || /charges\[[1-9]/.test(id) || id.startsWith("root.payments") || id === "root.paymentTotal");
console.log(leaked.length === 0
  ? "  ✅ 增量正确：仅该明细模块子图 → base → 组 subtotal → chargeTotal → adjustment/net → 校验；\n     未触碰 items[1]、charges[1]、payments、paymentTotal"
  : "  ❌ 泄漏到无关子树: " + leaked.join(", "));
dump(session.getState());

// T2：改一条明细的币种 → 触发该明细汇率异步重取，深链进入 pending
banner("T2  改 root.charges[1].items[0].ccy = GBP（触发该明细汇率重取）");
log = [];
session.setInput("root.charges[1].items[0].ccy", "GBP");
console.log("  → 受影响:", ids(log).join(", "));
console.log("  ↓ 该链进入计算中:"); dump(session.getState());
await session.idle();
banner("T2'  新汇率取回后结算");
dump(session.getState());

// T3：改付费金额 → 只应触及 payment 链与 net（不碰 charges）
banner("T3  改 root.payments[1].amount = 20000");
log = [];
session.setInput("root.payments[1].amount", "20000");
const t3 = ids(log);
console.log("  → 重算字段:", t3.join(", "));
console.log(t3.every((id) => !id.startsWith("root.charges"))
  ? "  ✅ 未触碰任何 charges 子树（只算 payment 链 + net + 校验）" : "  ❌ 触碰了 charges");
dump(session.getState());

// T4：往收费组[0] 增加一条明细 → 新明细异步取汇率，组小计/合计/净额增量更新
banner("T4  addChild：往 收费组[0] 加一条明细（电报费 USD 1000）");
log = [];
const newPath = session.addChild("root.charges[0]", "items", { desc: "电报费", ccy: "USD", amount: "1000.00" });
console.log("  新明细路径:", newPath, "  → 受影响:", ids(log).join(", "));
await session.idle();
banner("T4'  新明细汇率取回后结算");
dump(session.getState());
// 断言：新明细必须由 fxConvert 模块算出汇率与本币（防回归——曾因 addChild 未实例化 use 模块而恒为 null）
const added = session.getState().tree.collections.charges[0].collections.items.find((x) => x.path === newPath);
const addOk = added && added.fields.fxRate.value === "7.1234" && added.fields.base.value === "7123.4";
console.log(addOk
  ? "  ✅ 新明细模块已实例化：fxRate=7.1234 × 1000 = base 7123.4（自动计算）"
  : `  ❌ 新明细未自动计算：fxRate=${added?.fields.fxRate.value} base=${added?.fields.base.value}`);
console.log("  收费组[0] 明细数:", session.getState().tree.collections.charges[0].collections.items.length, "（应为 3）");

// T5：删除刚加的明细 → 小计/合计/净额退回，cell 被回收
banner("T5  removeChild：删除刚加的明细");
log = [];
session.removeChild(newPath);
console.log("  → 重算字段:", ids(log).join(", "));
const live = session._cells.has(newPath + ".base");
console.log(!live ? "  ✅ 已删明细的 cell 被回收（" + newPath + ".base 不存在）" : "  ❌ cell 残留");
dump(session.getState());
console.log("  收费组[0] 明细数:", session.getState().tree.collections.charges[0].collections.items.length, "（应回到 2）");
