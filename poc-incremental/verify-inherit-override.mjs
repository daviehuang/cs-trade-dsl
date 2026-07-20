// Java 式「继承 + 覆盖」验证：
//   MixPayment{items→ChargeItem}  ← 通用业务组件（产品部）
//   CustomPayment extends MixPayment{items→CustomChargeItem}   ← 项目覆盖子集合节点类型
//   CustomChargeItem extends ChargeItem{+surcharge, subtotal 改公式(overrides), 停用基类校验(disable)}
// 断言：① 子集合覆盖 ② 规则 overrides 替换 ③ disable 停用 ④ per-subtype 隔离（基类实例不受影响）
import { createSession } from './src/incremental.js';

const RULES = {
  ruleSetId: 'inheritDemo', version: '1.0.0',
  model: {
    root: 'Deal',
    nodes: {
      Deal: { fields: {}, slots: { common: 'MixPayment', proj: 'CustomPayment' } },
      MixPayment: { fields: {}, children: [{ name: 'items', node: 'ChargeItem' }] },
      ChargeItem: { fields: { base: { type: 'decimal' }, subtotal: { type: 'decimal', computed: true } } },
      // 项目侧：继承通用组件，仅重定义同名子集合的节点类型
      CustomPayment: { extends: 'MixPayment', fields: {}, children: [{ name: 'items', node: 'CustomChargeItem' }] },
      CustomChargeItem: { extends: 'ChargeItem', fields: { surcharge: { type: 'decimal' } } },
    },
  },
  rules: [
    { id: 'rSub', type: 'formula', scope: 'ChargeItem', target: 'subtotal', expr: 'base * 2' },
    { id: 'vBase', type: 'validation', scope: 'ChargeItem', expr: 'base >= 0', message: 'base 不能为负', severity: 'error' },
    // 覆盖：子类同 id 目标的 formula，基类 rSub 被移除
    { id: 'rSubCustom', type: 'formula', scope: 'CustomChargeItem', target: 'subtotal', overrides: 'rSub', expr: 'base * 2 + surcharge' },
    // 停用：子类上不再跑基类校验
    { id: 'vBaseOff', scope: 'CustomChargeItem', overrides: 'vBase', disable: true },
  ],
};
const DATA = {
  common: { items: [{ base: '-10', subtotal: '' }] },
  proj: { items: [{ base: '-10', surcharge: '5', subtotal: '' }] },
};

let pass = true;
const check = (ok, msg, extra = '') => { console.log((ok ? '  ✅ ' : '  ❌ ') + msg + extra); pass = pass && ok; };
const banner = (t) => console.log('\n' + '═'.repeat(60) + '\n' + t + '\n' + '═'.repeat(60));

const s = createSession(RULES, structuredClone(DATA), { resolve: () => Promise.reject(new Error('no resolver')) });
await s.idle();
const st = s.getState();
const commonItem = st.tree.slots.common.collections.items[0];
const projItem = st.tree.slots.proj.collections.items[0];

banner('1) 子集合节点类型被子类覆盖：CustomPayment.items → CustomChargeItem');
check(projItem.type === 'CustomChargeItem', 'proj 明细 type = CustomChargeItem', ' → ' + projItem.type);
check('surcharge' in projItem.fields, 'proj 明细含子类新增字段 surcharge');
check(commonItem.type === 'ChargeItem', 'common 明细仍为基类 ChargeItem', ' → ' + commonItem.type);
check(!('surcharge' in commonItem.fields), 'common 明细无 surcharge');

banner('2) 规则 overrides：子类公式替换基类公式');
check(projItem.fields.subtotal.value === '-15', 'proj subtotal = -15（= -10*2 + 5）', ' → ' + projItem.fields.subtotal.value);

banner('3) disable：子类停用继承来的校验');
const projVals = st.validations.filter((v) => v.node.startsWith('root.proj'));
check(projVals.every((v) => v.id !== 'vBase'), 'proj 明细上无 vBase 校验实例', ' → ' + JSON.stringify(projVals.map((v) => v.id)));

banner('4) per-subtype 隔离：基类实例完全不受影响');
check(commonItem.fields.subtotal.value === '-20', 'common subtotal = -20（基类公式 base*2）', ' → ' + commonItem.fields.subtotal.value);
const commonFail = st.validations.filter((v) => v.node.startsWith('root.common') && v.id === 'vBase' && v.ok === false);
check(commonFail.length === 1, 'common 明细 vBase 校验仍触发（base=-10 不合法）', ' → ' + commonFail.length);

banner('5) 增量传播：改子类输入后覆盖公式仍生效');
s.setInput(projItem.path + '.surcharge', '100');
await s.idle();
const projItem2 = s.getState().tree.slots.proj.collections.items[0];
check(projItem2.fields.subtotal.value === '80', 'surcharge=100 → subtotal = 80（= -10*2 + 100）', ' → ' + projItem2.fields.subtotal.value);

console.log('\n' + (pass ? '✅ 继承+覆盖 全部通过' : '❌ 存在失败项'));
process.exit(pass ? 0 : 1);
