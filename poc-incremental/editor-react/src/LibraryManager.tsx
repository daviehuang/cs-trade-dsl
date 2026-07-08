import { useState } from 'react';
import { RuleSet } from '@udsl/ui-kit-core';

// 库目录管理：列出/新建/删除库，并选择"编辑对象"（场景 or 某个库）。
//   库与场景结构一致（库用顶层 nodes/modules/rules/uses/context/dataSources），故可复用同一批编辑器。
type Props = {
  libraries: Record<string, RuleSet>;
  scenarioName: string;
  editTarget: string;                        // 'scenario' | ref
  setEditTarget: (t: string) => void;
  addLibrary: (ref: string, lib: RuleSet) => void;
  deleteLibrary: (ref: string) => void;
  showScenarioRow?: boolean;                 // 库区传 false：只列库，不显示「场景」行
};
const kindOf = (lib: RuleSet) =>
  [lib.nodes && Object.keys(lib.nodes).length ? '类型库' : '', lib.modules && Object.keys(lib.modules).length ? '模块库' : ''].filter(Boolean).join('+') || '空库';
const counts = (lib: RuleSet) =>
  `${Object.keys(lib.nodes ?? {}).length}节点 · ${Object.keys(lib.modules ?? {}).length}模块 · ${(lib.rules ?? []).length}规则 · ${(lib.dataSources ?? []).length}数据源`;

export function LibraryManager({ libraries, scenarioName, editTarget, setEditTarget, addLibrary, deleteLibrary, showScenarioRow = true }: Props) {
  const [id, setId] = useState('');
  const [ver, setVer] = useState('1.0.0');
  const [kind, setKind] = useState<'type' | 'module' | 'both'>('type');

  // 删除某库后的回退目标：优先其余库的第一个；无库时回场景（若显示场景行）或空。
  const fallbackAfterDelete = (removed: string) => {
    const rest = Object.keys(libraries).filter((r) => r !== removed);
    return rest[0] ?? (showScenarioRow ? 'scenario' : '');
  };

  const create = () => {
    if (!id) return;
    const ref = `${id}@${ver}`;
    if (libraries[ref]) { alert('已存在同名版本'); return; }
    const lib: any = { ruleSetId: id, version: ver, description: '（新建库）' };
    if (kind === 'type' || kind === 'both') { lib.nodes = {}; lib.rules = []; }
    if (kind === 'module' || kind === 'both') { lib.modules = {}; }
    addLibrary(ref, lib as RuleSet);
    setEditTarget(ref); setId('');
  };

  return (
    <div className="ed-sec">
      <h4>{showScenarioRow ? '编辑对象' : '库列表'}</h4>
      <div className="tree">
        {showScenarioRow && (
          <div className={'tree-row' + (editTarget === 'scenario' ? ' sel' : '')} onClick={() => setEditTarget('scenario')}>
            <span className="kind panel">场景</span><b className="tr-label">{scenarioName}</b>
            <span className="tr-ops"><button onClick={(e) => { e.stopPropagation(); setEditTarget('scenario'); }}>编辑</button></span>
          </div>
        )}
        {Object.keys(libraries).length === 0 && <div className="tree-row"><span className="muted">暂无库，下方新建。</span></div>}
        {Object.entries(libraries).map(([ref, lib]) => (
          <div key={ref} className={'tree-row lib-row' + (editTarget === ref ? ' sel' : '')} onClick={() => setEditTarget(ref)}>
            <div className="lib-row-top">
              <b className="tr-label">{ref}</b>
              <span className="kind collection">{kindOf(lib)}</span>
              <span style={{ flex: 1 }} />
              <button className="lib-del" title="删除库" onClick={(e) => { e.stopPropagation(); if (confirm(`删除库 ${ref}？引用它的场景/库将无法解析（发布前 lint 提示）。`)) { const fb = fallbackAfterDelete(ref); deleteLibrary(ref); if (editTarget === ref) setEditTarget(fb); } }}>✕</button>
            </div>
            <div className="lib-row-sub muted">{counts(lib)}</div>
          </div>
        ))}
      </div>

      <h4>新建库</h4>
      <div className="ed-grid">
        <label>ruleSetId<input value={id} onChange={(e) => setId(e.target.value)} placeholder="如 commonTax" /></label>
        <label>version<input value={ver} onChange={(e) => setVer(e.target.value)} /></label>
        <label>类型<select value={kind} onChange={(e) => setKind(e.target.value as any)}><option value="type">类型库（nodes+rules）</option><option value="module">模块库（modules）</option><option value="both">两者</option></select></label>
      </div>
      <button className="primary" disabled={!id} onClick={create}>新建库</button>
      <p className="hint">新建后自动切到该库进行编辑（模型/规则/上下文 tab 作用于所选编辑对象）。库可被"库"引用面板 import 到场景。</p>
    </div>
  );
}
