// 主数据查询服务（宿主注入）：与引擎的 resolve(source,key)→标量 分开的独立通道。
//   search：名称模糊查 → 候选清单（瞬时 UI 状态，不进引擎图、不进交易真值）。
//   get：按选中 key 取整条记录 → 由 party-lookup 控件 mapping 到当事方各字段。
export interface LookupCandidate { id: string; label: string }
export interface LookupService {
  search(entity: string, query: string): Promise<LookupCandidate[]>;
  get(entity: string, id: string): Promise<Record<string, any>>;
}

let svc: LookupService | null = null;
/** 宿主在启动时注入主数据查询后端（mock 或真 API）。 */
export function setLookupService(s: LookupService): void { svc = s; }
export function getLookupService(): LookupService | null { return svc; }
