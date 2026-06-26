# 统一业务规则 DSL —— 功能检查点（Check Points）

> 记录已完成与待增强的功能点。`[x]` 已完成（含实测）；`[ ]` 待做。
> 更新日期：2026-06-25

---

## 1. 设计文档

- [x] 设计目标总结 —— `unified_dsl_summary.md`
- [x] 架构设计 + ADR —— `unified_dsl_architecture.md`（ADR-1~10：单源多目标、双执行裁决、Function 治理、版本化、Resolver、增量图、钉值快照、数据源治理…）
- [x] DSL Schema 规范 —— `unified_dsl_schema.md`
- [x] 表达式语言规范 —— `unified_dsl_expression.md`
- [x] 异步取数/规模/一致性补充 —— `unified_dsl_async_scale.md`
- [ ] 文档间术语/编号一次性对齐校订（随实现演进回填）

## 2. DSL Schema 与静态校验

- [x] 顶层 RuleSet + model（节点/字段/children）正式 schema
- [x] 4 类规则（validation / formula / function / pipeline）+ trigger + scope
- [x] resolver 规则类型 + dataSources 数据源登记（含 tolerance/authority）
- [x] 机读 JSON Schema（Draft 2020-12）`schema/ruleset.schema.json`（ajv 实测：正例过、反例拒）
- [x] 字段标记 computed / external
- [ ] **Lint 引擎落地**：规范 §8 的 10 条静态检查（唯一性、引用存在、字段/作用域合法、无环、类型相容、纯净性、trigger 自洽、resolver/external 约束）目前仅文档定义，未实现可运行校验器
- [ ] model 可选 `ui` 元数据（label/控件类型/分组/排序），让动态表单开箱即用
- [x] **单 RuleSet 内模块化机制**（`unified_dsl_modules.md` 的 §3-5）：Module 参数化 + `use…on…bind…produce` 绑定 + `ctx` 环境上下文，已在增量引擎实现并实测（同一 fxConvert 模块复用到 Charge/Pay 两类节点，ctx 取头部数据，模块=依赖图子图，增量正确）
- [x] **跨 RuleSet imports**（`unified_dsl_modules.md` §6）：模块库按 `id@version` 引入 + 命名空间别名(`fx.fxConvert`) + 版本锁定 + 跨库组合链 + 跨库模块校验，已在增量引擎实现并实测（opts.imports 注册表，生产中对接 Rule Bundle API）
- [ ] 跨 RuleSet 治理：钻石依赖/版本冲突、命名空间冲突 lint、跨边界 ctx/dataSources 契约校验
- [ ] modules/uses/context/imports 的 **JSON Schema 形式化**（当前 `unified_dsl_modules.md` 为提案，机读 schema 未含这些构造）
- [x] 模块内 **validation**（模块上下文求值、含 ctx 插值，上浮到 getState().validations 并带 host 节点）
- [x] 模块**组合链**（A.produce → host 字段 → B.bind；依赖图自动接序，链式增量正确）
- [ ] 模块机制其余工程化：模块内 pipeline、模块 cell 随宿主增删的回收、lint（位置无关性强制等）
- [ ] 动态 scope —— 大部分被 `when`/`cases` 覆盖；排序/聚合选取的残余场景待评估
- [x] **节点类型继承 + 抽象基类 + 具名槽位(slots)**：`Party`(abstract) ← `CustomerParty`/`BankParty`，`extends` 沿链合并字段、`scope`/`uses.on` 按 `is-a` 分发、`slots` 具名单子节点（applicant/beneficiary/各 Bank），已在增量引擎实现并实测（`party-scenario.mjs`：基类校验全员、子类型校验隔离、跨槽位表达式、字段隔离）
- [ ] 继承/槽位的 **JSON Schema 形式化** 与 lint（抽象类不可实例化、slots 目标须具体子类型）
- [ ] 数据加载能否恢复override状态

## 3. 表达式引擎（内核）

- [x] Lexer / Parser（递归下降）+ 运算符优先级
- [x] 十进制语义：禁浮点、HALF_UP、除法标度、整数溢出（decimal.js / BigDecimal）
- [x] null 传播（逐算子定义）+ 三值逻辑短路
- [x] 内置函数：聚合 / 数学 / 字符串 / 空值类型工具
- [x] 确定性（纯函数、顺序无关、禁 IO/时钟/随机）
- [x] message 插值
- [x] 按集合名聚合 / 深路径（`sum(items.base)`、`sum(charges.subtotal)`）
- [ ] **路径扩展回填**：集合聚合/深路径目前只改了 `poc-incremental/src/kernel.js` 副本，需回填 canonical kernel（`poc/js/src/kernel.js`）与表达式规范
- [ ] date/datetime 运算与内置日期函数（规范留空）
- [ ] 自定义聚合谓词（`every/any` 的 pred 表达）

## 4. 跨语言一致性 / 路线 B（ADR-1）

- [x] JS 内核（kernel.js + engine.js）—— `poc/`
- [x] Java 内核（Dsl.java，BigDecimal）—— 表达式+十进制
- [x] golden 向量跨语言一致：JS 22/22、Java 22/22、逐位一致 0 drift
- [x] **路线 B 真身**：单一 `kernel.wasm`（WAT 编译）在 Node + JVM（Chicory）逐位一致 12/12 —— `poc-wasm/`
- [ ] **生产内核单源**：用 Rust(`rust_decimal`)/AssemblyScript 写一份，编译 wasm32，覆盖**完整 34 位十进制 + 解析器 + 规则引擎**（当前 wasm 仅 5 个十进制算子；JS/Java 为两套手写）
- [ ] Java 侧**完整规则引擎**（树/作用域/pipeline/resolver），现仅表达式+十进制
- [ ] Function 双端实现的 CI 一致性门禁（goldenTests）—— 机制定义，未建流水线

## 5. 规则执行：增量 / 异步 / 嵌套（ADR-7/8）

- [x] 全量重算引擎（中小表单）—— `poc/js/src/engine.js`
- [x] **增量依赖图引擎**：改一处只重算受影响子图 —— `poc-incremental/src/incremental.js`
- [x] 动态依赖追踪（Proxy 读取建边）
- [x] **异步 resolver 层**：外部数据注入 + 四态（stale/pending/resolved/error）+ pending 传播
- [x] **任意深度嵌套 + 多分支子集合**（递归实例化层）
- [x] **子项增删**（墓碑策略 + cell 回收 + in-flight 取数安全丢弃）
- [x] **可覆盖计算字段**（model `overridable` + `setOverride/clearOverride`；覆盖值持有、下游重算、随交易声明提交；中台 honor 合法覆盖、拒绝越权覆盖）
- [x] **条件计算 + 否则用输入**（三元 / `when`+`fallback` / **`cases` 多分支**：一 when 一 expr，都不中走 fallback；比嵌套三元清晰；条件依赖按分支精确追踪）
- [x] **`when`/`cases` 守卫 → 条件可输入字段**（守卫为真=公式态、都不中=可输入态；中台**独立评估守卫**决定该字段重算+防篡改 还是 当输入接受，客户端无法伪造模式）
- [x] JSON Schema 回填：`children` 支持数组（多分支子集合）、formula `when/cases/fallback`
- [x] 钉值快照（value+key+source+rateId）
- [ ] resolver 失败的**重试 / 缓存 / 降级**（当前仅置 error+告警）
- [ ] 覆盖的**授权 / 上限策略**（谁可覆盖、覆盖值边界）—— 当前仅"哪些字段可覆盖"+ 业务校验约束，未做授权与 bounds
- [ ] resolver **批量取数**（一次解析多条收费汇率）
- [ ] pending 期间用户继续编辑的**并发/竞态**处理（取数返回时输入已变）
- [ ] `on-submit` 类全量校验在增量模型下的触发时机协调
- [ ] 增量引擎也做**单源多目标**（供 Java 中台复用）

## 6. UI 接入形态（多 UI 复用）

- [x] 纯 HTML 内联（`poc/viz.html`）
- [x] 第三方页面 + 全局脚本发行版（`poc/third-party-sample.html` + `dist/unified-dsl.js`）
- [x] Angular（ESM import + 注入 Service）`poc/angular-sample/`
- [x] **运行时动态加载 RuleSet**（不编译进包）+ **schema-driven 动态表单**
- [x] 第三方接入增量引擎（`poc-incremental/third-party-incremental.html`）
- [x] 子项增删按钮、数据模型实时查看器
- [x] 计算值/汇率可编辑（用于篡改演示）+ 可覆盖字段（base）+ **条件可输入字段（adjustMode auto/manual → adjustment 公式态↔可输入态切换）**
- [ ] React / Vue 接入示例
- [ ] 引擎发行物的 **npm 包**（ESM + UMD 双产物 + d.ts）
- [ ] 大页面工程化：**虚拟化 / 懒渲染 / signals store / zone 外计算 / Web Worker 卸载**（上千栏位）

## 7. 中台校验（BFF）（ADR-2/3/9）

- [x] BFF HTTP 服务（Node，CORS）`poc-incremental/bff/server.js`
- [x] **只取原始输入 + 权威重算 + 比对**：计算值篡改检测（精确定位字段，含三层深）
- [x] **钉值汇率权威复核**（按 dataSources.tolerance 容差）：识破"汇率+计算值自洽篡改"
- [x] 裁决 ACCEPT / REJECT_TAMPER / REJECT_VALIDATION + 前端/中台值对照
- [x] 端到端实测（真实 HTTP，含容差边界）
- [x] **接受"纯数据"第三方提交**：类型由 model 推导（不需客户端 `_type`/state），未提供的计算值不比对（以中台重算为准），计算值/pinned/overrides 全部可选
- [ ] **真 Java 中台**复算（用 WASM 内核，端到端 Node↔Java 同内核裁决）
- [ ] 提交**鉴权 / 签名 / 防重放**
- [ ] divergence 事件**留痕与监控**（一致性健康度指标）
- [ ] "信任钉值" vs "复核钉值"策略可配置 + 汇率源真实接入

## 8. 规则治理与分发（多为待建）

- [ ] **Rule Bundle API**（按 ruleSetId@version 下发、缓存、ETag）—— 当前样例用静态 asset / script 标签模拟
- [ ] 规则**版本化 / 不可变发布 / canary 灰度 / 指针回滚**
- [ ] Function Registry **注册治理流程**（提案→评审→CI 门禁→审批→激活→废弃）
- [ ] dataSources 数据源治理流程同上
- [ ] 规则发布前 Lint/审批门禁（接 §2 的 Lint 引擎）
- [ ] 交易落库记录所用 ruleSet@version（历史可回放）

## 9. 可观测与运维（待建）

- [ ] divergence 指标化 + 告警阈值/运营流程
- [ ] resolver 失败、版本偏移（version skew）告警
- [ ] 每个内置函数/算子的 golden 用例纳入 **CI 回归**
- [ ] 钉值快照体积压缩 / 差量提交

## 10. 已交付 PoC 一览（可运行）

| 目录 | 内容 | 验证 |
|------|------|------|
| `poc/` | JS+Java 双内核、golden 一致性、HTML/第三方/Angular 接入 | golden 22/22；Angular `ng build` 通过 |
| `poc-wasm/` | 单一 kernel.wasm 在 Node+JVM(Chicory) | 跨宿主 12/12 一致 |
| `poc-incremental/` | 增量引擎+异步 resolver+任意深度+增删+条件计算/覆盖+**模块化(fxConvert 复用)**+BFF 篡改校验 | run-scenario 断言通过；BFF HTTP 实测；示例 `lc-rules.json` 已用 module 改写 |

---

## 优先级建议（下一步）

1. **生产内核单源化**（Rust/AS → wasm，完整引擎）—— 解决"JS/Java 两套手写"的根本，使路线 B 真正落地。
2. **Lint 引擎 + Rule Bundle API + 版本化**—— 让规则可治理、可发布、可回滚（目前最薄弱）。
3. **真 Java 中台**接 WASM 内核，端到端同内核裁决。
4. resolver 工程化（缓存/重试/批量/竞态）+ 大页面 UI 工程化。
5. 可观测（divergence 监控）+ CI 回归门禁。
