// React 适配：把引擎 Session 暴露成一个 React 外部 store。
//   关键：引擎是 source of truth；组件读 ctx.valueOf(path) 实时取值，不在 React 里存值。
//   异步 resolver 完成 / 增量更新 → 引擎 onUpdate → 值版本++ → useSyncExternalStore 重渲染 →
//   所有 cell 重新读引擎，显示 resolved/pending/error。这是 Angular 端 markForCheck 修复的 React 等价物。
import { useState, useSyncExternalStore } from 'react';
import { CreateSession, EngineCtx, RuleSet, ResolveFn, Session, SessionState, makeCtx } from '@udsl/ui-kit-core';

export interface EngineStore {
  ctx: EngineCtx;
  getState: () => SessionState;
  subscribe: (cb: () => void) => () => void;
  /** 值+结构版本之和（驱动 useSyncExternalStore）。 */
  getVersion: () => number;
  /** 仅结构版本（增删子记录时变化 → 需重建 UI-IR）。 */
  getStructVersion: () => number;
  /** createSession 失败（如 import 未解析）时的错误信息；非空则渲染层应显示提示而非崩溃。 */
  error?: string;
}

export interface UseEngineOpts {
  createSession: CreateSession;
  ruleSet: RuleSet;
  imports: Record<string, RuleSet>;
  data: any;
  resolve: ResolveFn;
  /** 加载后从"已存字段值"重建覆盖态（默认只反推非外部依赖字段，避免汇率漂移误判）。 */
  reconstructOverrides?: boolean;
}

const EMPTY_STATE: SessionState = {
  tree: { path: 'root', type: '', fields: {}, collections: {}, slots: {} },
  validations: [], pinned: [], overrides: [], anyPending: false,
};
const NOOP_CTX: EngineCtx = {
  ccys: [], valueOf: () => '', cellText: () => '—', cellState: () => undefined, overridableFor: () => undefined,
  onInput: () => {}, onOverride: () => {}, clearOverride: () => {},
  addChild: () => {}, removeChild: () => {}, validationsFor: () => [], onTick: () => () => {},
};

function createStore(opts: UseEngineOpts): EngineStore {
  let valueVer = 0;
  let structVer = 0;
  const subs = new Set<() => void>();
  const fire = () => subs.forEach((s) => s());
  const base = {
    subscribe: (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); },
    getVersion: () => valueVer + structVer,
    getStructVersion: () => structVer,
  };

  try {
    const session = opts.createSession(opts.ruleSet, structuredClone(opts.data), {
      resolve: opts.resolve,
      imports: opts.imports,
      onUpdate: () => { valueVer++; fire(); },                  // 值刷新（含异步取数完成）
    });
    // 加载后重建覆盖态：从已存字段值反推人工覆盖（只非外部依赖字段）。纯计算字段同步即可判定；外部依赖字段自动跳过。
    if (opts.reconstructOverrides) { try { session.reconstructOverrides(structuredClone(opts.data), { skipExternalDependent: true }); } catch { /* 忽略 */ } }
    const built = makeCtx(session, () => session.getState(), () => { structVer++; fire(); });  // 增删 → 结构刷新
    return { ...base, ctx: built.ctx, getState: () => session.getState() };
  } catch (e: any) {
    // 建会话失败（常见：某 import ref 未解析）——不崩溃，返回错误态供渲染层提示。
    return { ...base, ctx: NOOP_CTX, getState: () => EMPTY_STATE, error: e?.message ?? String(e) };
  }
}

/** 建立一次会话并订阅其更新；返回 ctx / getState（实时） / 结构版本（供重建 UI-IR）。 */
export function useEngineSession(opts: UseEngineOpts): {
  ctx: EngineCtx;
  getState: () => SessionState;
  structVersion: number;
  version: number;
  error?: string;
} {
  const [store] = useState(() => createStore(opts));            // 仅建一次
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return { ctx: store.ctx, getState: store.getState, structVersion: store.getStructVersion(), version, error: store.error };
}
