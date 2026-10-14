/**
 * The visitor's one screen (guided-setup plan DEC-N2, §2.1): what the tour
 * needs and a Start button. The button is `#enter-ar`, owned by the AR
 * entry; this module owns the screen's visibility per mode and the
 * LOCATION GATE the entry consults before starting a session.
 *
 * Why a gate: a WebXR session starts only inside a user activation, and
 * the framework's `enable()` awaits the geolocation prompt before it calls
 * `initAR` - a visitor reading that prompt spends the activation (plan
 * review #12). So while the geolocation permission is not known to be
 * granted, the button's tap only requests the position; the next tap
 * starts AR, and `enable()`'s own request then resolves without a prompt.
 * A returning visitor with the permission granted gets one tap.
 *
 * A DENIAL starts the tour on codes alone (QR-first plan 2026-10-14-0445
 * §7 #10, M1b-1): the gate clears, `codesOnly()` turns on - the entry then
 * starts AR without location (`enable({ location: "none" })`), and a
 * scanned code places the tour (M1) - and the line says what that needs. A
 * site already blocked gets the same at once, with no location tap. A
 * granted permission without a fix keeps GPS on.
 */

import type { ViewerMode } from "./mode.js";
import type { TourViewerSeams } from "./seams.js";

/** The permission states `navigator.permissions` reports, plus "unknown"
 *  for browsers without the API or a query that throws. */
export type LocationPermission = "granted" | "prompt" | "denied" | "unknown";

/** Whether the visitor's first tap must request the location on its own
 *  (true) before a tap may start AR: while the browser may still ask -
 *  "prompt", and "unknown" (a browser without the permissions API, where
 *  the two-step form is the safe default). A grant needs no tap; a denial
 *  needs none either, because the browser will not ask again and the tour
 *  starts on codes alone (QR-first M1b-1). */
export function locationTapNeeded(permission: LocationPermission): boolean {
  return permission === "prompt" || permission === "unknown";
}

/** The line for a visitor without location (QR-first M1b-1): what a tour
 *  on codes alone needs. Also the in-AR scan line in that mode. */
export const CODES_ONLY_HINT =
  "Scan one of the tour's printed codes to start - without location, the codes place the tour.";

/** What one position request came back with. */
export type LocationRequestOutcome = "granted" | "denied" | "unavailable";

/** What the AR entry asks before starting a session. */
export interface LocationGate {
  /** True while a tap should request the location instead of starting AR. */
  pending(): boolean;
  /** True while a request is in flight (the button shows it, async-UI rule). */
  busy(): boolean;
  /** The location-only tap. The gate clears on every outcome: "granted"
   *  and "unavailable" (the permission is settled; the session's watch
   *  tolerates a slow fix) start with GPS, a denial on codes alone. */
  request(): Promise<LocationRequestOutcome>;
  /** Whether the next start runs without location (QR-first M1b-1): the
   *  visitor declined it, now or before. */
  codesOnly(): boolean;
}

/** Whether a request outcome starts the tour on codes alone: a denial. */
export function codesOnlyAfterRequest(
  outcome: LocationRequestOutcome,
): boolean {
  return outcome === "denied";
}

/** What the visitor reads after one location request: an `error` only
 *  for a denial (the alert box), otherwise a `hint` above the button that
 *  says what the next tap does (UI round 1, U1, review F11: the second tap
 *  used to be silent, and the benign no-fix note showed as a red alert). */
export function locationRequestNotice(outcome: LocationRequestOutcome): {
  error: string;
  hint: string;
} {
  switch (outcome) {
    case "denied":
      // No error since QR-first M1b-1: the tour starts on codes alone.
      return { error: "", hint: CODES_ONLY_HINT };
    case "unavailable":
      return {
        error: "",
        hint: "No GPS fix yet - that is fine outdoors, the tour keeps trying once it starts. Tap Start the tour, then point your phone at the tour's code (on the poster).",
      };
    case "granted":
      // Keeps what to do once AR starts (U1 milestone review #10).
      return {
        error: "",
        hint: "Location allowed - now tap Start the tour, then point your phone at the tour's code (on the poster).",
      };
  }
}

/** The DOM surface this module touches, STRUCTURAL so the unit tests pass
 *  plain objects (this package runs its unit tests in node, no jsdom). */
type HidableNode = Pick<HTMLElement, "hidden">;
type TextNode = Pick<HTMLElement, "textContent">;

export interface VisitorScreenDom {
  /** The visitor's heading + consent copy; hidden for a creator. */
  screen: HidableNode;
  /** "What happens?" and the way to make a tour, under the button
   *  (polish round M4a, the owner's V4); hidden for a creator. */
  more: HidableNode;
  /** Step 4, a `<details>` since the flow rework. A visitor gets no
   *  summary (it is `.creator-only`), so nothing would ever open it - and
   *  its content is the AR section, which IS the visitor's screen. */
  measureStep: { open: boolean };
  /** Everything a visitor must not see (the setup's steps and copy). */
  creatorOnly: readonly HidableNode[];
  /** The hint above the AR button, re-worded for a visitor. */
  arHint: TextNode;
  errorBox: TextNode;
}

export interface VisitorScreen {
  locationGate: LocationGate;
}

/** The one line under the visitor's button (V4): the full instructions
 *  are behind "What happens?" on the page. */
const VISITOR_HINT =
  "Once AR starts, point your phone at the tour's code (on the poster).";

/** The line under the "1 of 2" button once the browser will ask. */
const ALLOW_HINT =
  "Your browser will ask for your location - tap Allow. Then Start the tour.";

export function wireVisitorScreen(deps: {
  mode: ViewerMode;
  seams: TourViewerSeams;
  dom: VisitorScreenDom;
  /** Re-renders the AR button once the permission state is known. */
  renderArEntry: () => void;
}): VisitorScreen {
  const { mode, seams, dom, renderArEntry } = deps;
  const visitor = mode === "visitor";
  dom.screen.hidden = !visitor;
  dom.more.hidden = !visitor;
  for (const element of dom.creatorOnly) element.hidden = visitor;
  if (visitor) {
    dom.arHint.textContent = VISITOR_HINT;
    // Without this the visitor's page has a collapsed step 4 with an
    // invisible summary - i.e. no Start button and no way to reach one.
    dom.measureStep.open = true;
  }

  // Pessimistic until the query answers: a tap that arrives first requests
  // the location, which is the harmless direction to be wrong in.
  let pending = visitor;
  let busy = false;
  let codesOnly = false;
  if (visitor) {
    void seams.queryGeolocationPermission().then((permission) => {
      pending = locationTapNeeded(permission);
      // Only "prompt" means the browser WILL ask; a blocked site starts on
      // codes alone (QR-first M1b-1).
      if (permission === "prompt") dom.arHint.textContent = ALLOW_HINT;
      if (permission === "denied") {
        codesOnly = true;
        dom.arHint.textContent = CODES_ONLY_HINT;
      }
      renderArEntry();
    });
  }

  return {
    locationGate: {
      pending: () => pending,
      busy: () => busy,
      codesOnly: () => codesOnly,
      request: async () => {
        if (busy) return "unavailable"; // one request at a time; the button is disabled anyway
        busy = true;
        dom.errorBox.textContent = "";
        renderArEntry();
        let outcome: LocationRequestOutcome;
        try {
          outcome = await seams.requestLocationOnce();
        } finally {
          busy = false;
        }
        pending = false;
        codesOnly = codesOnlyAfterRequest(outcome);
        const notice = locationRequestNotice(outcome);
        dom.errorBox.textContent = notice.error;
        // Never "your browser will ask" after an answer (M4 review #3).
        dom.arHint.textContent = notice.hint;
        renderArEntry();
        return outcome;
      },
    },
  };
}
