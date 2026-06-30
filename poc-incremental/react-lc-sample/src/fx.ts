import type { ResolveFn } from '@udsl/ui-kit-core';

// 宿主参考数据源（与 Angular 样本同表）：引擎从不碰 IO，只通过 resolve 回调拿值。
const RATES: Record<string, string> = {
  'USD-CNY': '7.1234', 'EUR-CNY': '7.8901', 'HKD-CNY': '0.9123',
  'GBP-CNY': '9.1234', 'JPY-CNY': '0.0481', 'SGD-CNY': '5.2710',
  'USD-EUR': '0.9234', 'EUR-USD': '1.0830', 'CNY-CNY': '1',
};
const SANCTIONS: Record<string, string> = { SDNXKP01: '95', OFACUS00: '88' };
let seq = 9100000;

/** 按 source 路由数据源；延迟模拟后台取数。 */
export function makeResolve(delay = 600): ResolveFn {
  return (source, key) =>
    new Promise((res, rej) => {
      setTimeout(() => {
        if (source === 'sanctionsService') {
          res({ value: SANCTIONS[key['bic']] ?? '0', asOf: '2026-06-25', rateId: 'scr_' + (key['bic'] || 'none') });
          return;
        }
        const r = RATES[`${key['from']}-${key['to']}`];
        if (r) res({ value: r, asOf: '2026-06-25T09:30:00Z', rateId: 'fx_' + ++seq });
        else rej(new Error(`无汇率 ${key['from']}→${key['to']}`));
      }, delay);
    });
}
