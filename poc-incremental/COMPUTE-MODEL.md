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
