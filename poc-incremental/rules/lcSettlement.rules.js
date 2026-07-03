// 运行时加载的规则产物（生产中由 Rule Bundle API 下发：fetch('/rulesets/lcSettlement@active')）
window.LC_RULES = {
  "ruleSetId": "lcSettlement",
  "version": "5.1.0",
  "schemaVersion": "1.0",
  "status": "active",
  "model": {
    "root": "LetterOfCredit",
    "nodes": {
      "LetterOfCredit": {
        "fields": {
          "lcNo": { "type": "string" },
          "baseCcy": { "type": "string" },
          "valueDate": { "type": "date" },
          "maxNet": { "type": "decimal" },
          "adjustMode": { "type": "string" },
          "adjustment": { "type": "decimal", "computed": true },
          "chargeTotal": { "type": "decimal", "computed": true },
          "paymentTotal": { "type": "decimal", "computed": true },
          "net": { "type": "decimal", "computed": true }
        },
        "slots": {
          "applicant":       "CustomerParty",
          "beneficiary":     "CustomerParty",
          "advisingBank":    "BankParty",
          "adviseThrough":   { "node": "BankParty", "optional": true },
          "reimbursingBank": "BankParty"
        },
        "children": [
          { "name": "charges", "node": "ChargeGroup" },
          { "name": "payments", "node": "Payment" }
        ]
      },
      "ChargeGroup": {
        "fields": {
          "groupName": { "type": "string" },
          "subtotal": { "type": "decimal", "computed": true }
        },
        "children": [ { "name": "items", "node": "ChargeItem" } ]
      },
      "ChargeItem": {
        "fields": {
          "desc": { "type": "string" },
          "ccy": { "type": "string" },
          "amount": { "type": "decimal" },
          "fxRate": { "type": "decimal", "external": true },
          "base": { "type": "decimal", "computed": true, "overridable": true }
        }
      },
      "Payment": {
        "fields": {
          "ccy": { "type": "string" },
          "amount": { "type": "decimal" },
          "fxRate": { "type": "decimal", "external": true },
          "base": { "type": "decimal", "computed": true }
        }
      }
    }
  },

  "_note_partyTypes": "Party / CustomerParty / BankParty 由 import 的 commonParty 类型库提供（见 imports），此处槽位直接引用。",
  "dataSources": [
    { "sourceId": "fxRateService", "version": "1.0.0", "returns": "decimal",
      "keySchema": { "from": "string", "to": "string", "valueDate": "date" },
      "authority": "server", "cachePolicy": { "ttlSeconds": 300, "scope": "valueDate" },
      "tolerance": { "type": "relative", "value": "0.0005" } }
  ],

  "context": {
    "baseCcy": "root.baseCcy",
    "valueDate": "root.valueDate"
  },

  "imports": [
    { "ref": "commonFx@1.0.0", "as": "fx" },
    { "ref": "commonParty@1.0.0", "as": "party" }
  ],

  "uses": [
    { "use": "fx.fxConvert", "on": "ChargeItem", "as": "fx",
      "bind": { "amount": "amount", "fromCcy": "ccy", "toCcy": "ctx.baseCcy" },
      "produce": { "rate": "fxRate", "conv": "base" } },
    { "use": "fx.fxConvert", "on": "Payment", "as": "fx",
      "bind": { "amount": "amount", "fromCcy": "ccy", "toCcy": "ctx.baseCcy" },
      "produce": { "rate": "fxRate", "conv": "base" } }
  ],

  "rules": [
    { "id": "groupSubtotal", "type": "formula", "scope": "ChargeGroup", "trigger": "calc",
      "target": "subtotal", "expr": "round(sum(items.base), 2)" },
    { "id": "chargeTotal", "type": "formula", "scope": "LetterOfCredit", "trigger": "calc",
      "target": "chargeTotal", "expr": "round(sum(charges.subtotal), 2)" },
    { "id": "paymentTotal", "type": "formula", "scope": "LetterOfCredit", "trigger": "calc",
      "target": "paymentTotal", "expr": "round(sum(payments.base), 2)" },

    { "id": "calcAdjustment", "type": "formula", "scope": "LetterOfCredit", "trigger": "calc",
      "target": "adjustment",
      "cases": [
        { "when": "adjustMode == \"auto-high\"", "expr": "round(chargeTotal * 0.5, 2)" },
        { "when": "adjustMode == \"auto-low\"",  "expr": "round(chargeTotal * 0.1, 2)" }
      ],
      "fallback": "input" },

    { "id": "net", "type": "formula", "scope": "LetterOfCredit", "trigger": "calc",
      "target": "net", "expr": "round(chargeTotal - paymentTotal + adjustment, 2)" },

    { "id": "netLimit", "type": "validation", "scope": "LetterOfCredit", "trigger": "after-calc",
      "expr": "net <= maxNet", "severity": "error", "code": "E_NET_LIMIT",
      "message": "净额 {net} 超过上限 {maxNet}" },

    { "id": "reimbVsAdvising", "type": "validation", "scope": "LetterOfCredit", "trigger": "after-calc",
      "expr": "len(reimbursingBank.name) == 0 || reimbursingBank.name != advisingBank.name",
      "severity": "error", "code": "E_REIMB_DUP", "message": "偿付行不应与通知行相同" }
  ]
}
;
