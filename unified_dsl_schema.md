# 统一业务规则 DSL —— Schema 正式规范

> 状态：Draft v0.1
> 关联：[设计目标](./unified_dsl_summary.md) ·[架构设计](./unified_dsl_architecture.md)
> 本文目标：把 4 类规则、trigger、父子引用、版本元数据，定义成**正式、可机读的 Schema**。
> 配套机读文件：[`schema/ruleset.schema.json`](./schema/ruleset.schema.json)（JSON Schema 2020-12）

---

## 0. 约定

- 本文 Schema 方言：**JSON Schema Draft 2020-12**。
- 关键词 **MUST / SHOULD / MAY** 按 RFC 2119 理解。
- 本文只定义**结构（什么字段、什么类型、什么约束）**；
  表达式内部文法（`sum(children.amount)` 怎么解析）属于"表达式语言规范"，本文只约定它是一个字符串并给出引用语义概览（§6）。
- 标识符命名：`id` / `functionId` / `ruleSetId` MUST 匹配 `^[a-zA-Z][a-zA-Z0-9_]*$`。
- 版本号：MUST 是 SemVer（`MAJOR.MINOR.PATCH`）。

---

## 1. 顶层结构：RuleSet

一次发布的最小单元是 **RuleSet**（规则集，对应架构 §7 的不可变版本）。

```jsonc
{
  "ruleSetId": "fxTradeRules",          // 必填, 标识符
  "version": "1.4.0",                   // 必填, SemVer
  "schemaVersion": "1.0",               // 必填, 本 DSL 规范的版本
  "status": "active",                   // draft|staged|canary|active|deprecated|archived
  "effectiveFrom": "2026-07-01T00:00:00Z", // 可选, ISO-8601
  "model": { ... },                     // 可选, 交易树结构声明(见 §2)
  "rules": [ ... ],                     // 必填, 规则数组(见 §3)
  "functions": [ ... ],                 // 可选, 本集引用的 Function 元数据快照(见 §5)
  "metadata": { ... }                   // 可选, 治理元数据(见 §7)
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `ruleSetId` | string(标识符) | ✅ | 规则集稳定 ID，跨版本不变 |
| `version` | string(SemVer) | ✅ | 本集版本，发布后不可变 |
| `schemaVersion` | string | ✅ | 遵循的 DSL 规范版本，用于内核兼容判断 |
| `status` | enum | ✅ | 生命周期状态（架构 §7.2） |
| `effectiveFrom` | string(date-time) | ❌ | 生效时间；空表示立即 |
| `model` | object | ❌ | 交易树/字段类型声明，供 lint 与作用域校验 |
| `rules` | Rule[] | ✅ | 规则列表，至少 1 条 |
| `functions` | FunctionDescriptor[] | ❌ | 所引用 Function 的元数据快照（冻结版本） |
| `metadata` | object | ❌ | author/approvedBy/hash 等 |

---

## 2. 数据模型声明：`model`（可选但强烈建议）

声明交易树的节点与字段类型，使 lint 能静态校验字段路径与类型（架构 §5、§6.4）。

```jsonc
{
  "model": {
    "root": "Transaction",
    "nodes": {
      "Transaction": {
        "fields": {
          "limit":   { "type": "decimal" },
          "status":  { "type": "string" },
          "total":   { "type": "decimal", "computed": true },
          "maxCharge": { "type": "decimal" }
        },
        "children": { "name": "children", "node": "TradeLine" }
      },
      "TradeLine": {
        "fields": {
          "amount": { "type": "decimal" },
          "rate":   { "type": "decimal" },
          "charge": { "type": "decimal", "computed": true }
        }
      }
    }
  }
}
```

- `type` ∈ `string | int | decimal | boolean | date | datetime | enum`。
- `computed: true` 标记该字段由 formula/function/pipeline 产出（不可由用户直接输入）。
- `external: true` 标记该字段由 **resolver 异步解析**注入（如汇率）；它有四态语义（见 [§5.5](#55-resolver外部数据异步解析)、补充文档）。`external` 字段不可由 formula 直接赋值。
- `overridable: true` 标记该 **computed 字段允许人工覆盖**（治理：仅这些字段可被覆盖）。覆盖值持有该字段、下游据其重算、随交易**声明式**提交；中台 honor 合法覆盖、拒绝对非 overridable 字段的覆盖；覆盖值仍受同一套业务校验约束。
- `children` 声明父子关系，使 `children.amount`、`sum(children.charge)` 可被静态解析。

---

## 3. 规则通用模型（所有 Rule 共有的字段）

四类规则（validation / formula / function / pipeline）共享一组通用字段，再各自扩展。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | string(标识符) | ✅ | 规则在本集内唯一 |
| `type` | enum | ✅ | `validation`\|`formula`\|`function`\|`pipeline`\|`resolver` |
| `scope` | string | ❌ | 规则作用的节点类型；默认 `root`。如 `"TradeLine"` 表示对每个子记录执行 |
| `trigger` | enum | ❌ | 何时执行（§4）；默认按 type 推断 |
| `when` | string(表达式) | ❌ | 守卫条件；为真才执行该规则 |
| `enabled` | boolean | ❌ | 默认 `true`；可临时关闭 |
| `description` | string | ❌ | 人类可读说明 |

> **`scope` 的语义**：若 `scope = "TradeLine"`，该规则对**每个** TradeLine 子记录各执行一次，求值上下文 `self` 即当前子记录（架构 §5.3）。

---

## 4. Trigger（触发时机）

统一 trigger 语义，UI 与 Server **MUST** 使用同一套（架构 §3.1.5、§4）。

| trigger | 含义 | 典型用于 |
|---------|------|---------|
| `on-change` | 字段变更即触发 | formula 实时计算、即时校验 |
| `before-calc` | 计算阶段之前 | 前置校验、归一化 |
| `calc` | 计算阶段 | formula / pipeline 主计算 |
| `after-calc` | 计算完成之后 | 依赖计算结果的校验（如 `charge <= maxCharge`） |
| `on-submit` | 提交时（仅终态） | 最终一致性/聚合校验 |

**默认推断**：`formula`/`pipeline` 默认 `calc`；`validation` 默认 `after-calc`；`function` 默认 `calc`。
执行顺序由 trigger 阶段 + 字段依赖 DAG 共同决定（架构 §5.4）。

---

## 5. 四类规则 Schema

### 5.1 Validation（校验）

```jsonc
{
  "id": "limitCheck",
  "type": "validation",
  "scope": "Transaction",
  "trigger": "after-calc",
  "expr": "sum(children.charge) <= limit",   // 必填: 布尔表达式
  "severity": "error",                         // error|warning|info, 默认 error
  "message": "子项费用合计不得超过额度",          // 失败提示, 支持插值
  "code": "E_LIMIT_EXCEEDED"                    // 可选: 结构化错误码
}
```

| 扩展字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `expr` | string(布尔表达式) | ✅ | 求值必须为 boolean；为 `false` 即校验失败 |
| `severity` | enum | ❌ | `error` 拒绝交易；`warning`/`info` 仅提示 |
| `message` | string | ❌ | 失败信息，可含 `{field}` 插值 |
| `code` | string | ❌ | 供前端/审计的稳定错误码 |

### 5.2 Formula（计算）

```jsonc
{
  "id": "calcCharge",
  "type": "formula",
  "scope": "TradeLine",
  "trigger": "calc",
  "target": "charge",            // 必填: 计算结果写入的字段
  "expr": "amount * rate"        // 必填: 求值表达式
}
```

| 扩展字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `target` | string(字段路径) | ✅ | 结果写入字段；该字段 MUST 在 model 中标 `computed` |
| `expr` | string(表达式) | ⊘ | 无条件计算的求值表达式（与 `cases` 二选一） |
| `when` | string(表达式) | ❌ | 守卫；为真才按 `expr` 计算，为假走 `fallback` |
| `cases` | `{when,expr}[]` | ⊘ | **多条件计算**：按序取首个 `when` 成立的 `expr`；都不成立走 `fallback`（与 `expr` 二选一） |
| `fallback` | enum `input` | ❌ | 无分支命中时的兜底：`input` → 该字段转为**可输入态**（持用户值，下游据其重算）；省略 → null |

**条件计算（多分支 + 否则输入）示例**——比嵌套三元清晰：

```jsonc
{ "type": "formula", "target": "adjustment",
  "cases": [
    { "when": "mode == \"high\"", "expr": "round(base * 0.5, 2)" },
    { "when": "mode == \"low\"",  "expr": "round(base * 0.1, 2)" }
  ],
  "fallback": "input" }          // 都不匹配（如 mode=manual）→ 转可输入态
```

> 引擎对 `cases` 与单 `when` 归一处理；`fallback:"input"` 的字段有 `input` 态语义（公式态=只读/受防篡改校验，输入态=用户录入），中台据 `when` **独立判定**模式（[§5.5 resolver](#55-resolver外部数据异步解析) 同理思想）。

### 5.3 Function（函数调用）

```jsonc
{
  "id": "feeCalc",
  "type": "function",
  "scope": "TradeLine",
  "trigger": "calc",
  "function": "calcFee",          // 必填: 已注册 functionId
  "functionVersion": "1.3.0",     // 可选: 锁定版本; 省略则用集内 functions 快照
  "params": {                      // 可选: 入参映射(字段路径或表达式)
    "base": "amount",
    "tier": "root.customerTier"
  },
  "target": "fee"                  // 可选: 返回值写入字段(纯计算型函数需要)
}
```

| 扩展字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `function` | string(标识符) | ✅ | 引用 Function Registry 中的 functionId |
| `functionVersion` | string(SemVer) | ❌ | 锁定具体版本；缺省时由 RuleSet 的 `functions` 快照解析 |
| `params` | object<string,表达式> | ❌ | 形参→实参(字段路径或表达式)映射 |
| `target` | string(字段路径) | ❌ | 返回值写入位置；有返回值时必填 |

> Function 本身不含实现，只是**按 ID + version 引用受治理的注册函数**（架构 §6）。

### 5.4 Pipeline（流水线）

```jsonc
{
  "id": "totalPipeline",
  "type": "pipeline",
  "scope": "Transaction",
  "trigger": "calc",
  "target": "total",                          // 必填: 最终结果字段
  "steps": [                                   // 必填: 顺序步骤, >=1
    { "function": "calcBase", "version": "2.0.0" },
    { "function": "applyTax", "params": { "rate": "root.taxRate" } },
    { "expr": "round(value, 2)" }              // step 可为函数或表达式
  ]
}
```

| 扩展字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `target` | string(字段路径) | ✅ | 流水线最终输出写入字段 |
| `steps` | Step[] | ✅ | 顺序执行，至少 1 步 |

**Step 结构**（二选一：函数步 或 表达式步）：

```jsonc
// 函数步
{ "function": "applyTax", "version": "1.0.0", "params": { ... } }
// 表达式步
{ "expr": "round(value, 2)" }
```

- 步间数据传递：前一步输出绑定为隐式变量 `value`，供后一步 `expr`/`params` 引用。
- 每步中间结果可被审计观测（架构 §3.1.3）。

### 5.5 Resolver（外部数据异步解析）

> 详见[异步取数补充文档](./unified_dsl_async_scale.md)。用于信用证等场景中"计算需从后台取数（如汇率）"。
> 核心：取数**不在表达式里**做，而由引擎外的异步层解析后**注入字段**，保持引擎纯净与一致性。

```jsonc
{
  "id": "resolveFxRate",
  "type": "resolver",
  "scope": "Charge",
  "target": "fxRate",          // 必填: 解析结果写入字段（model 中须标 external）
  "source": "fxRateService",   // 必填: 已登记的数据源 id（见 §7 dataSources）
  "key": {                      // 必填: 取数键，值为表达式
    "from": "ccy",
    "to": "root.baseCcy",
    "valueDate": "root.valueDate"
  },
  "pin": true,                  // 可选: 取到的值钉入交易快照（默认 true）
  "fallback": "last-known"      // 可选: none|last-known|block，默认 last-known
}
```

| 扩展字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `source` | string(标识符) | ✅ | 引用 `dataSources` 中已登记数据源 |
| `target` | string(字段路径) | ✅ | 解析值写入字段；该字段 MUST 在 model 中标 `external` |
| `key` | object<string,表达式> | ✅ | 取数键；任一 key 输入变化触发重新解析 |
| `pin` | boolean | ❌ | 是否将结果钉入快照（默认 `true`，供中台一致复算） |
| `fallback` | enum | ❌ | 解析进行中/失败策略：`none`/`last-known`/`block` |

> `external` 字段有四态：`stale`/`pending`/`resolved`/`error`（见补充文档 §2.4）；
> `pending` ≠ null，下游计算传播 `pending`、校验对其**挂起**而非判失败。

---

## 6. 字段引用语义（概览）

完整文法见"表达式语言规范"，此处仅约定引用前缀（架构 §5.2）：

| 前缀 | 含义 | 可用作用域 |
|------|------|-----------|
| `field`（无前缀） | 当前 `self` 节点字段 | 任意 |
| `parent.field` | 直接父节点 | 非 root |
| `root.field` | 主记录字段 | 任意 |
| `children.field` | 子集合向量 | 有 children 的节点 |
| `sum/min/max/count/avg(children.field)` | 子集合聚合 | 有 children 的节点 |

---

## 7. FunctionDescriptor（集内快照）与 metadata

RuleSet 发布时，**冻结**其引用的 Function 元数据快照，保证历史可回放（架构 §6.2、§7.1）。

```jsonc
{
  "functions": [
    {
      "functionId": "calcFee",
      "version": "1.3.0",
      "signature": {
        "params": { "base": "decimal", "tier": "string" },
        "returns": "decimal"
      },
      "purity": "pure",
      "determinism": "deterministic"
    }
  ],
  "metadata": {
    "author": "team-fx",
    "approvedBy": "risk-control",
    "hash": "sha256:...",
    "createdAt": "2026-06-20T10:00:00Z"
  }
}
```

### 7.1 dataSources（外部数据源登记，resolver 引用）

`resolver` 引用的外部数据源必须登记、版本化、声明权威源与容差（治理同 Function；详见补充文档 §2.3）。

```jsonc
{
  "dataSources": [
    {
      "sourceId": "fxRateService",
      "version": "1.0.0",
      "returns": "decimal",
      "keySchema": { "from": "string", "to": "string", "valueDate": "date" },
      "authority": "server",                               // 权威源（中台）
      "cachePolicy": { "ttlSeconds": 300, "scope": "valueDate" },
      "tolerance": { "type": "relative", "value": "0.0005" } // 中台复算容差
    }
  ]
}
```

---

## 8. 静态约束（Lint 规则，发布前 MUST 通过）

对应架构 §6.4，本规范要求实现以下静态检查：

1. **唯一性**：`rules[].id` 在集内唯一。
2. **引用存在**：`function` 引用的 functionId@version MUST 在 `functions` 快照中且 `status=active`。
3. **字段合法**：所有字段路径 MUST 在 `model` 中可解析；`target` MUST 标 `computed`。
4. **作用域合法**：`parent.*` 不得用于 root 作用域；`children.*` 仅用于声明了 children 的节点。
5. **无环**：字段依赖图 MUST 无环（拓扑可排序）。
6. **类型相容**：`validation.expr` MUST 返回 boolean；`formula.expr` 结果类型与 target 相容。
7. **纯净性**：表达式 MUST NOT 含 IO/时钟/随机算子。
8. **trigger 自洽**：`after-calc` 的校验所依赖字段，MUST 存在产出它的 `calc` 阶段规则。
9. **resolver 合法**：`resolver.source` MUST 在 `dataSources` 中登记；`target` 字段 MUST 标 `external`；`key` 内表达式引用的字段 MUST 在 model 可解析。
10. **external 唯一写入**：每个 `external` 字段 MUST 恰由一个 resolver 产出，且 MUST NOT 被 formula/pipeline 直接赋值。

---

## 9. 完整示例

```jsonc
{
  "ruleSetId": "fxTradeRules",
  "version": "1.4.0",
  "schemaVersion": "1.0",
  "status": "active",
  "effectiveFrom": "2026-07-01T00:00:00Z",
  "model": {
    "root": "Transaction",
    "nodes": {
      "Transaction": {
        "fields": {
          "limit":     { "type": "decimal" },
          "maxCharge": { "type": "decimal" },
          "taxRate":   { "type": "decimal" },
          "total":     { "type": "decimal", "computed": true }
        },
        "children": { "name": "children", "node": "TradeLine" }
      },
      "TradeLine": {
        "fields": {
          "amount": { "type": "decimal" },
          "rate":   { "type": "decimal" },
          "charge": { "type": "decimal", "computed": true },
          "fee":    { "type": "decimal", "computed": true }
        }
      }
    }
  },
  "functions": [
    {
      "functionId": "calcFee", "version": "1.3.0",
      "signature": { "params": { "base": "decimal" }, "returns": "decimal" },
      "purity": "pure", "determinism": "deterministic"
    }
  ],
  "rules": [
    {
      "id": "calcCharge", "type": "formula", "scope": "TradeLine",
      "trigger": "calc", "target": "charge", "expr": "amount * rate"
    },
    {
      "id": "feeCalc", "type": "function", "scope": "TradeLine",
      "trigger": "calc", "function": "calcFee", "functionVersion": "1.3.0",
      "params": { "base": "charge" }, "target": "fee"
    },
    {
      "id": "totalPipeline", "type": "pipeline", "scope": "Transaction",
      "trigger": "calc", "target": "total",
      "steps": [
        { "expr": "sum(children.charge) + sum(children.fee)" },
        { "expr": "value * (1 + root.taxRate)" },
        { "expr": "round(value, 2)" }
      ]
    },
    {
      "id": "chargeCeiling", "type": "validation", "scope": "TradeLine",
      "trigger": "after-calc", "expr": "charge <= root.maxCharge",
      "severity": "error", "code": "E_CHARGE_CEILING",
      "message": "单笔费用超出上限"
    },
    {
      "id": "limitCheck", "type": "validation", "scope": "Transaction",
      "trigger": "on-submit", "expr": "total <= limit",
      "severity": "error", "code": "E_LIMIT_EXCEEDED",
      "message": "合计超出交易额度"
    }
  ],
  "metadata": { "author": "team-fx", "approvedBy": "risk-control" }
}
```

---

## 10. 未决 / 留给后续

1. 表达式语言完整文法（EBNF）、内置函数清单 —— "表达式语言规范"文档。
2. `message` 插值语法细节（`{field}` vs ICU MessageFormat）。
3. 跨 RuleSet 引用（一个集引用另一个集的规则）是否支持 —— 暂不支持，待评估。
4. 动态 `scope`（按条件选择作用节点）—— 暂用 `when` 守卫替代。
