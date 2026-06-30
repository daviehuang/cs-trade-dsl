// 跨框架验证（框架无关的真值）：
//   1) 引擎对账：用 lc-rules + 数据 + resolver 建会话，idle 后导出计算值/校验 —— Angular 与 React UI 都必须等于它。
//   2) 编辑器产物有效性：模拟编辑器"加计算字段 + 加 formula"，确认引擎接受并算出 —— 证明编辑器输出是 engine-valid。
import { readFileSync } from 'fs';
import { createSession } from './src/incremental.js';
import { makeFxService } from './src/fx-service.js';

const J = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url)));
const rules = J('./lc-rules.json'), data = J('./lc-data.json');
const fx = J('./commonFx.json'), party = J('./commonParty.json');
const imports = { [`${fx.ruleSetId}@${fx.version}`]: fx, [`${party.ruleSetId}@${party.version}`]: party };

// 与 ui-kit-core/engine-shared 同款路径解析
const resolveCell = (state, path) => {
  const toks = path.split('.');
  let node = state.tree;
  for (let k = 1; k < toks.length; k++) {
    const tok = toks[k], m = tok.match(/^(\w+)\[(\d+)\]$/);
    if (m) { node = node?.collections[m[1]]?.[+m[2]]; continue; }
    if (node?.slots?.[tok]) { node = node.slots[tok]; continue; }
    const i = path.lastIndexOf('.'); return node?.fields[path.slice(i + 1)];
  }
  return undefined;
};

let pass = true;
const check = (ok, msg, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + msg + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));

// ── 1) 引擎对账（真值）──────────────────────────────────────────────
banner('1) 引擎对账：UI（Angular/React）都必须等于这些值');
const s = createSession(rules, structuredClone(data), { resolve: makeFxService({ delay: 5 }), imports });
await s.idle();
const st = s.getState();
const v = (p) => resolveCell(st, p)?.value;
console.log('  净额 net          =', v('root.net'));
console.log('  收费合计 chargeTotal =', v('root.chargeTotal'));
console.log('  付费合计 paymentTotal =', v('root.paymentTotal'));
console.log('  charges[0].items[0].base =', v('root.charges[0].items[0].base'));
check(v('root.net') === '82203.22', 'net = 82203.22');
check(v('root.chargeTotal') === '132492.2', 'chargeTotal = 132492.2');
check(v('root.paymentTotal') === '63538.2', 'paymentTotal = 63538.2');
check(v('root.charges[0].items[0].base') === '71234', 'charges[0].items[0].base = 71234');
const fails = st.validations.filter((x) => x.state === 'resolved' && !x.ok);
check(fails.length === 0, '初始无失败校验（' + fails.length + ' 个失败）');
const hasScreen = st.validations.some((x) => x.id === 'screen.notSanctioned' && x.node.includes('advisingBank'));
check(hasScreen, 'commonParty 银行制裁筛查模块挂到银行槽位（screen.notSanctioned）');

// ── 2) 编辑器产物有效性：加字段 + 加 formula → 引擎算出 ─────────────────
banner('2) 编辑器产物：加计算字段 vatTotal + formula vatCalc，引擎须算出 7949.53');
const edited = structuredClone(rules);
edited.model.nodes.LetterOfCredit.fields.vatTotal = { type: 'decimal', computed: true };
edited.rules.push({ id: 'vatCalc', type: 'formula', scope: 'LetterOfCredit', trigger: 'calc', target: 'vatTotal', expr: 'round(chargeTotal * 0.06, 2)' });
const s2 = createSession(edited, structuredClone(data), { resolve: makeFxService({ delay: 5 }), imports });
await s2.idle();
const vat = resolveCell(s2.getState(), 'root.vatTotal')?.value;
console.log('  vatTotal =', vat, '（= round(132492.2 * 0.06, 2)）');
check(vat === '7949.53', '编辑器加的 formula 被引擎接受并算出 vatTotal = 7949.53');

// 加一条 validation 并触发它
const edited2 = structuredClone(edited);
edited2.rules.push({ id: 'vatLimit', type: 'validation', scope: 'LetterOfCredit', trigger: 'after-calc', expr: 'vatTotal <= 5000', severity: 'error', message: '增值税 {vatTotal} 超 5000' });
const s3 = createSession(edited2, structuredClone(data), { resolve: makeFxService({ delay: 5 }), imports });
await s3.idle();
const vl = s3.getState().validations.find((x) => x.id === 'vatLimit');
check(vl && vl.state === 'resolved' && !vl.ok, '编辑器加的 validation 被引擎执行并触发：' + (vl && vl.message));

console.log('\n' + (pass ? '✅ 跨框架验证全部通过（引擎真值 + 编辑器产物 engine-valid）' : '❌ 有断言失败'));
process.exit(pass ? 0 : 1);
