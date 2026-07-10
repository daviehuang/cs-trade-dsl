# 统一业务规则 DSL —— 表达式语言规范

> 状态：Draft v0.1
> 关联：[设计目标](./unified_dsl_summary.md) · [架构设计](./unified_dsl_architecture.md) · [Schema 规范](./unified_dsl_schema.md)
> 本文目标：定义 DSL 中所有 `expr` 字符串的**文法（EBNF）、类型系统、求值语义、内置函数**。

---

## 0. 设计原则（为什么这份规范必须"硬"）

表达式是 UI 与 Server 共同执行的核心（架构 C2、ADR-1）。一致性能否成立，取决于**边界行为是否被无歧义地定义**：

> **凡是"看起来差不多但两端实现可能不同"的地方，本规范都必须钉死一个确定答案。**

四个最危险的 drift 来源，本规范逐一锁定：

1. **小数精度与四舍五入**（§4）——禁用 IEEE-754 浮点，统一十进制语义。
2. **null 传播**（§5）——明确每个算子遇到 null 的结果。
3. **除法/取整规则**（§4.3）——统一标度与舍入模式。
4. **求值确定性**（§7）——禁止一切非确定来源（时钟/随机/IO/遍历顺序）。

只要这四点两端一致，表达式层就不会 drift。

---

## 1. 文法（EBNF）

```ebnf
expression     = ternary ;

ternary        = logicalOr [ "?" expression ":" expression ] ;

logicalOr      = logicalAnd { "||" logicalAnd } ;
logicalAnd     = equality  { "&&" equality } ;

equality       = comparison { ( "==" | "!=" ) comparison } ;
comparison     = additive   { ( "<" | "<=" | ">" | ">=" ) additive } ;

additive       = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative = unary { ( "*" | "/" | "%" ) unary } ;

unary          = ( "!" | "-" ) unary | postfix ;
postfix        = primary ;

primary        = literal
               | functionCall
               | path
               | "(" expression ")" ;

functionCall   = identifier "(" [ argList ] ")" ;
argList        = expression { "," expression } ;

path           = pathHead { "." identifier } ;
pathHead       = "root" | "parent" | "children" | "value" | identifier ;

literal        = number | string | boolean | "null" ;
number         = intLiteral | decimalLiteral ;
intLiteral     = digit { digit } ;
decimalLiteral = digit { digit } "." digit { digit } ;
string         = '"' { stringChar } '"' ;
boolean        = "true" | "false" ;

identifier     = letter { letter | digit | "_" } ;
letter         = "a".."z" | "A".."Z" ;
digit          = "0".."9" ;
```

### 1.1 运算符优先级（高 → 低）

| 级 | 运算符 | 结合性 |
|----|--------|--------|
| 1 | `( )` 括号、函数调用、路径 `.` | — |
| 2 | 一元 `!` `-` | 右 |
| 3 | `*` `/` `%` | 左 |
| 4 | `+` `-` | 左 |
| 5 | `<` `<=` `>` `>=` | 左 |
| 6 | `==` `!=` | 左 |
| 7 | `&&` | 左 |
| 8 | `\|\|` | 左 |
| 9 | `? :` 三元 | 右 |

### 1.2 保留字
`root` `parent` `children` `value` `true` `false` `null`。
其余 identifier 解析为**当前作用域字段**或**函数名**（后接 `(` 即函数）。

---

## 2. 类型系统

### 2.1 标量类型
| 类型 | 说明 | 字面量 |
|------|------|--------|
| `int` | 64 位有符号整数 | `42` |
| `decimal` | **十进制定点数**（见 §4），金额/费率统一用它 | `3.14` |
| `boolean` | 布尔 | `true` / `false` |
| `string` | UTF-8 字符串 | `"abc"` |
| `date` / `datetime` | 日期 / 日期时间（ISO-8601） | 由字段提供，无字面量 |
| `null` | 空值 | `null` |

### 2.2 复合类型
- `vector<T>`：由 `children.field` 产生的**子集合向量**（如 `children.amount : vector<decimal>`）。
  - vector **仅能**作为聚合函数（§6.1）的实参，不能直接参与算术或比较。

### 2.3 类型提升（数值）
- `int` 与 `decimal` 混合运算 → 结果 `decimal`。
- **不存在隐式 string↔number 转换**；需要时用 `toDecimal()` / `toString()`（§6.4）。

### 2.4 上下文类型约束
- `validation.expr` 结果 MUST 为 `boolean`（否则 lint/运行期报错）。
- `formula.expr` / pipeline 步 结果类型 MUST 与 `target` 字段类型相容（§2.3 提升规则下）。
- 三元 `cond ? a : b`：`cond` MUST 为 `boolean`；`a`、`b` 类型须相容。

---

## 3. 字段路径与作用域引用

对应架构 §5、Schema §6。求值上下文提供 `self / parent / root / children`。

| 路径形式 | 含义 | 类型 | 约束 |
|----------|------|------|------|
| `field` | 当前 `self` 节点字段 | 字段声明类型 | 任意作用域 |
| `parent.field` | 直接父节点字段 | 同上 | 非 root 作用域；root 用则 lint 报错 |
| `root.field` | 主记录字段 | 同上 | 任意 |
| `children.field` | 子集合向量 | `vector<T>` | 仅有 children 的节点；只能喂给聚合 |
| `value` | 上一步隐式结果 | 上一步类型 | **仅 pipeline step 内**可用（Schema §5.4） |

- 路径中每一段 identifier MUST 在 `model`（Schema §2）中可解析，否则 lint 失败。
- **不支持**多层 `children.children.x` 的隐式跨两级聚合；跨多级需在中间层先聚合成字段再上引（保持可静态分析）。

---

## 4. 数值语义（最关键：钉死精度与舍入）

### 4.1 禁用浮点
> **decimal 运算 MUST NOT 使用 IEEE-754 二进制浮点。**
> 必须使用**十进制定点 / 任意精度十进制**（如 Java `BigDecimal`、JS `decimal.js`、Rust `rust_decimal`）。

理由：`0.1 + 0.2` 在浮点下 ≠ `0.3`，且 JS 与 JVM 浮点细节不同 → 必然 drift 且金额出错。单源内核（ADR-1）须在所有目标平台绑定**同一种十进制库语义**。

### 4.2 精度（precision）与标度（scale）
- 内部计算标度：**至少 28 位有效数字**（precision ≥ 28），中间结果不提前截断。
- 字段存储标度：由 `model` 字段定义决定；写入 `target` 时按目标字段标度做一次舍入（§4.4）。
- 即：**中间高精度计算，落字段时才舍入**——避免逐步舍入累积误差。

### 4.3 各运算符语义
| 运算 | 语义 |
|------|------|
| `+` `-` `*` | 精确十进制运算，结果保留完整标度（不丢精度） |
| `/` | 十进制除法，结果标度 = **34 位**，舍入模式 `HALF_UP`（见 §4.4）。除零 → 运行期错误 `E_DIV_ZERO` |
| `%` | 十进制取余，`a % b = a - b * truncate(a/b)`；`b=0` → `E_DIV_ZERO` |
| 一元 `-` | 取负，精确 |

### 4.4 唯一指定的舍入模式
> **全局默认舍入模式：`HALF_UP`（四舍五入，0.5 向上）。**

- "向上"指**远离零方向**：`round(2.5)=3`，`round(-2.5)=-3`。
- 显式舍入用 `round(x, n)`（§6.2）。
- **不使用** banker's rounding（HALF_EVEN）作为默认，以符合多数金融业务直觉；如需 HALF_EVEN，用 `roundEven(x, n)` 显式声明。
- 写入 `target` 字段时，按字段声明标度以 `HALF_UP` 自动舍入。

### 4.5 整数运算
- `int` 之间 `+ - *` 结果为 `int`；`/` 结果提升为 `decimal`（避免整除歧义）。整除请用 `idiv(a,b)`（§6.2）。
- `int` 溢出 64 位 → 运行期错误 `E_INT_OVERFLOW`（不静默回绕）。

---

## 5. null 语义（钉死空值传播）

> 规则数据里字段可能为空，两端对 null 的处理若不同必 drift。本节逐算子定义。

### 5.1 算术与一元
- 任一操作数为 `null` → 结果 `null`（传播）。例：`null + 1 == null`，`-null == null`。

### 5.2 比较 `< <= > >=`
- 任一操作数为 `null` → 结果 `false`（不是 null，也不抛错）。

### 5.3 相等 `== !=`
- `null == null` → `true`；`null != null` → `false`。
- `x == null`（x 非 null）→ `false`；`x != null` → `true`。
- 即 `==`/`!=` 是**唯一能安全探测 null 的算子**。

### 5.4 逻辑 `&& || !`
- 采用**短路 + 三值收敛**：
  - `false && x` → `false`（短路，x 不求值）；`true || x` → `true`（短路）。
  - 非短路侧出现 `null`：`true && null` → `null`，`false || null` → `null`，`!null` → `null`。
- **validation 结果若为 `null`**：视为**校验失败**（等价 false），并产生告警 `W_NULL_PREDICATE`，提示作者用 `coalesce`/`isNull` 显式处理。

### 5.5 三元
- `cond` 为 `null` → 走 `false` 分支，并告警 `W_NULL_PREDICATE`。

### 5.6 处理 null 的标准手段
- `coalesce(a, b, ...)`：返回首个非 null 实参（§6.4）。
- `isNull(x)` / `isNotNull(x)`：显式判空（§6.4）。

---

## 6. 内置函数库

> 内置函数是规范的一部分，**所有目标平台 MUST 实现完全相同的语义**（含舍入、null）。
> 业务专有逻辑不进内置库，走 Function Registry（架构 §6）。

### 6.1 聚合函数（实参为 `vector<T>`）
| 函数 | 签名 | 空向量行为 | null 元素 |
|------|------|-----------|-----------|
| `sum(v)` | `vector<number> → number` | 返回 `0` | **跳过 null** |
| `avg(v)` | `vector<number> → decimal` | 返回 `null` | 跳过 null（分母为非 null 计数） |
| `min(v)` / `max(v)` | `vector<number> → number` | 返回 `null` | 跳过 null |
| `count(v)` | `vector<T> → int` | 返回 `0` | **计入**（统计元素个数，含 null） |
| `countNonNull(v)` | `vector<T> → int` | 返回 `0` | 跳过 null |
| `every(v, predName)` / `any(...)` | 见注 | `every→true`,`any→false` | — |

- 聚合顺序无关（满足结合律），保证遍历顺序不影响结果（§7 确定性）。
- `sum` 空向量返回 `0` 是有意为之：便于 `sum(children.charge) <= limit` 在无子项时自然成立。

### 6.2 数学函数
| 函数 | 说明 |
|------|------|
| `round(x, n)` | 十进制四舍五入到 n 位小数，`HALF_UP` |
| `roundEven(x, n)` | 同上但 `HALF_EVEN`（银行家舍入） |
| `floor(x)` / `ceil(x)` / `truncate(x)` | 向下 / 向上 / 向零取整 |
| `abs(x)` | 绝对值 |
| `idiv(a, b)` | 整除（向零截断），`b=0`→`E_DIV_ZERO` |
| `pow(x, n)` | 幂，`n` 为非负整数（避免无理数不确定性） |
| `clamp(x, lo, hi)` | 限幅到 [lo, hi] |

### 6.3 字符串/集合谓词
| 函数 | 说明 |
|------|------|
| `len(s)` | 字符串长度（按 Unicode 码点） |
| `contains(s, sub)` / `startsWith` / `endsWith` | 子串判断 |
| `in(x, a, b, c, ...)` | x 是否等于任一后续实参（枚举判断） |

### 6.4 类型/空值工具
| 函数 | 说明 |
|------|------|
| `coalesce(a, b, ...)` | 首个非 null |
| `isNull(x)` / `isNotNull(x)` | 判空 |
| `toDecimal(x)` / `toInt(x)` / `toString(x)` | 显式转换；非法转换 → `E_CAST` |

### 6.5 显式禁止的函数（确定性红线）
> 以下能力 **MUST NOT** 存在于表达式内置库：
> `now()` / `today()` / `random()` / 任意 IO / 读取外部状态 / 依赖 locale 的隐式格式化。
>
> 需要"当前时间"等输入时，由运行时作为**字段注入到求值上下文**（如 `root.businessDate`），使其成为确定输入而非函数副作用。

---

## 7. 求值确定性（一致性总闸）

表达式求值 MUST 满足：

1. **纯函数**：输出仅由输入上下文决定，无副作用。
2. **确定性**：同输入恒同输出，跨平台、跨时间一致。
3. **顺序无关**：聚合/集合运算不依赖元素物理顺序。
4. **平台无关**：decimal 语义、舍入、null 行为在所有目标产物中绑定为同一套（ADR-1 路线 B 的落地点）。
5. **无环求值**：字段依赖构成 DAG，按拓扑序求值（架构 §5.4、Schema §8.5）。

> 一致性回归：每个内置函数 + 每个算子，MUST 配 golden 用例（同输入→同输出），纳入 CI（架构 §3.1 方案 B 兜底）。

---

## 8. 错误模型

求值期错误统一为结构化错误码，两端 MUST 一致：

| 错误码 | 触发 |
|--------|------|
| `E_DIV_ZERO` | 除零 / 取余零 |
| `E_INT_OVERFLOW` | int 越界 |
| `E_CAST` | 非法显式转换 |
| `E_TYPE` | 类型不匹配（应由 lint 提前拦截；运行期兜底） |
| `E_UNKNOWN_PATH` | 路径在上下文不可解析（应由 lint 拦截） |
| `W_NULL_PREDICATE` | 谓词求值为 null（告警，按 false 处理） |

- `validation` 失败（`expr=false`）走业务校验路径（§Schema severity），**不是**求值错误。
- 求值错误（E_*）属系统级，应阻断该规则并上报，不可静默吞掉。

---

## 9. message 插值

`validation.message` 的插值语法（Schema §5.1）：

- 语法：`{ expression }`，花括号内是**本规范的表达式**，在失败上下文中求值后插入。
  - 例：`"费用 {charge} 超过上限 {root.maxCharge}"`。
- 数值按字段标度、`HALF_UP` 格式化为字符串；**不引入 locale 相关格式**（千分位/货币符号由 UI 层渲染，DSL 不管）。
- 转义：`{{` / `}}` 表示字面花括号。

---

## 10. 条件分支：`cases` / `fallback`（多分支与 else）

`formula` 规则除单一 `expr` 外，支持 `cases` 多分支：**按序取首个 `when` 成立的分支的 `expr`**；
全不匹配时走 `fallback`。语义已在 `poc-incremental` 引擎实现（`src/incremental.js`）。

```jsonc
{ "type": "formula", "scope": "LetterOfCredit", "target": "adjustment",
  "cases": [
    { "when": "adjustMode == \"auto-high\"", "expr": "round(chargeTotal * 0.5, 2)" },
    { "when": "adjustMode == \"auto-low\"",  "expr": "round(chargeTotal * 0.1, 2)" }
  ],
  "fallback": "input" }
```

### 10.1 求值顺序
- 从上到下遍历 `cases`，**首个** `when` 求值为 `true` 的分支胜出、用其 `expr`，即停（first-match-wins）。
- `when` 是布尔表达式；`null` 或非 `true` 视为**不匹配**（呼应 §5.4 逻辑 null 语义）。
- 全部不匹配 → 走 `fallback`（见 §10.3）。

### 10.2 表达 else（"其余情况"）的两种写法

**A. 末尾放一个不带 `when` 的分支**——无 `when` = 恒匹配 = 默认分支：
```jsonc
"cases": [
  { "when": "adjustMode == \"auto-high\"", "expr": "round(chargeTotal * 0.5, 2)" },
  { "when": "adjustMode == \"auto-low\"",  "expr": "round(chargeTotal * 0.1, 2)" },
  { "expr": "0" }        // ← else：无 when，恒匹配，必须放最后
]
```
用于 else 也是一个**计算值**（公式/常量）。⚠ 因 first-match-wins，无 `when` 分支**必须放最后**；放前面会吞掉后续所有分支。

**B. 用 rule 级 `fallback`**——无分支匹配时的兜底（见 §10.3）。

### 10.3 `fallback` 取值语义

| `fallback` | 无 `when` 匹配时 |
|---|---|
| `"input"` | 字段转为**可人工录入态**，取用户在该字段手填的值（例：`adjustMode == "manual"` 时人工录入 adjustment） |
| 省略 / 其它值 | 值为 **`null`**（空） |

> `fallback` **不是表达式**，当前仅特殊值 `"input"` 有效。若 else 需要一个"公式/常量"，用写法 A（末尾无 `when` 分支），不要用 `fallback`。

### 10.4 二选一，别混用
若 `cases` 末尾已放无 `when` 的默认分支，它恒匹配 → `fallback` 永远轮不到。因此：
- **else = 算出来的值**（公式/常量）→ 写法 A（末尾无 `when` 分支）
- **else = 让用户手填** → `"fallback": "input"`
- **else = 空/null** → 两者都不写

### 10.5 分支级可覆盖 `case.overridable`（计算值 + 可覆盖，服务器可验证）
每条 `case` 可选 `"overridable": true`——**命中此分支时该字段允许人工覆盖**（可给一个计算默认值再让用户改）：
```jsonc
"cases": [
  { "when":"adjustMode == \"auto-high\"", "expr":"round(chargeTotal*0.5, 2)" },              // 锁死：中台权威验算
  { "when":"adjustMode == \"auto-low\"",  "expr":"round(chargeTotal*0.1, 2)" },              // 锁死
  { "expr":"round(chargeTotal*0.2, 2)", "overridable":true }                                  // else：计算默认值 + 可覆盖
]
```
语义：**字段此刻是否可覆盖 = 当前命中分支的 `overridable`**（不限于 else，任意分支可独立标）。
- 命中锁死分支：忽略任何覆盖，值 = `expr`；**中台按 expr 权威重算比对**，不一致即 `REJECT_TAMPER`。
- 命中可覆盖分支：有覆盖用覆盖值（`overridden` 态），否则用 `expr`；**中台接受覆盖值、跳过该字段计算值比对**。

整套判定在**服务器**用原始输入重算命中哪条 case，不信前端任何标记——所以"部分条件锁死可验、else 计算值可覆盖不验"是
**服务器可验证**的，而非仅靠 UI 限制。归一化：`case.overridable ?? 字段级 overridable`（未标退化到字段级，向后兼容）。

> 引擎实现见 `poc-incremental/src/incremental.js`（recompute 先定位命中 case 再决定覆盖；`setOverride` 按命中分支放行）；
> 中台复算见 `bff/validate.js`（`setOverride` throw → `unauth-override`）。

**加载时重建覆盖态（无需单独持久化 override 列表）**：override 是会话状态、不在扁平数据里，但若后台存了字段的
**计算值**，加载时可反推——某计算字段的【存值】≠【重算值】且当前分支可覆盖 → 判定当初被覆盖 → 回放为 override
（`session.reconstructOverrides(data, { skipExternalDependent })`）。这是 §BFF `compare` 的逆用，结论与服务器一致
（落锁死分支的存值会被 `setOverride` 拒 → 不反推）。**默认只反推非外部依赖字段**：依赖 resolver 的字段重算含汇率漂移、
存值 vs 重算易误判，故跳过（要精确复现须另存/回灌 pinned 汇率）。

---

## 11. 示例

```jsonc
// 1) 子项费用 = 金额 * 费率，落到 charge（写入时按 charge 标度 HALF_UP 舍入）
{ "type": "formula", "scope": "TradeLine", "target": "charge", "expr": "amount * rate" }

// 2) 含税合计：高精度中间计算，最后 round 到 2 位
{ "type": "formula", "scope": "Transaction", "target": "total",
  "expr": "round((sum(children.charge) + sum(children.fee)) * (1 + root.taxRate), 2)" }

// 3) 空值安全的校验：rate 可能为空，coalesce 兜底
{ "type": "validation", "scope": "TradeLine",
  "expr": "coalesce(rate, 0) >= 0 && charge <= root.maxCharge",
  "message": "费用 {charge} 超过单笔上限 {root.maxCharge}" }

// 4) 聚合 + 条件：仅当状态为 active 时校验额度
{ "type": "validation", "scope": "Transaction", "when": "status == \"active\"",
  "expr": "sum(children.charge) <= limit" }

// 5) 枚举判断 + 三元
{ "type": "formula", "scope": "TradeLine", "target": "fee",
  "expr": "in(root.tier, \"gold\", \"platinum\") ? charge * 0.01 : charge * 0.02" }
```

---

## 12. 未决 / 留给后续

1. 是否支持用户自定义聚合谓词（`every(v, pred)` 的 `pred` 表达方式）—— 暂留接口，未定义。
2. `date`/`datetime` 的运算（加减天数、比较）算子清单 —— 下一轮补充内置日期函数。
3. 字符串模板是否需要更丰富格式化 —— 暂不,交 UI 层。
4. 表达式的"解释执行 vs 预编译为 AST 字节码"——属内核实现细节,不在本规范。
