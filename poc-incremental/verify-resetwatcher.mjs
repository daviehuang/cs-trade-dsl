// 验证联动重置 watcher（计划 ②）：引擎 evalAt + setInput 在宿主层拼出的「A 变→清空 B 输入」通路。
//   核心保证：① 边沿触发（false→true 才清，非电平）② 重入守卫不死循环 ③ seed 不误清加载数据 ④ 按类型作用域逐节点判定。
//   （TS 侧 attachResetWatcher 由四端 store 接线 + 各 app 构建 typecheck 覆盖；此处以同一算法直连引擎回归。）
import { createSession } from './src/incremental.js';

const ruleSet = {
  ruleSetId: 'resetDemo', version: '1.0.0',
  model: { root: 'Deal', nodes: {
    Deal: {
      fields: { settleType: { type: 'string' }, lcNo: { type: 'string' }, issuingBank: { type: 'string' } },
      slots: { applicant: { node: 'Party', optional: true } },
      children: [{ name: 'charges', node: 'ChargeItem' }],
    },
    Party: { fields: { name: { type: 'string' }, address: { type: 'string' } },
      children: [{ name: 'contacts', node: 'Contact' }] },     // slot 的 node 自带 children
    Contact: { fields: { phone: { type: 'string' } } },
    ChargeItem: { fields: { adjust: { type: 'string' }, autoRate: { type: 'string' } } },
  } },
  // 条件可输入(fallback:"input") + 可覆盖(overridable) 两类「case when」字段，验证重置语义分流。
  rules: [
    { id: 'condFee', type: 'formula', scope: 'Deal', target: 'condFee',
      cases: [{ when: 'settleType == "auto"', expr: '100' }], fallback: 'input' },
    { id: 'ovrFee', type: 'formula', scope: 'Deal', target: 'ovrFee', expr: '200' },
  ],
};
// 追加两个字段声明到 Deal（computed）
ruleSet.model.nodes.Deal.fields.condFee = { type: 'decimal', computed: true };
ruleSet.model.nodes.Deal.fields.ovrFee = { type: 'decimal', computed: true, overridable: true };
// PageDef.resetRules 等价声明：settleType 变 wire → 清信用证号/开证行；某收费行 adjust 变 manual → 清该行 autoRate。
const RESET_RULES = [
  { scope: 'root', when: 'settleType == "wire"', targets: ['lcNo', 'issuingBank'] },
  { scope: 'ChargeItem', when: 'adjust == "manual"', targets: ['autoRate'] },
];

// attachResetWatcher 的同款算法（对齐 ui-kit-core/src/engine-shared.ts）。
function attachResetWatcher(session, rules, onStructChange) {
  if (!rules || !rules.length) return { seed() {}, run() {} };
  const lastTrue = new Map();
  let running = false, structDirty = false;
  const collect = (node, scope, out) => {
    if (node.type === scope || node.path === scope) out.push(node);
    for (const arr of Object.values(node.collections)) for (const c of arr) collect(c, scope, out);
    for (const sn of Object.values(node.slots)) collect(sn, scope, out);
  };
  const resetTarget = (path) => {                             // ① 字段：清值
    try { session.setInput(path, null); return; } catch { /* 非 input */ }
    try { session.clearOverride(path); } catch { /* 纯 computed */ }
  };
  const removeAllRows = (rows) => {                           // ③ children：删所有记录（结构变更）
    for (const p of rows.map((r) => r.path))
      try { session.removeChild(p); structDirty = true; } catch { /* 已删/非法 */ }
  };
  const resetSubtree = (node) => {                            // ② slot 整体重置：字段清值 + 子集合删记录
    for (const f of Object.keys(node.fields)) resetTarget(node.path + '.' + f);
    for (const sn of Object.values(node.slots)) resetSubtree(sn);
    for (const arr of Object.values(node.collections)) removeAllRows(arr);
  };
  const applyTarget = (sn, t) => {
    if (sn.fields[t]) resetTarget(sn.path + '.' + t);
    else if (sn.slots[t]) resetSubtree(sn.slots[t]);
    else if (sn.collections[t]) removeAllRows(sn.collections[t]);
    else resetTarget(sn.path + '.' + t);
  };
  const scan = (fire) => {
    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri]; const matched = []; collect(session.getState().tree, rule.scope, matched);
      for (const sn of matched) {
        let now = false;
        try { now = session.evalAt(sn.path, rule.when) === true; } catch { now = false; }
        const key = ri + '@' + sn.path; const was = lastTrue.get(key) === true; lastTrue.set(key, now);
        if (fire && now && !was) for (const t of rule.targets) applyTarget(sn, t);
      }
    }
  };
  return {
    seed: () => scan(false),
    run: () => { if (running) return; running = true; structDirty = false;
      try { scan(true); } finally { running = false; } if (structDirty) onStructChange?.(); },
  };
}

let pass = true; const ck = (ok, m) => { console.log((ok ? '  ✅ ' : '  ❌ ') + m); pass = pass && ok; };

// ── 主场景：加载时 settleType=lc（与 lcNo 一致）────────────────────────────────
let updates = 0, watcherRun = () => {};
const s = createSession(ruleSet, {
  settleType: 'lc', lcNo: 'LC12345', issuingBank: 'HSBC',
  charges: [{ adjust: 'auto', autoRate: '1.10' }, { adjust: 'auto', autoRate: '1.20' }],
}, { onUpdate: () => { updates++; watcherRun(); } });
await s.idle();
const w = attachResetWatcher(s, RESET_RULES);
w.seed(); watcherRun = w.run;

const rootF = (f) => s.getState().tree.fields[f].value;
const itemF = (i, f) => s.getState().tree.collections.charges[i].fields[f].value;

console.log('加载 settleType=lc, lcNo=LC12345, issuingBank=HSBC');
ck(rootF('lcNo') === 'LC12345', 'seed 后 lcNo 未被清（settleType=lc，when 假）');

// ① 边沿触发：settleType 变 wire → lcNo/issuingBank 被清
s.setInput('root.settleType', 'wire'); await s.idle();
ck(rootF('lcNo') === '' && rootF('issuingBank') === '', '① settleType→wire（假→真边沿）→ lcNo、issuingBank 被清空');

// ② 非电平：wire 状态下用户重填 lcNo，不应被再次清（when 仍真，无新边沿）
s.setInput('root.lcNo', 'LC999'); await s.idle();
ck(rootF('lcNo') === 'LC999', '② wire 下重填 lcNo=LC999 保留（边沿触发 ≠ 电平，用户可继续录入）');

// ③ 切回 lc（真→假）不清；再切 wire（假→真）重新清
s.setInput('root.settleType', 'lc'); await s.idle();
ck(rootF('lcNo') === 'LC999', '③a settleType→lc（真→假）不触发，lcNo 保留');
s.setInput('root.settleType', 'wire'); await s.idle();
ck(rootF('lcNo') === '', '③b 再 settleType→wire（假→真）→ lcNo 再次清空');

// ④ 按类型作用域逐节点：只清触发行，其它行不动
s.setInput('root.charges[0].adjust', 'manual'); await s.idle();
ck(itemF(0, 'autoRate') === '' && itemF(1, 'autoRate') === '1.20', '④ charges[0].adjust→manual 只清本行 autoRate，charges[1] 不受影响');

// ⑤ 无死循环：整段跑完（settle 有 1e6 上限，若成环会抛/挂）；更新次数有界
ck(updates > 0 && updates < 500, `⑤ 更新收敛无死循环（onUpdate 触发 ${updates} 次，有界）`);

// ── seed 尊重加载数据：初始即 wire + 有 lcNo（不一致的历史数据）→ seed 不清 ──────
let wr2 = () => {};
const s2 = createSession(ruleSet, { settleType: 'wire', lcNo: 'OLD-LC', issuingBank: 'DBS', charges: [] },
  { onUpdate: () => wr2() });
await s2.idle();
const w2 = attachResetWatcher(s2, RESET_RULES); w2.seed(); wr2 = w2.run;
ck(s2.getState().tree.fields.lcNo.value === 'OLD-LC', '⑥ seed 尊重加载数据：初始即 wire+有 lcNo，seed 记基线不清空');
// 之后一旦 wire→lc→wire 走一个新边沿才清
s2.setInput('root.settleType', 'lc'); await s2.idle();
s2.setInput('root.settleType', 'wire'); await s2.idle();
ck(s2.getState().tree.fields.lcNo.value === '', '⑦ s2 经历新的假→真边沿后才清 lcNo');

// ── case when 字段：条件可输入(fallback:input) vs 可覆盖(overridable) 的重置语义分流 ──────
let wr3 = () => {};
const RULES3 = [{ scope: 'root', when: 'settleType == "wire"', targets: ['condFee', 'ovrFee'] }];
const s3 = createSession(ruleSet, { settleType: 'lc' }, { onUpdate: () => wr3() });
await s3.idle();
const w3 = attachResetWatcher(s3, RULES3); w3.seed(); wr3 = w3.run;
const f3 = (f) => s3.getState().tree.fields[f];

s3.setInput('root.condFee', '55'); await s3.idle();          // 条件可输入：settleType≠auto → 录入 55
s3.setOverride('root.ovrFee', '999'); await s3.idle();       // 可覆盖：人工覆盖 999
ck(f3('condFee').state === 'input' && String(f3('condFee').value) === '55', '⑧a 前置：condFee 可输入态录入 55');
ck(f3('ovrFee').state === 'overridden' && String(f3('ovrFee').value) === '999', '⑧b 前置：ovrFee 被覆盖为 999');

s3.setInput('root.settleType', 'wire'); await s3.idle();     // 触发重置
ck(f3('condFee').value == null, '⑧ 条件可输入字段被 setInput(null) 清空（fallback:input 分支）');
ck(f3('ovrFee').state === 'resolved' && String(f3('ovrFee').value) === '200',
  '⑨ 可覆盖字段被 clearOverride 恢复计算值 200（非 setInput——那会抛 not an input）');

// ── 节点级 target：slot 递归清字段 + children 删所有行（结构变更 → onStructChange） ──────
let wr4 = () => {}, rebuilds = 0;
const RULES4 = [{ scope: 'root', when: 'settleType == "wire"', targets: ['applicant', 'charges'] }];
const s4 = createSession(ruleSet, {
  settleType: 'lc',
  applicant: { name: 'ACME', address: 'HK', contacts: [{ phone: '111' }, { phone: '222' }] },  // slot 内自带 2 条 children
  charges: [{ adjust: 'a', autoRate: '1' }, { adjust: 'b', autoRate: '2' }, { adjust: 'c', autoRate: '3' }],
}, { onUpdate: () => wr4() });
await s4.idle();
const w4 = attachResetWatcher(s4, RULES4, () => { rebuilds++; }); w4.seed(); wr4 = w4.run;
const slot4 = (f) => s4.getState().tree.slots.applicant.fields[f].value;
const nContacts = () => s4.getState().tree.slots.applicant.collections.contacts.length;
const nRows = () => s4.getState().tree.collections.charges.length;

console.log('\n加载 applicant={ACME,HK, contacts×2}, charges 3 行');
ck(slot4('name') === 'ACME' && nContacts() === 2 && nRows() === 3, '⑩ 前置：applicant.name=ACME、contacts 2 条、charges 3 行');

s4.setInput('root.settleType', 'wire'); await s4.idle();       // 触发节点级重置
ck(slot4('name') === '' && slot4('address') === '', '⑪ target=applicant（slot）→ 清空 name、address 字段值');
ck(nContacts() === 0, '⑪b slot 内自带 children（contacts）→ 删除记录（非清字段值）');
ck(nRows() === 0, '⑫ target=charges（children）→ 删除全部 3 行（结构变更）');
ck(rebuilds > 0, `⑬ 删行后触发 onStructChange 重建 UI-IR（${rebuilds} 次，避免幽灵行脱节）`);

console.log('\n' + (pass ? '✅ 联动重置 watcher 通过：边沿 + 重入 + seed + 类型作用域 + case-when 分流 + slot 清字段 + children 删行(带重建)' : '❌ 有断言失败'));
process.exit(pass ? 0 : 1);
