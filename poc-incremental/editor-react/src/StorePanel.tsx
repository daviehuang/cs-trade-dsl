import { useEffect, useState } from 'react';
import { Bundle } from './store/editorStore';
import { RuleSet } from '@udsl/ui-kit-core';
import { Catalog, getCatalog, saveWorkspace, loadWorkspace, deleteFeature } from './store/remoteStore';

// 域12 文件式规则仓库 + 多规则集工作台：把当前工作区「保存到仓库」；从仓库「加载」在多个场景间切换；
//   「新建规则集」生成空白场景并落库为新 feature；「删除」移除某 feature（库共享保留）。
//   仓库由 store-server(:8788) 提供，运行时页也从同一仓库拉取。
type Props = {
  currentBundle: () => Bundle;
  importBundle: (b: Partial<Bundle>) => void;
  scenarioName: string;                      // 当前工作区场景 ruleSetId（用于高亮"当前"）
};

// 空白场景：最小可用 model（一个空根节点，避免预览崩），空规则/页面/数据；沿用当前库目录与 mocks。
function blankBundle(id: string, ver: string, base: Bundle): Bundle {
  return {
    ruleSet: { ruleSetId: id, version: ver, schemaVersion: '1.0', status: 'draft',
      model: { root: 'Root', nodes: { Root: { fields: {} } } }, rules: [], imports: [], context: {} } as unknown as RuleSet,
    pageDef: { ruleSetRef: `${id}@${ver}`, title: id, layout: [] } as any,
    data: {},
    libraries: base.libraries,               // 保留库目录，新场景可 import
    mocks: base.mocks,
  };
}

export function StorePanel({ currentBundle, importBundle, scenarioName }: Props) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [title, setTitle] = useState('');
  const [newId, setNewId] = useState(''); const [newVer, setNewVer] = useState('1.0.0');

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

  const doNew = async () => {
    if (!newId) return;
    if (cat?.features.some((f) => f.id === newId) && !confirm(`仓库已有 feature「${newId}」，覆盖为空白规则集？`)) return;
    if (!confirm(`新建空白规则集「${newId}@${newVer}」并保存到仓库？当前工作区将被替换（可 undo 回退）。`)) return;
    setBusy(true); setMsg(null);
    try {
      const b = blankBundle(newId, newVer, currentBundle());
      importBundle(b);                         // 设为当前工作区
      await saveWorkspace(b, newId);           // 落库为新 feature
      setMsg({ ok: true, text: `已新建规则集 ${newId} 并保存到仓库，切换为当前场景（可在「规则集」区从零搭建）` });
      setNewId(''); refresh();
    } catch (e: any) { setMsg({ ok: false, text: '新建失败：' + e.message }); }
    finally { setBusy(false); }
  };

  const doLoad = async (featureId: string) => {
    if (!confirm(`加载「${featureId}」为当前场景？将覆盖当前工作区（可 undo 回退）。`)) return;
    setBusy(true); setMsg(null);
    try {
      const b = await loadWorkspace(featureId);
      importBundle(b);
      setMsg({ ok: true, text: `已切换到 ${featureId}（ruleSet ${b.ruleSet.ruleSetId}、库 ${Object.keys(b.libraries).length} 个）` });
    } catch (e: any) { setMsg({ ok: false, text: '加载失败：' + e.message }); }
    finally { setBusy(false); }
  };

  const doDelete = async (feat: any) => {
    if (!confirm(`从仓库删除「${feat.title || feat.id}」（含其规则集/页面/数据；共享库保留）？不可撤销。`)) return;
    setBusy(true); setMsg(null);
    try {
      await deleteFeature({ id: feat.id, ruleSet: feat.ruleSet, page: feat.page, data: feat.data });
      setMsg({ ok: true, text: `已从仓库删除 ${feat.id}` });
      refresh();
    } catch (e: any) { setMsg({ ok: false, text: '删除失败：' + e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="ed-sec">
      <h4>规则仓库 · 多规则集工作台</h4>
      <p className="hint">仓库 = store-server 磁盘上的 JSON 文件。多个 feature（规则集）可在此新建 / 切换 / 删除；
        运行时加载器与其它宿主从<b>同一仓库</b>按 feature 拉取渲染——规则不编译进包。</p>

      <h4>新建规则集</h4>
      <div className="ed-row">
        <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="ruleSetId，如 guaranteeSettlement" style={{ width: 260 }} />
        <input value={newVer} onChange={(e) => setNewVer(e.target.value)} placeholder="version" style={{ width: 100 }} />
        <button className="primary" disabled={busy || !newId} onClick={doNew}>＋ 新建并落库</button>
      </div>
      <p className="hint">生成一个空白场景（空根节点 + 空规则/页面/数据，沿用当前库目录）、设为当前编辑对象、并存为仓库新 feature。</p>

      <h4>保存当前场景</h4>
      <div className="ed-row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="feature 标题（默认取页面标题）" style={{ flex: 1, minWidth: 220 }} />
        <button className="primary" disabled={busy} onClick={doSave}>保存到仓库（发布）</button>
        <button className="mini" disabled={busy} onClick={refresh}>刷新目录</button>
      </div>
      <p className="hint">保存目标 feature = 当前场景 <code>{scenarioName}</code>（同名覆盖）。</p>

      {msg && <div className={msg.ok ? 'lint ok' : 'lint bad'} style={{ display: 'block', margin: '8px 0', padding: '7px 10px' }}>{msg.ok ? '✔ ' : '⛔ '}{msg.text}</div>}

      <h4>仓库里的规则集 {cat && `（${cat.features.length} 个 feature · 库 ${cat.libraries.length}）`}</h4>
      {!cat && <div className="muted">正在读取仓库…</div>}
      {cat && (
        <>
          {cat.features.length === 0 && <div className="muted">仓库暂无 feature。上面「新建规则集」或「保存到仓库」发布一笔。</div>}
          {cat.features.map((f) => {
            const isCur = f.id === scenarioName;
            return (
              <div key={f.id} className="rule-form" style={{ marginTop: 8, ...(isCur ? { borderColor: '#2563eb', background: '#f6f9ff' } : {}) }}>
                <div className="rf-h">
                  <b>{f.title || f.id}</b>
                  <span className="kind" style={{ marginLeft: 8 }}>{f.id}</span>
                  {isCur && <span className="lint ok" style={{ marginLeft: 8 }}>当前</span>}
                  <span className="muted" style={{ marginLeft: 8, fontSize: 17 }}>ruleSet {f.ruleSet} · 页面 {f.page}</span>
                  <span style={{ flex: 1 }} />
                  <button className="mini" disabled={busy || isCur} onClick={() => doLoad(f.id)}>{isCur ? '已加载' : '切换'}</button>
                  <button className="del" disabled={busy} onClick={() => doDelete(f)}>删除</button>
                </div>
              </div>
            );
          })}

          <div className="ds-sub" style={{ marginTop: 12 }}>共享库 libraries</div>
          <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {cat.libraries.map((l) => <span key={l.id} className="kind" title={`${(l.modules || []).join('、')}`}><code>{l.id}</code> {l.status}</span>)}
          </div>
        </>
      )}
    </div>
  );
}
