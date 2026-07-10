// 从"已存字段值"重建覆盖态（不单独持久化 override 列表）验证：
//   非外部依赖 + 可覆盖 + 存值≠重算值 → 反推为覆盖；外部依赖字段（依赖 resolver）→ 跳过；锁死分支 → 跳过。
import { createSession } from './src/incremental.js';

const RULES = {
  ruleSetId: 'reconDemo', version: '1.0.0',
  model: { root: 'Deal', nodes: { Deal: { fields: {
    qty:   { type: 'decimal' }, price: { type: 'decimal' }, fromCcy: { type: 'string' }, mode: { type: 'string' },
    fxRate:      { type: 'decimal', external: true },
    amountLocal: { type: 'decimal', computed: true, overridable: true },   // = qty*price*fxRate（依赖外部汇率）
    discount:    { type: 'decimal', computed: true },                      // cases：none 锁死 / else 可覆盖（纯计算）
  } } } },
  rules: [
    { id: 'fx',   type: 'resolver', scope: 'Deal', target: 'fxRate', source: 'fxRate', key: { from: 'fromCcy' } },
    { id: 'amt',  type: 'formula',  scope: 'Deal', target: 'amountLocal', expr: 'round(qty * price * fxRate, 2)' },
    { id: 'disc', type: 'formula',  scope: 'Deal', target: 'discount', cases: [
        { when: 'mode == "none"', expr: '0' },                             // 锁死
        { expr: 'round(qty * price * 0.1, 2)', overridable: true },        // else 可覆盖（纯计算，不依赖 fx）
    ] },
  ],
};
// 已存数据：含被覆盖后的字段值（amountLocal 存 88888，discount 存 50），mode=manual 命中 else
const DATA = { qty: '10', price: '100', fromCcy: 'USD', mode: 'manual', fxRate: '', amountLocal: '88888', discount: '50' };
const resolve = () => Promise.resolve({ value: '7', asOf: 'x', rateId: 'x' });   // fxRate = 7

const resolveField = (st, f) => st.tree.fields[f];
let pass = true;
const check = (ok, m, x = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + m + x); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));

banner('1) 加载后重建覆盖态：非外部字段反推、外部字段跳过');
const s = createSession(RULES, structuredClone(DATA), { resolve });
await s.idle();
// 重建前：引擎按公式重算，忽略存值
const before = s.getState();
console.log('  重建前：discount =', resolveField(before, 'discount').value, '（纯计算=100）；amountLocal =', resolveField(before, 'amountLocal').value, '（=10*100*7=7000）');
check(resolveField(before, 'discount').value === '100', '重建前 discount 回落计算值 100');
check(resolveField(before, 'amountLocal').value === '7000', '重建前 amountLocal 回落计算值 7000');

const applied = s.reconstructOverrides(structuredClone(DATA), { skipExternalDependent: true });
await s.idle();
const after = s.getState();
console.log('\n  重建结果 applied =', JSON.stringify(applied));
check(applied.includes('root.discount'), 'discount 被反推为覆盖（非外部依赖、存值 50≠100）');
check(!applied.includes('root.amountLocal'), 'amountLocal 未反推（外部依赖 fxRate → 跳过）');
check(resolveField(after, 'discount').value === '50' && resolveField(after, 'discount').state === 'overridden', '重建后 discount = 50（overridden）');
check(resolveField(after, 'amountLocal').value === '7000', '重建后 amountLocal 仍 = 7000（计算值，未被存值 88888 污染）');

banner('2) 锁死分支不反推');
const d2 = { ...structuredClone(DATA), mode: 'none', discount: '50' };   // none → 锁死分支
const s2 = createSession(RULES, structuredClone(d2), { resolve });
await s2.idle();
const applied2 = s2.reconstructOverrides(structuredClone(d2), { skipExternalDependent: true });
await s2.idle();
check(!applied2.includes('root.discount'), 'mode=none（锁死）→ discount 不反推');
check(resolveField(s2.getState(), 'discount').value === '0', '锁死分支 discount = 0（计算值，忽略存值 50）');

console.log('\n' + (pass ? '✅ 重建覆盖态 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
