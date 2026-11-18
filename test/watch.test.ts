import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNewsService } from "../server/news/news-service.ts";
import { rankRevision, watchRankings } from "../server/news/watch-rankings.ts";

const message = (kind: string, data: unknown) =>
  `event: ${kind}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;

function sse(
  blocks: string[],
  signals: AbortSignal[] = [],
): NonNullable<Parameters<typeof watchRankings>[0]["request"]> {
  return async (_url, { headers, signal }) => {
    signals.push(signal);
    assert.equal(headers.Accept, "text/event-stream");
    const body = new ReadableStream({
      start(out) {
        const bytes = Buffer.from(blocks.join(""));
        // Both the frame boundary and JSON payload can be split across TCP chunks.
        for (let i = 0; i < bytes.length; i += 3) out.enqueue(bytes.subarray(i, i + 3));
        signal.addEventListener("abort", () => out.error(signal.reason), { once: true });
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  };
}

test("같은 첫 스냅샷을 지나 상위 순위 변경을 즉시 반영하고 HTTP 구독을 닫는다", async () => {
  const original = Array.from({ length: 21 }, (_, i) => i + 1);
  const blocks = [
    message("put", { path: "/", data: original }),
    message("keep-alive", null),
    message("put", { path: "/20", data: 42 }),
    message("patch", { path: "/", data: { 0: 2, 1: 1 } }),
  ];
  const signals: AbortSignal[] = [];
  let updated: number[] | undefined;
  const result = await watchRankings({
    sort: "top",
    revision: rankRevision(original),
    timeout: 300,
    request: sse(blocks, signals),
    onChange: (ids) => {
      updated = ids;
    },
  });
  assert.deepEqual(result, { changed: true, live: true });
  assert.ok(updated);
  assert.deepEqual(updated.slice(0, 2), [2, 1]);
  assert.equal(updated[20], 42);
  assert.ok(signals[0].aborted);
});

test("정상 구독은 제한 시간에 닫고, 끊어진 스트림은 일반 새로고침으로 전환한다", async () => {
  const options = {
    sort: "new" as const,
    revision: rankRevision([1, 2]),
    timeout: 15,
    onChange: () => assert.fail(),
  };
  const signals: AbortSignal[] = [];
  const snapshot = message("put", { path: "/", data: [1, 2] });
  assert.deepEqual(await watchRankings({ ...options, request: sse([snapshot], signals) }), {
    changed: false,
    live: true,
  });
  assert.ok(signals[0].aborted);
  assert.deepEqual(await watchRankings({ ...options, request: sse([message("cancel", null)]) }), {
    changed: false,
    live: false,
  });
  assert.deepEqual(await watchRankings({ ...options, request: sse([]) }), {
    changed: false,
    live: false,
  });
  assert.deepEqual(await watchRankings({ ...options, request: async () => new Response("[]") }), {
    changed: false,
    live: false,
  });
});

test("삭제 항목 또는 페이지 크기와 상관없이 같은 revision을 만들고 새 순위 캐시를 바로 읽는다", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hn-watch-test-"));
  const paths: string[] = [];
  const signals: AbortSignal[] = [];
  const service = createNewsService({
    directory: dir,
    request: async (path) => {
      paths.push(path);
      if (path === "topstories") return [1, 2, 3];
      const id = Number(path.split("/").pop());
      return { id, type: "story", title: "Story", deleted: id === 2, time: 100 };
    },
    streamRequest: sse([message("put", { path: "/", data: [3, 2, 1] })], signals),
  });
  t.after(() => {
    service.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const first = await service.feed({ limit: 1 });
  assert.equal(first.revision, (await service.feed({ limit: 3 })).revision);
  const args = { sort: "top", revision: first.revision };
  const [updated, same] = await Promise.all([service.watch(args), service.watch(args)]);
  assert.equal(signals.length, 1);
  assert.deepEqual(updated, { changed: true, live: true });
  assert.deepEqual(same, updated);
  const second = await service.feed({ limit: 1 });
  assert.equal(second.items[0].id, 3);
  assert.notEqual(second.revision, first.revision);
  assert.equal(paths.filter((p) => p === "topstories").length, 1);
});
