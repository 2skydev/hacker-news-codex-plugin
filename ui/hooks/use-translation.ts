import { useEffect, useState } from "react";
import type { Failure, Field, Item } from "../../shared/types/reader.types.ts";
import { call } from "../lib/host.ts";
import type { Job } from "../types/reader.types.ts";

type Options = {
  enabled: boolean;
  session?: string;
  model: string;
  view: string;
  onFailure: (status: Failure) => void;
};

type Progress = { done: number; total: number; startedAt: number };

const key = (item: Item, field: Field) => JSON.stringify([field, item.id, item[field]]);
export function useTranslation(jobs: Job[], { enabled, session, model, view, onFailure }: Options) {
  const [texts, setTexts] = useState(() => new Map<string, string>());
  const [blocked, setBlocked] = useState<Failure | "">("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset failures when the selected account or model changes.
  useEffect(() => {
    setBlocked("");
  }, [session, model]);
  function translation(item: Item, field: Field) {
    return item[field === "title" ? "titleKo" : "textKo"] || texts.get(key(item, field));
  }
  const missing = jobs.filter(([item, field]) => item[field] && !translation(item, field));
  const field = missing[0]?.[1];
  const batch = missing.filter((job) => job[1] === field).slice(0, field === "title" ? 5 : 3);
  const requests = batch.map(([item, field]) => ({ id: item.id, key: key(item, field) }));
  const batchKey = JSON.stringify(requests.map((request) => request.key));
  // biome-ignore lint/correctness/useExhaustiveDependencies: The batch key tracks request content and account, model, and view changes cancel in-flight work.
  useEffect(() => {
    if (!enabled || !visible || !field || blocked) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const startedAt = performance.now();
      setProgress((old) => {
        if (!old || old.done === old.total) return { done: 0, total: missing.length, startedAt };

        const total = Math.max(old.total, missing.length);
        return { ...old, done: total - missing.length, total };
      });
      try {
        const result = await call(
          "hn_translate",
          { field, ids: requests.map(({ id }) => id) },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const rows = new Map(result.items.map((row) => [row.id, row.text]));
        setTexts((previous) => {
          const next = new Map(previous);
          for (const { id, key } of requests) {
            const text = rows.get(id);
            if (text) next.set(key, text);
          }
          return next;
        });
        const failure = result.status || (requests.some(({ id }) => !rows.has(id)) && "error");
        if (failure) {
          setBlocked(failure);
          onFailure(failure);
        }
      } catch {
        if (!controller.signal.aborted) {
          setBlocked("error");
          onFailure("error");
        }
      }
    }, 80);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [batchKey, enabled, field, visible, blocked, session, model, view]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset progress whenever the view or translation availability changes.
  useEffect(() => {
    setProgress(null);
  }, [view, enabled, blocked]);
  useEffect(() => {
    if (missing.length || !enabled || blocked) return;
    setProgress((old) => old && { ...old, done: old.total });
  }, [missing.length, enabled, blocked]);
  return { translation, progress, blocked, retry: () => setBlocked("") };
}
