import { useEffect, useMemo, useState } from 'react';
import { createSession } from '@udsl/engine';
import {
  PageDef, RuleSet, buildMeta, buildRootIR, hydratePage, lintPageDef,
} from '@udsl/ui-kit-core';
import { UiRenderer, useEngineSession } from '@udsl/ui-kit-react';
import '@udsl/ui-kit-react';     // 引入渲染 kit 样式
import { makeResolve } from './fx';

// 仓库 REST 返回形状（store-server 的 /api/bundle）。注意：本文件【零静态规则 import】——
// ruleSet / 库 / 页面 / 数据全在运行时 fetch，证明"规则不编译进包"。
interface FeatureSummary { id: string; title: string; ruleSet: string; page: string; data: string; }
interface Bundle { feature: FeatureSummary; ruleSet: RuleSet; imports: Record<string, RuleSet>; pageDef: PageDef; data: any; }

const resolve = makeResolve(600);
const api = (p: string) => fetch(p).then((r) => { if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`); return r.json(); });

export default function App() {
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [featureId, setFeatureId] = useState<string>('');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string>('');

  // 启动：拉目录清单，默认选第一笔交易
  useEffect(() => {
    api('/api/catalog')
      .then((c) => { setFeatures(c.features); if (c.features[0]) setFeatureId(c.features[0].id); })
      .catch((e) => setError('加载仓库目录失败：' + e.message + '（store-server 是否已启动？node store-server.js）'));
  }, []);

  // 选中 feature 变化：按 feature 一次拉齐 bundle
  useEffect(() => {
    if (!featureId) return;
    setBundle(null); setError('');
    api('/api/bundle/' + encodeURIComponent(featureId))
      .then(setBundle)
      .catch((e) => setError('加载 feature「' + featureId + '」失败：' + e.message));
  }, [featureId]);

  return (
    <div className="app">
      <div className="top">🛰️ <b>运行时加载器</b>
        <span className="tag">启动即从规则仓库按 feature 拉取 · 零静态 import</span>
      </div>

      <div className="feat">
        <span className="srcbar"><span className="lbl">交易 feature：</span>
          <span className="seg">
            <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
              {features.length === 0 && <option value="">（无）</option>}
              {features.map((f) => <option key={f.id} value={f.id}>{f.title || f.id}</option>)}
            </select>
          </span>
        </span>
        {bundle && <span className="muted">运行时已从仓库加载
          <code>{bundle.ruleSet.ruleSetId + '@' + (bundle.ruleSet as any).version}</code>
          · import <code>{Object.keys(bundle.imports).join('、') || '无'}</code>
          · 页面 <code>{bundle.feature.page}</code></span>}
      </div>

      {error && <div className="err">⛔ {error}</div>}
      {!error && !bundle && <div className="loading">⏳ 正在从仓库拉取规则与页面…</div>}
      {bundle && <RuntimeView key={featureId} bundle={bundle} />}
    </div>
  );
}

// 拿到运行时 bundle 后才建引擎会话（hook 不能条件调用，故拆为子组件 + key 重挂）。
function RuntimeView({ bundle }: { bundle: Bundle }) {
  const { ruleSet, imports, pageDef, data } = bundle;
  const { ctx, getState, structVersion } = useEngineSession({ createSession, ruleSet, imports, data, resolve });
  const meta = useMemo(() => buildMeta(ruleSet, imports), [ruleSet, imports]);
  const lint = useMemo(() => lintPageDef(pageDef, ruleSet, imports), [pageDef, ruleSet, imports]);
  const errorCount = lint.filter((i) => i.level === 'error').length;
  const warnCount = lint.filter((i) => i.level === 'warn').length;
  const usePage = errorCount === 0;

  const ir = useMemo(
    () => (usePage ? hydratePage(pageDef, getState(), meta) : buildRootIR(getState(), meta)),
    [usePage, structVersion, meta, getState],
  );
  const st = getState();

  return (
    <div className="wrap">
      <div className="srcbar">
        <span className={'status ' + (st.anyPending ? 'pending' : 'settled')}>
          {st.anyPending ? '⏳ 异步取数中…' : '✅ 已结算'}</span>
        {usePage
          ? (warnCount ? <span className="lint warn">⚠ PageDef 校验通过（{warnCount} 提醒）</span>
            : <span className="lint ok">✔ PageDef 校验通过（lint）</span>)
          : <span className="lint bad">⛔ PageDef {errorCount} 个错误 —— 已回退模型自动布局</span>}
      </div>
      <UiRenderer ir={ir} ctx={ctx} />
    </div>
  );
}
