# 路线 B 真身验证 —— 单一 WASM 内核跑两处

> 关联：[架构 ADR-1](../unified_dsl_architecture.md) · [表达式规范](../unified_dsl_expression.md) · [前一个 PoC](../poc/README.md)

## 这个验证回答的问题

前一个 PoC（`../poc/`）用**两套手写实现**（JS + Java）+ golden 向量证明"结果能对齐"。
但 ADR-1 路线 B 的**真身**主张更强：

> 内核**只写一份源码 → 编译成一个二进制 → 同一个二进制在多个运行时加载执行**。
> 不是"两套实现互相对齐"，而是"同一份产物跑两处"——从根上消灭 drift。

本验证就是把这句话**做出来**：

```
            kernel.wat   ← 唯一源码（十进制内核，scaled-int，无浮点）
                │ 单源编译 (wabt)
                ▼
           kernel.wasm   ← 唯一二进制（276 字节）
            ┌───┴────┐
            ▼        ▼
     Node 宿主    JVM 宿主 (Chicory, 纯 Java，无 GraalVM/原生依赖)
     (UI / BFF)   (中台 MS)
            └───┬────┘
                ▼
        逐条比对原始 i64 输出 → 12/12 一致, drift = 0
```

## 实测结果

| 步骤 | 结果 |
|------|------|
| `kernel.wat` → `kernel.wasm` 单源编译 | ✅ 276 字节 |
| Node 加载 wasm 跑 12 用例 | ✅ `0.1+0.2=0.3`、HALF_UP、定点除法全对 |
| JVM(Chicory) 加载**同一** wasm 跑 12 用例 | ✅ 同上 |
| **跨宿主逐条比对原始 i64** | ✅ **12/12 一致，drift=0** |

关键：JVM 不含任何十进制规则逻辑，它只是**加载并执行 wasm 字节**。
两端结果一致**不是因为对齐了实现，而是因为根本就是同一份实现**。

## 目录

```
poc-wasm/
├── src/kernel.wat       # 唯一源码：dadd/dsub/dmul/ddiv/dround（定点十进制 HALF_UP）
├── build.mjs            # wabt 编译 wat → kernel.wasm
├── kernel.wasm          # 唯一产物（两个宿主都加载它）
├── cases.json           # 12 条共享用例（scaled-6 整数输入）
├── run-node.mjs         # 宿主 A：Node（UI/BFF）
├── java/RunWasm.java    # 宿主 B：JVM（中台），用 Chicory 加载 wasm
├── lib/                 # Chicory jar（runtime + wasm，纯 Java）
├── compare.mjs          # 裁决：Node vs JVM 逐条比对
└── run-all.sh           # 一键跑通 0)~3)
```

## 运行

```bash
bash poc-wasm/run-all.sh        # Git Bash
```

或 PowerShell 分步（注意 classpath 用 `;` 分隔）：

```powershell
cd C:\work\workspace\claude\projects\unified-dsl\poc-wasm
npm install
node build.mjs ; node run-node.mjs
cd java
$cp = "../lib/runtime-1.7.5.jar;../lib/wasm-1.7.5.jar"
javac -cp $cp RunWasm.java
java -Dstdout.encoding=UTF-8 -cp "$cp;." RunWasm
cd ..
node compare.mjs
```

需要：Node ≥ 18、JDK ≥ 17、联网（首次拉取 wabt 与 Chicory jar）。

## 与前一个 PoC 的关系（两者都要）

| | `../poc/`（双实现 + golden） | `poc-wasm/`（单一 wasm） |
|---|---|---|
| 证明的事 | 规则引擎完整跑通 + 一致性可门禁 | 单源产物跨运行时**逐位一致** |
| 内核 | 两套手写（JS / Java） | 一份（wat → wasm） |
| 一致性来源 | golden 向量对齐 | 同一份二进制（构造即一致） |
| 角色 | 演示 drift 风险 + 兜底机制 | 演示根治 drift 的路线 B |

## 落地启示（PoC → 生产）

1. **本验证用 WAT 手写定点十进制**只为最小化工具链、可在本机直接复现。
   生产内核应用高层语言写一份（如 **Rust + rust_decimal** 或 **AssemblyScript**），
   编译到 `wasm32`，得到完整 34 位十进制 + 表达式解析 + 规则引擎。
2. **JVM 侧用 Chicory**（纯 Java 解释器）即可加载 wasm，**无需 GraalVM、无原生依赖**，
   契合你"中台 = Java"的现状。性能敏感处可换 Chicory AOT 或 GraalWasm。
3. **UI 与 BFF 都是 JS**：直接用 wasm（或把内核同时编译为原生 JS）。
   于是三端（UI/BFF/中台）跑的是**同一份内核**，一致性不再靠纪律或测试，而是**构造保证**。
4. golden 向量（`../poc/shared/golden.json`）此时退化为**回归兜底**，
   防止编译链/宿主升级引入回归，而非日常对齐两套实现。
