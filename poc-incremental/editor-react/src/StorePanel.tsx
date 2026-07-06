import { useEffect, useState } from 'react';
import { Bundle } from './store/editorStore';
import { Catalog, getCatalog, saveWorkspace, loadWorkspace } from './store/remoteStore';

// 域12（一期）文件式规则仓库：把当前工作区「保存到仓库」= 拆成 库/规则集/页面/数据/feature 落成 JSON 文件；
//   从仓库「加载」一笔交易 = 拉回组装进编辑器。仓库由 store-server(:8788) 提供，运行时页也从同一仓库拉取。
type Props = {
  currentBundle: () => Bundle;
  importBundle: (b: Partial<Bundle>) => void;
  scenarioName: string;
};

export function StorePanel({ currentBundle, importBundle, scenarioName }: Props) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [title, setTitle] = useState('');

  const refresh = () => getCatalog().then(setCat).catch((e) => setMsg({ ok: false, text: '连接仓库失败：' + e.message + '（store-server 是否已启动？node store-server.js）' }));
  useEffect(() => { refresh(); }, []);

  const doSave = async () => {
    setBusy(true); setMsg(null);
    try {
      const written = await saveWorkspace(currentBundle(), title || undefined);
      setMsg({ ok: true, text: `已保存到仓库 ${written.length} 个文件：${written.join('、')}` });
      refresh();
    } catch (e: any) { setMsg({ ok: false, text: '保存失败：' + e.message }); }
    finally { setBusy(false); }
  };

  const doLoad = async (featureId: string) => {
    if (!confirm(`从仓库加载「${featureId}」？将覆盖当前工作区（可 undo 回退）。`)) return;
    setBusy(true); setMsg(null);
    try {
      const b = await loadWorkspace(featureId);
      importBundle(b);
      setMsg({ ok: true, text: `已从仓库加载 ${featureId}（ruleSet ${b.ruleSet.ruleSetId}、库 ${Object.keys(b.libraries).length} 个）` });
    } catch (e: any) { setMsg({ ok: false, text: '加载失败：' + e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="ed-sec">
      <h4>规则仓库（文件式，前后贯通）</h4>
      <p className="hint">仓库 = store-server 磁盘上的 JSON 文件。「保存」把当前工作区拆成库/规则集/页面/数据/feature 写入仓库；
        运行时加载器（runtime-loader）与其它宿主启动时从<b>同一仓库</b>按 feature 拉取渲染——规则不编译进包。</p>

      <div className="ed-row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`feature 标题（默认取页面标题）`} style={{ flex: 1, minWidth: 220 }} />
        <button className="primary" disabled={busy} onClick={doSave}>保存到仓库（发布）</button>
        <button className="mini" disabled={busy} onClick={refresh}>刷新目录</button>
      </div>
      <p className="hint">保存目标 feature = 当前场景 <code>{scenarioName}</code>（同名覆盖）。</p>

      {msg && <div className={msg.ok ? 'lint ok' : 'lint bad'} style={{ display: 'block', margin: '8px 0', padding: '7px 10px' }}>{msg.ok ? '✔ ' : '⛔ '}{msg.text}</div>}

      <h4>仓库目录 {cat && `（feature ${cat.features.length} · 规则集 ${cat.rulesets.length} · 库 ${cat.libraries.length} · 页面 ${cat.pages.length}）`}</h4>
      {!cat && <div className="muted">正在读取仓库…</div>}
      {cat && (
        <>
          <div className="ds-sub">交易 features（可加载进编辑器）</div>
          {cat.features.length === 0 && <div className="muted">仓库暂无 feature。先「保存到仓库」发布一笔。</div>}
          {cat.features.map((f) => (
            <div key={f.id} className="rule-form" style={{ marginTop: 8 }}>
              <div className="rf-h">
                <b>{f.title || f.id}</b>
                <span className="kind" style={{ marginLeft: 8 }}>{f.id}</span>
                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>ruleSet {f.ruleSet} · 页面 {f.page}</span>
                <span style={{ flex: 1 }} />
                <button className="mini" disabled={busy} onClick={() => doLoad(f.id)}>加载</button>
              </div>
            </div>
          ))}

          <div className="ds-sub" style={{ marginTop: 12 }}>库 libraries</div>
          <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {cat.libraries.map((l) => <span key={l.id} className="kind" title={`${(l.modules || []).join('、')}`}><code>{l.id}</code> {l.status}</span>)}
          </div>

          <div className="ds-sub" style={{ marginTop: 12 }}>规则集 rulesets</div>
          <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {cat.rulesets.map((r) => <span key={r.id} className="kind"><code>{r.id}</code> · {r.rules} 规则 · {r.status}</span>)}
          </div>
        </>
      )}
    </div>
  );
}
