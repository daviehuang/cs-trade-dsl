# 自定义组件开发手册

> 面向**已经会 HTML / Vue / React / Angular，但第一次接触这套 DSL 引擎**的开发者。
> 读完你能：把一个业务模型节点（如"客户方 CustomerParty"）包成一个**自带展示风格和交互**的组件，
> 挂进页面框架，而**不破坏引擎"唯一真相源"的地基**。
>
> 机制层面的设计说明见 `COMPUTE-MODEL.md` §「自定义 UI 组件」；本手册是**动手指南**。

---

## 0. 你需要先知道的 4 件事（30 秒心智模型）

这套框架和你熟悉的"组件里 `useState` 存数据、`v-model` 双向绑定"**不一样**。核心就 4 点：

1. **引擎是唯一真相源。** 所有业务值（输入值、计算值、校验）都活在一个"增量反应式引擎"里，
   不在任何框架组件的 state 里。你的组件**不存业务数据**，只通过一个叫 `ctx` 的句柄读写引擎。

2. **界面是"哑渲染"出来的。** 页面定义（`PageDef`，纯 JSON）经 `hydrate` 变成一棵**中性 UI 树**（`UINode[]`，
   与框架无关）。每个端（React/Vue/HTML/Angular）只写一个 `switch(node.kind)` 的哑渲染器，把 `UINode` 画成自己的控件。
   **同一棵 UI 树，四端画法不同，值都来自同一个 `ctx`。**

3. **你要做的"自定义组件" = 接管 UI 树里的一个 `panel` 节点。** 页面里给某个 `panel` 标一个 `widget:"你的组件名"`，
   渲染时框架就把**这一整棵子树**（连同它的 `ctx`、配置、已经排好的子控件）交给你，你自己决定怎么画、怎么交互。

4. **值永远经 `ctx` 走引擎。** 读值 `ctx.valueOf(path)`，写值 `ctx.onInput(path, v)`。
   你的组件里只允许存**纯 UI 态**（弹窗开没开、当前 tab、草稿快照），**绝不存业务值**。

> 一句话：**你写的是"表现层皮肤 + 交互"，数据地基不归你管。** 这样同一份规则在四端、在中台重算时行为才一致。

---

## 1. 扩展点全景：一个值是怎么从 JSON 走到你的组件的

```
PageDef(JSON)                     hydrate()                   各端哑渲染器
┌───────────────────────┐        ┌──────────────┐            ┌────────────────────────────┐
│ { kind:"panel",        │       │ 解析 at→基路径 │           │ EgPanel/egPanel 渲染 panel： │
│   at:"buyer",          │──────▶│ 透传 widget    │──────────▶│  if (node.widget) {          │
│   widget:"party-card", │       │ 展开 children  │  PanelUI  │    W = getNodeWidget(name)   │
│   widgetProps:{...},   │       │ 带上 nodePath  │           │    if (W) return W({node,ctx})│ ← 命中 → 你的组件
│   children:[ ...全字段 ]│      └──────────────┘            │  }                           │
│ } │                    │                                    │  否则 → 默认 panel（降级）    │
└───────────────────────┘                                    └────────────────────────────┘
```

- **`at`**：把这个 panel 的子树"重定基"到某个槽位/节点。`at:"buyer"` → 子树里的字段路径变成 `root.buyer.*`。
- **`widget`**：组件名。宿主启动时 `registerNodeWidget("party-card", 组件)` 注册过 → 命中；
  没注册、或这个端还不支持 → **自动降级为普通 panel**（不报错，字段照常能编辑）。
- **`widgetProps`**：给你的组件的 JSON 配置（如 `{ summary:["name","address"], title:"买家" }`）。
- **`children`**：编辑器已经排好的**完整子表单**（所有字段的 `UINode`）。你想复用这套布局，用官方渲染器渲染它即可。

---

## 2. 四端支持现状（重要）

| 端 | 注册表 | panel 委托 | 弹窗事务(`ctx.forkEdit`) | 内置样板 | 状态 |
|----|:---:|:---:|:---:|:---:|----|
| **React** (`ui-kit-react`) | ✅ | ✅ | ✅ | `PartyCard` | **开箱即用** |
| **HTML** (`ui-kit-html`) | ✅ | ✅ | ✅ | `PartyCard` | **开箱即用** |
| **Vue** (`ui-kit-vue`) | ❌ | ❌ | ❌ | — | 目前 widget 面板**降级为默认 panel**；移植配方见 §9 |
| **Angular** (`angular-lc-sample`) | ❌ | ❌ | ❌ | — | 同上；移植配方见 §9 |

> **建议**：先在 **React 或 HTML** 上开发你的组件（这两端已内置全套机制），跑通业务与交互后，
> 需要哪个端再照 §9 把注册表 + 委托 + forkFactory 三段接口复制过去。样板都是现成的。

---

## 3. 你的组件收到什么：`PanelUI` 契约

你的组件签名统一是 `({ node, ctx }) => 该端的视图节点`。`node` 是一个 **`PanelUI`**，你只关心这几个字段：

```ts
interface PanelUI {
  kind: 'panel';
  label: string;                       // panel 标题（widgetProps.title 没配时可用它兜底）
  widget?: string;                     // 就是你的组件名
  widgetProps?: Record<string, any>;   // ★ 你的 JSON 配置（summary 字段清单、标题、颜色……自定义）
  nodePath?: string;                   // ★ 子树基路径，如 "root.buyer"。拼 summary 字段路径用
  children: UINode[];                  // ★ 编辑器排好的完整子树（所有字段），交官方渲染器渲染
  // …… variant/tone/gridClass 等默认 panel 才用的字段，自定义组件通常忽略
}
```

三个带 ★ 的就是你的原料：
- **`nodePath`** 拼字段路径：买家名称 = `` `${node.nodePath}.name` `` = `root.buyer.name`。
- **`widgetProps`** 拿配置：`const summary = node.widgetProps?.summary ?? []`。
- **`children`** 是"编辑器排好的表单"，你想在弹窗里复用它，直接丢给官方渲染器（见 §6）。

---

## 4. 你能调用什么：`EngineCtx` 契约（速查）

`ctx` 是你和引擎之间**唯一**的通道。全部方法：

```ts
interface EngineCtx {
  // —— 读 ——
  valueOf(path): string;                 // 字段/单元格当前值（原始字符串）
  cellText(path): string;                // 单元格显示文本（含 "⏳ 计算中" / "✗ 错误" 等态）
  cellState(path): 'input'|'computed'|'pending'|'error'|'overridden'|undefined;
  overridableFor(path): boolean;         // 该计算值此刻是否允许人工覆盖（随命中分支实时变化）
  validationsFor(path): ValidationView[];// 该节点上引擎算出的校验结果
  ccys: string[];                        // 币种清单（币种下拉用）

  // —— 写（都只走引擎，触发增量重算）——
  onInput(path, v): void;                // 写普通输入字段
  onOverride(path, v): void;             // 覆盖一个可覆盖的计算值
  clearOverride(path): void;             // 撤销覆盖，恢复计算
  addChild(parent, coll, obj): string;   // 给集合加一条记录，返回新记录路径
  removeChild(path): void;               // 删一条记录

  // —— 求值 / 订阅 ——
  evalExpr(base, expr): any;             // 在 base 节点作用域求一个 DSL 表达式（只读）
  onTick(cb): () => void;                // 订阅"引擎更新了"（异步取数完成/重算后），返回取消订阅函数

  // —— 弹窗隔离事务（可选，见 §7）——
  forkEdit?(): ForkHandle | null;        // 开一份"副本会话"，弹窗里改它、主页面纹丝不动；宿主没接则返回 null
}
```

**记住两条**：
- 读值一律 `valueOf` / `cellText`；写值一律 `onInput` / `onOverride`。**不要**自己缓存值再回填。
- 异步 resolver（如查汇率、调后台）完成时**没有 DOM 事件**，靠 `onTick` 通知你重渲染。
  好消息：官方渲染器（`UiRenderer` 等）已经替你订阅了 `onTick`，你渲染 `children` 时不用自己管。

---

## 5. 六条铁律（违反了就会出诡异 bug）

1. **值只经 `ctx`。** 组件里不 `useState` 存业务值，不 `v-model` 到本地变量。
2. **组件只存 UI 态。** 弹窗开关、当前 tab、草稿快照——可以用 `useState`/`ref`/成员变量。
3. **渲染 `children` 用官方渲染器**（React `<UiRenderer>` / HTML `renderUINode` / Vue `renderNode`），
   别自己手写字段 `<input>`——否则失去引擎绑定、失去币种/日期/覆盖等控件语义，四端也不一致。
4. **配置从 `widgetProps` 读，路径用 `nodePath` 拼。** 别在组件里硬编码字段名/路径。
5. **优雅降级。** 你的组件只是"皮肤"；没注册的端会渲染默认 panel，字段照样能用。别让页面依赖某个端才有的组件才能填单。
6. **弹窗编辑用 `forkEdit` 事务**（§7）。否则"弹窗里改了、点取消"这类操作会把改动/级联副作用漏进主页面。

---

## 6. 手把手（React）：从只读徽章 → 编辑弹窗 → 隔离事务

以"把 `root.buyer`（CustomerParty）做成折叠摘要 + 编辑弹窗"为例，分三步长出来。
**完整成品见 `ui-kit-react/src/widgets/party-card.tsx`（内置样板，可直接抄）。**

### 第 1 步：只读摘要（吃透 node/ctx/widgetProps）

```tsx
import type { EngineCtx, PanelUI } from '@udsl/ui-kit-core';
import { registerNodeWidget } from '../node-widgets';

function PartyCard({ node, ctx }: { node: PanelUI; ctx: EngineCtx }) {
  const base = node.nodePath ?? 'root';                       // "root.buyer"
  const summary: string[] = node.widgetProps?.summary ?? [];  // ["name","address"]
  const title = node.widgetProps?.title ?? node.label ?? '';

  return (
    <div className="eg-panel panel v-party eg-party-card">
      <div className="ph"><span className="ttl">{title}</span></div>
      <div className="eg-party-summary">
        {summary.map((f) => (
          <div key={f} className="sum-item">
            <span className="k">{f}</span>
            <span className="v">{ctx.valueOf(`${base}.${f}`) || '—'}</span>   {/* 读值走 ctx */}
          </div>
        ))}
      </div>
    </div>
  );
}

registerNodeWidget('party-card', PartyCard);   // ★ 注册：PageDef 里 widget:"party-card" 即启用
export { PartyCard };
```

此刻页面上买家 panel 就变成"名称 / 地址"两行只读摘要了。**注意：一行业务 state 都没存。**

### 第 2 步：加"编辑"按钮 + 弹窗（复用编辑器排好的 children）

弹窗内容**别自己手写表单**——`node.children` 就是编辑器排好的完整字段子树，用官方 `UiRenderer` 渲染它：

```tsx
import { useState } from 'react';
import { EgModal, UiRenderer } from '../components';   // kit 自带的模态外壳
// …
const [editing, setEditing] = useState(false);
// …
<button className="edit" onClick={() => setEditing(true)}>✎ 编辑</button>
{editing && (
  <EgModal title={`${title} · 编辑`} onCancel={() => setEditing(false)} onSave={() => setEditing(false)}>
    <UiRenderer ir={node.children} ctx={ctx} />    {/* 编辑器布局复用，改动直达引擎 */}
  </EgModal>
)}
```

能编辑了。但有个问题：**弹窗里改字段是直接改主引擎的**——点"取消"并不能撤销，改动已经进引擎、甚至已经级联
（比如改单价触发了总额重算、又触发了"总额变→清空付款明细"的联动）。这就要第 3 步。

### 第 3 步：把弹窗改成隔离事务（`forkEdit`）

`ctx.forkEdit()` 开一份**引擎副本**：弹窗里所有编辑跑在副本上，**主页面完全不动**；
点"完成"才把副本里的值**提交回主会话**，点"取消"直接**丢弃副本**（主页面零变化）。

```tsx
import { useRef, useState } from 'react';
import type { ForkHandle } from '@udsl/ui-kit-core';
import { EgModal, UiRenderer, leafControls } from '../components';

const [editing, setEditing] = useState(false);
const forkRef = useRef<ForkHandle | null>(null);
const [, forceRerender] = useState(0);
const editCtx = forkRef.current ? forkRef.current.ctx : ctx;  // 弹窗走副本 ctx，摘要走真 ctx

const open = () => {
  const f = ctx.forkEdit ? ctx.forkEdit() : null;             // 开副本（宿主没接口 → null，回退直接编辑）
  forkRef.current = f;
  if (f) f.ctx.onTick(() => forceRerender((x) => x + 1));     // 副本更新 → 弹窗重渲染
  setEditing(true);
};
const cancel = () => { forkRef.current = null; setEditing(false); };   // 丢弃副本 = 主页面零变化
const done = () => {
  const f = forkRef.current;
  if (f) f.commit(                                             // 把副本里这些字段的值提交回主会话
    node.children.flatMap(leafControls).filter((l) => l.kind === 'field').map((l) => l.path),
  );
  forkRef.current = null; setEditing(false);
};
// 弹窗体：<UiRenderer ir={node.children} ctx={editCtx} />
```

现在："弹窗改任意字段 → 主页面不变；取消 → 零变化；完成 → 一次性同步 + 该级联的级联。" 这才是正确的事务语义。

> 完整可运行版本（含摘要、按钮、样式、注释）就是 `ui-kit-react/src/widgets/party-card.tsx`，照抄改名即可。

---

## 7. 弹窗隔离事务（fork）详解

**为什么需要**：引擎是单向数据流，改一个值会**级联**重算下游、甚至触发联动重置（删记录等结构副作用）。
"弹窗草稿 + 取消回滚"如果只回滚被编辑字段自己的值，**级联出去的副作用回不来**（被删的明细行、被清空的联动字段）。
唯一干净的办法：编辑期整个跑在**隔离副本**上，主会话一个字节都不动，直到"完成"才合并。

**`ForkHandle` API**（`ctx.forkEdit()` 的返回值）：

```ts
interface ForkHandle {
  ctx: EngineCtx;                                   // 副本会话的 ctx——弹窗渲染/编辑都用它
  getState(): SessionState;                         // 副本状态（新增行水化用）
  commit(paths: string[]): void;                    // 【编辑现有节点】把这些字段值提交回主会话
  addChild(parent, coll, obj): string;              // 【新增集合行】只在副本加行，返回副本路径
  commitAdd(parent, coll, forkPath): void;          // 【完成新增】把副本那行真正加进主会话（此时才级联）
}
```

- **编辑一个已存在的节点**（如 party 槽位、集合某一行）：`open` 时 `forkEdit()`；`done` 时 `commit(字段路径清单)`；`cancel` 丢弃。
- **新增一条集合记录**：`open` 时 `forkEdit()` + `f.addChild(...)`（行只落副本）；`done` 时 `f.commitAdd(...)`（主会话此刻才加行 + 级联）；`cancel` 丢弃（主会话从没加过行）。
  集合弹窗的完整实现见 `ui-kit-react/src/components.tsx` 的 `EgCollection`（`layout:"modal"`）。

**降级**：`ctx.forkEdit` 是可选的。宿主没接 forkFactory（如 Vue/Angular 暂未接）时它是 `undefined` 或返回 `null`——
你的组件应像上面 `const f = ctx.forkEdit ? ctx.forkEdit() : null` 那样兜底，回退成"直接编辑主会话"，功能可用只是没有事务隔离。

---

## 8. 各端"重渲染模型"差异（决定弹窗怎么放）

四端画同一棵 UI 树，但**"引擎更新后怎么刷新界面"机制不同**，这直接影响你写组件的方式：

| 端 | 刷新机制 | 对你的影响 |
|----|----------|-----------|
| **React** | `useSyncExternalStore` 订阅引擎，值变→重渲染 | 用 `useState`/`useRef` 存 UI 态，正常写 |
| **Vue** | `UiRenderer` 组件 `onTick` → `tick.value++` 重渲染 | 组件内用 `ref` 存 UI 态 |
| **HTML** | **全量重建**：每次更新 `container.replaceChildren(...)` | ⚠ 见下 |
| **Angular** | `markForCheck` 触发变更检测 | 常规 Angular 变更检测 |

**HTML 的坑与解法**：HTML 端每次引擎更新会把整个视图区**整体重建**，你的组件元素会被销毁重建，
组件里没法靠"实例变量"留住"弹窗开着"的状态。解法（内置 `ui-kit-html/src/widgets/party-card.ts` 已示范）：
**把弹窗做成挂到 `document.body` 的浮层**，而不是放在视图区里——
主页面重建碰不到它；而 fork 隔离又保证编辑期主会话不变→主页面根本不重建，浮层稳定存在；
弹窗体则由**副本的 `onTick`** 独立重渲染（配合失焦提交做个焦点保护即可）。

> **要在一个 SPA 页面里同时开多个 form？** 每个 `mountEngineSession` 是**独立会话、互不干扰**，可放心多开——
> 但有几处"全局/共享"要心里有数（尤其别复用整包 loader），见 **§13**。

---

## 9. 把机制移植到 Vue / Angular（配方）

Vue/Angular 目前 widget 面板降级为默认 panel。要让它们也支持自定义组件，照 React/HTML 的三段接口复制即可：

1. **注册表**（抄 `ui-kit-react/src/node-widgets.ts`）：一个 `Map<string, 组件>` + `registerNodeWidget/getNodeWidget`。
   组件签名的返回类型换成该端的视图节点（Vue = `VNode`，Angular = 组件/模板）。
2. **panel 委托**（改该端的 `egPanel`）：
   `if (node.widget) { const W = getNodeWidget(node.widget); if (W) return W({ node, ctx }); }` 命中就交给组件，否则走默认 panel。
   - Vue：在 `ui-kit-vue/src/components.ts` 的 `egPanel`（约 79 行）加这一句。
   - Angular：在其 panel 渲染处加等价分支。
3. **接上 `forkEdit`**（改该端建 ctx 的地方）：给 `makeCtx(session, getState, rebuild, forkFactory)` 传第 4 个参数
   `forkFactory = (onUpdate) => createSession(ruleSet, treeToData(state.tree), { resolve, imports, onUpdate })`。
   - Vue：在其会话装配处（对应 HTML 的 `ui-kit-html/src/mount.ts`）。
   - 不接也行——`ctx.forkEdit` 会是 `null`，组件按 §7 的兜底回退成直接编辑。
4. **写组件 + 注册**：照 §6 的三步，用该端语法实现，`registerNodeWidget('party-card', 组件)`。

> React 版（`ui-kit-react`）与 HTML 版（`ui-kit-html`）是两份**已验证的对照样板**，移植时对着抄最省事。

---

## 10. 挂进页面：PageDef 怎么配

自定义组件**在 PageDef 里只出现"名字 + JSON 配置"**，规则/数据一律不碰：

```jsonc
{
  "kind": "panel",
  "at": "buyer",                                   // 重定基到 root.buyer 槽位
  "widget": "party-card",                          // 你注册的组件名
  "widgetProps": { "summary": ["name", "address"], "title": "买家" },
  "children": [                                    // 编辑器排的完整 party 表单（弹窗里复用）
    { "kind": "field", "field": "name" },
    { "kind": "field", "field": "address" },
    { "kind": "field", "field": "contact" },
    { "kind": "field", "field": "taxId" }
  ]
}
```

- **手写**：直接写进页面 JSON 存到规则仓库即可。
- **页面编辑器**：React 版编辑器（`editor-react`）的 panel 属性栏已支持下拉选 `widget`（来自 `nodeWidgetNames()`）+ 编辑 `widgetProps`。
- **降级验证**：把同一页面在 Vue/HTML/Angular 打开——没注册该 widget 的端会渲染默认 panel（`name/address/…` 逐字段可编辑），**不报错**。这正是"皮肤可缺省"的体现。

---

## 11. 常见坑 & FAQ

- **Q：我在组件里 `useState` 存了字段值，改了没反应 / 和别处不同步。**
  A：违反铁律 1。业务值不进组件 state。读 `ctx.valueOf`，写 `ctx.onInput`。组件 state 只放 UI 态。

- **Q：弹窗里手写了 `<input>`，币种/日期/覆盖按钮都没了、四端不一致。**
  A：违反铁律 3。用官方渲染器渲 `node.children`，控件语义（币种下拉、日历、可覆盖单元格）才齐、四端才一致。

- **Q：异步取数（查汇率/调后台）完成后组件不刷新。**
  A：那次刷新没有 DOM 事件，靠 `onTick`。渲染 `children` 用官方渲染器会自动订阅；你自己画的部分需 `ctx.onTick(重渲染)`。

- **Q：弹窗点"取消"，主页面却已经变了 / 联动把别的明细清空了收不回。**
  A：没用事务。改用 `ctx.forkEdit()`（§7）：编辑跑副本，取消丢弃、完成才 `commit`。

- **Q：`node.nodePath` 是 `undefined`。**
  A：多半是这个 panel 没设 `at`（没重定基到具体节点）。给它 `at:"buyer"` 之类，`nodePath` 才会是 `root.buyer`；不然兜底成 `'root'`。

- **Q：HTML 端弹窗一更新就闪 / 丢焦点。**
  A：见 §8——弹窗挂 `document.body`，别放视图区；重渲染弹窗体前按 `data-path` 记录/恢复焦点（样板已示范）。

- **Q：我要做的是"单个字段级"的自定义控件（不是包一整个节点），比如特殊的对手方选择框。**
  A：本手册的 widget 是**节点级**（包一棵子树）。字段级控件目前仍是四端 `switch(control)` 硬编码
  （如 `party-lookup`），可后续按同款注册表模式收敛；当前若急需可在对应端的 `egField` 加分支。

---

## 12. 开发清单（Checklist）

- [ ] 选好落地端（建议先 React 或 HTML，已内置机制）
- [ ] 组件签名 `({ node, ctx }) => 视图`，从 `node.widgetProps` 读配置、`node.nodePath` 拼路径
- [ ] 只读部分：`ctx.valueOf` / `ctx.cellText` 取值展示
- [ ] 可编辑部分：`node.children` 交官方渲染器；写值走 `ctx.onInput` / `ctx.onOverride`
- [ ] 弹窗编辑：用 `ctx.forkEdit()` 事务；`done→commit` / `cancel→丢弃`；`forkEdit` 为空时兜底
- [ ] 组件内只有 UI 态，零业务值
- [ ] `registerNodeWidget('名字', 组件)` 注册（内置样板放 `widgets/` 并在 `index.ts` 导出即自注册）
- [ ] PageDef 里 `widget` + `widgetProps` + `children`；`at` 指到目标节点
- [ ] 在未注册该 widget 的端打开页面，确认**降级为默认 panel、不报错**
- [ ] 该端构建通过（`ui-kit-*` + 加载器 tsc/vite）
- [ ] 若 SPA 内多实例：各 form 独立 container + 各自 `mountEngineSession`，**别复用整包 loader**（见 §13）

---

## 13. 在 SPA 里嵌入多个表单实例（多 form 并存）

**结论：用 kit 的 `mountEngineSession` 多开——数据/计算层完全隔离，不冲突。** 每个 form 一个独立
`<div>` container + 独立 `mountEngineSession(...)`，放心并存。三条隔离保证（都在代码里）：

- **引擎会话零共享状态**：`createSession(ruleSet, data, opts)`（`src/incremental.js`）内部 cells / 依赖图 / 订阅
  全是**函数内 local**，模块顶层只有一个不可变 `Symbol`。每次调用是一份全新的隔离引擎。
- **每个 mount 独立**：`mountEngineSession` 渲染进你给的 `container`，`notify` / `onTick` / `session` 都在各自闭包里；
  form A 更新只触发 A 的 `render()`，碰不到 B。
- **焦点恢复是 scoped 的**：`restoreFocus` 用 `container.querySelector([data-path=…])` 限定在自己的 container 内，
  且 `captureFocus` 有 `!container.contains(activeElement)` 兜底——所以**即便两个 form 字段路径重名**
  （都是 `root.buyer.name`），也绝不会跨 form 抢焦点。

```ts
// SPA 里嵌多个 form —— 各自独立 container + 独立会话
const h1 = mountEngineSession({ container: document.querySelector('#formA')!, createSession,
  ruleSet: rsA, imports, data: dataA, resolve, buildIR: irA });
const h2 = mountEngineSession({ container: document.querySelector('#formB')!, createSession,
  ruleSet: rsB, imports, data: dataB, resolve, buildIR: irB });
// 卸载各自 destroy：
h1.destroy(); h2.destroy();
```

### 但有 3 处"全局/共享"要心里有数

| 共享点 | 会冲突吗 | 说明 / 建议 |
|--------|:---:|------|
| **widget 注册表** `registerNodeWidget` | 否（设计如此） | 模块级全局 `Map`，所有 form **只读共享**同一批组件定义。启动时注册一次即可；别为某个 form 单独覆盖同名 widget——那会影响所有 form。 |
| **party-card 弹窗浮层挂 `document.body`** | 逻辑不冲突，**视觉会叠加** | HTML kit 唯一的全局 DOM 副作用。多个 form 各开 party 弹窗时，多个全屏 backdrop 都 append 到 body 会层叠（各自的 fork / onCancel 独立，数据不串，但观感乱）。建议：业务上一次只开一个编辑弹窗，或给浮层加实例级 `z-index` / 挂到各自容器。 |
| **整包 `runtime-loader-html`（demo 应用）** | ⚠ **会冲突** | 它是"整页单例"：`getElementById('app')`、注入固定 id `#feat` / `#view` / `#status`、模块顶层直接启动并维护单个 `handle`。**不是设计来一页开多份的**——多实例会因固定 id 互相覆盖。 |

### 一句话区分对错姿势

- ✅ **对**：SPA 里嵌多 form → 直接用 **kit 的 `mountEngineSession`**，每个给独立 container。隔离干净。
- ❌ **错**：把整个 **`runtime-loader-html`（带固定 `#app` / `#feat` 的整页 demo）** 复制多份塞进 SPA——
  那一层假设自己独占页面。它只是"演示加载器"，不是可复用的 form 组件。

> React 端同理：每个 `useEngineSession(...)` 是独立会话（各自的外部 store），多个表单组件并存互不干扰；
> 同样别去复用整包的 `runtime-loader` / `editor-react` 顶层应用。

---

## 参考

- **机制设计**：`COMPUTE-MODEL.md` §「自定义 UI 组件：包装模型节点（注册表 + widget）」
- **React 样板**：`ui-kit-react/src/widgets/party-card.tsx`（摘要 + 编辑弹窗 + fork 事务）
- **HTML 样板**：`ui-kit-html/src/widgets/party-card.ts`（body 浮层弹窗 + 焦点保护）
- **注册表**：`ui-kit-react/src/node-widgets.ts` · `ui-kit-html/src/node-widgets.ts`
- **panel 委托**：`ui-kit-react/src/components.tsx`（`EgPanel`）· `ui-kit-html/src/render.ts`（`egPanel`）
- **契约类型**：`ui-kit-core/src/ui-ir.ts`（`PanelUI`）· `ui-kit-core/src/engine-shared.ts`（`EngineCtx` / `ForkHandle`）
- **集合弹窗（含新增行事务）**：`ui-kit-react/src/components.tsx`（`EgCollection` `layout:"modal"`）
- **整体架构 / 引擎原理**：`README.md`
