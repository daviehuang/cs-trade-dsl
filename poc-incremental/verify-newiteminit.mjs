// 验证 newItemInit 底座：引擎只读求值 evalAt(ownerPath, expr) + buildNewItem 组装算法。
//   （TS 侧 hydrate→CollectionUI.newItemInit→ctx.evalExpr→buildNewItem 的透传由 editor-react 构建 typecheck 覆盖。）
//   场景：混合收费 amount 预填当前剩余额 diff（10000→改5000→5000→改3000→2000→0）。
import { createSession } from './src/incremental.js';

const mix = {
  ruleSetId: 'commonMixPayment', version: '1.0.0',
  nodes: {
    MixPayment: { fields: {
        extTotal: { type: 'decimal', external: true }, itemsTotal: { type: 'decimal', computed: true }, diff: { type: 'decimal', computed: true } },
      children: [{ name: 'items', node: 'ChargeItem' }] },
    ChargeItem: { fields: { desc: { type: 'string' }, amount: { type: 'decimal' } } },
  },
  rules: [
    { id: 'mixItemsTotal', type: 'formula', scope: 'MixPayment', target: 'itemsTotal', expr: 'round(sum(items.amount),2)' },
    { id: 'mixDiff', type: 'formula', scope: 'MixPayment', target: 'diff', expr: 'round(extTotal - itemsTotal,2)' },
  ],
};
const host = {
  ruleSetId: 'deal', version: '1.0.0', imports: [{ ref: 'commonMixPayment@1.0.0', as: 'mix' }],
  model: { root: 'Deal', nodes: { Deal: { fields: { agreedFee: { type: 'decimal' } }, children: [{ name: 'charges', node: 'MixPayment' }] } } },
  rules: [{ id: 'feedExtTotal', type: 'formula', scope: 'MixPayment', target: 'extTotal', expr: 'parent.agreedFee' }],
};
const s = createSession(host, { agreedFee: '10000', charges: [{ items: [] }] }, { imports: { 'commonMixPayment@1.0.0': mix } });
await s.idle();

// buildNewItem 等价算法（同 ui-kit-core/engine-shared.ts）：模板 + 按 newItemInit 在 owner 作用域求值覆盖
const evalExpr = (base, expr) => { try { return s.evalAt(base, expr); } catch { return undefined; } };
const buildNewItem = (parentPath, newItemInit, template = {}) => {
  const obj = { ...template };
  for (const [f, expr] of Object.entries(newItemInit || {})) {
    const v = evalExpr(parentPath, expr);
    if (v != null && v !== '') obj[f] = typeof v === 'string' ? v : String(v);
  }
  return obj;
};

const NEW_ITEM_INIT = { amount: 'diff' };                 // ← PageDef 里 items 集合的声明
const OWNER = 'root.charges[0]';                          // 集合所属节点（MixPayment 实例）
const diffNow = () => s.getState().tree.collections.charges[0].fields.diff.value;
const amounts = () => s.getState().tree.collections.charges[0].collections.items.map((i) => i.fields.amount.value);

let pass = true; const ck = (ok, m) => { console.log((ok ? '  ✅ ' : '  ❌ ') + m); pass = pass && ok; };
console.log('extTotal=10000  初始 diff =', diffNow());

// 直接验 evalAt 在 owner 作用域读到的 diff（evalAt 返回原始值，String 化后 = 显示值）
ck(String(s.evalAt(OWNER, 'diff')) === diffNow(), `evalAt(${OWNER}, "diff") = ${diffNow()}`);

const addItem = () => { const obj = buildNewItem(OWNER, NEW_ITEM_INIT); s.addChild(OWNER, 'items', obj); return obj.amount; };

let pre = addItem(); await s.idle();
ck(pre === '10000', `第1笔预填 amount = 当前 diff = 10000（实际 ${pre}）`);
s.setInput('root.charges[0].items[0].amount', '5000'); await s.idle();
ck(diffNow() === '5000', '改为 5000 → diff = 5000');

pre = addItem(); await s.idle();
ck(pre === '5000', `第2笔预填 amount = 5000（实际 ${pre}）`);
s.setInput('root.charges[0].items[1].amount', '3000'); await s.idle();
ck(diffNow() === '2000', '改为 3000 → diff = 2000');

pre = addItem(); await s.idle();
ck(pre === '2000', `第3笔预填 amount = 2000（实际 ${pre}）`);
ck(diffNow() === '0', '三笔合计付清 → diff = 0');
console.log('  amounts =', JSON.stringify(amounts()));

console.log('\n' + (pass ? '✅ newItemInit 底座通过：evalAt(owner作用域) + buildNewItem 预填剩余额' : '❌ 有断言失败'));
process.exit(pass ? 0 : 1);
