import type { ResolveFn } from '@udsl/ui-kit-core';

// 域9 resolver 取数模拟：把每个 dataSource 的返回值做成可视化配置（mock 值表），
//   预览时引擎按 rule.source + key 调 resolve，从这里查值并模拟异步 pending→resolved。
//   一行 = { when: 部分键匹配条件, value | values }；按顺序取第一条全部条件命中的行，否则用 fallback，再否则 reject。
//   value：标量源（汇率等）；values：多字段源（如 chargeService 一次返回 base/tax/fee），供 resolver.pick 取项。
export interface MockRow { when: Record<string, string>; value?: string; values?: Record<string, string>; }
export interface MockSource { delayMs: number; rows: MockRow[]; fallback?: string; }
export type Mocks = Record<string, MockSource>;

// 默认 mock（与四端样本 fx.ts 同表；保证预览开箱即出 net=82203.22）。
export const DEFAULT_MOCKS: Mocks = {
  fxRateService: {
    delayMs: 400,
    rows: [
      { when: { from: 'USD', to: 'CNY' }, value: '7.1234' },
      { when: { from: 'EUR', to: 'CNY' }, value: '7.8901' },
      { when: { from: 'HKD', to: 'CNY' }, value: '0.9123' },
      { when: { from: 'GBP', to: 'CNY' }, value: '9.1234' },
      { when: { from: 'JPY', to: 'CNY' }, value: '0.0481' },
      { when: { from: 'SGD', to: 'CNY' }, value: '5.2710' },
      { when: { from: 'USD', to: 'EUR' }, value: '0.9234' },
      { when: { from: 'EUR', to: 'USD' }, value: '1.0830' },
      { when: { from: 'CNY', to: 'CNY' }, value: '1' },
    ],
    // 无 fallback：未配的币对 → reject（预览显示取数错误，符合真实"无汇率"）。
  },
  sanctionsService: {
    delayMs: 400,
    rows: [
      { when: { bic: 'SDNXKP01' }, value: '95' },
      { when: { bic: 'OFACUS00' }, value: '88' },
    ],
    fallback: '0',   // 未命中名单 → 0（干净）
  },
  // 多字段源示例：chargeService 一次返回 base/tax/fee（供 commonCharge.chargeCalc 的 pick 取项）
  chargeService: {
    delayMs: 400,
    rows: [
      { when: { productType: 'LC', tier: 'gold' }, values: { base: '120.00', tax: '60.00', fee: '15.00' } },
      { when: { productType: 'LC', tier: 'silver' }, values: { base: '100.00', tax: '60.00', fee: '15.00' } },
      { when: { productType: 'LC' }, values: { base: '80.00', tax: '60.00', fee: '15.00' } },
    ],
  },
};

let seq = 9200000;

/** 由 mocks 生成引擎用的 resolve(source, key)。 */
export function makeResolveFromMocks(mocks: Mocks): ResolveFn {
  return (source, key) =>
    new Promise((res, rej) => {
      const cfg = mocks[source];
      const delay = cfg?.delayMs ?? 400;
      setTimeout(() => {
        if (!cfg) { rej(new Error(`未配置 mock 数据源：${source}`)); return; }
        const row = cfg.rows.find((r) => Object.entries(r.when).every(([k, v]) => String(key[k] ?? '') === v));
        // 多字段行回 { values }（resolver.pick 取项）；标量行回 { value }。同一行对所有 pick 一致 → 天然快照一致。
        if (row) { res({ value: row.value, values: row.values, asOf: 'mock', rateId: `${source}_${++seq}` }); return; }
        if (cfg.fallback != null) { res({ value: cfg.fallback, asOf: 'mock', rateId: `${source}_fb` }); return; }
        rej(new Error(`${source} 无匹配 mock：${JSON.stringify(key)}`));
      }, delay);
    });
}
