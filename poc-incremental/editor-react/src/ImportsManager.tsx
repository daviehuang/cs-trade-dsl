import { useState } from 'react';
import { RuleSet } from '@udsl/ui-kit-core';

// 域6 库与依赖管理：从库目录按 ref 增删 imports；展示被引库的 nodes/modules/dataSources 概览。
//   catalog = 可用库注册表（ref → 库）；ruleSet.imports 决定本场景实际引用哪些。
type Props = { ruleSet: RuleSet; catalog: Record<string, RuleSet>; mutateRuleSet: (fn: (rs: RuleSet) => void) => void; };

const kindOf = (lib: RuleSet) =>
  [lib.nodes && Object.keys(lib.nodes).length ? '类型库' : '', lib.modules && Object.keys(lib.modules).length ? '模块库' : '']
    .filter(Boolean).join(' + ') || '库';

export function ImportsManager({ ruleSet, catalog, mutateRuleSet }: Props) {
  const imports = ruleSet.imports ?? [];
  const usedRefs = new Set(imports.map((i) => i.ref));
  const available = Object.keys(catalog).filter((ref) => !usedRefs.has(ref));
  const [pick, setPick] = useState('');
  const [alias, setAlias] = useState('');

  const add = () => {
    if (!pick) return;
    const lib = catalog[pick];
    const as = alias || lib.ruleSetId;
    mutateRuleSet((rs) => { rs.imports = [...(rs.imports ?? []), { ref: pick, as }]; });
    setPick(''); setAlias('');
  };
  const remove = (ref: string) => mutateRuleSet((rs) => { rs.imports = (rs.imports ?? []).filter((i) => i.ref !== ref); });

  return (
    <div className="ed-sec">
      <h4>已引用的库（{imports.length}）</h4>
      {imports.length === 0 && <div className="muted">未引用任何库</div>}
      {imports.map((imp) => {
        const lib = catalog[imp.ref];
        return (
          <div key={imp.ref} className="rule-form" style={{ marginTop: 8 }}>
            <div className="rf-h">
              <b>{imp.ref} <span className="kind">{lib ? kindOf(lib) : '未解析'}</span> <span className="muted">as {imp.as}</span></b>
              <button className="del" onClick={() => remove(imp.ref)}>移除</button>
            </div>
            {lib ? (
              <div className="hint" style={{ marginTop: 0 }}>
                {lib.nodes && <>节点：<code>{Object.keys(lib.nodes).join('、')}</code><br /></>}
                {lib.modules && <>模块：<code>{Object.keys(lib.modules).join('、')}</code>（引用为 <code>{imp.as}.模块名</code>）<br /></>}
                {lib.dataSources?.length ? <>数据源：<code>{lib.dataSources.map((d: any) => d.sourceId).join('、')}</code><br /></> : null}
                {lib.rules?.length ? <>随带规则：{lib.rules.length} 条　</> : null}
                {lib.uses?.length ? <>随带 uses：{lib.uses.length} 条</> : null}
              </div>
            ) : <div className="lint bad">⛔ 目录中找不到该 ref（无法解析）</div>}
          </div>
        );
      })}

      <h4>从库目录添加</h4>
      {available.length === 0 ? <div className="muted">目录中的库都已引用</div> : (
        <div className="ed-row">
          <select value={pick} onChange={(e) => { setPick(e.target.value); setAlias(catalog[e.target.value]?.ruleSetId ?? ''); }}>
            <option value="">选择库…</option>
            {available.map((ref) => <option key={ref} value={ref}>{ref}（{kindOf(catalog[ref])}）</option>)}
          </select>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="别名 as" style={{ width: 120 }} />
          <button className="primary" onClick={add} disabled={!pick}>引用</button>
        </div>
      )}
      <p className="hint">类型库贡献 nodes/rules/uses/context（扁平命名空间）；模块库的 modules 经别名 <code>as.模块名</code> 引用。移除会影响引用了其类型/模块的节点与规则（发布前 lint 会提示）。</p>
    </div>
  );
}
