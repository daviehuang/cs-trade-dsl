import { Injectable, NgZone, inject } from '@angular/core';
import { ResolveFn } from './dsl/incremental';

/**
 * 宿主侧的汇率参考数据服务（引擎从不碰 IO，只通过 resolve 回调拿值）。
 * 这里模拟一个有延迟的后台汇率 API；生产中换成真实 HTTP 调用即可。
 *
 * 关键：把 resolve 的回调包进 NgZone.run，确保异步取数完成后 Angular 变更检测能刷新视图。
 */
@Injectable({ providedIn: 'root' })
export class FxService {
  private zone = inject(NgZone);

  private rates: Record<string, string> = {
    'USD-CNY': '7.1234', 'EUR-CNY': '7.8901', 'HKD-CNY': '0.9123',
    'GBP-CNY': '9.1234', 'JPY-CNY': '0.0481', 'SGD-CNY': '5.2710',
    'USD-EUR': '0.9234', 'EUR-USD': '1.0830',
  };
  private seq = 8842177;

  /** 传给 createSession({ resolve }) 的解析器。延迟 900ms 模拟后台取数。 */
  readonly resolve: ResolveFn = (_source, key) =>
    new Promise((res, rej) => {
      setTimeout(() => {
        this.zone.run(() => {
          const r = this.rates[`${key['from']}-${key['to']}`];
          if (r) res({ value: r, asOf: '2026-06-25T09:30:00Z', rateId: 'fx_' + ++this.seq });
          else rej(new Error(`无汇率 ${key['from']}→${key['to']}`));
        });
      }, 900);
    });
}
