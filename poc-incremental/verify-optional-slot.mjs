// 验证 slot optional：adviseThrough 声明 optional 后——
//   空→不报内部必填；applicant(必填)空→报必填；adviseThrough 填了→内部必填恢复生效。
import { readFileSync } from 'fs';
import { createSession } from './src/incremental.js';
import { makeFxService } from './src/fx-service.js';

const J = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url)));
const rules = J('./lc-rules.json'), data = J('./lc-data.json');
const fx = J('./commonFx.json'), party = J('./commonParty.json');
const imports = { [`${fx.ruleSetId}@${fx.version}`]: fx, [`${party.ruleSetId}@${party.version}`]: party };

let pass = true;
const check = (ok, msg, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + msg + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(62) + '\n' + t + '\n' + '═'.repeat(62));
const run = async (mut) => { const d = structuredClone(data); mut(d); const s = createSession(rules, d, { resolve: makeFxService({ delay: 5 }), imports }); await s.idle(); return s.getState(); };
const failsAt = (st, node) => st.validations.filter((v) => v.node === node && v.state === 'resolved' && !v.ok).map((v) => v.id).sort();

banner('T1  adviseThrough 置空对象 {} → 其内部必填全部跳过（可选）');
let st = await run((d) => { d.adviseThrough = {}; });
const advFails = failsAt(st, 'root.adviseThrough');
console.log('  adviseThrough 失败校验:', advFails.join(', ') || '(无)');
check(!advFails.includes('partyName') && !advFails.includes('partyCountry') && !advFails.includes('bankBicReq'),
  '空的可选 adviseThrough 无 partyName/partyCountry/bankBicReq 失败');

banner('T2  applicant(必填) 置空 → partyName 仍失败（必填不受影响）');
st = await run((d) => { d.applicant = {}; });
const appFails = failsAt(st, 'root.applicant');
console.log('  applicant 失败校验:', appFails.join(', ') || '(无)');
check(appFails.includes('partyName'), '空的必填 applicant 触发 partyName（当事方名称必填）');

banner('T3  adviseThrough 只填 name → 存在即必填：partyCountry / bankBicReq 恢复失败');
st = await run((d) => { d.adviseThrough = { name: 'Some Bank' }; });
const adv3 = failsAt(st, 'root.adviseThrough');
console.log('  adviseThrough 失败校验:', adv3.join(', ') || '(无)');
check(adv3.includes('partyCountry') && adv3.includes('bankBicReq') && !adv3.includes('partyName'),
  '填了 name 后 partyCountry/bankBicReq 生效、partyName 通过');

banner('T4  回归：默认数据（adviseThrough 已填 Commerzbank）全绿 + net 不变');
st = await run(() => {});
const all = st.validations.filter((v) => v.state === 'resolved' && !v.ok);
const net = st.tree.fields.net.value;
console.log('  失败校验数:', all.length, ' net =', net);
check(all.length === 0, '默认数据无失败校验');
check(net === '82203.22', 'net 仍为 82203.22（计算未受影响）');

console.log('\n' + (pass ? '✅ slot optional 全部通过' : '❌ 有断言失败'));
process.exit(pass ? 0 : 1);
