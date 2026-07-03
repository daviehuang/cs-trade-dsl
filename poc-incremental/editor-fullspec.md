# 完整版可视化规则/参数编辑器 —— 功能规格 + 路线图

> 现有 [`editor-react`](./editor-react) 是**简易版**（编辑绑 root 的顶层面板字段、加单表达式 formula/validation、
> 加模型字段 + 实时预览 + lint + 导出）。本文件定义**完整版**要提供的功能：让用户**可视化设参**、**便于参数管理**，
> 面向**业务与开发两类人**，存储**先前端后后端两阶段**。
>
> 基准：DSL 可编写面 = 模型(nodes/fields/extends/abstract/slots/children) + 4 类规则(formula/validation/resolver/pipeline，
> 含 cases/when/fallback) + 模块(modules + uses/bind/produce) + dataSources + context 接缝 + imports(类型库/模块库) + 表达式内置函数。
> **引擎（`src/incremental.js`/`kernel.js`）是唯一真相源，编辑器只产出 RuleSet + PageDef 两份 JSON，不改引擎。**
>
> **治理红线（贯穿全文）**：UI 不编码业务逻辑；算/校验只在 RuleSet；页面(PageDef)只做绑定/布局；产物必须过 lint 才能发布。
> `trigger/severity/code/dataSources` 等引擎不读的键仍要能编辑（供治理/BFF）。

---

## 一、功能全景（14 个域；★=简易版已有，其余为缺口）

### 域 1 · 数据模型设计（Schema Designer）
- 节点 CRUD（增/改名/删）、设 `root`。
- 字段：`type`(string/decimal/int/date)、`computed`/`external`/`overridable`（★仅 computed + 三类型）。
- 继承：`extends` 选基类、`abstract` 开关；**有效字段预览**（沿链合并，复用 `effectiveFields`）。
- 结构：`slots`（具名单子节点）、`children`（具名集合）。
- 图形化：继承链 + slots/children 关系图，点节点进属性面板。

### 域 2 · 规则编写（4 类全覆盖）
- 列表管理：编辑/删除/复制/`enabled` 开关/拖拽排序（★仅只读 + 新增）。
- **formula**：`target` + 三形态之一——单 `expr` / `when+expr` / **`cases[]` 多分支** + **`fallback:"input"`**（条件可输入）。（★仅单 expr）
- **validation**：`expr`(须 ==true) + `message`(`{expr}` 插值助手) + `severity` + `code`。（★有，severity/code 写死）
- **resolver**：`target`(external 字段) + `source`(选 dataSource) + `key`(keyName→expr)。（缺）
- **pipeline**：`target` + `steps[]`（每步 expr，隐式 `value`）。（缺）
- `scope`(节点类型) / `trigger`(calc/after-calc) 显式可选。
- **表达式构造器**：作用域标识符补全（`self`字段/`parent`/`root`/`ctx.*`/子集合名）+ 内置函数面板
  (`sum/round/len/in/coalesce/clamp…`) + 引擎 `parseCached` 即时语法校验（★ExprField 已有，全域复用）。

### 域 3 · 模块与装配（Modules & uses）
- 模块定义：`modules`{moduleId/version/inputs/context/fields/rules/outputs}；模块内规则复用域 2 编辑器（模块命名空间）。
- 装配 `uses`：`use`(选模块，裸名 / `alias.mod`) + `on`(宿主类型) + `as` + **`bind`(入参←宿主 expr)** + **`produce`(输出→宿主字段)**——可视化端口连线。（✅ ModulesEditor「模块」tab：模块 CRUD（inputs/fields/resolver·formula·validation 规则/outputs）+ uses 装配 bind/produce，端口按已 import 模块 inputs/outputs 引导）

### 域 4 · 数据源（dataSources）
- 登记：`sourceId/version/returns/keySchema/authority/cachePolicy/tolerance`。（✅ DataSourceEditor，「数据源」tab；作用于场景或库）
- 与 resolver 联动：`source` 从已登记项选、`key` 按 `keySchema` 引导。（✅ resolver 表单读已登记源）
- 注：引擎不读 dataSources（契约/治理/BFF 用）；lint 一致性（resolver.source 已登记、key 覆盖 keySchema）为后续。

### 域 5 · 上下文/接缝（context seams）
- `context` 映射编辑：`key → expr`（如 `ccy: root.dealCcy`）——"外部传入"的接缝。
- 接缝面板：ctx.* 汇总为"本场景需外部提供的参数"；消费点反查（谁用了 ctx.ccy）。（全缺）

### 域 6 · 库与依赖管理（imports / 可复用组件）
- `imports` 增删：从**库目录**按 `ref`(id@version) 选类型库/模块库（区分 flat 类型库 vs aliased 模块库）。（✅ ImportsManager）
- **库的新建/编辑/删除**：库是可编辑的工作区工件——「编辑对象」可在场景↔库间切换，选中库后 模型/规则/上下文/库 tab 作用于该库；新建库(类型库/模块库/两者)后进目录并可被 import。（✅ LibraryManager + editTarget，经 libToRS 适配复用同批编辑器）
- 依赖图 + 版本升级影响分析（哪些节点/规则/绑定受影响）。（后续）
- 组件目录：commonFx/commonParty/commonMixPayment… 浏览/检索/预览/"引用到本场景"。（✅ 目录列表+概览）

### 域 7 · 页面布局（PageDef WYSIWYG）
- 全节点可编辑（★仅 root 顶层 field/cell）：panel(`variant/tone/grid/badge/at`)、field(`label/control`)、cell(`emphasis`)、**collection**(`itemTemplate/itemGrid/newItem`)、slot 面板、`validations` 节点、`className`。
- **拖拽**：调色板(按 `buildMeta` 列)拖入画布 + 容器内排序；控件种类按字段 spec 强制。
- WYSIWYG：画布即 `hydratePage`→UI-IR→ui-kit-react 渲染；选中↔属性面板双向。

### 域 8 · 运行时参数/接缝值（per-scenario）
- 场景参数表：把域5的 ctx、域3的 bind、域4的 external 源收敛成一张表，业务填值/选来源。
- 多场景：同一组件/RuleSet 多套参数值，切换预览。

### 域 9 · 测试数据 + 预览 + 取数模拟 + 检查器
- 测试数据可视化编辑（集合增删行走引擎 `addChild/removeChild`）+ 多组样例切换（★写死 lc-data）。
- resolver 模拟器：每个 dataSource 配 mock 值表，预览异步取数(pending→resolved)。（✅ ResolverSim「取数模拟」tab：按 keySchema 配「条件→返回值」表 + 延迟 + fallback，mocks 入工作区持久化，Preview 用其生成 resolve）
- 检查器：`getState()` 的 overrides/pinned/validations/anyPending + 单元格状态(resolved/pending/error/overridden/input)。
- 复用 `useEngineSession`(structVersion vs version) + `key=版本` remount。

### 域 10 · 校验 / lint / 治理
- `lintPageDef` → **lintBundle**：PageDef 绑定 + 规则(target/scope 存在、expr 语法、resolver.source 已登记、cases 完整) + 模块(bind 覆盖 inputs、produce 目标存在) + imports(ref 可解析、无循环) + 抽象不可实例化 + 命名冲突。
- 发布闸门：error 阻断、warn 提示；治理红线校验（页面无算逻辑入口）。

### 域 11 · 版本 / 发布 / 回滚 / 审计
- 每工件(RuleSet/PageDef/库)独立 `version`+`status`(draft/active/deprecated)+`schemaVersion`。
- 结构级 diff、发布/回滚、变更历史/审计、`ruleSetRef` 兼容闸门（PageDef↔RuleSet 版本匹配）。

### 域 12 · 存储 / 后端（两阶段）
- **一期（纯前端）**：导入/导出 JSON + localStorage/IndexedDB + 工作区；后端接口预留。
- **二期（Rule Bundle API）**：DB + 版本库 + 按 `ref` 拉取/缓存 + 发布/回滚 + 多人/权限/审计。

### 域 13 · 协作 / 权限（二期）
- 多人（锁/合并）、角色权限（业务只读基础参数 vs 开发改规则/模块）、评审/审批流。

### 域 14 · 编辑器体验
- **分层 UI**：基础模式(向导/模板/表单/参数表，少代码) ↔ 高级模式(规则/模块/表达式/JSON)。
- undo/redo、全局搜索(引用查找)、模板与脚手架、i18n 标签、原始 JSON 双向编辑(★已有查看)。

---

## 二、参数管理映射（5 块诉求 → 落在哪）

| 诉求 | 域 | 一句话 |
|---|---|---|
| DSL 配置资产治理 | 11 + 12 | 版本/status/diff/发布/回滚/审计 + 存储 |
| 可复用组件/库管理 | 6 | imports 目录、依赖图、版本升级影响分析 |
| 运行时参数/接缝值 | 5 + 8 | context/bind/external 收敛成"场景参数表"，业务填值 |
| 数据源/dataSources | 4 | 可视化登记 + 与 resolver 联动 + lint 一致性 |
| UI 页面布局 | 7 | 全节点 WYSIWYG + 拖拽 + 属性面板 |

---

## 三、最大化复用（不重造）

| 复用 | 出处 | 用于 |
|---|---|---|
| `buildMeta`(effectiveFields/effectiveSlots/childrenOf) | `ui-kit-core/src/engine-meta.ts` | 节点/字段/槽位/集合下拉 + 继承预览 |
| `lintPageDef`(→`lintBundle`) | `ui-kit-core/src/lint.ts` | 发布闸门 |
| `hydratePage` + `buildRootIR` | `ui-kit-core/src/hydrate.ts`/`build-root-ir.ts` | WYSIWYG 画布 + 自动布局回退 |
| `ExprField` + `parseCached` | `editor-react/src/ExprField.tsx` | 全域表达式即时校验 |
| `useEngineSession` + `Preview` remount | `ui-kit-react/src/ctx-react.ts`/`editor-react/src/Preview.tsx` | 实时预览模板 |
| `makeCtx`/`EngineCtx` | `ui-kit-core/src/make-ctx.ts`/`engine-shared.ts` | 测试数据/集合行/override/pinned 走引擎现成 API |

---

## 四、分期路线图（每期可跑可验证）

- **Phase 0（已完成）**：简易版 `editor-react`。
- **Phase 1 · 完整前端编辑（✅ 已实现于 `editor-react`）**：域 2 完整规则(4 类型+cases/fallback+编辑/删除/复制/enable) · 域 1 模型 CRUD(节点/字段/extends/abstract/slots/children) · 域 5 context 接缝+消费反查 · 域 6 imports 选库(库目录+概览) · 域 7 PageDef WYSIWYG(结构树+属性 Inspector+类型感知调色板+拖拽) · 域 9 测试数据 JSON 编辑 + override/pinned/校验检查器 · 域 14 undo/redo · 域 12 一期 localStorage + 导入/导出。
  - 落地文件：`editor-react/src/` 的 `store/editorStore.ts`、`ModelDesigner.tsx`、`RulesEditor.tsx`、`ContextSeams.tsx`、`ImportsManager.tsx`、`LayoutCanvas.tsx`、`TestData.tsx`、`Preview.tsx`(含 Inspector)、`App.tsx`(6 tab + 工具栏)。
  - 验证：`tsc --noEmit && vite build` 通过（64 模块）；Edge headless 截图核对布局树/模型设计器/规则 4 类型/检查器/预览均正常；实时预览 net=82203.22、校验 ✔23、pinned 列全。
- **Phase 2 · 模块/数据源 + 治理 + 分层 UI**：域 3 模块+uses 连线（✅ ModulesEditor）· 域 10 RuleSet linter（✅ lintRuleSet：引用完整性/target 可写回/resolver.source·keySchema/可选 slot）· 域 4 dataSources+resolver 模拟（✅ ResolverSim）· 域 11 版本/diff/发布-回滚（待办）· 域 14 分层 UI/模板向导（待办）。
- **Phase 3 · 后端 + 协作**：域 12 二期(Rule Bundle API) · 域 13 多人/权限/审批 · 域 6 组件目录/依赖图 · 域 8 多场景参数值。

---

## 五、验证（贯穿各期，复用现有手段）

1. **引擎对账（真值）**：编辑器产物 → `createSession` → `idle` → `getState()` 断言（`verify-multiframework.mjs`/`verify-mixpayment.mjs` 模式）。
2. **跨框架一致**：同 RuleSet+PageDef 在 `react-lc-sample` 与 Angular 渲染/计算逐项一致（Edge headless 截图）。
3. **往返无损**：export→清空→import→deep-equal；`lintBundle` 零 error。
4. **治理红线**：cell 只能绑 computed/external 字段（页面无算逻辑入口）；`ruleSetRef` 不匹配→lint 警告。
