import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyModule, FormlyFieldConfig } from '@ngx-formly/core';

import { EngineService } from '../engine.service';
import { FxService } from '../fx.service';
import { RuleRepositoryService, FeatureSummary } from '../rule-repository.service';
import {
  RuleSet, Session, SessionState, ViewNode,
  EngineCtx, buildMeta, EngineMeta, lintPageDef, LintIssue, PageDef, attachResetWatcher,
} from '@udsl/ui-kit-core';
import { buildRootFields, makeCtx } from './engine-formly';
import { hydratePage } from './hydrator';

const BFF_URL = 'http://localhost:8787/api/settle';

/**
 * ngx-formly 版样本：与手写版【同一份运行时加载的 RuleSet + 同一引擎 + 同一 BFF】，
 * 区别仅在渲染方式——表单字段由 model.nodes 模型驱动地生成（formly 动态渲染），
 * 编辑/取值/增删/校验全部委托回增量引擎（引擎是计算与校验的唯一真相源）。
 */
@Component({
  selector: 'app-formly',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormlyModule],
  template: `
  <div class="feat">
    <label>功能 feature：
      <select [value]="featureId" (change)="selectFeature($any($event.target).value)">
        @for (f of features; track f.id) { <option [value]="f.id">{{ f.title || f.id }}</option> }
      </select>
    </label>
    @if (ruleSet) {
      <span class="muted">运行时已加载 <code>{{ ruleSet.ruleSetId + '@' + ruleSet.version }}</code>
        @if (importNames.length) { · import <code>{{ importNames.join('、') }}</code> }
        · <b>由 model 模型驱动 ngx-formly 动态渲染</b></span>
    }
    @if (state) {
      <span class="status" [class.pending]="state.anyPending" [class.settled]="!state.anyPending">
        {{ state.anyPending ? '⏳ 异步取数中…' : '✅ 已结算' }}</span>
    }
  </div>

  @if (loading) { <div class="wrap"><div class="ph">运行时加载规则与模块库中…</div></div> }
  @else if (error) { <div class="wrap"><div class="ph err">{{ error }}</div></div> }
  @else {
    <div class="wrap">
      <div class="srcbar">
        <span class="lbl">界面来源：</span>
        <div class="seg">
          <button type="button" [class.on]="layoutSource==='auto'" (click)="setSource('auto')">模型自动生成</button>
          <button type="button" [class.on]="layoutSource==='page'" (click)="setSource('page')" [disabled]="!pageDef">自定义 PageDef（编辑器产物）</button>
        </div>
        @if (layoutSource==='page' && pageDef) {
          @if (errorCount) { <span class="lint bad">⛔ PageDef 校验 {{ errorCount }} 个错误 —— 已回退自动布局</span> }
          @else if (warnCount) { <span class="lint warn">⚠ PageDef 校验通过（{{ warnCount }} 个提醒）</span> }
          @else { <span class="lint ok">✔ PageDef 校验通过（lint）</span> }
        } @else if (layoutSource==='auto') {
          <span class="hint">字段由运行时 RuleSet 的 <code>model.nodes</code> 自动生成</span>
        }
      </div>
      @if (layoutSource==='page' && lintIssues.length) {
        <div class="lintlist">
          @for (i of lintIssues; track $index) {
            <div class="li" [class.bad]="i.level==='error'" [class.warn]="i.level==='warn'">
              {{ i.level==='error'?'⛔':i.level==='warn'?'⚠':'ℹ' }} <code>{{ i.path }}</code> {{ i.message }}
            </div>
          }
        </div>
      }

      <form [formGroup]="form">
        <formly-form [form]="form" [fields]="fields" [model]="model"></formly-form>
      </form>

      <div class="actions">
        <button type="button" class="topbtn" (click)="submitToBff()">⬆ 提交到中台校验</button>
        @if (state && state.overrides.length) {
          <span class="hint">✎ 已人工覆盖 {{ state.overrides.length }} 个计算值（合法）</span>
        }
      </div>
      <div [innerHTML]="bffHtml"></div>
    </div>
  }
  `,
  styles: [`
    :host{display:block}
    .feat{max-width:1180px;margin:14px auto 0;padding:0 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
    .muted{color:#6b7688;font-size:13px}.muted b{color:#0b6bc2}
    code{background:#eef2f8;padding:1px 5px;border-radius:4px}
    label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#6b7688}
    select{padding:6px 8px;border:1px solid #c8d0dc;border-radius:6px;font-size:13px;background:#fff}
    .status{font-size:12px;padding:5px 11px;border-radius:8px}
    .status.pending{background:#fdf0d5;color:#a86609}.status.settled{background:#e3f5ea;color:#1c8a4e}
    .wrap{max-width:1180px;margin:14px auto;padding:0 16px}
    .ph{background:#fff;border:1px solid #e1e6ee;border-radius:9px;padding:15px}.ph.err{color:#c0392b}
    .actions{margin:6px 0 11px;display:flex;gap:12px;align-items:center}
    .topbtn{background:#1d5e96;border:1px solid #2a7bc0;color:#fff;padding:6px 13px;font-size:13px;border-radius:6px;cursor:pointer}
    .topbtn:hover{background:#2a7bc0}
    .hint{color:#8893a3;font-size:12px}
    .srcbar{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin:2px 0 13px}
    .srcbar .lbl{font-size:12px;color:#64748b;font-weight:500}
    .seg{display:inline-flex;border:1px solid #d4dbe6;border-radius:9px;overflow:hidden}
    .seg button{background:#fff;border:none;color:#475569;padding:7px 14px;font-size:13px;cursor:pointer;border-right:1px solid #e6ebf2}
    .seg button:last-child{border-right:none}
    .seg button.on{background:#1d5e96;color:#fff;font-weight:600}
    .seg button:disabled{color:#b6c0cf;cursor:not-allowed}
    .lint{font-size:12px;padding:4px 11px;border-radius:8px;font-weight:500}
    .lint.ok{background:#e9f7ef;color:#0e7a4f}.lint.warn{background:#fdf3e0;color:#a86609}.lint.bad{background:#fdecec;color:#c0392b}
    .lintlist{margin:0 0 13px;border:1px solid #f0d9d9;border-radius:9px;overflow:hidden}
    .lintlist .li{font-size:12px;padding:6px 12px;border-top:1px solid #f6e8e8;background:#fffafa;color:#8a5a5a}
    .lintlist .li:first-child{border-top:none}
    .lintlist .li.bad{color:#c0392b}.lintlist .li.warn{color:#a86609;background:#fffdf6}
    .lintlist code{background:#f1f5fb;color:#475569;padding:1px 5px;border-radius:4px}
    .bff-ok{color:#1c8a4e;font-weight:bold;font-size:14px}.bff-bad{color:#c0392b;font-weight:bold;font-size:14px}
    table.dv{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
    table.dv th{text-align:left;color:#8893a3;padding:4px 8px}table.dv td{padding:3px 8px;border-top:1px solid #f0f3f8;font-family:Consolas,monospace}
  `],
})
export class FormlyLcComponent implements OnInit {
  private engine = inject(EngineService);
  private fx = inject(FxService);
  private repo = inject(RuleRepositoryService);
  private http = inject(HttpClient);

  featureId = '';
  features: FeatureSummary[] = [];
  loading = false;
  error: string | null = null;
  ruleSet: RuleSet | null = null;
  importNames: string[] = [];
  state: SessionState | null = null;

  form = new FormGroup({});
  model: Record<string, any> = {};
  fields: FormlyFieldConfig[] = [];

  // 界面来源：auto=按 model 自动生成（回退）；page=运行时加载的自定义 PageDef（编辑器产物）。
  layoutSource: 'auto' | 'page' = 'auto';
  pageDef: PageDef | null = null;
  lintIssues: LintIssue[] = [];

  private session: Session | null = null;
  private ctx!: EngineCtx;
  private notify: () => void = () => {};
  private resetWatch: { seed: () => void; run: () => void } | null = null;  // 联动重置 watcher（计划 ②）
  private importsReg: Record<string, RuleSet> = {};
  private meta: EngineMeta | null = null;
  bffHtml = '';

  get errorCount(): number { return this.lintIssues.filter((i) => i.level === 'error').length; }
  get warnCount(): number { return this.lintIssues.filter((i) => i.level === 'warn').length; }

  ngOnInit(): void {
    // 先拉仓库目录 → 默认选第一笔交易 → 运行时按 feature 拉齐 bundle。
    this.repo.catalog().subscribe({
      next: (feats) => {
        this.features = feats;
        this.featureId = feats[0]?.id ?? '';
        if (this.featureId) this.load(this.featureId);
        else this.error = '仓库暂无 feature（先在编辑器「保存到仓库」）';
      },
      error: (e) => { this.error = '加载仓库目录失败：' + (e?.message ?? e) + '（store-server 是否已启动？node store-server.js）'; },
    });
  }

  /** 下拉切换 feature：重新运行时加载。 */
  selectFeature(id: string): void { if (id && id !== this.featureId) { this.featureId = id; this.load(id); } }

  /** 运行时按 featureId 拉齐 bundle（规则集 + 库 + 页面 + 数据），建会话并渲染。 */
  private load(featureId: string): void {
    this.loading = true; this.error = null; this.bffHtml = '';
    this.repo.loadFeature(featureId).subscribe({
      next: ({ ruleSet, imports, data, pageDef }) => {
        this.ruleSet = ruleSet;
        this.importNames = Object.keys(imports);
        this.importsReg = imports;
        this.session = this.engine.createSession(ruleSet, structuredClone(data), {
          resolve: this.fx.resolve,
          imports,
          // 异步取数/增量更新 → 先跑联动重置 → notify() 让各字段组件 markForCheck（穿透 formly 的 OnPush 子树）。
          //   run() 内清空会再触发 onUpdate（被重入守卫吞掉），故用 getState() 取重置后最新态。
          onUpdate: (s) => { this.resetWatch?.run(); this.state = this.session ? this.session.getState() : s; this.notify(); },
        });
        // 联动重置 watcher（计划 ②）：规则来自 pageDef.resetRules；seed 记录基线（不触发，尊重既有数据）。
        this.resetWatch = attachResetWatcher(this.session, pageDef?.resetRules);
        this.resetWatch.seed();
        this.state = this.session.getState();
        this.meta = buildMeta(ruleSet, imports);
        // 结构变化（增删子记录）时重建 formly 字段树；编辑/异步取数只刷新值（模板方法实时读引擎）。
        const built = makeCtx(this.session, () => this.session!.getState(), () => this.rebuild());
        this.ctx = built.ctx;
        this.notify = built.notify;
        // 自定义 PageDef 直接来自仓库 bundle（编辑器产物）；加载后用 model 做 lint（发布期护栏）。
        this.pageDef = pageDef ?? null;
        this.lintIssues = pageDef ? lintPageDef(pageDef, ruleSet, this.importsReg) : [];
        // 有页面且校验通过 → 默认展示自定义页面；否则回退模型自动布局。
        this.layoutSource = pageDef && this.errorCount === 0 ? 'page' : 'auto';
        this.rebuild();
        this.loading = false;
      },
      error: (e) => { this.error = '运行时加载 feature「' + featureId + '」失败：' + (e?.message ?? e); this.loading = false; },
    });
  }

  setSource(s: 'auto' | 'page'): void { this.layoutSource = s; this.rebuild(); }

  /** PageDef 模式且 lint 无错误时用 hydrator 装配；否则回退到 model 自动生成。 */
  private rebuild(): void {
    const st = this.session!.getState();
    if (this.layoutSource === 'page' && this.pageDef && this.meta && this.errorCount === 0)
      this.fields = hydratePage(this.pageDef, this.ctx, st, this.meta);
    else
      this.fields = buildRootFields(st, this.ruleSet, this.importsReg, this.ctx);
  }

  // ── 提交到中台（BFF 权威校验，复用与手写版相同的接口）──
  private buildSubmitTree(node: ViewNode): any {
    const o: any = { _type: node.type };
    for (const [f, c] of Object.entries(node.fields))
      o[f] = (c.state === 'resolved' || c.state === 'overridden' || c.state === 'input') ? c.value : null;
    for (const [slot, child] of Object.entries(node.slots ?? {})) o[slot] = this.buildSubmitTree(child);
    for (const [coll, arr] of Object.entries(node.collections)) if (arr.length) o[coll] = arr.map((n) => this.buildSubmitTree(n));
    return o;
  }
  async submitToBff(): Promise<void> {
    const st = this.state!;
    if (st.anyPending) { this.bffHtml = `<div class="bff-bad">有字段仍在异步取数，请稍候再提交。</div>`; return; }
    this.bffHtml = `<span class="hint">提交中台校验中…</span>`;
    try {
      const r = await fetch(BFF_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ruleSetId: this.ruleSet!.ruleSetId, tree: this.buildSubmitTree(st.tree), pinned: st.pinned, overrides: st.overrides }),
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
      this.bffHtml = `<div class="bff-bad">⛔ 中台拒绝：检测到 ${d.divergences.length} 处不一致。</div>`
        + `<table class="dv"><thead><tr><th>字段</th><th>类型</th><th>前端</th><th>中台权威值</th></tr></thead><tbody>`
        + d.divergences.map((x: any) => `<tr><td>${x.field}</td><td>${kindTxt[x.kind] || x.kind}</td><td>${x.client}</td><td>${x.server}</td></tr>`).join('')
        + `</tbody></table>`;
    } else {
      const fails = (d.validations || []).filter((v: any) => v.state === 'resolved' && !v.ok);
      this.bffHtml = `<div class="bff-bad">⚠ 中台拒绝：业务校验未通过。</div><ul>${fails.map((v: any) => `<li class="bff-bad">✘ ${v.id}：${v.message || ''}</li>`).join('')}</ul>`;
    }
  }
}
