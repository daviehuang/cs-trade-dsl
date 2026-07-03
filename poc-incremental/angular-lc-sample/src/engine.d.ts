// 引擎 JS（poc-incremental/src/incremental.js）的类型声明；tsconfig 别名 @udsl/engine 解析到真实 JS。
// 与 react-lc-sample/src/engine.d.ts 同构：运行时跑同一份引擎，类型契约取自 @udsl/ui-kit-core。
declare module '@udsl/engine' {
  import type { CreateSession } from '@udsl/ui-kit-core';
  export const createSession: CreateSession;
}
