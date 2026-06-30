declare module '@udsl/engine' {
  import type { CreateSession } from '@udsl/ui-kit-core';
  export const createSession: CreateSession;
}
declare module '@udsl/engine-kernel' {
  /** 解析表达式（抛错即语法错误）；编辑器用它做表达式即时校验。 */
  export function parseCached(exprSrc: string): unknown;
}
declare module '*.json' {
  const value: any;
  export default value;
}
