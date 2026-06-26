# 统一业务规则 DSL —— 异步取数、增量计算与一致性快照（架构补充）

> 状态：Draft v0.1
> 关联：[架构](./unified_dsl_architecture.md) · [Schema](./unified_dsl_schema.md) · [表达式规范](./unified_dsl_expression.md)
> 触发背景：国际结算 / 信用证(L/C)场景——单页上千栏位、收费/付费多层嵌套子记录、
> 计算过程中需从后台取数（如汇率）。本文回答这类**大规模 + 异步 + 强一致**场景的架构。

---

## 0. 这个场景新增了什么挑战

普通表单里"改一个字段就全量重算"无所谓（实测 1000 子项也仅 ~3ms）。但信用证场景叠加了三件本质不同的事：

| 挑战 | 说明 | 朴素做法为何失效 |
|------|------|----------------|
| **C-A 异步取数在计算路径里** | `charge.base = amount × 汇率`，汇率要向后台取 | 表达式禁止 IO（否则 UI/中台取到不同值→破坏一致性 ADR-1） |
| **C-B 规模与扇出** | 上千栏位、层层嵌套子记录 | 改一处就全量重算所有规则，浪费且难定位 |
| **C-C 外部值随时间漂移** | 汇率上午≠下午 | UI 与中台在不同时刻取数，结果"合法地不一致" |

本文给出三条对应的架构决策：**Resolver 异步层**（解 C-A）、**增量依赖图**（解 C-B）、**一致性快照钉值**（解 C-C）。

---

## 1. 设计总纲（三条原则）

> **原则 1：引擎保持纯，IO 永远在引擎之外。**
> 外部数据（汇率、费率表、参考数据）以"被注入的输入字段"进入计算；取数由独立的异步层负责。引擎只看字段，不知道也不关心它从哪来。

> **原则 2：算"受影响的"，不算"全部"。**
> 规则编译为字段依赖图（DAG）；改某字段只重算其下游子图。异步取数是图里的异步节点。

> **原则 3：UI 算用的每个外部输入，钉入交易快照。**
> 中台用同一份钉死的值复算，保证逐位一致并可审计。

三条原则共同维持了 ADR-1 的根基——**确定性**：引擎对"相同输入"必产"相同输出"，而外部数据通过注入+钉值，成为 UI 与中台都相同的输入。

---

## 2. 外部数据模型：Resolver 异步解析层（解 C-A）

### 2.1 为什么不能在表达式里取数

表达式规范 §6.5 明令禁止 IO/时钟/随机。原因：一旦 `charge.base = amount * fetchRate(...)` 允许，UI 和中台两次 `fetchRate` 可能拿到不同值，`base` 就 drift 了，ADR-1 一致性崩溃。**取数必须被移出纯求值。**

### 2.2 Resolver 构造（新的 DSL 规则类型）

用一个声明式的 `resolver` 规则，把"某字段的值由外部数据源异步提供"这件事**显式建模、纳入治理**：

```jsonc
{
  "id": "resolveFxRate",
  "type": "resolver",
  "scope": "Charge",            // 对每条收费子记录解析
  "target": "fxRate",          // 解析结果写入的字段（model 中标 external）
  "source": "fxRateService",   // 已登记的数据源 id（见 2.3）
  "key": {                      // 取数键；值是表达式，引用其它字段
    "from": "ccy",
    "to": "root.baseCcy",
    "valueDate": "root.valueDate"
  },
  "pin": true,                  // 取到的值钉入快照（见 §4）
  "fallback": "last-known"      // 取数进行中/失败时的策略：none|last-known|block
}
```

关键点：
- Resolver **不在纯引擎里执行**——它是引擎外异步层的指令。引擎只把 `fxRate` 当普通字段读。
- `key` 的输入（`ccy`/`baseCcy`/`valueDate`）变化 → 异步层重新取数 → 写回 `fxRate` → 触发下游重算。
- 于是 `charge.base = amount * fxRate` 是**纯表达式**，`fxRate` 只是个已就位的字段。

### 2.3 数据源治理（Data Source Registry）

外部数据源和 Function 一样**必须登记、版本化、双端对齐**（呼应架构 §6），否则又会回到"UI 一个源、中台另一个源"的老问题：

```jsonc
{
  "sourceId": "fxRateService",
  "version": "1.0.0",
  "returns": "decimal",
  "keySchema": { "from": "string", "to": "string", "valueDate": "date" },
  "authority": "server",        // 谁是权威源（中台）
  "cachePolicy": { "ttlSeconds": 300, "scope": "valueDate" },
  "tolerance": { "type": "relative", "value": "0.0005" }  // 中台复算容差（见 §4.2）
}
```

### 2.4 异步字段状态（求值的四态）

被 resolver 解析的字段不再只有"有值/为 null"，而是有**生命周期状态**。引擎与 UI 必须共识这套语义：

| 状态 | 含义 | 下游计算 | 下游校验 |
|------|------|---------|---------|
| `stale` | key 变了，待重新解析 | 暂用旧值或挂起（依 `fallback`） | 同左 |
| `pending` | 正在取数 | 下游标记 `pending`（不报错） | **挂起**，显示"计算中"，不判失败 |
| `resolved` | 取到值 | 正常计算 | 正常校验 |
| `error` | 取数失败 | 依 `fallback`：保留旧值 / 阻断 | 产生告警 `W_RESOLVE_FAILED` |

> 重要：`pending` **不等于 null**。把"正在算"误判为"校验失败"是糟糕体验。下游一律传播 `pending`，校验对 `pending` 输入**挂起**而非判错。

---

## 3. 增量依赖图求值（解 C-B，替代全量重算）

到信用证规模，"改一字段→全量重算"必须换成**增量**。这其实是架构 §5.4 早就埋的字段依赖 DAG，现在把它变成真正的执行引擎。

### 3.1 依赖图编译（一次性，规则加载时）

把 RuleSet 编译成**字段级有向图**：节点=字段实例，边=依赖关系。

```
charge[i].amount ─┐
charge[i].fxRate ─┴─► charge[i].base ─┐
                                      ├─► section.charges.total ─► lc.total ─► [校验 lc.total<=limit]
charge[j].base  ──────────────────────┘
                  root.baseCcy ─► (resolveFxRate.key) ─► charge[*].fxRate(async)
```

- 纯规则（formula/function/pipeline）→ 同步节点；
- resolver → **异步节点**，其输出依赖 key 输入；
- 编译期做环检测（Schema §8.5）。

### 3.2 脏标记传播 + 拓扑重算

```
用户改 charge[3].amount
  → 标记 charge[3].amount 的下游为 dirty：
       charge[3].base → section.total → lc.total → 相关校验
  → 按拓扑序只重算这些 dirty 节点
  → 其余上千字段不动
```

复杂度从 **O(全部规则 × 全部节点)** 降到 **O(受影响子图)**。改一行收费的金额，只触达它那一条链，不波及整张信用证。

### 3.3 异步节点的结算（多 tick）

当脏传播碰到 resolver 的 key 变化：

```
1. key dirty → resolver 输出 fxRate 置 pending → 下游全部 pending（界面显示"计算中"）
2. 异步层发起取数（去重/缓存/重试）
3. 取回 → fxRate = resolved(value, sourceVersion, asOf) → 标记其下游 dirty
4. 重算下游子图 → 子图 settle
```

整个过程是一个**带异步节点的响应式计算图**（概念上＝"无界面的电子表格内核 + 异步单元格"）。纯子图同步秒算；只有跨 resolver 的链路才进入异步多 tick。

### 3.4 复杂度与回退

- 同步纯子图：拓扑重算，确定、无 glitch。
- 多个 resolver 并发：各自独立结算；下游在所有依赖 `resolved` 后才离开 `pending`。
- 回退：若依赖图构建失败或环，降级为受控的全量重算并告警（不致命）。

---

## 4. 一致性快照与钉值（解 C-C）

### 4.1 钉值快照内容

汇率随时间漂移。UI 算用的每个外部输入必须**钉死**并随交易提交：

```jsonc
"snapshot": {
  "ruleSetId": "lcSettlement", "ruleSetVersion": "2.3.0",
  "inputs": { ...用户录入字段... },
  "resolved": [
    { "field": "charges[0].fxRate", "value": "7.1234",
      "source": "fxRateService", "sourceVersion": "1.0.0",
      "key": { "from":"USD","to":"CNY","valueDate":"2026-06-25" },
      "asOf": "2026-06-25T09:30:00Z", "rateId": "fx_8842177" }
  ]
}
```

凡 `pin:true` 的 resolver 结果都进 `resolved[]`，带**来源 + 版本 + 取数键 + 时点 + rateId**——既供中台复算，也是审计凭证。

### 4.2 中台复算与裁决

中台是权威（ADR-3），但对**钉死的外部值**有两种策略，按业务选：

| 策略 | 做法 | 适用 |
|------|------|------|
| **信任钉值** | 中台直接用 UI 钉的 rate 复算，只重算规则 | 汇率已在前序环节锁定/审批 |
| **复核钉值** | 中台按 `rateId`/`key` 向权威源重取，与 UI 钉值比对，落在 `tolerance` 内→接受，否则→拒绝并要求刷新 | 实时汇率、要求中台最终确认 |

无论哪种，**规则计算本身**在中台用钉死的同一份 `resolved` 值跑 → 与 UI **逐位一致**。差异（若复核超容差）走 §架构 4.3 的 divergence 事件留痕。

### 4.3 确定性的新定义（关键）

ADR-1 的"确定性"在引入异步后**精确化**为：

> 引擎对 **(inputs + pinned resolved values + ruleSetVersion)** 这一组完整输入，确定地产出相同结果。
> 取数的非确定性被隔离在引擎之外；钉值使这组输入在 UI 与中台之间**完全相同**。

所以纯引擎依然纯、依然可单源多目标编译（ADR-1 路线 B 不受影响）。

---

## 5. 大页面工程化（UI 侧，非规范，指导性）

上千栏位时，先卡的往往是 UI 框架本身而非引擎：

- **不要一个上千控件的巨型 FormGroup**——其内建校验/valueChanges 自身就慢。用 **signals 状态 store** 或按区块（信用证/收费/付费）拆成多个小表单。
- **虚拟化 / 懒渲染 / 分 Tab**：只渲染可见区的 DOM。
- **OnPush + `track`**：只重渲染变化的行。
- **引擎放 zone 外算**，算完 patch，避免整页变更检测。
- **异步取数只让依赖字段进入"计算中"态**，不阻塞整页交互。
- 引擎与 UI 通过"脏字段集 + 结果增量"通信，避免每次回传整棵树。

---

## 6. 与现有文档的衔接

| 文档 | 增补点 |
|------|--------|
| **Schema** | 新增 `resolver` 规则类型；新增 `dataSources` 数据源登记；lint 增"resolver.key 字段合法""source 已登记""external 字段不可被 formula 直接赋值" |
| **表达式规范** | 求值四态（stale/pending/resolved/error）；`pending` 传播与校验挂起语义；重申外部数据=注入输入（§6.5 延伸） |
| **架构** | 新增分发/执行层的"异步解析层"组件；ADR 增补（见 §7） |

---

## 7. ADR 增补

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| ADR-7 | 计算如何用外部数据 | **Resolver 注入字段，引擎不做 IO** | 保纯保一致；取数可异步/缓存/治理 |
| ADR-8 | 大规模如何求值 | **增量依赖图，只算受影响子图** | O(子图) 取代 O(全部)，定位清晰 |
| ADR-9 | 异步值如何保证一致 | **钉值快照 + 中台复核/信任** | UI=中台逐位一致 + 完整审计 |
| ADR-10 | 外部数据源治理 | **Data Source Registry，登记+版本+权威源+容差** | 杜绝"两端不同源" |

---

## 8. 分阶段落地建议

1. **地基**：在 Schema 落 `resolver` + `dataSources`（本轮文档已含，机读 schema 已更新）。
2. **引擎**：实现增量依赖图求值（同步纯子图先跑通）。
3. **异步层**：接入 resolver 编排 + 四态 + mock 汇率源。
4. **一致性**：钉值快照 + 中台复算（先"信任钉值"，后加"复核容差"）。
5. **UI**：signals store + 虚拟化 + zone 外计算。
6. **运营**：缓存、灰度、divergence 监控、resolver 失败告警。

> 原型建议先打通 **2 + 3**（增量图 + 异步 resolver）这两块最难的，在 Angular 示例里用 mock 汇率演示"改收费币种→异步取汇率（计算中态）→只重算受影响子图→钉值"。

---

## 9. 未决 / 待后续

1. Resolver 的批量取数（一次解析多条收费的汇率）协议。
2. `pending` 期间用户继续编辑的并发/竞态处理（取数返回时输入已变）。
3. 跨子记录的批量校验在增量模型下的触发时机（`on-submit` 类全量校验如何与增量协调）。
4. 快照体积（上千字段 + 大量 resolved）的压缩与差量提交。
5. Data Source 的离线/降级策略（取不到汇率时能否暂存草稿）。
