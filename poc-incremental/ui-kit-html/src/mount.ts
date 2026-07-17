// 原生 HTML 会话管理：建引擎 Session → 首渲染 → 订阅更新重渲染（值刷新 + 结构变化都全量重建）。
//   与 React 的 useEngineSession / Angular 的 markForCheck 等价——异步 resolver 完成（无 DOM 事件）
//   时引擎 onUpdate → notify → onTick → 重渲染。全量重建后按 data-path 恢复输入焦点与光标位置。
import { CreateSession, EngineCtx, ResetRule, RuleSet, ResolveFn, SessionState, UINode, attachResetWatcher, makeCtx } from '@udsl/ui-kit-core';
import { renderUINode } from './render';

export interface MountOpts {
  container: HTMLElement;
  createSession: CreateSession;
  ruleSet: RuleSet;
  imports: Record<string, RuleSet>;
  data: any;
  resolve: ResolveFn;
  /** 宿主决定 IR 来源：hydratePage(pageDef,state,meta) 或 buildRootIR(state,meta)。 */
  buildIR: (state: SessionState) => UINode[];
  /** 联动重置规则（计划 ②）：某字段变真时清空其它输入字段。通常来自 pageDef.resetRules。 */
  resetRules?: ResetRule[];
}

export interface MountHandle {
  ctx: EngineCtx;
  getState: () => SessionState;
  /** 主动重渲染（如宿主切换 IR 来源后调用）。 */
  refresh: () => void;
  /** 建会话失败（如 import 未解析）时的错误信息。 */
  error?: string;
  destroy: () => void;
}

/** 记录当前焦点输入的 path + 光标，重建后恢复（全量重建会丢焦点）。 */
function captureFocus(container: HTMLElement): { path: string; start: number | null; end: number | null } | null {
  const a = document.activeElement as HTMLInputElement | null;
  if (!a || !container.contains(a) || !a.dataset || !a.dataset['path']) return null;
  const canSel = a.tagName === 'INPUT';
  return { path: a.dataset['path'], start: canSel ? a.selectionStart : null, end: canSel ? a.selectionEnd : null };
}
function restoreFocus(container: HTMLElement, f: ReturnType<typeof captureFocus>) {
  if (!f) return;
  const el = container.querySelector<HTMLInputElement>(`[data-path="${CSS.escape(f.path)}"]`);
  if (!el) return;
  el.focus();
  if (f.start != null && el.tagName === 'INPUT') { try { el.setSelectionRange(f.start, f.end ?? f.start); } catch { /* 类型不支持选区 */ } }
}

export function mountEngineSession(opts: MountOpts): MountHandle {
  const { container } = opts;
  let handle: MountHandle;

  const render = () => {
    const f = captureFocus(container);
    const ir = opts.buildIR(handle.getState());
    container.replaceChildren(...ir.map((n) => renderUINode(n, handle.ctx)));
    restoreFocus(container, f);
  };

  try {
    // onUpdate 在 session 建成前定义；用后绑定的 notify（结构闭包）驱动。
    let notify = () => {};
    let watcherRun = () => {};                        // 后绑定：session 建成后指向 resetWatcher.run
    const session = opts.createSession(opts.ruleSet, structuredClone(opts.data), {
      resolve: opts.resolve,
      imports: opts.imports,
      onUpdate: () => { watcherRun(); notify(); },    // 值刷新（含异步取数完成）→ 先跑联动重置 → onTick
    });
    const resetWatcher = attachResetWatcher(session, opts.resetRules, () => render());  // 联动重置（计划 ②）；删行 → 重渲染
    resetWatcher.seed();                              // 记录加载后真值基线（不触发，尊重既有数据）
    watcherRun = resetWatcher.run;
    const built = makeCtx(session, () => session.getState(), () => render());  // 增删子记录 → 结构重建
    notify = built.notify;
    built.ctx.onTick(() => render());                 // 值刷新也重渲染（受控 DOM 从引擎取值）
    handle = { ctx: built.ctx, getState: () => session.getState(), refresh: render, destroy: () => container.replaceChildren() };
  } catch (e: any) {
    const banner = document.createElement('div');
    banner.className = 'eg-error';
    banner.textContent = '⛔ 建立引擎会话失败：' + (e?.message ?? String(e));
    container.replaceChildren(banner);
    const EMPTY: SessionState = { tree: { path: 'root', type: '', fields: {}, collections: {}, slots: {} }, validations: [], pinned: [], overrides: [], anyPending: false };
    const NOOP: any = { ccys: [], valueOf: () => '', cellText: () => '—', cellState: () => undefined, onInput: () => {}, onOverride: () => {}, clearOverride: () => {}, addChild: () => {}, removeChild: () => {}, validationsFor: () => [], onTick: () => () => {} };
    handle = { ctx: NOOP, getState: () => EMPTY, refresh: () => {}, error: e?.message ?? String(e), destroy: () => container.replaceChildren() };
    return handle;
  }

  render();
  return handle;
}
