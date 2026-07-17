// 原生 HTML 样本：运行时解释同一份 lcSettlement PageDef + RuleSet。
//   与 React/Angular 样本证明同一件事：引擎 + PageDef + UI-IR 框架无关；
//   这里连框架都没有——纯 DOM 哑渲染器（@udsl/ui-kit-html）消费同一份 core 产出的 UINode。
import { createSession } from '@udsl/engine';
import {
  PageDef, RuleSet, SessionState, buildMeta, buildRootIR, hydratePage, lintPageDef,
} from '@udsl/ui-kit-core';
import { mountEngineSession } from '@udsl/ui-kit-html';

import '../../ui-kit-react/src/styles.css';   // 复用共享的 eg-* 控件样式（三端同一份）
import './app.css';

import ruleSetJson from '../../lc-rules.json';
import commonFxJson from '../../commonFx.json';
import commonPartyJson from '../../commonParty.json';
import dataJson from '../../lc-data.json';
import pageDefJson from '../../angular-lc-sample/src/assets/pages/lcSettlement.page.json';
import { makeResolve } from './fx';

const ruleSet = ruleSetJson as unknown as RuleSet;
const pageDef = pageDefJson as unknown as PageDef;
const imports: Record<string, RuleSet> = {
  'commonFx@1.0.0': commonFxJson as unknown as RuleSet,
  'commonParty@1.0.0': commonPartyJson as unknown as RuleSet,
};
const resolve = makeResolve(600);
const meta = buildMeta(ruleSet, imports);
const lint = lintPageDef(pageDef, ruleSet, imports);
const errorCount = lint.filter((i) => i.level === 'error').length;
const warnCount = lint.filter((i) => i.level === 'warn').length;

// 界面来源：'page'（自定义 PageDef，校验通过时）| 'auto'（模型自动布局）。切换后重建。
let source: 'auto' | 'page' = 'page';
const usePage = () => source === 'page' && errorCount === 0;
const buildIR = (state: SessionState) => (usePage() ? hydratePage(pageDef, state, meta) : buildRootIR(state, meta));

// —— 外壳骨架 ——
const root = document.getElementById('app')!;
root.innerHTML = `
  <div class="app">
    <div class="top">🏦 <b>GlobalTrade Bank</b>
      <span class="tag">L/C 结算 · 增量引擎 · 原生 HTML 运行时解释（同一份 PageDef + RuleSet）</span>
    </div>
    <div class="feat">
      <span class="muted">运行时已加载 <code>${ruleSet.ruleSetId}@${ruleSet.version}</code>
        · import <code>${Object.keys(imports).join('、')}</code>
        · <b>原生 HTML 渲染 kit（与 React/Angular 同一份 ui-kit-core）</b></span>
      <span class="status settled" id="status">✅ 已结算</span>
    </div>
    <div class="wrap">
      <div class="srcbar">
        <span class="lbl">界面来源：</span>
        <div class="seg">
          <button type="button" data-src="auto">模型自动生成</button>
          <button type="button" data-src="page">自定义 PageDef</button>
        </div>
        <span id="lintbar"></span>
      </div>
      <div id="view"></div>
    </div>
  </div>`;

const statusEl = root.querySelector<HTMLElement>('#status')!;
const lintbar = root.querySelector<HTMLElement>('#lintbar')!;
const view = root.querySelector<HTMLElement>('#view')!;

function paintSrcbar() {
  root.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => b.classList.toggle('on', b.dataset['src'] === source));
  if (source === 'page') {
    lintbar.className = errorCount ? 'lint bad' : warnCount ? 'lint warn' : 'lint ok';
    lintbar.textContent = errorCount ? `⛔ PageDef 校验 ${errorCount} 个错误 —— 已回退自动布局`
      : warnCount ? `⚠ PageDef 校验通过（${warnCount} 个提醒）` : '✔ PageDef 校验通过（lint）';
  } else {
    lintbar.className = 'muted';
    lintbar.textContent = '字段由运行时 RuleSet 的 model.nodes 自动生成';
  }
}

// —— 挂载引擎会话（值刷新/结构变化都由 kit 内部重渲染）——
const handle = mountEngineSession({ container: view, createSession, ruleSet, imports, data: dataJson, resolve, buildIR, resetRules: pageDef.resetRules });

// 顶栏"已结算/取数中"随引擎 tick 更新（异步汇率/筛查完成时）。
const paintStatus = () => {
  const pending = handle.getState().anyPending;
  statusEl.className = 'status ' + (pending ? 'pending' : 'settled');
  statusEl.textContent = pending ? '⏳ 异步取数中…' : '✅ 已结算';
};
handle.ctx.onTick(paintStatus);
paintStatus();

root.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) =>
  b.addEventListener('click', () => { source = b.dataset['src'] as 'auto' | 'page'; paintSrcbar(); handle.refresh(); }));
paintSrcbar();
