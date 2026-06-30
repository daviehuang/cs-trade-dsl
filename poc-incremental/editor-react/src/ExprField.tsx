import { parseCached } from '@udsl/engine-kernel';

// 引导式表达式编辑：复用引擎自带 parser 做即时语法校验（绝不另写一套语法）。
export function ExprField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  let err: string | null = null;
  if (value.trim()) {
    try { parseCached(value); } catch (e: any) { err = e?.message ?? String(e); }
  }
  return (
    <div className="expr">
      <input className={err ? 'bad' : ''} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {err ? <span className="ex-err">✗ {err}</span> : value.trim() ? <span className="ex-ok">✓ 语法 OK</span> : null}
    </div>
  );
}
