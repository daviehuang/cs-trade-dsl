import { useMemo, useState } from 'react';
import { PageDef, RuleSet, buildMeta, lintPageDef } from '@udsl/ui-kit-core';
import '@udsl/ui-kit-react';     // 预览样式

import ruleSetJson from '../../lc-rules.json';
import commonFxJson from '../../commonFx.json';
import commonPartyJson from '../../commonParty.json';
import dataJson from '../../lc-data.json';
import pageDefJson from '../../angular-lc-sample/src/assets/pages/lcSettlement.page.json';

import { LayoutEditor } from './LayoutEditor';
import { RulesEditor } from './RulesEditor';
import { Preview } from './Preview';

const commonFx = commonFxJson as unknown as RuleSet;
const commonParty = commonPartyJson as unknown as RuleSet;
const imports: Record<string, RuleSet> = { 'commonFx@1.0.0': commonFx, 'commonParty@1.0.0': commonParty };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export default function App() {
  const [ruleSet, setRuleSet] = useState<RuleSet>(() => clone(ruleSetJson) as RuleSet);
  const [ruleSetVersion, setRuleSetVersion] = useState(0);
  const [pageDef, setPageDef] = useState<PageDef>(() => clone(pageDefJson) as PageDef);
  const [tab, setTab] = useState<'layout' | 'rules'>('layout');
  const [showJson, setShowJson] = useState<'none' | 'page' | 'rules'>('none');

  const meta = useMemo(() => buildMeta(ruleSet, imports), [ruleSet]);
  const lint = useMemo(() => lintPageDef(pageDef, ruleSet, imports), [pageDef, ruleSet]);
  const errorCount = lint.filter((i) => i.level === 'error').length;
  const warnCount = lint.filter((i) => i.level === 'warn').length;

  const bump = () => setRuleSetVersion((v) => v + 1);
  const addField = (nodeType: string, name: string, spec: any) => {
    const rs = clone(ruleSet);
    rs.model.nodes[nodeType] = rs.model.nodes[nodeType] ?? { fields: {} };
    rs.model.nodes[nodeType].fields = rs.model.nodes[nodeType].fields ?? {};
    rs.model.nodes[nodeType].fields[name] = spec;
    setRuleSet(rs); bump();
  };
  const addRule = (rule: any) => { const rs = clone(ruleSet); rs.rules = [...(rs.rules ?? []), rule]; setRuleSet(rs); bump(); };

  const copy = (text: string) => navigator.clipboard?.writeText(text);

  return (
    <div className="ed">
      <div className="ed-top">🧩 <b>中性页面编辑器</b>
        <span className="tag">产出 PageDef + RuleSet · 实时预览复用 ui-kit-react · 发布期 lint</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setShowJson(showJson === 'page' ? 'none' : 'page')}>PageDef JSON</button>
        <button onClick={() => setShowJson(showJson === 'rules' ? 'none' : 'rules')}>RuleSet JSON</button>
      </div>

      <div className="ed-lintbar">
        {errorCount ? <span className="lint bad">⛔ lint {errorCount} 错</span>
          : warnCount ? <span className="lint warn">⚠ lint {warnCount} 提醒</span>
            : <span className="lint ok">✔ lint 通过</span>}
        {lint.map((i, k) => (
          <span key={k} className={'li ' + i.level}>{i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠' : 'ℹ'} <code>{i.path}</code> {i.message}</span>
        ))}
      </div>

      <div className="ed-main">
        <div className="ed-left">
          <div className="ed-tabs">
            <button className={tab === 'layout' ? 'on' : ''} onClick={() => setTab('layout')}>布局（PageDef）</button>
            <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>规则（RuleSet）</button>
          </div>
          {tab === 'layout'
            ? <LayoutEditor pageDef={pageDef} setPageDef={setPageDef} meta={meta} />
            : <RulesEditor ruleSet={ruleSet} meta={meta} addField={addField} addRule={addRule} />}

          {showJson !== 'none' && (
            <div className="ed-json">
              <div className="ed-json-h"><b>{showJson === 'page' ? 'PageDef' : 'RuleSet'} JSON（编辑器产物）</b>
                <button onClick={() => copy(JSON.stringify(showJson === 'page' ? pageDef : ruleSet, null, 2))}>复制</button></div>
              <pre>{JSON.stringify(showJson === 'page' ? pageDef : ruleSet, null, 2)}</pre>
            </div>
          )}
        </div>

        <div className="ed-right">
          <Preview key={ruleSetVersion} ruleSet={ruleSet} imports={imports} data={dataJson} pageDef={pageDef} lintErr={errorCount} />
        </div>
      </div>
    </div>
  );
}
