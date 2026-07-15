// 动态 BFF 校验验证：BFF 按提交的 ruleSetId 运行时从仓库拉规则并校验（不写死某套规则）。
//   依赖 store-server 在 :8788 运行（node store-server.js）。
import { validateSubmission } from './bff/validate.js';

let pass = true;
const check = (ok, m, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + m + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(64) + '\n' + t + '\n' + '═'.repeat(64));

// orderSet 提交树（只放输入；计算值不提交 → compare 跳过，专测动态加载 + 校验 + 篡改）
const orderTree = (buyer, extra = {}) => ({
  orderName: 'PO-1', orderDate: '2026-07-14', localCCY: 'USD', trxCCY: 'CNY',
  goodsInfo: [{ name: 'a', quantity: '2', price: '100' }],
  buyer, ...extra,
});
const goodBuyer = { name: '甲方公司', address: '上海', country: 'CN', taxId: 'T-123', contactPerson: '张三' };

banner('1) orderSet · 输入合法 + 当事方齐全 → ACCEPT（用 orderSet 规则动态校验）');
const r1 = await validateSubmission({ ruleSetId: 'orderSet', tree: orderTree(goodBuyer) });
console.log('   verdict=' + r1.verdict + '  用规则=' + r1.ruleSetId + '  serverComputed=' + JSON.stringify(r1.serverComputed));
check(r1.ruleSetId === 'orderSet', '回显用的是 orderSet 规则');
check('finalAmount' in r1.serverComputed && 'trxOrderAmt' in r1.serverComputed, 'serverComputed 动态含 orderSet 的计算字段（非写死 chargeTotal/net）');
check(r1.verdict === 'ACCEPT', '未篡改 + 校验通过 → ACCEPT');

banner('2) orderSet · 当事方名称为空 → REJECT_VALIDATION（import 的 commonParty 校验动态生效）');
const r2 = await validateSubmission({ ruleSetId: 'orderSet', tree: orderTree({ ...goodBuyer, name: '' }) });
const nameFail = r2.validations.find((v) => v.state === 'resolved' && !v.ok);
console.log('   verdict=' + r2.verdict + '  失败校验=' + (nameFail ? nameFail.id + '@' + nameFail.node : '(无)'));
check(r2.verdict === 'REJECT_VALIDATION', '当事方名称空 → REJECT_VALIDATION');

banner('3) orderSet · 篡改计算值 finalAmount → REJECT_TAMPER');
const r3 = await validateSubmission({ ruleSetId: 'orderSet', tree: orderTree(goodBuyer, { finalAmount: '999999' }) });
console.log('   verdict=' + r3.verdict + '  篡改=' + JSON.stringify(r3.divergences.map((d) => d.field + ':' + d.client + '≠' + d.server)));
check(r3.verdict === 'REJECT_TAMPER', '篡改 finalAmount → REJECT_TAMPER');
check(r3.divergences.some((d) => d.field.endsWith('.finalAmount')), 'divergence 指向 finalAmount');

banner('4) lcSettlement · 向后兼容（同一个动态 BFF 也能校验旧规则集）');
try {
  const r4 = await validateSubmission({ ruleSetId: 'lcSettlement', tree: {} });
  console.log('   verdict=' + r4.verdict + '  用规则=' + r4.ruleSetId + '  serverComputed 键=' + Object.keys(r4.serverComputed).join(','));
  check(r4.ruleSetId === 'lcSettlement', 'lcSettlement 也走同一动态路径');
  check(['ACCEPT', 'REJECT_TAMPER', 'REJECT_VALIDATION'].includes(r4.verdict), 'lcSettlement 返回合法裁决（不崩溃）');
} catch (e) { check(false, 'lcSettlement 校验异常', ': ' + e.message); }

banner('5) 缺 ruleSetId → 明确报错（无法确定用哪套规则）');
try { await validateSubmission({ tree: orderTree(goodBuyer) }); check(false, '应抛错'); }
catch (e) { check(/ruleSetId/.test(e.message), '缺 ruleSetId 抛出清晰错误', ': ' + e.message); }

console.log('\n' + (pass ? '✅ 动态 BFF 校验 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
