export type Sort = "top" | "new";
export type Field = "title" | "text";
export interface Item {
  id: number;
  type?: string;
  title?: string;
  titleKo?: string;
  text?: string;
  textKo?: string;
  links?: string[];
  kids?: number[];
  by?: string;
  time: number;
  url?: string;
  score?: number;
  descendants?: number;
}
export type Job = [Item, Field];
export type Translation = (item: Item, field: Field) => string | undefined;
export type Notify = (message: string) => void;
export interface FeedPage {
  items: Item[];
  nextOffset: number;
  hasMore: boolean;
  revision: string;
  updatedAt?: number;
}
export interface StoryPage { item: Item; comments: Item[]; nextOffset: number; hasMore: boolean }
export interface Preview<T> { page?: T; updatedAt?: number; titles?: Pick<Item, "id" | "title" | "titleKo">[] }
export interface Account {
  label?: string;
  profileId?: string;
  connected: boolean;
  pending: boolean;
  error?: string;
  url?: string;
}
export interface Preferences {
  model: string;
  realtime: boolean;
  cacheField: "모든 번역" | "제목" | "본문과 댓글";
  cachePeriod: "전체 기간" | "최근 24시간" | "최근 7일" | "최근 30일";
}
export interface SettingsData {
  values: Preferences;
  models: string[];
  cacheFields: Preferences["cacheField"][];
  cachePeriods: Preferences["cachePeriod"][];
  cacheSize: string;
  modelError?: string;
}
export type FeedArgs = { sort: Sort; offset: number; limit: number };
export type StoryArgs = { id: number; offset: number; limit: number };
export type PreviewArgs = (FeedArgs & { titles?: Pick<Item, "id" | "title">[] }) | StoryArgs;
export type Failure = "limited" | "disconnected" | "error";
export interface Tools {
  hn_connect: [undefined, { url: string }];
  hn_disconnect: [undefined, Account];
  hn_account: [undefined, Account];
  hn_preferences: [undefined, Preferences];
  hn_settings_read: [undefined, SettingsData];
  hn_settings_update: [{ set: Partial<Preferences> }, { values: Preferences }];
  hn_clear_cache: [Pick<Preferences, "cacheField" | "cachePeriod">, { removed: number; count: number; bytes: number }];
  hn_feed: [FeedArgs, FeedPage];
  hn_story: [StoryArgs, StoryPage];
  hn_preview: [PreviewArgs, Preview<FeedPage | StoryPage>];
  hn_watch: [{ sort: Sort; revision: string }, { live: boolean; changed?: boolean }];
  hn_translate: [{ field: Field; ids: number[] }, { items: { id: number; text: string }[]; status?: Failure }];
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
