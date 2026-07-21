// 多字段取数验证（chargeService 一次返回 base/tax/fee → 摊到多字段 + 本地汇总）
//   证明：① pick 把一个对象响应摊到三个 external 字段 ② total 本地公式汇总
//        ③ pending→resolved 异步语义 ④ 每个输出各自 emit pinned（供中台核对）
//        ⑤ 改输入 → key 变 → 重新取数、下游随动 ⑥ 宿主 resolve 记忆化：3 个 pick = 1 次真实调用
import { readFileSync } from 'node:fs';
import { createSession } from './src/incremental.js';

const commonCharge = JSON.parse(readFileSync(new URL('./commonCharge.json', import.meta.url)));

// 宿主规则集：import commonCharge，Deal 上 uses chargeCalc，produce 到宿主字段
const HOST = {
  ruleSetId: 'chargeDemo', version: '1.0.0',
  imports: [{ ref: 'commonCharge@1.0.0', as: 'cc' }],
  context: { valueDate: 'root.bizDate' },
  model: { root: 'Deal', nodes: {
    Deal: { fields: {
      bizDate: { type: 'date' },
      productType: { type: 'string' },
      amount: { type: 'decimal' },
      tier: { type: 'string' },
      chgBase: { type: 'decimal', external: true },
      chgTax:  { type: 'decimal', external: true },
      chgFee:  { type: 'decimal', external: true },
      chgTotal: { type: 'decimal', computed: true },
    } },
  } },
  uses: [
    { use: 'cc.chargeCalc', on: 'Deal', as: 'chg',
      bind: { productType: 'productType', amount: 'amount', tier: 'tier' },
      produce: { base: 'chgBase', tax: 'chgTax', fee: 'chgFee', total: 'chgTotal' } },
  ],
};
const DATA = { bizDate: '2026-07-21', productType: 'LC', amount: '10000', tier: 'gold', chgBase: '', chgTax: '', chgFee: '', chgTotal: '' };

// —— 后台 chargeService 的“权威”模拟：一次返回多字段对象；宿主按 (source,key) 记忆化 ——
let apiCalls = 0;
const cache = new Map();
const chargeApi = (key) => {                          // 纯函数：同 key → 同结果（引擎“稳态=输入纯函数”前提）
  const a = Number(key.amount);
  const tierMul = key.tier === 'gold' ? 1.2 : 1;
  return { base: (a * 0.01 * tierMul).toFixed(2), tax: (a * 0.006).toFixed(2), fee: '15.00' };
};
const resolve = (source, key) => {
  if (source !== 'chargeService') return Promise.reject(new Error('未知源 ' + source));
  const k = JSON.stringify(key);
  if (!cache.has(k)) { apiCalls++; cache.set(k, chargeApi(key)); }   // 记忆化：3 个 pick 命中同 key → 1 次真实调用
  const values = cache.get(k);
  return new Promise((r) => setTimeout(() => r({ values, asOf: 'srv', rateId: 'chg_' + k.length }), 30));
};

let pass = true;
const check = (ok, msg, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + msg + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));

const s = createSession(HOST, structuredClone(DATA), { resolve, imports: { 'commonCharge@1.0.0': commonCharge } });

banner('1) 取数前：pending（异步挂起）');
check(s.getState().anyPending === true, '结算未完成时 anyPending = true');

await s.idle();
let st = s.getState();
const f = st.tree.fields;

banner('2) 一次对象响应摊到三个字段 + 本地汇总 total');
// amount=10000, gold → base=10000*0.01*1.2=120.00, tax=10000*0.006=60.00, fee=15.00, total=195.00
check(f.chgBase.value === '120', 'chgBase = 120.00（pick base）', ' → ' + f.chgBase.value);
check(f.chgTax.value === '60', 'chgTax = 60.00（pick tax）', ' → ' + f.chgTax.value);
check(f.chgFee.value === '15', 'chgFee = 15.00（pick fee）', ' → ' + f.chgFee.value);
check(f.chgTotal.value === '195', 'chgTotal = 195.00（本地 base+tax+fee）', ' → ' + f.chgTotal.value);

banner('3) 宿主 resolve 记忆化：3 个 pick 只打了 1 次真实 API');
check(apiCalls === 1, '真实 API 调用次数 = 1', ' → ' + apiCalls);

banner('4) 每个输出各自 emit pinned（带 pick，供中台按 key 重核）');
const pins = st.pinned.filter((p) => p.source === 'chargeService');
check(pins.length === 3, 'chargeService pinned 条数 = 3', ' → ' + pins.length);
check(pins.every((p) => p.pick && p.key), '每条 pinned 都带 pick + key', ' → ' + JSON.stringify(pins.map((p) => p.pick)));

banner('5) 改输入 → key 变 → 重新取数、下游随动');
s.setInput('root.amount', '20000');
await s.idle();
st = s.getState();
const g = st.tree.fields;
// amount=20000, gold → base=240.00, tax=120.00, fee=15.00, total=375.00
check(g.chgBase.value === '240', 'chgBase → 240.00', ' → ' + g.chgBase.value);
check(g.chgTotal.value === '375', 'chgTotal → 375.00', ' → ' + g.chgTotal.value);
check(apiCalls === 2, '新 key → 第 2 次真实 API', ' → ' + apiCalls);

banner('6) 改 tier（也在 key 里）→ 再取数');
s.setInput('root.tier', 'silver');
await s.idle();
const h = s.getState().tree.fields;
// amount=20000, silver → base=20000*0.01*1=200.00, tax=120.00, fee=15.00, total=335.00
check(h.chgBase.value === '200', 'silver → chgBase 200.00', ' → ' + h.chgBase.value);
check(h.chgTotal.value === '335', 'silver → chgTotal 335.00', ' → ' + h.chgTotal.value);

console.log('\n' + (pass ? '✅ 多字段取数 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
