import { useState } from 'react';
import { RuleSet } from '@udsl/ui-kit-core';

// 域4 数据源：编辑 dataSources（sourceId/version/returns/keySchema/authority/tolerance/cachePolicy）。
//   引擎不读 dataSources（契约/治理/BFF 用）；resolver 的 source 从这里登记的项里选、key 按 keySchema 引导。
type Props = { ruleSet: RuleSet; mutateRuleSet: (fn: (rs: RuleSet) => void) => void; };

export function DataSourceEditor({ ruleSet, mutateRuleSet }: Props) {
  const list: any[] = (ruleSet.dataSources as any) ?? [];
  const [sid, setSid] = useState('');

  const patchDS = (i: number, p: any) => mutateRuleSet((rs: any) => { rs.dataSources[i] = { ...rs.dataSources[i], ...p }; });
  const delDS = (i: number) => mutateRuleSet((rs: any) => { rs.dataSources.splice(i, 1); });
  const addDS = () => { if (!sid) return; mutateRuleSet((rs: any) => { (rs.dataSources ??= []).push({ sourceId: sid, version: '1.0.0', returns: 'decimal', keySchema: {}, authority: 'server' }); }); setSid(''); };

  const addKey = (i: number, name: string, type: string) => patchDS(i, { keySchema: { ...(list[i].keySchema ?? {}), [name]: type } });
  const delKey = (i: number, name: string) => { const ks = { ...(list[i].keySchema ?? {}) }; delete ks[name]; patchDS(i, { keySchema: ks }); };
  const setKeyType = (i: number, name: string, type: string) => patchDS(i, { keySchema: { ...(list[i].keySchema ?? {}), [name]: type } });

  return (
    <div className="ed-sec">
      <h4>数据源 dataSources（{list.length}）</h4>
      {list.length === 0 && <div className="muted">暂无数据源。resolver 规则的 source 需从此处登记后选择。</div>}

      {list.map((d, i) => <DSCard key={i} d={d} onPatch={(p) => patchDS(i, p)} onDelete={() => delDS(i)} onAddKey={(n, t) => addKey(i, n, t)} onDelKey={(n) => delKey(i, n)} onKeyType={(n, t) => setKeyType(i, n, t)} />)}

      <h4>＋ 新增数据源</h4>
      <div className="ed-row">
        <input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="sourceId，如 taxRateService" style={{ width: 220 }} />
        <button className="primary" disabled={!sid} onClick={addDS}>新增</button>
      </div>
      <p className="hint">引擎按 <code>rule.source</code> 字符串调用宿主 <code>resolve(source, key)</code> 取数；dataSources 是契约/治理元数据（keySchema/authority/tolerance/cachePolicy），供 lint 一致性校验与中台复核。</p>
    </div>
  );
}

function DSCard({ d, onPatch, onDelete, onAddKey, onDelKey, onKeyType }: {
  d: any; onPatch: (p: any) => void; onDelete: () => void;
  onAddKey: (n: string, t: string) => void; onDelKey: (n: string) => void; onKeyType: (n: string, t: string) => void;
}) {
  const [kn, setKn] = useState(''); const [kt, setKt] = useState('string');
  const tol = d.tolerance ?? {}; const cache = d.cachePolicy ?? {};
  const setTol = (p: any) => onPatch({ tolerance: { ...tol, ...p } });
  const setCache = (p: any) => onPatch({ cachePolicy: { ...cache, ...p } });

  return (
    <div className="rule-form" style={{ marginTop: 8 }}>
      <div className="rf-h"><b>{d.sourceId || '(未命名)'}</b><button className="del" onClick={onDelete}>删除</button></div>
      <div className="ed-grid">
        <label>sourceId<input value={d.sourceId ?? ''} onChange={(e) => onPatch({ sourceId: e.target.value })} /></label>
        <label>version<input value={d.version ?? ''} onChange={(e) => onPatch({ version: e.target.value })} /></label>
        <label>returns<select value={d.returns ?? 'decimal'} onChange={(e) => onPatch({ returns: e.target.value })}><option>decimal</option><option>int</option><option>string</option><option>date</option><option>object</option></select></label>
        <label>authority<input value={d.authority ?? ''} onChange={(e) => onPatch({ authority: e.target.value })} placeholder="如 server" /></label>
      </div>

      <div className="ds-sub">keySchema（取数键）</div>
      {Object.entries(d.keySchema ?? {}).map(([n, t]: any) => (
        <div key={n} className="ed-row"><code style={{ minWidth: 90 }}>{n}</code>:
          <select value={t} onChange={(e) => onKeyType(n, e.target.value)} style={{ width: 110 }}><option>string</option><option>decimal</option><option>int</option><option>date</option></select>
          <button className="del" onClick={() => onDelKey(n)}>✕</button>
        </div>
      ))}
      <div className="ed-row">
        <input value={kn} onChange={(e) => setKn(e.target.value)} placeholder="键名，如 from" style={{ width: 120 }} />:
        <select value={kt} onChange={(e) => setKt(e.target.value)} style={{ width: 110 }}><option>string</option><option>decimal</option><option>int</option><option>date</option></select>
        <button className="primary" disabled={!kn} onClick={() => { onAddKey(kn, kt); setKn(''); }}>加键</button>
      </div>

      <div className="ed-grid" style={{ marginTop: 8 }}>
        <label>tolerance 类型<select value={tol.type ?? ''} onChange={(e) => onPatch({ tolerance: e.target.value ? { type: e.target.value, value: tol.value ?? '0' } : undefined })}><option value="">（无）</option><option value="relative">relative</option><option value="absolute">absolute</option></select></label>
        {tol.type && <label>tolerance 值<input value={tol.value ?? ''} onChange={(e) => setTol({ value: e.target.value })} placeholder="如 0.0005" /></label>}
        <label>cache ttlSeconds<input value={cache.ttlSeconds ?? ''} onChange={(e) => setCache({ ttlSeconds: e.target.value ? Number(e.target.value) : undefined })} placeholder="如 300" /></label>
        <label>cache scope<input value={cache.scope ?? ''} onChange={(e) => setCache({ scope: e.target.value })} placeholder="如 valueDate" /></label>
      </div>
      <label className="full">description<input value={d.description ?? ''} onChange={(e) => onPatch({ description: e.target.value })} /></label>
    </div>
  );
}
