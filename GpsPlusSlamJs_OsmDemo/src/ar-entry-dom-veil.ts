import { ENTRY_VEIL_COLOUR } from "./ar-entry-veil.js";

/**
 * An opaque DOM layer over the AR overlay root, for the window a MESH cannot
 * cover.
 *
 * **WHY A SECOND VEIL EXISTS AT ALL.** `ar-entry-veil.ts` puts an inside-out
 * sphere in the scene and it works — a field session confirmed the black and
 * the fade on a real phone. What it cannot do is cover the gap between
 * `navigator.xr.requestSession` RESOLVING and the first `renderer.render`.
 * Immersive compositing has begun by then, so the passthrough camera is already
 * on screen, and in an `alpha-blend` session a framebuffer that has not been
 * drawn IS the camera image. No mesh helps, because there is no rendered scene
 * yet.
 *
 * The reported symptom was exactly that: black with "Finding your position…",
 * then **a flash of camera**, then black again, then the correct fade. The
 * reporter diagnosed it as the sphere being built too late; it is not — there
 * is no `await` between `initAR` resolving and the mesh being added.
 *
 * **WHY THE DOM CAN DO IT.** `#ar-root` is the session's `domOverlay` root, and
 * the browser composites that subtree over the camera and the WebGL layer
 * **whether or not WebGL drew anything**. That is also why `.ar-entry-wait`,
 * which has no background of its own, shows up as text over live camera on any
 * frame that skipped `renderer.render` — the frame loop has two early returns
 * that do exactly that.
 *
 * So this element is inserted BEFORE the session is requested and removed once
 * a frame has actually been drawn with the mesh veil in it.
 *
 * @see ar-entry-dom-veil.ts.md
 */

/** The class the stylesheet paints; kept in one place for the e2e to query. */
export const ENTRY_DOM_VEIL_CLASS = "ar-entry-dom-veil";

/**
 * `ENTRY_VEIL_COLOUR` as CSS, so the two veils are indistinguishable.
 *
 * Derived rather than written twice: the whole effect depends on the handover
 * being invisible, and two hex literals that must match is the shape this repo
 * has been bitten by before.
 */
export function entryDomVeilColour(): string {
  return `#${ENTRY_VEIL_COLOUR.toString(16).padStart(6, "0")}`;
}

export interface ArEntryDomVeil {
  readonly element: HTMLElement;
  /** Idempotent: safe to call from several exit paths and from the frame hook. */
  remove(): void;
}

/**
 * Insert the veil into `container`, which must be the `domOverlay` root.
 *
 * `aria-hidden`, because it carries no information — the "Finding your
 * position…" line is the accessible status and is a separate element with
 * `role="status"`. A second announced node would make a screen reader say
 * nothing twice.
 */
export function createArEntryDomVeil(container: HTMLElement): ArEntryDomVeil {
  const element = document.createElement("div");
  element.className = ENTRY_DOM_VEIL_CLASS;
  element.setAttribute("aria-hidden", "true");
  element.style.background = entryDomVeilColour();
  container.append(element);

  let removed = false;
  return {
    element,
    remove(): void {
      if (removed) return;
      removed = true;
      element.remove();
    },
  };
}
