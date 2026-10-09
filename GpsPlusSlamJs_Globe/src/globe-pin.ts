/**
 * The globe's pin (round-2 plan 2026-09-26-2055 M3g, DEC-FB2-2/3): a
 * button that finds the user and flies the globe down to them, landing in
 * the globe's own city (the page hand-over to OsmDemo was removed, globe
 * city plan 2026-10-05-0040 §12.5 C6). Its phases and labels, kept pure so the async-feedback rule
 * (an in-progress state, a final state, failures back to idle) is tested
 * without a browser. The failure's own words come from the framework's
 * `utils/locate-state.ts` (the lab joins the two).
 *
 * @see globe-pin.ts.md
 */

export const GLOBE_PIN_PHASES = ["idle", "locating", "flying"] as const;
export type GlobePinPhase = (typeof GLOBE_PIN_PHASES)[number];

/**
 * What can happen to the pin: a `press` of it, a `touch` on the globe (the
 * controls took the camera), the position `located` or `failed`, or the
 * dive `held` at its landing (its only end since the hand-over went).
 */
export const GLOBE_PIN_EVENTS = [
  "press",
  "touch",
  "located",
  "failed",
  "held",
] as const;
export type GlobePinEvent = (typeof GLOBE_PIN_EVENTS)[number];

/**
 * The transitions; an event not listed for a phase leaves it as it is, so
 * a fix or an arrival that comes after a cancel starts nothing:
 * - idle: a press asks for the position;
 * - locating: a fix starts the flight, a failure returns to idle (the lab
 *   names the fix in its error line); a press cancels the wait (a browser
 *   can leave the request pending, e.g. while its permission prompt is
 *   open); a touch on the globe does not (the fix still flies);
 * - flying: a press or a touch stops it, back to idle; the landing holds
 *   and the pin is idle, pressable again.
 */
const TRANSITIONS: Readonly<
  Record<GlobePinPhase, Partial<Record<GlobePinEvent, GlobePinPhase>>>
> = {
  idle: { press: "locating" },
  locating: { press: "idle", located: "flying", failed: "idle" },
  flying: { press: "idle", touch: "idle", held: "idle" },
};

/**
 * Whether the camera already moves while the pin locates: the continuous
 * flight (`flight=2`, continuous-flight plan 2026-10-07-0941 CF3) holds
 * above the band from the press, so a touch there cancels too.
 */
export interface PinOptions {
  readonly moving?: boolean;
}

/** The next phase (see `TRANSITIONS`; with `moving`, a touch cancels a locate). */
export function nextPinPhase(
  phase: GlobePinPhase,
  event: GlobePinEvent,
  options: PinOptions = {},
): GlobePinPhase {
  if (options.moving && phase === "locating" && event === "touch") {
    return "idle";
  }
  return TRANSITIONS[phase][event] ?? phase;
}

/**
 * The button for a phase: its label (text and accessible name), whether it
 * is disabled, and whether work is in progress (`aria-busy`). Disabled
 * only while the page leaves: a press cancels the wait for the fix, and
 * stops the flight.
 */
export function globePinView(
  phase: GlobePinPhase,
  options: PinOptions = {},
): {
  label: string;
  disabled: boolean;
  busy: boolean;
} {
  switch (phase) {
    case "idle":
      return { label: "Fly to my location", disabled: false, busy: false };
    case "locating":
      return {
        label: options.moving
          ? "Finding you, descending - tap to cancel"
          : "Finding you... - tap to cancel",
        disabled: false,
        busy: true,
      };
    case "flying":
      return {
        label: "Flying to you - tap to stop",
        disabled: false,
        busy: true,
      };
  }
}
