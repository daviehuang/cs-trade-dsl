import type { ResolveFn } from '@udsl/ui-kit-core';

// 宿主参考数据源（与其它样本同表）：引擎从不碰 IO，只通过 resolve 回调拿值。
// fx 汇率属外部 IO，不进规则仓库；本轮运行时页仍用本地 mock（与 react/vue/html 样本一致，保证逐值可比）。
const RATES: Record<string, string> = {
  'USD-CNY': '7.1234', 'EUR-CNY': '7.8901', 'HKD-CNY': '0.9123',
  'GBP-CNY': '9.1234', 'JPY-CNY': '0.0481', 'SGD-CNY': '5.2710',
  'USD-EUR': '0.9234', 'EUR-USD': '1.0830', 'CNY-CNY': '1',
};
const SANCTIONS: Record<string, string> = { SDNXKP01: '95', OFACUS00: '88' };
let seq = 9100000;

// 复杂计费后台（一次返回多字段对象）；引擎按字段各发一个 pick，宿主须记忆化避免重复调用（见下）。
//   与 editor mock / BFF authResolve 同表（按 productType+tier），保证"未篡改即一致"。
const CHARGE: Record<string, Record<string, string>> = {
  'LC|gold': { base: '120.00', tax: '60.00', fee: '15.00' },
  'LC|silver': { base: '100.00', tax: '60.00', fee: '15.00' },
  'LC|': { base: '80.00', tax: '60.00', fee: '15.00' },
};
function chargeApi(key: Record<string, unknown>): Record<string, string> {
  return CHARGE[`${key['productType']}|${key['tier']}`] ?? CHARGE[`${key['productType']}|`] ?? { base: '0', tax: '0', fee: '0' };
}

/** 按 source 路由数据源；延迟模拟后台取数。 */
export function makeResolve(delay = 600): ResolveFn {
  // (source,key) 记忆化：commonCharge 的 base/tax/fee 三个 pick 用同一 key → 只打一次真实后台，
  //   且三者取自同一快照，保证一致。缓存永久有效——数据源须是 key 的纯函数（与"稳态=输入纯函数"同一前提）。
  const cache = new Map<string, Promise<any>>();
  return (source, key) => {
    if (source === 'chargeService') {
      const ck = 'chargeService|' + JSON.stringify(key);
      if (!cache.has(ck))
        cache.set(ck, new Promise((res) => setTimeout(() => res({ values: chargeApi(key), asOf: '2026-06-25', rateId: 'chg_' + ++seq }), delay)));
      return cache.get(ck)!;
    }
    return new Promise((res, rej) => {
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
  };
}
