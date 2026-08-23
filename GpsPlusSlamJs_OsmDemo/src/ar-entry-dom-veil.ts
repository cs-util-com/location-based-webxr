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
 * So this element is inserted BEFORE the session is requested, and once a frame
 * has actually been drawn with the mesh veil in it, it FADES rather than
 * vanishing (DEC-L1) — the seventeenth session still saw a flash of camera at
 * the instant of the hard cut, and the fade covers every candidate cause of it.
 *
 * @see ar-entry-dom-veil.ts.md
 */

/** The class the stylesheet paints; kept in one place for the e2e to query. */
export const ENTRY_DOM_VEIL_CLASS = "ar-entry-dom-veil";

/**
 * How long the veil takes to fade out once the handover begins (DEC-L1).
 *
 * **THE CLOCK STARTS WHERE THE HARD REMOVAL USED TO HAPPEN** — the second frame
 * callback — so the fully-black period is never shorter than the one this
 * replaces. The seventeenth field session still saw a flash of camera at that
 * instant; a fade covers it whichever of the three candidate causes is real (a
 * later frame that skipped `renderer.render`, a one-frame seam between the DOM
 * overlay and the WebGL layer, or a two-frame margin that is simply too thin).
 *
 * **Rejected: starting the fade when the element is inserted.** That is the
 * literal reading of the request, and it is the one variant that can fail —
 * insertion happens BEFORE `requestSession`, so a slow permission grant would
 * finish the fade while the consent dialog is still up.
 *
 * **Rejected: 5 s.** Not for the reason first written down: a semi-transparent
 * DOM veil does dim the city behind it, but the mesh veil behind THIS one is
 * still ~0.97 opaque at 3 s and pinned at 1.0 for the whole estimate-wait
 * fallback, so the difference is negligible. 3 s is what was asked for, and it
 * is the length that spends least on the one cost nobody has measured — a
 * full-viewport opacity write in the DOM-overlay compositor layer, per frame.
 */
export const ENTRY_DOM_VEIL_FADE_S = 3;

/** Smoothstep — zero slope at both ends, like every other fade in this entry. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * The veil's opacity `s` seconds into the fade, `[0,1]`.
 *
 * `1` at and before 0, easing to exactly `0` at {@link ENTRY_DOM_VEIL_FADE_S}
 * and staying there. Pure, so the curve is testable without a session, a
 * renderer or a clock — which is the deciding argument for driving this from
 * the frame loop rather than from a CSS animation, since jsdom runs no
 * animations and the degenerate inputs below are where the lid comes from.
 *
 * **EVERY NON-FINITE READING COLLAPSES TO 0, never to 1.** An opaque layer left
 * over a live session is a lid on the passthrough — `ar-entry-veil.ts` records
 * that as strictly worse than having no veil at all — and a `NaN` resolving to
 * opaque would also stop the driver ever reaching its removal condition, so the
 * veil would outlive the entry with no error raised anywhere.
 *
 * ⚠️ **This is deliberately NOT `ar-entry-veil.ts`'s `setAlpha` rule**, which
 * clamps `+Infinity` UP to 1. There the input is an opacity and "as opaque as
 * possible" is a real request; here it is elapsed time, so an infinite reading
 * means the fade is long over. The rule followed here is `cameraFadeAlpha`'s:
 * every degenerate input resolves to "no veil".
 */
export function domVeilAlpha(elapsedS: number): number {
  if (!Number.isFinite(elapsedS)) return 0;
  // BEFORE THE FADE, not "unusable": the driver latches the start on the frame
  // it first evaluates this, so 0 is the ordinary first reading and a negative
  // one could only come from a clock that ran backwards. Both mean "the fade
  // has not begun", and the session's own teardown removes the element if it
  // somehow never does.
  if (elapsedS <= 0) return 1;
  if (elapsedS >= ENTRY_DOM_VEIL_FADE_S) return 0;
  return 1 - smoothstep(elapsedS / ENTRY_DOM_VEIL_FADE_S);
}

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
  /**
   * Fade it, `[0,1]`. Clamped; anything unusable collapses to 0.
   *
   * Separate from {@link remove} on purpose: the caller drives the alpha every
   * frame and removes the element only once it reaches 0, so a fade that stops
   * being driven leaves a partially transparent layer rather than a lid.
   */
  setAlpha(alpha: number): void;
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
    setAlpha(alpha: number): void {
      // NON-FINITE COLLAPSES TO 0, never to 1 — the same direction
      // `domVeilAlpha` fails in, and for the same reason.
      //
      // AND CLAMPED RATHER THAN PASSED THROUGH. A CSS `opacity` outside [0,1]
      // is an invalid declaration, which the browser DROPS — restoring the
      // element to fully opaque. That is the lid again, arriving by the one
      // path that looks harmless.
      const safe = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
      element.style.opacity = String(safe);
    },
    remove(): void {
      if (removed) return;
      removed = true;
      element.remove();
    },
  };
}
