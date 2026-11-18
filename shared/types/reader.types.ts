import type { CACHE_FIELDS, CACHE_PERIODS } from "../constants/settings.constants.ts";

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
export interface FeedPage {
  items: Item[];
  nextOffset: number;
  hasMore: boolean;
  revision: string;
  updatedAt?: number;
}
export interface StoryPage {
  item: Item;
  comments: Item[];
  nextOffset: number;
  hasMore: boolean;
}
export interface Preview<T> {
  page?: T;
  updatedAt?: number;
  titles?: Pick<Item, "id" | "title" | "titleKo">[];
}
export interface Account {
  picture?: string;
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
  cacheField: keyof typeof CACHE_FIELDS;
  cachePeriod: keyof typeof CACHE_PERIODS;
}
export interface CacheStats {
  count: number;
  bytes: number;
}

export interface SettingsData {
  values: Preferences;
  models: string[];
  cacheFields: Preferences["cacheField"][];
  cachePeriods: Preferences["cachePeriod"][];
  cache: CacheStats;
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
  hn_clear_cache: [
    Pick<Preferences, "cacheField" | "cachePeriod">,
    CacheStats & { removed: number },
  ];
  hn_feed: [FeedArgs, FeedPage];
  hn_story: [StoryArgs, StoryPage];
  hn_preview: [PreviewArgs, Preview<FeedPage | StoryPage>];
  hn_watch: [{ sort: Sort; revision: string }, { live: boolean; changed?: boolean }];
  hn_translate: [
    { field: Field; ids: number[] },
    { items: { id: number; text: string }[]; status?: Failure },
  ];
}
