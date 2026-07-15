import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RuleSet, PageDef } from '@udsl/ui-kit-core';

// 规则仓库（store-server）。CORS 开放，Angular 直接用绝对 URL 运行时拉取（与 React/HTML/Vue 加载器同源同库）。
const STORE = 'http://localhost:8788/api';

/** 一次功能加载所需的全部产物：规则集 + import 模块库 + 页面 + 业务初值。 */
export interface FeatureBundle {
  ruleSet: RuleSet;
  /** import 注册表：{ "commonFx@1.0.0": <模块库> }，传给 createSession 的 imports。 */
  imports: Record<string, RuleSet>;
  data: Record<string, any>;
  /** 运行时加载的自定义页面（编辑器产物）；缺省则回退模型自动布局。 */
  pageDef?: PageDef;
  feature?: { id: string; title?: string; page?: string };
}

/** 仓库目录里的一笔交易 feature（供下拉切换）。 */
export interface FeatureSummary { id: string; title?: string; page?: string; }

/**
 * 规则仓库客户端：运行时按 featureId 动态拉取 RuleSet+库+页面+数据（不编译进前端包）。
 *
 * 指向 store-server 的 Rule Bundle API：
 *   catalog()    => GET /api/catalog          （feature 列表）
 *   loadFeature  => GET /api/bundle/{id}       （规则集 + import 库 + 页面 + 数据，一次拉齐）
 * 与 React runtime-loader / runtime-loader-html / runtime-loader-vue 走同一个仓库端点。
 */
@Injectable({ providedIn: 'root' })
export class RuleRepositoryService {
  private http = inject(HttpClient);

  /** 仓库目录：可选的 feature 列表（下拉用）。 */
  catalog(): Observable<FeatureSummary[]> {
    return this.http.get<{ features?: FeatureSummary[] }>(`${STORE}/catalog`).pipe(map((c) => c.features ?? []));
  }

  /** 按 featureId 一次拉齐 bundle（规则集 + import 库 + 页面 + 业务初值）。 */
  loadFeature(featureId: string): Observable<FeatureBundle> {
    return this.http.get<any>(`${STORE}/bundle/${encodeURIComponent(featureId)}`).pipe(
      map((b) => ({
        ruleSet: b.ruleSet as RuleSet,
        imports: (b.imports ?? {}) as Record<string, RuleSet>,
        data: (b.data ?? {}) as Record<string, any>,
        pageDef: b.pageDef as PageDef | undefined,
        feature: b.feature,
      })),
    );
  }
}
