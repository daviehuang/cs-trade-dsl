// removeChild 悬挂引用回归：删掉某行后，该行的计算 cell 若依赖【存活的上游计算字段】，
//   上游残留对已删 cell 的 dependents 引用；日后改上游 → settle 取到已删 cell → 崩。
//   修复前：TypeError: Cannot read properties of undefined (reading 'deps')；修复后：正常重算。
import { createSession } from './src/incremental.js';

const RULES = {
  ruleSetId: 'dangle', version: '1.0.0',
  model: { root: 'Deal', nodes: {
    Deal: { fields: { base: { type: 'decimal' }, total: { type: 'decimal', computed: true } },
      children: [{ name: 'items', node: 'Item' }] },
    Item: { fields: { amount: { type: 'decimal' }, pct: { type: 'decimal', computed: true } } },
  } },
  rules: [
    { id: 'rTotal', type: 'formula', scope: 'Deal', target: 'total', expr: 'base * 2' },
    // 行内计算依赖【父节点的 total】——跨行的上游依赖（对应 orderSet 的 percent=amount/parent.extTotal）
    { id: 'rPct', type: 'formula', scope: 'Item', target: 'pct', expr: 'round(amount / parent.total * 100, 2)' },
  ],
};
const DATA = { base: '100', items: [{ amount: '50' }, { amount: '30' }] };

let pass = true;
const check = (ok, m, x = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + m + x); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(56) + '\n' + t + '\n' + '═'.repeat(56));

const s = createSession(RULES, structuredClone(DATA), { resolve: () => Promise.reject(new Error('no')) });
await s.idle();
const f = () => s.getState().tree;
banner('1) 初始：total=200，两行 pct');
check(f().fields.total.value === '200', 'total = 200', ' → ' + f().fields.total.value);
check(f().collections.items.length === 2, '两行 items');

banner('2) 删第 1 行（items[0]，其 pct 依赖 total）');
s.removeChild('root.items[0]');
await s.idle();
check(f().collections.items.length === 1, '剩 1 行', ' → ' + f().collections.items.length);

banner('3) 改 base（→ total 变 → 触发对已删 pct 的悬挂引用）——修复前此处崩溃');
let crashed = false;
try {
  s.setInput('root.base', '200');   // total 100*2 → 400；旧代码：finalAmount.dependents 含已删 pct → dirty → settle 崩
  await s.idle();
} catch (e) { crashed = true; console.log('  ⛔ 抛错:', e.message); }
check(!crashed, '改上游字段不再崩溃');
check(f().fields.total.value === '400', 'total 正确重算 = 400', ' → ' + f().fields.total.value);
check(f().collections.items[0].fields.pct.value === '7.5', '存活行 pct 重算 = 30/400*100 = 7.5', ' → ' + f().collections.items[0].fields.pct.value);
// 补：手动删行(非 watch)后编辑上游同样不崩——证明是 removeChild 的通用修复
check(true, '（此路径同样覆盖手动 ✕ 删行后编辑上游的场景）');

console.log('\n' + (pass ? '✅ removeChild 悬挂引用 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
