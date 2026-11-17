import { createHash } from 'node:crypto';
import { openCache } from './preferences.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rankRevision, watchRankings } from './watch.mjs';

const api = 'https://hacker-news.firebaseio.com/v0/';
const translationVersion = 'ko-v1';
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

function decodeEntities(value) {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][\da-z]*);/gi, (match, name) => {
    if (!name.startsWith('#')) return Object.hasOwn(entities, name) ? entities[name] : match;
    const hex = name[1].toLowerCase() === 'x';
    const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '�';
  });
}

// HN uses HTML paragraphs, line breaks and preformatted code. Return plain text.
function plainText(html, links) {
  let link = 0;
  let pre = false;
  let result = '';
  for (const token of html.split(/(<\/?[a-z][\w-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'"<>])*)?\s*\/?>)/gi)) {
    const tag = /^<(\/?)([a-z][\w-]*)[\s/>]/i.exec(token);
    if (tag) {
      const name = tag[2].toLowerCase();
      if (name === 'a') {
        if (link) result += '⟦/' + link + '⟧';
        link = 0;
        if (!tag[1]) {
          const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token);
          const raw = href && decodeEntities(href[1] ?? href[2] ?? href[3]);
          const url = raw && URL.parse(raw, 'https://news.ycombinator.com/');
          if (url && ['https:', 'http:'].includes(url.protocol)) {
            link = links.push(url.href);
            result += '⟦' + link + '⟧';
          }
        }
      }
      if (name === 'pre') pre = !tag[1];
      if (name === 'p' || name === 'pre' || name === 'div') result += '\n\n';
      if (name === 'br' || name === 'li') result += '\n';
      continue;
    }
    const decoded = decodeEntities(token);
    result += pre ? decoded : decoded.replace(/\s+/g, ' ');
  }
  return result.replace(/^\n+|\n+$/g, '');
}

function isId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

function fault(message, status) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function pageBounds(offset, limit) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw fault('페이지 범위를 확인해 주세요.', 400);
}

function cleanItem(raw, id) {
  if (!raw || raw.id !== id || raw.dead || raw.deleted || !['story', 'job', 'poll', 'comment'].includes(raw.type)) return null;
  const item = { id, type: raw.type, time: raw.time ?? 0 };
  if (typeof raw.title === 'string') item.title = decodeEntities(raw.title);
  if (typeof raw.text === 'string' && raw.text) {
    const links = [];
    item.text = plainText(raw.text, links);
    if (links.length) item.links = links;
  }
  if (typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url)) item.url = raw.url;
  if (typeof raw.by === 'string') item.by = raw.by;
  if (Number.isSafeInteger(raw.score)) item.score = raw.score;
  if (Number.isSafeInteger(raw.descendants)) item.descendants = raw.descendants;
  if (Array.isArray(raw.kids)) item.kids = raw.kids.filter(isId);
  return item;
}

function signature(text) {
  return createHash('sha256').update(translationVersion + '\0' + text).digest('hex');
}

async function fetchJson(path) {
  const response = await fetch(api + path + '.json', { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw fault('Hacker News에서 데이터를 불러오지 못했습니다.', 502);
  return response.json();
}

async function mapLimited(ids, fn) {
  const result = Array(ids.length);
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

function chunks(text) {
  const parts = [];
  while (text.length > 6000) {
    const window = text.slice(0, 6000);
    let split = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
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
  runTranslation = async (entries, model) => (await import('./account.mjs')).translateBatch(entries, model),
  directory = process.env.HN_DATA_DIR || join(homedir(), '.local', 'share', 'hacker-news'),
  now = Date.now,
} = {}) {
  const db = openCache(directory);
  const recent = new Map();
  const loading = new Map();
  const translating = new Map();
  let translationQueue = Promise.resolve();

  // Requests for the same list or item share a single network operation.
  async function cached(path, ttl) {
    const entry = recent.get(path);
    if (entry && entry.until > now()) return entry.value;
    if (loading.has(path)) return loading.get(path);
    const action = Promise.resolve().then(() => request(path)).then(value => {
      const updated = recent.get(path);
      if (updated && updated !== entry) return updated.value;
      recent.delete(path);
      if (recent.size >= 3000) recent.delete(recent.keys().next().value);
      recent.set(path, { value, until: now() + ttl });
      return value;
    }).finally(() => loading.delete(path));
    loading.set(path, action);
    return action;
  }

  async function getItem(id) {
    return cleanItem(await cached('item/' + id, 30000), id);
  }

  function withKorean(item) {
    const result = { ...item };
    for (const field of ['title', 'text']) {
      if (!item[field]) continue;
      const cached = db.read.get(item.id, field, signature(item[field]));
      if (cached) result[field + 'Ko'] = cached.ko;
    }
    return result;
  }

  async function page(ids, offset, limit) {
    const pageIds = ids.slice(offset, offset + limit);
    const items = await mapLimited(pageIds, getItem);
    const nextOffset = offset + pageIds.length;
    return { items: items.filter(Boolean), nextOffset, hasMore: nextOffset < ids.length };
  }

  function cachedTranslations(page) {
    if (page.item) return { ...page, item: withKorean(page.item), comments: page.comments.map(withKorean) };
    return { ...page, items: page.items.map(withKorean) };
  }

  function savePage(key, page) {
    // Keep public originals only. Settings can clear translations in another process.
    const payload = JSON.stringify(page);
    if (Buffer.byteLength(payload) <= 256 * 1024) db.writePreview.run(key, payload, now());
    else db.forgetPreview.run(key);
    return cachedTranslations(page);
  }

  function preview({ sort, id, offset = 0, limit, titles }) {
    pageBounds(offset, limit);
    if (sort === undefined ? !isId(id) || titles !== undefined : !['top', 'new'].includes(sort) || id !== undefined)
      throw fault('저장된 페이지 종류를 확인해 주세요.', 400);
    // Older readers already store first-page originals, including their displayed order.
    if (titles?.length) return { titles: titles.map(withKorean) };
    const row = db.readPreview.get([sort ?? id, offset, limit].join(':'), now() - 86400000);
    if (!row) return {};
    return { page: cachedTranslations(JSON.parse(row.payload)), updatedAt: row.saved_at };
  }

  async function feed({ sort = 'top', offset = 0, limit = 20 } = {}) {
    pageBounds(offset, limit);
    if (sort !== 'top' && sort !== 'new') throw fault('피드 종류를 확인해 주세요.', 400);
    const ids = await cached(sort + 'stories', 10000);
    if (!Array.isArray(ids)) throw fault('Hacker News 목록을 불러오지 못했습니다.', 502);
    const ranked = ids.filter(isId);
    return savePage([sort, offset, limit].join(':'), {
      ...await page(ranked, offset, limit), revision: rankRevision(ranked),
    });
  }

  function watch({ sort, revision } = {}) {
    if ((sort !== 'top' && sort !== 'new') || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))
      throw fault('피드 갱신 정보를 확인해 주세요.', 400);
    const key = 'watch:' + sort + ':' + revision;
    if (loading.has(key)) return loading.get(key);
    const action = watchRankings({
      sort, revision, request: streamRequest, timeout: watchTimeout,
      onChange: ids => recent.set(sort + 'stories', { value: ids, until: now() + 10000 }),
    }).finally(() => loading.delete(key));
    loading.set(key, action);
    return action;
  }

  async function story({ id, offset = 0, limit = 10 } = {}) {
    pageBounds(offset, limit);
    if (!isId(id)) throw fault('게시물 번호를 확인해 주세요.', 400);
    const item = await getItem(id);
    const key = [id, offset, limit].join(':');
    if (!item) {
      db.forgetPreview.run(key);
      throw fault('삭제되었거나 찾을 수 없는 글입니다.', 404);
    }
    const { items: comments, ...pagination } = await page(item.kids ?? [], offset, limit);
    return savePage(key, { item, comments, ...pagination });
  }

  // Split unusually long discussions across model calls, then cache only complete translations.
  async function runBatch(sources, model, epoch) {
    const units = sources.flatMap(source => {
      source.unitIds = [];
      return chunks(source.text).map((text, index) => {
        const id = source.id + '-' + index;
        source.unitIds.push(id);
        return { id, text };
      });
    });
    const translated = new Map();
    let failure = 'error';
    for (let i = 0; i < units.length;) {
      const group = [];
      let size = 0;
      while (i < units.length && group.length < 20 && size + units[i].text.length <= 8000) {
        size += units[i].text.length;
        group.push(units[i++]);
      }
      try {
        const output = await runTranslation(group, model);
        for (const { id, text } of output) {
          if (typeof text === 'string' && text.trim()) translated.set(id, text.trim());
        }
      } catch (error) {
        if (error?.code === 'disconnected' || error?.code === 'limited') failure = error.code;
        break;
      }
    }
    const results = new Map();
    for (const source of sources) {
      if (!source.unitIds.every(id => translated.has(id))) {
        results.set(source.key, { status: failure });
        continue;
      }
      const text = source.unitIds.map(id => translated.get(id)).join('\n\n');
      db.write.run(source.id, source.field, source.fingerprint, text, now(), epoch);
      results.set(source.key, { id: source.id, text });
    }
    return results;
  }

  async function translate({ ids, field } = {}) {
    if (!Array.isArray(ids) || ids.length > 50 || !ids.every(isId) || !['title', 'text'].includes(field))
      throw fault('번역할 항목을 확인해 주세요.', 400);
    const items = await mapLimited([...new Set(ids)], getItem);
    const { model, epoch } = db.current();
    const sources = items.filter(item => item?.[field]?.trim()).map(item => {
      const fingerprint = signature(item[field]);
      const key = [item.id, field, fingerprint, model, epoch].join(':');
      return { id: item.id, text: item[field], field, fingerprint, key };
    });
    const active = new Map();
    const missing = [];
    for (const source of sources) {
      const existing = db.read.get(source.id, field, source.fingerprint);
      if (existing) active.set(source.key, { id: source.id, text: existing.ko });
      else if (translating.has(source.key)) active.set(source.key, translating.get(source.key));
      else missing.push(source);
    }
    if (missing.length) {
      const job = translationQueue.then(() => runBatch(missing, model, epoch));
      translationQueue = job.catch(() => {});
      for (const source of missing) {
        const result = job.then(results => results.get(source.key)).finally(() => translating.delete(source.key));
        translating.set(source.key, result);
        active.set(source.key, result);
      }
    }
    const output = await Promise.all(sources.map(source => active.get(source.key)));
    const status = output.find(row => row.status)?.status;
    return { items: output.filter(row => !row.status), ...(status && { status }) };
  }

  return { feed, watch, story, preview, translate, preferences: db, close: () => db.close() };
}

let defaultService;
export const service = () => defaultService ??= createNewsService();
export const feed = args => service().feed(args);
export const watch = args => service().watch(args);
export const story = args => service().story(args);
export const translate = args => service().translate(args);
