// Mock 汇率服务（异步）。生产中是登记治理的权威汇率源；这里用延时 + 固定表模拟。
const RATES = {
  "USD-CNY": "7.1234", "EUR-CNY": "7.8901", "JPY-CNY": "0.0481",
  "HKD-CNY": "0.9123", "GBP-CNY": "9.1234", "SGD-CNY": "5.2710",
};
let seq = 8842177;

export function makeFxService({ delay = 600 } = {}) {
  return function resolve(_source, key) {
    return new Promise((res, rej) => {
      setTimeout(() => {
        const pair = `${key.from}-${key.to}`;
        const rate = RATES[pair];
        if (!rate) return rej(new Error("无汇率: " + pair));
        res({ value: rate, asOf: "2026-06-25T09:30:00Z", rateId: "fx_" + ++seq });
      }, delay);
    });
  };
}
