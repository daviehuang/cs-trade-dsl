import type { ResolveFn } from '@udsl/ui-kit-core';

const RATES: Record<string, string> = {
  'USD-CNY': '7.1234', 'EUR-CNY': '7.8901', 'HKD-CNY': '0.9123',
  'GBP-CNY': '9.1234', 'JPY-CNY': '0.0481', 'SGD-CNY': '5.2710',
  'USD-EUR': '0.9234', 'EUR-USD': '1.0830', 'CNY-CNY': '1',
};
const SANCTIONS: Record<string, string> = { SDNXKP01: '95', OFACUS00: '88' };
let seq = 9200000;

export function makeResolve(delay = 400): ResolveFn {
  return (source, key) =>
    new Promise((res, rej) => {
      setTimeout(() => {
        if (source === 'sanctionsService') {
          res({ value: SANCTIONS[key['bic']] ?? '0', asOf: 'srv', rateId: 'scr_' + (key['bic'] || 'none') });
          return;
        }
        const r = RATES[`${key['from']}-${key['to']}`];
        if (r) res({ value: r, asOf: 'srv', rateId: 'fx_' + ++seq });
        else rej(new Error(`无汇率 ${key['from']}→${key['to']}`));
      }, delay);
    });
}
