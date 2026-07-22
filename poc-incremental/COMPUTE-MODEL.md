# 计算模型：增量反应式依赖图 vs 流式计算

> 常被问：「引擎是不是流式计算（stream processing）？」
> **不是。** 本引擎（`src/incremental.js`）是**增量反应式依赖图计算（incremental reactive dataflow）**——
> 与 Excel、MobX/Signals、Reactively 同族；而不是 Flink / Spark Streaming / Storm 那种流处理。
> 两者名字相近、本质不同，本文说清区别，并把结论对应到代码。

## 一句话结论

| | 本引擎（增量反应式依赖图） | 流式计算（Flink/Spark Streaming） |
|---|---|---|
| 数据形态 | **一棵有界的表单状态树**（DAG，无环） | **无界事件流**，源源不断到达 |
| 驱动方式 | 单次 `setInput` → 脏传播到**收敛（稳态）**即停 | 数据持续流入，算子长驻处理 |
| 时间维度 | **无**。算到稳态就结束，无时间/窗口概念 | **核心**：窗口、水位线、乱序、事件时间 |
| 增量含义 | 只重算**被本次改动波及的子图**（脏传播 + 值相等截断） | 每条新事件对**状态做增量更新**（如累加窗口聚合） |
| 目标 | 表单值/计算/校验的唯一真相源，服务器同源可验证 | 高吞吐、低延迟、Exactly-once 语义 |
| 典型代表 | Excel、Signals、MobX、Reactively、**本引擎** | Flink、Spark Streaming、Kafka Streams、Storm |

**要点**：本引擎叫「增量」，指的是**「一次输入 → 只重算受影响的最小子图 → 到稳态」**，
不是「事件流源源不断进来」。它是 spreadsheet 式的反应式内核，不是流处理框架。

## 本引擎实际是怎么算的（对应代码）

核心是 **push-based 脏传播 + 动态依赖追踪 + 拓扑序结算** 三步，均可在 `src/incremental.js` 指到行：

### 1. 动态依赖追踪：读的时候自动连边（`incremental.js:109`）

```js
if (CURRENT && id !== CURRENT.id) { CURRENT.deps.add(id); c.dependents.add(CURRENT.id); }
```

计算某个 cell 时，凡被读到的 cell 自动记为它的依赖（`deps`），反向记为下游（`dependents`）。
依赖图是**运行期真实读出来的**，不是预先声明的——命中不同分支时依赖边会随之变化。

### 2. 脏传播：值真的变了才往下游标脏（`incremental.js:350`）

```js
if (changed) for (const dep of cell.dependents) dirty.add(dep);
```

只有 `changed`（值确实变化）才把下游加入 `dirty` 集合。值没变就地截断，下游零重算——
这是「增量」的关键：改一条三层深的明细，只重算 `该明细 → 其组小计 → 收费合计 → 净额 → 校验`，
其余收费组、付费分支**零触碰**。

### 3. 拓扑序结算：上游没算完不先算你（`settle()` `incremental.js:377`）

```js
while (dirty.size) {
  // 从脏集合里挑一个「deps 都不在 dirty 里」的 cell 先算 → 天然拓扑序
  for (const d of c.deps) if (dirty.has(d)) { ready = false; break; }
  ...
}
```

每轮从脏集合挑「上游都已结算」的先算，保证按 DAG 拓扑推进，无重复、无乱序，一路到 `dirty` 清空（稳态）。

### 4. 异步取数：resolver 是异步 cell，用 pending 态挂起（`incremental.js:360-370`）

resolver 的 `key` 变化 → 置 `pending` + 发起取数 → 下游读到 `pending` 抛出并传播
（校验对其挂起而非判失败）→ 取回后写值、标脏下游、再 `settle()` 结算。
这是唯一带「异步」的地方，但仍是「事件驱动一次结算」，**不是流窗口**。

## 硬边界：「计算」里不能「取值」

**公式只能读图里已有的值，不能自己去外部拿数。** 取值（IO）与计算（求值）是两类不同的 cell，中间永远隔着 resolver 这道异步边界，计算侧保持纯净。

- **取值 = resolver**：唯一能碰外部 IO 的 cell。按 `key` 调 `resolve(source, key)` 异步拿值（`incremental.js:370`），拿到前是 `pending` 态。
- **计算 = formula / pipeline**：表达式由 `evaluate(expr, ctx)` **同步、纯函数**求值——只读图里其它 cell 的**当前值**，**没有发起 IO 的能力**（DSL 表达式里根本没有「去调某某服务」这个原语）。

所以 `total = base + tax + fee` 能算，是因为 `base/tax/fee` 已被 resolver 取回、坐在图里了；公式只是「读并组合」，不是「去拿」。

**为什么这条边界不能破：**

1. **稳态 = 输入的纯函数**。公式一旦能自己 fetch，结果就取决于「何时算、外部那一刻返回啥」，不再是确定的纯函数。
2. **脏传播要能追踪依赖**。引擎靠「读谁就连一条依赖边」决定改一处要重算哪些下游；IO 是引擎看不见的副作用，连不上边 → 该重算的不重算，图与界面当场脱节。
3. **中台可同源复算防篡改**。BFF 用同一内核重算比对；异步 IO 塞进公式后，结果依赖调用时序与历史，BFF 无法 replay，防篡改即失效。

（与下文「不开放裸 field.onChange 副作用」同一地基。）

**落地口诀**：凡「必须问外部才知道」的原子值 → 做成 resolver（按 key 声明，引擎异步拿、能追踪、中台能重取核对）；凡「能由已有值推出来」的 → 做成 formula（纯函数，只读已解析的值）。样板见 `CHARGE-SERVICE.md`：`base/tax/fee` 是 resolver（取值），`total` 是 formula（计算）。

## 模块：可复用的计算单元（含 cases / pipeline）

**库(library)里除了「节点(type)」还能定义「模块(module)」。节点是「数据长什么样」（fields/slots/children），模块是「这段活儿怎么算」。** 产品部把「汇率换算」「复杂计费」这类通用计算封成参数化积木，项目 `import` 后挂到自己的节点上复用，不用抄代码。

### 模块 = 输入契约 + 内部计算/取数/校验 + 输出

一个模块（如 `commonFx.fxConvert`）自带：`inputs`（入参契约）、`context`、`fields`（内部字段）、`rules`（formula / pipeline / resolver / validation）、`outputs`。它**自包含**——自己取数、自己算，只暴露 inputs/outputs，宿主不用知道它内部怎么调 API。

### 怎么挂（`uses` / `bind` / `produce`）

```jsonc
"uses": [{ "use": "commonFx.fxConvert", "on": "ChargeItem", "as": "m",
  "bind":    { "amount": "amount", "fromCcy": "ccy", "toCcy": "ctx.baseCcy" },  // 宿主字段 → 模块入参
  "produce": { "conv": "base", "rate": "fxRate" } }]                            // 模块输出 → 宿主字段
```

关键性质：
- **按宿主实例各来一份**（`instantiateUseOnHost` `incremental.js:257`）：`on: ChargeItem` → 每个明细各得一次独立实例，动态增子记录也自动补上（`instantiateUsesForNode` `:317`）。
- **命名空间隔离**：模块内部在自己的 `<ns>.*` 命名空间求值（`self` = 模块实例，只见 inputs/局部/ctx），不与宿主其它字段撞名。
- **能承载外部 IO 与校验**：resolver（取汇率/计费）、validation 都能封在模块里，一处定义处处复用。
- **可挂基类**：`on` 写基类型（如 `on: Party`）自动作用到所有 is-a 该类型的节点（含子类型）。
- **独立版本治理**：库带自己的 version，与产品规则集解耦。

### 规则表达力：与顶层规则对齐（本次补齐 cases / pipeline）

模块内 `formula` 现支持**多分支 cases + when + fallback + 分支级可覆盖**，并新增 **pipeline（多步，隐式 `value` = 上一步结果）**——与顶层 `makeRuleCell` 同款（`incremental.js:269-292`）。均在模块上下文 `mctx` 求值：cell 带 `getCtx`，recompute 的 whenExpr 走 `getCtx`（此前硬编码 `ctxFor(nodePath)`，模块 when 取不到 input，是本次关键修复）。

> 边界：模块无 node data，`fallback:"input"` 的 manual 回填不支持（退化为 null）。样板见 `verify-module-cases-pipeline.mjs`。

### 复杂逻辑往哪写

表达式是**纯声明式**（无循环、无命令式、无副作用，与「计算里不能取值」同一地基）。所以：

| 需求 | 做法 |
|---|---|
| 多分支/带阈值 | **cases**，或单 expr 里用三元链 `c1 ? a : c2 ? b : c` |
| 多步、要中间量 | **pipeline**，或拆成多个字段（`A=…`、`B=f(A)`，依赖图自动排序） |
| 聚合 | `sum/avg/min/max/count(...)` 对子集合 |
| 循环 / 查表 / 算法级 | **交给后台 resolver**——引擎只编排，复杂逻辑在 API 里（如 `commonCharge.chargeCalc` 一次返回 base/tax/fee） |

### 数据源不是模块专属——顶层规则也能直接用

`dataSources`（sourceId + keySchema + tolerance）是**规则集/库级的共享声明**；引用它的是 `resolver` 规则，而 resolver 规则**两个位置都能写**：

| 位置 | 写法 | 引擎处理 |
|---|---|---|
| 顶层规则 | `ruleSet.rules` 里，`scope`=节点类型、`target`=该节点字段 | `makeRuleCell`（`incremental.js:204`） |
| 模块内规则 | `mod.rules` 里 | `instantiateUseOnHost`（`:274`） |

两者都靠同一个 `source` 字段引用，机制一致。数据源由 `compile` 把 `ruleSet.dataSources` + 各 import 库的 `dataSources` **合并成一张表**（`bff/validate.js:52-53`），顶层与模块都看得见、lint 也按这张表校验 `resolver.source`。

区别只是**封装粒度**：一次性就地取值 → 写顶层 resolver（如 `verify-reconstruct-override.mjs` 直接把汇率取到 `Deal.fxRate`）；要复用 / 多实例 / 独立治理 → 封进模块（如 `fxConvert` 挂到每个 ChargeItem）。**想直接在某字段上取数，不用为它建模块。**

## 为什么这对本项目是对的选择

- **有界状态 + 求稳态**：一张信用证表单是有界的字段树，用户改一处、系统算到稳态即可——
  正是反应式依赖图的主场；流处理的窗口/水位线/事件时间在这里都用不上，反成负担。
- **服务器同源可验证**：稳态是「当前输入的纯函数」，BFF 用同一内核重算即可比对（见 README「中台校验」）。
  流处理的状态依赖到达顺序与时间，难以「同输入同输出」地复算。
- **增量即性能**：脏传播 + 值相等截断，让「上千栏位、嵌套子记录、计算含取数」也只付出 O(受影响子图) 的代价。

## 中台（BFF）重算时的两条汇率处理线路

中台重算（`bff/validate.js`）**不信任前端提交的任何计算值与汇率值**：它只取原始输入、用同一内核重算。
其中「汇率」（datasource / resolver 值）被拆成**两条互不相干的线**——一条进计算，一条只做防篡改核对。

### 线路 A：计算用的汇率——中台按 key 重新取数（权威源）

前端提交里的汇率值在重算中**完全不用**。`extractInputs`（`validate.js:69`）只挑输入，把 `computed`/`external` 全丢弃；
汇率是 **resolver（外部）值**，由中台自己按 key 现取：

```js
// validate.js:137 —— 用中台权威 resolver 建 session
const session = createSession(ctx.ruleSet, inputs, { resolve: authResolve, imports: ctx.imports });
```

引擎每次结算 resolver cell 都**现算 key、key 变则重新取数**（`incremental.js:314-320`）：

```js
for (const [k, expr] of Object.entries(cell.key)) keyVals[k] = evaluate(expr, gctx).value;
const keyStr = ser(keyVals);
if (keyStr === cell.lastKey && cell.state === "resolved") { /* 复用 */ }
else { cell.lastKey = keyStr; state = "pending"; fireKey = keyVals; }   // → resolveFn(source, key)
```

`resolveFn` 即 `authResolve`（`validate.js:17`）——按 `${key.from}-${key.to}` 查中台**权威汇率表** `AUTH_RATES`。
取回的汇率写进 resolver cell，下游公式依赖它参与重算。**「未篡改即一致」靠的是中台权威源与前端源同表**（`validate.js:14`）——
前端把汇率改了也没用，重算根本不读它。

### 线路 B：前端钉值（pinned）——不进计算，只按容差核对

前端提交的 `pinned`（当时钉住的汇率快照）**不参与任何计算**，只被 `verifyPinned`（`validate.js:112`）
拿去和权威汇率**按 dataSource 声明的容差**复核：

```js
if (!withinTolerance(p.value, auth, tol))
  out.push({ field: p.field, kind: "rate", client: p.value, server: auth });   // 超容差 → 汇率篡改/过期
```

命中即并入 `divergences` → `verdict = "REJECT_TAMPER"`。容差类型（绝对/相对）由 `fxRateService` 的 `tolerance` 决定（`validate.js:104-111`）。

### 两条线的分工

| | 线路 A（计算） | 线路 B（钉值核对） |
|---|---|---|
| 数据来源 | 中台**按 key 重新取**的权威汇率 | 前端提交的 `pinned` 快照 |
| 是否进计算 | **是**，resolver cell 参与重算 | **否**，纯旁路核对 |
| 前端提交的汇率值 | **完全不用**（丢弃后重取） | 作为被核对对象 |
| 失败后果 | —（重算永远用权威值，不会失败） | 超容差 → `REJECT_TAMPER` |
| 对应代码 | `validate.js:152` + `incremental.js:314` | `verifyPinned` `validate.js:120` |

> 要点：**汇率永远以中台按 key 重取的权威值参与计算**；前端提交的汇率只当"待核对的证据"。
> 这样既杜绝了「改汇率蒙混计算」，又能查出「钉值与权威源不符/已过期」。

### 模块在中台会完整重跑

中台用**同一引擎** `createSession(ctx.ruleSet, inputs, { resolve: authResolve, imports })`（`validate.js:152`）重建会话——`ctx.ruleSet` 是完整规则集（含 `uses`）、`imports` 是含模块定义的库，所以每个 `uses` 的模块照常被 `instantiateUseOnHost` 挂到宿主节点、**内部规则全部重新执行**：

| 模块内 | 中台重算时 |
|---|---|
| resolver（汇率/计费） | **按 key 重取权威源**（`authResolve`）——不认前端提交值（即线路 A） |
| formula / pipeline | 用重取的权威值 + 重算的入参，从头再算 |
| validation | 重跑，上浮到 `st.validations` 参与裁决 |

**前端提交的模块产出一律不信**：`extractInputs` 只取原始输入，把 computed/external（含模块 `produce` 出来的 `trxRate`/`trxOrderAmt`/`conv`）全部丢弃、由中台从输入重推。

**关键**：模块入参常绑到计算字段（如 `fxConvert.amount ← localOrderAmt`）。中台是先把 `localOrderAmt` 从 `goodsInfo` 重算出来、**再**喂给模块——所以模块拿到的是**中台重算后的入参**，不是前端提交的。整条链（明细 → 本币额 → 模块取汇率 → 换算 → 最终额）在中台重跑，改哪一环都会对不上，端到端防篡改。

## 加载态重建：从纯值树反推人工覆盖（已落地）

**存储只存纯值树（`treeToData`），不存 override 标记、不存 pin。** 加载时靠反推把「人工覆盖」的字段恢复成覆盖态——这样存储结构干净、四端一致。

### 问题

一个 `computed + overridable` 字段（如 `negoAmount = finalAmount`，可人工改），存盘只留下值。加载时引擎会按公式重算 → 如果不特殊处理，人工改过的值就被算回去了。需要区分「这是覆盖」还是「这只是重算值」。

### 反推（`reconstructOverrides(data)` `incremental.js:462`）

沿计算图：某可覆盖字段的**存值 ≠ 重算值** → 判定它当初被人工覆盖 → `setOverride` 回放。迭代 fixpoint（上游覆盖先落，下游按更新值再比对）。

### 外部依赖字段的难点与正解

难点：`negoAmount → finalAmount → trxOrderAmt → trxRate`，`trxRate` 是 resolver（汇率）。重算要用汇率，而汇率异步、加载时还没回来（拿 null 会误判），或重取到的新汇率与存盘时不同（**漂移**会把没覆盖的字段误判成覆盖）。

正解——**用存盘那一刻的汇率反推**（无漂移）：

1. **种回汇率**：汇率值本就在 data 里（`trxRate`）。引擎建会话时记录 `resolverSeedPath`（`incremental.js:42,292`）——模块 produce 的 resolver（`root.m.rate`）↔ 其产出宿主字段（`root.trxRate`）。反推时从 `data.trxRate` 把汇率**种回 resolver cell**（`seedResolver` `:478`）。**只靠 data，无需 pin。**
2. **按存盘汇率反推**：种回后重算基线 = 存盘时的值 → 外部依赖字段的存值与重算值一致（没覆盖）或不一致（真覆盖），准确判定。
3. **在途取数自然刷新**：`createSession` 初次结算已按当前 key 发起取数（在途）；种回只是让本次基线用存盘值。稍后取数返回**权威汇率** → 重算 → 覆盖保留、校验重跑。（这正是用户提的「先反推 override → 再取回 pin 值 → 再重算校验」。）

**安全护栏**：只对「其 resolver 依赖已成功种回」的字段反推（`seeded` 集合 + `dependsOnUnseededExt` `:477,490`）。存盘里没有该汇率（种不回）→ 不知旧汇率 → 仍跳过，避免把漂移误判成覆盖。

> `pins`（显式带 cell 路径的汇率快照，见「中台线路 B」）仍作为可选来源支持并优先；缺省则从 data 种回。样板见 `verify-override-pins.mjs`（含「仅 data、无 pins」断言）。

### 四端一致

所有加载面在 `createSession` 后、`resetWatcher.seed()` 前调 `session.reconstructOverrides(data)`（只传 data）：

| 加载面 | 接线位置 |
|---|---|
| 编辑器 Preview（React） | `ui-kit-react/ctx-react.ts` |
| React 运行时加载器 | 同上（`reconstructOverrides: true`） |
| Vue 运行时加载器 | `ui-kit-vue/ctx-vue.ts` |
| HTML 运行时加载器 | `ui-kit-html/mount.ts` |
| Angular 运行时加载器 | `formly-lc.component.ts` / `app.component.ts` |

闭环：**保存**（`treeToData` 含覆盖后的值）→ **加载**（四端反推覆盖 + 种回汇率 + 权威取数刷新 + 校验重跑），存储始终是纯值树。

## 为什么不开放裸 field.onChange 副作用

> 常被问：「给字段开个 onChange 事件、变化时顺手改别的数据，会不会干扰这套机制？」

要看**在哪一层、用什么方式改**。引擎里「改输入」本来就是合法且唯一的入口——
`setInput` 就是干这个：置值 → 下游标脏 → `settle()` 到稳态 → `onUpdate` 通知（`incremental.js:413-416`）。
所以「字段变 → 改别的字段」本身不违背机制。危险的是写法：

- **A. 绕过引擎直接改原始 data 对象** → **一定坏**。每个 cell 持有自己的值副本，
  改 data 树引擎根本不知道（没人标脏），UI/引擎当场脱节、BFF 重算对不上。直接否掉。
- **B. 在 onChange 里再 `setInput` 改别的输入字段** → 不炸内核，但有三个隐蔽坑：

1. **重入死循环**：`setInput` 全同步，`settle()` 跑完才 `onUpdate`。若把回写挂在 `onUpdate` 上，
   就成 `setInput(A)→settle→onUpdate→写 setInput(B)→…→写 setInput(A)` 的乒乓。
   `eq` 幂等守卫（`incremental.js:412`）只在值收敛时能刹住；逻辑一旦不幂等（累加/追加/翻转），
   宿主层这个环**没有 guard**（引擎内部 `settle` 有 1e6 保护，跨 `onUpdate` 的环没有）。
2. **改值时机**：安全时机只有 `onUpdate`（此刻图已稳态）。若把回写塞进 `recompute` 或 resolver 回调，
   会在 `settle` 迭代中途改 `dirty`/改值（`incremental.js:379` 正按拓扑挑 cell）→ 拓扑序被打乱。
3. **服务器可验证性（最致命）**：架构地基是「稳态 = 当前输入的纯函数」，BFF 才能同源重算防篡改。
   onChange 变成引擎与 BFF 都看不见的副作用后，结果依赖「编辑的先后顺序与历史」，BFF 无法 replay，
   「同输入→同输出」不再成立，防篡改被戳穿。这不是 bug，是把引擎从声明式纯函数拉回命令式副作用。
4. **四端发散**：onChange 写在各端渲染器里，同一逻辑散在 React/Vue/Angular/HTML 4 处，违背「声明一次、四端一致」。

**正确做法**（不开放裸 onChange）：

- **声明式 + 集中执行**：一份 `{ scope, when, targets }` 声明放配置；`ui-kit-core` 一个共享 watcher
  **只订阅 `onUpdate`**（唯一安全时机），四端 wire 一次；**边沿触发**（`false→true` 才动，记忆上次真值）
  从根上杜绝坑①；target 约束为 input、禁回喂自身 `when`（禁 A↔B 互改）。
- **要服务器可验证的联动**：干脆不用 onChange，把该字段建成**计算字段**（`fallback:"input"` 或公式规则），
  让联动进 DAG——BFF 天然看得见、能复算。两者可共存：纯清空走 watcher，带计算味的走计算字段。

一句话：**「字段变→改数据」只能走「声明式规则 + `onUpdate` 后集中回写 + 边沿防环」，
绝不能开裸 onChange 同步改数据**——前者是多一次合法的 `setInput` 循环，
后者会一次戳穿重入、时机、服务器可验证性三道防线。

### 联动重置 watcher（已落地）

上面「正确做法」的第一条已实现，就是**联动重置 `resetRules`**（`ui-kit-core` 的 `attachResetWatcher`）。

**它补什么**：引擎能做「A 变→B 跟着**算**新值」（B 是计算字段，天然反应式），但做不了
「A 变→B（用户**输入**字段）被**清空**重填」——因为 B 不是 A 的函数。watcher 就补这条通路。

**怎么配**（两种入口，等价）：

1. **可视化编辑器**：`editor-react` 里点画布空白处选中「页面」→ 右侧属性面板「联动重置 resetRules」→
   填 `scope` / `when` / `targets` → 保存到仓库。
2. **直接写 PageDef JSON**（`PageDef.resetRules`）：

```jsonc
"resetRules": [
  // 结算方式改成电汇 → 清空信用证号、开证行（对电汇无意义）
  { "scope": "root",       "when": "settleType == \"wire\"", "targets": ["lcNo", "issuingBank"] },
  // 某收费行调整方式改成人工 → 清空该行自动汇率（scope 为类型名，对每个 ChargeItem 各自判定）
  { "scope": "ChargeItem", "when": "adjust == \"manual\"",   "targets": ["autoRate"] }
]
```

- `scope`：节点类型名（如 `ChargeItem`，对每个该类型子记录逐一判定）或 `root` / 绝对路径。
- `when`：与 validation/formula 同一套表达式 DSL，**字符串用双引号**（单引号会 `E_PARSE`）。
- `targets`：`when` 由假变真时重置的对象。**按匹配节点结构自动判定粒度**（`applyTarget`）：

| target 写法 | 判定 | 动作 |
|---|---|---|
| 字段名（`lcNo`） | scope 节点的一个字段 | 清该字段值（见下方字段类型表） |
| slot 名（`applicant`） | scope 节点的一个 slot | **整体重置该 slot 子树**：字段清值 + 嵌套 slot 递归 + **嵌套 children 删记录**（恢复到空，不残留空子记录） |
| children 集合名（`charges`） | scope 节点的一个集合 | **删除该集合的所有子记录**（结构变更） |
| 点号相对路径（`applicant.name`） | 以上皆非 | 回退按 cell 路径清该字段值 |

**字段清值语义**（`resetTarget`，按字段类型再分流）：

| target 字段类型 | 重置动作 | 效果 |
|---|---|---|
| 普通 input | `setInput(null)` | 清空 |
| 条件可输入 `fallback:"input"` | `setInput(null)`（引擎内置分流） | 清空用户录入值（`manual=null`） |
| 可覆盖 `overridable`（已覆盖） | `setInput` 抛错 → 改 `clearOverride` | **恢复公式计算值**（不是清空——清空对覆盖无意义） |
| 纯 computed | 两者皆无操作 | 不动（计算值不该被外部重置） |

> 关键：可覆盖字段的「重置」= `clearOverride`（回到公式值），而非 `setInput(null)`——
> 对已覆盖的计算字段调 `setInput` 会抛 `not an input`。`resetTarget` 先试 `setInput`、
> 非 input 再试 `clearOverride`，对 input / 条件可输入 / 可覆盖三类都给出正确语义。

**删 children 行的两个关键处理**（否则会脱节/删错）：
- **先快照行路径再逐个 `removeChild`**：墓碑删除保持兄弟真实下标稳定（`viewNode` 按真实下标建 path），按快照 path 逐删安全；
- **删完调 `onStructChange`**：删行是**结构变更**，必须触发各端 `rebuild`（`structVer++`）重建 UI-IR，
  否则界面残留「幽灵行」，其绑定路径指向已删 cell → 读空/编辑抛 `not an input`。
  故 `attachResetWatcher(session, rules, onStructChange)` 第三参由四端 store 传入自己的 rebuild。

**运行时如何生效**：四端 store（`ctx-react` / `ctx-vue` / html `mount` / Angular formly 组件）在建会话时
`attachResetWatcher(session, pageDef.resetRules, rebuild)` 接线一次——
- `seed()`：加载后记录各 `when` 的真值**基线，不触发**（尊重既有数据，不误清加载记录）；
- `run()`：每次 `onUpdate` 对每个匹配节点求 `when`，仅 **`false→true` 边沿**重置 `targets`；
- 重入守卫：清值/删行自身会再触发 `onUpdate`，被守卫吞掉，杜绝乒乓。

回归见 `verify-resetwatcher.mjs`（边沿触发 / 非电平 / 重入不死循环 / seed 不误清 / 类型作用域逐节点 /
case-when 字段分流 / slot 递归清字段 / children 删行带重建）。

**二次确认（`ResetRule.confirm`）**：删 children / 重置 slot 不可逆，给规则加 `confirm` 即在重置前弹确认框，
用户确认后才执行：

```jsonc
{ "scope": "root", "when": "settleType == \"wire\"", "targets": ["applicant", "charges"],
  "confirm": "确认清空申请人并删除所有收费明细？（不可撤销）" }   // true=默认提示语；字符串=自定义
```

- **默认**走浏览器原生 `confirm`（同步，四端都有）——零接线即生效。
- **自定义弹窗**：`attachResetWatcher(session, rules, { onStructChange, confirm })` 传 `confirm` 处理器，
  返回 `boolean`（同步）或 **`Promise<boolean>`（异步）**——异步时重置挂起，等用户在你的模态框里点确认后才执行。
- **边沿即记账**：询问的一刻就记下真值，故异步确认期间 `when` 不会重复弹框；用户点「取消」则本次不重置，
  直到 `when` 再次由假变真才会再问。

> ⚠️ 即便有确认，删 children 仍不可逆：务必确认 `when` 稳定（不依赖 pending/中间态），避免误触发弹框骚扰。

> 边界：watcher 是**纯 UI 便利，BFF 不感知**（中台不知道「某字段本应被重置」）。
> 若某重置是合规硬要求、须服务器可验证，改把该字段建成计算字段（`fallback:"input"` 或公式）进 DAG。两者可共存。

## 术语澄清（避免混淆）

- **「dataflow（数据流）」** 是个宽泛词：Excel 是 dataflow，Flink 也是 dataflow。
  本引擎是 **reactive dataflow / demand-driven dataflow**，
  ≠ **streaming dataflow**（无界流 + 时间语义）。
- **「增量（incremental）」** 在这里指「只重算受影响子图」，
  ≠ 流处理里的「增量聚合（对每条新事件更新窗口状态）」。
- **「响应式（reactive）」** 指值变自动传播重算（信号/Signals 那一套），
  ≠ Reactive Streams（RxJS/Reactor 的背压式异步流）。

## 延伸阅读

- README「引擎怎么做到的」「与全量重算引擎的对比」：`README.md`
- 调后台 API 的复杂计费（resolver 多字段取数 + pick）：`CHARGE-SERVICE.md`
- 引擎源码：`src/incremental.js`（`recompute` / `settle` / `setInput` / `addChild` / `removeChild`）
