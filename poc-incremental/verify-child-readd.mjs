// 回归：子记录「删除后重新添加」再编辑 —— hydrate 曾按可见位置重拼 lines[i]，
//   而引擎用墓碑保持原始下标（删后再增下标不连续，如 lines[2]），两者错位 →
//   编辑新行时 setInput("root.lines[1].sku") 命中已删墓碑 → "not an input"。
//   本脚本在引擎边界证明：应使用每行携带的真实 path（getState 已给出），而非压缩位置下标。
import { createSession } from './src/incremental.js';

const RULES = {
  ruleSetId: 'childReadd', version: '1.0.0',
  model: { root: 'Order', nodes: {
    Order: { fields: {}, children: [{ name: 'lines', node: 'Line' }] },
    Line: { fields: { sku: { type: 'string' } } },
  } },
  rules: [],
};

const s = createSession(RULES, { lines: [{ sku: 'a' }] }, { resolve: async () => null, onUpdate: () => {} });

// ① 添加一条 → lines[1]
const p1 = s.addChild('root', 'lines', { sku: 'b' });
// ② 删除刚加的 → 墓碑占位，下标不回收
s.removeChild(p1);
// ③ 重新添加 → 原始下标越过墓碑（lines[2]）
const p2 = s.addChild('root', 'lines', { sku: 'c' });

const lines = s.getState().tree.collections.lines;          // 引擎视图：跳过墓碑，2 条可见
console.log('新增返回 path =', p2, '（应为 root.lines[2]，非 [1]）');
console.log('可见行数 =', lines.length, ' 各行真实 path =', lines.map((n) => n.path));

// —— 旧（错误）方式：按可见位置 i 重拼 —— 第 2 行 → root.lines[1]（墓碑）
const oldPath = `root.lines[${lines.length - 1}]`;          // = root.lines[1]
// —— 新（修复）方式：用行携带的真实 path —— root.lines[2]
const newPath = lines[lines.length - 1].path;               // = root.lines[2]

let oldErr = null;
try { s.setInput(oldPath + '.sku', 'X'); } catch (e) { oldErr = e.message; }

let newOk = false, newErr = null;
try { s.setInput(newPath + '.sku', '删后重加'); newOk = true; } catch (e) { newErr = e.message; }
const readBack = s.getState().tree.collections.lines.at(-1).fields.sku.value;

console.log('\n旧方式 setInput(%s.sku) →', oldPath, oldErr ? '❌ ' + oldErr : '（未报错）');
console.log('新方式 setInput(%s.sku) →', newPath, newOk ? '✅ 成功，回读=' + JSON.stringify(readBack) : '❌ ' + newErr);

const pass =
  p2 === 'root.lines[2]' &&
  oldErr && /not an input/.test(oldErr) &&                   // 旧方式必然复现该错误
  newOk && readBack === '删后重加';                          // 新方式可正常编辑
console.log('\n结论:', pass ? '✅ 修复正确：改用真实 path 后删后重加可编辑；旧的压缩下标正是报错根因' : '❌ 未达预期');
process.exit(pass ? 0 : 1);
