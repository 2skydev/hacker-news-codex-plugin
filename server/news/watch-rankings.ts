import { createHash } from "node:crypto";

import type { Sort } from "../../shared/types/reader.types.ts";
import { isId } from "./hn-item.ts";
import { HN_API } from "./news.constants.ts";

type Rankings = (number | null)[];
type WatchRequest = (
  url: string,
  options: { headers: { Accept: string }; signal: AbortSignal },
) => Promise<Response>;

interface WatchOptions {
  sort: Sort;
  revision: string;
  onChange: (ids: number[]) => void;
  request?: WatchRequest;
  timeout?: number;
}

export function rankRevision(ids: number[]) {
  return createHash("sha256").update(ids.slice(0, 20).join(",")).digest("hex");
}

function positions(value: unknown): [number, number | null][] {
  if (value === null) return [];
  if (typeof value !== "object") throw new Error("Invalid Firebase list");
  return Object.entries(value).map(([index, id]) => {
    if (!/^\d{1,3}$/.test(index) || !(id === null || isId(id)))
      throw new Error("Invalid Firebase item");
    return [Number(index), id];
  });
}

// Firebase may send a complete list, a single position or a group of changed positions.
function applyEvent(
  previous: Rankings | undefined,
  type: "put" | "patch",
  payload: { path: string; data: unknown },
): Rankings {
  if (payload.path === "/") {
    const next: Rankings | undefined = type === "put" ? [] : previous?.slice();
    if (!next) throw new Error("Missing Firebase snapshot");
    for (const [index, id] of positions(payload.data)) next[index] = id;
    return next;
  }
  const match = /^\/(\d{1,3})$/.exec(payload.path);
  if (!previous || !match || type !== "put") throw new Error("Invalid Firebase update");
  const next = previous.slice();
  for (const [index, id] of positions({ [match[1]]: payload.data })) next[index] = id;
  return next;
}

export async function watchRankings({
  sort,
  revision,
  onChange,
  request = fetch,
  timeout = 20000,
}: WatchOptions) {
  const controller = new AbortController();
  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeout);
  let snapshot: Rankings | undefined;
  try {
    const response = await request(`${HN_API}${sort}stories.json`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      return { changed: false, live: false };

    let buffer = "";
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const type = /^event:\s*([^\r\n]+)/m.exec(block)?.[1].trim();
        if (type === "cancel" || type === "auth_revoked") return { changed: false, live: false };
        if (type !== "put" && type !== "patch") continue;
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5))
          .join("\n");
        snapshot = applyEvent(snapshot, type, JSON.parse(data));
        const ids = snapshot.filter((id): id is number => id !== null);
        if (rankRevision(ids) !== revision) {
          onChange(ids);
          return { changed: true, live: true };
        }
      }
    }
  } catch {
    return { changed: false, live: expired && Boolean(snapshot) };
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
  return { changed: false, live: expired && Boolean(snapshot) };
}
