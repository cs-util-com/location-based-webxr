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

/** What the AR entry asks before starting a session. */
export interface LocationGate {
  /** True while a tap should request the location instead of starting AR. */
  pending(): boolean;
  /** The location-only tap: resolves true when the position was obtained
   *  (the gate then clears), false when it was refused or failed. */
  request(): Promise<boolean>;
}

/** The DOM surface this module touches, STRUCTURAL so the unit tests pass
 *  plain objects (this package runs its unit tests in node, no jsdom). */
type HidableNode = Pick<HTMLElement, "hidden">;
type TextNode = Pick<HTMLElement, "textContent">;

export interface VisitorScreenDom {
  /** The visitor's heading + consent copy; hidden for a creator. */
  screen: HidableNode;
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
  if (visitor) dom.arHint.textContent = VISITOR_HINT;

  // Pessimistic until the query answers: a tap that arrives first requests
  // the location, which is the harmless direction to be wrong in.
  let pending = visitor;
  if (visitor) {
    void seams.queryGeolocationPermission().then((permission) => {
      pending = locationTapNeeded(permission);
      renderArEntry();
    });
  }

  return {
    locationGate: {
      pending: () => pending,
      request: async () => {
        dom.errorBox.textContent = "";
        const granted = await seams.requestLocationOnce();
        if (granted) {
          pending = false;
        } else {
          dom.errorBox.textContent =
            "Location is needed to place the tour. Allow location for this site in your browser settings, then tap again.";
        }
        renderArEntry();
        return granted;
      },
    },
  };
}
