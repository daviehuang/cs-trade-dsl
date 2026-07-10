// 分支级可覆盖（per-case overridable）引擎验证：
//   一个 formula，cases = [ auto-high 锁死, else 可覆盖 ]。
//   锁死分支：setOverride 抛错、值=expr、overridable=false；可覆盖分支：setOverride 成功、可 clear、overridable=true。
import { createSession } from './src/incremental.js';

const RULES = {
  ruleSetId: 'ovrDemo', version: '1.0.0',
  model: { root: 'Deal', nodes: { Deal: { fields: {
    chargeTotal: { type: 'decimal' },
    adjustMode:  { type: 'string' },
    adjustment:  { type: 'decimal', computed: true },   // 注意：字段级并未 overridable，仅靠 case 级
  } } } },
  rules: [
    { id: 'adj', type: 'formula', scope: 'Deal', target: 'adjustment',
      cases: [
        { when: 'adjustMode == "auto-high"', expr: 'round(chargeTotal * 0.5, 2)' },   // 锁死
        { expr: 'round(chargeTotal * 0.2, 2)', overridable: true },                    // else：计算默认值 + 可覆盖
      ] },
  ],
};
const DATA = { chargeTotal: '1000', adjustMode: 'auto-high', adjustment: '' };

// 路径解析（同其它 verify）
const resolveCell = (st, path) => {
  const i = path.lastIndexOf('.'); const node = st.tree; // 仅根字段，简化
  return node.fields[path.slice(i + 1)];
};

let pass = true;
const check = (ok, msg, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + msg + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));

const s = createSession(RULES, structuredClone(DATA), { resolve: () => Promise.reject(new Error('no resolver')) });
await s.idle();
const adj = () => resolveCell(s.getState(), 'root.adjustment');

// ── 1) 锁死分支 auto-high ─────────────────────────────────────
banner('1) 命中锁死分支 auto-high：不可覆盖、setOverride 抛错、值=expr');
check(adj().value === '500', 'adjustment = 500（= 1000*0.5）', ' → ' + adj().value);
check(adj().overridable === false, 'overridable = false（锁死分支）');
let threw = false;
try { s.setOverride('root.adjustment', '999'); } catch { threw = true; }
check(threw, 'setOverride 在锁死分支抛错（被拒）');
await s.idle();
check(adj().value === '500' && adj().state !== 'overridden', '仍为计算值 500、未 overridden');

// ── 2) 切到 else 分支（可覆盖）──────────────────────────────────
banner('2) 切 adjustMode=manual → 命中 else：可覆盖、setOverride 成功、可 clear');
s.setInput('root.adjustMode', 'manual');
await s.idle();
check(adj().value === '200', 'else 计算默认值 = 200（= 1000*0.2）', ' → ' + adj().value);
check(adj().overridable === true, 'overridable = true（else 分支）');
threw = false;
try { s.setOverride('root.adjustment', '777'); } catch { threw = true; }
check(!threw, 'setOverride 在 else 分支成功（放行）');
await s.idle();
check(adj().value === '777' && adj().state === 'overridden', '覆盖生效 = 777、state=overridden');
s.clearOverride('root.adjustment');
await s.idle();
check(adj().value === '200' && adj().state !== 'overridden', 'clearOverride 回到计算默认值 200');

// ── 3) 覆盖后切回锁死分支：覆盖被忽略 ───────────────────────────
banner('3) else 分支覆盖后切回 auto-high：覆盖被忽略、值=锁死计算值');
s.setOverride('root.adjustment', '888'); await s.idle();
check(adj().value === '888', 'else 分支覆盖 = 888');
s.setInput('root.adjustMode', 'auto-high'); await s.idle();
check(adj().value === '500' && adj().overridable === false, '切回 auto-high：忽略覆盖、= 500、不可覆盖');

console.log('\n' + (pass ? '✅ 分支级可覆盖 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
