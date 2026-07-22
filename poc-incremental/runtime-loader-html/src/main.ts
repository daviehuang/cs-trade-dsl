// 运行时加载器（原生 HTML）：启动即从规则仓库按 feature 拉取 ruleSet+库+页面+数据，
//   用 @udsl/ui-kit-html 的 mountEngineSession 渲染。零静态规则 import——规则不编译进包。
//   与 React runtime-loader 证明同一件事，只是渲染 kit 换成原生 DOM。
import { createSession } from '@udsl/engine';
import { PageDef, RuleSet, SessionState, buildMeta, buildRootIR, hydratePage, lintPageDef } from '@udsl/ui-kit-core';
import { mountEngineSession, MountHandle } from '@udsl/ui-kit-html';

import '../../ui-kit-react/src/styles.css';   // 复用共享的 eg-* 控件样式（四端同一份）
import './app.css';
import { makeResolve } from './fx';

interface FeatureSummary { id: string; title: string; page: string; }
interface Bundle { feature: FeatureSummary; ruleSet: RuleSet; imports: Record<string, RuleSet>; pageDef: PageDef; data: any; }

const resolve = makeResolve(600);
const api = (p: string) => fetch(p).then((r) => { if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`); return r.json(); });

// 本文件【零静态规则 import】——ruleSet/库/页面/数据全在运行时 fetch。
const root = document.getElementById('app')!;
root.innerHTML = `
  <div class="app">
    <div class="top">🛰️ <b>运行时加载器 · 原生 HTML</b>
      <span class="tag">启动即从规则仓库按 feature 拉取 · 零静态 import · ui-kit-html 渲染</span>
    </div>
    <div class="feat">
      <span class="srcbar" style="margin:0"><span class="lbl">交易 feature：</span>
        <span class="seg"><select id="feat"></select></span>
      </span>
      <span id="loaded" class="muted"></span>
      <span class="status settled" id="status" style="margin-left:auto">✅ 已结算</span>
    </div>
    <div class="wrap">
      <div class="srcbar"><span id="lintbar"></span></div>
      <div id="view"></div>
    </div>
  </div>`;

const selEl = root.querySelector<HTMLSelectElement>('#feat')!;
const loadedEl = root.querySelector<HTMLElement>('#loaded')!;
const statusEl = root.querySelector<HTMLElement>('#status')!;
const lintbar = root.querySelector<HTMLElement>('#lintbar')!;
const view = root.querySelector<HTMLElement>('#view')!;

let handle: MountHandle | null = null;

async function loadFeature(featureId: string) {
  if (handle) { handle.destroy(); handle = null; }
  view.innerHTML = '<div class="loading">⏳ 正在从仓库拉取规则与页面…</div>';
  lintbar.textContent = ''; loadedEl.textContent = '';
  try {
    const b = await api('/api/bundle/' + encodeURIComponent(featureId)) as Bundle;
    const meta = buildMeta(b.ruleSet, b.imports);
    const lint = lintPageDef(b.pageDef, b.ruleSet, b.imports);
    const errorCount = lint.filter((i) => i.level === 'error').length;
    const warnCount = lint.filter((i) => i.level === 'warn').length;
    const usePage = errorCount === 0;
    const buildIR = (state: SessionState) => (usePage ? hydratePage(b.pageDef, state, meta) : buildRootIR(state, meta));

    loadedEl.innerHTML = `运行时已从仓库加载 <code>${b.ruleSet.ruleSetId}@${(b.ruleSet as any).version}</code>`
      + ` · import <code>${Object.keys(b.imports).join('、') || '无'}</code>`
      + ` · 页面 <code>${b.feature?.page ?? featureId}</code>`;
    lintbar.className = usePage ? (warnCount ? 'lint warn' : 'lint ok') : 'lint bad';
    lintbar.textContent = usePage
      ? (warnCount ? `⚠ PageDef 校验通过（${warnCount} 提醒）` : '✔ PageDef 校验通过（lint）')
      : `⛔ PageDef ${errorCount} 个错误 —— 已回退模型自动布局`;

    view.innerHTML = '';
    handle = mountEngineSession({ container: view, createSession, ruleSet: b.ruleSet, imports: b.imports, data: b.data, resolve, buildIR, reconstructOverrides: true, resetRules: b.pageDef.resetRules });
    if (handle.error) { view.innerHTML = `<div class="err">⛔ 建立会话失败：${handle.error}</div>`; return; }
    const paintStatus = () => {
      const pending = handle!.getState().anyPending;
      statusEl.className = 'status ' + (pending ? 'pending' : 'settled');
      statusEl.textContent = pending ? '⏳ 异步取数中…' : '✅ 已结算';
    };
    handle.ctx.onTick(paintStatus); paintStatus();
  } catch (e: any) {
    view.innerHTML = `<div class="err">⛔ 加载 feature「${featureId}」失败：${e.message}（store-server 是否已启动？node store-server.js）</div>`;
  }
}

// 启动：拉目录清单，默认选第一笔交易
(async () => {
  try {
    const cat = await api('/api/catalog');
    const feats: FeatureSummary[] = cat.features ?? [];
    selEl.innerHTML = feats.length
      ? feats.map((f) => `<option value="${f.id}">${f.title || f.id}</option>`).join('')
      : '<option value="">（无）</option>';
    selEl.addEventListener('change', () => loadFeature(selEl.value));
    if (feats[0]) loadFeature(feats[0].id);
    else view.innerHTML = '<div class="err">仓库暂无 feature。请先在编辑器「保存到仓库」。</div>';
  } catch (e: any) {
    view.innerHTML = `<div class="err">⛔ 加载仓库目录失败：${e.message}（store-server 是否已启动？node store-server.js）</div>`;
  }
})();
