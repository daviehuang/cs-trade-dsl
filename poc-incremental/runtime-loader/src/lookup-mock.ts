// 主数据查询后端 mock（宿主注入）：客户信息平时维护好，交易时按名称模糊查、选中取整条记录。
//   生产中 search/get 换成真 API；控件与引擎都不变。
import { setLookupService } from '@udsl/ui-kit-react';

interface Customer { id: string; name: string; address: string; country: string; taxId: string; contactPerson: string }

const CUSTOMERS: Customer[] = [
  { id: 'C001', name: '甲方进出口有限公司', address: '上海市浦东新区世纪大道100号', country: 'CN', taxId: '91310000AAA1', contactPerson: '张三' },
  { id: 'C002', name: '甲骨文贸易（深圳）有限公司', address: '深圳市南山区科技园', country: 'CN', taxId: '91440300BBB2', contactPerson: '李四' },
  { id: 'C003', name: 'environ 环球机械美国公司', address: '350 5th Ave, New York', country: 'USA', taxId: 'US-99-1234567', contactPerson: 'John Smith' },
  { id: 'C004', name: '新加坡星港电子私人有限公司', address: '1 Raffles Place, Singapore', country: 'SGP', taxId: 'SG-2020-8899', contactPerson: 'Lim Wei' },
  { id: 'C005', name: '甲天下食品集团', address: '广州市天河区珠江新城', country: 'CN', taxId: '91440101CCC3', contactPerson: '王五' },
];

const delay = <T>(v: T, ms = 250) => new Promise<T>((res) => setTimeout(() => res(v), ms));

setLookupService({
  // 名称模糊查 → 候选清单（带税号辅助辨识）
  search: (_entity, q) =>
    delay(CUSTOMERS.filter((c) => c.name.includes(q)).map((c) => ({ id: c.id, label: `${c.name} · ${c.taxId}` }))),
  // 据选中 id 取整条记录
  get: (_entity, id) => delay(CUSTOMERS.find((c) => c.id === id) ?? {}, 200),
});
