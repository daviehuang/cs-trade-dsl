import { useMemo, useRef, useState } from 'react';
import { RuleSet, buildMeta, lintPageDef, lintRuleSet } from '@udsl/ui-kit-core';
import '@udsl/ui-kit-react';     // 预览样式

import ruleSetJson from '../../lc-rules.json';
import commonFxJson from '../../commonFx.json';
import commonPartyJson from '../../commonParty.json';
import commonMixPaymentJson from '../../commonMixPayment.json';
import dataJson from '../../lc-data.json';
import pageDefJson from '../../angular-lc-sample/src/assets/pages/lcSettlement.page.json';

import { useEditorStore } from './store/editorStore';
import { ModelDesigner } from './ModelDesigner';
import { RulesEditor } from './RulesEditor';
import { ModulesEditor } from './ModulesEditor';
import { ContextSeams } from './ContextSeams';
import { DataSourceEditor } from './DataSourceEditor';
import { ResolverSim } from './ResolverSim';
import { DEFAULT_MOCKS } from './mock';
import { ImportsManager } from './ImportsManager';
import { LibraryManager } from './LibraryManager';
import { LayoutCanvas } from './LayoutCanvas';
import { TestData } from './TestData';
import { VersionPanel } from './VersionPanel';
import { StorePanel } from './StorePanel';
import { Preview } from './Preview';

// 初始库目录（可编辑；新建/编辑后进 store）。引擎只用被 import 引用到的。
const initial = {
  ruleSet: ruleSetJson as unknown as RuleSet,
  pageDef: pageDefJson as any,
  data: dataJson as any,
  libraries: {
    'commonFx@1.0.0': commonFxJson as unknown as RuleSet,
    'commonParty@1.0.0': commonPartyJson as unknown as RuleSet,
    'commonMixPayment@1.0.0': commonMixPaymentJson as unknown as RuleSet,
  } as Record<string, RuleSet>,
  mocks: DEFAULT_MOCKS,
};
type Tab = 'model' | 'rules' | 'modules' | 'datasource' | 'mock' | 'context' | 'imports' | 'layout' | 'data' | 'version' | 'store';

// 域14 分层 UI：业务视图只见「参数/取数/数据/版本/仓库」（不碰规则/模型/模块=逻辑编写，符合治理红线）。
type Role = 'dev' | 'biz';
const BIZ_TABS: Tab[] = ['mock', 'context', 'data', 'version', 'store'];

// 库 ↔ RuleSet 形状适配：库用顶层 nodes/…；包成 { model:{nodes} } 供编辑器复用，写回时脱去 model 包装。
const libToRS = (lib: RuleSet): RuleSet => ({ ...lib, model: { root: Object.keys(lib.nodes ?? {})[0] ?? '', nodes: lib.nodes ?? {} } } as any);
const writeRS = (rs: any, lib: any) => { lib.nodes = rs.model?.nodes ?? {}; lib.rules = rs.rules; lib.modules = rs.modules; lib.uses = rs.uses; lib.context = rs.context; lib.dataSources = rs.dataSources; lib.imports = rs.imports; delete lib.model; };

export default function App() {
  const s = useEditorStore(initial);
  const [tab, setTab] = useState<Tab>('layout');
  const [role, setRoleRaw] = useState<Role>('dev');
  const [showJson, setShowJson] = useState<'none' | 'page' | 'rules' | 'data'>('none');
  const [editTarget, setEditTargetRaw] = useState<string>('scenario');   // 'scenario' | ref
  const fileRef = useRef<HTMLInputElement>(null);
  // 切到业务视图：收敛到参数类 tab、锁定场景（业务不编辑库/逻辑）。
  const setRole = (r: Role) => { setRoleRaw(r); if (r === 'biz') { if (!BIZ_TABS.includes(tab)) setTab('mock'); if (editTarget !== 'scenario') setEditTargetRaw('scenario'); } };
  const biz = role === 'biz';

  const isLib = editTarget !== 'scenario';
  const setEditTarget = (t: string) => { setEditTargetRaw(t); if (t !== 'scenario' && (['layout', 'data', 'version', 'store'] as Tab[]).includes(tab)) setTab('model'); };

  // 编辑目标（场景 or 库）→ 统一成 RuleSet 视图 + 变更函数
  const targetRS = isLib ? libToRS(s.libraries[editTarget]) : s.ruleSet;
  const mutateTarget = isLib
    ? (fn: (rs: RuleSet) => void) => s.mutateLibrary(editTarget, (lib) => { const rs = libToRS(lib); fn(rs); writeRS(rs, lib); })
    : s.mutateRuleSet;

  const meta = useMemo(() => buildMeta(targetRS, s.libraries), [targetRS, s.libraries]);
  // 两类 lint：PageDef↔模型绑定（仅场景）+ RuleSet 内在一致性（场景与库都查，防运行时崩/静默失效）。
  const pageLint = useMemo(() => (isLib ? [] : lintPageDef(s.pageDef, s.ruleSet, s.libraries)), [isLib, s.pageDef, s.ruleSet, s.libraries]);
  const rsLint = useMemo(() => lintRuleSet(targetRS, s.libraries), [targetRS, s.libraries]);
  const lint = useMemo(() => [...rsLint, ...pageLint], [rsLint, pageLint]);
  const errorCount = lint.filter((i) => i.level === 'error').length;
  const warnCount = lint.filter((i) => i.level === 'warn').length;

  const addField = (t: string, name: string, spec: any) => mutateTarget((rs) => { rs.model.nodes[t] ??= { fields: {} }; (rs.model.nodes[t].fields ??= {})[name] = spec; });
  const addRule = (r: any) => mutateTarget((rs) => { rs.rules = [...(rs.rules ?? []), r]; });
  const updateRule = (i: number, r: any) => mutateTarget((rs) => { (rs.rules ??= [])[i] = r; });
  const deleteRule = (i: number) => mutateTarget((rs) => { (rs.rules ?? []).splice(i, 1); });
  const duplicateRule = (i: number) => mutateTarget((rs) => { const rl = rs.rules ?? []; const c = JSON.parse(JSON.stringify(rl[i])); c.id += '_copy'; rl.splice(i + 1, 0, c); });
  const toggleRule = (i: number) => mutateTarget((rs) => { const rl = rs.rules ?? []; rl[i].enabled = rl[i].enabled === false; });

  const doExport = () => {
    const blob = new Blob([s.exportBundle()], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = (s.ruleSet.ruleSetId || 'bundle') + '.bundle.json'; a.click(); URL.revokeObjectURL(url);
  };
  const doImport = (f: File) => { const r = new FileReader(); r.onload = () => { try { s.importBundle(JSON.parse(String(r.result))); } catch (e: any) { alert('导入失败：' + e.message); } }; r.readAsText(f); };
  const jsonText = showJson === 'page' ? JSON.stringify(s.pageDef, null, 2) : showJson === 'rules' ? JSON.stringify(isLib ? s.libraries[editTarget] : s.ruleSet, null, 2) : JSON.stringify(s.data, null, 2);

  return (
    <div className="ed">
      <div className="ed-top">🧩 <b>可视化规则/参数编辑器</b>
        <span className="tag">RuleSet + 库 + PageDef · 实时预览 · lint · undo/redo · 本地持久化</span>
        <span style={{ flex: 1 }} />
        <button disabled={!s.canUndo} onClick={s.undo}>↶ 撤销</button>
        <button disabled={!s.canRedo} onClick={s.redo}>↷ 重做</button>
        <button onClick={doExport}>导出</button>
        <button onClick={() => fileRef.current?.click()}>导入</button>
        <button onClick={() => { if (confirm('重置为初始样例？将清除本地改动。')) s.reset(); }}>重置</button>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
      </div>

      <div className="ed-lintbar">
        <span className="target-chip">视图：
          <button className="mini" style={{ marginLeft: 4, ...(role === 'dev' ? { background: '#1d5e96', color: '#fff' } : {}) }} onClick={() => setRole('dev')}>开发者</button>
          <button className="mini" style={role === 'biz' ? { background: '#1d5e96', color: '#fff' } : {}} onClick={() => setRole('biz')}>业务</button>
        </span>
        <span className="target-chip">编辑对象：{isLib ? <b>库 {editTarget}</b> : <b>场景 {s.ruleSet.ruleSetId}</b>}</span>
        {biz && <span className="muted">业务视图：规则/模型只读，可调参数·取数·数据</span>}
        {!biz && isLib && <button className="mini" onClick={() => setEditTarget('scenario')}>← 返回场景</button>}
        {errorCount ? <span className="lint bad">⛔ lint {errorCount} 错</span>
          : warnCount ? <span className="lint warn">⚠ lint {warnCount} 提醒</span>
            : <span className="lint ok">✔ lint 通过</span>}
        {s.restoredFromStorage && <span className="muted">（已从本地恢复）</span>}
        {lint.slice(0, 5).map((i, k) => <span key={k} className={'li ' + i.level}>{i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠' : 'ℹ'} <code>{i.path}</code> {i.message}</span>)}
        <span style={{ flex: 1 }} />
        <button className="mini" onClick={() => setShowJson(showJson === 'rules' ? 'none' : 'rules')}>{isLib ? '库' : 'RuleSet'} JSON</button>
        {!isLib && <button className="mini" onClick={() => setShowJson(showJson === 'page' ? 'none' : 'page')}>PageDef JSON</button>}
        {!isLib && <button className="mini" onClick={() => setShowJson(showJson === 'data' ? 'none' : 'data')}>Data JSON</button>}
      </div>

      <div className="ed-main">
        <div className="ed-left">
          <div className="ed-tabs">
            {!biz && <button className={tab === 'model' ? 'on' : ''} onClick={() => setTab('model')}>模型</button>}
            {!biz && <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>规则</button>}
            {!biz && <button className={tab === 'modules' ? 'on' : ''} onClick={() => setTab('modules')}>模块</button>}
            {!biz && <button className={tab === 'datasource' ? 'on' : ''} onClick={() => setTab('datasource')}>数据源</button>}
            <button className={tab === 'mock' ? 'on' : ''} onClick={() => setTab('mock')}>取数模拟</button>
            <button className={tab === 'context' ? 'on' : ''} onClick={() => setTab('context')}>上下文</button>
            {!biz && <button className={tab === 'imports' ? 'on' : ''} onClick={() => setTab('imports')}>库</button>}
            {!isLib && !biz && <button className={tab === 'layout' ? 'on' : ''} onClick={() => setTab('layout')}>布局</button>}
            {!isLib && <button className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>数据</button>}
            {!isLib && <button className={tab === 'version' ? 'on' : ''} onClick={() => setTab('version')}>版本</button>}
            {!isLib && <button className={tab === 'store' ? 'on' : ''} onClick={() => setTab('store')}>仓库</button>}
          </div>

          {tab === 'model' && <ModelDesigner ruleSet={targetRS} meta={meta} mutateRuleSet={mutateTarget} isLibrary={isLib} />}
          {tab === 'rules' && <RulesEditor ruleSet={targetRS} imports={s.libraries} meta={meta} addField={addField} addRule={addRule} updateRule={updateRule} deleteRule={deleteRule} duplicateRule={duplicateRule} toggleRule={toggleRule} />}
          {tab === 'modules' && <ModulesEditor ruleSet={targetRS} meta={meta} imports={s.libraries} mutateRuleSet={mutateTarget} />}
          {tab === 'datasource' && <DataSourceEditor ruleSet={targetRS} mutateRuleSet={mutateTarget} />}
          {tab === 'mock' && <ResolverSim ruleSet={targetRS} imports={s.libraries} mocks={s.mocks} mutateMocks={s.mutateMocks} />}
          {tab === 'context' && <ContextSeams ruleSet={targetRS} imports={s.libraries} mutateRuleSet={mutateTarget} />}
          {tab === 'imports' && <>
            <LibraryManager libraries={s.libraries} scenarioName={s.ruleSet.ruleSetId} editTarget={editTarget} setEditTarget={setEditTarget} addLibrary={s.addLibrary} deleteLibrary={s.deleteLibrary} />
            <ImportsManager ruleSet={targetRS} catalog={s.libraries} mutateRuleSet={mutateTarget} />
          </>}
          {tab === 'layout' && !isLib && <LayoutCanvas pageDef={s.pageDef} meta={meta} mutatePageDef={s.mutatePageDef} />}
          {tab === 'data' && !isLib && <TestData data={s.data} setData={s.setData} />}
          {tab === 'version' && !isLib && <VersionPanel ruleSet={s.ruleSet} mutateRuleSet={s.mutateRuleSet} snapshots={s.snapshots} publish={s.publish} rollback={s.rollback} deleteSnapshot={s.deleteSnapshot} />}
          {tab === 'store' && !isLib && <StorePanel currentBundle={s.currentBundle} importBundle={s.importBundle} scenarioName={s.ruleSet.ruleSetId} />}

          {showJson !== 'none' && (
            <div className="ed-json">
              <div className="ed-json-h"><b>{showJson === 'page' ? 'PageDef' : showJson === 'rules' ? (isLib ? '库' : 'RuleSet') : 'Data'} JSON</b>
                <button onClick={() => navigator.clipboard?.writeText(jsonText)}>复制</button></div>
              <pre>{jsonText}</pre>
            </div>
          )}
        </div>

        <div className="ed-right">
          {isLib
            ? <div className="preview"><div className="pv-head"><b>库编辑模式</b></div><div className="lib-note">当前在编辑库 <code>{editTarget}</code>（无场景实例，故无实时预览）。库被场景 import 后可在场景预览里看到效果。返回场景查看预览。</div></div>
            : <Preview key={s.sessionRev} ruleSet={s.ruleSet} imports={s.libraries} data={s.data} pageDef={s.pageDef} mocks={s.mocks} lintErr={errorCount} />}
        </div>
      </div>
    </div>
  );
}
