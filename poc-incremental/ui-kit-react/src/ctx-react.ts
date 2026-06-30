// React 适配：把引擎 Session 暴露成一个 React 外部 store。
//   关键：引擎是 source of truth；组件读 ctx.valueOf(path) 实时取值，不在 React 里存值。
//   异步 resolver 完成 / 增量更新 → 引擎 onUpdate → 值版本++ → useSyncExternalStore 重渲染 →
//   所有 cell 重新读引擎，显示 resolved/pending/error。这是 Angular 端 markForCheck 修复的 React 等价物。
import { useState, useSyncExternalStore } from 'react';
import { CreateSession, EngineCtx, RuleSet, ResolveFn, Session, SessionState, makeCtx } from '@udsl/ui-kit-core';

export interface EngineStore {
  session: Session;
  ctx: EngineCtx;
  getState: () => SessionState;
  subscribe: (cb: () => void) => () => void;
  /** 值+结构版本之和（驱动 useSyncExternalStore）。 */
  getVersion: () => number;
  /** 仅结构版本（增删子记录时变化 → 需重建 UI-IR）。 */
  getStructVersion: () => number;
}

export interface UseEngineOpts {
  createSession: CreateSession;
  ruleSet: RuleSet;
  imports: Record<string, RuleSet>;
  data: any;
  resolve: ResolveFn;
}

function createStore(opts: UseEngineOpts): EngineStore {
  let valueVer = 0;
  let structVer = 0;
  const subs = new Set<() => void>();
  const fire = () => subs.forEach((s) => s());

  const session = opts.createSession(opts.ruleSet, structuredClone(opts.data), {
    resolve: opts.resolve,
    imports: opts.imports,
    onUpdate: () => { valueVer++; fire(); },                    // 值刷新（含异步取数完成）
  });
  const built = makeCtx(session, () => session.getState(), () => { structVer++; fire(); });  // 增删 → 结构刷新

  return {
    session,
    ctx: built.ctx,
    getState: () => session.getState(),
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    getVersion: () => valueVer + structVer,
    getStructVersion: () => structVer,
  };
}

/** 建立一次会话并订阅其更新；返回 ctx / getState（实时） / 结构版本（供重建 UI-IR）。 */
export function useEngineSession(opts: UseEngineOpts): {
  ctx: EngineCtx;
  getState: () => SessionState;
  structVersion: number;
  version: number;
} {
  const [store] = useState(() => createStore(opts));            // 仅建一次
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return { ctx: store.ctx, getState: store.getState, structVersion: store.getStructVersion(), version };
}
