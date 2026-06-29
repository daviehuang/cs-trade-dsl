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

## 五、为什么 UI 信息不放进 RuleSet/schema

> 常见疑问：既然要绑定，干脆把布局/控件/标签也写进 `ruleset.schema` 不就少一个文件了？
> 结论：**会侵蚀“一套规则多端运行”的根基**，代价是治理耦合 + 多端负担 + 复用受限。除非是“语义元数据”。

### 负面影响（默认不要放）

1. **违背“UI/微服务无关”的核心价值。** RuleSet 给**三端共享**（前端渲染、BFF 重算、**中台校验**），
   后两者根本不渲染 UI——加载 RuleSet 只为算和校验。UI 信息对它们是**死重量**：白白下发/解析/缓存/传输，
   还可能因含前端专有概念（`type:'eg-cell'`、CSS class）让非前端端被迫写“忽略逻辑”。
2. **把两个不同节奏的东西绑死了治理周期。** RuleSet 是受治理的业务资产（版本/审计/合规/灰度）；
   UI 改动频率高一个量级（文案/布局/颜色/适配）。塞进去后**改个 label 都要发一个新规则版本**——
   要么 UI 迭代被规则治理拖慢，要么规则版本被 UI 噪声淹没（版本爆炸、diff 噪声、审计困难）。
3. **UI 是“一对多”，塞进去等于打死复用。** 同一份规则要被多个界面复用（本项目就有 手写版 /
   formly自动 / formly自定义PageDef，未来还有 React/Vue/移动端/不同业务线的不同页）。
   **一份规则 → N 个界面**；RuleSet 里只能放一套布局，桌面/移动、业务线 A/B 放谁的？直接和复用矛盾。
4. **安全/信任边界被搅浑。** 中台重算只认数据和规则。若 UI 的“隐藏/只读”被误当逻辑，会产生
   **“隐藏即豁免”“前端看不见但引擎算了”** 之类歧义。**UI 可见性 ≠ 业务规则适用性**，必须分开。
5. **跨端可移植性下降。** 含 formly 专有 `type` 的 RuleSet 绑死了 ngx-formly；换框架就得改本应
   “框架无关”的规则资产。

### 但有一类“像 UI”的信息其实属于 schema

**语义元数据**描述字段的“内在性质”，顺便能驱动 UI，但本质是**数据契约**，中台校验也要用：
数据类型、**枚举值域**（`ccy ∈ […]`）、精度/小数位、必填、长度/范围约束，以及（克制地）一个
**中性、框架无关的默认显示名 / i18n key**。

判据一句话：

> **中台/BFF 也需要它来正确执行 → 属于 schema；只有像素/布局/框架才需要它 → 属于 UI 层（PageDef）。**

按此判据：“币种用下拉”不进 schema（那是呈现）；但“币种是枚举且值域是这几个”进 schema（那是数据域），
UI 层据此**自己决定**渲染成下拉/单选/搜索框。

### 推荐边界（就是本仓库现在的做法）

| 层 | 放什么 | 谁用 | 治理 |
|---|---|---|---|
| **RuleSet / schema** | 数据结构 + 类型/值域/约束 + 算/校验规则 + 语义元数据 | 三端共享、**框架/UI 无关** | 规则版本、审计、灰度 |
| **PageDef / UI 定义** | 布局、控件、分组、CSS、框架专有 type、呈现级可见性 | 仅前端；**一份规则可对多份** | 独立版本，UI 自己的节奏 |

两层用 **path 契约**连接，**linter** 保证 PageDef 不背离 model（即本目录的 `page-def.ts` +
`hydrator.ts` + `lint.ts`）。

### 折中：真要在 schema 放一点呈现建议

若想“零额外文件”，在 schema 放极少量呈现建议（默认 label、字段顺序），务必：

1. **隔离命名空间**（如 `x-ui` / `presentation`），让中台/BFF 能**整体忽略**；
2. 定位为**默认/回退**，PageDef 可覆盖；
3. **保持框架无关**——可放 label/顺序，**别放** formly type / CSS / 像素。

能轻量化，但仍带上面第 2、3 点的治理耦合，只是程度轻。**多端 + 多 UI 复用时，分离仍是更稳的选择。**

> 一句话：**schema 回答“数据是什么、规则怎么算”（三端共享、框架无关）；UI 回答“怎么呈现”
> （前端专有、一对多）。把后者混进前者，省一个文件，赔的是复用、治理独立性和跨端纯净度——通常不划算。**
> 例外是“语义元数据”，它名义像 UI、实质是数据契约，本就该在 schema。

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
