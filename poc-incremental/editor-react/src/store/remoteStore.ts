import { RuleSet, PageDef } from '@udsl/ui-kit-core';
import { Bundle } from './editorStore';

// 规则仓库（store-server）客户端：把编辑器工作区 ↔ 仓库文件 双向搬运。
//   base=/api（由 Vite proxy 代到 :8788）。仓库是"发布目标"；localStorage 仍是本地草稿。

export interface Catalog {
  libraries: { id: string; ruleSetId?: string; version?: string; status?: string; modules?: string[] }[];
  rulesets: { id: string; ruleSetId?: string; version?: string; status?: string; rules?: number }[];
  pages: { id: string; title?: string; ruleSetRef?: string }[];
  features: { id: string; title?: string; ruleSet?: string; page?: string; data?: string }[];
}

const BASE = '/api';
const jget = async (p: string) => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${(await r.text()).slice(0, 200)}`); return r.json(); };
const jput = async (p: string, body: unknown) => {
  const r = await fetch(BASE + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PUT ${p} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

export const getCatalog = (): Promise<Catalog> => jget('/catalog');

const jdel = async (p: string) => { const r = await fetch(BASE + p, { method: 'DELETE' }); if (!r.ok) throw new Error(`DELETE ${p} → ${r.status}`); };

// 从仓库删除一笔交易：删 feature + 其规则集/页面/数据（库为共享，保留）。
export async function deleteFeature(feat: { id: string; ruleSet?: string; page?: string; data?: string }): Promise<void> {
  await jdel('/feature/' + feat.id);
  if (feat.ruleSet) await jdel('/ruleset/' + feat.ruleSet);
  if (feat.page) await jdel('/page/' + feat.page);
  if (feat.data) await jdel('/data/' + feat.data);
}

const refOf = (rs: RuleSet) => `${rs.ruleSetId}@${(rs as any).version ?? '0'}`;

// 保存整份工作区到仓库：拆成 库/规则集/页面/数据/feature 分别 PUT。featureId/pageId 用场景 ruleSetId。
export async function saveWorkspace(bundle: Bundle, title?: string): Promise<string[]> {
  const written: string[] = [];
  const rs = bundle.ruleSet;
  const featureId = rs.ruleSetId;               // 一笔交易一个 feature，id=场景 ruleSetId
  const rsRef = refOf(rs);

  for (const [ref, lib] of Object.entries(bundle.libraries)) {
    await jput('/library/' + ref, lib); written.push('libraries/' + ref);
  }
  await jput('/ruleset/' + rsRef, rs); written.push('rulesets/' + rsRef);
  await jput('/page/' + featureId, bundle.pageDef); written.push('pages/' + featureId);
  await jput('/data/' + featureId, bundle.data); written.push('data/' + featureId);
  const feature = {
    featureId, title: title || (bundle.pageDef as any)?.title || featureId,
    ruleSet: rsRef, page: featureId, data: featureId, mocks: bundle.mocks,
  };
  await jput('/feature/' + featureId, feature); written.push('features/' + featureId);
  return written;
}

// 从仓库加载一笔交易 → 组装回编辑器 Bundle。
//   bundle 端点只给"被 import 的库"；编辑器要全量库目录，故再拉 catalog 里所有 library。
export async function loadWorkspace(featureId: string): Promise<Bundle> {
  const b = await jget('/bundle/' + featureId) as {
    feature: any; ruleSet: RuleSet; imports: Record<string, RuleSet>; pageDef: PageDef; data: any;
  };
  const cat = await getCatalog();
  const libraries: Record<string, RuleSet> = { ...b.imports };
  await Promise.all(cat.libraries.map(async (l) => { if (!libraries[l.id]) libraries[l.id] = await jget('/library/' + l.id); }));
  return {
    ruleSet: b.ruleSet, pageDef: b.pageDef, data: b.data, libraries,
    mocks: b.feature?.mocks ?? {},
  };
}
