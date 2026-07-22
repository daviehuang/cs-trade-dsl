// 联动重置「值变化触发（watch）」验证。内联与 ui-kit-core/engine-shared.ts 同款 scan 逻辑（when 边沿 / watch 值变）。
import { createSession } from './src/incremental.js';

// ── 同款 watcher（when 边沿 + watch 值变），精简版 ──
function attachResetWatcher(session, rules) {
  const lastTrue = new Map(), lastVal = new Map();
  const resetTarget = (p) => { try { session.setInput(p, null); return; } catch {} try { session.clearOverride(p); } catch {} };
  const collect = (node, scope, out) => {
    if (!node) return;
    if (scope === 'root' || node.type === scope || node.path === scope) out.push(node);
    for (const arr of Object.values(node.collections)) for (const c of arr) collect(c, scope, out);
    for (const sn of Object.values(node.slots)) collect(sn, scope, out);
  };
  const applyTarget = (sn, t) => { if (sn.fields[t]) resetTarget(sn.path + '.' + t); else resetTarget(sn.path + '.' + t); };
  const scan = (fire) => {
    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri]; const matched = []; collect(session.getState().tree, rule.scope, matched);
      for (const sn of matched) {
        const key = ri + '@' + sn.path; let trigger = false;
        if (rule.watch) {
          let v; try { v = session.evalAt(sn.path, rule.watch); } catch { v = undefined; }
          const s = v == null ? '' : String(v); const had = lastVal.has(key); const prev = lastVal.get(key);
          lastVal.set(key, s); trigger = fire && had && prev !== s;
        } else {
          let now = false; try { now = session.evalAt(sn.path, rule.when) === true; } catch {}
          const was = lastTrue.get(key) === true; lastTrue.set(key, now); trigger = fire && now && !was;
        }
        if (trigger) for (const t of rule.targets) applyTarget(sn, t);
      }
    }
  };
  return { seed: () => scan(false), run: () => scan(true) };
}

const RULES = {
  ruleSetId: 'w', version: '1.0.0',
  model: { root: 'Deal', nodes: { Deal: { fields: {
    trxCCY: { type: 'string' }, amount: { type: 'decimal' }, memo: { type: 'string' },
  } } } },
};
const s = createSession(RULES, { trxCCY: 'USD', amount: '1000', memo: 'x' }, { resolve: () => Promise.reject(new Error('no')) });
await s.idle();

let pass = true;
const check = (ok, m, x = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + m + x); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(56) + '\n' + t + '\n' + '═'.repeat(56));
const val = (f) => s.getState().tree.fields[f].value;

// watch trxCCY → 值变化即清空 amount
const w = attachResetWatcher(s, [{ scope: 'root', watch: 'trxCCY', targets: ['amount'] }]);
w.seed(); const run = () => { w.run(); };

banner('1) 加载后 seed：不触发（首值仅记基线）');
check(val('amount') === '1000', 'amount 仍为 1000（未被清）', ' → ' + val('amount'));

banner('2) trxCCY 值变化（USD→CNY）→ amount 被清空');
s.setInput('root.trxCCY', 'CNY'); run();
await s.idle();
check(val('amount') === null, 'amount 清空（watch 触发）', ' → ' + val('amount'));

banner('3) 重新填 amount，再变 trxCCY（CNY→EUR）→ 再次清空');
s.setInput('root.amount', '2000'); run();   // 填值本身不触发（watch 的是 trxCCY，未变）
await s.idle();
check(val('amount') === '2000', '填回 2000（改 amount 不触发 watch trxCCY）', ' → ' + val('amount'));
s.setInput('root.trxCCY', 'EUR'); run();
await s.idle();
check(val('amount') === null, 'trxCCY 再变 → amount 再清空', ' → ' + val('amount'));

banner('4) trxCCY 设成相同值（EUR→EUR）→ 不触发');
s.setInput('root.amount', '3000'); run();
s.setInput('root.trxCCY', 'EUR'); run();   // 值没变
await s.idle();
check(val('amount') === '3000', '同值不算变化 → amount 保留 3000', ' → ' + val('amount'));

banner('5) 无关字段（memo）变化 → 不触发');
s.setInput('root.memo', 'y'); run();
await s.idle();
check(val('amount') === '3000', 'memo 变化不影响（watch 的是 trxCCY）', ' → ' + val('amount'));

console.log('\n' + (pass ? '✅ watch 值变化触发 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
