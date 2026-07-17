// 中性 makeCtx：把一个引擎 Session 包成 EngineCtx（各框架适配器都用它）。
//   返回 { ctx, notify }：宿主在引擎 onUpdate 时调 notify()，驱动各框架重渲染
//   —— 异步 resolver 完成（无 DOM 事件）时必须主动通知（Angular=markForCheck / React=外部 store 订阅）。
import { Cell, Session, SessionState } from './engine-types';
import { CCYS, EngineCtx, resolveCell } from './engine-shared';

export function makeCtx(
  session: Session,
  getState: () => SessionState,
  rebuild: () => void,
): { ctx: EngineCtx; notify: () => void } {
  const listeners = new Set<() => void>();
  const text = (c?: Cell) => (!c ? '—' : c.state === 'pending' ? '⏳ 计算中' : c.state === 'error' ? '✗ 错误' : (c.value ?? '—'));
  const ctx: EngineCtx = {
    ccys: CCYS,
    valueOf: (p) => resolveCell(getState(), p)?.value ?? '',
    cellText: (p) => text(resolveCell(getState(), p)),
    cellState: (p) => resolveCell(getState(), p)?.state,
    overridableFor: (p) => resolveCell(getState(), p)?.overridable,   // 实时可覆盖（随命中分支变化）
    onInput: (p, v) => session.setInput(p, v),
    onOverride: (p, v) => { try { session.setOverride(p, v); } catch { /* 非 overridable 忽略 */ } },
    clearOverride: (p) => session.clearOverride(p),
    addChild: (parent, coll, obj) => { session.addChild(parent, coll, obj); rebuild(); },
    removeChild: (p) => { session.removeChild(p); rebuild(); },
    validationsFor: (p) => getState().validations.filter((v) => v.node === p && v.state === 'resolved'),
    evalExpr: (base, expr) => { try { return session.evalAt(base, expr); } catch { return undefined; } },  // 求值失败（如引用 pending 字段）→ undefined，调用方回退
    onTick: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  return { ctx, notify: () => listeners.forEach((f) => f()) };
}
