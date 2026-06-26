# 统一业务规则 DSL —— 引擎 PoC

> 关联：[设计目标](../unified_dsl_summary.md) · [架构](../unified_dsl_architecture.md) · [Schema](../unified_dsl_schema.md) · [表达式规范](../unified_dsl_expression.md)

## 这个 PoC 证明了什么

针对你的拓扑 **Browser UI(JS) → BFF(Node) → 中台 MS(Java)**，验证架构里最关键的决策 **ADR-1（单源多目标内核 / 路线 B）**：

> **同一份规则，在 JS 运行时（UI+BFF）和 Java 运行时（中台）上逐位一致执行，零 drift。**

并且明确了执行职责（呼应你的「中台负责校验和计算」）：

| 层 | 运行时 | 角色 | 权威 |
|---|---|---|---|
| Browser UI | JS 内核 | 实时校验/计算（体验） | 否 |
| BFF | JS 内核（**同一产物**） | 预校验/聚合 | 否 |
| **中台 MS** | **Java 内核** | **校验+计算，最终裁决** | **是** |

UI 与 BFF 都是 JS → 共用**同一内核产物** → 字节级一致（免费）。
唯一跨语言边界是 **JS ↔ Java**，由 **golden 向量**作为契约钉死（本 PoC 实测 22/22 一致）。

## 目录

```
poc/
├── js/                      # JS 内核（UI + BFF 的目标产物）
│   ├── src/kernel.js        #   表达式：lexer+parser+eval+内置函数+十进制语义
│   ├── src/engine.js        #   规则引擎：4 类规则 + trigger + 父子作用域 + Function Registry
│   ├── run-fx.js            #   执行 FX RuleSet，证明 UI==BFF
│   └── run-golden.js        #   跑 golden 向量
├── java/
│   └── Dsl.java             # Java 内核（中台）：BigDecimal 实现同一套语义 + golden runner
├── shared/                  # 双端共享的输入（单一事实来源）
│   ├── fxTradeRules.json    #   示例 RuleSet（含 model / 4 类规则）
│   ├── transaction.json     #   示例交易树（小数以字符串表示，杜绝 JSON 浮点）
│   └── golden.json          #   跨语言一致性契约：22 条边界向量
├── compare.mjs              # 裁决：逐条比对 JS 产物 vs Java 产物
└── run-all.sh               # 一键跑通 1)~4)
```

## 运行

```bash
bash poc/run-all.sh
```

需要：Node ≥ 18、JDK ≥ 17。

## 可视化页面（浏览器实时验证校验逻辑）

```bash
node poc/build-viz.mjs      # 生成自包含的 poc/viz.html
```

然后**双击 `poc/viz.html`** 在浏览器打开（无需服务器、可离线）。页面是 **UI 运行时**：

- 编辑主记录 / 子项的任意字段 → `charge`、`fee`、`total` 实时重算；
- 校验结果实时显示（通过/失败/告警，超 `maxCharge` 的子项标红）；
- 右上「中台复算」用**同一内核**再算一遍并给出裁决 + `UI = 中台 零 drift` 徽章。

关键：页面内联的是**真实的 `js/src/kernel.js` + `engine.js`**（由 `build-viz.mjs` 从源码剥离 import/export 生成），
与 PoC、BFF、中台跑的是同一份逻辑——改了内核记得重跑 `build-viz.mjs`。

## 如何手动验证 / 观察结果

三种方式，从"一键看结论"到"亲手制造 drift 验证机制有效"。

### 方式 1：一键跑全部（Git Bash）

```bash
cd C:/work/workspace/claude/projects/unified-dsl
bash poc/run-all.sh
```

### 方式 2：PowerShell 分步（看得最清楚）

```powershell
cd C:\work\workspace\claude\projects\unified-dsl\poc

# ① JS 内核（代表 UI + BFF）
cd js
npm install                  # 仅首次，装 decimal.js
node run-fx.js
node run-golden.js

# ② Java 内核（中台）
cd ..\java
javac Dsl.java
java -Dstdout.encoding=UTF-8 Dsl   # 加该参数中文不乱码

# ③ 跨语言裁决：JS vs Java 逐条比对
cd ..
node compare.mjs
```

> `-Dstdout.encoding=UTF-8` 解决 Windows 控制台中文乱码——只是显示问题，数据正确。

### 该看什么（5 个结论点）

| 步骤 | 关键证据 | 期望 |
|------|---------|------|
| `run-fx.js` | `"total": "1294.44"` + 4 条校验 `✅ PASS` | 计算与校验正确 |
| `run-fx.js` 末尾 | `UI vs BFF ✅ 完全一致` | UI/BFF 零 drift |
| `run-golden.js` | `JS 内核: 22/22 通过` | JS 全过 |
| `java Dsl` | `Java 内核（中台）: 22/22 通过` | Java 全过 |
| `compare.mjs` | `跨语言一致: 22/22 \| drift: 0` | **JS↔Java 逐位一致** |

`total` 可手算核对：子项 charge = 120.6 / 100 / 999.99，fee = 1% → 1.206 / 1 / 9.9999，
含税合计 `(1220.59 + 12.2059) × 1.05` round 2 = **1294.44**。

### 方式 3：亲手制造 drift，验证 golden 门禁真有用

光看"全过"不够，应亲手让它**失败一次**，确认机制不是摆设（任选其一，验证后改回）：

**实验 A — 让中台用浮点（经典 bug）：** 在 `java/Dsl.java` 把加法
`case "+": return a.add(b);` 临时改成
`case "+": return new BigDecimal(a.doubleValue() + b.doubleValue());`，
重新 `javac Dsl.java && java -Dstdout.encoding=UTF-8 Dsl`，再 `node compare.mjs`。
→ `g01_float_trap` 变 `0.30000000000000004`，`compare.mjs` 报 **❌ DRIFT** 且退出码非 0。
**这就是 golden 门禁在 CI 拦住前后端不一致的现场。**

**实验 B — 改交易数据，看实时重算：** 编辑 `shared/transaction.json`，把某条 `amount`
改成 `"9999"`，跑 `node js/run-fx.js`。→ 该项 `charge` 超过 `maxCharge=2000`，
对应校验变 `❌ FAIL` 并打印超限提示。

**实验 C — 加一条自己的契约向量：** 在 `shared/golden.json` 加
`{ "id": "my01", "expr": "round(10 / 3, 4)", "vars": {}, "expect": "3.3333" }`，
两端各跑 + `compare.mjs`，确认都给出 `3.3333` 且一致。这就是**给 Java 团队加契约**的方式。

## golden 向量专打 drift 重灾区

`shared/golden.json` 的 22 条向量覆盖**两端最容易算出不同结果**的点：

- **浮点陷阱**：`0.1 + 0.2 == 0.3`（浮点下为 false，十进制下为 true）
- **四舍五入**：`round(100.005,2)=100.01`（HALF_UP）、`roundEven(2.5,0)=2`（银行家）
- **除法标度**：`1/3 = 0.333…`（34 位有效数字，两端必须一致）
- **null 传播**：`null+1=null`、`amount<=x`（amount=null）=false、`true && null=null`
- **聚合**：`sum/avg/min/max/count` 对空值的取舍
- **十进制精度求和**：`sum([1.1,2.2,3.3])=6.6`（浮点会得 6.6000000000000005）

实测：**JS 22/22、Java 22/22、跨语言 22/22 一致，drift=0。**

## 与规范的对应

| 规范条目 | PoC 落点 |
|---------|---------|
| 表达式 §4 十进制语义 | kernel.js 用 decimal.js(precision 34, HALF_UP)；Dsl.java 用 BigDecimal+MathContext(34,HALF_UP) |
| 表达式 §5 null 传播 | evalBin/evalUnary 逐算子实现，两端对齐 |
| 表达式 §6 内置函数 | BUILTINS / evalCall，两端同名同义 |
| 架构 ADR-1 路线 B | 同一套语义，多目标实现，golden 向量做一致性门禁 |
| 架构 §6 Function 治理 | engine.js REGISTRY 按 `id@version` 解析 calcFee |
| Schema 4 类规则 | engine.js 执行 formula/function/pipeline/validation |

## 重要说明（PoC 边界）

- 本 PoC 的 JS 与 Java 是**两套手写实现**，刻意用来**演示 drift 风险并证明 golden 门禁能拦住它**。
  生产落地按 ADR-1 路线 B，内核应**单源编译**到多目标（如 TS→JS + WASM 进 JVM），
  从根上消除"两套实现"——golden 向量退化为回归兜底。
- Java 侧 PoC 聚焦**表达式+十进制**这一 drift 命门；完整规则引擎（树/作用域/pipeline）在 JS 侧已实现，
  Java 侧同构扩展是直线工程，不改变一致性结论。
