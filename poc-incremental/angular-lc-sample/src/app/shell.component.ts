import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppComponent } from './app.component';
import { FormlyLcComponent } from './formly/formly-lc.component';

/**
 * 外壳：同一份运行时 RuleSet + 同一引擎 + 同一 BFF，两种渲染方式并排可切换——
 *   ① 手写版：组件模板逐字段手绘；
 *   ② ngx-formly 版：由 model.nodes 模型驱动地动态生成字段树。
 * 用来直观对比"同规格 → 同功能 → 不同 UI 实现"。
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AppComponent, FormlyLcComponent],
  template: `
    <div class="top">🏦 <b>GlobalTrade Bank</b>
      <span class="tag">L/C 结算 · 增量引擎 · 一份规则两种渲染</span>
      <span style="flex:1"></span>
      <div class="tabs">
        <button type="button" class="tab" [class.on]="view==='classic'" (click)="view='classic'">手写渲染版</button>
        <button type="button" class="tab" [class.on]="view==='formly'" (click)="view='formly'">ngx-formly 模型驱动版</button>
      </div>
    </div>
    @switch (view) {
      @case ('classic') { <app-classic></app-classic> }
      @case ('formly')  { <app-formly></app-formly> }
    }
  `,
  styles: [`
    :host{display:block;background:#f3f5f9;color:#1c2430;font-family:"Segoe UI","Microsoft YaHei",sans-serif;min-height:100vh}
    .top{background:#0b3d6b;color:#fff;padding:13px 26px;display:flex;align-items:center;gap:10px}
    .top b{font-size:16px}.top .tag{font-size:11px;background:#1d5e96;padding:3px 9px;border-radius:10px}
    .tabs{display:flex;gap:6px}
    .tab{background:#0d4a82;border:1px solid #1d5e96;color:#cfe0f2;border-radius:7px;padding:6px 13px;font-size:13px;cursor:pointer}
    .tab.on{background:#fff;color:#0b3d6b;border-color:#fff;font-weight:bold}
  `],
})
export class ShellComponent {
  view: 'classic' | 'formly' = 'formly';
}
