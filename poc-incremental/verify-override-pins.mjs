// 验证「先反推 override → 再取回 pin(汇率) → 再重算校验」的正确加载序列。
//   模型仿 orderSet：fxConvert 模块 produce rate/conv；finalAmt=trxAmt*0.5；nego=finalAmt(可覆盖)。
//   关键：nego 被人工改成与 finalAmt 不同 → 存盘。重新加载时应识别为 override，且不因“外部依赖”被跳过。
import { readFileSync } from 'node:fs';
import { createSession } from './src/incremental.js';

const commonFx = JSON.parse(readFileSync(new URL('./commonFx.json', import.meta.url)));

const HOST = {
  ruleSetId: 'ovrPinDemo', version: '1.0.0',
  imports: [{ ref: 'commonFx@1.0.0', as: 'commonFx' }],
  context: { valueDate: 'root.bizDate' },
  model: { root: 'Deal', nodes: {
    Deal: { fields: {
      bizDate: { type: 'date' },
      localCCY: { type: 'string' }, trxCCY: { type: 'string' },
      base: { type: 'decimal' },
      fxRate: { type: 'decimal', external: true },
      trxAmt: { type: 'decimal', external: true },
      finalAmt: { type: 'decimal', computed: true },
      nego: { type: 'decimal', computed: true, overridable: true },
    } },
  } },
  uses: [
    { use: 'commonFx.fxConvert', on: 'Deal', as: 'm',
      bind: { amount: 'base', fromCcy: 'localCCY', toCcy: 'trxCCY' },
      produce: { rate: 'fxRate', conv: 'trxAmt' } },
  ],
  rules: [
    { id: 'rFinal', type: 'formula', scope: 'Deal', target: 'finalAmt', expr: 'round(trxAmt * 0.5, 2)' },
    { id: 'rNego', type: 'formula', scope: 'Deal', target: 'nego', expr: 'finalAmt' },
    { id: 'vNego', type: 'validation', scope: 'Deal', expr: 'nego <= finalAmt', message: '议价 {nego} 不能高于 {finalAmt}', severity: 'error' },
  ],
};
const CLEAN = { bizDate: '2026-07-20', localCCY: 'USD', trxCCY: 'CNY', base: '1840000' };
const RATE = '7.1234';   // base 1840000 * 7.1234 = 13107056; finalAmt = 6553528
const resolve = (source, key) => new Promise((r) => setTimeout(() => r({ value: RATE, asOf: 'srv', rateId: 'fx' }), 20));
const imports = { 'commonFx@1.0.0': commonFx };

let pass = true;
const check = (ok, m, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + m + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(64) + '\n' + t + '\n' + '═'.repeat(64));

// ── 阶段 1：建会话 → 结算 → 人工覆盖 nego → 存盘（treeToData + pinned）──
banner('准备：算出基线并人工覆盖 nego（6553528 → 6553520），再存盘');
const A = createSession(HOST, structuredClone(CLEAN), { resolve, imports });
await A.idle();
let a = A.getState().tree.fields;
console.log('  基线 finalAmt =', a.finalAmt.value, ' nego =', a.nego.value, ' fxRate =', a.fxRate.value);
A.setOverride('root.nego', '6553520');
await A.idle();
const stA = A.getState();
const savedData = treeToData(stA.tree);
const savedPins = stA.pinned.map((p) => ({ field: p.field, value: p.value }));
console.log('  存盘 nego =', savedData.nego, ' | pins =', JSON.stringify(savedPins));
check(savedData.nego === '6553520', '存盘 nego = 6553520（覆盖值）');
check(savedPins.some((p) => p.value === RATE), 'pinned 含汇率', ' → ' + JSON.stringify(savedPins));

// ── 阶段 2：重新加载 → 先反推 override（种回存盘汇率）──
banner('阶段A：加载后先反推 override（用存盘 pin 汇率，不跳外部依赖字段）');
const B = createSession(HOST, structuredClone(savedData), { resolve, imports });
const applied = B.reconstructOverrides(structuredClone(savedData), { pins: savedPins });  // 同步，此刻在途取数未回
let b = B.getState().tree.fields;
console.log('  反推得到的覆盖字段:', JSON.stringify(applied));
console.log('  nego =', b.nego.value, '(', b.nego.state, ') | finalAmt =', b.finalAmt.value, '(', b.finalAmt.state, ')');
check(applied.includes('root.nego'), 'nego 被识别为 override（外部依赖也能反推）');
check(!applied.includes('root.finalAmt'), 'finalAmt 未被误判为 override（存盘汇率下 存=算）');
check(b.nego.value === '6553520' && b.nego.state === 'overridden', 'nego = 6553520 且 state=overridden');

// ── 阶段 3：在途取数返回（重新获取 pin 汇率）→ 重算 + 校验 ──
banner('阶段B：在途取数返回权威汇率 → 重算 → 覆盖保留 + 校验重跑');
await B.idle();
const stB = B.getState();
b = stB.tree.fields;
console.log('  取数后 fxRate =', b.fxRate.value, ' finalAmt =', b.finalAmt.value, ' nego =', b.nego.value, '(', b.nego.state, ')');
check(b.fxRate.value === RATE, 'fxRate 已取回权威值');
check(b.nego.value === '6553520' && b.nego.state === 'overridden', '覆盖在重算后仍保留 = 6553520');
check(b.finalAmt.value === '6553528', 'finalAmt 按权威汇率重算 = 6553528');
const vNego = stB.validations.find((v) => v.id === 'vNego');
console.log('  校验 vNego:', JSON.stringify(vNego));
check(vNego && vNego.state === 'resolved' && vNego.ok === true, '校验已重跑：nego(6553520) ≤ finalAmt(6553528) 通过');

console.log('\n' + (pass ? '✅ 反推→取pin→重算校验 序列 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);

// treeToData 简版（含计算值），仅本测试用
function treeToData(node) {
  const o = {};
  for (const [f, c] of Object.entries(node.fields)) o[f] = c.value;
  for (const [name, arr] of Object.entries(node.collections)) o[name] = arr.map(treeToData);
  for (const [name, sn] of Object.entries(node.slots)) o[name] = treeToData(sn);
  return o;
}
