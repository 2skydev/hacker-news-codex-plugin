export const CACHE_FIELDS = { "모든 번역": "all", 제목: "title", "본문과 댓글": "text" } as const;
export const CACHE_PERIODS = {
  "전체 기간": 0,
  "최근 24시간": 1,
  "최근 7일": 7,
  "최근 30일": 30,
  "24시간보다 오래됨": -1,
  "7일보다 오래됨": -7,
  "30일보다 오래됨": -30,
} as const;
export const CACHE_RETENTION_DAYS = [1, 2, 3, 5, 7, 30] as const;
export const AUTO_MODEL = "자동";
export const DEFAULT_PREFERENCES = {
  model: AUTO_MODEL,
  realtime: true,
  cacheField: "모든 번역",
  cachePeriod: "전체 기간",
  cacheAutoDelete: true,
  cacheRetentionDays: 7,
} as const;
