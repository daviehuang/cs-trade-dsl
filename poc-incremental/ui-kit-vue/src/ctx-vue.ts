// Vue 适配：把引擎 Session 暴露成响应式桥。
//   引擎是 source of truth；组件读 ctx.valueOf(path) 实时取值，不在 Vue 里存值。
//   异步 resolver 完成 / 增量更新 → 引擎 onUpdate → notify → version++（样本级响应式）
//   + UiRenderer 内部 onTick 重渲染。结构变化（增删子记录）→ structVersion++ → 重建 UI-IR。
import { ref, Ref } from 'vue';
import { CreateSession, EngineCtx, ResetRule, RuleSet, ResolveFn, SessionState, attachResetWatcher, makeCtx } from '@udsl/ui-kit-core';

export interface UseEngineOpts {
  createSession: CreateSession;
  ruleSet: RuleSet;
  imports: Record<string, RuleSet>;
  data: any;
  resolve: ResolveFn;
  /** 联动重置规则（计划 ②）：某字段变真时清空其它输入字段。通常来自 pageDef.resetRules。 */
  resetRules?: ResetRule[];
  /** 加载后从存盘字段值反推人工覆盖态（外部依赖字段用 data 里的汇率种回 resolver，无需 pins）。 */
  reconstructOverrides?: boolean;
}

const EMPTY_STATE: SessionState = {
  tree: { path: 'root', type: '', fields: {}, collections: {}, slots: {} },
  validations: [], pinned: [], overrides: [], anyPending: false,
};
const NOOP_CTX: EngineCtx = {
  ccys: [], valueOf: () => '', cellText: () => '—', cellState: () => undefined, overridableFor: () => undefined,
  onInput: () => {}, onOverride: () => {}, clearOverride: () => {},
  addChild: () => '', removeChild: () => {}, validationsFor: () => [], evalExpr: () => undefined, onTick: () => () => {},
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
    let watcherRun = () => {};                            // 后绑定：session 建成后指向 resetWatcher.run
    let watcherCommit = () => {};                         // 同上 → resetWatcher.commit（watch 值变化触发）
    const session = opts.createSession(opts.ruleSet, structuredClone(opts.data), {
      resolve: opts.resolve,
      imports: opts.imports,
      // when 边沿 + watch 值变化；输入 commit-on-blur，故 onUpdate 只在失焦提交时到来，watch 天然在失焦判定。
      onUpdate: () => { watcherRun(); watcherCommit(); notify(); },
    });
    // 加载后重建覆盖态：从已存字段值反推人工覆盖（外部依赖字段从 data 汇率种回 resolver）。须在 seed 前，使基线含覆盖。
    if (opts.reconstructOverrides) { try { session.reconstructOverrides(structuredClone(opts.data)); } catch { /* 忽略 */ } }
    const rebuild = () => { structVersion.value++; };    // 结构刷新（增删子记录 → 重建 UI-IR）
    const resetWatcher = attachResetWatcher(session, opts.resetRules, { onStructChange: rebuild });  // 联动重置（计划 ②）；删行走 rebuild，二次确认默认走浏览器 confirm
    resetWatcher.seed();                                  // 记录加载后真值基线（不触发，尊重既有数据）
    watcherRun = resetWatcher.run; watcherCommit = resetWatcher.commit;
    const built = makeCtx(session, () => session.getState(), rebuild);
    notify = built.notify;
    built.ctx.onTick(() => { version.value++; });        // 样本级响应式：每 tick 递增
    return { ctx: built.ctx, getState: () => session.getState(), structVersion, version };
  } catch (e: any) {
    return { ctx: NOOP_CTX, getState: () => EMPTY_STATE, structVersion, version, error: e?.message ?? String(e) };
  }
}
