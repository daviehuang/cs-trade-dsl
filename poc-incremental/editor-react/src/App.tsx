import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { RulesetTree } from './RulesetTree';
import { PageCanvas } from './PageCanvas';
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

// 三个顶层区：规则集 / 库 / 页面（预览、仓库为顶栏按钮弹窗）。
type Section = 'ruleset' | 'library' | 'page';
type Role = 'dev' | 'biz';

// 规则集区方面（左侧竖列）。biz 只见参数类方面。
const RS_ASPECTS = [
  { k: 'model', label: '模型' }, { k: 'rules', label: '规则' }, { k: 'modules', label: '模块' },
  { k: 'datasource', label: '数据源' }, { k: 'context', label: '上下文' }, { k: 'imports', label: '引用的库' },
  { k: 'mock', label: '取数模拟' }, { k: 'data', label: '数据' }, { k: 'version', label: '版本' },
] as const;
const BIZ_ASPECTS = ['mock', 'context', 'data', 'version'];
// 库区方面（顶部小 tab）——库只有 nodes/rules/modules/datasource/context。
const LIB_ASPECTS = [
  { k: 'model', label: '模型' }, { k: 'rules', label: '规则' }, { k: 'modules', label: '模块' },
  { k: 'datasource', label: '数据源' }, { k: 'context', label: '上下文' },
] as const;

// 库 ↔ RuleSet 形状适配：库用顶层 nodes/…；包成 { model:{nodes} } 供编辑器复用，写回时脱去 model 包装。
const libToRS = (lib: RuleSet): RuleSet => ({ ...lib, model: { root: Object.keys(lib.nodes ?? {})[0] ?? '', nodes: lib.nodes ?? {} } } as any);
const writeRS = (rs: any, lib: any) => { lib.nodes = rs.model?.nodes ?? {}; lib.rules = rs.rules; lib.modules = rs.modules; lib.uses = rs.uses; lib.context = rs.context; lib.contextKeys = rs.contextKeys; lib.dataSources = rs.dataSources; lib.imports = rs.imports; delete lib.model; };
const EMPTY_RS = { model: { root: '', nodes: {} } } as unknown as RuleSet;

export default function App() {
  const s = useEditorStore(initial);
  const [section, setSection] = useState<Section>('ruleset');
  const [rsAspect, setRsAspect] = useState<string>('model');
  const [libAspect, setLibAspect] = useState<string>('model');
  const [libRef, setLibRef] = useState<string | null>(null);
  const [role, setRoleRaw] = useState<Role>('dev');
  const [showJson, setShowJson] = useState<'none' | 'page' | 'rules' | 'data'>('none');
  const [showPreview, setShowPreview] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const biz = role === 'biz';

  // 切业务视图：收敛到规则集区 + 参数方面（守治理红线：业务不编辑逻辑/库/页面）。
  const setRole = (r: Role) => {
    setRoleRaw(r);
    if (r === 'biz') { setSection('ruleset'); if (!BIZ_ASPECTS.includes(rsAspect)) setRsAspect('mock'); }
  };

  const isLib = section === 'library';
  const libRefs = Object.keys(s.libraries);
  const effLibRef = libRef && s.libraries[libRef] ? libRef : libRefs[0] ?? null;

  // 当前编辑目标（场景 or 选中库）→ 统一成 RuleSet 视图 + 变更函数。
  const targetRS = isLib ? (effLibRef ? libToRS(s.libraries[effLibRef]) : EMPTY_RS) : s.ruleSet;
  const mutateTarget = isLib && effLibRef
    ? (fn: (rs: RuleSet) => void) => s.mutateLibrary(effLibRef, (lib) => { const rs = libToRS(lib); fn(rs); writeRS(rs, lib); })
    : s.mutateRuleSet;

  const meta = useMemo(() => buildMeta(targetRS, s.libraries), [targetRS, s.libraries]);
  // 两类 lint：PageDef↔模型绑定（仅场景）+ RuleSet 内在一致性（场景与库都查）。
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
  const jsonText = showJson === 'page' ? JSON.stringify(s.pageDef, null, 2) : showJson === 'rules' ? JSON.stringify(isLib && effLibRef ? s.libraries[effLibRef] : s.ruleSet, null, 2) : JSON.stringify(s.data, null, 2);

  // 规则集区：某个方面的中间编辑器。
  const rsAspectView = () => {
    switch (rsAspect) {
      case 'model': return <ModelDesigner ruleSet={targetRS} meta={meta} mutateRuleSet={mutateTarget} isLibrary={false} />;
      case 'rules': return <RulesEditor ruleSet={targetRS} imports={s.libraries} meta={meta} addField={addField} addRule={addRule} updateRule={updateRule} deleteRule={deleteRule} duplicateRule={duplicateRule} toggleRule={toggleRule} />;
      case 'modules': return <ModulesEditor ruleSet={targetRS} meta={meta} imports={s.libraries} mutateRuleSet={mutateTarget} />;
      case 'datasource': return <DataSourceEditor ruleSet={targetRS} mutateRuleSet={mutateTarget} />;
      case 'context': return <ContextSeams ruleSet={targetRS} imports={s.libraries} mutateRuleSet={mutateTarget} />;
      case 'imports': return <ImportsManager ruleSet={targetRS} catalog={s.libraries} mutateRuleSet={mutateTarget} />;
      case 'mock': return <ResolverSim ruleSet={targetRS} imports={s.libraries} mocks={s.mocks} mutateMocks={s.mutateMocks} />;
      case 'data': return <TestData data={s.data} setData={s.setData} />;
      case 'version': return <VersionPanel ruleSet={s.ruleSet} mutateRuleSet={s.mutateRuleSet} snapshots={s.snapshots} publish={s.publish} rollback={s.rollback} deleteSnapshot={s.deleteSnapshot} />;
      default: return null;
    }
  };
  // 库区：选中库的某个方面。
  const libAspectView = () => {
    if (!effLibRef) return <div className="lib-note">暂无库。左侧「新建库」创建一个类型/模块库；库可被场景在「规则集 → 引用的库」中 import。</div>;
    switch (libAspect) {
      case 'model': return <ModelDesigner ruleSet={targetRS} meta={meta} mutateRuleSet={mutateTarget} isLibrary />;
      case 'rules': return <RulesEditor ruleSet={targetRS} imports={s.libraries} meta={meta} addField={addField} addRule={addRule} updateRule={updateRule} deleteRule={deleteRule} duplicateRule={duplicateRule} toggleRule={toggleRule} />;
      case 'modules': return <ModulesEditor ruleSet={targetRS} meta={meta} imports={s.libraries} mutateRuleSet={mutateTarget} />;
      case 'datasource': return <DataSourceEditor ruleSet={targetRS} mutateRuleSet={mutateTarget} />;
      case 'context': return <ContextSeams ruleSet={targetRS} imports={s.libraries} mutateRuleSet={mutateTarget} />;
      default: return null;
    }
  };

  const rsAspects = biz ? RS_ASPECTS.filter((a) => BIZ_ASPECTS.includes(a.k)) : RS_ASPECTS;

  return (
    <div className="ed">
      <div className="ed-top">🧩 <b>可视化规则/参数编辑器</b>
        <span className="tag">规则集 · 库 · 页面 · 实时预览 · lint · undo/redo</span>
        <span className="ed-view">视图：
          <button className={'mini' + (role === 'dev' ? ' on' : '')} onClick={() => setRole('dev')}>开发者</button>
          <button className={'mini' + (role === 'biz' ? ' on' : '')} onClick={() => setRole('biz')}>业务</button>
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setShowPreview(true)}>▶ 预览</button>
        <button onClick={() => setShowStore(true)}>🗄 仓库</button>
        <button disabled={!s.canUndo} onClick={s.undo}>↶ 撤销</button>
        <button disabled={!s.canRedo} onClick={s.redo}>↷ 重做</button>
        <button onClick={doExport}>导出</button>
        <button onClick={() => fileRef.current?.click()}>导入</button>
        <button onClick={() => { if (confirm('重置为初始样例？将清除本地改动。')) s.reset(); }}>重置</button>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
      </div>

      <div className="ed-nav">
        <button className={section === 'ruleset' ? 'on' : ''} onClick={() => setSection('ruleset')}>{biz ? '参数' : '规则集'}</button>
        {!biz && <button className={section === 'library' ? 'on' : ''} onClick={() => setSection('library')}>库</button>}
        {!biz && <button className={section === 'page' ? 'on' : ''} onClick={() => setSection('page')}>页面</button>}
        <span className="ed-nav-ctx">{isLib ? <>编辑库 <b>{effLibRef ?? '（无）'}</b></> : section === 'page' ? <>页面 <b>{s.pageDef.title ?? s.ruleSet.ruleSetId}</b></> : <>场景 <b>{s.ruleSet.ruleSetId}</b></>}</span>
      </div>

      <div className="ed-lintbar">
        {errorCount ? <span className="lint bad">⛔ lint {errorCount} 错</span>
          : warnCount ? <span className="lint warn">⚠ lint {warnCount} 提醒</span>
            : <span className="lint ok">✔ lint 通过</span>}
        {s.restoredFromStorage && <span className="muted">（已从本地恢复）</span>}
        {lint.slice(0, 4).map((i, k) => <span key={k} className={'li ' + i.level}>{i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠' : 'ℹ'} <code>{i.path}</code> {i.message}</span>)}
        <span style={{ flex: 1 }} />
        <button className="mini" onClick={() => setShowJson(showJson === 'rules' ? 'none' : 'rules')}>{isLib ? '库' : 'RuleSet'} JSON</button>
        {!isLib && <button className="mini" onClick={() => setShowJson(showJson === 'page' ? 'none' : 'page')}>PageDef JSON</button>}
        {!isLib && <button className="mini" onClick={() => setShowJson(showJson === 'data' ? 'none' : 'data')}>Data JSON</button>}
      </div>

      <div className={'ed-main ' + (section === 'page' ? 'page' : 'split')}>
        {section === 'ruleset' && <>
          <div className="ed-aside">
            <div className="tree">
              {rsAspects.map((a) => (
                <div key={a.k} className={'tree-row' + (rsAspect === a.k ? ' sel' : '')} onClick={() => setRsAspect(a.k)}>
                  <b className="tr-label">{a.label}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="ed-center">{rsAspectView()}{jsonPane(showJson, isLib, jsonText, setShowJson)}</div>
        </>}

        {section === 'library' && <>
          <div className="ed-aside">
            <LibraryManager libraries={s.libraries} scenarioName={s.ruleSet.ruleSetId} editTarget={effLibRef ?? ''} setEditTarget={(t) => setLibRef(t || null)} addLibrary={s.addLibrary} deleteLibrary={s.deleteLibrary} showScenarioRow={false} />
          </div>
          <div className="ed-center">
            {effLibRef && (
              <div className="ed-tabs">
                {LIB_ASPECTS.map((a) => <button key={a.k} className={libAspect === a.k ? 'on' : ''} onClick={() => setLibAspect(a.k)}>{a.label}</button>)}
              </div>
            )}
            {libAspectView()}{jsonPane(showJson, isLib, jsonText, setShowJson)}
          </div>
        </>}

        {section === 'page' && <>
          <div className="ed-aside"><RulesetTree meta={meta} /></div>
          <div className="ed-center">
            <PageCanvas pageDef={s.pageDef} meta={meta} mutatePageDef={s.mutatePageDef} />
            {jsonPane(showJson, false, jsonText, setShowJson)}
          </div>
        </>}
      </div>

      {showPreview && (
        <Modal title="实时预览" onClose={() => setShowPreview(false)} wide>
          <Preview key={s.sessionRev} ruleSet={s.ruleSet} imports={s.libraries} data={s.data} pageDef={s.pageDef} mocks={s.mocks} lintErr={pageLint.filter((i) => i.level === 'error').length} />
        </Modal>
      )}
      {showStore && (
        <Modal title="规则仓库" onClose={() => setShowStore(false)}>
          <StorePanel currentBundle={s.currentBundle} importBundle={s.importBundle} scenarioName={s.ruleSet.ruleSetId} />
        </Modal>
      )}
    </div>
  );
}

// JSON 只读面板（RuleSet/PageDef/Data），随 lintbar 的按钮开合。
function jsonPane(showJson: 'none' | 'page' | 'rules' | 'data', isLib: boolean, jsonText: string, setShowJson: (v: 'none') => void) {
  if (showJson === 'none') return null;
  return (
    <div className="ed-json">
      <div className="ed-json-h"><b>{showJson === 'page' ? 'PageDef' : showJson === 'rules' ? (isLib ? '库' : 'RuleSet') : 'Data'} JSON</b>
        <span>
          <button onClick={() => navigator.clipboard?.writeText(jsonText)}>复制</button>
          <button onClick={() => setShowJson('none')} style={{ marginLeft: 6 }}>关闭</button>
        </span>
      </div>
      <pre>{jsonText}</pre>
    </div>
  );
}

// 极简模态：遮罩 + 卡片 + ✕ + Esc 关闭。
function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ed-modal-backdrop" onClick={onClose}>
      <div className={'ed-modal' + (wide ? ' wide' : '')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-modal-h"><b>{title}</b><button className="mini" onClick={onClose}>✕ 关闭</button></div>
        <div className="ed-modal-body">{children}</div>
      </div>
    </div>
  );
}
