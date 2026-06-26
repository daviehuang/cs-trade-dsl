import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormArray, FormGroup, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { Subscription, forkJoin, of } from 'rxjs';
import { startWith, catchError } from 'rxjs/operators';

import { DslEngineService } from './dsl-engine.service';
import { RuleRepositoryService } from './rule-repository.service';
import { RuleSet, RunResult } from './dsl/engine';

interface FieldDef { name: string; type: string; computed: boolean; }
interface ChildMeta { arrayName: string; childType: string; fieldDefs: FieldDef[]; editable: FieldDef[]; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page">
      <header>
        <h1>参数化表单（Angular）<span class="pill">运行时动态加载 RuleSet</span></h1>
        <p class="muted">规则<b>不编译进前端包</b>：按功能从规则仓库拉取，表单依据
          <code>ruleSet.model</code> <b>动态生成</b>。切换功能即可看到不同规则、不同字段。</p>
        <div class="feat">
          <label>功能 feature：
            <select [value]="featureId" (change)="selectFeature($any($event.target).value)">
              @for (f of features; track f.id) { <option [value]="f.id">{{ f.label }}</option> }
            </select>
          </label>
          @if (ruleSet) { <span class="muted">已加载 <code>{{ ruleSet.ruleSetId + '@' + ruleSet.version }}</code></span> }
        </div>
      </header>

      @if (loading) { <div class="card">加载规则中…</div> }
      @else if (error) { <div class="card err">{{ error }}</div> }
      @else if (form) {
        <form [formGroup]="form">
          <section class="card">
            <h2>主记录 {{ ruleSet?.model?.root }}</h2>
            <div class="parent">
              @for (f of editableParentFields; track f.name) {
                <label>{{ f.name }} <small>{{ f.type }}</small>
                  <input [formControlName]="f.name" /></label>
              }
            </div>
          </section>

          @if (childMeta) {
            <section class="card">
              <h2>子项 {{ childMeta.childType }}</h2>
              <table>
                <thead><tr>
                  <th>#</th>
                  @for (cf of childMeta.fieldDefs; track cf.name) { <th>{{ cf.name }}</th> }
                  <th></th>
                </tr></thead>
                <tbody [formArrayName]="childMeta.arrayName">
                  @for (row of childControls; track $index) {
                    <tr [formGroupName]="$index">
                      <td class="idx">{{ $index + 1 }}</td>
                      @for (cf of childMeta.fieldDefs; track cf.name) {
                        @if (cf.computed) {
                          <td class="calc">{{ childCalc($index, cf.name) }}</td>
                        } @else {
                          <td><input [formControlName]="cf.name" /></td>
                        }
                      }
                      <td><button type="button" (click)="removeChild($index)">✕</button></td>
                    </tr>
                  }
                </tbody>
              </table>
              <button type="button" class="add" (click)="addChild()">+ 添加子项</button>
            </section>
          }
        </form>

        <section class="card">
          <h2>引擎结果</h2>
          <div class="total">
            @for (f of computedParentFields; track f.name) {
              <span class="kv">{{ f.name }} = <b>{{ treeVal(f.name) }}</b></span>
            }
          </div>
          <ul class="vlist">
            @for (v of result?.validations ?? []; track v.id + v.scope) {
              <li [class.ok]="v.ok" [class.bad]="!v.ok">
                {{ v.ok ? '✔' : '✘' }} <b>{{ v.id }}</b>
                <span class="scope">[{{ v.scope }}]</span>
                {{ v.ok ? '通过' : '— ' + v.message }}
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 820px; margin: 24px auto; padding: 0 18px; }
    h1 { font-size: 20px; }
    .pill { font-size:12px; background:#dbeafe; color:#2563eb; padding:3px 10px; border-radius:12px; margin-left:8px; vertical-align:middle; }
    .muted { color:#6b7688; font-size:13px; } code { background:#eef1f7; padding:1px 5px; border-radius:4px; }
    .feat { margin-top:10px; display:flex; gap:14px; align-items:center; }
    select { padding:6px 10px; border:1px solid #cdd5e2; border-radius:6px; font-size:14px; }
    .card { background:#fff; border:1px solid #e2e7f0; border-radius:10px; padding:18px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,.04); }
    .card.err { color:#dc2626; }
    h2 { font-size:14px; color:#3b4658; margin:0 0 14px; }
    .parent { display:flex; gap:16px; flex-wrap:wrap; }
    label { display:flex; flex-direction:column; gap:4px; font-size:13px; color:#6b7688; }
    label small { color:#9aa3b2; font-size:11px; }
    input { padding:8px 10px; border:1px solid #cdd5e2; border-radius:6px; font-size:14px; font-family:Consolas,monospace; }
    table { width:100%; border-collapse:collapse; }
    th,td { padding:7px 8px; border-bottom:1px solid #eef1f6; text-align:left; font-size:13px; }
    th { color:#8a93a3; font-weight:500; } td.idx { color:#9aa3b2; } td input { width:96px; }
    td.calc { color:#2563eb; font-family:Consolas,monospace; }
    button { background:#f1f5fb; border:1px solid #cdd5e2; border-radius:6px; padding:5px 10px; cursor:pointer; }
    button:hover { border-color:#2563eb; } .add { margin-top:12px; }
    .total { font-size:18px; color:#2563eb; font-family:Consolas,monospace; margin-bottom:10px; display:flex; gap:22px; flex-wrap:wrap; }
    .kv b { font-size:22px; }
    .vlist { list-style:none; padding:0; margin:0; }
    .vlist li { padding:6px 0; font-size:13px; } .vlist li.ok { color:#16a34a; } .vlist li.bad { color:#dc2626; }
    .scope { color:#9aa3b2; font-size:12px; }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private dsl = inject(DslEngineService);
  private repo = inject(RuleRepositoryService);

  // 可选功能列表（生产中也可由后端下发）
  features = [
    { id: 'fxTradeRules', label: 'FX 报价（主记录 + 子项）' },
    { id: 'loanFee', label: '贷款手续费（单记录，无子项）' },
  ];
  featureId = this.features[0].id;

  loading = false;
  error: string | null = null;
  ruleSet: RuleSet | null = null;
  result: RunResult | null = null;

  form: FormGroup | null = null;
  editableParentFields: FieldDef[] = [];
  computedParentFields: FieldDef[] = [];
  childMeta: ChildMeta | null = null;

  private sub?: Subscription;

  ngOnInit(): void { this.selectFeature(this.featureId); }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  // 运行时按功能拉取 RuleSet（+ 可选样例数据），再据 model 动态建表单
  selectFeature(id: string): void {
    this.featureId = id;
    this.loading = true;
    this.error = null;
    this.sub?.unsubscribe();
    forkJoin({
      rs: this.repo.load(id),
      sample: this.repo.loadSample(id).pipe(catchError(() => of({} as Record<string, unknown>))),
    }).subscribe({
      next: ({ rs, sample }) => { this.ruleSet = rs; this.buildForm(rs, sample); this.loading = false; },
      error: (e) => { this.error = '加载规则失败: ' + (e?.message ?? e); this.loading = false; },
    });
  }

  // ── 依据 ruleSet.model 动态生成表单（核心：schema-driven）──
  private buildForm(rs: RuleSet, sample: Record<string, any>): void {
    const model = rs.model;
    const rootDef = model.nodes[model.root];
    this.editableParentFields = [];
    this.computedParentFields = [];
    const controls: Record<string, AbstractControl> = {};

    for (const [name, spec] of Object.entries<any>(rootDef.fields)) {
      const f: FieldDef = { name, type: spec.type, computed: !!spec.computed };
      if (f.computed) this.computedParentFields.push(f);
      else {
        this.editableParentFields.push(f);
        controls[name] = this.fb.control(sample?.[name] ?? this.def(spec.type));
      }
    }

    this.childMeta = null;
    if (rootDef.children) {
      const arrayName = rootDef.children.name;
      const childType = rootDef.children.node;
      const childDef = model.nodes[childType];
      const fieldDefs: FieldDef[] = Object.entries<any>(childDef.fields)
        .map(([n, s]) => ({ name: n, type: s.type, computed: !!s.computed }));
      const editable = fieldDefs.filter((f) => !f.computed);
      this.childMeta = { arrayName, childType, fieldDefs, editable };

      const sampleChildren: any[] = (sample?.[arrayName] as any[]) ?? [];
      const groups = (sampleChildren.length ? sampleChildren : [{}]).map((c) => this.childGroup(c));
      controls[arrayName] = this.fb.array(groups);
    }

    this.form = this.fb.group(controls);
    this.sub = this.form.valueChanges.pipe(startWith(this.form.value)).subscribe(() => this.recompute());
  }

  private childGroup(c: Record<string, any>): FormGroup {
    const g: Record<string, AbstractControl> = {};
    for (const f of this.childMeta!.editable) g[f.name] = this.fb.control(c?.[f.name] ?? this.def(f.type));
    return this.fb.group(g);
  }

  private def(type: string): unknown {
    if (type === 'decimal' || type === 'int') return '0';
    if (type === 'boolean') return false;
    return '';
  }

  private recompute(): void {
    if (!this.ruleSet || !this.form) return;
    // 控件名与字段名一致、子数组名与 model.children.name 一致 → 直接喂给引擎
    this.result = this.dsl.run(this.ruleSet, this.form.getRawValue());
  }

  get childControls(): AbstractControl[] {
    if (!this.childMeta || !this.form) return [];
    return (this.form.get(this.childMeta.arrayName) as FormArray).controls;
  }

  childCalc(i: number, field: string): string {
    const c = this.result?.tree?.children?.[i];
    return c && c[field] != null ? c[field] : '—';
  }
  treeVal(name: string): string {
    const v = this.result?.tree?.[name];
    return v != null ? v : '—';
  }

  addChild(): void {
    if (!this.childMeta || !this.form) return;
    (this.form.get(this.childMeta.arrayName) as FormArray).push(this.childGroup({}));
  }
  removeChild(i: number): void {
    if (!this.childMeta || !this.form) return;
    (this.form.get(this.childMeta.arrayName) as FormArray).removeAt(i);
  }
}
