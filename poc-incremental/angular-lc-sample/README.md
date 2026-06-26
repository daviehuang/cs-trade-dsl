# L/C 结算 · 增量引擎 Angular 示例

按 `poc-incremental/lc-rules.json` 规格构建的 Angular 17 样板程序，演示统一业务规则 DSL 的
**增量引擎**在真实前端框架里的完整接入。与 `third-party-incremental.html`（纯 HTML 版）等价，
但用 Angular standalone 组件 + 依赖注入 + HttpClient 运行时加载规则的方式实现。

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
    app.component.ts     L/C 表单组件（多层嵌套 + 全部特性）
  assets/rules/
    lcSettlement.json         = poc-incremental/lc-rules.json
    commonFx.json             = poc-incremental/commonFx.json（被 import 的模块库）
    lcSettlement.sample.json  = poc-incremental/lc-data.json（业务初值）
```
