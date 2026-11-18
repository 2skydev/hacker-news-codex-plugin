import { ArrowUpRightIcon, CircleMinusIcon, CirclePlusIcon } from "lucide-react";
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

  const root = id === thread.item.id;
  const comments = [...list.comments, ...(list.preview || [])];

  return (
    <>
      {comments.length > 0 && (
        // biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics when list markers are removed.
        <ul className={root ? "comment-list root-comments" : "comment-list"} role="list">
          {comments.map((item, index) => {
            const author = item.by || "익명";
            const age = since(item.time);
            const repliesOpen = Boolean(thread.lists[item.id]?.open);
            const ReplyIcon = repliesOpen ? CircleMinusIcon : CirclePlusIcon;

            return (
              <li className="comment" key={item.id}>
                <div className="comment-content">
                  <div className="comment-header">
                    <span className="comment-avatar" aria-hidden="true">
                      {author.charAt(0).toUpperCase()}
                    </span>
                    <div className="comment-meta">
                      <strong>{author}</strong>
                      {item.by && item.by === thread.item.by && (
                        <span className="comment-author-badge">글쓴이</span>
                      )}
                      <a
                        className="comment-link"
                        href={hnUrl(item.id)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${author} 댓글 원문 보기 (${age})`}
                      >
                        <time dateTime={new Date(item.time * 1000).toISOString()}>{age}</time>
                        <ArrowUpRightIcon aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                  <p className="body-text">
                    <TranslatedField item={item} field="text" />
                  </p>
                </div>
                {index < list.comments.length && !!item.kids?.length && (
                  <details
                    className="comment-disclosure"
                    open={repliesOpen}
                    onToggle={(event) => {
                      if (event.target === event.currentTarget) {
                        toggle(item.id, event.currentTarget.open);
                      }
                    }}
                  >
                    <summary
                      className="reply-toggle"
                      aria-label={repliesOpen ? "답글 접기" : undefined}
                    >
                      <ReplyIcon aria-hidden="true" />
                      {!repliesOpen && <span>답글 {numbers.format(item.kids.length)}개</span>}
                    </summary>
                    {repliesOpen && (
                      <div className="replies">
                        <CommentList id={item.id} thread={thread} more={more} toggle={toggle} />
                      </div>
                    )}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.error ? (
        <p className="list-status" role="status">
          {list.error}
          <button type="button" className="retry" onClick={() => more(id)}>
            다시 시도
          </button>
        </p>
      ) : list.loading ? (
        !list.preview?.length && (
          <p className="list-status" role="status">
            {root ? "댓글을 불러오는 중…" : "답글을 불러오는 중…"}
          </p>
        )
      ) : list.more ? (
        <Button variant="outline" size="sm" className="comment-more" onClick={() => more(id)}>
          {root ? "댓글 더 보기" : "답글 더 보기"}
        </Button>
      ) : (
        !list.comments.length && (
          <p className="list-status" role="status">
            {root ? "아직 표시할 댓글이 없습니다." : "표시할 답글이 없습니다."}
          </p>
        )
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
      <section className="discussion" aria-labelledby="comments-heading">
        <h3 id="comments-heading">
          댓글
          {item.descendants != null && (
            <span className="comment-count">{numbers.format(item.descendants)}개</span>
          )}
        </h3>
        <CommentList id={item.id} thread={thread} more={more} toggle={toggle} />
      </section>
    </article>
  );
}
