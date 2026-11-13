/**
 * The docked groups' tab strips scroll sideways when their tabs do not
 * fit (a phone's one group holds seven): what a finger on a tab means
 * there, and how far a strip moves to show a tab. The rule is pure
 * here; `wireStripScroll` applies it to the docking's strips.
 *
 * @see dock-strip.ts.md
 */

/** How far a finger moves (px) before a touch on a tab is a swipe or a
 *  drag rather than a tap or a hold: about Android's touch slop (8 dp)
 *  and more than the docking library's own press tolerance (8 px). */
export const STRIP_SLOP_PX = 10;

/** How long a finger rests on a tab (ms) before a move drags it: the
 *  docking library's own arming delay for a touch. */
export const STRIP_HOLD_MS = 250;

/** How far a finger moves (px) before it no longer rests on a tab: half
 *  the slop, above a resting finger's jitter. */
export const STRIP_REST_PX = STRIP_SLOP_PX / 2;

/**
 * When a finger left its rest on a tab: `ended` once it has (kept from
 * then), else `now` when this move (`dx`, `dy` from the touch, px) is
 * `restPx` or more out, else still resting (null). Nonsense changes
 * nothing.
 */
export function restEndedAt(
  ended: number | null,
  move: { readonly dx: number; readonly dy: number },
  now: number,
  restPx: number = STRIP_REST_PX,
): number | null {
  if (ended !== null) return ended;
  if (![move.dx, move.dy, now].every(Number.isFinite)) return null;
  return Math.hypot(move.dx, move.dy) >= restPx ? now : null;
}

/** What a touch on a tab is so far: still a tap or a hold, a swipe that
 *  scrolls the strip, or the docking library's (a tab drag). */
export type StripGesture = "undecided" | "scroll" | "drag";

/**
 * A finger moved by `dx`, `dy` (px) after resting `ms` on a tab of a
 * strip that scrolls (`canScroll`) or not. A quick move along the strip
 * scrolls it; a move across it, or one after a hold, drags the tab; under
 * the slop nothing is decided. A strip with nothing to scroll, or a move
 * that is not numbers, is the docking library's.
 */
export function stripGesture(
  move: { readonly dx: number; readonly dy: number; readonly ms: number },
  canScroll: boolean,
  slopPx: number = STRIP_SLOP_PX,
  holdMs: number = STRIP_HOLD_MS,
): StripGesture {
  const { dx, dy, ms } = move;
  if (!canScroll) return "drag";
  if (![dx, dy, ms].every(Number.isFinite)) return "drag";
  if (Math.hypot(dx, dy) < slopPx) return "undecided";
  if (ms >= holdMs) return "drag";
  return Math.abs(dx) > Math.abs(dy) ? "scroll" : "drag";
}

/** The strip's scroll (px) that shows a tab at `tab.start` of
 *  `tab.size` along a strip scrolled to `strip.scroll` showing
 *  `strip.size`: the least move, none for a tab in sight, the tab's start
 *  for one wider than the strip. Nonsense leaves the scroll. */
export function scrolledToShow(
  strip: { readonly scroll: number; readonly size: number },
  tab: { readonly start: number; readonly size: number },
): number {
  const { scroll, size } = strip;
  if (![scroll, size, tab.start, tab.size].every(Number.isFinite)) {
    return scroll;
  }
  if (size <= 0) return scroll;
  if (tab.start < scroll || tab.size > size) return tab.start;
  const end = tab.start + tab.size;
  if (end > scroll + size) return end - size;
  return scroll;
}

const STRIP = ".dv-tabs-container:not(.dv-tabs-container-vertical)";

/** Shows `tab` in its strip, if it stands in one. */
export function showTab(tab: Element): void {
  const strip = tab.parentElement;
  if (!(tab instanceof HTMLElement) || strip?.matches(STRIP) !== true) return;
  strip.scrollLeft = scrolledToShow(
    { scroll: strip.scrollLeft, size: strip.clientWidth },
    { start: tab.offsetLeft, size: tab.offsetWidth },
  );
}

/**
 * Every horizontal tab strip under `root` scrolls by a finger and follows
 * the keyboard: a swipe along a strip that overflows scrolls it (the
 * docking library's pending drag and hold are cancelled), a tap shows
 * its tab (`activate`), a pull across it or a move after a hold is the
 * library's tab drag; a tab that takes the focus is scrolled into sight.
 * The call it returns removes all that.
 */
export function wireStripScroll(
  root: HTMLElement,
  activate: (tab: HTMLElement) => void,
): () => void {
  const win = root.ownerDocument.defaultView ?? window;
  let touch: {
    readonly id: number;
    readonly tab: HTMLElement;
    readonly strip: HTMLElement;
    readonly x: number;
    readonly y: number;
    readonly at: number;
    readonly scroll: number;
    /** When it left its rest (`restEndedAt`). */
    moved: number | null;
    state: StripGesture;
  } | null = null;
  /** The cancel this module sends the docking's listeners, let through. */
  let cancelling = false;

  const onDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const at = event.target;
    const tab = at instanceof Element ? at.closest(".dv-tab") : null;
    const strip = tab?.parentElement;
    if (!(tab instanceof HTMLElement) || strip?.matches(STRIP) !== true) {
      return;
    }
    if (strip.scrollWidth <= strip.clientWidth) return;
    // A swipe must not show the tab it began on (the docking shows a
    // tab on the press): a tap shows it on its release instead.
    event.preventDefault();
    touch = {
      id: event.pointerId,
      tab,
      strip,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      scroll: strip.scrollLeft,
      moved: null,
      state: "undecided",
    };
  };
  const onMove = (event: PointerEvent) => {
    if (touch === null || event.pointerId !== touch.id || cancelling) return;
    const dx = event.clientX - touch.x;
    if (touch.state === "undecided") {
      const dy = event.clientY - touch.y;
      // A hold is the rest before the finger moved, not the time to the
      // slop: a slow swipe never rested.
      touch.moved = restEndedAt(touch.moved, { dx, dy }, event.timeStamp);
      const rested = (touch.moved ?? event.timeStamp) - touch.at;
      touch.state = stripGesture({ dx, dy, ms: rested }, true);
      if (touch.state === "drag") {
        // This move reaches the docking, past its tolerance: its drag.
        touch = null;
        return;
      }
      if (touch.state === "scroll") {
        cancelling = true;
        try {
          win.dispatchEvent(
            new PointerEvent("pointercancel", {
              pointerId: touch.id,
              pointerType: event.pointerType,
            }),
          );
        } finally {
          cancelling = false;
        }
      }
    }
    // Undecided or scrolling, the docking does not see the move.
    event.stopPropagation();
    if (touch.state === "scroll") touch.strip.scrollLeft = touch.scroll - dx;
  };
  const onUp = (event: PointerEvent) => {
    if (touch === null || event.pointerId !== touch.id || cancelling) return;
    const { tab, state } = touch;
    touch = null;
    if (event.type === "pointerup" && state === "undecided") activate(tab);
  };
  const onFocus = (event: FocusEvent) => {
    const at = event.target;
    if (at instanceof Element && at.matches(".dv-tab")) showTab(at);
  };

  root.addEventListener("pointerdown", onDown, true);
  win.addEventListener("pointermove", onMove, true);
  win.addEventListener("pointerup", onUp, true);
  win.addEventListener("pointercancel", onUp, true);
  root.addEventListener("focusin", onFocus);
  return () => {
    root.removeEventListener("pointerdown", onDown, true);
    win.removeEventListener("pointermove", onMove, true);
    win.removeEventListener("pointerup", onUp, true);
    win.removeEventListener("pointercancel", onUp, true);
    root.removeEventListener("focusin", onFocus);
  };
}
