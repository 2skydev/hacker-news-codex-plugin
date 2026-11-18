import { flushSync } from "react-dom";

const READING_BLOCKS =
  ".row, #story > h2, #story > .body-text, #story > .external-links, .comment-content, .reply-toggle, .list-status, .comment-more";
const MOVING_BLOCKS = `${READING_BLOCKS}, #story > .meta, #comments-heading, #feed > .more`;

type TranslationScope = HTMLElement & {
  startViewTransition?: (update: () => void) => ViewTransition;
  activeViewTransition?: ViewTransition | null;
};

function inViewport({ top, bottom }: DOMRect) {
  return bottom > 0 && bottom > top && top < window.innerHeight;
}

function readingAnchor(reader: Element) {
  if (!window.scrollY) return;
  for (const element of reader.querySelectorAll(READING_BLOCKS)) {
    const rect = element.getBoundingClientRect();
    if (inViewport(rect)) return { element, top: rect.top };
  }
}

function applyAtReadingPosition(reader: Element, apply: () => void) {
  const anchor = readingAnchor(reader);
  flushSync(apply);
  if (!anchor?.element.isConnected) return;

  const { height, top } = anchor.element.getBoundingClientRect();
  if (!height) return;

  // Keep a line visible if a partially scrolled block shrinks past the viewport.
  const target = anchor.top + height <= 0 ? Math.min(0, 24 - height) : anchor.top;
  if (Math.abs(top - target) >= 1) window.scrollBy(0, top - target);
}

function visibleTranslations(scope: Element, changed: ReadonlySet<string>) {
  const texts: { element: HTMLElement; block: Element; original: HTMLSpanElement }[] = [];
  for (const element of scope.querySelectorAll<HTMLElement>("[data-pending-translation]")) {
    const key = element.dataset.pendingTranslation;
    if (!key || !changed.has(key) || !inViewport(element.getBoundingClientRect())) continue;

    const block = element.closest("h2, .body-text");
    const source = block?.firstElementChild;
    if (!block || !source?.contains(element)) continue;

    // Keep both texts in the same live snapshot so their first lines stay aligned.
    const copy = source.cloneNode(true) as Element;
    copy.querySelector("[data-pending-translation]")?.removeAttribute("data-pending-translation");
    const original = document.createElement("span");
    original.className = "translation-outgoing";
    original.inert = true;
    original.setAttribute("aria-hidden", "true");
    original.append(copy);
    texts.push({ element, block, original });
  }
  return texts;
}

export async function revealTranslations(
  changed: ReadonlySet<string>,
  apply: () => void,
  signal: AbortSignal,
) {
  const reader = document.querySelector("main.reader");
  if (!reader || !changed.size) {
    apply();
    return true;
  }

  const scope = reader.querySelector<TranslationScope>("div:not([hidden]) > :is(#feed, #article)");
  if (scope?.activeViewTransition) await scope.activeViewTransition.finished.catch(() => {});
  if (signal.aborted) return false;

  if (
    !scope?.startViewTransition ||
    document.hidden ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    applyAtReadingPosition(reader, apply);
    return true;
  }

  const texts = visibleTranslations(scope, changed);
  if (!texts.length) {
    applyAtReadingPosition(reader, apply);
    return true;
  }

  const parts = new Map<Element, "layout" | "text">();
  for (const element of scope.querySelectorAll(MOVING_BLOCKS)) {
    if (inViewport(element.getBoundingClientRect())) parts.set(element, "layout");
  }
  for (const { block } of texts) {
    parts.set(block, "text");
    const metadata = block.closest(".row")?.querySelector(".meta");
    if (metadata) parts.set(metadata, "layout");
  }

  for (const [element, part] of parts) element.setAttribute("data-translation-part", part);
  scope.setAttribute("data-translation-view", "");

  let applied = false;
  const transition = scope.startViewTransition(() => {
    if (signal.aborted || !scope.isConnected || scope.closest("[hidden]")) {
      transition.skipTransition();
      return;
    }

    const top = scope.getBoundingClientRect().top;
    applyAtReadingPosition(reader, apply);
    applied = true;

    for (const { element, block, original } of texts) {
      if (
        !block.contains(element) ||
        !element.isConnected ||
        element.hasAttribute("data-pending-translation")
      )
        continue;
      element.setAttribute("data-translation-incoming", "");
      block.append(original);
    }

    // Snapshots use the scope's coordinates and its origin moves when we restore scroll.
    const offset = top - scope.getBoundingClientRect().top;
    scope.style.setProperty("--translation-scroll-offset", `${offset}px`);
  });

  function clearParts() {
    for (const element of parts.keys()) element.removeAttribute("data-translation-part");
  }
  function clearScope() {
    scope?.removeAttribute("data-translation-view");
    scope?.removeAttribute("data-translation-playing");
    scope?.style.removeProperty("--translation-scroll-offset");
    for (const { element, original } of texts) {
      element.removeAttribute("data-translation-incoming");
      original.remove();
    }
  }
  transition.ready.then(() => {
    clearParts();
    scope.setAttribute("data-translation-playing", "");
  }, clearParts);
  transition.finished.then(clearScope, clearScope);
  await transition.updateCallbackDone;
  return applied;
}
