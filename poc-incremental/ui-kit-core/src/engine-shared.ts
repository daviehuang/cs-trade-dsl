// 纯函数 + 常量（无框架依赖）：被 绑定层、自动布局、hydrate、linter、各框架适配器共享。
// 这里集中放「领域标签 / 控件种类推导 / 路径解析 / EngineCtx 契约」等与渲染框架无关的逻辑。
import { Cell, SessionState, ValidationView, ViewNode } from './engine-types';
import { EngineMeta } from './engine-meta';

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

/** 按字段名推导控件种类（币种下拉 / 调整方式下拉 / 文本）。 */
export const controlOf = (field: string): string =>
  field === 'ccy' || field === 'baseCcy' ? 'ccy' : field === 'adjustMode' ? 'adjust' : 'text';

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
