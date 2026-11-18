import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import type { Item, Sort } from "../../../shared/types/reader.types.ts";
import { FEED_TABS } from "../../constants/feed.constants.ts";
import type { useFeed } from "../../hooks/use-feed.ts";
import { canAnimateFeed } from "../../lib/feed-motion.ts";
import { numbers, since } from "../../lib/format.ts";
import { externalUrl } from "../../lib/links.ts";
import { AnimatedCount } from "../AnimatedCount.tsx";
import { TranslatedField } from "../translation/TranslatedField.tsx";

type OpenStory = (item: Item, trigger: HTMLButtonElement) => void;

function FeedCount({
  value,
  prefix = "",
  suffix = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
}) {
  const label = `${prefix}${numbers.format(value)}${suffix}`;

  return (
    <>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" data-feed-count={label}>
        {prefix}
        <AnimatedCount value={value} />
        {suffix}
      </span>
    </>
  );
}

function Row({ item, index, open }: { item: Item; index: number; open: OpenStory }) {
  const url = externalUrl(item.url);
  const title = (
    <TranslatedField
      item={item}
      field="title"
      domain={url && `(${url.hostname.replace(/^www\./, "")})`}
    />
  );
  return (
    <li className="row" id={`row-${item.id}`}>
      <span className="rank" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div>
        <h2>
          {url ? (
            <a className="story-title" href={url.href} target="_blank" rel="noreferrer">
              {title}
            </a>
          ) : (
            <button
              type="button"
              className="story-title"
              onClick={(e) => open(item, e.currentTarget)}
            >
              {title}
            </button>
          )}
        </h2>
        <div className="meta">
          {item.score != null && (
            <span className="score">
              <FeedCount value={item.score} suffix="점" />
            </span>
          )}
          <span>{since(item.time)}</span>
          {item.descendants != null && (
            <button type="button" className="count" onClick={(e) => open(item, e.currentTarget)}>
              <FeedCount value={item.descendants} prefix="댓글 " />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
export function Feed({
  feed,
  sort,
  changeSort,
  open,
  hostError,
}: {
  feed: ReturnType<typeof useFeed>;
  sort: Sort;
  changeSort: (sort: Sort) => void;
  open: OpenStory;
  hostError: string;
}) {
  const newCount = feed.pending?.items.filter(
    (item) => !feed.items.some((old) => old.id === item.id),
  ).length;

  function selectSort(next: Sort) {
    if (next === sort) return;

    const from = canAnimateFeed()
      ? document.getElementById("feed-sort-indicator")?.getBoundingClientRect().left
      : undefined;

    // The sort change remounts the reader with a fresh feed state.
    flushSync(() => changeSort(next));
    document
      .querySelector<HTMLButtonElement>('.sort button[aria-pressed="true"]')
      ?.focus({ preventScroll: true });

    const indicator = document.getElementById("feed-sort-indicator");
    if (from === undefined || !indicator) return;

    const offset = from - indicator.getBoundingClientRect().left;
    indicator.animate(
      { transform: [`translateX(${offset}px)`, "none"] },
      { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }

  return (
    <section id="feed" aria-label="뉴스 피드">
      <div className="bar">
        <nav className="sort" aria-label="글 정렬" data-sort={sort}>
          {FEED_TABS.map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={sort === key}
              onClick={() => selectSort(key)}
            >
              {label}
            </button>
          ))}
          <span id="feed-sort-indicator" aria-hidden="true" />
        </nav>
      </div>
      {feed.pending && (
        <button
          type="button"
          className="updates"
          aria-label={newCount ? `새 글 ${numbers.format(newCount)}개 보기 ↑` : undefined}
          onClick={feed.applyPending}
        >
          {newCount ? (
            <span aria-hidden="true">
              새 글 <AnimatedCount value={newCount} />개 보기 ↑
            </span>
          ) : (
            "바뀐 순위 보기 ↑"
          )}
        </button>
      )}
      <ol id="stories" className="stories">
        {[...feed.items, ...feed.preview].map((item, i) => (
          <Row key={item.id} item={item} index={i} open={open} />
        ))}
      </ol>
      <ol id="feed-exits" className="feed-exits stories" aria-hidden="true" inert />
      {hostError || feed.error ? (
        <p className="empty" role="status">
          {hostError || feed.error}
          {!hostError && (
            <button type="button" className="retry" onClick={() => feed.load(feed.retry)}>
              다시 시도
            </button>
          )}
        </p>
      ) : !feed.items.length ? (
        <p className="empty" role="status">
          {feed.revision && !feed.loading ? "표시할 글이 없습니다." : "글을 불러오는 중…"}
        </p>
      ) : (
        !feed.revision && (
          <p className="empty" role="status">
            저장된 글을 표시하고 있습니다. 새 글을 확인하는 중…
          </p>
        )
      )}
      {feed.more && (
        <Button
          variant="outline"
          className="more"
          disabled={feed.loading}
          onClick={() => feed.load("more")}
        >
          글 더 보기
        </Button>
      )}
    </section>
  );
}
