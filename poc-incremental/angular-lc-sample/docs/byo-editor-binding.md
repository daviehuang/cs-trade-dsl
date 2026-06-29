# 用自己的页面编辑器接增量引擎（前端校验 + 计算）

> 适用场景：你有一个**页面编辑器**用来画 ngx-formly 页面，希望复用本项目的**增量引擎**做前端的
> 校验与计算，而不是用「按 `lc-rules.json` 自动生成界面」那一套。
>
> 核心结论：**引擎不用改**。它本来就是 headless 的，跟 formly 之间只有一个很窄的契约——
> “**按 path 绑定、经 session 改**”。你的编辑器只要产出满足这个契约的页面定义即可。
> 本目录已按此思路落地了一版参考实现（见文末「参考实现」）。

---

## 一、界面 ↔ 引擎之间唯一的契约

渲染分两层，现在的代码已经是这两层（只是把它们解耦了）：

| 层 | 代码 | 职责 | 你画界面后 |
|---|---|---|---|
| **生成层** | `engine-formly.ts › buildRootFields` | 从 `model.nodes` 自动产出布局 | **降级为回退**（PageDef 缺省时才用） |
| **绑定层** | `engine-shared.ts › makeCtx` + `eg-field/eg-cell/eg-collection/...` | 把编辑/取值/增删/校验委托回 `session` | **当 SDK 复用，不动** |

绑定层根本不关心字段树是谁生成的——`eg-cell` 只认 `props.path` + `props.ctx`。所以
**你的编辑器只要输出带正确 `type` + `path` 的 formly 配置，引擎照样工作**。

契约只有两条：

1. **每个参与算/校验的控件，必须携带它绑定的引擎 cell 路径（path）**
   例：`root.maxNet`、`root.applicant.taxId`、`root.charges[0].items[2].base`。
2. **所有改动都走 `session` API**（`setInput / setOverride / clearOverride / addChild / removeChild`），
   绝不直接改 formly 的 model。**引擎是计算与校验的唯一真相源**。

---

## 二、编辑器产物要遵循的规则

### 1. 绑定按 path，不按布局
路径是引擎的“地址”。布局/分组/排序/换肤随便画，因为绑定按 path、与顺序无关。
你可以只显示字段子集、把当事方拆到不同 tab——只要 path 对就行。

### 2. 控件类型必须匹配字段“种类”
从 `model`（含 import 的类型库）能读出每个字段的 `computed / external / overridable` 标记，
编辑器要据此约束设计师能放什么控件：

| 字段种类 | 允许控件 | 绑定行为 |
|---|---|---|
| 普通输入（无标记） | 输入框/下拉（`eg-field`） | 改 → `setInput(path)` |
| `computed` / `external` | 只读展示（`eg-cell`） | 显示引擎值 + pending/error 态 |
| `overridable`（如 base） | 可覆盖输入 | 改 → `setOverride`，清 → `clearOverride` |
| 条件可输入（`fallback:input`，如 adjustment） | 自适应：`cell.state==='input'` 时可编辑，否则只读 | `eg-cell` 已内置 |

**禁止**把 computed 字段做成自由输入再 `setInput`——引擎会拒绝（linter 也会拦）。

### 3. 集合（子记录）= 子表单模板 + 结构操作走 session
设计师画**一行明细的模板**（相对字段 `desc/ccy/amount/fxRate/base`），运行时按实际行数实例化；
增删行调 `session.addChild/removeChild`，**不要**自己 push 数组。增删后行索引会变，要重建受影响的 path。

### 4. 不要在 formly 里重写校验/公式
别给字段挂 formly 自己的 validators 去重复规则。校验结果来自 `session.getState().validations`
（按节点 path 过滤）。设计师可以决定**在哪显示**（字段旁内联 / 汇总面板），但数据只能来自引擎。

### 5. 未绑定字段 = 纯装饰
可以放 model 里没有的纯展示元素，但它们不参与算/校验。规则：**绑定字段必须能在 model 里找到对应 path**。

---

## 三、需要做的改造（分层）

绑定层（`eg-*` + `makeCtx`）基本不动。要做的是把“生成”换成「编辑器 + 运行时装配器」，并加发布期校验。

### 改造 1：可序列化的 **PageDef**（编辑器保存的东西）
`ctx` 是运行时闭包，**不能序列化**。所以编辑器存的是**纯 JSON 页面定义**（布局 + 每个控件绑哪个 path +
控件种类 + 样式），`ctx` 在运行时注入。结构示意（完整类型见 `page-def.ts`）：

```jsonc
{
  "ruleSetRef": "lcSettlement@5.1.0",
  "layout": [
    { "kind": "panel", "title": "信用证主记录", "grid": "form", "children": [
      { "kind": "field", "field": "maxNet", "label": "净额上限" },
      { "kind": "field", "field": "baseCcy", "control": "ccy" }
    ]},
    { "kind": "panel", "title": "结算", "children": [
      { "kind": "cell", "field": "net", "emphasis": true }      // computed → 只读
    ]},
    { "kind": "collection", "name": "charges", "itemTemplate": [ // 一行模板
      { "kind": "field", "field": "groupName" },
      { "kind": "cell",  "field": "subtotal" }
    ]}
  ]
}
```

### 改造 2：运行时 **hydrator**：`PageDef + session → FormlyFieldConfig[]`
把现在 `buildRootFields` 里“注入 ctx”的逻辑抽出来，改成从 PageDef 读（见 `hydrator.ts`）：
- 把每个 `kind` 映射到 `eg-*` 类型，注入 `props.ctx` + 解析绝对 path；
- **展开集合**：按 `session.getState()` 实际行数把 `itemTemplate` 的相对 `field` 拼成绝对 path
  （`root.charges[0].subtotal`…），增删后重展开；
- 计算/外部/覆盖等“种类”从模型推导（**不信任编辑器**），保证绑定行为正确。

这样绑定层、`makeCtx`、OnPush 的 `markForCheck` 穿透刷新、生命周期全部原样复用。

### 改造 3：发布期 **linter**（最重要的护栏）
编辑器“保存/发布”时，拿 `model` 校验 PageDef（见 `lint.ts`）：
- 每个绑定 path 在 model 里存在（含继承字段）；
- 控件种类匹配（没有“给 computed 配输入框”）；
- 子集合 / 重定基(`at`) 结构合法；
- 越权拦截（`setOverride` 只能绑 `overridable` 字段）。

把“设计师能画出引擎认不了的页面”这个风险消灭在发布前。运行时若仍遇到 lint 错误，**回退到自动布局**。

### 改造 4：把绑定层抽成 SDK
`engine-shared.ts`（纯函数/常量/路径解析）+ `engine-formly.ts`（`eg-*` + `makeCtx` + 注册清单）
就是这个 SDK，编辑器产物 import 它。`buildRootFields` 退化成“没自定义页时按 model 自动生成”。

---

## 四、治理边界（容易踩的点）

- **页面只能“选择/排布/展示”字段，不能新增算逻辑。** 想要新派生值/校验，回到 RuleSet 加规则
  （走版本治理），不在页面里写——否则又把逻辑散回前端，违背“一套规则多端运行”。
- **一条记录一个 session；多 tab/主从页可共享同一 session**（引擎是共享状态）。
- **path 是契约，改 model 字段名要联动迁移 PageDef**（linter 能发现失效绑定）。

---

## 参考实现（本目录已落地）

| 文件 | 角色 |
|---|---|
| `src/app/formly/engine-shared.ts` | 纯 SDK：常量、控件推导、路径解析、`EngineCtx`、`makeCtx` 依赖 |
| `src/app/formly/engine-formly.ts` | 绑定层：`eg-*` 自定义类型 + `makeCtx` + 注册清单 + 回退生成器 `buildRootFields` |
| `src/app/formly/engine-meta.ts` | 从 RuleSet+imports 推导字段/槽位/子集合（继承感知） |
| `src/app/formly/page-def.ts` | **PageDef 可序列化 schema**（编辑器产物的类型契约） |
| `src/app/formly/hydrator.ts` | **运行时装配器** `hydratePage(pageDef, ctx, state, meta)` |
| `src/app/formly/lint.ts` | **发布期 linter** `lintPageDef(pageDef, ruleSet, imports)` |
| `src/assets/pages/lcSettlement.page.json` | 一份示例 PageDef（故意重排/取子集，证明“编辑器驱动”） |
| `src/app/formly/formly-lc.component.ts` | 顶部「界面来源」可切换：模型自动生成 ↔ 自定义 PageDef；展示 lint 结果，出错回退 |

跑起来（`npm start`）后切到 **ngx-formly 模型驱动版** → 「界面来源」选 **自定义 PageDef**，
即可看到由 PageDef 装配、引擎算校验的页面，以及顶部的 lint 结论。

一句话：**引擎不用改，改的是“界面从哪来”**——把自动生成换成
「可序列化 PageDef + 运行时 hydrator + 发布期 linter」，绑定层 `eg-*`/`makeCtx` 当 SDK 复用。
