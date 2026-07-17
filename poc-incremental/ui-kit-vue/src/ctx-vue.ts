// Vue 适配：把引擎 Session 暴露成响应式桥。
//   引擎是 source of truth；组件读 ctx.valueOf(path) 实时取值，不在 Vue 里存值。
//   异步 resolver 完成 / 增量更新 → 引擎 onUpdate → notify → version++（样本级响应式）
//   + UiRenderer 内部 onTick 重渲染。结构变化（增删子记录）→ structVersion++ → 重建 UI-IR。
import { ref, Ref } from 'vue';
import { CreateSession, EngineCtx, RuleSet, ResolveFn, SessionState, makeCtx } from '@udsl/ui-kit-core';

export interface UseEngineOpts {
  createSession: CreateSession;
  ruleSet: RuleSet;
  imports: Record<string, RuleSet>;
  data: any;
  resolve: ResolveFn;
}

const EMPTY_STATE: SessionState = {
  tree: { path: 'root', type: '', fields: {}, collections: {}, slots: {} },
  validations: [], pinned: [], overrides: [], anyPending: false,
};
const NOOP_CTX: EngineCtx = {
  ccys: [], valueOf: () => '', cellText: () => '—', cellState: () => undefined, overridableFor: () => undefined,
  onInput: () => {}, onOverride: () => {}, clearOverride: () => {},
  addChild: () => {}, removeChild: () => {}, validationsFor: () => [], evalExpr: () => undefined, onTick: () => () => {},
};

export interface EngineSession {
  ctx: EngineCtx;
  getState: () => SessionState;
  /** 结构版本（增删子记录时 ++）→ 供 computed 重建 UI-IR。 */
  structVersion: Ref<number>;
  /** 值+结构版本（每次 tick ++）→ 供样本级派生状态（如 anyPending 徽章）。 */
  version: Ref<number>;
  /** 建会话失败（如 import 未解析）时的错误信息。 */
  error?: string;
}

/** 建立一次会话并接好响应式桥。 */
export function useEngineSession(opts: UseEngineOpts): EngineSession {
  const structVersion = ref(0);
  const version = ref(0);
  try {
    let notify = () => {};
    const session = opts.createSession(opts.ruleSet, structuredClone(opts.data), {
      resolve: opts.resolve,
      imports: opts.imports,
      onUpdate: () => notify(),                          // 值刷新（含异步取数完成）
    });
    const built = makeCtx(session, () => session.getState(), () => { structVersion.value++; });  // 结构刷新
    notify = built.notify;
    built.ctx.onTick(() => { version.value++; });        // 样本级响应式：每 tick 递增
    return { ctx: built.ctx, getState: () => session.getState(), structVersion, version };
  } catch (e: any) {
    return { ctx: NOOP_CTX, getState: () => EMPTY_STATE, structVersion, version, error: e?.message ?? String(e) };
  }
}
