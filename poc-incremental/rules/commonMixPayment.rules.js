// 组件库产物（被 mixDemo import：MixPayment/ChargeItem + 对账规则）
window.COMMON_MIX_PAYMENT = {
  "ruleSetId": "commonMixPayment",
  "version": "1.0.0",
  "description": "可复用「混合收费 Mix Payment」组件：多条收费明细自算合计，并与【外部传入的币别 ctx.ccy / 总额 extTotal】对账。独立版本、独立治理，被各业务 RuleSet import。组件零业务耦合——只认两个『接缝』：ctx.ccy（场景币别）与 extTotal（按实例外部总额）。",

  "nodes": {
    "MixPayment": {
      "fields": {
        "extTotal":   { "type": "decimal" },
        "itemsTotal": { "type": "decimal", "computed": true },
        "diff":       { "type": "decimal", "computed": true }
      },
      "children": [ { "name": "items", "node": "ChargeItem" } ]
    },
    "ChargeItem": {
      "fields": {
        "desc":   { "type": "string" },
        "amount": { "type": "decimal" }
      }
    }
  },

  "rules": [
    { "id": "mixItemsTotal", "type": "formula", "scope": "MixPayment", "trigger": "calc",
      "target": "itemsTotal", "expr": "round(sum(items.amount), 2)" },

    { "id": "mixDiff", "type": "formula", "scope": "MixPayment", "trigger": "calc",
      "target": "diff", "expr": "round(extTotal - itemsTotal, 2)" },

    { "id": "mixAmountPositive", "type": "validation", "scope": "ChargeItem", "trigger": "after-calc",
      "expr": "amount > 0", "severity": "error", "code": "E_MIX_AMT",
      "message": "收费金额必须大于 0（{ctx.ccy}）" },

    { "id": "mixTotalMatch", "type": "validation", "scope": "MixPayment", "trigger": "after-calc",
      "expr": "extTotal == null || extTotal == 0 || itemsTotal == extTotal",
      "severity": "error", "code": "E_MIX_TOTAL",
      "message": "明细合计 {itemsTotal} 与外部总额 {extTotal} {ctx.ccy} 不一致（差 {diff}）" }
  ]
}
;
