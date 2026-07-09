# 统一业务规则 DSL —— 可复用规则模块与跨 RuleSet 复用（设计方案）

> 状态：Draft v0.2 —— §3-6 机制**已在 `poc-incremental` 增量引擎实现并实测**（见 §11.5）；
> JSON Schema 形式化与跨边界治理（lint/钻石依赖等）仍为提案。
> 关联：[架构](./unified_dsl_architecture.md) · [Schema](./unified_dsl_schema.md) · [异步/规模补充](./unified_dsl_async_scale.md)
> 解决的问题：规则复用时**不知道会被用在 model 的哪一层**，复用规则又常需要跨节点数据，怎么办。

---

## 0. 一句话立意

> **复用的规则只对"抽象名字"编程（位置无关）；"它在哪一层、连哪个字段"的知识，放到使用点（绑定）。**
> 跨切面的头部数据（币种、日期、实体）走**环境上下文 `ctx`**；关系型数据走**参数绑定**。

这与"函数/组件"完全同构：函数体用形参名，调用方传实参。

---

## 1. 背景：为什么不能直接写 `parent` / 路径

现在规则里跨节点是**位置引用**：`parent.x` / `root.x` / `children.x`。
- `parent.x` 依赖**确切层级** → 同一规则复用到不同深度，含义不同 → 复用即失效。
- `root.x` 相对稳定，但前提是"顶上恰好有这个字段"。

> 复用的目标是**位置无关（position-independent）**：一段规则逻辑，能挂在 model 的任意节点类型上而行为不变。
> 为此，复用规则**不得**出现 `parent` / `children` / 具体路径——它只能引用自己的"输入、局部、`ctx`"。

---

## 2. 三件套：Module / Binding / Context

| 概念 | 作用 | 类比 |
|------|------|------|
| **Module（规则模块）** | 位置无关的可复用单元：声明**接口（inputs/outputs）+ 内部规则** | 函数定义 |
| **Use / Binding（使用点绑定）** | 在某 RuleSet 的某 scope 上**实例化模块**，把抽象输入绑到实际字段 | 函数调用（传实参） |
| **Context `ctx`（环境上下文）** | 跨切面头部数据（币种/日期/实体），到处可见、位置无关 | 环境变量 / React Context |

数据分两类，各有归宿：

| 跨节点数据 | 例子 | 复用规则怎么拿 |
|---|---|---|
| **头部/环境**（跨切面） | baseCcy、valueDate、entity | **`ctx.*`**（RuleSet 声明一次，映射到来源） |
| **关系型**（依赖位置） | 父字段、兄弟聚合、本笔金额 | **参数绑定**（使用点提供，可用 host 的 root/parent/self） |

---

## 3. Module 定义

模块声明**接口**与**内部规则**，内部规则只用：`inputs`、模块局部字段、`ctx.*`。**禁止** `root/parent/children`。

```jsonc
{
  "moduleId": "fxConvert",
  "version": "1.0.0",
  "inputs":  { "amount": "decimal", "fromCcy": "string", "toCcy": "string" }, // 接口：需要什么
  "context": ["valueDate"],                       // 需要哪些 ctx 头部数据
  "dataSources": ["fxRateService"],               // 引用的外部数据源（治理同 §架构6）
  "fields": {                                     // 模块内部/输出字段
    "rate": { "type": "decimal", "external": true },
    "base": { "type": "decimal", "computed": true }
  },
  "rules": [
    { "id": "rate", "type": "resolver", "target": "rate", "source": "fxRateService",
      "key": { "from": "fromCcy", "to": "toCcy", "valueDate": "ctx.valueDate" } },
    { "id": "base", "type": "formula", "target": "base", "expr": "amount * rate" }
  ],
  "outputs": ["base", "rate"]                     // 对外暴露什么
}
```

要点：
- 内部规则里的 `amount/fromCcy/toCcy` 是**输入名**，`rate/base` 是**模块局部名**，`ctx.valueDate` 是头部数据——**全是抽象名，没有任何树路径**。
- 模块**位置无关**：它不知道自己会挂在 `ChargeItem` 还是 `Payment` 还是别的层。

---

## 4. 使用点绑定：`use … on … bind … produce`

在 host RuleSet 里实例化模块。**绑定表达式在 host 的作用域里求值**，所以可以用 host 的 `self / root / parent / ctx`——使用点知道树形状。

```jsonc
{
  "use": "fx.fxConvert",          // 引用模块（fx 是 import 别名，见 §6）
  "on": "ChargeItem",             // 作用 scope（host 的节点类型）
  "as": "itemFx",                 // 实例命名空间（防冲突）
  "bind": {                       // 模块输入 ← host 表达式（在 host 节点上求值）
    "amount": "amount",
    "fromCcy": "ccy",
    "toCcy": "ctx.baseCcy"
  },
  "produce": {                    // 模块输出 → host 字段
    "rate": "fxRate",
    "base": "base"
  }
}
```

同一个模块换个绑定即可复用到别的层：

```jsonc
{ "use": "fx.fxConvert", "on": "Payment",
  "bind": { "amount": "amount", "fromCcy": "ccy", "toCcy": "ctx.baseCcy" },
  "produce": { "rate": "fxRate", "base": "base" } }
```

> **关键分工**：模块 = 对抽象名编程；绑定 = 知道"在哪层、连哪个字段"的接线。两者解耦。

---

## 5. Context `ctx`：跨切面头部数据

RuleSet 声明一次 `ctx` 到来源的映射；模块与规则到处可用 `ctx.*`，**与位置无关**。
两种写法要分清：

```jsonc
// 场景 / 库 RuleSet —— 映射形式 { 名: 表达式 }：提供值
"context": {
  "baseCcy":   "root.baseCcy",       // 映射到 model 字段
  "valueDate": "root.valueDate",
  "entity":    "root.entity"
}
```
```jsonc
// 模块 —— 数组形式 [名]：声明依赖（"我用到哪些 ctx"，宿主须提供同名值）
"context": ["valueDate"]
```

- 来源可以是 `root.*` 字段，也可以是**注入值**（如 `businessDate` 由运行时注入，呼应 ADR-7 的"外部数据=注入输入"）。
- `ctx` 是**只读**的；它是"头部快照"，不被规则改写。

### 5.1 作用域：全局 / 位置无关（实现见 §11.5）
- 引擎为每个 `context` 项建一个 `__ctx.<名>` **计算 cell**，表达式在 **root 作用域**求值（如 `ctx.baseCcy = root.baseCcy`）。
- 求值上下文向**每个节点**注入 `ctx`，所以任意深度的任意节点、任意规则都能直接读 `ctx.*`——不管它在树的哪个位置。
- 对比：普通字段是**节点实例局部**的（`root.charges[0].items[0].amount` 只在那条明细存在）；`ctx.*` 是**环境作用域**、全局可读。
- `ctx` 是**响应式单一源**：改 `root.baseCcy` → `ctx.baseCcy` 重算 → 所有消费者自动更新。

### 5.2 为什么要 ctx，而不是全用 `input + bind`
`ctx` 在功能上**可以**用 `input + bind` 等价实现（把 `valueDate` 声明成 input，每个 use 去 bind）。但这样：
- 同一模块挂多处（fxConvert on ChargeItem + on Payment = 两次 uses）→ `valueDate` 要 **bind 两次**；多模块多宿主 → 绑 N 次，分散、易漏、易写歪。
- `ctx` 把它**定义一次**，所有读 `ctx.valueDate` 的模块/规则自动拿到，**零重复绑定**。

更本质：`ctx` 是对**两类输入的刻意分离**——

| | `input + bind` | `ctx / context` |
|---|---|---|
| 性质 | **每处不同的实例参数** | **整单一致的头部/环境值** |
| 例子 | `amount`（每行金额）、`fromCcy`（每行币种） | `baseCcy`、`valueDate`、`entity` |
| 绑定 | **必须**逐处显式绑（本来就不一样） | 定义一次，`ctx.*` 全局取 |

> **经验法则**：值**因挂载点/节点而异** → `input + bind`；值是**整单统一的头部/环境** → `context`。
> 把头部数据硬塞成 input 也能跑，但会丢掉"这是整单属性、不该逐行变"的语义，也失去单一响应式源的好处。

### 5.3 context 跟随 RuleSet，但 ctx 名字是共享契约
- `context` **映射**是 **per-RuleSet** 的：换/建另一个 RuleSet，要在它自己里定义 context，映射到**它自己的 model 字段**。
- 但 **ctx 的名字是跨 RuleSet 的共享接口**——你复用的模块/库声明要用 `ctx.valueDate`，那任何宿主 RuleSet 都必须提供**同名**的 `valueDate`（否则模块取数拿到 undefined）。

  ```jsonc
  // ruleset A（信用证）                          // ruleset B（保函，字段叫 issueDate）
  "context": { "valueDate": "root.valueDate" }    "context": { "valueDate": "root.issueDate" }
  ```
  名字都得是 `valueDate`（模块认这个），映射各自指向自己的字段。
- **库可带默认**：`mergedContext = { ...import 的库 context, ...本 RuleSet 的 context }`——import 的库可提供部分 ctx 默认，场景只需补充/覆盖，不必全从零写。

> 一句话：**ctx 名字 = 跨 RuleSet 的共享接口（由模块/库约定、须一致）；context 映射 = 每个 RuleSet 各自把这些名字接到自己模型的哪个字段。**

---

## 6. 跨 RuleSet 引用：`imports` + 命名空间 + 版本锁定

模块可以集中在"模块库 RuleSet"里，由对应团队治理；产品 RuleSet 引用它们。

```jsonc
{
  "ruleSetId": "lcSettlement", "version": "2.4.0",
  "imports": [
    { "ref": "commonFx@1.0.0",     "as": "fx" },     // 公共汇率库（财务/中台团队）
    { "ref": "compliance@3.2.0",   "as": "comp" }    // 合规库（合规团队）
  ],
  "context": { "baseCcy": "root.baseCcy", "valueDate": "root.valueDate" },
  "model": { ... },
  "uses": [
    { "use": "fx.fxConvert", "on": "ChargeItem",
      "bind": { "amount": "amount", "fromCcy": "ccy", "toCcy": "ctx.baseCcy" },
      "produce": { "rate": "fxRate", "base": "base" } },
    { "use": "comp.sanctionsCheck", "on": "LetterOfCredit",
      "bind": { "party": "applicant", "country": "issueCountry" },
      "produce": { "blocked": "complianceBlocked" } }
  ],
  "rules": [ /* host 专有规则 */ ]
}
```

- `ref: id@version` —— **版本锁定**，保证可复现；后续可评估范围依赖。
- `as` —— **命名空间别名**，避免模块/规则 id 冲突。
- 模块**按版本不可变**、**独立治理**：合规库改一处，所有引用方按各自锁的版本演进（或统一升级）。

---

## 7. 执行模型（如何融入增量依赖图）

一次 `use … on X` ＝ 对**每个 X 节点**实例化模块为一个**子图**，接进 host 的依赖图：

```
host 字段(amount, ccy, ctx.baseCcy)
        │  bind（在 host 节点求值）→ 模块输入端口
        ▼
   模块内部 cells（rate=resolver, base=amount*rate）   ← 命名空间 <nodePath>.<as>.*
        │  produce → host 字段(fxRate, base)
        ▼
host 下游（subtotal=sum(items.base) …）照常增量
```

- 绑定表达式作为**边**：host 字段 → 模块输入；输入变 → 模块子图重算 → produce 的 host 字段变 → host 下游增量重算。
- 模块局部 cell 命名空间化（`charges[0].items[0].itemFx.rate`），避免冲突。
- 完全契合现有增量引擎：**模块实例就是图里的一块子图**，多一些 cell 和边而已；异步 resolver、pending 传播、增删一并适用。

---

## 8. 治理与 Lint（让复用安全）

发布前静态检查（接 Schema §8 lint）：

1. **接口契约**：每个 `use` 的 `bind` MUST 提供模块所有 `inputs`，且**类型相容**；`produce` 的 host 目标字段 MUST `computed`/`external` 且类型相容。
2. **位置无关性**：模块内部规则 MUST NOT 引用 `root/parent/children`/具体路径——只能用 inputs/局部/`ctx`。**这是复用成立的硬约束**。
3. **ctx 满足**：模块 `context` 里要的 key，host MUST 在 `context` 映射里提供。
4. **数据源登记**：模块 `dataSources` MUST 在（模块或 host 的）`dataSources` 已登记。
5. **命名空间无冲突**：`imports` 别名唯一；模块实例 `as` 唯一。
6. **无环**：跨 import 无环；模块输出→host→另一模块输入 形成的依赖图无环。
7. **版本锁定**：`ref` 必须带 `@version`（可复现、可回放）。

---

## 9. 完整示例：L/C 复用 fx + compliance

```
模块库（独立治理、独立版本）
├── commonFx@1.0.0      ：fxConvert（汇率换算）
└── compliance@3.2.0    ：sanctionsCheck、amountLimit

产品 RuleSet lcSettlement@2.4.0
├── imports: fx=commonFx@1.0.0, comp=compliance@3.2.0
├── context: baseCcy←root.baseCcy, valueDate←root.valueDate
├── uses:
│    ├── fx.fxConvert   on ChargeItem  bind{amount,ccy,ctx.baseCcy} produce{fxRate,base}
│    ├── fx.fxConvert   on Payment     bind{amount,ccy,ctx.baseCcy} produce{fxRate,base}
│    └── comp.amountLimit on LetterOfCredit bind{amount:net, limit:maxNet} produce{...}
└── rules: groupSubtotal / chargeTotal / net …（host 专有）
```

- 汇率换算逻辑**只写一次**（commonFx），收费明细与付费**复用同一模块**，靠绑定区别。
- 合规校验由合规团队维护 compliance 库；保函/托收等其它产品**同样引用**，合规口径天然一致。
- 任一模块升级，引用方按锁定版本演进，可灰度、可回放（呼应架构 §7）。

---

## 10. ADR 增补（提案）

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| ADR-11 | 复用逻辑如何位置无关 | **参数化模块**：对抽象名编程；位置知识在使用点绑定 | 一段逻辑挂任意层不变；模块=函数，绑定=调用 |
| ADR-12 | 跨切面头部数据怎么给 | **环境上下文 `ctx`**：声明一次、全局可见、只读 | 避免逐 binding 穿透；解耦"头部数据物理位置" |
| ADR-13 | 跨 RuleSet 如何复用 | **版本锁定 imports + 命名空间别名 + 模块不可变** | 复用、分层治理、独立发布、可回放 |
| ADR-14 | 模块怎么执行 | **实例化为依赖图子图**，bind=入边、produce=出边 | 直接复用增量/异步引擎，无新执行机制 |

---

## 11. 与现有设计的关系

- 是"**函数有参数**"这个朴素思想，升级为规则组合机制。
- `ctx` 与 ADR-7 的 resolver（外部数据=注入输入）同源：**把"数据从哪来"与"规则怎么算"解耦**。
- 模块子图天然落进增量依赖图（ADR-8）；模块里可含 resolver（ADR-7）、条件计算/可输入（cases/fallback）、可覆盖字段——全部沿用。
- 中台校验不变：模块产出的也是 computed/external 字段，中台照样原始输入重算 + 比对（ADR-2/3）。

---

## 11.5 落地实证：`poc-incremental` 示例已模块化（已实现 + 实测）

本节是把上面的设计**真正跑通**的记录——`poc-incremental` 的增量引擎与信用证示例都已按本方案改写并实测通过。

### 已实现的机制（增量引擎 `src/incremental.js`）

| 机制 | 状态 | 落点 |
|------|------|------|
| Module 参数化 + `use…on…bind…produce`（§3-4） | ✅ | `instantiateUse`：input 端口在 host 求值、内部规则在模块命名空间求值、produce 写回 host |
| `ctx` 环境上下文（§5） | ✅ | `__ctx.<key>` cells（root 作用域求值）+ 各 proxy 暴露 `ctx` |
| 同一模块复用到多类型 | ✅ | fxConvert 同时 use 在 ChargeItem 与 Payment |
| 模块内 resolver / formula / validation | ✅ | 模块校验在模块上下文求值，含 ctx 插值，上浮带 host 节点 |
| 组合链（A.produce→host 字段→B.bind） | ✅ | 依赖图自动接序，链式增量正确 |
| 跨 RuleSet imports（§6） | ✅ | `opts.imports` 注册表按 `id@version` 解析 + 命名空间别名 + 版本锁定（生产对接 Rule Bundle API）|
| produce 字段继承 `overridable` | ✅ | 模块产出的 host 字段仍可人工覆盖/条件，沿用全部能力 |

### 信用证示例的改写（`lc-rules.json`）

**改写前**（汇率换算写两遍，重复）：
```jsonc
rules:[
  { id:"chargeFx", type:"resolver", scope:"ChargeItem", target:"fxRate", key:{from:"ccy", to:"root.baseCcy", ...} },
  { id:"itemBase", type:"formula",  scope:"ChargeItem", target:"base",   expr:"amount * fxRate" },
  { id:"payFx",    type:"resolver", scope:"Payment",    target:"fxRate", key:{from:"ccy", to:"root.baseCcy", ...} },
  { id:"payBase",  type:"formula",  scope:"Payment",    target:"base",   expr:"amount * fxRate" },
  ... ]
```

**改写后**（逻辑一份，复用两处）：
```jsonc
context: { baseCcy:"root.baseCcy", valueDate:"root.valueDate" },
modules: { fxConvert: {
  inputs:{amount,fromCcy,toCcy},
  rules:[ {id:"rate",type:"resolver",target:"rate",source:"fxRateService",key:{from:"fromCcy",to:"toCcy",valueDate:"ctx.valueDate"}},
          {id:"conv",type:"formula", target:"conv",expr:"amount * rate"} ],
  outputs:["conv","rate"] } },
uses:[
  { use:"fxConvert", on:"ChargeItem", bind:{amount,fromCcy:"ccy",toCcy:"ctx.baseCcy"}, produce:{rate:"fxRate", conv:"base"} },
  { use:"fxConvert", on:"Payment",    bind:{amount,fromCcy:"ccy",toCcy:"ctx.baseCcy"}, produce:{rate:"fxRate", conv:"base"} } ]
// 删除了 chargeFx/itemBase/payFx/payBase 四条重复规则
```

### 关键发现（对外部完全透明）

- **页面与中台 BFF 一行没改**：仍是 `createSession(ruleSet, data, {resolve})`；引擎自动把模块实例化为子图。host 字段路径（`charges[0].items[0].base/fxRate`）不变，所以 UI 绑定、中台原始输入重算、覆盖、篡改检测、钉值复核全部照常。
- **钉值快照来自模块 resolver**：6 个 fx 实例（4 收费明细 + 2 付费）→ 6 条钉值，verifyPinned 按 key 复核照常生效。
- **回归实测**：干净提交 ACCEPT(net=82203.22)；篡改 subtotal → REJECT_TAMPER；覆盖 base=80000 → ACCEPT（produce 继承 overridable）。
- **`fxRate` 改为只读显示**：它现在由模块计算、属 external，页面上不再可编辑（更符合语义）。

> 结论：**模块化是"内部重构"，对调用方/中台/页面透明**——这正是 ADR-14（模块=依赖图子图）带来的好处：没有引入新的执行路径，只是把重复逻辑收敛成一份可复用单元。

---

## 12. 未决 / 分阶段

- [x] ~~模块组合链~~：已实现（A.produce→host 字段→B.bind，依赖图自动接序）。
- [x] ~~模块内 validation 上浮~~：已实现（带 host 节点、ctx 插值）。
- [ ] **JSON Schema 形式化**：`modules/uses/context/imports` 机读 schema（当前未含这些构造）。
- [ ] **Lint 治理**：强制"模块内不得引用 root/parent/children"（位置无关性）、import 契约校验（inputs 全绑/类型相容、ctx 需求满足）、命名空间冲突。
- [ ] **钻石依赖 / 版本冲突**：A 引 fx@1.0，B 引 fx@1.1，产品同时引 A、B 的统一/隔离策略。
- [ ] **条件实例化**：`use` 支持 `when`（按条件决定是否挂这个模块）。
- [ ] **错误归因**：模块校验失败回指到 host 节点/字段的更友好定位（现已带 host 节点，可再细化字段级）。
- [ ] **模块 cell 随宿主增删的回收**：`<ns>.*` 不在节点注册表，删宿主时未清理（小泄漏）。
- [ ] **大集合性能**：一个 `use` 在上千子节点上实例化，子图规模与增量调度。
- [ ] **Rule Bundle API 雏形**：把 `opts.imports` 内存注册表升级为真实分发（拉取+缓存+版本），对接架构 §7。

> 进度：**机制层（§3-6）已跑通并用于信用证示例（§11.5）**；下一步重心转向**治理与形式化**（Schema + lint + 分发 API），让模块化 RuleSet 可校验、可发布、可跨产品治理。
