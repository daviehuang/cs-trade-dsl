import { useMemo, useState } from 'react';
import { createSession } from '@udsl/engine';
import {
  PageDef, RuleSet, buildMeta, buildRootIR, hydratePage, lintPageDef,
} from '@udsl/ui-kit-core';
import { UiRenderer, useEngineSession } from '@udsl/ui-kit-react';
import '@udsl/ui-kit-react';     // 引入样式（index.ts 里 import 了 styles.css）

import ruleSetJson from '../../lc-rules.json';
import commonFxJson from '../../commonFx.json';
import commonPartyJson from '../../commonParty.json';
import dataJson from '../../lc-data.json';
import pageDefJson from '../../angular-lc-sample/src/assets/pages/lcSettlement.page.json';
import { makeResolve } from './fx';

const ruleSet = ruleSetJson as unknown as RuleSet;
const commonFx = commonFxJson as unknown as RuleSet;
const commonParty = commonPartyJson as unknown as RuleSet;
const pageDef = pageDefJson as unknown as PageDef;
const imports: Record<string, RuleSet> = {
  'commonFx@1.0.0': commonFx,
  'commonParty@1.0.0': commonParty,
};
const resolve = makeResolve(600);

export default function App() {
  const { ctx, getState, structVersion } = useEngineSession({ createSession, ruleSet, imports, data: dataJson, resolve });
  const meta = useMemo(() => buildMeta(ruleSet, imports), []);
  const lint = useMemo(() => lintPageDef(pageDef, ruleSet, imports), []);
  const errorCount = lint.filter((i) => i.level === 'error').length;
  const warnCount = lint.filter((i) => i.level === 'warn').length;

  const [source, setSource] = useState<'auto' | 'page'>('page');
  const usePage = source === 'page' && errorCount === 0;

  // 结构变化（增删行）时重建 UI-IR；值/异步变化由引擎驱动重渲染、组件实时读 ctx。
  const ir = useMemo(
    () => (usePage ? hydratePage(pageDef, getState(), meta) : buildRootIR(getState(), meta)),
    [usePage, structVersion, meta, getState],
  );

  const st = getState();

  return (
    <div className="app">
      <div className="top">🏦 <b>GlobalTrade Bank</b>
        <span className="tag">L/C 结算 · 增量引擎 · React 运行时解释（同一份 PageDef + RuleSet）</span>
      </div>

      <div className="feat">
        <span className="muted">运行时已加载 <code>{ruleSet.ruleSetId + '@' + ruleSet.version}</code>
          · import <code>{Object.keys(imports).join('、')}</code>
          · <b>React 渲染 kit（与 Angular 同一份 ui-kit-core）</b></span>
        <span className={'status ' + (st.anyPending ? 'pending' : 'settled')}>
          {st.anyPending ? '⏳ 异步取数中…' : '✅ 已结算'}</span>
      </div>

      <div className="wrap">
        <div className="srcbar">
          <span className="lbl">界面来源：</span>
          <div className="seg">
            <button type="button" className={source === 'auto' ? 'on' : ''} onClick={() => setSource('auto')}>模型自动生成</button>
            <button type="button" className={source === 'page' ? 'on' : ''} onClick={() => setSource('page')}>自定义 PageDef</button>
          </div>
          {source === 'page'
            ? (errorCount ? <span className="lint bad">⛔ PageDef 校验 {errorCount} 个错误 —— 已回退自动布局</span>
              : warnCount ? <span className="lint warn">⚠ PageDef 校验通过（{warnCount} 个提醒）</span>
                : <span className="lint ok">✔ PageDef 校验通过（lint）</span>)
            : <span className="muted">字段由运行时 RuleSet 的 <code>model.nodes</code> 自动生成</span>}
        </div>

        <UiRenderer ir={ir} ctx={ctx} />
      </div>
    </div>
  );
}
