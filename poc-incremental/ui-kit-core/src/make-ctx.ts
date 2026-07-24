// 中性 makeCtx：把一个引擎 Session 包成 EngineCtx（各框架适配器都用它）。
//   返回 { ctx, notify }：宿主在引擎 onUpdate 时调 notify()，驱动各框架重渲染
//   —— 异步 resolver 完成（无 DOM 事件）时必须主动通知（Angular=markForCheck / React=外部 store 订阅）。
import { Cell, Session, SessionState } from './engine-types';
import { CCYS, EngineCtx, resolveCell, resolveNode, treeToData } from './engine-shared';

export function makeCtx(
  session: Session,
  getState: () => SessionState,
  rebuild: () => void,
  /** 隔离编辑用：据当前数据现建一个 fork 副本会话（onUpdate 回调驱动弹窗重渲染）。宿主提供后才有 ctx.forkEdit。 */
  forkFactory?: (onUpdate: () => void) => Session,
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
    addChild: (parent, coll, obj) => { const p = session.addChild(parent, coll, obj); rebuild(); return p; },
    removeChild: (p) => { session.removeChild(p); rebuild(); },
    validationsFor: (p) => getState().validations.filter((v) => v.node === p && v.state === 'resolved'),
    evalExpr: (base, expr) => { try { return session.evalAt(base, expr); } catch { return undefined; } },  // 求值失败（如引用 pending 字段）→ undefined，调用方回退
    onTick: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    forkEdit: () => {
      if (!forkFactory) return null;
      let notify = () => {};
      const fs = forkFactory(() => notify());                   // 副本会话：onUpdate → 通知（驱动弹窗重渲染）
      const built = makeCtx(fs, () => fs.getState(), () => {}); // 副本 ctx（弹窗内一般不增删结构，rebuild 无操作）
      notify = built.notify;
      return {
        ctx: built.ctx,
        getState: () => fs.getState(),                          // 副本状态：新增行按副本 spec 水化用
        commit: (paths) => {                                    // 编辑「完成」：把副本里这些字段的值应用回主会话
          for (const p of paths) {
            const v = built.ctx.valueOf(p);
            try { session.setInput(p, v); }                     // 普通输入
            catch { try { session.setOverride(p, v); } catch { /* 纯 computed：跳过 */ } }  // 可覆盖字段
          }
        },
        addChild: (parent, coll, obj) => fs.addChild(parent, coll, obj),  // 新增行只落副本，主会话此刻不动
        commitAdd: (parent, coll, forkPath) => {                // 新增「完成」：副本行数据 → 主会话真加行（此时才级联）
          const row = resolveNode(fs.getState(), forkPath);
          session.addChild(parent, coll, row ? treeToData(row) : {});     // 含副本里编辑好的输入值；计算值由引擎重算
          rebuild();                                            // 主结构变化 → 重建 UI-IR（父页面显示新行）
        },
      };
    },
  };
  return { ctx, notify: () => listeners.forEach((f) => f()) };
}
