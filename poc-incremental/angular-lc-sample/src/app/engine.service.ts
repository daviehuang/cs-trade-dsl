import { Injectable } from '@angular/core';
// 直接 import 真实增量引擎（ESM）——单源真相 poc-incremental/src/incremental.js（与 PoC/BFF/中台同一份）。
import { createSession } from '@udsl/engine';
import { RuleSet, Session, SessionOpts } from '@udsl/ui-kit-core';

/**
 * 把增量引擎封装成 Angular 可注入服务。引擎是 headless 的——这里没有任何界面逻辑，
 * 只负责创建会话；setInput / setOverride / addChild 等由组件直接调用会话对象。
 */
@Injectable({ providedIn: 'root' })
export class EngineService {
  createSession(ruleSet: RuleSet, data: any, opts: SessionOpts): Session {
    return createSession(ruleSet, data, opts);
  }
}
