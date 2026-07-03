import { useMemo } from 'react';
import { RuleSet } from '@udsl/ui-kit-core';
import { Mocks, MockRow } from './mock';

// 域9 resolver 取数模拟：为每个已登记 dataSource 配 mock 值表（按 keySchema 引导），
//   预览时引擎按 rule.source + key 调 resolve，从这里查值并模拟异步 pending→resolved。
//   收集场景 + 各 import 库的 dataSources；mocks 存工作区（持久化/导入导出/undo）。
type Props = { ruleSet: RuleSet; imports: Record<string, RuleSet>; mocks: Mocks; mutateMocks: (fn: (m: Mocks) => void) => void; };

export function ResolverSim({ ruleSet, imports, mocks, mutateMocks }: Props) {
  // 已登记数据源（场景 + import 库），按 sourceId 去重。
  const sources = useMemo(() => {
    const map = new Map<string, any>();
    for (const d of (ruleSet.dataSources as any[]) ?? []) map.set(d.sourceId, d);
    for (const imp of ruleSet.imports ?? []) { const lib: any = imports[imp.ref]; for (const d of lib?.dataSources ?? []) if (!map.has(d.sourceId)) map.set(d.sourceId, d); }
    return [...map.values()];
  }, [ruleSet.dataSources, ruleSet.imports, imports]);

  const cfgOf = (sid: string) => mocks[sid] ?? { delayMs: 400, rows: [] };
  const setCfg = (sid: string, p: Partial<{ delayMs: number; rows: MockRow[]; fallback?: string }>) =>
    mutateMocks((m) => { m[sid] = { ...cfgOf(sid), ...p } as any; });

  return (
    <div className="ed-sec">
      <h4>取数模拟 resolver mocks（{sources.length} 个数据源）</h4>
      {sources.length === 0 && <div className="muted">暂无已登记数据源。到「数据源」tab 或所 import 的库里登记 dataSources 后，这里可配 mock 值。</div>}
      <p className="hint">引擎按 <code>rule.source</code> 调宿主 <code>resolve(source, key)</code>；此处为每个源配「条件→返回值」表，预览按 keySchema 匹配、模拟异步取数（pending→resolved），改值即 remount 重算。</p>

      {sources.map((d) => {
        const schema = Object.keys(d.keySchema ?? {});
        const cfg = cfgOf(d.sourceId);
        return (
          <div key={d.sourceId} className="rule-form" style={{ marginTop: 8 }}>
            <div className="rf-h"><b>{d.sourceId}</b><span className="muted" style={{ marginLeft: 8 }}>returns {d.returns} · key: {schema.join(', ') || '无'}</span></div>
            <div className="ed-row">
              <label>延迟 ms<input type="number" value={cfg.delayMs} onChange={(e) => setCfg(d.sourceId, { delayMs: Number(e.target.value) || 0 })} style={{ width: 90 }} /></label>
              <label>未命中 fallback<input value={cfg.fallback ?? ''} onChange={(e) => setCfg(d.sourceId, { fallback: e.target.value === '' ? undefined : e.target.value })} placeholder="留空=取数报错" style={{ width: 140 }} /></label>
            </div>

            <table className="ed-tbl">
              <thead><tr>{schema.map((k) => <th key={k}>{k}</th>)}<th>→ 返回值</th><th></th></tr></thead>
              <tbody>
                {cfg.rows.map((row, i) => (
                  <tr key={i}>
                    {schema.map((k) => (
                      <td key={k}><input value={row.when[k] ?? ''} onChange={(e) => setCfg(d.sourceId, { rows: cfg.rows.map((r, j) => j === i ? { ...r, when: { ...r.when, [k]: e.target.value } } : r) })} placeholder={k} style={{ width: 90 }} /></td>
                    ))}
                    <td><input value={row.value} onChange={(e) => setCfg(d.sourceId, { rows: cfg.rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r) })} placeholder="value" style={{ width: 100 }} /></td>
                    <td className="ops"><button className="del" onClick={() => setCfg(d.sourceId, { rows: cfg.rows.filter((_, j) => j !== i) })}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ed-row">
              <button className="primary" onClick={() => setCfg(d.sourceId, { rows: [...cfg.rows, { when: Object.fromEntries(schema.map((k) => [k, ''])), value: '' }] })}>＋ 加一行</button>
              <span className="muted" style={{ fontSize: 12 }}>按顺序取第一条全部条件命中的行</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
