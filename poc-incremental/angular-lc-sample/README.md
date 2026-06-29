# L/C 结算 · 增量引擎 Angular 示例

按 `poc-incremental/lc-rules.json` 规格构建的 Angular 17 样板程序，演示统一业务规则 DSL 的
**增量引擎**在真实前端框架里的完整接入。与 `third-party-incremental.html`（纯 HTML 版）等价，
但用 Angular standalone 组件 + 依赖注入 + HttpClient 运行时加载规则的方式实现。

> **一份规则 · 两种渲染**：顶栏可在两个版本间切换——
> - **手写渲染版**（`app.component.ts`）：模板逐字段手绘，控制力最强；
> - **ngx-formly 模型驱动版**（`formly/`）：由运行时加载的 `model.nodes` **模型驱动地动态生成**
>   formly 字段树。同一份 RuleSet、同一引擎、同一 BFF，只是渲染方式不同。它最能体现
>   "UI 不写死字段、按 model 动态渲染" 这一硬约束。

## 这个示例覆盖了 lc-rules.json 的全部特性

| 特性 | 规格来源 | 示例中的体现 |
|---|---|---|
| **运行时加载 RuleSet**（不编译进包） | 项目硬约束 | `RuleRepositoryService` 按 `featureId` 从 `assets/rules/*.json` 拉取 |
| **跨 RuleSet imports** | `imports:[{ref:"commonFx@1.0.0",as:"fx"}]` | 仓库解析 imports 后并行拉取 `commonFx.json`，组成 `imports` 注册表传给引擎 |
| **参数化模块 fxConvert** | `uses:[{use:"fx.fxConvert",...}]` | 明细/付费的 `fxRate`、`base` 由模块产出（标注"模块算"） |
| **异步 resolver（汇率）** | `dataSources` + module resolver | `FxService.resolve` 模拟后台取数（延迟 900ms），引擎自身不碰 IO |
| **任意深度嵌套** | LC → 收费组 → 明细；LC → 付费 | 三层结构全部由 `getState().tree` 驱动渲染 |
| **可覆盖计算字段** | `ChargeItem.base.overridable` | 明细 base 蓝色可人工议定 → `setOverride` / `clearOverride` |
| **条件计算 + fallback:input** | `calcAdjustment` cases/when | 手续调整：auto-* 为公式态（改即篡改），manual 为可输入态（合法） |
| **增量重算 / 异步 pending** | ADR-7/8 | 右栏"引擎事件"实时显示触发的字段链与异步取数 |
| **中台篡改校验** | ADR-2/3 + 钉值复核 | "提交到中台"调用 BFF，对篡改计算值 / 越权覆盖 / 钉值汇率做权威复核 |

## 运行

```bash
cd poc-incremental/angular-lc-sample
npm install
npm start            # ng serve --open，默认 http://localhost:4200
```

如需演示**中台校验**（"提交到中台"按钮），另开一个终端启动 BFF：

```bash
cd poc-incremental
node bff/server.js   # 监听 http://localhost:8787
```

不启动 BFF 也能跑——前端计算、异步汇率、增删、覆盖、条件计算全部可用，
只有点"提交到中台"时会提示 BFF 未连接。

## 关键设计点

- **引擎是单源的**：`src/app/dsl/kernel.js`、`incremental.js` 直接拷贝自 `poc-incremental/src/`，
  与 PoC / BFF / 中台是同一份逻辑（ADR-1 路线 B）。`incremental.d.ts` 仅提供 TypeScript 类型。
- **引擎是 source of truth**：组件不维护表单状态，所有值/状态/校验都来自 `session.getState()`；
  编辑控件直接调 `setInput / setOverride / addChild / removeChild`，引擎 `onUpdate` 回灌视图。
- **NgZone**：异步 resolver 的回调包在 `NgZone.run` 里（见 `FxService`），保证取数完成后变更检测刷新。
- **"篡改" vs "合法覆盖"**：明细 base 编辑走 `setOverride`（合法，进引擎、随交易声明）；
  小计/合计/净额/付费 base 编辑只记到 `tamper` 表（不进引擎），提交时注入 payload 让中台识破。

## ngx-formly 版是怎么接的

核心思想：**formly 只负责"按模型动态渲染字段树"，引擎仍是计算与校验的唯一真相源**
（符合"中台负责校验和计算"——前端不重复实现校验/公式）。

1. `engine-meta.ts` 合并 `import` 的类型库节点与本规则集 `model.nodes`，沿 `extends` 链
   推导每个节点的有效字段及其 `computed / external / overridable` 标记。
2. `engine-formly.ts` 的 `buildRootFields()` 递归遍历引擎 `getState().tree`，把每个 `ViewNode`
   翻译成 `FormlyFieldConfig`：可编辑字段 → `eg-field`，计算/外部值 → `eg-cell`（只读、可覆盖），
   具名槽位 → 面板，子集合 → `eg-collection`（带增删）。
3. 自定义类型不持有数据：取值/编辑/增删/校验全部经 `EngineCtx` **委托回引擎会话**
   （`setInput / setOverride / addChild / removeChild`、`getState().validations`）。
4. **结构变化**（增删子记录）时重建字段树（`rebuild()`）；**值变化 / 异步取数**只刷新——
   模板里的取值都是实时方法调用，引擎 `onUpdate` + NgZone 触发变更检测即可刷新。

对比意义：手写版字段写死在模板里；formly 版字段完全由运行时 RuleSet 的 `model` 推导，
**改规则即改表单、无需改前端代码**——这正是"运行时加载、按 model 动态渲染"的最直接体现。

## 用自己的页面编辑器接引擎（BYO Editor）

formly 版顶部「**界面来源**」可切换：**模型自动生成** ↔ **自定义 PageDef（编辑器产物）**。
后者演示了"你画页面、引擎做算校验"的完整分层——把"自动生成"换成
「可序列化 PageDef + 运行时 hydrator + 发布期 linter」，绑定层（`eg-*` 自定义类型 + `makeCtx`）当 SDK 复用：

- `page-def.ts` — PageDef 的可序列化 schema（编辑器保存的东西，纯 JSON，不含运行时 ctx）
- `hydrator.ts` — `hydratePage(pageDef, ctx, state, meta)`：注入 ctx、按实际行数展开集合、控件种类从模型推导
- `lint.ts` — `lintPageDef(pageDef, ruleSet, imports)`：发布期校验绑定（字段存在、控件种类匹配、集合/at 合法），出错运行时回退自动布局
- `assets/pages/lcSettlement.page.json` — 一份示例 PageDef（故意重排/取子集，证明"编辑器驱动"）

> 设计与规则详见 [`docs/byo-editor-binding.md`](docs/byo-editor-binding.md)：界面↔引擎契约、编辑器产物要遵循的规则、需要做的改造、治理边界。

## 目录

```
src/
  app/
    dsl/incremental.js   增量引擎（拷贝自 poc-incremental/src，单源）
    dsl/kernel.js        表达式内核（同上）
    dsl/incremental.d.ts 引擎 TypeScript 类型
    engine.service.ts    封装 createSession 的可注入服务
    fx.service.ts        宿主汇率解析器（resolve 回调 + NgZone）
    rule-repository.service.ts  运行时拉取 RuleSet + import 的模块库 + 初值
    shell.component.ts   外壳：手写版 / ngx-formly 版切换
    app.component.ts     手写渲染版 L/C 表单（多层嵌套 + 全部特性）
    formly/
      engine-meta.ts     从 RuleSet+imports 推导字段/槽位/子集合（继承感知）
      engine-shared.ts   纯 SDK：常量、控件推导、路径解析、EngineCtx
      engine-formly.ts   绑定层：eg-* 自定义类型 + makeCtx + 注册清单 + 回退生成器 buildRootFields
      page-def.ts        PageDef 可序列化 schema（编辑器产物的类型契约）
      hydrator.ts        运行时装配器 hydratePage(pageDef, ctx, state, meta)
      lint.ts            发布期 linter lintPageDef(pageDef, ruleSet, imports)
      formly-lc.component.ts  ngx-formly 主组件（界面来源：自动生成 ↔ 自定义 PageDef）
  assets/pages/
    lcSettlement.page.json    示例 PageDef（模拟页面编辑器产物）
  docs/byo-editor-binding.md  「用自己的编辑器接引擎」契约/规则/改造说明
  assets/rules/
    lcSettlement.json         = poc-incremental/lc-rules.json
    commonFx.json             = poc-incremental/commonFx.json（被 import 的模块库）
    lcSettlement.sample.json  = poc-incremental/lc-data.json（业务初值）
```
