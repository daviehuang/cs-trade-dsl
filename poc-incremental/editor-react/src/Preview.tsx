import { useMemo } from 'react';
import { createSession } from '@udsl/engine';
import { PageDef, RuleSet, buildMeta, buildRootIR, hydratePage } from '@udsl/ui-kit-core';
import { UiRenderer, useEngineSession } from '@udsl/ui-kit-react';
import { makeResolve } from './fx';

const resolve = makeResolve(400);

// 实时预览：用【当前 RuleSet】建真 session，渲染【当前 PageDef】。
//   App 用 key={ruleSetVersion} 让 RuleSet 变化时本组件 remount → 新 session（反映新规则）。
//   PageDef 变化不 remount，靠 useMemo 重算 UI-IR。
export function Preview({ ruleSet, imports, data, pageDef, lintErr }: {
  ruleSet: RuleSet; imports: Record<string, RuleSet>; data: any; pageDef: PageDef; lintErr: number;
}) {
  const { ctx, getState, structVersion } = useEngineSession({ createSession, ruleSet, imports, data, resolve });
  const meta = useMemo(() => buildMeta(ruleSet, imports), [ruleSet, imports]);
  const st = getState();
  const ir = useMemo(
    () => (lintErr > 0 ? buildRootIR(getState(), meta) : hydratePage(pageDef, getState(), meta)),
    [pageDef, structVersion, meta, lintErr, getState],
  );
  return (
    <div className="preview">
      <div className="pv-head">
        <b>实时预览</b>
        <span className={'status ' + (st.anyPending ? 'pending' : 'settled')}>{st.anyPending ? '⏳ 取数中' : '✅ 已结算'}</span>
        {lintErr > 0 && <span className="lint bad">⛔ PageDef 有 {lintErr} 个错误 —— 暂以自动布局预览</span>}
      </div>
      <div className="pv-body"><UiRenderer ir={ir} ctx={ctx} /></div>
    </div>
  );
}
