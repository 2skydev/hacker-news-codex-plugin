import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import type { TranslationEntry } from "../server/account/account-inference.ts";
import { openCache } from "../server/news/cache.ts";
import type { RawItem } from "../server/news/hn-item.ts";
import { createNewsService } from "../server/news/news-service.ts";

function fixture(
  t: TestContext,
  runTranslation: (entries: TranslationEntry[]) => Promise<TranslationEntry[]> = async (entries) =>
    entries.map((entry) => ({ ...entry, text: `번역 ${entry.text}` })),
) {
  const directory = mkdtempSync(join(tmpdir(), "hn-ko-news-"));
  const raw = new Map<string, number[] | RawItem>(
    Object.entries({
      topstories: [3, 2, 1],
      newstories: [1, 3],
      "item/3": {
        id: 3,
        type: "story",
        time: 30,
        title: "C++ &amp; <span>",
        url: "https://example.com/",
        score: 9,
        descendants: 4,
        kids: [10, 11, 12],
      },
      "item/2": { id: 2, type: "story", title: "Removed", deleted: true },
      "item/1": {
        id: 1,
        type: "story",
        title: "Ask HN: An API?",
        text: "Hi&#x27;s<p>Example<br>code:<pre><code>  a &lt; b\n    c</code></pre>",
      },
      "item/10": { id: 10, type: "comment", by: "reader", text: "One", kids: [13] },
      "item/11": { id: 11, type: "comment", text: "Dead", dead: true },
      "item/12": { id: 12, type: "comment", text: "Two" },
      "item/13": { id: 13, type: "comment", text: "Reply" },
    }),
  );
  let now = 1000;
  const requests: string[] = [];
  const calls: TranslationEntry[][] = [];
  const options: NonNullable<Parameters<typeof createNewsService>[0]> = {
    directory,
    now: () => now,
    request: async (path) => {
      requests.push(path);
      return structuredClone(raw.get(path) ?? null);
    },
    runTranslation: async (entries) => {
      calls.push(entries);
      return runTranslation(entries);
    },
  };
  const open = () => {
    const service = createNewsService(options);
    t.after(() => service.close());
    return service;
  };
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return {
    service: open(),
    open,
    raw,
    item(id: number) {
      const item = raw.get(`item/${id}`);
      assert.ok(item && !Array.isArray(item));
      return item;
    },
    calls,
    requests,
    advance: (n: number) => {
      now += n;
    },
  };
}

test("인기 순위와 페이지 위치를 보존하고 삭제된 글을 숨긴다", async (t) => {
  const { service, requests } = fixture(t);
  const [first, same] = await Promise.all([service.feed({ limit: 2 }), service.feed({ limit: 2 })]);
  assert.deepEqual(same, first);
  assert.deepEqual(
    first.items.map((x) => x.id),
    [3],
  );
  assert.equal(first.nextOffset, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].title, "C++ & <span>");
  assert.equal(requests.filter((x) => x === "item/3").length, 1);
  const last = await service.feed({ offset: first.nextOffset, limit: 2 });
  assert.deepEqual(
    last.items.map((x) => x.id),
    [1],
  );
  assert.equal(last.hasMore, false);
  assert.deepEqual(
    (await service.feed({ sort: "new" })).items.map((x) => x.id),
    [1, 3],
  );
});

test("댓글은 HN 표시 순서로 가져오며 직접 답글을 이어서 펼칠 수 있다", async (t) => {
  const { service } = fixture(t);
  const first = await service.story({ id: 3, limit: 2 });
  assert.equal(first.item.descendants, 4);
  assert.deepEqual(
    first.comments.map((x) => x.id),
    [10],
  );
  assert.equal(first.nextOffset, 2);
  const second = await service.story({ id: 3, offset: 2 });
  assert.deepEqual(
    second.comments.map((x) => x.id),
    [12],
  );
  assert.deepEqual(
    (await service.story({ id: 10 })).comments.map((x) => x.id),
    [13],
  );
  const ask = await service.story({ id: 1 });
  assert.equal(ask.item.text, "Hi's\n\nExample\ncode:\n\n  a < b\n    c");
  await assert.rejects(service.story({ id: 2 }), { status: 404 });
});

test("중복된 요청을 공유하고 캐시를 재실행 후에도 읽으며 제목 변경만 다시 번역한다", async (t) => {
  const { service, open, calls, item, advance } = fixture(t);
  const args = { ids: [3, 1, 3], field: "title" };
  const [a, b] = await Promise.all([service.translate(args), service.translate(args)]);
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.items.map((x) => x.id),
    [3, 1],
  );
  assert.equal(calls.length, 1);
  const other = open();
  assert.deepEqual(await other.translate(args), a);
  assert.equal((await other.feed()).items[0].titleKo, a.items[0].text);
  const third = item(3);
  assert.ok(typeof third.score === "number");
  third.score++;
  advance(31000);
  assert.equal((await service.feed()).items[0].score, 10);
  await service.translate(args);
  assert.equal(calls.length, 1);
  item(3).title = "Updated";
  advance(31000);
  assert.equal((await service.feed()).items[0].titleKo, undefined);
  assert.equal((await service.translate(args)).items[0].text, "번역 Updated");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].length, 1);
});

test("미연결 시 저장된 번역을 반환하고 연결 후 남은 항목을 재시도한다", async (t) => {
  let connected = true;
  const { service } = fixture(t, async (rows) => {
    if (!connected) throw Object.assign(new Error(), { code: "disconnected" });
    return rows.map((x) => ({ id: x.id, text: "결과" }));
  });
  await service.translate({ ids: [3], field: "title" });
  connected = false;
  const result = await service.translate({ ids: [3, 1], field: "title" });
  assert.deepEqual(result, { items: [{ id: 3, text: "결과" }], status: "disconnected" });
  connected = true;
  assert.deepEqual((await service.translate({ ids: [1], field: "text" })).items, [
    { id: 1, text: "결과" },
  ]);
  assert.equal((await service.story({ id: 1 })).item.textKo, "결과");
});

test("긴 댓글은 완역된 경우만 캐시하고 제한 뒤 재시도한다", async (t) => {
  let limited = true;
  const { service, calls, item } = fixture(t, async (entries) => {
    if (limited && entries.some((x) => x.id.endsWith("-1")))
      throw Object.assign(new Error(), { code: "limited" });
    return entries.map((x) => ({ id: x.id, text: x.text }));
  });
  item(10).text = `${"one ".repeat(2000)}end`;
  const args = { ids: [10], field: "text" };
  assert.deepEqual(await service.translate(args), { items: [], status: "limited" });
  assert.equal((await service.story({ id: 10 })).item.textKo, undefined);
  limited = false;
  const result = await service.translate(args);
  assert.ok(result.items[0].text.endsWith("end"));
  assert.ok(
    calls.every((batch) => batch.reduce((total, unit) => total + unit.text.length, 0) <= 8000),
  );
});

test("입력을 검증하고 순위 데이터의 갱신 주기를 지킨다", async (t) => {
  const { service, raw, advance, requests } = fixture(t);
  await assert.rejects(service.feed({ sort: "unknown" }), { status: 400 });
  await assert.rejects(service.feed({ limit: 51 }), { status: 400 });
  await assert.rejects(service.story({ id: "3" }), { status: 400 });
  await assert.rejects(service.translate({ ids: [1.5], field: "text" }), { status: 400 });
  assert.equal(requests.length, 0);
  await service.feed();
  raw.set("topstories", [1, 3]);
  assert.equal((await service.feed()).items[0].id, 3);
  advance(11000);
  assert.equal((await service.feed()).items[0].id, 1);
});

test("캐시 용량은 UTF-8 번역문 크기이며 선택한 기간과 종류만 삭제한다", async (t) => {
  const { service, open, advance } = fixture(t);
  await service.translate({ ids: [3], field: "title" });
  advance(2 * 86400000);
  await service.translate({ ids: [1], field: "text" });
  const prefs = service.preferences;
  const ko = (await service.story({ id: 1 })).item.textKo;
  const title = (await service.story({ id: 3 })).item.titleKo;
  assert.ok(title && ko);
  assert.equal(prefs.stats().bytes, Buffer.byteLength(title + ko));
  assert.equal(prefs.clear("title", 1, 1000 + 2 * 86400000).removed, 0);
  assert.deepEqual(prefs.clear("text", 1, 1000 + 2 * 86400000), {
    removed: 1,
    count: 1,
    bytes: Buffer.byteLength(title),
  });
  prefs.update({ realtime: false });
  assert.deepEqual(open().preferences.values(), {
    realtime: false,
    model: "자동",
    cacheField: "모든 번역",
    cachePeriod: "전체 기간",
    cacheAutoDelete: true,
    cacheRetentionDays: 7,
  });
  assert.equal(prefs.clear("all", 0, Date.now()).removed, 1);
  assert.equal(prefs.stats().bytes, 0);
});

test("삭제 전에 시작한 번역은 늦게 완료돼도 디스크 캐시를 다시 채우지 않는다", async (t) => {
  const started = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  const { service, open } = fixture(t, async (rows) => {
    started.resolve();
    await finish.promise;
    return rows;
  });
  const job = service.translate({ ids: [3], field: "title" });
  await started.promise;
  open().preferences.clear("all", 0, Date.now());
  finish.resolve();
  await job;
  assert.equal(service.preferences.stats().count, 0);
});

test("댓글의 링크 문구와 실제 목적지를 보존하고 HTTP(S) 목적지만 전달한다", async (t) => {
  const { service, item: getItem } = fixture(t);
  getItem(10).text =
    '<a href="https://example.org/?x=1&amp;y=2">문서</a> <a href="item?id=3">토론</a> <a href="javascript:void(0)">기타</a>';
  const { item } = await service.story({ id: 10 });
  assert.deepEqual(item.links, [
    "https://example.org/?x=1&y=2",
    "https://news.ycombinator.com/item?id=3",
  ]);
  assert.equal(item.text, "⟦1⟧문서⟦/1⟧ ⟦2⟧토론⟦/2⟧ 기타");
});

test("기존 캐시의 저장일을 추정하지 않고 전체 기간에서만 비운다", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hn-ko-migration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(join(dir, "translations.sqlite"));
  old.exec(`CREATE TABLE translations (
    id INTEGER NOT NULL, field TEXT NOT NULL, fingerprint TEXT NOT NULL, ko TEXT NOT NULL,
    PRIMARY KEY (id, field, fingerprint)
  ) WITHOUT ROWID; INSERT INTO translations VALUES (1, 'title', 'old', '이전 번역')`);
  old.close();
  const prefs = openCache(dir);
  t.after(() => prefs.close());
  assert.equal(prefs.values().cacheAutoDelete, true);
  assert.equal(prefs.values().cacheRetentionDays, 7);
  assert.equal(prefs.stats().count, 1);
  assert.equal(prefs.clear("all", 30, Date.now()).removed, 0);
  assert.equal(prefs.clear("all", -30, Date.now()).removed, 0);
  assert.equal(prefs.read(1, "title", "old")?.ko, "이전 번역");
  assert.equal(prefs.clear("title", 0, Date.now()).removed, 1);
});

test("30일보다 오래된 캐시만 삭제하고 경계 시각과 다른 종류를 보존한다", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hn-cache-range-"));
  const prefs = openCache(dir);
  t.after(() => {
    prefs.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const now = Date.now(),
    cutoff = now - 30 * 86400000;
  prefs.update({ cacheAutoDelete: false });
  for (const [id, field, time] of [
    [1, "title", cutoff - 1],
    [2, "title", cutoff],
    [3, "text", cutoff - 1],
  ])
    prefs.write.run(id, field, "key", "번역", time, 0);
  assert.equal(prefs.clear("title", -30, now).removed, 1);
  assert.ok(prefs.read(2, "title", "key"));
  assert.ok(prefs.read(3, "text", "key"));
});

test("보관 기간을 넘긴 번역은 다시 읽지 않고 재시작 시 디스크에서 삭제한다", async (t) => {
  const { service, open, advance, calls } = fixture(t);
  const translateTitle = () => service.translate({ ids: [3], field: "title" });
  await translateTitle();
  advance(7 * 86400000);
  assert.ok((await service.story({ id: 3 })).item.titleKo);
  advance(1);
  assert.equal((await service.story({ id: 3 })).item.titleKo, undefined);
  assert.equal(open().preferences.clear("all", 0, Date.now()).removed, 0);
  await translateTitle();
  assert.equal(calls.length, 2);
});

test("재시작 뒤에도 원문 요청 없이 목록과 댓글의 현재 번역 캐시를 읽는다", async (t) => {
  const { service, open, calls, requests, advance, item } = fixture(t);
  const feed = { sort: "top", offset: 0, limit: 2 },
    story = { id: 3, offset: 0, limit: 2 };
  await service.feed(feed);
  await service.story(story);
  await service.translate({ ids: [3], field: "title" });
  await service.translate({ ids: [10], field: "text" });
  const next = open(),
    before = requests.length;
  const firstFeed = next.preview(feed).page;
  assert.ok(firstFeed && "items" in firstFeed);
  const title = firstFeed.items[0];
  assert.ok(title.titleKo);
  const firstStory = next.preview(story).page;
  assert.ok(firstStory && "comments" in firstStory && firstStory.comments[0].textKo);
  assert.deepEqual(next.preview({ ...story, offset: 2 }), {});
  assert.equal(
    next.preview({ ...feed, titles: [{ id: 3, title: title.title }] }).titles?.[0].titleKo,
    title.titleKo,
  );
  const changedTitles = next.preview({ ...feed, titles: [{ id: 3, title: "Other" }] }).titles;
  assert.ok(changedTitles?.[0]);
  assert.equal(changedTitles[0].titleKo, undefined);
  service.preferences.clear("text", 0, Date.now());
  const clearedStory = next.preview(story).page;
  assert.ok(clearedStory && "comments" in clearedStory);
  assert.equal(clearedStory.comments[0].textKo, undefined);
  assert.equal(requests.length, before);
  assert.equal(calls.length, 2);
  item(3).title = "Edited";
  advance(31000);
  assert.equal((await next.feed(feed)).items[0].titleKo, undefined);
  const updatedFeed = next.preview(feed).page;
  assert.ok(updatedFeed && "items" in updatedFeed);
  assert.equal(updatedFeed.items[0].title, "Edited");
  item(3).deleted = true;
  advance(31000);
  await assert.rejects(next.story(story), { status: 404 });
  assert.deepEqual(next.preview(story), {});
  advance(86400001);
  assert.deepEqual(next.preview(feed), {});
});
