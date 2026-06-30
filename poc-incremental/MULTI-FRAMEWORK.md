# 中性页面编辑器 + 多框架运行时渲染（PoC）

> 问题：能否做一个**中性页面编辑器**（含完整 DSL 规则设置），由其内容在 **HTML / Angular / Vue / React**
> 多框架运行？**结论：能。** 本 PoC 已用 **React** 证明可行，并落地了一个最小编辑器。

## 一句话架构

**引擎是计算与校验的唯一真相源；UI 只通过 `EngineCtx` 契约与它对话。**
把"界面从哪来"与"算什么"彻底分开：

```
                       ┌──────────────────────────── 框架无关（共享）────────────────────────────┐
RuleSet(JSON,规则)  +  PageDef(JSON,布局)  ──►  @udsl/ui-kit-core  ──►  UI-IR(UINode[])
（引擎 src/incremental.js 纯 JS）                hydrate / lint / makeCtx / buildRootIR
                       └───────────────────────────────────────────────────────────────────────┘
                                                         │  每个框架一个"哑渲染器"
                          ┌──────────────────────────────┼──────────────────────────────┐
                   @udsl/ui-kit-angular            @udsl/ui-kit-react            (Vue / HTML 照抄)
                   (eg-* 组件, 现有)                (Eg* 组件, 本 PoC 新增)
```

## 目录

| 路径 | 角色 | 状态 |
|---|---|---|
| `src/incremental.js` `src/kernel.js` | 引擎（纯 ESM JS，零框架依赖；UMD 见 build-dist.mjs） | 现有 |
| `ui-kit-core/` | **框架无关 SDK**：`EngineCtx` 契约 + `page-def` + `engine-meta` + `lint` + `make-ctx` + `hydrate`(PageDef→UI-IR) + `build-root-ir`(自动布局回退) | **新增** |
| `ui-kit-react/` | **React 渲染 kit**：`useEngineSession`(useSyncExternalStore over onTick) + `Eg*` 组件 + `UiRenderer` + 同名 CSS | **新增** |
| `react-lc-sample/` | React 样本：运行时解释**与 Angular 同一份** lcSettlement PageDef + RuleSet | **新增** |
| `editor-react/` | **中性页面编辑器**：产出 PageDef + RuleSet，实时预览复用 ui-kit-react，发布期 lint | **新增** |
| `angular-lc-sample/` | 现有 Angular 样本（自带一份等价的 formly/ 绑定层） | 现有 |
| `verify-multiframework.mjs` | 框架无关真值 + 编辑器产物有效性验证 | **新增** |

## 关键设计点

- **UI-IR**：`hydrate(PageDef)` 与 `buildRootIR(自动布局)` 都产出中性 `UINode[]`；路径重定基、集合按 live
  state 展开、控件种类判定、栅格/span-all 等逻辑**只在 core 写一次**，各框架适配器是 `switch(node.kind)` 的哑渲染。
- **异步刷新桥**：React 用 `useSyncExternalStore` 订阅引擎更新（onTick/notify）。异步 resolver 完成 → 引擎
  `onUpdate` → 重渲染 → 组件重读 `ctx.valueOf` 显示 resolved/pending/error。这是 Angular 端 `markForCheck`
  修复的 React 等价物。**组件不在框架里存值**（受控输入 `value=valueOf` / `onChange=onInput`）。
- **编辑器 = 选择/排布/绑定 + 完整规则编写**：布局侧按 `engine-meta` 调色板、控件种类由字段 spec 强制（与
  `lint` 一致）；规则侧加模型字段 / formula / validation，表达式用引擎自带 parser 即时校验；实时预览持有用
  **当前 RuleSet** 建的真 session，改一条规则立刻反映。
- **治理边界**：UI 不编码业务逻辑；编辑器只能把 cell 绑到 RuleSet 的 computed/external 字段，没有"在页面里算"
  的入口。新派生值/校验必须回到 RuleSet（走版本治理）。

## 怎么跑

```bash
# React 样本（与 Angular 同一份页面 + 规则）
cd poc-incremental/react-lc-sample && npm install && npm run dev      # http://localhost:5173

# 中性页面编辑器
cd poc-incremental/editor-react && npm install && npm run dev          # http://localhost:5173

# 框架无关验证（引擎真值 + 编辑器产物 engine-valid）
cd poc-incremental && node verify-multiframework.mjs
```

## 验证结论（已实测）

- `ui-kit-core` 独立 `tsc` 通过；`react-lc-sample` / `editor-react` `tsc --noEmit && vite build` 通过。
- **跨框架一致**：React 样本渲染出的 `净额 net = 82203.22`、`收费合计 132492.2`、`付费合计 63538.2`、
  `charges[0].items[0].base = 71234`，与 `verify-multiframework.mjs` 的引擎真值**逐一相等**，也与 Angular
  PageDef 模式的截图**逐项一致**（同一份 PageDef + RuleSet、同一引擎、异步汇率、当事方校验含 bankScreening）。
- **编辑器产物 engine-valid**：编辑器加的 `formula vatCalc` 被引擎算出 `vatTotal = 7949.53`；加的
  `validation vatLimit` 被引擎执行并正确触发。

## 边界 / 后续（不在本 PoC）

- **Vue / 纯 HTML 适配器**：照抄 `ui-kit-react` 模式（UINode → 各自控件）即可，引擎/core/PageDef 全复用。
- **Angular 去重**：当前 `angular-lc-sample/src/app/formly/` 仍保留一份等价绑定层（与 `ui-kit-core` 有重复）。
  把 Angular 重指向 `ui-kit-core`（`hydrator`→`ir-to-formly`）是后续清理项，需用现有 `ng build`+截图基线做回归护栏。
- **npm 正式发布**（ESM+UMD+d.ts）、编辑器 uses/module 全量编写、PageDef 拖拽、接 BFF 权威复算。
