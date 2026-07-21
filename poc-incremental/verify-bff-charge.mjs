// BFF 多字段计费防篡改验证（依赖 store-server :8788 运行）
//   ① 正确计费值 → ACCEPT（BFF 按 key 重取权威 charge、pinned 容差核对通过）
//   ② 篡改某个 charge 外部字段（chgBase）→ REJECT_TAMPER（verifyPinned 抓到 pick 分歧）
//   ③ 篡改本地汇总 chgTotal（computed）→ REJECT_TAMPER（compare 抓到）
import { validateSubmission } from './bff/validate.js';

let pass = true;
const check = (ok, m, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + m + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(64) + '\n' + t + '\n' + '═'.repeat(64));

// gold/LC → base120 tax60 fee15 total195（与 BFF authResolve 同表）
const base = { bizDate: '2026-07-21', productType: 'LC', amount: '10000', tier: 'gold' };
// 前端提交需带 pinned（每个 pick 一条），否则 verifyPinned 无从核对
const pinnedOf = (b, t, f) => [
  { field: 'root.chg.base', value: b, source: 'chargeService', pick: 'base', key: { productType: 'LC', amount: '10000', tier: 'gold', valueDate: '2026-07-21' } },
  { field: 'root.chg.tax', value: t, source: 'chargeService', pick: 'tax', key: { productType: 'LC', amount: '10000', tier: 'gold', valueDate: '2026-07-21' } },
  { field: 'root.chg.fee', value: f, source: 'chargeService', pick: 'fee', key: { productType: 'LC', amount: '10000', tier: 'gold', valueDate: '2026-07-21' } },
];

banner('1) 正确计费值 → ACCEPT');
const r1 = await validateSubmission({ ruleSetId: 'chargeDemo',
  data: { ...base, chgBase: '120.00', chgTax: '60.00', chgFee: '15.00', chgTotal: '195' },
  pinned: pinnedOf('120.00', '60.00', '15.00') });
console.log('   verdict=' + r1.verdict + '  serverComputed=' + JSON.stringify(r1.serverComputed) + '  divergences=' + JSON.stringify(r1.divergences));
check(r1.ruleSetId === 'chargeDemo', '用 chargeDemo 规则动态校验');
check(r1.serverComputed.chgTotal === '195', 'BFF 重算 chgTotal = 195', ' → ' + r1.serverComputed.chgTotal);
check(r1.verdict === 'ACCEPT', '未篡改 → ACCEPT');

banner('2) 篡改 charge 外部字段 chgBase(120→99) → REJECT_TAMPER（verifyPinned 抓 pick 分歧）');
const r2 = await validateSubmission({ ruleSetId: 'chargeDemo',
  data: { ...base, chgBase: '99.00', chgTax: '60.00', chgFee: '15.00', chgTotal: '195' },
  pinned: pinnedOf('99.00', '60.00', '15.00') });
console.log('   verdict=' + r2.verdict + '  divergences=' + JSON.stringify(r2.divergences));
check(r2.verdict === 'REJECT_TAMPER', '篡改基础费 → REJECT_TAMPER');
check(r2.divergences.some((d) => d.field === 'root.chg.base' && d.kind === 'resolver'), '分歧定位到 chg.base（kind=resolver）');

banner('3) 篡改本地汇总 chgTotal(195→100) → REJECT_TAMPER（compare 抓 computed）');
const r3 = await validateSubmission({ ruleSetId: 'chargeDemo',
  data: { ...base, chgBase: '120.00', chgTax: '60.00', chgFee: '15.00', chgTotal: '100' },
  pinned: pinnedOf('120.00', '60.00', '15.00') });
console.log('   verdict=' + r3.verdict + '  divergences=' + JSON.stringify(r3.divergences));
check(r3.verdict === 'REJECT_TAMPER', '篡改合计 → REJECT_TAMPER');
check(r3.divergences.some((d) => d.field.endsWith('chgTotal') && d.kind === 'computed'), '分歧定位到 chgTotal（kind=computed）');

console.log('\n' + (pass ? '✅ BFF 多字段计费防篡改 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
