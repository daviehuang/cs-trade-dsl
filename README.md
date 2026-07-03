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
| `poc-incremental/ui-kit-core/` | **框架无关渲染 SDK**：EngineCtx 契约 + PageDef + hydrate→中性 UI-IR + lint（PageDef 绑定 + RuleSet 一致性两维） |
| `poc-incremental/ui-kit-{react,vue,html}/` | 三个哑渲染 kit：UINode → 各框架控件；加 Angular（formly 绑定层）即**四端** |
| `poc-incremental/{angular,react,vue,html}-lc-sample/` | Angular / React / Vue / 原生 HTML 样本：运行时解释**同一份** PageDef + RuleSet，四端逐值一致 |
| `poc-incremental/editor-react/` | **可视化规则/参数编辑器**：模型/规则/模块/数据源/取数模拟/上下文/库/布局/版本 + 开发者·业务分层视图 |

## 核心设计（ADR 摘要）

- **ADR-1 路线 B**：单源内核编译到多端目标，而非每种语言转写规则。
- **十进制语义**：decimal.js（JS）/ BigDecimal（Java），HALF_UP，精度 34，禁 IEEE 浮点。
- **ADR-7 Resolver**：汇率等异步外部数据作为字段注入，纯引擎从不做 IO。
- **ADR-8 增量引擎**：cell 依赖图、脏传播、拓扑结算、异步 pending 传播。
- **ADR-2/3 中台权威校验**：BFF 只取原始输入、权威重算、与客户端值比对，识破篡改与越权覆盖。
- **模块化**：参数化规则模块（inputs/outputs + bind + ctx）+ 跨 RuleSet imports，规则可复用且不绑定 model 层级。

## 里程碑：多框架四端 + 可视化编辑器（PoC，已完成）

- **一套规则/页面 → 四端渲染**：同一份 RuleSet + PageDef + 引擎，经框架无关的 `ui-kit-core`（产出中性 UI-IR）
  与四个哑渲染 kit（Angular / React / Vue / 原生 HTML），渲染出**逐像素一致的界面、逐值相等的计算**
  （净额 `net = 82203.22` 四端相同）。逻辑（路径重定基、集合按 live state 展开、控件种类判定）只在 core 写一次，
  各框架适配器是 `switch(node.kind)` 的哑渲染。详见 [`poc-incremental/MULTI-FRAMEWORK.md`](poc-incremental/MULTI-FRAMEWORK.md)。
- **可视化规则/参数编辑器**（`editor-react/`）：产出 RuleSet + 库 + PageDef，实时预览 + 两维 lint + undo/redo + 本地持久化。
  **Phase 1**（模型 / 规则 4 类型 / 上下文接缝 / 库依赖 / PageDef 拖拽布局 / 测试数据）与
  **Phase 2**（模块装配 uses 端口连线 · resolver 取数模拟 · 版本/发布/回滚 + 结构 diff · 开发者/业务分层 UI）均已完成。
  规格与进度见 [`poc-incremental/editor-fullspec.md`](poc-incremental/editor-fullspec.md)。

## 快速开始

```bash
# 1) 双语言一致性（需要 Node；Java 部分需 JDK）
cd poc && cat README.md

# 2) 增量引擎场景演示（任意深度 + 异步汇率 + 增删）
cd poc-incremental && node run-scenario.mjs

# 3) Angular L/C 示例（运行时加载规则 + 多层表单 + 中台校验）
cd poc-incremental/angular-lc-sample && npm install && npm start
#   演示中台校验需另起 BFF：cd poc-incremental && node bff/server.js

# 4) 多框架样本（四端同一份规则与页面）+ 可视化编辑器
cd poc-incremental/react-lc-sample && npm install && npm run dev   # React（vue-/html-lc-sample 同理）
cd poc-incremental/editor-react && npm install && npm run dev      # 可视化规则/参数编辑器
```

各子目录另有独立 README / 文档，详述运行与验证步骤。
