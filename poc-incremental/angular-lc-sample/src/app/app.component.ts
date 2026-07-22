import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { EngineService } from './engine.service';
import { FxService } from './fx.service';
import { RuleRepositoryService } from './rule-repository.service';
import { Cell, RuleSet, Session, SessionState, ViewNode } from '@udsl/ui-kit-core';

interface LogLine { n: number; cls: string; text: string; }
const CCYS = ['USD', 'EUR', 'HKD', 'GBP', 'JPY', 'SGD', 'CNY'];
const BFF_URL = 'http://localhost:8787/api/settle';

@Component({
  selector: 'app-classic',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="feat">
    <label>功能 feature：
      <select [value]="featureId" (change)="selectFeature($any($event.target).value)">
        @for (f of features; track f.id) { <option [value]="f.id">{{ f.label }}</option> }
      </select>
    </label>
    <button type="button" class="topbtn" (click)="openModel()">📋 查看数据模型</button>
    @if (ruleSet) {
      <span class="muted">运行时已加载规则
        <code>{{ ruleSet.ruleSetId + '@' + ruleSet.version }}</code>
        @if (importNames.length) { · import <code>{{ importNames.join('、') }}</code> }
      </span>
    }
  </div>

  @if (loading) { <div class="wrap"><div class="panel">运行时加载规则与模块库中…</div></div> }
  @else if (error) { <div class="wrap"><div class="panel err">{{ error }}</div></div> }
  @else if (state) {
  <div class="wrap">
    <div>
      <!-- 主记录 -->
      <div class="panel"><h3>信用证主记录</h3><div class="hdr">
        <label>信用证号<input [value]="rootVal('lcNo')" disabled /></label>
        <label>基准币种<input [value]="rootVal('baseCcy')" (input)="onInput('root.baseCcy', $any($event.target).value)" /></label>
        <label>起息日<input [value]="rootVal('valueDate')" (input)="onInput('root.valueDate', $any($event.target).value)" /></label>
        <label>净额上限<input [value]="rootVal('maxNet')" (input)="onInput('root.maxNet', $any($event.target).value)" /></label>
        <label>手续调整方式
          <select [value]="rootVal('adjustMode')" (change)="onInput('root.adjustMode', $any($event.target).value)">
            <option value="auto-high">auto-high（收费50%）</option>
            <option value="auto-low">auto-low（收费10%）</option>
            <option value="manual">manual（人工录入）</option>
          </select>
        </label>
      </div></div>

      <!-- 当事方：5 个具名槽位共享 Party 基类，applicant/beneficiary=CustomerParty，*Bank=BankParty -->
      <div class="panel"><h3>当事方 Parties（具名槽位 · 继承自 Party 基类 · 字段/校验按子类型不同）</h3>
        <div class="party-grid">
          @for (sl of slotEntries(); track sl.name) {
            <div class="party-card" [class.bank]="sl.node.type==='BankParty'">
              <div class="party-h"><b>{{ slotLabel(sl.name) }}</b>
                <span class="party-type">{{ sl.node.type }}</span></div>
              @for (f of fieldKeys(sl.node); track f) {
                <label class="pf">{{ fieldLabel(f) }}
                  <input [value]="sl.node.fields[f].value"
                         (input)="onInput(sl.node.path + '.' + f, $any($event.target).value)" /></label>
              }
              @for (v of partyFails(sl.node.path); track v.id) {
                <div class="pf-err">✘ {{ v.message }}</div>
              }
            </div>
          }
        </div>
        <div class="hint">名称/国家校验来自 <code>scope:"Party"</code>（全员）；税号来自 <code>CustomerParty</code>；
          BIC 必填/格式来自 <code>BankParty</code> —— 同一份 Party 定义，子类型各自扩展，校验自动按层级分发。</div>
      </div>

      <!-- 收费：组 → 明细（汇率由 fxConvert 模块异步注入） -->
      <div class="panel"><h3>收费 Charges（组 → 明细，汇率异步注入）</h3>
        @for (g of state.tree.collections['charges']; track g.path) {
          <div class="group">
            <div class="group-h"><b>{{ g.fields['groupName'].value }}</b>
              <span>小计 =
                <input class="calc sub" [class.tampered]="isTampered(g.path + '.subtotal')"
                       [value]="computedVal(g, 'subtotal')"
                       (input)="onTamper(g.path + '.subtotal', $any($event.target).value)" />
                <button type="button" (click)="addItem(g.path)">+ 明细</button>
                <button type="button" class="x" (click)="removeNode(g.path)">✕ 组</button>
              </span>
            </div>
            <table>
              <thead><tr><th>明细</th><th>币种</th><th>金额</th><th>汇率（模块算）</th><th>本币 base（可覆盖）</th><th></th></tr></thead>
              <tbody>
                @for (it of g.collections['items']; track it.path) {
                  <tr>
                    <td>{{ it.fields['desc'].value }}</td>
                    <td>
                      <select [value]="it.fields['ccy'].value" (change)="onInput(it.path + '.ccy', $any($event.target).value)">
                        @for (c of ccys; track c) { <option [value]="c">{{ c }}</option> }
                      </select>
                    </td>
                    <td><input [value]="it.fields['amount'].value" (input)="onInput(it.path + '.amount', $any($event.target).value)" /></td>
                    <td class="cell" [class.s-pending]="isPending(it,'fxRate')" [class.s-error]="isError(it,'fxRate')">{{ cellText(it.fields['fxRate']) }}</td>
                    <td>
                      <input class="ovr cellc" [class.s-overridden]="isOverridden(it,'base')"
                             [value]="computedVal(it, 'base')" title="可人工覆盖"
                             (input)="onOverride(it.path + '.base', $any($event.target).value)" />
                      <button type="button" class="rv" title="恢复计算" (click)="revertOverride(it.path + '.base')">⟲</button>
                    </td>
                    <td><button type="button" class="x" (click)="removeNode(it.path)">✕</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <button type="button" class="addbig" (click)="addGroup()">+ 添加收费组</button>
      </div>

      <!-- 付费 -->
      <div class="panel"><h3>付费 Payments</h3>
        <table>
          <thead><tr><th>#</th><th>币种</th><th>金额</th><th>汇率（模块算）</th><th>本币 base</th><th></th></tr></thead>
          <tbody>
            @for (p of state.tree.collections['payments']; track p.path; let i = $index) {
              <tr>
                <td>{{ i + 1 }}</td>
                <td>
                  <select [value]="p.fields['ccy'].value" (change)="onInput(p.path + '.ccy', $any($event.target).value)">
                    @for (c of ccys; track c) { <option [value]="c">{{ c }}</option> }
                  </select>
                </td>
                <td><input [value]="p.fields['amount'].value" (input)="onInput(p.path + '.amount', $any($event.target).value)" /></td>
                <td class="cell" [class.s-pending]="isPending(p,'fxRate')" [class.s-error]="isError(p,'fxRate')">{{ cellText(p.fields['fxRate']) }}</td>
                <td><input class="calc cellc" [class.tampered]="isTampered(p.path + '.base')"
                           [value]="computedVal(p, 'base')"
                           (input)="onTamper(p.path + '.base', $any($event.target).value)" /></td>
                <td><button type="button" class="x" (click)="removeNode(p.path)">✕</button></td>
              </tr>
            }
          </tbody>
        </table>
        <button type="button" class="addbig" (click)="addPayment()">+ 添加付费</button>
      </div>

      <!-- 结算 -->
      <div class="panel"><h3>结算（计算值可编辑 —— 用于演示篡改）</h3>
        <div class="totals">
          <div><span class="k">收费合计</span>
            <input class="calc v" [class.tampered]="isTampered('root.chargeTotal')"
                   [value]="computedVal(state.tree, 'chargeTotal')"
                   (input)="onTamper('root.chargeTotal', $any($event.target).value)" /></div>
          <div><span class="k">付费合计</span>
            <input class="calc v" [class.tampered]="isTampered('root.paymentTotal')"
                   [value]="computedVal(state.tree, 'paymentTotal')"
                   (input)="onTamper('root.paymentTotal', $any($event.target).value)" /></div>
          <div><span class="k">{{ adjEditable ? '手续调整（人工录入，合法）' : '手续调整（自动计算，改即篡改）' }}</span>
            <input class="cond v" [class.cond-input]="adjEditable" [class.cond-calc]="!adjEditable"
                   [class.tampered]="isTampered('root.adjustment')"
                   [value]="computedVal(state.tree, 'adjustment')"
                   (input)="onAdjustment($any($event.target).value)" /></div>
          <div><span class="k">净额 net</span>
            <input class="calc net" [class.tampered]="isTampered('root.net')"
                   [value]="computedVal(state.tree, 'net')"
                   (input)="onTamper('root.net', $any($event.target).value)" /></div>
          <div><span class="status" [class.pending]="state.anyPending" [class.settled]="!state.anyPending">
            {{ state.anyPending ? '⏳ 异步取数中…' : '✅ 已结算' }}</span></div>
        </div>

        <ul class="vlist">
          @for (v of state.validations; track v.id + v.node) {
            <li [class.ok]="v.state==='resolved' && v.ok" [class.bad]="v.state==='resolved' && !v.ok" [class.warn]="v.state==='pending'">
              {{ v.state==='pending' ? '⏳' : v.ok ? '✔' : '✘' }} <b>{{ v.id }}</b>
              {{ v.state==='pending' ? '计算中…' : v.ok ? '通过' : v.message }}
            </li>
          }
        </ul>

        <h3 style="margin-top:13px">钉值快照（随交易提交后台复算）</h3>
        <div>
          @for (p of state.pinned; track p.field) {
            <div class="pin">{{ p.field }} = <b>{{ p.value }}</b> <span class="dim">{{ jstr(p.key) }} · {{ p.rateId }}</span></div>
          }
        </div>
      </div>

      <!-- 提交到中台 -->
      <div class="panel"><h3>提交到中台（BFF 权威校验）</h3>
        <div class="hint" style="margin-top:0">明细 base 是<b>可覆盖字段</b>（蓝色，可人工议定，随交易合法声明）；
          其余计算值（小计/合计/净额）<b>改即篡改</b>。中台 honor 合法覆盖、拒绝越权覆盖与篡改。</div>
        <div style="margin:11px 0">
          <button type="button" class="topbtn" (click)="submitToBff()">⬆ 提交到中台校验</button>
          <button type="button" (click)="resetTamper()">重置篡改</button>
          @if (tamperCount) { <span class="hint">⚠ 已篡改 {{ tamperCount }} 个计算值，提交将被中台拒绝</span> }
          @if (state.overrides.length) { <span class="hint" style="color:#0b6bc2">✎ 已人工覆盖 {{ state.overrides.length }} 个计算值（合法）</span> }
        </div>
        <div [innerHTML]="bffHtml"></div>
      </div>
    </div>

    <!-- 引擎事件 -->
    <div class="panel"><h3>引擎事件（观察增量与异步）</h3>
      <div class="hint" style="margin-top:0;margin-bottom:8px">最新在上。改一条最深明细，只触发它那条链的几条。</div>
      <div id="log">
        @for (l of logs; track l.n) { <div [class]="l.cls">{{ l.text }}</div> }
      </div>
    </div>
  </div>
  }

  <!-- 数据模型查看器 -->
  @if (modelOpen) {
  <div class="modal-bg on" (click)="onModalBg($event)">
    <div class="modal">
      <div class="modal-h"><b>当前数据模型（实时快照）</b>
        <span>
          <button type="button" (click)="copyModel()">复制</button>
          <button type="button" (click)="modelOpen=false">关闭 ✕</button>
        </span>
      </div>
      <div class="modal-tabs">
        <button type="button" class="tab" [class.on]="modelTab==='data'" (click)="modelTab='data'">数据 + 计算值</button>
        <button type="button" class="tab" [class.on]="modelTab==='state'" (click)="modelTab='state'">完整状态（含 state）</button>
        <button type="button" class="tab" [class.on]="modelTab==='pin'" (click)="modelTab='pin'">钉值快照</button>
      </div>
      <pre>{{ modelDump }}</pre>
    </div>
  </div>
  }
  `,
  styles: [`
    :host{display:block;background:#f3f5f9;color:#1c2430;font-family:"Segoe UI","Microsoft YaHei",sans-serif;min-height:100vh}
    .top{background:#0b3d6b;color:#fff;padding:13px 26px;display:flex;align-items:center;gap:10px}
    .top b{font-size:21px}.top .tag{font-size:16px;background:#1d5e96;padding:3px 9px;border-radius:10px}
    .feat{max-width:1180px;margin:14px auto 0;padding:0 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
    .muted{color:#6b7688;font-size:18px}code{background:#eef2f8;padding:1px 5px;border-radius:4px}
    .wrap{max-width:1180px;margin:14px auto;padding:0 16px;display:grid;grid-template-columns:1fr 390px;gap:15px}
    @media(max-width:980px){.wrap{grid-template-columns:1fr}}
    .panel{background:#fff;border:1px solid #e1e6ee;border-radius:9px;padding:15px;margin-bottom:13px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
    .panel.err{color:#c0392b}
    h3{margin:0 0 11px;font-size:17px;color:#5a6677;text-transform:uppercase;letter-spacing:.04em}
    .hdr{display:flex;gap:13px;flex-wrap:wrap}label{display:flex;flex-direction:column;gap:3px;font-size:17px;color:#6b7688}
    input,select{padding:6px 8px;border:1px solid #c8d0dc;border-radius:6px;font-size:18px;font-family:Consolas,monospace;background:#fff;color:#1c2430}
    input:focus,select:focus{outline:none;border-color:#0b6bc2}
    .group{border:1px solid #e6ebf2;border-radius:8px;margin-bottom:10px}
    .group-h{display:flex;justify-content:space-between;align-items:center;padding:8px 11px;background:#f6f8fc;border-bottom:1px solid #e6ebf2;font-size:18px}
    .group-h b{color:#34465c}.sub{font-family:Consolas,monospace;color:#0b6bc2}
    table{width:100%;border-collapse:collapse;font-size:18px}
    th{text-align:left;color:#8893a3;font-weight:500;padding:5px 9px;font-size:16px}
    td{padding:4px 9px;border-top:1px solid #f0f3f8}td input{width:96px}td.cell{font-family:Consolas,monospace}
    .s-pending{color:#c2790b}.s-error{color:#c0392b}
    .totals{display:flex;gap:26px;flex-wrap:wrap;font-family:Consolas,monospace}.totals .k{display:block;font-size:16px;color:#8893a3;font-family:inherit}
    .status{font-size:17px;padding:5px 11px;border-radius:8px}
    .status.pending{background:#fdf0d5;color:#a86609}.status.settled{background:#e3f5ea;color:#1c8a4e}
    ul.vlist{list-style:none;padding:0;margin:8px 0 0}li{padding:5px 0;font-size:18px}li.ok{color:#1c8a4e}li.bad{color:#c0392b}li.warn{color:#c2790b}
    .pin{font-family:Consolas,monospace;font-size:16px;color:#6b7688;padding:2px 0}.pin b{color:#1c2430}.dim{color:#9aa3b2}
    #log{height:560px;overflow:auto;font-family:Consolas,monospace;font-size:17px;line-height:1.5}
    #log>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lg-fetch{color:#0b6bc2}.lg-res{color:#1c8a4e}.lg-pend{color:#c2790b}.lg-err{color:#c0392b}.lg-calc{color:#7a8499}.lg-div{color:#aab2bf;margin:4px 0 2px}
    .hint{color:#8893a3;font-size:17px;margin-top:8px}.hint b{color:#3b4658}
    .party-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:11px}
    .party-card{border:1px solid #e1e6ee;border-radius:8px;padding:11px 12px;background:#fbfcfe}
    .party-card.bank{background:#f5f9fd;border-color:#cfe0f2}
    .party-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:6px}
    .party-h b{font-size:18px;color:#34465c}
    .party-type{font-size:15px;color:#0b6bc2;background:#e9f1fb;border-radius:9px;padding:1px 7px;white-space:nowrap}
    .party-card.bank .party-type{color:#1c8a4e;background:#e6f5ec}
    label.pf{display:flex;flex-direction:column;gap:2px;font-size:16px;color:#6b7688;margin-bottom:6px}
    label.pf input{width:100%}
    .pf-err{color:#c0392b;font-size:16px;margin-top:3px}
    button{background:#eef3fb;border:1px solid #c8d4e6;color:#0b6bc2;border-radius:6px;padding:3px 9px;font-size:17px;cursor:pointer;margin-left:6px}
    button:hover{background:#e0eaf8;border-color:#0b6bc2}button.x{color:#b03030;border-color:#e6c8c8;background:#fbf0f0;padding:2px 7px;margin:0}
    button.addbig{margin:10px 0 0;color:#1c8a4e;border-color:#bfe3cd;background:#f0f9f3}
    .topbtn{background:#1d5e96;border:1px solid #2a7bc0;color:#fff;padding:5px 12px;font-size:18px;margin:0}.topbtn:hover{background:#2a7bc0}
    input.calc{border:1px dashed #cdd8e8;background:#fafcff;color:#0b6bc2;font-family:Consolas,monospace;padding:3px 6px;width:104px}
    input.calc.sub{width:94px}input.calc.cellc{width:92px}input.calc.v{width:96px;font-size:20px}
    input.calc.net{font-size:27px;width:128px;font-weight:bold;padding:2px 6px}
    input.tampered{border:2px solid #d9534f !important;background:#fdeeee;color:#b03030}
    input.ovr{border:1px dashed #cdd8e8;background:#fafcff;color:#0b6bc2;font-family:Consolas,monospace;padding:3px 6px;width:88px}
    input.ovr.s-overridden{border:2px solid #0b6bc2 !important;background:#eef5ff;font-weight:bold}
    button.rv{margin:0 0 0 2px;padding:2px 5px;color:#0b6bc2;border-color:#cdd8e8;background:#f4f8ff}
    input.cond{font-family:Consolas,monospace;padding:4px 8px;width:118px;font-size:20px;border-radius:6px}
    input.cond.cond-calc{border:1px solid #e1e6ee;background:#f4f6fb;color:#5a6677}
    input.cond.cond-input{border:2px solid #c2790b;background:#fffaf0;color:#a86609;font-weight:bold}
    .bff-ok{color:#1c8a4e;font-weight:bold;font-size:19px}.bff-bad{color:#c0392b;font-weight:bold;font-size:19px}
    .modal-bg{position:fixed;inset:0;background:rgba(10,25,45,.55);z-index:50;display:flex;align-items:center;justify-content:center}
    .modal{background:#fff;border-radius:10px;width:min(760px,92vw);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.3)}
    .modal-h{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border-bottom:1px solid #e6ebf2}
    .modal-h b{font-size:19px;color:#34465c}
    .modal-tabs{display:flex;gap:6px;padding:10px 16px 0}
    .tab{margin:0;background:#f1f5fb;border:1px solid #d6e0ee;color:#5a6677}.tab.on{background:#0b6bc2;color:#fff;border-color:#0b6bc2}
    .modal pre{margin:12px 16px 16px;overflow:auto;background:#0f1728;color:#d6e3f5;border-radius:8px;padding:14px;font-family:Consolas,monospace;font-size:17px;line-height:1.5}
  `],
})
export class AppComponent implements OnInit {
  private engine = inject(EngineService);
  private fx = inject(FxService);
  private repo = inject(RuleRepositoryService);

  features = [{ id: 'lcSettlement', label: '信用证结算（多层嵌套 + 模块化汇率）' }];
  featureId = this.features[0].id;
  ccys = CCYS;

  loading = false;
  error: string | null = null;
  ruleSet: RuleSet | null = null;
  importNames: string[] = [];
  state: SessionState | null = null;

  private session: Session | null = null;
  /** 被篡改的计算值：key=字段路径(如 root.net)，value=用户改成的值。不进引擎，仅随提交注入。 */
  private tamper: Record<string, string> = {};
  logs: LogLine[] = [];
  private logSeq = 0;

  // 数据模型查看器
  modelOpen = false;
  modelTab: 'data' | 'state' | 'pin' = 'data';
  bffHtml = '';

  ngOnInit(): void { this.selectFeature(this.featureId); }

  selectFeature(id: string): void {
    this.featureId = id;
    this.loading = true;
    this.error = null;
    this.state = null;
    this.session = null;
    this.tamper = {};
    this.logs = [];
    this.logSeq = 0;
    this.repo.loadFeature(id).subscribe({
      next: ({ ruleSet, imports, data }) => {
        this.ruleSet = ruleSet;
        this.importNames = Object.keys(imports);
        // 运行时创建会话：注入宿主汇率解析器 + import 模块库注册表
        this.session = this.engine.createSession(ruleSet, structuredClone(data), {
          resolve: this.fx.resolve,
          imports,
          onUpdate: (s) => { this.state = s; this.refreshModel(); },
          onLog: (e) => this.appendLog(e),
        });
        // 加载后从已存字段值反推人工覆盖（外部依赖字段从 data 汇率种回 resolver，无需 pins）。
        try { this.session.reconstructOverrides(structuredClone(data)); } catch { /* 忽略 */ }
        this.state = this.session.getState();
        this.loading = false;
      },
      error: (e) => { this.error = '运行时加载规则失败：' + (e?.message ?? e); this.loading = false; },
    });
  }

  // ── 取值助手（视图驱动自 getState()）──
  rootVal(field: string): string {
    const c = this.state!.tree.fields[field];
    return c?.value ?? '';
  }
  /** 计算字段的显示值：被篡改则显示用户值，否则显示引擎值（含 pending/error 标记）。 */
  computedVal(node: ViewNode, field: string): string {
    const key = node.path + '.' + field;
    if (this.tamper[key] !== undefined) return this.tamper[key];
    return this.cellText(node.fields[field]);
  }
  cellText(c: Cell | undefined): string {
    if (!c) return '—';
    if (c.state === 'pending') return '⏳ 计算中';
    if (c.state === 'error') return '✗ 错误';
    return c.value ?? '—';
  }
  isPending(node: ViewNode, field: string): boolean { return node.fields[field]?.state === 'pending'; }
  isError(node: ViewNode, field: string): boolean { return node.fields[field]?.state === 'error'; }
  isOverridden(node: ViewNode, field: string): boolean { return node.fields[field]?.state === 'overridden'; }
  isTampered(path: string): boolean { return this.tamper[path] !== undefined; }
  get tamperCount(): number { return Object.keys(this.tamper).length; }
  get adjEditable(): boolean { return this.state?.tree.fields['adjustment']?.state === 'input'; }
  jstr(o: unknown): string { return JSON.stringify(o); }

  // ── 当事方槽位（具名单节点）──
  private SLOT_LABEL: Record<string, string> = {
    applicant: '申请人 Applicant', beneficiary: '受益人 Beneficiary',
    advisingBank: '通知行 Advising Bank', adviseThrough: '转通知行 Advise Through', reimbursingBank: '偿付行 Reimbursing Bank',
  };
  private FIELD_LABEL: Record<string, string> = {
    name: '名称', address: '地址', country: '国家', taxId: '税号', contactPerson: '联系人', bic: 'BIC/SWIFT', account: '账号',
  };
  slotEntries(): { name: string; node: ViewNode }[] {
    return Object.entries(this.state?.tree.slots ?? {}).map(([name, node]) => ({ name, node }));
  }
  fieldKeys(node: ViewNode): string[] { return Object.keys(node.fields); }
  slotLabel(n: string): string { return this.SLOT_LABEL[n] ?? n; }
  fieldLabel(f: string): string { return this.FIELD_LABEL[f] ?? f; }
  partyFails(path: string) {
    return (this.state?.validations ?? []).filter((v) => v.node === path && v.state === 'resolved' && !v.ok);
  }

  // ── 编辑委托 ──
  onInput(path: string, value: string): void { this.logDiv('改 ' + path); this.session!.setInput(path, value); }
  onOverride(path: string, value: string): void { this.logDiv('覆盖 ' + path); try { this.session!.setOverride(path, value); } catch { /* 非法覆盖忽略 */ } }
  revertOverride(path: string): void { this.logDiv('清除覆盖 ' + path); this.session!.clearOverride(path); }
  onTamper(path: string, value: string): void { this.tamper[path] = value; }
  /** 条件字段 adjustment：可输入态=合法输入(进引擎)；公式态=篡改(仅随提交)。 */
  onAdjustment(value: string): void {
    if (this.adjEditable) { delete this.tamper['root.adjustment']; this.onInput('root.adjustment', value); }
    else this.tamper['root.adjustment'] = value;
  }

  // ── 增删 ──
  addItem(groupPath: string): void { this.logDiv('addChild ' + groupPath + '.items'); this.session!.addChild(groupPath, 'items', { desc: '新明细', ccy: 'USD', amount: '0' }); }
  addGroup(): void { this.logDiv('addChild root.charges'); this.session!.addChild('root', 'charges', { groupName: '新收费组', items: [] }); }
  addPayment(): void { this.logDiv('addChild root.payments'); this.session!.addChild('root', 'payments', { ccy: 'USD', amount: '0' }); }
  removeNode(path: string): void { this.logDiv('removeChild ' + path); this.session!.removeChild(path); }

  resetTamper(): void { this.tamper = {}; this.bffHtml = ''; }

  // ── 引擎事件日志 ──
  private appendLog(e: any): void {
    let cls = 'lg-calc', text: string;
    if (e.state === 'fetching') { cls = 'lg-fetch'; text = `⏳ 取数 ${e.id}  ${e.key ?? ''}`; }
    else if (e.kind === 'resolver' && e.state === 'resolved') { cls = 'lg-res'; text = `✓ ${e.id} = ${e.value} (${e.rateId})`; }
    else if (e.state === 'pending') { cls = 'lg-pend'; text = `• ${e.id} → 计算中`; }
    else if (e.state === 'error') { cls = 'lg-err'; text = `✗ ${e.id} ${e.error ?? ''}`; }
    else { text = `• ${e.id} = ${e.value ?? 'null'}`; }
    this.logs.unshift({ n: ++this.logSeq, cls, text: `${this.logSeq}. ${text}` });
    if (this.logs.length > 300) this.logs.length = 300;
  }
  private logDiv(t: string): void { this.logs.unshift({ n: ++this.logSeq, cls: 'lg-div', text: '──── ' + t + ' ────' }); }

  // ── 数据模型查看器 ──
  get modelDump(): string {
    if (!this.state) return '';
    if (this.modelTab === 'data') return JSON.stringify(this.modelOf(this.state.tree), null, 2);
    if (this.modelTab === 'state') return JSON.stringify({ tree: this.state.tree, validations: this.state.validations, anyPending: this.state.anyPending }, null, 2);
    return JSON.stringify(this.state.pinned, null, 2);
  }
  private modelOf(node: ViewNode): any {
    const o: any = { _type: node.type };
    for (const [f, c] of Object.entries(node.fields)) o[f] = c.state === 'resolved' ? c.value : `<${c.state}>`;
    for (const [slot, child] of Object.entries(node.slots ?? {})) o[slot] = this.modelOf(child);   // 具名槽位
    for (const [coll, arr] of Object.entries(node.collections)) if (arr.length) o[coll] = arr.map((n) => this.modelOf(n));
    return o;
  }
  openModel(): void { this.modelOpen = true; }
  onModalBg(ev: MouseEvent): void { if ((ev.target as HTMLElement).classList.contains('modal-bg')) this.modelOpen = false; }
  copyModel(): void { navigator.clipboard?.writeText(this.modelDump); }
  private refreshModel(): void { /* modelDump 是 getter，模板自动刷新 */ }

  // ── 提交到中台（BFF 权威校验）──
  private buildSubmitTree(node: ViewNode): any {
    const o: any = { _type: node.type };
    for (const [f, c] of Object.entries(node.fields)) {
      const key = node.path + '.' + f;
      o[f] = this.tamper[key] !== undefined ? this.tamper[key]
        : (c.state === 'resolved' || c.state === 'overridden' || c.state === 'input') ? c.value : null;
    }
    for (const [coll, arr] of Object.entries(node.collections)) if (arr.length) o[coll] = arr.map((n) => this.buildSubmitTree(n));
    return o;
  }
  async submitToBff(): Promise<void> {
    const st = this.state!;
    if (st.anyPending) { this.bffHtml = `<div class="bff-bad">有字段仍在异步取数，请稍候再提交。</div>`; return; }
    this.bffHtml = `<span class="hint">提交中台校验中…</span>`;
    // 钉值随汇率篡改一并提交（模拟攻击者连钉值一起改 → 中台权威复核仍能识破）
    const pinnedSubmit = st.pinned.map((p) => {
      const key = p.field; // 钉值 field 形如 root.charges[0].items[0].fx.rate
      return this.tamper[key] !== undefined ? { ...p, value: this.tamper[key] } : p;
    });
    try {
      const r = await fetch(BFF_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ruleSetId: this.ruleSet!.ruleSetId, tree: this.buildSubmitTree(st.tree), pinned: pinnedSubmit, overrides: st.overrides }),
      });
      this.renderBff(await r.json());
    } catch (e: any) {
      this.bffHtml = `<div class="bff-bad">⚠ 无法连接中台 BFF。请先启动：<code>node bff/server.js</code><br><span class="hint">(${e.message})</span></div>`;
    }
  }
  private renderBff(d: any): void {
    if (d.error) { this.bffHtml = `<div class="bff-bad">中台错误：${d.error}</div>`; return; }
    if (d.verdict === 'ACCEPT') {
      this.bffHtml = `<div class="bff-ok">✅ 中台接受。权威重算 净额 net = ${d.serverComputed.net}。</div>`
        + (d.overridesApplied?.length
          ? `<div class="hint">已接受 ${d.overridesApplied.length} 处合法人工覆盖：${d.overridesApplied.map((o: any) => o.field + '=' + o.value).join('、')}</div>`
          : `<div class="hint">与前端一致，未发现篡改。</div>`);
    } else if (d.verdict === 'REJECT_TAMPER') {
      const kindTxt: Record<string, string> = { computed: '计算值篡改', rate: '钉值汇率', 'rate-unknown': '未知汇率', 'unauth-override': '越权覆盖' };
      this.bffHtml = `<div class="bff-bad">⛔ 中台拒绝：检测到 ${d.divergences.length} 处不一致（已权威复核 ${d.rateChecked} 条钉值汇率）。</div>`
        + `<table class="dv"><thead><tr><th>字段</th><th>类型</th><th>前端提交</th><th>中台权威值</th></tr></thead><tbody>`
        + d.divergences.map((x: any) => `<tr><td>${x.field}</td><td>${kindTxt[x.kind] || x.kind}</td><td>${x.client}</td><td>${x.server}</td></tr>`).join('')
        + `</tbody></table><div class="hint">计算值以中台重算为准；钉值汇率以中台权威汇率源按容差复核。</div>`;
    } else {
      const fails = (d.validations || []).filter((v: any) => v.state === 'resolved' && !v.ok);
      this.bffHtml = `<div class="bff-bad">⚠ 中台拒绝：业务校验未通过。</div><ul>${fails.map((v: any) => `<li class="bad">✘ ${v.id}：${v.message || ''}</li>`).join('')}</ul>`;
    }
  }
}
