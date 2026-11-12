/**
 * A phone's on-screen keyboard over the editor's panels: it lies over the
 * page without changing its size, so the page reads its height from the
 * visual viewport, gives it to the styles as `--s-keyboard-h` (a panel
 * stands on the keyboard) and `data-keyboard="up"`, and brings the field
 * in use into sight.
 *
 * @see phone-keyboard.ts.md
 */

/** Less than this at the foot is a browser's bar, not a keyboard. */
const LEAST_KEYBOARD_PX = 80;

const KEYBOARD_VAR = "--s-keyboard-h";

/** The keyboard's height from the visual viewport; 0 for none. A zoomed
 *  viewport is small for another reason. */
export function keyboardPx(
  innerHeight: number,
  viewport: {
    readonly height: number;
    readonly offsetTop: number;
    readonly scale: number;
  },
): number {
  if (viewport.scale > 1.01) return 0;
  const px = Math.round(innerHeight - viewport.height - viewport.offsetTop);
  return px >= LEAST_KEYBOARD_PX ? px : 0;
}

/** Watches the keyboard for the fields inside `host`; the call it returns
 *  stops that. `relayout` gets the keyboard's height each time it changed,
 *  before a field is brought into sight: panels laid out by script (the
 *  docked ones) take their new size first. */
export function watchKeyboard(
  win: Window,
  host: HTMLElement,
  relayout: (keyboardPx: number) => void = () => undefined,
): () => void {
  const viewport = win.visualViewport;
  if (viewport === null || viewport === undefined) return () => undefined;
  let up = false;
  /** What the keyboard covered when last read. Read off the viewport's
   *  height alone: a pan moves its offset, not the keyboard, and must not
   *  count as a keyboard that grew. */
  let shownCover = 0;
  let shownPx = 0;
  const scrollNow = () => {
    const field = host.ownerDocument.activeElement;
    if (up && field instanceof HTMLElement && host.contains(field)) {
      field.scrollIntoView({ block: "nearest" });
    }
  };
  /** Now, and again two frames later: the docked panels' contents are
   *  placed a frame after their groups are laid out. */
  let laterPending = false;
  const inSight = () => {
    scrollNow();
    if (laterPending || typeof win.requestAnimationFrame !== "function") return;
    laterPending = true;
    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => {
        laterPending = false;
        scrollNow();
      });
    });
  };
  const update = () => {
    const px = keyboardPx(win.innerHeight, viewport);
    const { body } = host.ownerDocument;
    const cover = Math.round(win.innerHeight - viewport.height);
    const grew = cover > shownCover;
    shownCover = cover;
    up = px > 0;
    if (up) {
      body.style.setProperty(KEYBOARD_VAR, `${String(px)}px`);
      body.dataset["keyboard"] = "up";
    } else {
      body.style.removeProperty(KEYBOARD_VAR);
      delete body.dataset["keyboard"];
    }
    if (px !== shownPx) {
      shownPx = px;
      relayout(px);
    }
    // Come, or grown over the field (its suggestions, a phone turned).
    if (up && grew) inSight();
  };
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  host.addEventListener("focusin", inSight);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    host.removeEventListener("focusin", inSight);
    host.ownerDocument.body.style.removeProperty(KEYBOARD_VAR);
    delete host.ownerDocument.body.dataset["keyboard"];
  };
}
