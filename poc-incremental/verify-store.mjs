// 仓库端到端验证（需先启动 store-server：node store-server.js）：
//   1) catalog / bundle 端点形状；2) PUT→GET 往返（复刻编辑器 remoteStore 的存/取路径）；
//   3) 从仓库拉回的 bundle 喂进引擎 → net=82203.22（证明"运行时从仓库加载的规则"是 engine-valid 的真值）。
import { createSession } from './src/incremental.js';

const BASE = 'http://localhost:8788/api';
const jget = async (p) => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(`GET ${p} → ${r.status}`); return r.json(); };
const jput = async (p, b) => { const r = await fetch(BASE + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(`PUT ${p} → ${r.status}`); return r.json(); };

let pass = true;
const check = (ok, msg, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + msg + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));

// 与其它 verify 同款路径解析
const resolveCell = (state, path) => {
  const toks = path.split('.'); let node = state.tree;
  for (let k = 1; k < toks.length; k++) {
    const tok = toks[k], m = tok.match(/^(\w+)\[(\d+)\]$/);
    if (m) { node = node?.collections[m[1]]?.[+m[2]]; continue; }
    if (node?.slots?.[tok]) { node = node.slots[tok]; continue; }
    const i = path.lastIndexOf('.'); return node?.fields[path.slice(i + 1)];
  }
  return undefined;
};
const RATES = { 'USD-CNY': '7.1234', 'EUR-CNY': '7.8901', 'HKD-CNY': '0.9123', 'SGD-CNY': '5.2710', 'CNY-CNY': '1' };
const resolve = (source, key) => new Promise((res, rej) => { const r = RATES[`${key.from}-${key.to}`]; r ? res({ value: r, asOf: '2026-06-25', rateId: 'fx' }) : rej(new Error('no rate')); });

try {
  // ── 1) catalog ────────────────────────────────────────────────
  banner('1) GET /api/catalog：目录清单');
  const cat = await jget('/catalog');
  check(cat.features.some((f) => f.id === 'lcSettlement'), 'feature 含 lcSettlement');
  check(cat.libraries.length >= 3, '库 ≥ 3', ' → ' + cat.libraries.map((l) => l.id).join('、'));
  check(cat.rulesets.some((r) => r.id === 'lcSettlement@5.1.0'), '规则集含 lcSettlement@5.1.0');

  // ── 2) bundle 组装 ────────────────────────────────────────────
  banner('2) GET /api/bundle/lcSettlement：运行时一次拉齐');
  const b = await jget('/bundle/lcSettlement');
  check(['feature', 'ruleSet', 'imports', 'pageDef', 'data'].every((k) => k in b), 'bundle 五段齐全');
  check(b.ruleSet.ruleSetId === 'lcSettlement', 'ruleSet.ruleSetId = lcSettlement');
  check('commonFx@1.0.0' in b.imports && 'commonParty@1.0.0' in b.imports, 'imports 解析出 commonFx + commonParty');
  check(b.data.lcNo === 'LC-2026-8842', 'data 已带初始数据');

  // ── 3) PUT→GET 往返（模拟编辑器"保存到仓库"）────────────────────
  banner('3) PUT→GET 往返：改页面标题 → bundle 反映 → 还原');
  const page = await jget('/page/lcSettlement');
  const orig = page.title;
  await jput('/page/lcSettlement', { ...page, title: orig + ' ✎verify' });
  const b2 = await jget('/bundle/lcSettlement');
  check(b2.pageDef.title === orig + ' ✎verify', '保存后 bundle.pageDef.title 已更新');
  await jput('/page/lcSettlement', { ...page, title: orig });          // 还原
  const b3 = await jget('/bundle/lcSettlement');
  check(b3.pageDef.title === orig, '还原成功');

  // ── 4) 仓库 bundle 喂引擎 → 真值 ───────────────────────────────
  banner('4) 从仓库拉回的规则喂进引擎 → net = 82203.22（engine-valid）');
  const s = createSession(b.ruleSet, structuredClone(b.data), { resolve, imports: b.imports });
  await s.idle();
  const st = s.getState();
  const net = resolveCell(st, 'root.net')?.value;
  console.log('  净额 net =', net);
  check(net === '82203.22', 'net = 82203.22（与四端一致）');

  // ── 5) 字段 label：报错 {字段:label} 引用友好名（越限触发 netLimit）──────
  banner('5) field.label：报错用 {字段:label} 引用友好名');
  const s2 = createSession(b.ruleSet, { ...structuredClone(b.data), maxNet: '1000' }, { resolve, imports: b.imports });
  await s2.idle();
  const vmsg = s2.getState().validations.find((x) => x.id === 'netLimit')?.message;
  console.log('  netLimit.message =', vmsg);
  check(!!vmsg && vmsg.startsWith('净额 ') && vmsg.includes('超过净额上限 '), '报错含字段 label（净额 / 净额上限），而非字段名');
} catch (e) {
  console.error('\n⛔ 验证异常：', e.message, '\n（store-server 是否已启动？node store-server.js）');
  pass = false;
}

console.log('\n' + (pass ? '✅ 仓库端到端验证全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
