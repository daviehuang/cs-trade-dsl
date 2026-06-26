import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RuleSet } from './dsl/engine';

/**
 * 规则仓库客户端：运行时按 featureId 动态拉取 RuleSet（不编译进前端包）。
 *
 * 生产中指向 Rule Bundle API，例如：
 *   load(id) => this.http.get<RuleSet>(`${API}/rulesets/${id}@active`)
 * 可附带版本、ETag 缓存、灰度路由等（对应架构 §7 分发层）。
 *
 * 本示例从静态 assets 拉取，等价于"页面加载时动态获取规则"。
 */
@Injectable({ providedIn: 'root' })
export class RuleRepositoryService {
  private http = inject(HttpClient);

  load(featureId: string): Observable<RuleSet> {
    return this.http.get<RuleSet>(`assets/rules/${featureId}.json`);
  }

  /** 示例初始数据（可选）。生产中表单初值通常来自业务数据接口，而非规则仓库。 */
  loadSample(featureId: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`assets/rules/${featureId}.sample.json`);
  }
}
