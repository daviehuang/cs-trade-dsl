# 统一业务规则 DSL 设计目标总结

## 一、目标

设计一套统一 DSL，使业务规则（校验 + 计算 + 状态控制）与 UI 和微服务（MS）完全解耦，并支持：

- 前端 UI（实时校验与计算）
- 后端微服务（最终校验与计算）
- 第三方 UI 系统（可复用规则）

核心目标：

> One Rule → Multiple Runtimes

---

## 二、核心问题

### 1. 前后端规则不一致
UI 与 Server 各自实现校验逻辑，导致不一致。

### 2. 计算逻辑分裂
UI 做实时计算，Server 做最终计算，容易 drift。

### 3. 复杂交易结构
支持：
- 主记录 + 子记录
- 子记录集合计算
- 父子关系规则
- 跨节点规则

### 4. 复杂计算无法表达
需要支持函数级复杂逻辑，而不仅是表达式。

### 5. 多 UI 复用问题
DSL 必须与 UI 技术栈无关。

---

## 三、DSL需要表达的能力

### 1. 校验（Validation）
```json
{
  "type": "validation",
  "expr": "sum(children.amount) <= parent.limit"
}
```

### 2. 计算（Formula）
```json
{
  "type": "formula",
  "target": "charge",
  "expr": "amount * rate"
}
```

### 3. 函数调用（Function）
```json
{
  "type": "function",
  "function": "calcFee",
  "params": {}
}
```

### 4. Pipeline计算
```json
{
  "type": "pipeline",
  "steps": ["normalize", "applyRate", "rounding"]
}
```

---

## 四、核心运行架构

```
Rule Repository (DSL)
        │
 ┌──────┼────────┐
 ▼      ▼        ▼
UI   MS Service  Third-party UI
        │
        ▼
Expression Engine + Function Registry + Pipeline Engine
```

---

## 五、关键设计原则

### 1. DSL只描述规则，不包含实现
### 2. UI与Server双执行，Server最终裁决
### 3. Function必须注册治理
### 4. 复杂逻辑必须结构化（Function/Pipeline）
### 5. 规则必须可版本化

---

## 六、最终DSL示例

```json
{
  "rules": [
    {
      "type": "formula",
      "target": "charge",
      "expr": "amount * rate"
    },
    {
      "type": "validation",
      "expr": "charge <= maxCharge",
      "trigger": "after-calc"
    },
    {
      "type": "function",
      "function": "calcFee"
    },
    {
      "type": "pipeline",
      "target": "total",
      "steps": ["calcBase", "applyTax", "rounding"]
    }
  ]
}
```

---

## 七、总结

该 DSL 本质是：

> 业务规则中间表示层（IR），用于统一 UI、微服务和第三方系统的规则执行能力。
