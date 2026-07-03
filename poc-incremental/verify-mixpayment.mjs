// 验证 commonMixPayment 组件：宿主 import 它，明细自算合计、与外部币别/总额对账。
import { readFileSync } from 'fs';
import { createSession } from './src/incremental.js';

const mix = JSON.parse(readFileSync(new URL('./commonMixPayment.json', import.meta.url)));
const imports = { [`${mix.ruleSetId}@${mix.version}`]: mix };

// 宿主场景：Deal 直接引用导入的 MixPayment 作为子集合；context 把 ccy 映射到本场景币别。
const host = (extraRules = []) => ({
  ruleSetId: 'tradeSettlement', version: '1.0.0',
  imports: [{ ref: 'commonMixPayment@1.0.0', as: 'mix' }],
  model: {
    root: 'Deal',
    nodes: {
      Deal: {
        fields: { dealCcy: { type: 'string' }, agreedFee: { type: 'decimal' } },
        children: [{ name: 'charges', node: 'MixPayment' }],
      },
    },
  },
  context: { ccy: 'root.dealCcy' },
  rules: extraRules,
});

const resolveCell = (state, path) => {
  const toks = path.split('.');
  let node = state.tree;
  for (let k = 1; k < toks.length; k++) {
    const tok = toks[k], m = tok.match(/^(\w+)\[(\d+)\]$/);
    if (m) { node = node?.collections[m[1]]?.[+m[2]]; continue; }
    if (node?.slots?.[tok]) { node = node.slots[tok]; continue; }
    const i = path.lastIndexOf('.'); return node?.fields[path.slice(i + 1)];
  }
};
let pass = true;
const check = (ok, msg, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + msg + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));

// ── 1) extTotal 由【数据】提供（input 字段），明细对账一致 ────────────────
banner('1) extTotal 走数据：明细合计 = 外部总额 → 校验通过');
const dataOk = { dealCcy: 'USD', agreedFee: '300', charges: [
  { extTotal: '300', items: [{ desc: '开证费', amount: '100' }, { desc: '通知费', amount: '200' }] },
] };
let s = createSession(host(), structuredClone(dataOk), { imports });
await s.idle();
let st = s.getState();
const v = (p) => resolveCell(st, p)?.value;
console.log('  itemsTotal =', v('root.charges[0].itemsTotal'), ' diff =', v('root.charges[0].diff'));
check(v('root.charges[0].itemsTotal') === '300', 'itemsTotal = round(sum(items.amount),2) = 300');
check(v('root.charges[0].diff') === '0', 'diff = extTotal - itemsTotal = 0');
const tm1 = st.validations.find((x) => x.id === 'mixTotalMatch' && x.node === 'root.charges[0]');
check(tm1 && tm1.ok, 'mixTotalMatch 通过（合计 == 外部总额）');

// ── 2) 不一致 → 校验失败，且消息里 ctx.ccy 正确插值 ──────────────────────
banner('2) extTotal != 明细合计 → 校验失败，消息含场景币别 USD');
const dataBad = { dealCcy: 'USD', agreedFee: '500', charges: [
  { extTotal: '500', items: [{ desc: '开证费', amount: '100' }, { desc: '通知费', amount: '200' }] },
] };
s = createSession(host(), structuredClone(dataBad), { imports }); await s.idle(); st = s.getState();
const tm2 = st.validations.find((x) => x.id === 'mixTotalMatch' && x.node === 'root.charges[0]');
console.log('  message =', tm2 && tm2.message);
check(tm2 && tm2.state === 'resolved' && !tm2.ok, 'mixTotalMatch 失败（300 != 500）');
check(!!tm2 && /USD/.test(tm2.message || ''), '消息插值 {ctx.ccy} = USD（场景币别外部传入）');

// ── 3) 明细金额 <= 0 → ChargeItem 校验失败 ─────────────────────────────
banner('3) 明细金额非正 → mixAmountPositive 失败（作用到 ChargeItem）');
const dataNeg = { dealCcy: 'EUR', charges: [{ extTotal: '0', items: [{ desc: 'X', amount: '0' }] }] };
s = createSession(host(), structuredClone(dataNeg), { imports }); await s.idle(); st = s.getState();
const ap = st.validations.filter((x) => x.id === 'mixAmountPositive' && x.state === 'resolved' && !x.ok);
check(ap.length === 1 && ap[0].node === 'root.charges[0].items[0]', 'mixAmountPositive 命中该明细');

// ── 4) extTotal 由【宿主 formula】按实例注入（parent.agreedFee）──────────
banner('4) extTotal 走宿主 formula 注入：target=extTotal expr=parent.agreedFee');
const feed = [{ id: 'feedExtTotal', type: 'formula', scope: 'MixPayment', trigger: 'calc', target: 'extTotal', expr: 'parent.agreedFee' }];
const dataFeed = { dealCcy: 'USD', agreedFee: '300', charges: [
  { items: [{ desc: '开证费', amount: '100' }, { desc: '通知费', amount: '200' }] },   // 注意：不在数据里给 extTotal
] };
s = createSession(host(feed), structuredClone(dataFeed), { imports }); await s.idle(); st = s.getState();
console.log('  extTotal(注入) =', v('root.charges[0].extTotal'), ' itemsTotal =', v('root.charges[0].itemsTotal'));
const ext = resolveCell(st, 'root.charges[0].extTotal')?.value;
const tm4 = st.validations.find((x) => x.id === 'mixTotalMatch' && x.node === 'root.charges[0]');
check(ext === '300', '宿主 formula 把 parent.agreedFee=300 注入到组件 extTotal');
check(tm4 && tm4.ok, '注入后对账通过（300 == 300）');

console.log('\n' + (pass ? '✅ commonMixPayment 组件全部通过（数据注入 / formula 注入 / 对账 / ctx.ccy）' : '❌ 有断言失败'));
process.exit(pass ? 0 : 1);
