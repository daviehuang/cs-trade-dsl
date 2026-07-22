// 模块规则支持 cases（多分支）+ pipeline（多步）验证。
//   模块 tier：按 amount 分档算折扣率(cases)；再用 pipeline 分步算净额（含中间量）。
import { createSession } from './src/incremental.js';

const LIB = {
  ruleSetId: 'commonTier', version: '1.0.0',
  modules: {
    tierCalc: {
      moduleId: 'tierCalc', version: '1.0.0',
      inputs: { amount: 'decimal' },
      fields: {
        rate:  { type: 'decimal', computed: true },   // cases 分档
        net:   { type: 'decimal', computed: true },   // pipeline 多步
      },
      rules: [
        // cases：>=100000 → 0.3；>=10000 → 0.2；else → 0.1
        { id: 'rRate', type: 'formula', target: 'rate', cases: [
          { when: 'amount >= 100000', expr: '0.3' },
          { when: 'amount >= 10000', expr: '0.2' },
          { expr: '0.1' },
        ] },
        // pipeline：step1 折扣额 = amount*rate；step2 = 上一步四舍五入；step3 净额 = amount - 上一步
        { id: 'rNet', type: 'pipeline', target: 'net', steps: [
          { expr: 'amount * rate' },
          { expr: 'round(value, 2)' },
          { expr: 'amount - value' },
        ] },
      ],
      outputs: ['rate', 'net'],
    },
  },
};

const HOST = {
  ruleSetId: 'tierDemo', version: '1.0.0',
  imports: [{ ref: 'commonTier@1.0.0', as: 'ct' }],
  model: { root: 'Deal', nodes: { Deal: { fields: {
    amount: { type: 'decimal' },
    dRate:  { type: 'decimal', computed: true },
    dNet:   { type: 'decimal', computed: true },
  } } } },
  uses: [
    { use: 'ct.tierCalc', on: 'Deal', as: 'm', bind: { amount: 'amount' }, produce: { rate: 'dRate', net: 'dNet' } },
  ],
};

let pass = true;
const check = (ok, m, x = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + m + x); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));
const imports = { 'commonTier@1.0.0': LIB };
const run = async (amount) => { const s = createSession(HOST, { amount }, { resolve: () => Promise.reject(new Error('no')), imports }); await s.idle(); return s.getState().tree.fields; };

banner('1) cases 分档（模块 formula 多分支）');
let f = await run('200000');   // >=100000 → rate 0.3
check(f.dRate.value === '0.3', 'amount 200000 → rate 0.3', ' → ' + f.dRate.value);
f = await run('50000');        // >=10000 → 0.2
check(f.dRate.value === '0.2', 'amount 50000 → rate 0.2', ' → ' + f.dRate.value);
f = await run('5000');         // else → 0.1
check(f.dRate.value === '0.1', 'amount 5000 → rate 0.1（else 分支）', ' → ' + f.dRate.value);

banner('2) pipeline 多步（模块 pipeline，隐式 value=上一步）');
f = await run('50000');   // rate 0.2 → step1 10000 → step2 10000.00 → step3 net = 50000-10000 = 40000
check(f.dNet.value === '40000', 'amount 50000 → net 40000（= 50000 - round(50000*0.2)）', ' → ' + f.dNet.value);
f = await run('200000');  // rate 0.3 → 折扣 60000 → net 140000
check(f.dNet.value === '140000', 'amount 200000 → net 140000', ' → ' + f.dNet.value);

banner('3) 增量：改 amount → 分档与管道联动');
const s = createSession(HOST, { amount: '5000' }, { resolve: () => Promise.reject(new Error('no')), imports });
await s.idle();
let g = s.getState().tree.fields;
check(g.dRate.value === '0.1' && g.dNet.value === '4500', '初始 5000 → rate 0.1 / net 4500', ' → ' + g.dRate.value + '/' + g.dNet.value);
s.setInput('root.amount', '200000');
await s.idle();
g = s.getState().tree.fields;
check(g.dRate.value === '0.3' && g.dNet.value === '140000', '改 200000 → rate 0.3 / net 140000（分档+管道随动）', ' → ' + g.dRate.value + '/' + g.dNet.value);

console.log('\n' + (pass ? '✅ 模块 cases + pipeline 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
