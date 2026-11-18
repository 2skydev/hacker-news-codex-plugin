import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  Failure,
  FeedPage,
  Field,
  Item,
  Preview,
  StoryPage,
} from "../../shared/types/reader.types.ts";
import type { TranslationEntry } from "../account/account-inference.ts";
import { openCache } from "./cache.ts";
import { cleanItem, isId, type RawItem } from "./hn-item.ts";
import { HN_API, PREVIEW_TTL, RANK_CACHE_TTL, TRANSLATION_VERSION } from "./news.constants.ts";
import { rankRevision, watchRankings } from "./watch-rankings.ts";

interface NewsServiceOptions {
  request?: (path: string) => Promise<unknown>;
  streamRequest?: Parameters<typeof watchRankings>[0]["request"];
  watchTimeout?: number;
  runTranslation?: (entries: TranslationEntry[], model: string) => Promise<TranslationEntry[]>;
  directory?: string;
  now?: () => number;
}

interface PaginationOptions {
  offset?: number;
  limit?: number;
}

interface PreviewOptions extends PaginationOptions {
  sort?: string;
  id?: number;
  limit: number;
  titles?: Pick<Item, "id" | "title">[];
}

interface TranslationSource {
  id: number;
  text: string;
  field: Field;
  fingerprint: string;
  key: string;
}

type TranslatedItem = { id: number; text: string };
type TranslationResult = { status: Failure } | TranslatedItem;

function fault(message: string, status: number) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function pageBounds(offset: number, limit: number) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw fault("페이지 범위를 확인해 주세요.", 400);
}

function signature(text: string) {
  return createHash("sha256").update(`${TRANSLATION_VERSION}\0${text}`).digest("hex");
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${HN_API}${path}.json`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw fault("Hacker News에서 데이터를 불러오지 못했습니다.", 502);
  return response.json();
}

async function mapLimited<T>(ids: number[], fn: (id: number) => Promise<T>) {
  const result = new Array<T>(ids.length);
  let index = 0;
  async function worker() {
    while (index < ids.length) {
      const current = index++;
      result[current] = await fn(ids[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
  return result;
}

function chunks(text: string) {
  const parts = [];
  while (text.length > 6000) {
    const window = text.slice(0, 6000);
    let split = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    if (split < 3000) split = window.length;
    if (/[\uD800-\uDBFF]/.test(text[split - 1])) split--;
    parts.push(text.slice(0, split));
    text = text.slice(split).trimStart();
  }
  if (text) parts.push(text);
  return parts;
}

export function createNewsService({
  request = fetchJson,
  streamRequest = fetch,
  watchTimeout = 20000,
  runTranslation = async (entries, model) =>
    (await import("../account/account-service.ts")).translateBatch(entries, model),
  directory = process.env.HN_DATA_DIR || join(homedir(), ".local", "share", "hacker-news"),
  now = Date.now,
}: NewsServiceOptions = {}) {
  const db = openCache(directory, now);
  const recent = new Map<string, { value: unknown; until: number }>();
  const loading = new Map<string, Promise<unknown>>();
  const watching = new Map<string, ReturnType<typeof watchRankings>>();
  const translating = new Map<string, Promise<TranslationResult>>();
  let translationQueue: Promise<unknown> = Promise.resolve();

  // Requests for the same list or item share a single network operation.
  async function cached(path: string, ttl: number) {
    const entry = recent.get(path);
    if (entry && entry.until > now()) return entry.value;
    const pending = loading.get(path);
    if (pending) return pending;
    const action = Promise.resolve()
      .then(() => request(path))
      .then((value) => {
        const updated = recent.get(path);
        if (updated && updated !== entry) return updated.value;
        recent.delete(path);
        if (recent.size >= 3000) {
          const oldest = recent.keys().next();
          if (!oldest.done) recent.delete(oldest.value);
        }
        recent.set(path, { value, until: now() + ttl });
        return value;
      })
      .finally(() => loading.delete(path));
    loading.set(path, action);
    return action;
  }

  async function getItem(id: number) {
    const raw = (await cached(`item/${id}`, 30000)) as RawItem | null;
    return cleanItem(raw, id);
  }

  function withKorean<T extends Pick<Item, "id" | "title" | "text">>(
    item: T,
  ): T & Pick<Item, "titleKo" | "textKo"> {
    const result = { ...item } as T & Pick<Item, "titleKo" | "textKo">;
    for (const field of ["title", "text"] as const) {
      const source = item[field];
      if (!source) continue;
      const cached = db.read(item.id, field, signature(source));
      if (cached) result[`${field}Ko`] = cached.ko;
    }
    return result;
  }

  async function page(ids: number[], offset: number, limit: number) {
    const pageIds = ids.slice(offset, offset + limit);
    const items = await mapLimited(pageIds, getItem);
    const nextOffset = offset + pageIds.length;
    return {
      items: items.filter((item): item is Item => item !== null),
      nextOffset,
      hasMore: nextOffset < ids.length,
    };
  }

  function cachedTranslations<T extends FeedPage | StoryPage>(page: T): T {
    if ("item" in page)
      return { ...page, item: withKorean(page.item), comments: page.comments.map(withKorean) };
    return { ...page, items: page.items.map(withKorean) };
  }

  function savePage<T extends FeedPage | StoryPage>(key: string, page: T) {
    // Keep public originals only. Settings can clear translations in another process.
    const payload = JSON.stringify(page);
    if (Buffer.byteLength(payload) <= 256 * 1024) db.writePreview.run(key, payload, now());
    else db.forgetPreview.run(key);
    return cachedTranslations(page);
  }

  function preview({
    sort,
    id,
    offset = 0,
    limit,
    titles,
  }: PreviewOptions): Preview<FeedPage | StoryPage> {
    pageBounds(offset, limit);
    if (
      sort === undefined
        ? !isId(id) || titles !== undefined
        : !["top", "new"].includes(sort) || id !== undefined
    )
      throw fault("저장된 페이지 종류를 확인해 주세요.", 400);
    // Older readers already store first-page originals, including their displayed order.
    if (titles?.length) return { titles: titles.map(withKorean) };
    const row = db.readPreview.get([sort ?? id, offset, limit].join(":"), now() - PREVIEW_TTL) as
      | { payload: string; saved_at: number }
      | undefined;
    if (!row) return {};
    return {
      page: cachedTranslations(JSON.parse(row.payload) as FeedPage | StoryPage),
      updatedAt: row.saved_at,
    };
  }

  async function feed({
    sort = "top",
    offset = 0,
    limit = 20,
  }: PaginationOptions & { sort?: string } = {}) {
    pageBounds(offset, limit);
    if (sort !== "top" && sort !== "new") throw fault("피드 종류를 확인해 주세요.", 400);
    const ids = await cached(`${sort}stories`, RANK_CACHE_TTL);
    if (!Array.isArray(ids)) throw fault("Hacker News 목록을 불러오지 못했습니다.", 502);
    const ranked = ids.filter(isId);
    return savePage([sort, offset, limit].join(":"), {
      ...(await page(ranked, offset, limit)),
      revision: rankRevision(ranked),
    });
  }

  function watch({ sort, revision }: { sort?: string; revision?: string } = {}) {
    if (
      (sort !== "top" && sort !== "new") ||
      typeof revision !== "string" ||
      !/^[a-f0-9]{64}$/.test(revision)
    )
      throw fault("피드 갱신 정보를 확인해 주세요.", 400);
    const key = `watch:${sort}:${revision}`;
    const pending = watching.get(key);
    if (pending) return pending;
    const action = watchRankings({
      sort,
      revision,
      request: streamRequest,
      timeout: watchTimeout,
      onChange: (ids) =>
        recent.set(`${sort}stories`, { value: ids, until: now() + RANK_CACHE_TTL }),
    }).finally(() => watching.delete(key));
    watching.set(key, action);
    return action;
  }

  async function story({ id, offset = 0, limit = 10 }: PaginationOptions & { id?: unknown } = {}) {
    pageBounds(offset, limit);
    if (!isId(id)) throw fault("게시물 번호를 확인해 주세요.", 400);
    const item = await getItem(id);
    const key = [id, offset, limit].join(":");
    if (!item) {
      db.forgetPreview.run(key);
      throw fault("삭제되었거나 찾을 수 없는 글입니다.", 404);
    }
    const { items: comments, ...pagination } = await page(item.kids ?? [], offset, limit);
    return savePage(key, { item, comments, ...pagination });
  }

  // Split unusually long discussions across model calls, then cache only complete translations.
  async function runBatch(sources: TranslationSource[], model: string, epoch: number) {
    const unitsBySource = sources.map((source) =>
      chunks(source.text).map((text, index) => ({ id: `${source.id}-${index}`, text })),
    );
    const units = unitsBySource.flat();
    const translated = new Map<string, string>();
    let failure: Failure = "error";
    for (let i = 0; i < units.length; ) {
      const group = [];
      let size = 0;
      while (i < units.length && group.length < 20 && size + units[i].text.length <= 8000) {
        size += units[i].text.length;
        group.push(units[i++]);
      }
      try {
        const output = await runTranslation(group, model);
        for (const { id, text } of output) {
          if (typeof text === "string" && text.trim()) translated.set(id, text.trim());
        }
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error.code === "disconnected" || error.code === "limited")
        )
          failure = error.code;
        break;
      }
    }
    return sources.map((source, index): TranslationResult => {
      const sourceUnits = unitsBySource[index];
      if (!sourceUnits.every(({ id }) => translated.has(id))) return { status: failure };
      const text = sourceUnits.map(({ id }) => translated.get(id)).join("\n\n");
      db.write.run(source.id, source.field, source.fingerprint, text, now(), epoch);
      return { id: source.id, text };
    });
  }

  async function translate({ ids, field }: { ids?: unknown; field?: string } = {}) {
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      !ids.every(isId) ||
      (field !== "title" && field !== "text")
    )
      throw fault("번역할 항목을 확인해 주세요.", 400);
    const items = await mapLimited([...new Set(ids)], getItem);
    const { model, epoch } = db.current();
    const sources = items.flatMap((item): TranslationSource[] => {
      const text = item?.[field];
      if (!item || !text?.trim()) return [];
      const fingerprint = signature(text);
      const key = [item.id, field, fingerprint, model, epoch].join(":");
      return [{ id: item.id, text, field, fingerprint, key }];
    });
    const active = new Map<string, TranslationResult | Promise<TranslationResult>>();
    const missing: TranslationSource[] = [];
    for (const source of sources) {
      const existing = db.read(source.id, field, source.fingerprint);
      const pending = translating.get(source.key);
      if (existing) active.set(source.key, { id: source.id, text: existing.ko });
      else if (pending) active.set(source.key, pending);
      else missing.push(source);
    }
    if (missing.length) {
      const job = translationQueue.then(() => runBatch(missing, model, epoch));
      translationQueue = job.catch(() => {});
      for (const [index, source] of missing.entries()) {
        const result = job
          .then((results) => results[index])
          .finally(() => translating.delete(source.key));
        translating.set(source.key, result);
        active.set(source.key, result);
      }
    }
    const output = await Promise.all(
      sources.map(({ key }) => {
        const result = active.get(key);
        if (!result) throw new Error("번역 결과를 찾지 못했습니다.");
        return result;
      }),
    );
    const status = output.find((row) => "status" in row)?.status;
    return {
      items: output.filter((row): row is TranslatedItem => !("status" in row)),
      ...(status && { status }),
    };
  }

  return { feed, watch, story, preview, translate, preferences: db, close: () => db.close() };
}

let defaultService: ReturnType<typeof createNewsService> | undefined;
export const service = () => (defaultService ??= createNewsService());
export const feed = (args: Parameters<ReturnType<typeof createNewsService>["feed"]>[0]) =>
  service().feed(args);
export const watch = (args: Parameters<ReturnType<typeof createNewsService>["watch"]>[0]) =>
  service().watch(args);
export const story = (args: Parameters<ReturnType<typeof createNewsService>["story"]>[0]) =>
  service().story(args);
export const translate = (args: Parameters<ReturnType<typeof createNewsService>["translate"]>[0]) =>
  service().translate(args);
