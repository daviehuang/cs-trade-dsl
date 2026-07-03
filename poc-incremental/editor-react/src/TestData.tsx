import { useEffect, useState } from 'react';

// 域9 测试数据：可视化编辑运行记录（JSON）。校验通过后 setData → Preview 用新数据重建 session。
type Props = { data: any; setData: (d: any) => void };

export function TestData({ data, setData }: Props) {
  const [text, setText] = useState(() => JSON.stringify(data, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // 外部数据变化（undo/redo/import）时同步文本（仅在未编辑时）
  useEffect(() => { if (!dirty) setText(JSON.stringify(data, null, 2)); }, [data]); // eslint-disable-line

  const onChange = (v: string) => {
    setText(v); setDirty(true);
    try { JSON.parse(v); setErr(null); } catch (e: any) { setErr(e?.message ?? '非法 JSON'); }
  };
  const apply = () => { try { setData(JSON.parse(text)); setDirty(false); setErr(null); } catch (e: any) { setErr(e?.message ?? '非法 JSON'); } };
  const format = () => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); setErr(null); } catch { /* keep */ } };

  return (
    <div className="ed-sec">
      <h4>测试数据（运行记录 JSON）
        <button className="mini primary" disabled={!!err || !dirty} onClick={apply}>应用到预览</button>
        <button className="mini" onClick={format}>格式化</button>
      </h4>
      <div className="hint" style={{ marginTop: 0 }}>编辑后点「应用到预览」重建 session。集合(数组)、槽位(对象)按模型结构填；computed/external 字段无需填。</div>
      <textarea className="data-edit" value={text} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      {err ? <div className="lint bad" style={{ display: 'inline-block' }}>✗ {err}</div>
        : dirty ? <div className="lint warn" style={{ display: 'inline-block' }}>有改动，未应用</div>
          : <div className="lint ok" style={{ display: 'inline-block' }}>已同步</div>}
    </div>
  );
}
