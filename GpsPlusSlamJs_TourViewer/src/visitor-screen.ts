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
 */

import type { ViewerMode } from "./mode.js";
import type { TourViewerSeams } from "./seams.js";

/** The permission states `navigator.permissions` reports, plus "unknown"
 *  for browsers without the API or a query that throws. */
export type LocationPermission = "granted" | "prompt" | "denied" | "unknown";

/** Whether the visitor's first tap must request the location on its own
 *  (true) before a tap may start AR. Anything but a known grant needs the
 *  tap: "unknown" is a browser without the permissions API, where the
 *  two-step form is the safe default. */
export function locationTapNeeded(permission: LocationPermission): boolean {
  return permission !== "granted";
}

/** What one position request came back with. */
export type LocationRequestOutcome = "granted" | "denied" | "unavailable";

/** What the AR entry asks before starting a session. */
export interface LocationGate {
  /** True while a tap should request the location instead of starting AR. */
  pending(): boolean;
  /** True while a request is in flight (the button shows it, async-UI rule). */
  busy(): boolean;
  /** The location-only tap. The gate clears on "granted" AND on
   *  "unavailable" (the permission is settled; the session's watch tolerates
   *  a slow fix); only a denial keeps it pending, with the reason shown. */
  request(): Promise<LocationRequestOutcome>;
}

/** The gate after one request outcome: still pending only on a denial. */
export function gateAfterRequest(outcome: LocationRequestOutcome): boolean {
  return outcome === "denied";
}

/** What the visitor reads after a request that did not obtain a position. */
export function locationRequestMessage(
  outcome: LocationRequestOutcome,
): string {
  switch (outcome) {
    case "denied":
      return "Location is needed to place the tour. Allow location for this site in your browser settings, then tap again.";
    case "unavailable":
      return "No GPS fix yet - that is fine outdoors, the tour keeps trying once it starts.";
    case "granted":
      return "";
  }
}

/** The DOM surface this module touches, STRUCTURAL so the unit tests pass
 *  plain objects (this package runs its unit tests in node, no jsdom). */
type HidableNode = Pick<HTMLElement, "hidden">;
type TextNode = Pick<HTMLElement, "textContent">;

export interface VisitorScreenDom {
  /** The visitor's heading + consent copy; hidden for a creator. */
  screen: HidableNode;
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

const VISITOR_HINT =
  "Once AR starts, point your phone at the printed code you scanned. The tour appears when the code is recognised.";

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
  if (visitor) {
    void seams.queryGeolocationPermission().then((permission) => {
      pending = locationTapNeeded(permission);
      renderArEntry();
    });
  }

  return {
    locationGate: {
      pending: () => pending,
      busy: () => busy,
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
        pending = gateAfterRequest(outcome);
        dom.errorBox.textContent = locationRequestMessage(outcome);
        renderArEntry();
        return outcome;
      },
    },
  };
}
