export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const ROW_MOTION = "feed-row-";
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface FeedRowPosition {
  rect: DOMRect;
  opacity: number;
}

export function canAnimateFeed() {
  return !document.hidden && !window.matchMedia(REDUCED_MOTION).matches;
}

export function cancelFeedAnimations() {
  const animations = document.getElementById("feed")?.getAnimations({ subtree: true }) ?? [];
  for (const animation of animations) {
    if (animation.id.startsWith(ROW_MOTION)) animation.cancel();
  }
  document.getElementById("feed-exits")?.replaceChildren();
}

export function playFeedAnimations(positions: Map<HTMLLIElement, FeedRowPosition>) {
  const viewport = window.innerHeight;
  const visible = (rect: DOMRect) => rect.bottom > 0 && rect.top < viewport;
  const enters: HTMLLIElement[] = [];
  const moves: { row: HTMLLIElement; offset: number; opacity: number }[] = [];

  for (const row of document.querySelectorAll<HTMLLIElement>("#stories > .row")) {
    const after = row.getBoundingClientRect();
    const before = positions.get(row);
    if (!before) {
      if (visible(after)) enters.push(row);
      continue;
    }
    if (!visible(before.rect) && !visible(after)) continue;
    const offset = before.rect.top - after.top;
    if (Math.abs(offset) >= 1 || before.opacity < 1) {
      moves.push({ row, offset, opacity: before.opacity });
    }
  }

  const exitLayer = document.getElementById("feed-exits");
  const layerRect = exitLayer?.getBoundingClientRect();

  for (const row of enters) {
    row.animate(
      { opacity: [0, 1], transform: ["translateY(-6px)", "none"] },
      {
        id: `${ROW_MOTION}enter`,
        duration: 180,
        easing: EASE_OUT,
      },
    );
  }
  for (const { row, offset, opacity } of moves) {
    row.animate(
      { opacity: [opacity, 1], transform: [`translateY(${offset}px)`, "none"] },
      { id: `${ROW_MOTION}move`, duration: 220, easing: EASE_OUT },
    );
  }

  if (!exitLayer || !layerRect) return;
  for (const [row, { rect, opacity }] of positions) {
    if (row.isConnected || !visible(rect)) continue;
    // Leave the live list immediately and fade a non-interactive copy in place.
    const snapshot = row.cloneNode(true) as HTMLLIElement;
    snapshot.removeAttribute("id");
    Object.assign(snapshot.style, {
      position: "absolute",
      top: `${rect.top - layerRect.top}px`,
      left: `${rect.left - layerRect.left}px`,
      width: `${rect.width}px`,
    });
    exitLayer.append(snapshot);
    const animation = snapshot.animate(
      { opacity: [opacity, 0], transform: ["none", "translateY(-6px)"] },
      { id: `${ROW_MOTION}exit`, duration: 130, easing: EASE_OUT, fill: "forwards" },
    );
    animation.onfinish = () => snapshot.remove();
  }
}
