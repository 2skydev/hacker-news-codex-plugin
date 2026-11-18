import { createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import { bodyContent } from "./links.js";

import type { Item, Field as TextField, Translation, Sort } from "./types";
import type { useFeed } from "./feed";
import type { useDiscussion } from "./discussion";
type OpenStory = (item: Item, trigger: HTMLButtonElement) => void;
type Discussion = ReturnType<typeof useDiscussion>;
export const Language = createContext<{ bilingual: boolean; toggle: () => void; translation: Translation }>({
  bilingual: false, toggle: () => {}, translation: () => undefined,
});
const dates = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
const numbers = new Intl.NumberFormat("ko");
export function since(time: number) {
  const min = Math.max(0, Math.floor((Date.now() / 1000 - time) / 60));
  if (min < 1) return "방금";
  if (min < 60) return dates.format(-min, "minute");
  if (min < 1440) return dates.format(-Math.floor(min / 60), "hour");
  return dates.format(-Math.floor(min / 1440), "day");
}


const hnUrl = (id: number) => "https://news.ycombinator.com/item?id=" + id;
function externalUrl(value?: string) {
  const url = value ? URL.parse(value) : null;
  return url && ["https:", "http:"].includes(url.protocol) ? url : null;
}
function Body({ value, links }: { value: string; links?: string[] }) {
  let index = 0;
  return bodyContent(value, links || [], (label, href) => <a key={index++} href={href} target="_blank" rel="noreferrer">{label}</a>);
}
function Field({ item, field, domain }: { item: Item; field: TextField; domain?: string | null }) {
  const { bilingual, translation } = useContext(Language);
  const ko = translation(item, field), en = item[field];
  const render = (value: string) => field === "text" ? <Body value={value} links={item.links} /> : value;
  return <span lang={ko ? "ko" : "en"}>{render(ko || en || "")}
    {domain && <> <small className="title-domain">{domain}</small></>}
    {bilingual && ko && en && ko !== en && <span className="original" lang="en">{render(en)}</span>}
  </span>;
}
function LanguageButton() {
  const { bilingual, toggle } = useContext(Language);
  return <Button size="sm" variant="ghost" aria-pressed={bilingual} onClick={toggle}>{bilingual ? "영문 숨기기" : "영문 함께 보기"}</Button>;
}
function Row({ item, index, open }: { item: Item; index: number; open: OpenStory }) {
  const url = externalUrl(item.url);
  const title = <Field item={item} field="title" domain={url && "(" + url.hostname.replace(/^www\./, "") + ")"} />;
  return <li className="row" id={"row-" + item.id}>
    <span className="rank" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
    <div><h2>{url ? <a className="story-title" href={url.href} target="_blank" rel="noreferrer">{title}</a> :
      <button className="story-title" onClick={e => open(item, e.currentTarget)}>{title}</button>}</h2>
      <div className="meta">{item.score != null && <span className="score">{numbers.format(item.score)}점</span>}
        <span>{since(item.time)}</span>{item.descendants != null &&
          <button className="count" onClick={e => open(item, e.currentTarget)}>댓글 {numbers.format(item.descendants)}</button>}
      </div>
    </div>
  </li>;
}
export function Feed({ feed, sort, changeSort, open, hostError }: { feed: ReturnType<typeof useFeed>; sort: Sort; changeSort: (sort: Sort) => void; open: OpenStory; hostError: string }) {
  const newCount = feed.pending?.items.filter(item => !feed.items.some(old => old.id === item.id)).length;
  return <section id="feed" aria-label="뉴스 피드">
    <div className="bar"><nav className="sort" aria-label="글 정렬">{([["top", "인기 글"], ["new", "최신 글"]] as const).map(([key, label]) =>
      <button key={key} aria-pressed={sort === key} onClick={() => changeSort(key)}>{label}</button>)}</nav><LanguageButton /></div>
    {feed.pending && <button className="updates" onClick={feed.applyPending}>{newCount ? "새 글 " + newCount + "개 보기 ↑" : "바뀐 순위 보기 ↑"}</button>}
    <ol id="stories" className="stories">{[...feed.items, ...feed.preview].map((item, i) => <Row key={item.id} item={item} index={i} open={open} />)}</ol>
    {(hostError || feed.error) ? <p className="empty" role="status">{hostError || feed.error}{!hostError && <button className="retry" onClick={() => feed.load(feed.retry)}>다시 시도</button>}</p> :
      !feed.items.length ? <p className="empty" role="status">{feed.revision && !feed.loading ? "표시할 글이 없습니다." : "글을 불러오는 중…"}</p> :
      !feed.revision && <p className="empty" role="status">저장된 글을 표시하고 있습니다. 새 글을 확인하는 중…</p>}
    {feed.more && <Button variant="outline" className="more" disabled={feed.loading} onClick={() => feed.load("more")}>글 더 보기</Button>}
  </section>;
}
function CommentList({ id, discussion }: { id: number; discussion: Discussion }) {
  const list = discussion.thread!.lists[id];
  if (!list) return null;
  return <>{[...list.comments, ...(list.preview || [])].map((item, index) =>
    <div className="comment" key={item.id}>
      <div className="meta"><strong>{item.by || "익명"}</strong><span>{since(item.time)}</span></div>
      <p className="body-text"><Field item={item} field="text" /></p>
      {index < list.comments.length && !!item.kids?.length &&
        <details open={Boolean(discussion.thread!.lists[item.id]?.open)} onToggle={event => {
          if (event.target === event.currentTarget) discussion.toggle(item.id, event.currentTarget.open);
        }}><summary>답글 {item.kids.length}개</summary><div className="replies">{discussion.thread!.lists[item.id]?.open && <CommentList id={item.id} discussion={discussion} />}</div></details>}
    </div>)}
    {list.error ? <p className="list-status">{list.error}<button className="retry" onClick={() => discussion.more(id)}>다시 시도</button></p> :
      list.loading ? !list.preview?.length && <p className="list-status">댓글을 불러오는 중…</p> :
      list.more ? <Button variant="outline" className="more" onClick={() => discussion.more(id)}>댓글 더 보기</Button> :
      !list.comments.length && <p className="empty">아직 표시할 댓글이 없습니다.</p>}
  </>;
}
export function Article({ discussion, back }: { discussion: Discussion; back: () => void }) {
  const { item } = discussion.thread!, url = externalUrl(item.url);
  return <article id="article"><div className="bar"><Button id="back" variant="ghost" size="sm" onClick={back}>← 목록으로</Button><LanguageButton /></div>
    <div id="story"><h2><Field item={item} field="title" /></h2>
      <div className="meta"><span className="source">{url?.hostname.replace(/^www\./, "") || "Hacker News"}</span>
        {item.by && <span>{item.by}</span>}<span>{since(item.time)}</span>{item.score != null && <span>{numbers.format(item.score)}점</span>}</div>
      {item.text && <p className="body-text"><Field item={item} field="text" /></p>}
      <div className="external-links">{url && <a href={url.href} target="_blank" rel="noreferrer">원문 기사 ↗</a>}
        <a href={hnUrl(item.id)} target="_blank" rel="noreferrer">HN 토론 ↗</a></div>
    </div><section aria-labelledby="comments-heading"><h3 id="comments-heading">댓글{item.descendants != null && " " + numbers.format(item.descendants)}</h3>
      <CommentList id={item.id} discussion={discussion} /></section>
  </article>;
}
