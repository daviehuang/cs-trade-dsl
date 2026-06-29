// ngx-formly 桥接层：把【引擎的 ViewNode 树】翻译成 formly 字段配置（模型驱动渲染），
// 并用一组自定义字段类型把「编辑/取值/增删」全部委托回【增量引擎会话】。
//   设计要点：引擎是计算与校验的唯一真相源（符合"中台负责校验和计算"）。
//   formly 不持有数据、不跑自己的校验，只负责：① 根据 model.nodes 动态渲染字段树；
//   ② 通过自定义类型把交互回灌到引擎；③ 把引擎算出的值/校验渲染出来。
import { ChangeDetectorRef, Component, Directive, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FieldType, FieldTypeConfig, FieldWrapper, FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { Cell, Session, SessionState, ValidationView, ViewNode } from '../dsl/incremental';
import { buildMeta, EngineMeta } from './engine-meta';

const CCYS = ['USD', 'EUR', 'HKD', 'GBP', 'JPY', 'SGD', 'CNY'];

const SLOT_LABEL: Record<string, string> = {
  applicant: '申请人 Applicant', beneficiary: '受益人 Beneficiary',
  advisingBank: '通知行 Advising Bank', adviseThrough: '转通知行 Advise Through', reimbursingBank: '偿付行 Reimbursing Bank',
};
const FIELD_LABEL: Record<string, string> = {
  lcNo: '信用证号', baseCcy: '基准币种', valueDate: '起息日', maxNet: '净额上限', adjustMode: '手续调整方式',
  adjustment: '手续调整', chargeTotal: '收费合计', paymentTotal: '付费合计', net: '净额 net',
  name: '名称', address: '地址', country: '国家', taxId: '税号', contactPerson: '联系人', bic: 'BIC/SWIFT', account: '账号',
  groupName: '组名', subtotal: '小计', desc: '摘要', ccy: '币种', amount: '金额', fxRate: '汇率', base: '本币 base',
};
const COLL_LABEL: Record<string, string> = { charges: '收费组 Charges', items: '明细 Items', payments: '付费 Payments' };
const COLL_TEMPLATE: Record<string, () => any> = {
  charges: () => ({ groupName: '新收费组', items: [] }),
  items: () => ({ desc: '新明细', ccy: 'USD', amount: '0' }),
  payments: () => ({ ccy: 'USD', amount: '0' }),
};

/** 自定义类型从 props.ctx 拿到这个上下文，所有交互/取值都经它委托给引擎会话。 */
export interface EngineCtx {
  ccys: string[];
  valueOf(path: string): string;
  cellText(path: string): string;
  cellState(path: string): Cell['state'] | undefined;
  onInput(path: string, v: string): void;
  onOverride(path: string, v: string): void;
  clearOverride(path: string): void;
  addChild(parent: string, coll: string, obj: any): void;
  removeChild(path: string): void;
  validationsFor(path: string): ValidationView[];
  /** 注册「引擎更新」监听（用于让 OnPush 的 formly 子树在异步取数后 markForCheck）。返回注销函数。 */
  onTick(cb: () => void): () => void;
}

/**
 * 基于一个 Session 构建上下文：含路径→cell 解析（支持 slot 与 collection[i]）。
 * 返回 { ctx, notify }：宿主在引擎 onUpdate 时调 notify()，驱动各字段组件 markForCheck
 * —— formly 的 form/group 是 OnPush，异步 resolver 完成（无表单内 DOM 事件）时必须主动标脏。
 */
export function makeCtx(session: Session, getState: () => SessionState, rebuild: () => void): { ctx: EngineCtx; notify: () => void } {
  const listeners = new Set<() => void>();
  const resolveCell = (path: string): Cell | undefined => {
    const toks = path.split('.');
    let node: ViewNode | undefined = getState().tree;            // toks[0] === 'root'
    for (let k = 1; k < toks.length; k++) {
      const tok = toks[k];
      const m = tok.match(/^(\w+)\[(\d+)\]$/);
      if (m) { node = node?.collections[m[1]]?.[+m[2]]; continue; }
      if (node?.slots && node.slots[tok]) { node = node.slots[tok]; continue; }
      if (k === toks.length - 1) return node?.fields[tok];        // 末段 = 字段
      node = undefined;
    }
    return undefined;
  };
  const text = (c?: Cell) => (!c ? '—' : c.state === 'pending' ? '⏳ 计算中' : c.state === 'error' ? '✗ 错误' : (c.value ?? '—'));
  const ctx: EngineCtx = {
    ccys: CCYS,
    valueOf: (p) => resolveCell(p)?.value ?? '',
    cellText: (p) => text(resolveCell(p)),
    cellState: (p) => resolveCell(p)?.state,
    onInput: (p, v) => session.setInput(p, v),
    onOverride: (p, v) => { try { session.setOverride(p, v); } catch { /* 非 overridable 忽略 */ } },
    clearOverride: (p) => session.clearOverride(p),
    addChild: (parent, coll, obj) => { session.addChild(parent, coll, obj); rebuild(); },
    removeChild: (p) => { session.removeChild(p); rebuild(); },
    validationsFor: (p) => getState().validations.filter((v) => v.node === p && v.state === 'resolved'),
    onTick: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  return { ctx, notify: () => listeners.forEach((f) => f()) };
}

/** 动态字段组件公用：订阅引擎更新 → markForCheck（穿透 formly 的 OnPush 子树）。 */
@Directive()
abstract class TickAwareType extends FieldType<FieldTypeConfig> implements OnInit, OnDestroy {
  private _cdr = inject(ChangeDetectorRef);
  private _off?: () => void;
  ngOnInit(): void { this._off = this.props['ctx'].onTick(() => this._cdr.markForCheck()); }
  ngOnDestroy(): void { this._off?.(); }
}

// ── 字段树构建：把 ViewNode 翻译为 formly 配置 ───────────────────────────────
const controlOf = (field: string): string =>
  field === 'ccy' || field === 'baseCcy' ? 'ccy' : field === 'adjustMode' ? 'adjust' : 'text';
/** 这些节点的叶子字段横向排成一行（明细/付费/收费组），其余（卡片）纵向堆叠。 */
const ROW_TYPES = new Set(['ChargeGroup', 'ChargeItem', 'Payment']);
const toneOf = (type: string): string => (type === 'BankParty' ? 'bank' : 'cust');

/** 一个节点的叶子字段（可编辑 → eg-field；计算/外部值 → eg-cell）。 */
function leafFields(node: ViewNode, ctx: EngineCtx, meta: EngineMeta, only?: string[]): FormlyFieldConfig[] {
  const specs = meta.effectiveFields(node.type);
  const names = (only ?? Object.keys(node.fields)).filter((f) => f in node.fields);
  return names.map((f) => {
    const s = specs[f] ?? {};
    const path = node.path + '.' + f;
    const label = FIELD_LABEL[f] ?? f;
    if (s.computed || s.external)
      return { type: 'eg-cell', props: { ctx, path, label, overridable: !!s.overridable, external: !!s.external, big: f === 'net' } };
    return { type: 'eg-field', props: { ctx, path, label, control: controlOf(f) } };
  });
}

/** 叶子字段包一层布局容器（横向行 / 纵向列），让 formly 给容器加上对应 class。 */
function leafBlock(node: ViewNode, ctx: EngineCtx, meta: EngineMeta): FormlyFieldConfig | null {
  const leaves = leafFields(node, ctx, meta);
  if (!leaves.length) return null;
  return { fieldGroupClassName: ROW_TYPES.has(node.type) ? 'eg-rowfields' : 'eg-colfields', fieldGroup: leaves };
}

/** 递归把一个节点构建为 formly 字段组（叶子块 + 校验 + 槽位卡片 + 子集合）。 */
export function buildNodeGroup(node: ViewNode, ctx: EngineCtx, meta: EngineMeta): FormlyFieldConfig {
  const group: FormlyFieldConfig[] = [];
  const lb = leafBlock(node, ctx, meta);
  if (lb) group.push(lb);
  group.push({ type: 'eg-validations', className: 'span-all', props: { ctx, path: node.path } });

  for (const [name, child] of Object.entries(node.slots ?? {}))
    group.push({
      wrappers: ['eg-panel'],
      props: { label: SLOT_LABEL[name] ?? name, badge: child.type, variant: 'party', tone: toneOf(child.type) },
      fieldGroup: [buildNodeGroup(child, ctx, meta)],
    });

  for (const [coll, arr] of Object.entries(node.collections ?? {}))
    group.push({
      type: 'eg-collection',
      props: { ctx, parentPath: node.path, collName: coll, title: COLL_LABEL[coll] ?? coll, template: COLL_TEMPLATE[coll] },
      fieldGroup: arr.map((c) => buildNodeGroup(c, ctx, meta)),
    });

  return { props: { nodePath: node.path }, fieldGroup: group };
}

/** 顶层字段：把根记录分区到若干面板（主记录 / 当事方 / 收费 / 付费 / 结算）。 */
export function buildRootFields(state: SessionState, ruleSet: any, imports: any, ctx: EngineCtx): FormlyFieldConfig[] {
  const meta = buildMeta(ruleSet, imports);
  const root = state.tree;
  const scalarRoot = Object.keys(root.fields).filter((f) => {
    const s = meta.effectiveFields(root.type)[f] ?? {};
    return !s.computed && !s.external;                            // 主记录里的可编辑标量
  });
  const computedRoot = Object.keys(root.fields).filter((f) => {
    const s = meta.effectiveFields(root.type)[f] ?? {};
    return s.computed || s.external;                             // chargeTotal/paymentTotal/adjustment/net
  });

  return [
    {
      wrappers: ['eg-panel'], props: { label: '信用证主记录', variant: 'form' },
      fieldGroupClassName: 'eg-form-grid', fieldGroup: leafFields(root, ctx, meta, scalarRoot),
    },
    {
      wrappers: ['eg-panel'], props: { label: '当事方 Parties', badge: '具名槽位 · 继承自 Party · 校验按子类型分发', variant: 'cards' },
      fieldGroupClassName: 'eg-cards-grid',
      fieldGroup: Object.entries(root.slots ?? {}).map(([name, child]) => ({
        wrappers: ['eg-panel'],
        props: { label: SLOT_LABEL[name] ?? name, badge: child.type, variant: 'party', tone: toneOf(child.type) },
        fieldGroup: [
          { fieldGroupClassName: 'eg-colfields', fieldGroup: leafFields(child, ctx, meta) },
          { type: 'eg-validations', className: 'span-all', props: { ctx, path: child.path } },
        ],
      })),
    },
    {
      wrappers: ['eg-panel'], props: { label: '收费 Charges', badge: '组 → 明细 · 汇率由 fxConvert 模块异步注入', variant: 'flow' },
      fieldGroup: [{
        type: 'eg-collection', props: { ctx, parentPath: 'root', collName: 'charges', title: COLL_LABEL['charges'], template: COLL_TEMPLATE['charges'] },
        fieldGroup: (root.collections['charges'] ?? []).map((g) => buildNodeGroup(g, ctx, meta)),
      }],
    },
    {
      wrappers: ['eg-panel'], props: { label: '付费 Payments', variant: 'flow' },
      fieldGroup: [{
        type: 'eg-collection', props: { ctx, parentPath: 'root', collName: 'payments', title: COLL_LABEL['payments'], template: COLL_TEMPLATE['payments'] },
        fieldGroup: (root.collections['payments'] ?? []).map((p) => buildNodeGroup(p, ctx, meta)),
      }],
    },
    {
      wrappers: ['eg-panel'], props: { label: '结算 & 校验', badge: '计算值只读 · 引擎增量算出', variant: 'stats' },
      fieldGroup: [
        { fieldGroupClassName: 'eg-rowfields', fieldGroup: leafFields(root, ctx, meta, computedRoot) },
        { type: 'eg-validations', className: 'span-all', props: { ctx, path: 'root' } },
      ],
    },
  ];
}

// ── 自定义字段类型（standalone）─────────────────────────────────────────────

/** 可编辑字段：文本 / 币种下拉 / 调整方式下拉。值取自引擎、改动回灌引擎。 */
@Component({
  selector: 'eg-field', standalone: true, imports: [CommonModule],
  template: `
    <label class="l">{{ props.label }}
      @switch (props['control']) {
        @case ('ccy') {
          <select [value]="v()" (change)="set($any($event.target).value)">
            @for (c of props['ctx'].ccys; track c) { <option [value]="c">{{ c }}</option> }
          </select>
        }
        @case ('adjust') {
          <select [value]="v()" (change)="set($any($event.target).value)">
            <option value="auto-high">auto-high（收费50%）</option>
            <option value="auto-low">auto-low（收费10%）</option>
            <option value="manual">manual（人工录入）</option>
          </select>
        }
        @default { <input [value]="v()" (input)="set($any($event.target).value)" /> }
      }
    </label>`,
  styles: [`
    :host{display:block;min-width:0}
    .l{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#94a3b8;font-weight:500;letter-spacing:.01em}
    input,select{height:36px;padding:0 10px;border:1px solid #d4dbe6;border-radius:8px;font-size:13px;font-family:ui-monospace,Consolas,monospace;background:#fff;color:#1e293b;width:100%;box-sizing:border-box;transition:border-color .12s,box-shadow .12s}
    select{padding-right:4px;cursor:pointer}
    input:hover,select:hover{border-color:#b9c4d6}
    input:focus,select:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.13)}`],
})
export class EgFieldType extends TickAwareType {
  v() { return this.props['ctx'].valueOf(this.props['path']); }
  set(val: string) { this.props['ctx'].onInput(this.props['path'], val); }
}

/** 计算/外部值：只读展示（pending/error 着色）；overridable 字段额外给覆盖输入 + 复原。 */
@Component({
  selector: 'eg-cell', standalone: true, imports: [CommonModule],
  template: `
    <label class="l">{{ props.label }}
      @if (st()==='input') {
        <input class="cond" [value]="val()" (input)="inp($any($event.target).value)" title="条件可输入（守卫为假时合法录入）" />
      } @else if (props['overridable']) {
        <span class="row">
          <input class="ovr" [class.on]="st()==='overridden'" [value]="txt()" (input)="ovr($any($event.target).value)" title="可人工覆盖" />
          <button type="button" (click)="rv()" title="恢复计算">⟲</button>
        </span>
      } @else {
        <span class="cv" [class.big]="props['big']" [class.pend]="st()==='pending'" [class.err]="st()==='error'">{{ txt() }}</span>
      }
    </label>`,
  styles: [`
    :host{display:block;min-width:0}
    .l{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#94a3b8;font-weight:500;letter-spacing:.01em}
    .row{display:flex;gap:5px;align-items:center}
    .cv{height:36px;display:flex;align-items:center;padding:0 11px;border:1px dashed #cfd9e8;border-radius:8px;background:#f8fafc;color:#2563eb;font-family:ui-monospace,Consolas,monospace;font-size:13px;box-sizing:border-box}
    .cv.big{height:auto;padding:8px 13px;font-size:21px;font-weight:700;color:#0b3d6b;background:#eef4ff;border-style:solid;border-color:#cfe0f7}
    .cv.pend{color:#c2790b;border-color:#ecd6a8;background:#fdf8ee}.cv.err{color:#c0392b;border-color:#f0caca}
    .ovr{height:36px;flex:1;min-width:0;padding:0 11px;border:1px dashed #cfd9e8;border-radius:8px;background:#f8fafc;color:#2563eb;font-family:ui-monospace,Consolas,monospace;font-size:13px;box-sizing:border-box}
    .ovr:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.13)}
    .ovr.on{border:2px solid #2563eb;background:#eef5ff;font-weight:700}
    .cond{height:36px;padding:0 11px;border:2px solid #d98a26;border-radius:8px;background:#fffaf0;color:#a86609;font-weight:700;font-family:ui-monospace,Consolas,monospace;font-size:13px;width:100%;box-sizing:border-box}
    .cond:focus{outline:none;box-shadow:0 0 0 3px rgba(217,138,38,.18)}
    button{height:30px;background:#f1f6ff;border:1px solid #cfd9e8;color:#2563eb;border-radius:7px;padding:0 8px;cursor:pointer;font-size:13px}
    button:hover{background:#e4eeff;border-color:#9cb8e8}`],
})
export class EgCellType extends TickAwareType {
  txt() { return this.props['ctx'].cellText(this.props['path']); }
  st() { return this.props['ctx'].cellState(this.props['path']); }
  val() { return this.props['ctx'].valueOf(this.props['path']); }
  inp(v: string) { this.props['ctx'].onInput(this.props['path'], v); }
  ovr(v: string) { this.props['ctx'].onOverride(this.props['path'], v); }
  rv() { this.props['ctx'].clearOverride(this.props['path']); }
}

/** 节点校验：渲染该节点路径上引擎算出的校验结果（formly 自身不做校验）。 */
@Component({
  selector: 'eg-validations', standalone: true, imports: [CommonModule],
  template: `
    @if (items().length) {
      <div class="vl">
        @for (vd of items(); track vd.id + vd.node) {
          <span class="chip" [class.ok]="vd.ok" [class.bad]="!vd.ok" [title]="vd.message || ''">
            <i>{{ vd.ok ? '✔' : '✘' }}</i> {{ vd.id }}@if (!vd.ok) {<em>：{{ vd.message }}</em>}
          </span>
        }
      </div>
    }`,
  styles: [`
    :host{display:block}
    .vl{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
    .chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;padding:3px 10px;border-radius:20px;border:1px solid}
    .chip i{font-style:normal}
    .chip em{font-style:normal;opacity:.9}
    .chip.ok{color:#0e7a4f;background:#eaf7f0;border-color:#c3e6d2}
    .chip.bad{color:#c0392b;background:#fdecec;border-color:#f3c9c9}`],
})
export class EgValidationsType extends TickAwareType {
  items() { return this.props['ctx'].validationsFor(this.props['path']); }
}

/** 同构子集合：标题 + 添加按钮；逐项渲染子节点字段组（formly 递归）+ 删除按钮。 */
@Component({
  selector: 'eg-collection', standalone: true, imports: [CommonModule, FormlyModule],
  template: `
    <div class="coll">
      <div class="ch"><b>{{ props.label || props['title'] }} <span class="n">{{ field.fieldGroup?.length || 0 }}</span></b>
        <button type="button" class="add" (click)="add()">＋ 添加</button></div>
      @for (child of field.fieldGroup; track child; let i = $index) {
        <div class="item">
          <span class="idx">{{ i + 1 }}</span>
          <div class="body"><formly-field [field]="child"></formly-field></div>
          <button type="button" class="x" (click)="remove(child)" title="删除">✕</button>
        </div>
      } @empty { <div class="empty">（暂无，点「＋ 添加」新增一条）</div> }
    </div>`,
  styles: [`
    :host{display:block;grid-column:1/-1}
    .coll{border:1px solid #e6ebf2;border-radius:11px;padding:13px;background:#fafcff}
    .ch{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px}
    .ch b{color:#334155;font-size:13px;font-weight:600;display:flex;align-items:center;gap:7px}
    .ch .n{font-size:11px;font-weight:600;color:#64748b;background:#eef2f8;border-radius:20px;padding:1px 8px}
    .item{position:relative;display:flex;align-items:flex-start;gap:10px;border:1px solid #eef2f7;border-radius:10px;background:#fff;padding:12px 40px 12px 12px;margin-bottom:9px}
    .item:last-of-type{margin-bottom:0}
    .item .body{flex:1;min-width:0}
    .idx{flex:none;width:22px;height:22px;margin-top:2px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#64748b;background:#f1f5fb;border-radius:50%}
    .add{background:#ecfaf1;border:1px solid #bfe3cd;color:#0e7a4f;border-radius:8px;padding:5px 13px;cursor:pointer;font-size:12px;font-weight:600}
    .add:hover{background:#dcf3e6}
    .x{position:absolute;right:9px;top:11px;background:#fdf0f0;border:1px solid #f0d2d2;color:#c0392b;border-radius:7px;padding:3px 8px;cursor:pointer;font-size:12px}
    .x:hover{background:#fbe0e0}
    .empty{color:#94a3b8;font-size:12px;padding:4px 2px}`],
})
export class EgCollectionType extends TickAwareType {
  add() {
    const tpl = this.props['template'] ? this.props['template']() : {};
    this.props['ctx'].addChild(this.props['parentPath'], this.props['collName'], tpl);
  }
  remove(child: FormlyFieldConfig) {
    const path = child.props?.['nodePath'];
    if (path) this.props['ctx'].removeChild(path);
  }
}

/** 面板包裹器：标题 + 徽标 + 网格布局（按 variant 切换列型）；#fieldComponent 投影内部字段组。 */
@Component({
  selector: 'eg-panel', standalone: true, imports: [CommonModule],
  template: `
    <div class="panel" [ngClass]="['v-' + (props['variant'] || 'form'), props['tone'] ? 'tone-' + props['tone'] : '']">
      <div class="ph">
        <span class="ttl">{{ props.label }}</span>
        @if (props['badge']) { <span class="badge">{{ props['badge'] }}</span> }
      </div>
      <div class="body"><ng-template #fieldComponent></ng-template></div>
    </div>`,
  styles: [`
    :host{display:block;min-width:0}
    .panel{background:#fff;border:1px solid #e6ebf2;border-radius:13px;padding:17px 18px;margin-bottom:14px;box-shadow:0 1px 3px rgba(15,23,42,.05)}
    .ph{display:flex;align-items:center;gap:9px;margin-bottom:14px;flex-wrap:wrap}
    .ttl{font-size:12px;font-weight:700;color:#334155;letter-spacing:.05em;text-transform:uppercase}
    .badge{font-size:10px;font-weight:600;color:#2563eb;background:#eff4ff;border:1px solid #d6e2fb;border-radius:20px;padding:2px 10px;letter-spacing:.02em}
    .body{display:block}
    /* 当事方卡片 */
    .v-party{padding:14px;margin-bottom:0;border-radius:12px;background:#fbfcfe;height:100%;box-shadow:none}
    .v-party .ph{margin-bottom:12px}
    .v-party .ttl{font-size:11px;color:#475569;letter-spacing:.02em}
    .tone-bank.v-party{background:#f4f9ff;border-color:#d4e6fb}
    .tone-bank .badge{color:#0e7a4f;background:#e9f7ef;border-color:#c3e6d2}
    .tone-cust.v-party{background:#fcfbff;border-color:#e4e0fa}
    .tone-cust .badge{color:#6d4bd0;background:#f1edff;border-color:#ddd4f7}`],
})
export class EgPanelWrapper extends FieldWrapper {}

/** 注册到 FormlyModule.forRoot 的类型/包裹器清单。 */
export const ENGINE_FORMLY_TYPES = [
  { name: 'eg-field', component: EgFieldType },
  { name: 'eg-cell', component: EgCellType },
  { name: 'eg-validations', component: EgValidationsType },
  { name: 'eg-collection', component: EgCollectionType },
];
export const ENGINE_FORMLY_WRAPPERS = [{ name: 'eg-panel', component: EgPanelWrapper }];
