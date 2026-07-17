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

## 为什么这对本项目是对的选择

- **有界状态 + 求稳态**：一张信用证表单是有界的字段树，用户改一处、系统算到稳态即可——
  正是反应式依赖图的主场；流处理的窗口/水位线/事件时间在这里都用不上，反成负担。
- **服务器同源可验证**：稳态是「当前输入的纯函数」，BFF 用同一内核重算即可比对（见 README「中台校验」）。
  流处理的状态依赖到达顺序与时间，难以「同输入同输出」地复算。
- **增量即性能**：脏传播 + 值相等截断，让「上千栏位、嵌套子记录、计算含取数」也只付出 O(受影响子图) 的代价。

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
- `targets`：`when` 由假变真时重置的字段。**按字段类型自动选正确的重置语义**（`resetTarget`）：

| target 字段类型 | 重置动作 | 效果 |
|---|---|---|
| 普通 input | `setInput(null)` | 清空 |
| 条件可输入 `fallback:"input"` | `setInput(null)`（引擎内置分流） | 清空用户录入值（`manual=null`） |
| 可覆盖 `overridable`（已覆盖） | `setInput` 抛错 → 改 `clearOverride` | **恢复公式计算值**（不是清空——清空对覆盖无意义） |
| 纯 computed | 两者皆无操作 | 不动（计算值不该被外部重置） |

> 关键：可覆盖字段的「重置」= `clearOverride`（回到公式值），而非 `setInput(null)`——
> 对已覆盖的计算字段调 `setInput` 会抛 `not an input`。watcher 的 `resetTarget` 先试 `setInput`、
> 非 input 再试 `clearOverride`，从而对 input / 条件可输入 / 可覆盖三类都给出正确语义。

**运行时如何生效**：四端 store（`ctx-react` / `ctx-vue` / html `mount` / Angular formly 组件）在建会话时
`attachResetWatcher(session, pageDef.resetRules)` 接线一次——
- `seed()`：加载后记录各 `when` 的真值**基线，不触发**（尊重既有数据，不误清加载记录）；
- `run()`：每次 `onUpdate` 对每个匹配节点求 `when`，仅 **`false→true` 边沿**清空 `targets`；
- 重入守卫：清空自身会再触发 `onUpdate`，被守卫吞掉，杜绝乒乓。

回归见 `verify-resetwatcher.mjs`（边沿触发 / 非电平 / 重入不死循环 / seed 不误清 / 类型作用域逐节点）。

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
- 引擎源码：`src/incremental.js`（`recompute` / `settle` / `setInput` / `addChild` / `removeChild`）
