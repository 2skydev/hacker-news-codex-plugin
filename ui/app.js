import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

import { bodyContent } from "./links.js";

const app = new App({ name: "hacker-news", version: "0.3.7" }, {}, { autoResize: false });
const $ = id => document.getElementById(id);
const usageUrl = "https://chatgpt.com/settings/usage";
const dates = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
const numbers = new Intl.NumberFormat("ko");
const items = new Map();
let feed, selected, connection, bilingual = false, ready = false;
let account = null, accountBusy = false, loginUrl = "";
let checkingAccount = false, blocked = "", translatingView = null, translationTimer;
let noticeState, hideProgressTimer, updatedAtTimer;
let realtime = true, preferredModel;
let accountVersion = 0, watchRequest, watchTimer;
const attempted = new Set();
const progressSources = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, action, className = "") {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function httpUrl(value) {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) ? url : null;
}

function external(label, value, className) {
  const link = el("a", className, label);
  link.href = value;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function hnUrl(id) { return "https://news.ycombinator.com/item?id=" + id; }

function since(time) {
  const min = Math.max(0, Math.floor((Date.now() / 1000 - time) / 60));
  if (min < 1) return "방금";
  if (min < 60) return dates.format(-min, "minute");
  if (min < 1440) return dates.format(-Math.floor(min / 60), "hour");
  return dates.format(-Math.floor(min / 1440), "day");
}

const exactTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "long", timeStyle: "medium", hourCycle: "h23",
});
function renderUpdatedAt() {
  clearTimeout(updatedAtTimer);
  const time = $("updated-at"), stamp = feed?.snapshot?.updatedAt;
  time.hidden = Boolean(selected) || !Number.isFinite(stamp);
  if (time.hidden) return;
  const age = Math.max(0, Date.now() - stamp);
  const label = since(stamp / 1000) + " 갱신";
  if (time.textContent !== label) time.textContent = label;
  time.dateTime = new Date(stamp).toISOString();
  time.title = exactTime.format(stamp);
  const unit = age < 3600000 ? 60000 : age < 86400000 ? 3600000 : 86400000;
  updatedAtTimer = setTimeout(renderUpdatedAt, unit - age % unit);
}
function announce(message = "") {
  $("message").textContent = message;
  $("message").hidden = !message;
}

async function call(name, args = {}, signal) {
  if (!ready) await connection;
  const result = await app.callServerTool({ name, arguments: args }, { signal, timeout: name === "hn_translate" ? 180000 : 60000 });
  if (result.isError) throw new Error(result.content?.find(block => block.type === "text")?.text || "요청을 완료하지 못했습니다.");
  return result.structuredContent;
}

// A late local read must never overwrite the network response or its error state.
async function readWithPreview(tool, args, previewArgs, onPreview) {
  let pending = true;
  call("hn_preview", previewArgs).then(result => {
    if (pending) onPreview(result);
  }).catch(() => {}); // The live request also works without a local preview.
  try {
    return await call(tool, args);
  } finally {
    pending = false;
  }
}

function remember(item) {
  const old = items.get(item.id);
  if (old) {
    for (const field of ["title", "text"]) {
      if (item[field] !== old[field] || (old[field + "Ko"] && !item[field + "Ko"])) attempted.delete(field + ":" + item.id);
    }
  }
  items.set(item.id, item);
}

function showField(node) {
  const { id, field } = node.dataset;
  const item = items.get(Number(id));
  if (!item) return;
  const translated = item[field + "Ko"];
  const render = value => field === "text" ? bodyContent(value, item.links || [], external) : value;
  node.replaceChildren(render(translated || item[field] || ""));
  if (node.matches("a.story-title")) {
    const source = el("small", "title-domain", "(" + new URL(node.href).hostname.replace(/^www\./, "") + ")");
    source.title = node.href;
    node.append(" ", source);
  }
  node.lang = translated ? "ko" : "en";
  if (bilingual && translated && item[field] && translated !== item[field]) {
    const source = el("span", "original");
    source.append(render(item[field]));
    source.lang = "en";
    node.append(source);
  }
}

function bind(node, item, field) {
  node.dataset.id = item.id;
  node.dataset.field = field;
  showField(node);
  return node;
}

function languageControls() {
  for (const id of ["language", "article-language"]) {
    $(id).textContent = bilingual ? "영문 숨기기" : "영문 함께 보기";
    $(id).setAttribute("aria-pressed", String(bilingual));
  }
}

function updateLanguage() {
  for (const node of document.querySelectorAll("[data-field]")) showField(node);
  languageControls();
}

function requestTranslations() {
  clearTimeout(translationTimer);
  translationTimer = setTimeout(translateLoaded, 80);
}

function showProgress(done, total) {
  const indicator = $("translation-progress");
  indicator.max = total;
  indicator.value = done;
  indicator.style.setProperty("--fill", (done / total) + "turn");
  $("translation-count").textContent = done + "/" + total;
  $("translation-status").hidden = false;
}

function hideProgress() {
  clearTimeout(hideProgressTimer);
  $("translation-status").hidden = true;
  progressSources.clear();
}

function translationQueue() {
  const root = selected ? $("article") : $("stories");
  const pending = [];
  const seen = new Set();
  let done = 0;
  for (const node of root.querySelectorAll("[data-field]")) {
    if (node.closest("[data-preview]") || (selected && !node.checkVisibility())) continue;
    const field = node.dataset.field, id = Number(node.dataset.id);
    const item = items.get(id), source = item?.[field], key = field + ":" + id;
    if (!source || seen.has(key)) continue;
    if (item[field + "Ko"] && progressSources.get(key) !== source) continue;
    seen.add(key);
    progressSources.set(key, source);
    if (item[field + "Ko"]) done++;
    else if (!attempted.has(key)) pending.push({ id, field, source, key });
  }
  return { done, total: seen.size, pending };
}

async function translateLoaded() {
  const view = selected || feed;
  if (!account?.connected || blocked || document.hidden || selected?.opening || (!selected && !feed.revision)) return;
  if (translatingView && translatingView !== view) return;
  const { done, total, pending } = translationQueue();
  if (!pending.length) return;
  clearTimeout(hideProgressTimer);
  showProgress(done, total);
  if (translatingView) return;

  const field = pending[0].field;
  const batch = pending.filter(job => job.field === field).slice(0, field === "title" ? 5 : 3);
  const version = accountVersion;
  translatingView = view;
  try {
    batch.forEach(job => attempted.add(job.key));
    const result = await call("hn_translate", { field, ids: batch.map(job => job.id) });
    if (version !== accountVersion) return;
    const output = new Map(result.items.map(row => [row.id, row.text]));
    for (const job of batch) {
      const item = items.get(job.id);
      if (item?.[field] === job.source && output.has(job.id)) item[field + "Ko"] = output.get(job.id);
    }
    if (result.status === "disconnected") account = { connected: false };
    else blocked = result.status || (batch.some(job => !output.has(job.id)) ? "error" : "");
    updateLanguage();
    if (view === (selected || feed) && account.connected && !blocked) {
      const next = translationQueue();
      if (next.total) showProgress(next.done, next.total);
      if (!next.pending.length) hideProgressTimer = setTimeout(hideProgress, 550);
    }
  } catch {
    if (version === accountVersion) blocked = "error";
  } finally {
    translatingView = null;
    if (version !== accountVersion || blocked || !account?.connected) hideProgress();
    accountUi();
    requestTranslations();
  }
}

function retryTranslation() {
  blocked = "";
  attempted.clear();
  accountUi();
  requestTranslations();
}

function accountUi() {
  const key = JSON.stringify([account?.connected, account?.pending, account?.error, loginUrl, blocked, accountBusy]);
  if (noticeState === key) return;
  noticeState = key;
  const notice = $("notice"), actions = $("notice-actions");
  let message = "";
  actions.replaceChildren();
  if (account?.pending || loginUrl) {
    message = "브라우저에서 ChatGPT 연결을 완료해 주세요.";
    if (loginUrl) actions.append(external("연결 화면 열기", loginUrl));
    actions.append(button("연결 취소", disconnect));
  } else if (blocked === "limited") {
    message = "ChatGPT 사용 한도에 도달했습니다. 새 번역은 잠시 멈춥니다.";
    actions.append(external("사용량 관리", usageUrl), button("다시 시도", retryTranslation));
  } else if (blocked === "error") {
    message = "일부 글을 번역하지 못해 원문을 표시합니다.";
    actions.append(button("번역 다시 시도", retryTranslation));
  } else if (account && !account.connected) {
    message = account.error || "ChatGPT를 연결하면 읽고 있는 글을 한국어로 번역합니다.";
    const start = button("ChatGPT로 계속하기", connect, "signin");
    start.prepend($("chatgpt-logo").content.cloneNode(true));
    start.disabled = accountBusy;
    actions.append(start);
  }
  $("notice-text").textContent = message;
  notice.hidden = !message;
}

async function syncPreferences() {
  try {
    const values = await call("hn_preferences");
    realtime = values.realtime;
    if (preferredModel !== undefined && preferredModel !== values.model) retryTranslation();
    preferredModel = values.model;
    if (realtime && feed?.pending && !selected) applyPending(feed);
  } catch { /* Retry on the next refresh. */ }
}

async function connect() {
  if (accountBusy) return;
  accountBusy = true;
  accountUi();
  announce();
  try {
    const result = await call("hn_connect");
    const url = httpUrl(result.url);
    if (!url || url.origin !== "https://auth.openai.com") throw new Error("로그인 주소를 확인하지 못했습니다.");
    loginUrl = url.href;
    account = { connected: false, pending: true };
    const opened = await app.openLink({ url: loginUrl });
    if (opened.isError) announce("연결 화면 열기를 눌러 로그인을 계속해 주세요.");
  } catch (error) {
    announce(loginUrl ? "연결 화면 열기를 눌러 로그인을 계속해 주세요." : error.message);
  } finally {
    accountBusy = false;
    accountUi();
    checkAccount();
  }
}

async function disconnect() {
  if (accountBusy) return;
  accountBusy = true;
  accountVersion++;
  accountUi();
  try {
    const result = await call("hn_disconnect");
    account = { connected: false };
    loginUrl = "";
    blocked = "";
    attempted.clear();
    announce(result.warning || "ChatGPT 연결을 해제했습니다.");
  } catch { announce("연결을 해제하지 못했습니다. 다시 시도해 주세요."); }
  finally { accountBusy = false; accountUi(); }
}

async function checkAccount() {
  if (checkingAccount || accountBusy || !ready || document.hidden) return;
  const version = accountVersion;
  checkingAccount = true;
  try {
    const before = account?.connected, wasPending = Boolean(loginUrl || account?.pending);
    const result = await call("hn_account");
    if (version !== accountVersion || accountBusy) return;
    account = result;
    if (!result.pending || result.connected) loginUrl = "";
    if (before !== result.connected) {
      accountVersion++;
      attempted.clear();
      blocked = "";
    }
    if (wasPending && result.connected) announce("ChatGPT를 연결했습니다. 번역은 연결한 플랜의 사용량에 포함됩니다.");
    accountUi();
    requestTranslations();
  } catch {
    if (!account) announce("ChatGPT 연결 상태를 확인하지 못했습니다. 리더를 다시 열어 주세요.");
  } finally { checkingAccount = false; }
}

function row(item, rank) {
  const li = el("li", "row"), body = el("div");
  const number = el("span", "rank", String(rank).padStart(2, "0"));
  number.setAttribute("aria-hidden", "true");
  const url = httpUrl(item.url);
  const heading = el("h2");
  const title = url
    ? external("", url.href, "story-title")
    : button("", event => openStory(item.id, event.currentTarget), "story-title");
  title.id = "title-" + item.id;
  heading.append(bind(title, item, "title"));
  const meta = el("div", "meta");
  if (item.score != null) meta.append(el("span", "score", numbers.format(item.score) + "점"));
  meta.append(el("span", "", since(item.time)));
  if (item.descendants != null) meta.append(button("댓글 " + numbers.format(item.descendants), event => openStory(item.id, event.currentTarget), "count"));
  body.append(heading, meta);
  li.append(number, body);
  return li;
}

function feedStatus(text = "", retry) {
  const status = $("feed-status");
  status.replaceChildren();
  if (text) status.append(el("span", "", text));
  if (retry) status.append(button("다시 시도", retry, "retry"));
  status.hidden = !text;
}

function freshFeed(sort) {
  return { sort, ids: [], head: [], next: 0, more: false, pending: null, loading: false, revision: "" };
}

function storePreview(state) {
  if (!state?.snapshot) return;
  const { items: stories, nextOffset, hasMore } = state.snapshot;
  // Persist only the public list. Bodies, comments and account information stay out of this snapshot.
  const entries = stories.map(({ id, type, title, url, by, time, score, descendants }) =>
    ({ id, type, title, url, by, time, score, descendants }));
  try {
    localStorage.setItem("hn-ko-feed-v2-" + state.sort, JSON.stringify({ items: entries, nextOffset, hasMore, updatedAt: state.snapshot.updatedAt }));
  } catch { /* The live feed remains available when the host disables storage. */ }
}

function readPreview(sort) {
  try {
    localStorage.removeItem("hn-ko-feed-v1-" + sort);
    const page = JSON.parse(localStorage.getItem("hn-ko-feed-v2-" + sort));
    if (Array.isArray(page?.items) && page.items.length > 0 && page.items.length <= 20 &&
        page.items.every(item => Number.isSafeInteger(item?.id) && typeof item.title === "string" && Number.isFinite(item.time)) &&
        Number.isInteger(page.nextOffset) && typeof page.hasMore === "boolean") return page;
  } catch { /* Ignore an unavailable or incomplete snapshot. */ }
  return null;
}

function renderUpdates() {
  const pending = feed.pending, control = $("updates");
  control.hidden = !pending;
  if (pending) {
    const count = pending.items.filter(item => !feed.ids.includes(item.id)).length;
    control.textContent = count ? "새 글 " + count + "개 보기 ↑" : "바뀐 순위 보기 ↑";
  }
}

function applyPage(state, page, replace) {
  if (replace) {
    state.ids = [];
    state.snapshot = page;
    state.revision = page.revision;
    state.head = page.items.map(item => item.id);
    state.pending = null;
    $("stories").replaceChildren();
  }
  for (const item of page.items) {
    remember(item);
    if (state.ids.includes(item.id)) continue;
    state.ids.push(item.id);
    $("stories").append(row(item, state.ids.length));
  }
  state.next = page.nextOffset;
  state.more = page.hasMore;
  $("more").hidden = !state.more;
  feedStatus(state.ids.length ? "" : "표시할 글이 없습니다.");
  renderUpdates();
  renderUpdatedAt();
  if (page.revision) storePreview(state);
  requestTranslations();
}

function applyPending(state, continuation = []) {
  const firstVisible = [...$("stories").children].find(row => row.getBoundingClientRect().top >= 0);
  const anchor = window.scrollY > 0 && firstVisible?.querySelector(".story-title");
  const before = anchor && anchor.getBoundingClientRect().top;
  const activeId = document.activeElement?.id;
  applyPage(state, state.pending, true);
  for (const page of continuation) applyPage(state, page, false);
  if (activeId) $(activeId)?.focus({ preventScroll: true });
  const after = anchor && $(anchor.id);
  if (after) window.scrollBy(0, after.getBoundingClientRect().top - before);
}

function showFeedPreview(state, mode, saved) {
  const previewRows = [];
  if (state !== feed) return previewRows;
  if (saved.titles) {
    for (const { id, title, titleKo } of saved.titles) {
      const item = items.get(id), node = $("title-" + id);
      if (!node || item?.title !== title || !titleKo) continue;
      item.titleKo = titleKo;
      showField(node);
    }
  } else if (saved.page && mode === "more" && saved.page.revision === state.revision) {
    for (const item of saved.page.items) {
      if (state.ids.includes(item.id)) continue;
      remember(item);
      const node = row(item, state.ids.length + previewRows.length + 1);
      node.dataset.preview = "";
      previewRows.push(node);
      $("stories").append(node);
    }
  } else if (saved.page && mode === "first") {
    applyPage(state, { ...saved.page, revision: "", updatedAt: saved.updatedAt }, true);
    feedStatus("저장된 글을 표시하고 있습니다. 새 글을 확인하는 중…");
  }
  return previewRows;
}

async function loadPage(state, mode, preferencesReady) {
  if (state.loading) return;
  state.loading = true;
  if (mode === "first") feedStatus("글을 불러오는 중…");
  $("more").disabled = true;
  const args = { sort: state.sort, offset: mode === "more" ? state.next : 0, limit: 20 };
  let previewRows = [];
  try {
    const titles = mode === "warm" && state.snapshot?.items.map(({ id, title }) => ({ id, title }));
    const read = mode === "poll" ? call("hn_feed", args) :
      readWithPreview("hn_feed", args, titles ? { ...args, titles } : args, saved => {
        previewRows = showFeedPreview(state, mode, saved);
      });
    const [page] = await Promise.all([read.finally(() => previewRows.forEach(node => node.remove())), preferencesReady]);
    if (feed !== state) return;
    page.updatedAt = Date.now();
    if (mode === "poll" || mode === "warm" || (mode === "first" && state.snapshot)) {
      const firstLivePage = !state.revision;
      const changedHead = page.items.map(item => item.id).join() !== state.head.join();
      const continuation = [];
      if (realtime && changedHead && !selected) {
        // Refresh the loaded depth too, so a live reranking keeps the reader's place.
        let cursor = page;
        while (cursor.hasMore && cursor.nextOffset < state.next) {
          cursor = await call("hn_feed", { sort: state.sort, offset: cursor.nextOffset, limit: Math.min(50, state.next - cursor.nextOffset) });
          if (state !== feed || cursor.revision !== page.revision) return;
          continuation.push(cursor);
        }
      }
      if (!changedHead) {
        const previous = state.snapshot;
        const fields = ["title", "url", "time", "score", "descendants"];
        const unchanged = page.items.every((item, index) =>
          fields.every(field => item[field] === previous?.items[index]?.[field]));
        if (unchanged && Number.isFinite(previous?.updatedAt)) page.updatedAt = previous.updatedAt;
        state.snapshot = page;
      }
      state.revision = page.revision;
      for (const item of page.items) {
        const title = $("title-" + item.id);
        if (!title) continue;
        const old = items.get(item.id);
        remember(item);
        const listRow = title.closest(".row");
        if (old?.url !== item.url) {
          listRow.replaceWith(row(item, state.ids.indexOf(item.id) + 1));
          continue;
        }
        showField(title);
        const score = listRow.querySelector(".score"), count = listRow.querySelector(".count");
        if (score && item.score != null) score.textContent = numbers.format(item.score) + "점";
        if (count && item.descendants != null) count.textContent = "댓글 " + numbers.format(item.descendants);
      }
      requestTranslations();
      state.pending = changedHead ? page : null;
      if (state.pending && realtime && !selected) applyPending(state, continuation);
      storePreview(state);
      renderUpdatedAt();
      renderUpdates();
      if (!state.pending && state.ids.length === state.head.length) {
        state.next = page.nextOffset;
        state.more = page.hasMore;
        $("more").hidden = !state.more;
      }
      if (firstLivePage) { feedStatus(); watchSoon(); }
      return;
    }
    applyPage(state, page, mode === "first");
    if (mode === "first") watchSoon();
  } catch {
    if (feed === state && mode !== "poll") {
      const text = mode === "warm" ? "저장된 목록입니다. 새 글을 확인하지 못했습니다." : "글을 불러오지 못했습니다.";
      feedStatus(text, () => loadPage(state, mode));
    }
  } finally {
    state.loading = false;
    if (feed === state) $("more").disabled = false;
  }
}

function changeSort(sort) {
  if (feed?.sort === sort) return;
  hideProgress();
  stopWatch();
  feed = freshFeed(sort);
  renderUpdatedAt();
  document.querySelectorAll("[data-sort]").forEach(node => node.setAttribute("aria-pressed", String(node.dataset.sort === sort)));
  $("stories").replaceChildren();
  $("updates").hidden = $("more").hidden = true;
  const cached = readPreview(sort);
  if (cached) {
    applyPage(feed, cached, true);
    $("more").disabled = !ready;
    feedStatus("저장된 글을 표시하고 있습니다. 새 글을 확인하는 중…");
  } else feedStatus("글을 불러오는 중…");
  if (ready) loadPage(feed, cached ? "warm" : "first");
}

function articleHeader(item) {
  const title = bind(el("h2"), item, "title");
  const meta = el("div", "meta");
  const url = httpUrl(item.url);
  meta.append(el("span", "source", url?.hostname.replace(/^www\./, "") || "Hacker News"));
  if (item.by) meta.append(el("span", "", item.by));
  meta.append(el("span", "", since(item.time)));
  if (item.score != null) meta.append(el("span", "", numbers.format(item.score) + "점"));
  const nodes = [title, meta];
  if (item.text) nodes.push(bind(el("p", "body-text"), item, "text"));
  const links = el("div", "external-links");
  if (url) links.append(external("원문 기사 ↗", url.href));
  links.append(external("HN 토론 ↗", hnUrl(item.id)));
  nodes.push(links);
  $("story").replaceChildren(...nodes);
  $("comments-heading").textContent = "댓글" + (item.descendants != null ? " " + numbers.format(item.descendants) : "");
}

function comment(item, preview = false) {
  const container = el("div", "comment"), meta = el("div", "meta");
  meta.append(el("strong", "", item.by || "익명"), el("span", "", since(item.time)));
  container.append(meta, bind(el("p", "body-text"), item, "text"));
  if (!preview && item.kids?.length) {
    const details = el("details"), replies = el("div", "replies");
    details.append(el("summary", "", "답글 " + item.kids.length + "개"), replies);
    let started = false;
    details.addEventListener("toggle", () => {
      if (details.open && !started) {
        started = true;
        loadComments(replies, item.id);
      }
      if (details.open) requestTranslations();
    });
    container.append(details);
  }
  return container;
}

async function loadComments(target, id, offset = 0, root = false) {
  const status = el("div", "list-status", "댓글을 불러오는 중…");
  target.append(status);
  const context = selected;
  try {
    const args = { id, offset, limit: 8 };
    const page = await readWithPreview("hn_story", args, args, ({ page: saved }) => {
      if (!saved || selected !== context || !target.isConnected) return;
      if (root && saved.item.title === items.get(id)?.title) {
        remember(saved.item);
        articleHeader(saved.item);
      }
      if (!saved.comments.length) return;
      status.dataset.preview = "";
      status.className = "";
      status.replaceChildren(...saved.comments.map(item => {
        remember(item);
        return comment(item, true);
      }));
    });
    if (context !== selected || !target.isConnected) return;
    status.remove();
    remember(page.item);
    if (root) { context.opening = false; articleHeader(page.item); }
    for (const item of page.comments) {
      remember(item);
      const node = comment(item);
      target.append(node);
    }
    if (page.hasMore) {
      const more = button("댓글 더 보기", () => {
        more.remove();
        loadComments(target, id, page.nextOffset);
      }, "more");
      target.append(more);
    } else if (!target.childElementCount) target.append(el("p", "empty", "아직 표시할 댓글이 없습니다."));
    requestTranslations();
  } catch {
    if (context !== selected || !target.isConnected) return;
    if (root) { context.opening = false; requestTranslations(); }
    status.className = "list-status";
    status.textContent = "글이나 댓글을 불러오지 못했습니다. ";
    status.append(button("다시 시도", () => {
      status.remove();
      loadComments(target, id, offset, root);
    }, "retry"));
  }
}

function openStory(id, trigger) {
  hideProgress();
  stopWatch();
  selected = { id, trigger, scroll: window.scrollY, opening: true };
  renderUpdatedAt();
  $("feed").hidden = true;
  $("article").hidden = false;
  $("comments").replaceChildren();
  articleHeader(items.get(id));
  $("back").focus();
  window.scrollTo(0, 0);
  loadComments($("comments"), id, 0, true);
}

function returnToFeed() {
  hideProgress();
  const previous = selected;
  selected = null;
  renderUpdatedAt();
  $("article").hidden = true;
  $("feed").hidden = false;
  $("comments").replaceChildren();
  if (realtime && feed.pending) applyPending(feed);
  previous.trigger?.focus({ preventScroll: true });
  window.scrollTo(0, previous.scroll);
  watchSoon();
  requestTranslations();
}

function applyHost(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  const insets = context?.safeAreaInsets;
  if (insets) for (const side of ["top", "right", "bottom", "left"]) {
    document.documentElement.style.setProperty("--safe-" + side, (insets[side] ?? 0) + "px");
  }
}

function stopWatch() {
  clearTimeout(watchTimer);
  watchRequest?.abort();
}

function watchSoon(delay = 0) {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(watchFeed, delay);
}

async function watchFeed() {
  if (watchRequest || document.hidden || selected || !feed?.revision) return;
  const state = feed, controller = new AbortController();
  watchRequest = controller;
  let delay = 30000;
  try {
    const result = await call("hn_watch", { sort: state.sort, revision: state.revision }, controller.signal);
    if (state !== feed || !result.live || controller.signal.aborted) return;
    if (result.changed) {
      const previous = state.revision;
      await loadPage(state, "poll");
      // A failed refresh or an overlapping page request must not spin on the old revision.
      delay = state.revision === previous ? 3000 : 150;
    } else delay = 150;
  } catch {
    // The periodic feed refresh also works when streaming is unavailable.
  } finally {
    watchRequest = undefined;
    watchSoon(controller.signal.aborted ? 0 : delay);
  }
}

async function refresh() {
  if (document.hidden) { stopWatch(); return; }
  if (!ready) return;
  await syncPreferences();
  if (!selected && feed?.head.length) loadPage(feed, "poll");
  checkAccount();
  requestTranslations();
}

for (const id of ["language", "article-language"]) $(id).addEventListener("click", () => {
  bilingual = !bilingual;
  updateLanguage();
  requestTranslations();
});
for (const node of document.querySelectorAll("[data-sort]")) node.addEventListener("click", () => changeSort(node.dataset.sort));
$("more").addEventListener("click", () => loadPage(feed, "more"));
$("updates").addEventListener("click", () => {
  if (feed.pending) applyPage(feed, feed.pending, true);
  $("stories").querySelector(".story-title")?.focus();
});
$("back").addEventListener("click", returnToFeed);
document.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (!link || !app.getHostCapabilities()?.openLinks || !httpUrl(link.href)) return;
  event.preventDefault();
  app.openLink({ url: link.href }).then(result => {
    if (result.isError) announce("링크를 열지 못했습니다.");
  }).catch(() => announce("링크를 열지 못했습니다."));
});
document.addEventListener("visibilitychange", () => { refresh(); if (!document.hidden) watchSoon(); });
window.addEventListener("focus", () => { if (ready) { checkAccount(); syncPreferences(); } });
app.onhostcontextchanged = applyHost;
app.ontoolresult = result => {
  if (result.isError) announce("리더를 여는 중 오류가 발생했습니다.");
};
changeSort("top");
connection = app.connect();
connection.then(() => {
  applyHost(app.getHostContext());
  ready = true;
  checkAccount();
  loadPage(feed, feed.ids.length ? "warm" : "first", syncPreferences());
  setInterval(refresh, 30000);
  setInterval(() => { if (account?.pending || loginUrl) checkAccount(); }, 1800);
}).catch(() => feedStatus("Codex에 연결하지 못했습니다. 사이드바에서 리더를 다시 열어 주세요."));
