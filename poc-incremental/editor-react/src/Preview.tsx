import { useMemo, useState } from 'react';
import { createSession } from '@udsl/engine';
import { PageDef, RuleSet, SessionState, buildMeta, buildRootIR, hydratePage } from '@udsl/ui-kit-core';
import { UiRenderer, useEngineSession } from '@udsl/ui-kit-react';
import { makeResolve } from './fx';

const resolve = makeResolve(400);

// 实时预览 + 检查器：用【当前 RuleSet】建真 session，渲染【当前 PageDef】。
//   App 用 key={ruleSetRev} 让 RuleSet 变化时 remount → 新 session。PageDef/data 变化靠 useMemo 重算。
export function Preview({ ruleSet, imports, data, pageDef, lintErr }: {
  ruleSet: RuleSet; imports: Record<string, RuleSet>; data: any; pageDef: PageDef; lintErr: number;
}) {
  const { ctx, getState, structVersion, error } = useEngineSession({ createSession, ruleSet, imports, data, resolve });
  const meta = useMemo(() => buildMeta(ruleSet, imports), [ruleSet, imports]);
  const st = getState();
  const ir = useMemo(
    () => (lintErr > 0 ? buildRootIR(getState(), meta) : hydratePage(pageDef, getState(), meta)),
    [pageDef, structVersion, meta, lintErr, getState],
  );
  const [showInspector, setShowInspector] = useState(true);

  return (
    <div className="preview">
      <div className="pv-head">
        <b>实时预览</b>
        <span className={'status ' + (st.anyPending ? 'pending' : 'settled')}>{st.anyPending ? '⏳ 取数中' : '✅ 已结算'}</span>
        {lintErr > 0 && <span className="lint bad">⛔ PageDef 有 {lintErr} 个错误 —— 暂以自动布局预览</span>}
        <span style={{ flex: 1 }} />
        <button className="mini" onClick={() => setShowInspector((s) => !s)}>{showInspector ? '隐藏检查器' : '检查器'}</button>
      </div>
      {error
        ? <div className="lib-note" style={{ borderColor: '#f0d2d2', color: '#c0392b' }}>⛔ 建立会话失败：{error}<br /><span className="muted">常见原因：场景 import 的库未在库目录中（可能被删或版本不匹配）。到「库」面板补齐/修正 import 后即恢复。</span></div>
        : <>
          {showInspector && <Inspector state={st} />}
          <div className="pv-body"><UiRenderer ir={ir} ctx={ctx} /></div>
        </>}
    </div>
  );
}

// 检查器：引擎 getState() 的 overrides / pinned / validations 实时快照。
function Inspector({ state }: { state: SessionState }) {
  const fails = state.validations.filter((v) => v.state === 'resolved' && !v.ok);
  const oks = state.validations.filter((v) => v.state === 'resolved' && v.ok).length;
  return (
    <div className="inspector">
      <div className="ins-row">
        <span className="ins-tag">校验</span>
        <span className="lint ok">✔ {oks}</span>
        {fails.length ? <span className="lint bad">✘ {fails.length}</span> : null}
        {fails.map((v) => <span key={v.id + v.node} className="ins-fail" title={v.node}>{v.id}：{v.message}</span>)}
      </div>
      <div className="ins-row">
        <span className="ins-tag">覆盖 overrides</span>
        {state.overrides.length ? state.overrides.map((o) => <code key={o.field}>{o.field}={o.value}</code>) : <span className="muted">无</span>}
      </div>
      <div className="ins-row">
        <span className="ins-tag">钉值 pinned</span>
        {state.pinned.length ? state.pinned.map((p) => <code key={p.field} title={p.rateId}>{p.field}={p.value}</code>) : <span className="muted">无</span>}
      </div>
    </div>
  );
}
