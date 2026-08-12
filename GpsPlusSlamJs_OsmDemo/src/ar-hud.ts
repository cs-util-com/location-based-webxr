/**
 * The measurement readout, inside the AR overlay where it can be seen.
 *
 * **THE SURFACE, NOT THE NUMBERS** — those are `ar-measurements.ts`. This file
 * owns the element, the sampling cadence, and the two ways both can go wrong.
 *
 * **IT LIVES INSIDE `#ar-root` FOR THE REASON `ar-toast.ts` RECORDS**: WebXR
 * composites only the dom-overlay root's subtree over the camera feed, so a
 * readout anywhere else on the page is invisible for exactly the session it is
 * measuring. The demo's status line is in the header, outside it.
 *
 * **AND IT IS SAMPLED, NOT WRITTEN PER FRAME.** The values change every frame;
 * the DOM does not need to. Writing `textContent` at display rate inside the XR
 * frame callback would put layout on the critical path of the thing being
 * measured — the instrument would change the reading. {@link AR_HUD_SAMPLE_MS}
 * is the compromise.
 *
 * @see ar-hud.ts.md
 */

import {
  describeArMeasurements,
  type ArMeasurements,
} from "./ar-measurements.js";

/**
 * How often the readout is rewritten, ms.
 *
 * Fast enough that a number responds to what the user just did, slow enough
 * that the DOM write is nowhere near the frame budget: at 500 ms a 60 fps
 * session writes once per 30 frames.
 */
export const AR_HUD_SAMPLE_MS = 500;

export interface ArHud {
  /**
   * Offer the latest values. Cheap, and safe to call every frame — the DOM is
   * only touched when the sample window has elapsed AND the text changed.
   *
   * Returns whether this call ACCEPTED the sample (i.e. the window had
   * elapsed), so a caller averaging over the window knows when to reset its
   * counters. Without that the caller has to duplicate the cadence, and two
   * copies of a cadence drift.
   */
  sample(measurements: ArMeasurements, nowMs: number): boolean;
  /** Take the readout down. Idempotent. */
  dispose(): void;
}

/**
 * Create the readout inside the AR overlay root.
 *
 * @param root the SAME element passed to `initAR`.
 *
 * The clock is a parameter of {@link ArHud.sample} rather than something this
 * reads, so the cadence is testable without fake timers and the caller can pass
 * the XR frame's own `elapsed` instead of wall time.
 */
export function createArHud(root: HTMLElement): ArHud {
  const element = document.createElement("div");
  element.className = "ar-hud";
  // NOT a live region. Unlike the far-travel toast — which IS announced,
  // politely, now that `#ar-root` no longer carries a static `aria-hidden`
  // that made it inert (r510 review) — this changes twice a second forever.
  // Announcing that would make the page unusable with a screen reader, and the
  // numbers are a developer instrument rather than user-facing content.
  element.setAttribute("aria-hidden", "true");

  let lastWriteMs = Number.NEGATIVE_INFINITY;
  let lastText = "";
  let attached = false;

  return {
    sample(measurements: ArMeasurements, nowMs: number): boolean {
      if (nowMs - lastWriteMs < AR_HUD_SAMPLE_MS) return false;
      lastWriteMs = nowMs;

      const text = describeArMeasurements(measurements).join("\n");
      // NOTHING MEASURED YET MEANS NOTHING ON SCREEN, and specifically it means
      // the element stays OUT of `#ar-root` — which is `position: fixed;
      // inset: 0` and hidden only while `:empty`, so an always-attached readout
      // would keep a full-viewport layer over the page whenever AR is not
      // running. That regression has shipped here once already (`ar-mode.ts`).
      if (text === "") {
        if (attached) {
          element.remove();
          attached = false;
        }
        lastText = "";
        return true;
      }

      // Guarded, because `textContent` invalidates layout even when the string
      // is identical — and most samples are identical in most fields.
      if (text !== lastText) {
        element.textContent = text;
        lastText = text;
      }
      if (!attached) {
        root.append(element);
        attached = true;
      }
      return true;
    },

    dispose(): void {
      element.remove();
      attached = false;
      lastText = "";
      lastWriteMs = Number.NEGATIVE_INFINITY;
    },
  };
}
