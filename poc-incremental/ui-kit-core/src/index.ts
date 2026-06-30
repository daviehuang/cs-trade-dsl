// @udsl/ui-kit-core —— 框架无关的绑定 SDK。
//   引擎是计算与校验唯一真相源；UI 只通过 EngineCtx 契约与它对话。
//   各框架适配器（Angular / React / Vue / HTML）import 本包，写一个哑渲染器映射 UINode。
export * from './engine-types';
export * from './engine-meta';
export * from './engine-shared';
export * from './page-def';
export * from './ui-ir';
export * from './lint';
export * from './make-ctx';
export * from './hydrate';
export * from './build-root-ir';
