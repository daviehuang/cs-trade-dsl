// treeToData 往返验证：把引擎实时树 → 普通数据对象（含 fields + collections + slots），
//   重新 createSession(rules, data) 复原、reconstructOverrides 反推非外部覆盖 → 值一致。
//   这里用 JS 复刻 ui-kit-core/src/engine-shared.ts 的 treeToData（同一算法）以直接跑引擎单源。
import { createSession } from './src/incremental.js';

function treeToData(node) {
  const o = {};
  for (const [f, c] of Object.entries(node.fields)) o[f] = c.value;
  for (const [coll, arr] of Object.entries(node.collections)) o[coll] = arr.map(treeToData);
  for (const [slot, sn] of Object.entries(node.slots)) o[slot] = treeToData(sn);
  return o;
}

// 模型：根含 一个 slot（party）+ 一个 collection（lines）+ 计算字段 discount（可覆盖、纯计算）。
const RULES = {
  ruleSetId: 'treeData', version: '1.0.0',
  model: { root: 'Order', nodes: {
    Order: {
      fields: { qty: { type: 'decimal' }, price: { type: 'decimal' },
        discount: { type: 'decimal', computed: true, overridable: true } },
      slots: { party: 'Party' },
      children: [{ name: 'lines', node: 'Line' }],
    },
    Party: { fields: { name: { type: 'string' } } },
    Line: { fields: { sku: { type: 'string' }, amt: { type: 'decimal' } } },
  } },
  rules: [
    { id: 'disc', type: 'formula', scope: 'Order', target: 'discount', expr: 'round(qty * price * 0.1, 2)' },
  ],
};

// 已填数据：discount 被人工覆盖为 999（计算值应为 10*100*0.1=100）
const DATA = {
  qty: '10', price: '100', discount: '999',
  party: { name: '甲方公司' },
  lines: [{ sku: 'A-1', amt: '50' }, { sku: 'B-2', amt: '70' }],
};

let pass = true;
const check = (ok, m) => { console.log((ok ? '  ✅ ' : '  ❌ ') + m); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));

banner('1) treeToData 捕获 fields + slots + collections');
const s1 = createSession(RULES, structuredClone(DATA), { resolve: () => Promise.resolve({ value: '' }) });
s1.reconstructOverrides(structuredClone(DATA), { skipExternalDependent: true });
await s1.idle();
const d1 = treeToData(s1.getState().tree);
console.log('  导出 =', JSON.stringify(d1));
check(d1.party?.name === '甲方公司', 'slot party.name 被导出（buildSubmitTree 曾漏 slot）');
check(Array.isArray(d1.lines) && d1.lines.length === 2, 'collection lines 两行被导出');
check(d1.lines[0].sku === 'A-1' && d1.lines[1].amt === '70', 'collection 行内字段正确');
check(d1.discount === '999', 'discount 导出的是覆盖值 999（reconstructOverrides 生效）');

banner('2) 往返：用导出数据重建 session → 值一致');
const s2 = createSession(RULES, structuredClone(d1), { resolve: () => Promise.resolve({ value: '' }) });
s2.reconstructOverrides(structuredClone(d1), { skipExternalDependent: true });
await s2.idle();
const st2 = s2.getState().tree;
check(st2.slots.party.fields.name.value === '甲方公司', '重建后 slot party.name 复原');
check(st2.collections.lines.length === 2, '重建后 collection lines 复原两行');
check(st2.fields.discount.value === '999' && st2.fields.discount.state === 'overridden',
  '重建后 discount = 999（overridden，从值反推）');

const d2 = treeToData(st2);
check(JSON.stringify(d1) === JSON.stringify(d2), '二次导出与一次导出完全一致（幂等往返）');

console.log('\n' + (pass ? '✅ treeToData 往返 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
