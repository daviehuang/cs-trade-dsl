# 继承与覆盖（Java 式）

**场景**：产品部把通用业务能力做成**库**（`commonMixPayment.json` 这类 import 库 = 通用业务组件）；项目侧 `import` 后，**继承**库里的节点、**新增**自己的字段/节点、**覆盖**原组件里某些字段的**计算/校验规则**——而且**只影响自己**，不动通用组件本身。

```
库（产品部）                         场景（项目）
MixPayment                     CustomPayment extends MixPayment
  children: items→ChargeItem  ▸    children: items→CustomChargeItem   ← 覆盖子集合节点类型
ChargeItem                     CustomChargeItem extends ChargeItem
  base / subtotal(computed)         + surcharge                        ← 新增字段
rules:                         rules:
  rSub  : subtotal = base*2         rSubCustom: overrides rSub → base*2 + surcharge
  vBase : base >= 0                 vBaseOff  : overrides vBase, disable: true
```

## 一、继承什么

节点 `extends` 后，沿继承链（基类 → 自身）合并：

| 元素 | 合并方式 | 覆盖办法 |
|---|---|---|
| `fields` | 逐字段合并 | 子类**同名重定义整条 spec**（可改 `type`、可改种类 input↔computed↔overridable↔external） |
| `slots` | 逐槽位合并 | 子类**同名重定义**（换 `node`、改 `optional`） |
| `children` | 按集合名合并，**保持首次出现的位置** | 子类**同名集合指向子类型**（`items→CustomChargeItem`） |
| `rules` | 按 `scope` 沿链收集（基类 scope 的规则自动作用到子类实例） | 见下节 |

## 二、覆盖规则

规则有两条覆盖路径：

**① 隐式覆盖（同 target 重声明）** — 子类写一条同 `target` 的 formula/pipeline/resolver，后建的 cell 覆盖先建的，天然生效。适合"只是换个算法"。

**② 显式 `overrides`（推荐）** — 声明意图，可被 lint 校验，且**是 validation 唯一可覆盖的方式**（校验按 `__val_<ruleId>` 累加，不同 id 不会互相覆盖）：

```jsonc
// 替换：子类规则生效，基类 rSub 在子类实例上被移除
{ "id": "rSubCustom", "type": "formula", "scope": "CustomChargeItem",
  "overrides": "rSub", "target": "subtotal", "expr": "base * 2 + surcharge" }

// 停用：子类实例上不再执行基类校验（无 target / expr）
{ "id": "vBaseOff", "scope": "CustomChargeItem", "overrides": "vBase", "disable": true }
```

约束：`overrides` 指向的规则，其 `scope` 必须是本规则 `scope` 的**严格祖先类型**。违反时引擎静默忽略，lint 报 error 兜底。

## 三、per-subtype 隔离（关键性质）

覆盖**只发生在以子类型实例化的节点上**。引擎按节点的真实 type 收集规则（`rulesForType`），`MixPayment` 实例的继承链里没有 `CustomPayment`，因此项目侧的 `overrides`/`disable` **从不进入基类实例**：同一棵树里，`common` 槽的 `MixPayment` 照旧跑基类公式与校验，`proj` 槽的 `CustomPayment` 跑覆盖后的。回归脚本 `verify-inherit-override.mjs` 断言 ④ 专门守这条。

## 四、`enabled: false` vs `disable: true`

| | 含义 | 影响范围 |
|---|---|---|
| `enabled: false` | 整条规则停用（编辑器规则表的复选框） | **全局**，所有实例 |
| `overrides + disable: true` | 停用**继承来的**某条规则 | **仅该子类型的实例** |

## 五、编辑器里怎么做

- **模型页**：节点详情显示**继承链面包屑**；字段区列出「继承字段（只读）」，本地同名字段打「覆盖」角标；子集合区同理，同名指向别的类型时标「覆盖 ‹基类节点类型›」。
- **规则页**：「继承规则」表列出 import 库里的规则（只读），每行有 **覆盖 / 停用** 按钮，一键生成带 `overrides` 的草稿并自动落到子类型 scope。本地规则表新增「来源」列：`本地` / `覆盖 ‹baseId›` / `停用 ‹baseId›`。规则表单里有「覆盖继承规则（可选）」下拉（只列严格祖先 scope 的规则）+「仅停用」勾选。

## 六、一致性约束（改代码时注意）

继承语义在三处各实现一份，**必须逐字等价**，否则中台重算/lint/实例化会对不上：

| 位置 | 函数 |
|---|---|
| `src/incremental.js` | `childCollections` / `effectiveFields` / `effectiveSlots` / `rulesForType` |
| `bff/validate.js` | `childColls` / `effFields` / `effSlots`（结构遍历用；重算本体走同一个 `createSession`，规则覆盖逻辑自动继承） |
| `ui-kit-core/src/engine-meta.ts` | `childrenOf` / `effectiveFields` / `effectiveSlots`（lint 与编辑器用） |

## 七、验证

```bash
node verify-inherit-override.mjs   # ①子集合覆盖 ②overrides 替换 ③disable 停用 ④per-subtype 隔离 ⑤增量传播
```
