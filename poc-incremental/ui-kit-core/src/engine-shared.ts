// 纯函数 + 常量（无框架依赖）：被 绑定层、自动布局、hydrate、linter、各框架适配器共享。
// 这里集中放「领域标签 / 控件种类推导 / 路径解析 / EngineCtx 契约」等与渲染框架无关的逻辑。
import { Cell, SessionState, ValidationView, ViewNode } from './engine-types';
import { EngineMeta } from './engine-meta';
import { ResetRule } from './page-def';

/** 绑定上下文：各框架的字段组件从这里拿到它，所有交互/取值都经它委托给引擎会话。 */
export interface EngineCtx {
  ccys: string[];
  valueOf(path: string): string;
  cellText(path: string): string;
  cellState(path: string): Cell['state'] | undefined;
  /** 该字段此刻是否允许人工覆盖（分支级：随命中的 cases 分支实时变化）。 */
  overridableFor(path: string): boolean | undefined;
  onInput(path: string, v: string): void;
  onOverride(path: string, v: string): void;
  clearOverride(path: string): void;
  addChild(parent: string, coll: string, obj: any): void;
  removeChild(path: string): void;
  validationsFor(path: string): ValidationView[];
  /** 只读求值：在 base 节点作用域算表达式（新增初值 / 显隐谓词等）。求值失败返回 undefined。 */
  evalExpr(base: string, expr: string): any;
  /** 注册「引擎更新」监听（让框架在异步取数后重渲染）。返回注销函数。 */
  onTick(cb: () => void): () => void;
}

/** 新增子记录时组装初值对象：先取静态模板，再按 newItemInit 逐字段在【集合所属节点】作用域求值覆盖。
 *   四端「＋添加」共用，避免各端重复实现（如混合收费里 amount 预填当前剩余额 diff）。 */
export function buildNewItem(
  coll: { parentPath: string; newItemTemplate: () => any; newItemInit?: Record<string, string> },
  ctx: EngineCtx,
): any {
  const obj = coll.newItemTemplate() ?? {};
  if (coll.newItemInit)
    for (const [field, expr] of Object.entries(coll.newItemInit)) {
      const v = ctx.evalExpr(coll.parentPath, expr);      // 在 owner（集合所属节点）作用域求值：diff / root.x 等
      if (v != null && v !== '') obj[field] = typeof v === 'string' ? v : String(v);
    }
  return obj;
}

// ── 联动重置 watcher（计划 ②）────────────────────────────────────────────────
//   引擎是纯反应式单向数据流，没有「A 变化 → 反向清空 B 输入」的通路（计算字段只能算新值、
//   不能清空用户 input）。此 watcher 在宿主层用引擎已暴露的 evalAt + setInput 补上这条通路，
//   但克制地补：声明式规则 + 只订阅 onUpdate（稳态时机）+ 边沿触发（false→true）+ 重入守卫，
//   杜绝重入死循环、不破坏「同输入→同输出」（BFF 不感知，纯 UI 便利）。详见 COMPUTE-MODEL.md。

/** 引擎最小接口（watcher 需要的能力）。 */
export interface ResetWatchSession {
  evalAt(path: string, expr: string): any;
  setInput(path: string, raw: any): void;
  clearOverride(path: string): void;
  removeChild(childPath: string): void;
  getState(): { tree: ViewNode };
}

/** 递归收集状态树中匹配 scope 的所有节点（type===scope 或 path===scope）。 */
function collectScopeNodes(node: ViewNode, scope: string, out: ViewNode[]): void {
  if (node.type === scope || node.path === scope) out.push(node);
  for (const arr of Object.values(node.collections)) for (const child of arr) collectScopeNodes(child, scope, out);
  for (const sn of Object.values(node.slots)) collectScopeNodes(sn, scope, out);
}

/** 重置的一次确认请求（传给宿主 confirm 处理器）。 */
export interface ResetConfirmInfo {
  message: string;
  rule: ResetRule;
  nodePath: string;
}

/** attachResetWatcher 的宿主选项。 */
export interface ResetWatchOpts {
  /** 删行等结构变更后调用（各端 store 传自己的 rebuild / structVer++）；不传则结构变更后 UI 不重建。 */
  onStructChange?: () => void;
  /** 二次确认处理器（仅对声明了 confirm 的规则触发）。返回 true 立即执行、false 取消；
   *   返回 Promise<boolean> 则等用户在弹窗中确认后再执行（异步）。不传则回退浏览器原生 confirm，
   *   若环境无 confirm（如无头/测试）则默认放行。 */
  confirm?: (info: ResetConfirmInfo) => boolean | Promise<boolean>;
}

/** 挂接联动重置 watcher。返回 { seed, run }：
 *   - seed()：记录初值真值基线，【不触发】——避免加载既有数据时误清空（尊重已存记录）。
 *   - run()：每次引擎 onUpdate 时调；对每条规则的每个匹配节点求 when，仅 false→true 边沿重置 targets。
 *   边沿追踪（按 规则@节点 记忆上次真值）+ 重入守卫（清空/删行会再触发 onUpdate → 直接返回）杜绝死循环。
 *
 *   target 支持三种粒度（按匹配节点结构自动判定）：
 *   ① 字段名 → 清该字段值（input/条件可输入 setInput(null)；可覆盖 clearOverride）；
 *   ② slot 名 → 整体重置子树（字段清值 + 嵌套 children 删记录）；
 *   ③ children 集合名 → 删除该集合的所有子记录（结构变更！删完调 onStructChange 触发 UI-IR 重建）。
 *   其余（如 "applicant.name" 点号相对路径）→ 回退按 cell 路径清值。
 *
 *   rule.confirm：声明了则该规则触发前先走 opts.confirm（或浏览器原生 confirm）二次确认；
 *   同步 true→立即重置、false→取消；异步 Promise→用户确认后再重置。边沿真值在【询问时】即记账，
 *   故异步确认期间不会重复弹窗（pendingConfirm 再兜一层，防 when 反复翻转时叠框）。 */
export function attachResetWatcher(
  session: ResetWatchSession,
  rules: ResetRule[] | undefined,
  opts: ResetWatchOpts = {},
): { seed: () => void; run: () => void } {
  if (!rules || !rules.length) return { seed: () => {}, run: () => {} };
  const onStructChange = opts.onStructChange;
  const lastTrue = new Map<string, boolean>();
  const pendingConfirm = new Set<string>();          // rule@node：已有确认框挂起，避免重复弹
  let running = false;
  let structDirty = false;

  // 二次确认：opts.confirm > 浏览器原生 confirm > 放行（无头/测试环境无从询问）。
  const askConfirm = (info: ResetConfirmInfo): boolean | Promise<boolean> => {
    if (opts.confirm) return opts.confirm(info);
    const g = globalThis as any;
    if (typeof g.confirm === 'function') return !!g.confirm(info.message);
    return true;
  };
  const defaultMsg = (rule: ResetRule, nodePath: string) =>
    `确认重置 ${nodePath} 的：${rule.targets.join('、')}？（含删除子记录，不可撤销）`;

  // 按字段类型选正确的「清值」语义：
  //   - 普通 input / 条件可输入(fallback:"input") → setInput(null) 清空（引擎内置分流，见 incremental.js setInput）；
  //   - 可覆盖计算字段(overridable，已覆盖) → setInput 抛「not an input」，改 clearOverride 恢复公式计算；
  //   - 纯 computed → 两者皆无操作（本就不该被重置）。
  const resetTarget = (path: string) => {
    try { session.setInput(path, null); return; } catch { /* 非 input：可能是可覆盖计算字段 */ }
    try { session.clearOverride(path); } catch { /* 纯 computed：无可重置 */ }
  };
  // children 集合：删除所有子记录（结构变更）。先快照行路径再逐个 removeChild——
  //   墓碑删除保持兄弟真实下标稳定（viewNode 按真实下标建 path），故按快照 path 逐删安全。
  const removeAllRows = (rows: ViewNode[]) => {
    for (const p of rows.map((r) => r.path))
      try { session.removeChild(p); structDirty = true; } catch { /* 已删/非法路径 → 忽略 */ }
  };
  // slot / 嵌套节点「整体重置」= 恢复到空：清自身字段值 + 递归重置嵌套 slot +
  //   嵌套 children【删记录】（而非清字段值——空 slot 不应残留空子记录）。
  const resetSubtree = (node: ViewNode) => {
    for (const f of Object.keys(node.fields)) resetTarget(node.path + '.' + f);
    for (const sn of Object.values(node.slots)) resetSubtree(sn);
    for (const arr of Object.values(node.collections)) removeAllRows(arr);   // 子集合：删记录，不是清字段
  };
  // 对一个匹配节点施加一个 target：按该节点结构判定字段 / slot / 集合 / 点号相对路径。
  const applyTarget = (sn: ViewNode, t: string) => {
    if (sn.fields[t]) resetTarget(sn.path + '.' + t);              // ① 字段 → 清值
    else if (sn.slots[t]) resetSubtree(sn.slots[t]);             // ② slot → 整体重置（字段清值 + 子集合删记录）
    else if (sn.collections[t]) removeAllRows(sn.collections[t]); // ③ children → 删所有记录
    else resetTarget(sn.path + '.' + t);                          // 点号相对路径（applicant.name）等
  };

  const scan = (fire: boolean) => {
    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri];
      const matched: ViewNode[] = [];
      collectScopeNodes(session.getState().tree, rule.scope, matched);  // 每条规则重取树：删行后结构已变
      for (const sn of matched) {
        let now = false;
        try { now = session.evalAt(sn.path, rule.when) === true; } catch { now = false; }  // 引用 pending 字段等 → 视为假
        const key = ri + '@' + sn.path;
        const was = lastTrue.get(key) === true;
        lastTrue.set(key, now);                           // 边沿真值即刻记账（异步确认期间不重复触发）
        if (fire && now && !was) {                        // 仅 false→true 边沿触发
          const node = sn;
          const doReset = () => { for (const t of rule.targets) applyTarget(node, t); };
          if (!rule.confirm) { doReset(); continue; }     // 未声明确认 → 直接执行
          if (pendingConfirm.has(key)) continue;          // 已有确认框挂起 → 不重复弹
          const msg = typeof rule.confirm === 'string' ? rule.confirm : defaultMsg(rule, sn.path);
          const ans = askConfirm({ message: msg, rule, nodePath: sn.path });
          if (ans === true) doReset();                    // 同步确认
          else if (ans && typeof (ans as any).then === 'function') {   // 异步确认：用户点确认后再执行
            pendingConfirm.add(key);
            (ans as Promise<boolean>).then((ok) => {
              pendingConfirm.delete(key);
              if (ok) { doReset(); onStructChange?.(); }   // 异步分支自行触发结构重建
            });
          }
          // ans === false → 取消，本次不重置（保留数据）
        }
      }
    }
  };

  return {
    seed: () => scan(false),
    run: () => {
      if (running) return;
      running = true; structDirty = false;
      try { scan(true); } finally { running = false; }
      if (structDirty) onStructChange?.();               // 删行后触发 UI-IR 重建（避免幽灵行/脱节）
    },
  };
}

export const CCYS = ['USD', 'EUR', 'HKD', 'GBP', 'JPY', 'SGD', 'CNY'];

export const SLOT_LABEL: Record<string, string> = {
  applicant: '申请人 Applicant', beneficiary: '受益人 Beneficiary',
  advisingBank: '通知行 Advising Bank', adviseThrough: '转通知行 Advise Through', reimbursingBank: '偿付行 Reimbursing Bank',
};
export const FIELD_LABEL: Record<string, string> = {
  lcNo: '信用证号', baseCcy: '基准币种', valueDate: '起息日', maxNet: '净额上限', adjustMode: '手续调整方式',
  adjustment: '手续调整', chargeTotal: '收费合计', paymentTotal: '付费合计', net: '净额 net',
  name: '名称', address: '地址', country: '国家', taxId: '税号', contactPerson: '联系人', bic: 'BIC/SWIFT', account: '账号',
  groupName: '组名', subtotal: '小计', desc: '摘要', ccy: '币种', amount: '金额', fxRate: '汇率', base: '本币 base',
};
export const COLL_LABEL: Record<string, string> = { charges: '收费组 Charges', items: '明细 Items', payments: '付费 Payments' };
export const COLL_TEMPLATE: Record<string, () => any> = {
  charges: () => ({ groupName: '新收费组', items: [] }),
  items: () => ({ desc: '新明细', ccy: 'USD', amount: '0' }),
  payments: () => ({ ccy: 'USD', amount: '0' }),
};

/** 这些节点的叶子字段横向排成一行（明细/付费/收费组），其余（卡片）纵向堆叠。 */
export const ROW_TYPES = new Set(['ChargeGroup', 'ChargeItem', 'Payment']);

/** 按字段名推导控件种类（币种下拉 / 调整方式下拉 / 日历 / 文本）。 */
export const controlOf = (field: string): string =>
  field === 'ccy' || field === 'baseCcy' ? 'ccy' : field === 'adjustMode' ? 'adjust'
    : /(^date$|Date$)/.test(field) ? 'date' : 'text';   // valueDate / issueDate / expiryDate… → 日历

export const toneOf = (type: string): string => (type === 'BankParty' ? 'bank' : 'cust');

/** PageDef 的 grid 取值 → 全局布局 class。 */
export const gridClass = (g?: string): string =>
  ({ form: 'eg-form-grid', cards: 'eg-cards-grid', row: 'eg-rowfields', col: 'eg-colfields' } as Record<string, string>)[g || 'col'];

export const lastSeg = (path: string): string => path.slice(path.lastIndexOf('.') + 1);

// ── 运行时路径解析（按引擎 ViewNode 树）──────────────────────────────────────
/** 路径 → 节点（支持 slot 与 collection[i]）。path 形如 root / root.applicant / root.charges[0]。 */
export function resolveNode(state: SessionState, path: string): ViewNode | undefined {
  const toks = path.split('.');
  let node: ViewNode | undefined = state.tree;                  // toks[0] === 'root'
  for (let k = 1; k < toks.length; k++) {
    const tok = toks[k];
    const m = tok.match(/^(\w+)\[(\d+)\]$/);
    if (m) { node = node?.collections[m[1]]?.[+m[2]]; continue; }
    if (node?.slots && node.slots[tok]) { node = node.slots[tok]; continue; }
    node = undefined;
  }
  return node;
}

/** 引擎实时视图树 → 普通数据对象（递归 fields + collections + slots）：供保存/提交页面数据。
 *   含计算值（便于加载时 reconstructOverrides 从值反推覆盖）；重新加载走 createSession(ruleSet, data)。 */
export function treeToData(node: ViewNode): any {
  const o: any = {};
  for (const [f, c] of Object.entries(node.fields)) o[f] = c.value;
  for (const [coll, arr] of Object.entries(node.collections)) o[coll] = arr.map(treeToData);
  for (const [slot, sn] of Object.entries(node.slots)) o[slot] = treeToData(sn);
  return o;
}

/** 字段路径 → cell（末段为字段名）。 */
export function resolveCell(state: SessionState, path: string): Cell | undefined {
  const i = path.lastIndexOf('.');
  return resolveNode(state, path.slice(0, i))?.fields[path.slice(i + 1)];
}

/** 字段路径 → 字段 spec（从模型元数据按节点类型 + 继承链取）。 */
export function specAt(meta: EngineMeta, state: SessionState, path: string): { computed?: boolean; external?: boolean; overridable?: boolean; label?: string } {
  const i = path.lastIndexOf('.');
  const node = resolveNode(state, path.slice(0, i));
  return node ? (meta.effectiveFields(node.type)[path.slice(i + 1)] ?? {}) : {};
}
