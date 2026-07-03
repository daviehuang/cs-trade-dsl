# 中性页面编辑器 + 多框架运行时渲染（PoC）

> 问题：能否做一个**中性页面编辑器**（含完整 DSL 规则设置），由其内容在 **HTML / Angular / Vue / React**
> 多框架运行？**结论：能，且四端已全部落地。** 同一份 RuleSet + PageDef + 引擎，四个哑渲染 kit
> 渲染出**逐像素一致**的界面与**逐值相等**的计算（净额 net = 82203.22 四端相同），并落地了一个可视化编辑器。

## 一句话架构

**引擎是计算与校验的唯一真相源；UI 只通过 `EngineCtx` 契约与它对话。**
把"界面从哪来"与"算什么"彻底分开：

```
                       ┌──────────────────────────── 框架无关（共享）────────────────────────────┐
RuleSet(JSON,规则)  +  PageDef(JSON,布局)  ──►  @udsl/ui-kit-core  ──►  UI-IR(UINode[])
（引擎 src/incremental.js 纯 JS）                hydrate / lint / makeCtx / buildRootIR
                       └───────────────────────────────────────────────────────────────────────┘
                                                         │  每个框架一个"哑渲染器" switch(node.kind)
        ┌──────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┐
   angular(formly 绑定层)   ui-kit-react(Eg* 组件)   ui-kit-vue(渲染函数)     ui-kit-html(纯 DOM)
        └───────────── 均 import ui-kit-core；共享同名 eg-* CSS，四端视觉一致 ─────────────┘
```

## 目录

| 路径 | 角色 | 状态 |
|---|---|---|
| `src/incremental.js` `src/kernel.js` | 引擎（纯 ESM JS，零框架依赖；UMD 见 build-dist.mjs） | 现有 |
| `ui-kit-core/` | **框架无关 SDK**：`EngineCtx` 契约 + `page-def` + `engine-meta` + `lint` + `make-ctx` + `hydrate`(PageDef→UI-IR) + `build-root-ir`(自动布局回退) | **新增** |
| `ui-kit-react/` | **React 渲染 kit**：`useEngineSession`(useSyncExternalStore over onTick) + `Eg*` 组件 + `UiRenderer` + 同名 CSS | **新增** |
| `ui-kit-vue/` | **Vue 渲染 kit**：`useEngineSession`(ref 响应式桥) + `UiRenderer`(渲染函数)；`UiRenderer` 内部订阅 onTick 自刷新 | **新增** |
| `ui-kit-html/` | **原生 HTML 渲染 kit**：`mountEngineSession` + `renderUINode`(纯 DOM，无框架依赖，全量重渲染 + 焦点恢复) | **新增** |
| `react-lc-sample/` `vue-lc-sample/` `html-lc-sample/` | React / Vue / 原生 HTML 样本：运行时解释**同一份** lcSettlement PageDef + RuleSet | **新增** |
| `editor-react/` | **中性页面编辑器**：产出 PageDef + RuleSet，实时预览复用 ui-kit-react，发布期 lint（PageDef + RuleSet 两维） | **新增** |
| `angular-lc-sample/` | Angular 样本：**已去重**，经 tsconfig paths 直接指向单源引擎 + `ui-kit-core`（formly/ 仅保留 formly 专用绑定层） | 现有·已去重 |
| `verify-multiframework.mjs` `verify-optional-slot.mjs` | 框架无关真值 + 编辑器产物有效性 + 可选 slot 守卫验证 | **新增** |

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

## 已完成的收尾（相对早期 PoC）

- **Vue / 纯 HTML 适配器**：均已落地（`ui-kit-vue` / `ui-kit-html` + 对应样本），四端 net=82203.22 逐值一致、视觉一致。
- **Angular 去重**：已完成——删掉内嵌的引擎/SDK 副本，经 tsconfig paths 直接指向单源 `src/incremental.js` + `ui-kit-core`，`ng build`(AOT) + 截图回归通过。
- **RuleSet linter**：`lintRuleSet` 校验 import/uses/slots 引用完整性、formula.target 可写回、resolver.source/keySchema、可选 slot 一致性，编辑器场景与库两种编辑对象都实时显示。

## 边界 / 后续（不在本 PoC）

- **npm 正式发布**（ESM+UMD+d.ts）、编辑器 Phase 2（uses/module 全量编写 + resolver 模拟器 + 版本/发布）、接 BFF 权威复算。
