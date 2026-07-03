// 引擎 JS（poc-incremental/src/incremental.js）的类型声明；Vite 别名 @udsl/engine 解析到真实 JS。
declare module '@udsl/engine' {
  import type { CreateSession } from '@udsl/ui-kit-core';
  export const createSession: CreateSession;
}

declare module '*.json' {
  const value: any;
  export default value;
}
