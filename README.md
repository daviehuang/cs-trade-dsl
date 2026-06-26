# 统一业务规则 DSL（Unified Business Rule DSL）

> **一套规则 → 多端运行**：把业务规则（校验 + 计算 + 状态控制）从 UI 和微服务中解耦，
> 在前端 UI、Node.js BFF、Java 中台上以**完全一致**的语义执行。
> 领域背景：国际结算 / 信用证（L/C）—— 上千字段、层层嵌套子记录、计算依赖后台异步取数（汇率）。

## 方案汇报（PPT）

📊 **[统一业务规则DSL-架构与改造方案.pptx](统一业务规则DSL-架构与改造方案.pptx)** —— 14 页汇报，覆盖
架构、功能特性、方案亮点、跨语言一致性验证，以及**现有 J2EE 系统的渐进式（Strangler Fig）改造路径**。

## 为什么需要它

同一条业务规则（如"净额 = 收费合计 − 付费合计 + 手续调整，且不超过上限"）通常要在前端写一遍 JS、
BFF 写一遍、后台再写一遍，三处极易漂移。本项目用**单源内核**（ADR-1 路线 B）把规则编译到多端目标，
保证"同输入必同输出"，并用十进制语义（HALF_UP，禁浮点）跨语言对齐。

## 仓库结构

| 目录 | 内容 |
|---|---|
| `unified_dsl_*.md` | 设计文档：架构与 ADR、Schema、表达式规范、异步/规模、模块化 |
| `schema/` | `ruleset.schema.json` —— 机器可读的 RuleSet JSON Schema（ajv 校验） |
| `poc/` | 双语言一致性 PoC（JS + Java，golden vectors）+ HTML/Angular UI 示例 |
| `poc-wasm/` | 路线 B 真身验证：内核编译为 `kernel.wasm`，用 Chicory 在 JVM 内运行 |
| `poc-incremental/` | **增量依赖图引擎**：任意深度嵌套、异步 resolver、可覆盖/条件计算、模块化与跨 RuleSet imports、BFF 中台篡改校验 |
| `poc-incremental/angular-lc-sample/` | Angular 17 样板：运行时加载 RuleSet + 模块库，驱动 L/C 多层表单 |

## 核心设计（ADR 摘要）

- **ADR-1 路线 B**：单源内核编译到多端目标，而非每种语言转写规则。
- **十进制语义**：decimal.js（JS）/ BigDecimal（Java），HALF_UP，精度 34，禁 IEEE 浮点。
- **ADR-7 Resolver**：汇率等异步外部数据作为字段注入，纯引擎从不做 IO。
- **ADR-8 增量引擎**：cell 依赖图、脏传播、拓扑结算、异步 pending 传播。
- **ADR-2/3 中台权威校验**：BFF 只取原始输入、权威重算、与客户端值比对，识破篡改与越权覆盖。
- **模块化**：参数化规则模块（inputs/outputs + bind + ctx）+ 跨 RuleSet imports，规则可复用且不绑定 model 层级。

## 快速开始

```bash
# 1) 双语言一致性（需要 Node；Java 部分需 JDK）
cd poc && cat README.md

# 2) 增量引擎场景演示（任意深度 + 异步汇率 + 增删）
cd poc-incremental && node run-scenario.mjs

# 3) Angular L/C 示例（运行时加载规则 + 多层表单 + 中台校验）
cd poc-incremental/angular-lc-sample && npm install && npm start
#   演示中台校验需另起 BFF：cd poc-incremental && node bff/server.js
```

各子目录另有独立 README / 文档，详述运行与验证步骤。
