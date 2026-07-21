# 调后台 API 的复杂计费（多字段取数）

业务里常有"一段复杂计费必须调后台 API 才能算"的场景。本体系用 **dataSource + resolver 字段**承载——引擎从不碰 IO,只经 `resolve(source, key)` 回调拿值,从而守住"稳态 = 输入的纯函数",让中台能同源重算防篡改。

当后台 API **一次返回多个字段**(如 `{base, tax, fee}`)时,用 resolver 规则的 **`pick`**:每个输出字段一条 resolver、共享同一 `key`、各取响应对象里的一项;宿主 `resolve` 按 `(source,key)` 记忆化,N 个 pick = **1 次真实 API 调用**且取自同一快照。

样板见 `commonCharge.json`(库) + `chargeDemo`(示例场景,`npm run seed` 后可在编辑器打开)。

## 一、库模块怎么写(`commonCharge.json`)

```jsonc
"dataSources": [
  { "sourceId": "chargeService", "returns": "object",
    "valueFields": ["base", "tax", "fee"],           // 该源一次返回这几项
    "keySchema": { "productType": "string", "amount": "decimal", "tier": "string", "valueDate": "date" },
    "authority": "server", "tolerance": { "type": "absolute", "value": "0.01" } }
],
"modules": {
  "chargeCalc": {
    "inputs": { "productType": "string", "amount": "decimal", "tier": "string" },
    "context": ["valueDate"],
    "fields": {
      "base": { "type": "decimal", "external": true },   // 外部注入,不可手改
      "tax":  { "type": "decimal", "external": true },
      "fee":  { "type": "decimal", "external": true },
      "total": { "type": "decimal", "computed": true }   // 本地汇总,透明可审计
    },
    "rules": [
      { "id": "rBase", "type": "resolver", "target": "base", "source": "chargeService", "pick": "base",
        "key": { "productType": "productType", "amount": "amount", "tier": "tier", "valueDate": "ctx.valueDate" } },
      { "id": "rTax",  "type": "resolver", "target": "tax",  "source": "chargeService", "pick": "tax",  "key": { ...同上... } },
      { "id": "rFee",  "type": "resolver", "target": "fee",  "source": "chargeService", "pick": "fee",  "key": { ...同上... } },
      { "id": "rTotal","type": "formula",  "target": "total","expr": "base + tax + fee" }
    ],
    "outputs": ["base", "tax", "fee", "total"]
  }
}
```

**要点**:三个 resolver 的 `key` **必须完全一致**——这样宿主记忆化后只打一次后台,且三项来自同一快照,保证一致。`total` 用本地公式而非再调 API,是为了让"合计"这一步透明可审计、并接受中台 `compare` 复核。

## 二、产品 RuleSet 怎么挂(`chargeDemo-rules.json`)

`import` 库,`uses` 模块,`bind` 入参,`produce` 输出到宿主字段:

```jsonc
"imports": [{ "ref": "commonCharge@1.0.0", "as": "cc" }],
"context": { "valueDate": "root.bizDate" },
"uses": [
  { "use": "cc.chargeCalc", "on": "Deal", "as": "chg",
    "bind": { "productType": "productType", "amount": "amount", "tier": "tier" },
    "produce": { "base": "chgBase", "tax": "chgTax", "fee": "chgFee", "total": "chgTotal" } }
]
```
宿主字段 `chgBase/chgTax/chgFee` 声明为 `external`(UI 显示为注入、中台走钉值核对),`chgTotal` 声明为 `computed`(中台 `compare` 复核)。

## 三、三端接线 `resolve`

各端把 source 指到真实后台(引擎只回调,不关心怎么取):

| 端 | 位置 | 说明 |
|---|---|---|
| 编辑器预览 | `editor-react/src/mock.ts` | mock 值表,行里用 `values:{base,tax,fee}`,离线也能预览 |
| 前端运行时 | `runtime-loader/src/fx.ts` | `chargeService` 分支 + **按 (source,key) 记忆化 Promise**,base/tax/fee 三 pick 共享一次请求 |
| 中台 BFF | `bff/validate.js` `authResolve` | 权威后台;`verifyPinned` 泛化为按 `pick` + 该源 `tolerance` 核对 |

> ⚠ 三端数据源须"同表/同算法"(与汇率同一约定),否则会判成篡改。样板里三端用同一张按 `productType+tier` 的费用表。真实生产中前端与中台调**同一个**权威后台即可。

## 四、白得的中台防篡改(两条线)

- **计算用值**:中台重算时**按 key 重新调 chargeService**取权威 base/tax/fee 参与计算,前端提交的这些值**完全不信**(`extractInputs` 丢 external)。见 `COMPUTE-MODEL.md` 线路 A。
- **钉值核对**:前端每个 pick 各 emit 一条 `pinned`(带 `pick`+`key`),`verifyPinned` 按 `(source,key)` 记忆化重取权威对象、取对应 pick、按 `tolerance` 复核。改了 `chgBase` → `REJECT_TAMPER`(`kind:"resolver"`);改了本地 `chgTotal` → `compare` 抓到(`kind:"computed"`)。

## 五、pick 机制(引擎)

`src/incremental.js` 里 resolver cell 多了 `pick`:
- 建 cell 时存 `pick: rule.pick ?? null`(顶层与模块两处)。
- `fireResolve` 取值:`res.values ? res.values[pick] : res.value`(缺 pick=标量,向后兼容汇率)。
- `pinned` 带上 `pick`,供中台按项核对。

## 六、约束

1. **一个 pick = 一个标量 decimal**。多字段靠多条 pick 组合。
2. **API 须是 key 的纯函数**(同 key → 同结果):resolver 只在 key 序列化值变化时才重取,这是"稳态=纯函数"的前提;charge 依赖哪些字段就全塞进 `key`。
3. **宿主必须记忆化**同 (source,key) 的并发请求,否则 N 个 pick = N 次真实后台调用。

## 七、验证

```bash
node verify-charge-multi.mjs      # 引擎:pick 摊多字段 + 汇总 + pending + pinned + 记忆化(自包含)
npm run seed && node store-server.js &   # 起仓库(含 chargeDemo)
node verify-bff-charge.mjs        # 中台:正确→ACCEPT;篡改 charge/合计→REJECT_TAMPER
```
