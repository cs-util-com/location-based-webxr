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
 * Where the expand/collapse preference lives between sessions.
 *
 * PERSISTED, because the expanded state is what a user opens just before taking
 * a screenshot — and a preference that resets every session is one re-enabled by
 * hand on every field trip, which is the friction that gets an instrument
 * abandoned.
 */
const EXPANDED_KEY = "osm-demo:ar-hud-expanded";

/**
 * Read the preference, treating any failure as "collapsed".
 *
 * `localStorage` THROWS on access in private mode and in sandboxed iframes —
 * it is not merely empty there. Losing the preference is acceptable; losing the
 * readout that the session is being measured with is not.
 */
function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Store the preference, or silently accept that it will not survive. */
function storeExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    // See `readExpanded` — the preference is expendable, the readout is not.
  }
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

  // THE NUMBERS ARE HIDDEN FROM ASSISTIVE TECHNOLOGY, THE TOGGLE IS NOT.
  // They change twice a second forever; announcing that would make the page
  // unusable with a screen reader, and they are a developer instrument rather
  // than user-facing content — unlike the far-travel toast, which IS announced
  // politely now that `#ar-root` no longer carries a static `aria-hidden` that
  // made it inert (r510 review).
  //
  // **The attribute moved from the container to this span** when the readout
  // became collapsible (DEC-H2). It cannot stay on the container: an
  // `aria-hidden` subtree containing a focusable button is the worst of both —
  // still reachable by keyboard, invisible to the screen reader describing it.
  const values = document.createElement("span");
  values.className = "ar-hud-values";
  values.setAttribute("aria-hidden", "true");

  // THE WHOLE READOUT IS THE TAP TARGET's neighbour rather than the target
  // itself: a real `<button>` is what makes this reachable and nameable, and it
  // sits inside the readout so it costs no extra thumb space against the
  // elevation control.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ar-hud-toggle";

  let expanded = readExpanded();
  let lastWriteMs = Number.NEGATIVE_INFINITY;
  let lastText = "";
  let attached = false;
  let latest: ArMeasurements = {};

  const paintToggle = (): void => {
    toggle.textContent = expanded ? "−" : "+";
    const label = expanded
      ? "Show fewer AR debug values"
      : "Show all AR debug values";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
  };

  const paint = (): void => {
    const text = describeArMeasurements(latest, { expanded }).join("\n");
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
      return;
    }

    // Guarded, because `textContent` invalidates layout even when the string
    // is identical — and most samples are identical in most fields.
    if (text !== lastText) {
      values.textContent = text;
      lastText = text;
    }
    if (!attached) {
      root.append(element);
      attached = true;
    }
  };

  toggle.addEventListener("click", () => {
    expanded = !expanded;
    storeExpanded(expanded);
    paintToggle();
    // REPAINTED HERE, not at the next sample. The window is 500 ms, and a
    // control that waits that long to respond reads as broken — so the user
    // presses it again and toggles straight back.
    paint();
  });

  paintToggle();
  element.append(values, toggle);

  return {
    sample(measurements: ArMeasurements, nowMs: number): boolean {
      if (nowMs - lastWriteMs < AR_HUD_SAMPLE_MS) return false;
      lastWriteMs = nowMs;
      // HELD, so the toggle can repaint without waiting for a fresh sample.
      latest = measurements;
      paint();
      return true;
    },

    dispose(): void {
      element.remove();
      attached = false;
      lastText = "";
      lastWriteMs = Number.NEGATIVE_INFINITY;
      latest = {};
    },
  };
}
