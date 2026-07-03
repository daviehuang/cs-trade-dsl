import { useCallback, useEffect, useRef, useState } from 'react';
import { PageDef, RuleSet } from '@udsl/ui-kit-core';
import { Mocks } from '../mock';

// 编辑器工作区：一份工件 = { ruleSet, pageDef, data, libraries }。
//   libraries = 可编辑的库目录（ref → 库），既供 import 引用，也可在编辑器里新建/编辑。
//   提供 undo/redo（history 栈）、localStorage 自动持久化、导入/导出、重置。
//   sessionRev 在 ruleSet 或 libraries 引用变化时自增（驱动 Preview remount 出新 session）。
export interface Bundle { ruleSet: RuleSet; pageDef: PageDef; data: any; libraries: Record<string, RuleSet>; mocks: Mocks; }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const LS_KEY = 'udsl-editor-bundle-v2';
const MAX_HIST = 100;

export interface EditorStore {
  ruleSet: RuleSet; pageDef: PageDef; data: any; libraries: Record<string, RuleSet>; mocks: Mocks;
  rev: number;            // 任意变更自增（memo/lint 依赖）
  sessionRev: number;     // ruleSet / libraries / mocks 变更自增（Preview remount 出新 session + resolve）
  setRuleSet: (rs: RuleSet) => void;
  setPageDef: (pd: PageDef) => void;
  setData: (d: any) => void;
  mutateRuleSet: (fn: (rs: RuleSet) => void) => void;
  mutateMocks: (fn: (m: Mocks) => void) => void;
  mutatePageDef: (fn: (pd: PageDef) => void) => void;
  mutateLibrary: (ref: string, fn: (lib: RuleSet) => void) => void;
  addLibrary: (ref: string, lib: RuleSet) => void;
  deleteLibrary: (ref: string) => void;
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
  exportBundle: () => string;
  importBundle: (b: Partial<Bundle>) => void;
  reset: () => void;
  restoredFromStorage: boolean;
}

export function useEditorStore(initial: Bundle): EditorStore {
  const restored = useRef(false);
  const [hist, setHist] = useState<Bundle[]>(() => {
    const saved = typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY);
    if (saved) {
      try {
        const b = JSON.parse(saved);
        if (b?.ruleSet && b?.pageDef) {
          restored.current = true;
          // 回填内置库目录：旧/残缺的持久化里 libraries 可能缺失，导致引擎解析不到 import。
          return [{ ...clone(initial), ...b, libraries: { ...initial.libraries, ...(b.libraries || {}) }, mocks: { ...initial.mocks, ...(b.mocks || {}) } }];
        }
      } catch { /* ignore */ }
    }
    return [clone(initial)];
  });
  const [idx, setIdx] = useState(0);
  const [rev, setRev] = useState(0);
  const cur = hist[idx];

  // ruleSet / libraries 引用变化检测 → sessionRev
  const refs = useRef({ rs: cur.ruleSet, libs: cur.libraries, mocks: cur.mocks, n: 0 });
  if (refs.current.rs !== cur.ruleSet || refs.current.libs !== cur.libraries || refs.current.mocks !== cur.mocks) { refs.current = { rs: cur.ruleSet, libs: cur.libraries, mocks: cur.mocks, n: refs.current.n + 1 }; }
  const sessionRev = refs.current.n;

  const commit = useCallback((next: Bundle) => {
    setHist((h) => { const base = h.slice(Math.max(0, idx + 1 - MAX_HIST), idx + 1); return [...base, next]; });
    setIdx((i) => Math.min(i + 1, MAX_HIST - 1));
    setRev((r) => r + 1);
  }, [idx]);

  const patch = useCallback((p: Partial<Bundle>) => commit({ ...cur, ...p }), [commit, cur]);
  const setRuleSet = useCallback((rs: RuleSet) => patch({ ruleSet: rs }), [patch]);
  const setPageDef = useCallback((pd: PageDef) => patch({ pageDef: pd }), [patch]);
  const setData = useCallback((d: any) => patch({ data: d }), [patch]);
  const mutateRuleSet = useCallback((fn: (rs: RuleSet) => void) => { const rs = clone(cur.ruleSet); fn(rs); patch({ ruleSet: rs }); }, [patch, cur]);
  const mutateMocks = useCallback((fn: (m: Mocks) => void) => { const m = clone(cur.mocks); fn(m); patch({ mocks: m }); }, [patch, cur]);
  const mutatePageDef = useCallback((fn: (pd: PageDef) => void) => { const pd = clone(cur.pageDef); fn(pd); patch({ pageDef: pd }); }, [patch, cur]);
  const mutateLibrary = useCallback((ref: string, fn: (lib: RuleSet) => void) => { const libs = { ...cur.libraries }; const lib = clone(libs[ref]); fn(lib); libs[ref] = lib; patch({ libraries: libs }); }, [patch, cur]);
  const addLibrary = useCallback((ref: string, lib: RuleSet) => { patch({ libraries: { ...cur.libraries, [ref]: clone(lib) } }); }, [patch, cur]);
  const deleteLibrary = useCallback((ref: string) => { const libs = { ...cur.libraries }; delete libs[ref]; patch({ libraries: libs }); }, [patch, cur]);

  const canUndo = idx > 0, canRedo = idx < hist.length - 1;
  const undo = useCallback(() => setIdx((i) => { if (i > 0) { setRev((r) => r + 1); return i - 1; } return i; }), []);
  const redo = useCallback(() => setIdx((i) => { if (i < hist.length - 1) { setRev((r) => r + 1); return i + 1; } return i; }), [hist.length]);

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(cur)); } catch { /* quota */ } }, [cur]);

  const exportBundle = useCallback(() => JSON.stringify(cur, null, 2), [cur]);
  const importBundle = useCallback((b: Partial<Bundle>) => {
    const next: Bundle = { ruleSet: b.ruleSet ?? cur.ruleSet, pageDef: b.pageDef ?? cur.pageDef, data: b.data ?? cur.data, libraries: b.libraries ?? cur.libraries, mocks: b.mocks ?? cur.mocks };
    setHist([clone(next)]); setIdx(0); setRev((r) => r + 1);
  }, [cur]);
  const reset = useCallback(() => { try { localStorage.removeItem(LS_KEY); } catch { /* */ } setHist([clone(initial)]); setIdx(0); setRev((r) => r + 1); }, [initial]);

  return {
    ruleSet: cur.ruleSet, pageDef: cur.pageDef, data: cur.data, libraries: cur.libraries, mocks: cur.mocks, rev, sessionRev,
    setRuleSet, setPageDef, setData, mutateRuleSet, mutateMocks, mutatePageDef, mutateLibrary, addLibrary, deleteLibrary,
    canUndo, canRedo, undo, redo, exportBundle, importBundle, reset, restoredFromStorage: restored.current,
  };
}
