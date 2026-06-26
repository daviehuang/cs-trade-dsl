import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { RuleSet } from './dsl/incremental';

/** 一次功能加载所需的全部产物：规则集 + 它 import 的模块库 + 业务初值。 */
export interface FeatureBundle {
  ruleSet: RuleSet;
  /** import 注册表：{ "commonFx@1.0.0": <模块库> }，传给 createSession 的 imports。 */
  imports: Record<string, RuleSet>;
  data: Record<string, any>;
}

/**
 * 规则仓库客户端：运行时按 featureId 动态拉取 RuleSet（不编译进前端包）。
 *
 * 生产中指向 Rule Bundle API：
 *   load(id)        => GET /rulesets/{id}@active
 *   imports[].ref   => GET /rulesets/{ref}        （递归拉取被 import 的模块库）
 * 本示例从静态 assets 拉取，等价于"页面加载时按功能动态获取规则 + 其依赖"。
 */
@Injectable({ providedIn: 'root' })
export class RuleRepositoryService {
  private http = inject(HttpClient);

  /** 加载一个功能：规则集 → 解析 imports → 并行拉取各模块库 → 拉业务初值。 */
  loadFeature(featureId: string): Observable<FeatureBundle> {
    return this.http.get<RuleSet>(`assets/rules/${featureId}.json`).pipe(
      switchMap((ruleSet) => {
        const refs = (ruleSet.imports ?? []).map((i) => i.ref);
        const libs$ = refs.length
          ? forkJoin(
              refs.map((ref) =>
                this.http
                  .get<RuleSet>(`assets/rules/${this.fileOf(ref)}.json`)
                  .pipe(map((lib) => [ref, lib] as const)),
              ),
            )
          : of<(readonly [string, RuleSet])[]>([]);
        const data$ = this.http
          .get<Record<string, any>>(`assets/rules/${featureId}.sample.json`)
          .pipe(catchError(() => of<Record<string, any>>({})));

        return forkJoin({ libs: libs$, data: data$ }).pipe(
          map(({ libs, data }) => ({
            ruleSet,
            imports: Object.fromEntries(libs),
            data,
          })),
        );
      }),
    );
  }

  /** ref "commonFx@1.0.0" → 资源文件名 "commonFx"（示例按 id 取，忽略版本；生产按 ref 路由）。 */
  private fileOf(ref: string): string {
    return ref.split('@')[0];
  }
}
