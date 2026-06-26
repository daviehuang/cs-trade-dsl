import { Injectable } from '@angular/core';
// 直接 import 真实引擎（ESM）。Angular 把它当普通库，tree-shake、打包都自动处理。
import { runRuleSet, RuleSet, RunResult } from './dsl/engine';

/**
 * 把统一 DSL 引擎封装成 Angular 可注入服务。
 * 引擎是 headless 的：这里没有任何界面逻辑，只是转发调用。
 */
@Injectable({ providedIn: 'root' })
export class DslEngineService {
  run(ruleSet: RuleSet, data: unknown): RunResult {
    return runRuleSet(ruleSet, data);
  }
}
