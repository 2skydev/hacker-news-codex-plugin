import { useEffect, useRef, useState } from "react";
import type { Item } from "../../shared/types/reader.types.ts";
import { readWithPreview } from "../lib/host.ts";
import type { Job } from "../types/reader.types.ts";

interface CommentPage {
  comments: Item[];
  open: boolean;
  loading?: boolean;
  error?: string;
  preview?: Item[];
  more?: boolean;
  next?: number;
}
export interface Thread {
  item: Item;
  lists: Record<number, CommentPage>;
  controller: AbortController;
}

export function useDiscussion() {
  const [thread, set] = useState<Thread | null>(null);
  const current = useRef<Thread | null>(null);
  function commit(view: Thread) {
    if (current.current === view) set({ ...view, lists: { ...view.lists } });
  }
  async function load(view: Thread, id: number, offset = 0) {
    view.lists[id] ??= { comments: [], open: true };
    const list = view.lists[id];
    if (list.loading) return;
    list.loading = true;
    list.error = "";
    commit(view);
    const args = { id, offset, limit: 8 };
    try {
      const page = await readWithPreview(
        "hn_story",
        args,
        args,
        ({ page }) => {
          if (!page || current.current !== view) return;
          if (id === view.item.id) view.item = page.item;
          list.preview = page.comments;
          commit(view);
        },
        view.controller.signal,
      );
      if (current.current !== view) return;
      if (id === view.item.id) view.item = page.item;
      const known = new Set(list.comments.map((c) => c.id));
      list.comments = [...list.comments, ...page.comments.filter((c) => !known.has(c.id))];
      list.next = page.nextOffset;
      list.more = page.hasMore;
    } catch {
      if (current.current === view) list.error = "글이나 댓글을 불러오지 못했습니다.";
    } finally {
      list.loading = false;
      list.preview = [];
      commit(view);
    }
  }
  function open(item: Item) {
    current.current?.controller.abort();
    const view = { item, lists: {}, controller: new AbortController() };
    current.current = view;
    load(view, item.id);
  }
  function close() {
    current.current?.controller.abort();
    current.current = null;
    set(null);
  }
  function toggle(id: number, open: boolean) {
    const view = current.current;
    if (!view) return;
    if (!view.lists[id]) {
      if (open) load(view, id);
      return;
    }
    view.lists[id].open = open;
    commit(view);
  }
  useEffect(() => () => current.current?.controller.abort(), []);
  return {
    thread,
    open,
    close,
    toggle,
    more: (id: number) =>
      current.current && load(current.current, id, current.current.lists[id].next),
  };
}

export function visibleText(thread: Thread): Job[] {
  const root = thread.lists[thread.item.id];
  if (root.loading && !root.comments.length) return [];
  const jobs: Job[] = [
    [thread.item, "title"],
    [thread.item, "text"],
  ];
  function walk(id: number) {
    const list = thread.lists[id];
    if (!list?.open) return;
    for (const comment of list.comments) {
      jobs.push([comment, "text"]);
      walk(comment.id);
    }
  }
  walk(thread.item.id);
  return jobs;
}
