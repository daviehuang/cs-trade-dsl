# commonMixPayment —— 可复用「混合收费」组件（使用说明）

> 一个被**多场景复用**的收费组件：含多条收费明细（每条记金额），**币别**与**收费总额**从外部传入。
> 定义在独立文件 [`commonMixPayment.json`](./commonMixPayment.json)，按 `ref` 被各业务 RuleSet `import`。
>
> 核心思想：**组件零业务耦合**——它不知道币别/总额从哪来，只认两个"接缝"：
> `ctx.ccy`（场景币别）与 `extTotal`（按实例外部总额）。换场景只改接缝，组件文件一字不动。

---

## 一、先分清「外部传入」的 4 种机制

| 机制 | 适合什么 | 谁提供 | 例子 |
|---|---|---|---|
| `external:true` 字段 + `dataSources` | **异步**从数据服务取 | 宿主 `resolve` 回调 | 汇率、制裁评分 |
| **`context`（ctx.*）** | **整个场景共享的环境量**，自上而下流入被复用节点 | 宿主顶层 `context` 映射 | `ctx.ccy`、`ctx.valueDate` |
| 模块 `inputs` + `uses.bind/produce` | 把宿主字段绑进**参数化计算模块** | 宿主 `uses.bind` | `fxConvert` 的 amount/fromCcy |
| 普通 input 字段 | 用户录入 / 宿主按实例喂入 | 数据树 / 宿主 formula | `ChargeItem.amount`、`extTotal` |

**选择判据**
- **币别**——一个场景一个币别 → 用 **`context`（`ctx.ccy`）**；若每条明细币别不同且用户选 → 改成 `ChargeItem` 的 input 字段。
- **收费总额**——每个 MixPayment 实例可能不同（context 是**全局单值**喂不了多实例）→ 用 **`MixPayment.extTotal` 字段**，宿主按实例注入。
- **每条金额** → `ChargeItem.amount` 普通 input 字段。

---

## 二、组件结构（`commonMixPayment.json`）

```
nodes:
  MixPayment
    fields: extTotal(外部传入) · itemsTotal(自算,computed) · diff(自算,computed)
    children: items → ChargeItem
  ChargeItem
    fields: desc · amount(每条收费金额,输入)

rules:
  mixItemsTotal   formula  MixPayment  itemsTotal = round(sum(items.amount), 2)
  mixDiff         formula  MixPayment  diff       = round(extTotal - itemsTotal, 2)
  mixAmountPositive validation ChargeItem  amount > 0
  mixTotalMatch   validation MixPayment  extTotal==null || extTotal==0 || itemsTotal==extTotal
```

- **两个接缝**：规则里引用 `ctx.ccy`（消息插值/标识）与 `extTotal`（字段），组件**不规定它们从哪来**。
- `extTotal == null || extTotal == 0` 守卫：未传总额时**跳过对账**（组件依然能算 itemsTotal）。
- 消息可插值 `{itemsTotal}`、`{extTotal}`、`{diff}`、`{ctx.ccy}`。

---

## 三、场景如何接入（灵活性就在这里）

```json
{
  "ruleSetId": "tradeSettlement",
  "version": "1.0.0",
  "imports": [ { "ref": "commonMixPayment@1.0.0", "as": "mix" } ],

  "model": {
    "root": "Deal",
    "nodes": {
      "Deal": {
        "fields": {
          "dealCcy":   { "type": "string" },
          "agreedFee": { "type": "decimal" }
        },
        "children": [ { "name": "charges", "node": "MixPayment" } ]
      }
    }
  },

  "context": {
    "ccy": "root.dealCcy"
  },

  "rules": [
    { "id": "feedExtTotal", "type": "formula", "scope": "MixPayment", "trigger": "calc",
      "target": "extTotal", "expr": "parent.agreedFee" }
  ]
}
```

- **接缝①（币别）**：宿主顶层 `context.ccy` 映射到本场景币别来源（`root.dealCcy`）。换场景改成 `root.invoiceCcy` 即可。
- **接缝②（总额）**：把外部总额喂进每个实例的 `extTotal`。

### extTotal 的 3 种喂法（任选）

| 方式 | 怎么做 | 适用 |
|---|---|---|
| **数据树**（最简单） | 初值里直接给 `charges[i].extTotal` | 总额本就在提交数据里 |
| **宿主 formula 注入** | 宿主加规则 `scope:MixPayment, target:extTotal, expr:"parent.agreedFee"` | 总额来自宿主某字段/计算（已验证可用） |
| **模块 produce** | 若 MixPayment 由参数化模块产出，用 `uses.produce` 写回 | 组件被当作计算模块装配时 |

> 直接引用导入的节点类型 `MixPayment` 作为 `children`/`slots` 即可（与 `commonParty` 的 Party 一样）；
> `MixPayment` 自带的 `items` 子集合、规则会随类型一起生效。

---

## 四、变体

- **多组、各组币别不同**：把 `ccy` 从 context 改成 `MixPayment` 上的 input 字段（context 是全局单值，喂不了多实例），其余不变。
- **总额就是明细之和（无需外部）**：删掉 `extTotal` 与 `mixTotalMatch`，`itemsTotal` 即为总额。
- **明细带币种换算**：给 `ChargeItem` 加 `ccy` 字段，并 `import commonFx` 在 `ChargeItem` 上 `uses fx.fxConvert`（参考 `lc-rules.json`），把 amount 换算到 `ctx.ccy` 后再 `sum`。

---

## 五、治理

- **独立文件 + 独立版本**（`commonMixPayment@1.0.0`），与 `commonFx`/`commonParty` 一样按 `ref` 被多场景 import、独立升级、独立审计。
- **组件无业务耦合**：只认 `ctx.ccy` 与 `extTotal` 两个接缝；业务差异全在宿主侧的 context 映射 / extTotal 喂法里。
- 新派生值/校验要加 → 加在组件或宿主的 RuleSet 里（走规则版本治理），不在 UI 里写。

---

## 六、验证（已实测）

运行：

```bash
cd poc-incremental && node verify-mixpayment.mjs
```

实测结论（[`verify-mixpayment.mjs`](./verify-mixpayment.mjs)）：

1. `extTotal` 走**数据**：`itemsTotal = round(sum(items.amount),2) = 300`、`diff = 0`、`mixTotalMatch` 通过。
2. 不一致（合计 300 vs 外部 500）→ `mixTotalMatch` 失败，消息为
   `明细合计 300 与外部总额 500 USD 不一致（差 200）`（`{ctx.ccy}` 正确插值为场景币别 USD）。
3. 明细金额 `amount = 0` → `mixAmountPositive` 在该 `ChargeItem` 上失败。
4. `extTotal` 走**宿主 formula 注入**（`parent.agreedFee=300`）→ 组件 `extTotal=300`，对账通过。

## 七、HTML 示例中的应用

纯 HTML 示例 [`third-party-incremental.html`](./third-party-incremental.html) 末尾已接入本组件（页尾「混合收费 Mix Payment」面板，与 L/C 主流程**独立的第二个会话**）：

- 组件与场景作为运行时产物加载：`build-dist.mjs` 额外导出 `rules/commonMixPayment.rules.js`（`window.COMMON_MIX_PAYMENT`）与 `rules/mixDemo.rules.js`（`window.MIX_DEMO`）；HTML 用 `<script src>` 加载（生产改 fetch Rule Bundle API）。
- `UnifiedDSL.createSession(MIX_DEMO, data, { imports:{ commonMixPayment } })`，币别下拉驱动 `root.dealCcy`（→ `ctx.ccy`）、外部总额输入驱动 `root.agreedFee`（→ 宿主 formula 注入 `extTotal`）。
- 改明细金额可见 `itemsTotal`/`diff` 实时增量重算、`mixTotalMatch`/`mixAmountPositive` 校验联动。

跑：`node build-dist.mjs` 后用任意静态服务器打开该 HTML（如 `python -m http.server`）。
