import { Button } from "@/components/ui/button";
import type { Thread, useDiscussion } from "../../hooks/use-discussion.ts";
import { numbers, since } from "../../lib/format.ts";
import { externalUrl, hnUrl } from "../../lib/links.ts";
import { LanguageButton } from "../translation/LanguageButton.tsx";
import { TranslatedField } from "../translation/TranslatedField.tsx";

interface CommentListProps extends Pick<ReturnType<typeof useDiscussion>, "more" | "toggle"> {
  id: number;
  thread: Thread;
}

function CommentList({ id, thread, more, toggle }: CommentListProps) {
  const list = thread.lists[id];
  if (!list) return null;
  return (
    <>
      {[...list.comments, ...(list.preview || [])].map((item, index) => (
        <div className="comment" key={item.id}>
          <div className="meta">
            <strong>{item.by || "익명"}</strong>
            <span>{since(item.time)}</span>
          </div>
          <p className="body-text">
            <TranslatedField item={item} field="text" />
          </p>
          {index < list.comments.length && !!item.kids?.length && (
            <details
              open={Boolean(thread.lists[item.id]?.open)}
              onToggle={(event) => {
                if (event.target === event.currentTarget) toggle(item.id, event.currentTarget.open);
              }}
            >
              <summary>답글 {item.kids.length}개</summary>
              <div className="replies">
                {thread.lists[item.id]?.open && (
                  <CommentList id={item.id} thread={thread} more={more} toggle={toggle} />
                )}
              </div>
            </details>
          )}
        </div>
      ))}
      {list.error ? (
        <p className="list-status">
          {list.error}
          <button type="button" className="retry" onClick={() => more(id)}>
            다시 시도
          </button>
        </p>
      ) : list.loading ? (
        !list.preview?.length && <p className="list-status">댓글을 불러오는 중…</p>
      ) : list.more ? (
        <Button variant="outline" className="more" onClick={() => more(id)}>
          댓글 더 보기
        </Button>
      ) : (
        !list.comments.length && <p className="empty">아직 표시할 댓글이 없습니다.</p>
      )}
    </>
  );
}
interface ArticleProps extends Omit<CommentListProps, "id"> {
  back: () => void;
}

export function Article({ thread, more, toggle, back }: ArticleProps) {
  const { item } = thread;
  const url = externalUrl(item.url);
  return (
    <article id="article">
      <div className="bar">
        <Button id="back" variant="ghost" size="sm" onClick={back}>
          ← 목록으로
        </Button>
        <LanguageButton />
      </div>
      <div id="story">
        <h2>
          <TranslatedField item={item} field="title" />
        </h2>
        <div className="meta">
          <span className="source">{url?.hostname.replace(/^www\./, "") || "Hacker News"}</span>
          {item.by && <span>{item.by}</span>}
          <span>{since(item.time)}</span>
          {item.score != null && <span>{numbers.format(item.score)}점</span>}
        </div>
        {item.text && (
          <p className="body-text">
            <TranslatedField item={item} field="text" />
          </p>
        )}
        <div className="external-links">
          {url && (
            <a href={url.href} target="_blank" rel="noreferrer">
              원문 기사 ↗
            </a>
          )}
          <a href={hnUrl(item.id)} target="_blank" rel="noreferrer">
            HN 토론 ↗
          </a>
        </div>
      </div>
      <section aria-labelledby="comments-heading">
        <h3 id="comments-heading">
          댓글{item.descendants != null && ` ${numbers.format(item.descendants)}`}
        </h3>
        <CommentList id={item.id} thread={thread} more={more} toggle={toggle} />
      </section>
    </article>
  );
}
