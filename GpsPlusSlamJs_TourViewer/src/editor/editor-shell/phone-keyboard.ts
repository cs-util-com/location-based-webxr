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
 *  stops that. */
export function watchKeyboard(win: Window, host: HTMLElement): () => void {
  const viewport = win.visualViewport;
  if (viewport === null || viewport === undefined) return () => undefined;
  let up = false;
  /** The keyboard's height last read; 0 for none. */
  let shownPx = 0;
  const inSight = () => {
    const field = host.ownerDocument.activeElement;
    if (up && field instanceof HTMLElement && host.contains(field)) {
      field.scrollIntoView({ block: "nearest" });
    }
  };
  const update = () => {
    const px = keyboardPx(win.innerHeight, viewport);
    const { body } = host.ownerDocument;
    const grew = px > shownPx;
    shownPx = px;
    up = px > 0;
    if (up) {
      body.style.setProperty(KEYBOARD_VAR, `${String(px)}px`);
      body.dataset["keyboard"] = "up";
    } else {
      body.style.removeProperty(KEYBOARD_VAR);
      delete body.dataset["keyboard"];
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
