// 场景：验证「节点类型继承(extends) + 抽象基类 + 具名槽位(slots)」。
//   Party(抽象) ← CustomerParty / BankParty；LetterOfCredit 用 5 个具名槽位引用具体子类型。
//   断言：基类校验作用到全员、子类型校验只作用到对应类型、跨槽位表达式可用。
import { readFileSync } from "fs";
import { createSession } from "./src/incremental.js";
import { makeFxService } from "./src/fx-service.js";

const J = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url)));
const rules = J("./lc-rules.json"), data = J("./lc-data.json"), fx = J("./commonFx.json");
const imports = { [`${fx.ruleSetId}@${fx.version}`]: fx };

const s = createSession(rules, data, { resolve: makeFxService({ delay: 30 }), imports });
await s.idle();
const banner = (t) => console.log("\n" + "═".repeat(66) + "\n" + t + "\n" + "═".repeat(66));
let pass = true;
const check = (ok, msg) => { console.log((ok ? "  ✅ " : "  ❌ ") + msg); pass = pass && ok; };

banner("T0  结构：5 个具名槽位，字段 = 基类 + 子类型合并");
const slots = s.getState().tree.slots;
console.log("  槽位:", Object.keys(slots).join(", "));
console.log("  applicant(CustomerParty)  字段:", Object.keys(slots.applicant.fields).join(","));
console.log("  advisingBank(BankParty)   字段:", Object.keys(slots.advisingBank.fields).join(","));
check(slots.applicant.type === "CustomerParty" && "taxId" in slots.applicant.fields && "name" in slots.applicant.fields,
  "客户槽位 = CustomerParty，含继承字段 name + 自有字段 taxId");
check(slots.advisingBank.type === "BankParty" && "bic" in slots.advisingBank.fields && !("taxId" in slots.advisingBank.fields),
  "银行槽位 = BankParty，含 bic、不含 taxId");

banner("T1  校验按继承层级分发（基类全员 / 子类型专有）");
const byNode = {};
for (const v of s.getState().validations) (byNode[v.node] ||= []).push(v.id.replace(/.*\./, ""));
const ids = (p) => (byNode["root." + p] || []).sort().join(",");
console.log("  applicant   :", ids("applicant"));
console.log("  advisingBank:", ids("advisingBank"));
check(ids("applicant") === "custTaxId,partyCountry,partyName", "客户 = 基类(name,country) + 客户(taxId)，无银行规则");
check(ids("advisingBank") === "bankBicFmt,bankBicReq,partyCountry,partyName", "银行 = 基类(name,country) + 银行(bic必填,格式)，无客户规则");

banner("T2  初始数据全部合规");
const fails0 = s.getState().validations.filter((v) => v.state === "resolved" && !v.ok);
check(fails0.length === 0, "初始无失败校验（" + fails0.length + " 个失败）");

banner("T3  跨槽位表达式：偿付行名 = 通知行名 → reimbVsAdvising 失败");
s.setInput("root.advisingBank.name", "Citibank N.A.");
await s.idle();
const cross = s.getState().validations.find((v) => v.id === "reimbVsAdvising");
check(cross && !cross.ok, "reimbVsAdvising 触发：" + (cross && cross.message));
s.setInput("root.advisingBank.name", "Deutsche Bank AG"); await s.idle();

banner("T4  子类型字段隔离：清空某行 BIC → 仅该行 bankBicReq 失败");
s.setInput("root.adviseThrough.bic", "");
await s.idle();
const bicFails = s.getState().validations.filter((v) => v.id === "bankBicReq" && v.state === "resolved" && !v.ok);
check(bicFails.length === 1 && bicFails[0].node === "root.adviseThrough", "只 adviseThrough 失败：" + bicFails.map((v) => v.node).join(","));

console.log("\n" + (pass ? "✅ 继承 + 抽象 + 具名槽位：全部通过" : "❌ 有断言失败"));
process.exit(pass ? 0 : 1);
