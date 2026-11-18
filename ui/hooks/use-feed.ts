import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedPage, Item, Sort } from "../../shared/types/reader.types.ts";
import {
  canAnimateFeed,
  cancelFeedAnimations,
  type FeedRowPosition,
  playFeedAnimations,
  REDUCED_MOTION,
} from "../lib/feed-motion.ts";
import { call, readWithPreview } from "../lib/host.ts";

type Load = "first" | "more" | "poll";

interface FeedLayout {
  anchor?: [row: HTMLLIElement, top: number];
  positions?: Map<HTMLLIElement, FeedRowPosition>;
  focus?: HTMLElement;
}

interface FeedState {
  head: Item[];
  items: Item[];
  preview: Item[];
  updatedAt?: number;
  revision: string;
  next: number;
  more: boolean;
  loading: boolean;
  pending: FeedPage | null;
  error: string;
  retry?: Load;
}

function storePreview(sort: Sort, page: FeedPage) {
  if (!page) return;
  const { items: stories, nextOffset, hasMore } = page;
  // Persist only the public list. Bodies, comments and account information stay out of this snapshot.
  const entries = stories.map(({ id, type, title, url, by, time, score, descendants }) => ({
    id,
    type,
    title,
    url,
    by,
    time,
    score,
    descendants,
  }));
  try {
    localStorage.setItem(
      `hn-ko-feed-v2-${sort}`,
      JSON.stringify({ items: entries, nextOffset, hasMore, updatedAt: page.updatedAt }),
    );
  } catch {
    /* The live feed remains available when the host disables storage. */
  }
}

function readPreview(sort: Sort): Omit<FeedPage, "revision"> | null {
  try {
    localStorage.removeItem(`hn-ko-feed-v1-${sort}`);
    const page = JSON.parse(localStorage.getItem(`hn-ko-feed-v2-${sort}`) ?? "null");
    if (
      Array.isArray(page?.items) &&
      page.items.length > 0 &&
      page.items.length <= 20 &&
      page.items.every(
        (item: Partial<Item> | null) =>
          item !== null &&
          Number.isSafeInteger(item.id) &&
          typeof item.title === "string" &&
          Number.isFinite(item.time),
      ) &&
      Number.isInteger(page.nextOffset) &&
      typeof page.hasMore === "boolean"
    )
      return page;
  } catch {
    /* Ignore an unavailable or incomplete snapshot. */
  }
  return null;
}

function distinct(items: Item[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
function sameOrder(a: Item[], b: Item[]) {
  return a.length === b.length && a.every((item, index) => item.id === b[index].id);
}

export function useFeed(sort: Sort, active: boolean, realtime: boolean, ready: boolean) {
  const [feed, set] = useState<FeedState>(() => {
    const cached = readPreview(sort);
    return {
      head: cached?.items || [],
      items: cached?.items || [],
      updatedAt: cached?.updatedAt,
      revision: "",
      more: false,
      next: 0,
      loading: false,
      pending: null,
      preview: [],
      error: "",
    };
  });
  const current = useRef(feed);
  const busy = useRef(false);
  const life = useRef<AbortController | null>(null);
  const layout = useRef<FeedLayout | null>(null);
  const mode = useRef({ active, realtime });
  useLayoutEffect(() => {
    mode.current = { active, realtime };
    if (!active) cancelFeedAnimations();
  }, [active, realtime]);
  useEffect(() => {
    const preference = window.matchMedia(REDUCED_MOTION);
    function stop(event: MediaQueryListEvent) {
      if (event.matches) cancelFeedAnimations();
    }

    preference.addEventListener("change", stop);
    return () => preference.removeEventListener("change", stop);
  }, []);
  function update(patch: Partial<FeedState>) {
    current.current = { ...current.current, ...patch };
    set(current.current);
  }
  function apply(page: FeedPage, items = page.items, cursor = page) {
    const nextItems = distinct(items);
    const state = current.current;
    const changed = !!state.revision && !sameOrder(state.items, nextItems);
    const before: FeedLayout = {};
    if (mode.current.active && (window.scrollY || changed)) {
      const rows = [...document.querySelectorAll<HTMLLIElement>("#stories > .row")];
      if (changed && canAnimateFeed()) {
        before.positions = new Map(
          rows.map((row) => [
            row,
            { rect: row.getBoundingClientRect(), opacity: Number(getComputedStyle(row).opacity) },
          ]),
        );
      }
      const focused = document.activeElement;
      if (changed && focused instanceof HTMLElement && focused.closest("#stories > .row")) {
        before.focus = focused;
      }
      if (window.scrollY) {
        const nextIds = new Set(nextItems.map(({ id }) => `row-${id}`));
        for (const row of rows) {
          if (!nextIds.has(row.id)) continue;
          const top = (before.positions?.get(row)?.rect ?? row.getBoundingClientRect()).top;
          if (top < 0) continue;
          before.anchor = [row, top];
          break;
        }
      }
    }
    layout.current = before;
    update({
      head: page.items,
      items: nextItems,
      next: cursor.nextOffset,
      more: cursor.hasMore,
      pending: null,
      preview: [],
      updatedAt: page.updatedAt,
      error: "",
    });
    storePreview(sort, page);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Apply the saved layout after the list commits.
  useLayoutEffect(() => {
    const before = layout.current;
    layout.current = null;
    if (!before || !mode.current.active) return;

    if (before.positions) cancelFeedAnimations();
    if (before.anchor) {
      const [row, top] = before.anchor;
      if (row.isConnected) window.scrollBy(0, row.getBoundingClientRect().top - top);
    }
    if (before.focus?.isConnected && document.activeElement === document.body) {
      before.focus.focus({ preventScroll: true });
    }
    if (before.positions && canAnimateFeed()) playFeedAnimations(before.positions);
  }, [feed.items]);

  async function load(type: Load = "first", signal = life.current?.signal) {
    if (!signal || signal.aborted || busy.current) return;
    busy.current = true;
    const old = current.current;
    const more = type === "more";
    const args = { sort, offset: more ? old.next : 0, limit: 20 };
    update({ loading: true, error: "" });
    try {
      const titles = !more && old.head.length && old.head.map(({ id, title }) => ({ id, title }));
      const page =
        type === "poll"
          ? await call("hn_feed", args, signal)
          : await readWithPreview(
              "hn_feed",
              args,
              titles ? { ...args, titles } : args,
              (saved) => {
                if (signal.aborted) return;
                if (saved.titles) {
                  const translated = new Map(saved.titles.map((item) => [item.id, item]));
                  update({
                    items: old.items.map((item) => {
                      const match = translated.get(item.id);
                      return match && match.title === item.title
                        ? { ...item, titleKo: match.titleKo || item.titleKo }
                        : item;
                    }),
                  });
                } else if (saved.page && more && saved.page.revision === old.revision)
                  update({
                    preview: saved.page.items.filter(
                      (item) => !old.items.some((row) => row.id === item.id),
                    ),
                  });
                else if (saved.page && !more)
                  update({
                    items: saved.page.items,
                    head: saved.page.items,
                    updatedAt: saved.updatedAt,
                  });
              },
              signal,
            );
      if (signal.aborted) return;
      if (more) {
        update({
          items: distinct([...old.items, ...page.items]),
          next: page.nextOffset,
          more: page.hasMore,
        });
        return;
      }
      const state = current.current;
      const same = sameOrder(state.head, page.items);
      const unchanged =
        same &&
        page.items.every((row, i) =>
          (["title", "url", "time", "score", "descendants"] as const).every(
            (k) => row[k] === state.head[i][k],
          ),
        );
      page.updatedAt = (unchanged && state.updatedAt) || Date.now();
      if (!state.items.length || (same && state.items.length <= state.head.length)) apply(page);
      else if (same) {
        update({
          items: distinct([...page.items, ...state.items.slice(state.head.length)]),
          head: page.items,
          updatedAt: page.updatedAt,
          pending: null,
        });
        storePreview(sort, page);
      } else if (mode.current.realtime && mode.current.active) {
        const items = [...page.items];
        let cursor = page;
        while (cursor.hasMore && cursor.nextOffset < old.next) {
          cursor = await call(
            "hn_feed",
            { sort, offset: cursor.nextOffset, limit: Math.min(50, old.next - cursor.nextOffset) },
            signal,
          );
          if (signal.aborted || cursor.revision !== page.revision) return;
          items.push(...cursor.items);
        }
        if (mode.current.realtime && mode.current.active) apply(page, items, cursor);
        else update({ pending: page });
      } else update({ pending: page });
      update({ revision: page.revision });
    } catch {
      if (!signal.aborted && type !== "poll")
        update({ error: "글을 불러오지 못했습니다.", retry: type });
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        update({ loading: false, preview: [] });
      }
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Start one request lifecycle for each ready feed sort.
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    life.current = controller;
    load("first", controller.signal);
    return () => {
      controller.abort();
      busy.current = false;
    };
  }, [sort, ready]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Apply pending rankings when the feed becomes visible or real-time updates resume.
  useEffect(() => {
    if (active && realtime && current.current.pending) apply(current.current.pending);
  }, [active, realtime]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Keep the watch stream open until its sort, visibility, or revision changes.
  useEffect(() => {
    if (!active || !feed.revision) return;
    let timer: ReturnType<typeof setTimeout> | undefined, watch: AbortController | undefined;
    let stopped = false;
    async function listen() {
      if (stopped || document.hidden) return;
      const request = new AbortController();
      watch = request;
      let delay = 30000;
      try {
        const result = await call("hn_watch", { sort, revision: feed.revision }, request.signal);
        if (stopped || request.signal.aborted) return;
        if (result.changed) await load("poll");
        if (result.live) delay = result.changed ? 3000 : 150;
      } catch {
        /* Periodic refresh covers interrupted watches. */
      } finally {
        if (watch === request) {
          watch = undefined;
          if (!stopped && !document.hidden) timer = setTimeout(listen, delay);
        }
      }
    }
    function refresh() {
      if (!document.hidden) load("poll");
    }
    function visibility() {
      clearTimeout(timer);
      if (document.hidden) watch?.abort();
      else {
        refresh();
        if (!watch || watch.signal.aborted) listen();
      }
    }
    listen();
    const periodic = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      watch?.abort();
      clearTimeout(timer);
      clearInterval(periodic);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, feed.revision, sort]);
  return {
    ...feed,
    load,
    applyPending: () => current.current.pending && apply(current.current.pending),
  };
}
