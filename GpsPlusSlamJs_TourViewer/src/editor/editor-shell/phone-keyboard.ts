/**
 * A phone's on-screen keyboard over the editor's panels: it lies over the
 * page without changing its size, so the page reads its height from the
 * visual viewport, gives it to the styles as `--s-keyboard-h` (a panel
 * stands on the keyboard) and brings the field in use into sight.
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
  const inSight = () => {
    const field = host.ownerDocument.activeElement;
    if (up && field instanceof HTMLElement && host.contains(field)) {
      field.scrollIntoView({ block: "nearest" });
    }
  };
  const update = () => {
    const px = keyboardPx(win.innerHeight, viewport);
    const { style } = host.ownerDocument.body;
    const was = up;
    up = px > 0;
    if (up) style.setProperty(KEYBOARD_VAR, `${String(px)}px`);
    else style.removeProperty(KEYBOARD_VAR);
    if (up && !was) inSight();
  };
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  host.addEventListener("focusin", inSight);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    host.removeEventListener("focusin", inSight);
    host.ownerDocument.body.style.removeProperty(KEYBOARD_VAR);
  };
}
