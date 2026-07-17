import { Fragment, useMemo, useRef, useState } from 'react';
import { createSession } from '@udsl/engine';
import { ExplainCell, PageDef, RuleSet, SessionState, buildMeta, buildRootIR, hydratePage, treeToData } from '@udsl/ui-kit-core';
import { UiRenderer, useEngineSession } from '@udsl/ui-kit-react';
import { Mocks, makeResolveFromMocks } from './mock';
import { saveData } from './store/remoteStore';

// 实时预览 + 检查器：用【当前 RuleSet】建真 session，渲染【当前 PageDef】。
//   resolve 由「取数模拟」的 mocks 生成；App 用 key={sessionRev} 让 RuleSet/库/mocks 变化时 remount。
export function Preview({ ruleSet, imports, data, pageDef, mocks, lintErr }: {
  ruleSet: RuleSet; imports: Record<string, RuleSet>; data: any; pageDef: PageDef; mocks: Mocks; lintErr: number;
}) {
  const resolve = useMemo(() => makeResolveFromMocks(mocks), [mocks]);
  const { ctx, getState, explain, structVersion, error } = useEngineSession({ createSession, ruleSet, imports, data, resolve, reconstructOverrides: true, resetRules: pageDef.resetRules });
  const meta = useMemo(() => buildMeta(ruleSet, imports), [ruleSet, imports]);
  const [saveMsg, setSaveMsg] = useState('');
  // 保存运行时页面数据到仓库：treeToData(实时树) → PUT /api/data/<场景 ruleSetId>。
  //   存的是「值树」（含计算值），reload 时 createSession(ruleSet, data) 复原、reconstructOverrides 反推非外部覆盖。
  const onSaveData = async () => {
    setSaveMsg('保存中…');
    try {
      await saveData(ruleSet.ruleSetId, treeToData(getState().tree));
      setSaveMsg('✅ 已保存到仓库');
    } catch (e: any) {
      setSaveMsg('⛔ ' + (e?.message ?? String(e)));
    }
  };
  // 清空计算链显示（不清数据）：给当前所有 cell 值拍快照当基线；
  //   此后计算链只展示「相对基线有变化」的 cell —— 清屏后改动某个栏位，即可单独观察它触发的计算链。
  const baselineRef = useRef<Map<string, string> | null>(null);
  const [, setBaseVer] = useState(0);
  const clearChain = () => {
    const base = new Map<string, string>();
    for (const c of explain()) base.set(c.id, c.value ?? '∅');
    baselineRef.current = base;
    setBaseVer((v) => v + 1);
  };
  const st = getState();
  const ir = useMemo(
    () => (lintErr > 0 ? buildRootIR(getState(), meta) : hydratePage(pageDef, getState(), meta)),
    [pageDef, structVersion, meta, lintErr, getState],
  );
  const [showInspector, setShowInspector] = useState(true);
  const [showChain, setShowChain] = useState(false);

  return (
    <div className="preview">
      <div className="pv-head">
        <b>实时预览</b>
        <span className={'status ' + (st.anyPending ? 'pending' : 'settled')}>{st.anyPending ? '⏳ 取数中' : '✅ 已结算'}</span>
        {lintErr > 0 && <span className="lint bad">⛔ PageDef 有 {lintErr} 个错误 —— 暂以自动布局预览</span>}
        <span style={{ flex: 1 }} />
        {saveMsg && <span className="muted" style={{ fontSize: 17 }}>{saveMsg}</span>}
        {showChain && <button className="mini" disabled={!!error} title="清屏计算链：以当前值为基线，之后只显示有变化的计算，方便观察下一次改动触发的链路（不清数据）" onClick={clearChain}>🧹 清空</button>}
        <button className={'mini' + (showChain ? ' on' : '')} disabled={!!error} title="右侧实时摊开每个计算值的规则表达式、结果与依赖，方便调试" onClick={() => setShowChain((s) => !s)}>🔗 计算链</button>
        <button className="mini" disabled={!!error || st.anyPending} title="把当前填好的运行时数据（含计算值）存回仓库；重新加载即复原" onClick={onSaveData}>💾 保存数据</button>
        <button className="mini" onClick={() => setShowInspector((s) => !s)}>{showInspector ? '隐藏检查器' : '检查器'}</button>
      </div>
      {error
        ? <div className="lib-note" style={{ borderColor: '#f0d2d2', color: '#c0392b' }}>⛔ 建立会话失败：{error}<br /><span className="muted">常见原因：场景 import 的库未在库目录中（可能被删或版本不匹配）。到「库」面板补齐/修正 import 后即恢复。</span></div>
        : <>
          {showInspector && <Inspector state={st} />}
          <div className={'pv-main' + (showChain ? ' with-chain' : '')}>
            <div className="pv-body"><UiRenderer ir={ir} ctx={ctx} /></div>
            {showChain && <ComputeChain explain={explain} baseline={baselineRef.current} />}
          </div>
        </>}
    </div>
  );
}

// 规则计算链（调试）：每个计算值/取数 cell = 表达式 → 结果 [态]，并列出其依赖及各依赖当前值。
//   数据来自引擎 explain()：cell 的 kind/值/态/表达式/依赖边。随每次结算实时刷新。
//   baseline 非空时（点过「清空」）只显示相对基线值有变化的 cell —— 观察下一次改动触发的链路。
function ComputeChain({ explain, baseline }: { explain: () => ExplainCell[]; baseline: Map<string, string> | null }) {
  const cells = explain();
  const byId = new Map(cells.map((c) => [c.id, c]));
  const short = (id: string) => id.replace(/^root\.?/, '') || 'root';
  const leaf = (id: string) => id.slice(id.lastIndexOf('.') + 1);
  const stCls = (s: string, ov?: boolean) => (ov ? 'ovr' : s === 'pending' ? 'pend' : s === 'error' ? 'err' : s === 'input' ? 'inp' : 'ok');
  const exprOf = (c: ExplainCell): string => {
    if (c.kind === 'resolver') return `resolve(${c.source}, {${Object.keys(c.key ?? {}).join(', ')}})`;
    if (c.cases) {
      if (c.cases.length === 1) return c.cases[0].expr;
      const a = c.cases.find((k) => k.active);
      return a ? `${a.when ? '[' + a.when + '] ' : '[else] '}${a.expr}` : c.fallback === 'input' ? '（未匹配→手工输入）' : '（未匹配→空）';
    }
    return c.expr ?? '';
  };
  const depsOf = (c: ExplainCell) =>
    c.deps.filter((d) => !d.startsWith('__ctx.')).map((d) => ({ n: short(d), v: byId.get(d)?.value ?? '∅' }));

  // 拓扑深度（严格拓扑序的排序键）：叶子/输入直算=0，往下每依赖一层 +1。
  //   基于完整依赖图（含未显示的 input cell）递归求值，memo 缓存；引擎为 DAG，stack 仅作环的防御。
  const depthOf = (() => {
    const cache = new Map<string, number>();
    const calc = (id: string, stack: Set<string>): number => {
      const hit = cache.get(id);
      if (hit !== undefined) return hit;
      if (stack.has(id)) return 0;
      const c = byId.get(id);
      if (!c) return 0;                                              // 依赖已不在图中（如已删）→ 视为叶子
      stack.add(id);
      const ds = c.deps.filter((d) => !d.startsWith('__ctx.') && byId.has(d));
      const d = ds.length ? 1 + Math.max(...ds.map((x) => calc(x, stack))) : 0;
      stack.delete(id);
      cache.set(id, d);
      return d;
    };
    return (id: string) => calc(id, new Set<string>());
  })();

  // 差分：cell 值相对基线是否变化（仅在点过「清空」即 baseline 非空时有意义）。
  const diff = (c: ExplainCell) => baseline != null && baseline.get(c.id) !== (c.value ?? '∅');
  // 严格拓扑序：按深度升序（上游→下游）平铺；同层再按节点、字段名稳定排序。
  //   源头输入（input）仅在「清空后有变化」时纳入 —— 即用户刚改的那个栏位，depth=0 自然排为链路起点。
  const rules = cells
    .filter((c) => (c.kind === 'input'
      ? diff(c)
      : (c.kind === 'computed' || c.kind === 'resolver') && (baseline == null || diff(c))))
    .map((c) => ({ c, d: depthOf(c.id) }))
    .sort((a, b) => a.d - b.d || a.c.nodePath.localeCompare(b.c.nodePath) || a.c.id.localeCompare(b.c.id));

  return (
    <div className="chain">
      <div className="chain-h">🔗 规则计算链 <span className="muted">{baseline ? '源头输入 → 受影响的计算（拓扑序）' : '拓扑序：上游 → 下游（表达式 → 结果 ← 依赖）'}</span></div>
      <div className="chain-body">
        {rules.length === 0 && <div className="chain-empty">{baseline ? '✨ 已清空 —— 改变任意栏位即可观察其触发的计算链' : '（无计算值）'}</div>}
        {rules.map(({ c, d }, idx) => {
          const ds = depsOf(c);
          const showLvl = idx === 0 || rules[idx - 1].d !== d;      // 深度变化 → 插入层级分隔
          return (
            <Fragment key={c.id}>
              {showLvl && <div className="chain-lvl">L{d} · {d === 0 ? '源头' : '第 ' + d + ' 层'}</div>}
              <div className={'chain-row ' + (c.kind === 'input' ? 'inp' : stCls(c.state, c.overridden))}>
                <div className="chain-line">
                  <span className="chain-np-inline" title={short(c.nodePath) || '根'}>{short(c.nodePath) || '根'}</span>
                  <b className="chain-f">{leaf(c.id)}</b>
                  {c.kind === 'input' ? (
                    <>
                      <span className="chain-op" title="用户输入">⌨</span>
                      <span className="chain-val">{c.value ?? '∅'}</span>
                      <span className="chain-badge inp">源头</span>
                    </>
                  ) : (
                    <>
                      <span className="chain-op">=</span>
                      <code className="chain-expr">{exprOf(c)}</code>
                      <span className="chain-op">→</span>
                      <span className="chain-val">{c.value ?? '∅'}</span>
                      <span className={'chain-badge ' + stCls(c.state, c.overridden)}>{c.overridden ? '覆盖' : c.state}</span>
                    </>
                  )}
                </div>
                {ds.length > 0 && (
                  <div className="chain-deps">← {ds.map((dep, i) => <code key={i} title={dep.n}>{dep.n}=<b>{dep.v}</b></code>)}</div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
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
