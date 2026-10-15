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

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import type { ViewerMode } from "./mode.js";
import { isLockableLevel } from "./scan-gate.js";
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

/** The screen's `codesUsable` answer for the open tour: whether one of
 *  its codes can place it (a lockable level). Unknown (null) while the
 *  levels are unread; a read that FAILED (`unreadable`) is false - those
 *  levels never come, so "unknown" would hold for the tour (r857 review
 *  #4). */
export function tourCodesUsable(
  levels: ReadonlyMap<string, QrLevel> | null,
  unreadable: boolean,
): boolean | null {
  if (unreadable) return false;
  if (levels === null) return null;
  return [...levels.values()].some(isLockableLevel);
}

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
   *  visitor declined it, now or before - and the tour's codes can place it
   *  (unknown counts as yes). So a tap before the levels land on a tour
   *  with no usable code starts on codes, and the in-AR line says nothing
   *  can place it (`visitor-status.ts`, PR #621 review): a denied visitor
   *  gets no GPS either way, and waiting for the levels would hold the
   *  start of every tour whose codes do work. */
  codesOnly(): boolean;
  /** Before a codes-only start, read the permission again (M1b-1 review
   *  #3): "granted" starts with GPS; "prompt" (a dismissed prompt reads as
   *  a denial in Chrome) offers the location once more - once per page, so
   *  a second dismissal starts on codes and never loops. */
  recheck(): Promise<void>;
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
  /** The open tour changed (its `tour.json` settled, its levels settled,
   *  or it closed): the line above the button follows its `needsNoGps`
   *  flag. */
  tourChanged(): void;
}

/** The one line under the visitor's button (V4): the full instructions
 *  are behind "What happens?" on the page. */
const VISITOR_HINT =
  "Once AR starts, point your phone at the tour's code (on the poster).";

/** A denial on a tour none of whose codes can place it (M1b-1 review #2):
 *  only location can, so the settings copy stays. */
const DENIED_NO_CODES_ERROR =
  "Location is needed to place this tour. Allow location for this site in your browser settings, then tap again.";

/** The line under the "1 of 2" button once the browser will ask. */
const ALLOW_HINT =
  "Your browser will ask for your location - tap Allow. Then Start the tour.";

export function wireVisitorScreen(deps: {
  mode: ViewerMode;
  seams: TourViewerSeams;
  dom: VisitorScreenDom;
  /** Re-renders the AR button once the permission state is known. */
  renderArEntry: () => void;
  /** Whether the open tour has a code that can place it: `false` keeps
   *  a denial on the old "allow location" copy (M1b-1 review #2), `null`
   *  (unknown, or no tour yet) and `true` allow the codes-only start after
   *  a denial; only `true` lets a `needsNoGps` flag hold
   *  (`tourCodesUsable`). Absent: unknown. */
  codesUsable?: () => boolean | null;
  /** Whether the open tour needs no GPS (`tour.json` `needsNoGps`, owner
   *  decision Q-QF-1): its visitor is never asked for the location and
   *  starts on codes alone. Read live. Absent: no tour needs none. */
  needsNoGps?: () => boolean;
}): VisitorScreen {
  const { mode, seams, dom, renderArEntry } = deps;
  const codesUsable = deps.codesUsable ?? (() => null);
  const flaggedNoGps = deps.needsNoGps ?? (() => false);
  /** The flag holds only once the tour's codes are KNOWN to place it: a
   *  flagged tour with no usable code asks as any other (M1b-1 review #2),
   *  and so does one whose levels are unread or failed to read (r857
   *  review #4) - asking is the safe direction to be wrong in. */
  const needsNoGps = (): boolean => flaggedNoGps() && codesUsable() === true;
  /** The line the permission query chose; a tour that needs no GPS shows
   *  the plain visitor line instead (`showHint`), and so does a codes line
   *  once the tour's codes are known unusable (PR #621/#623 reviews): the
   *  button is a location tap again then, as after a denial on such a tour. */
  let permissionHint = VISITOR_HINT;
  const showHint = (): void => {
    const codesLineStale =
      permissionHint === CODES_ONLY_HINT && codesUsable() === false;
    dom.arHint.textContent =
      needsNoGps() || codesLineStale ? VISITOR_HINT : permissionHint;
  };
  /** Whether the location was offered again after a codes-only start
   *  (`recheck`): once per page. */
  let reoffered = false;
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
      if (permission === "prompt") permissionHint = ALLOW_HINT;
      if (permission === "denied") {
        codesOnly = true;
        permissionHint = CODES_ONLY_HINT;
      }
      showHint();
      renderArEntry();
    });
  }

  return {
    locationGate: {
      // A codes-only start on a tour whose codes cannot place it turns the
      // tap back into a location request (its denial shows the old copy).
      pending: () =>
        !needsNoGps() && (pending || (codesOnly && codesUsable() === false)),
      busy: () => busy,
      codesOnly: () => needsNoGps() || (codesOnly && codesUsable() !== false),
      recheck: async () => {
        if (!codesOnly || needsNoGps()) return;
        let permission: LocationPermission;
        try {
          permission = await seams.queryGeolocationPermission();
        } catch {
          return;
        }
        if (permission === "granted") {
          codesOnly = false;
        } else if (permission === "prompt" && !reoffered) {
          reoffered = true;
          codesOnly = false;
          pending = true;
          permissionHint = ALLOW_HINT;
          showHint();
        } else {
          return;
        }
        renderArEntry();
      },
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
        // A tour whose codes cannot place it: a denial keeps the gate and
        // the old copy - only location can place this tour (review #2).
        if (outcome === "denied" && codesUsable() === false) {
          pending = true;
          codesOnly = false;
          dom.errorBox.textContent = DENIED_NO_CODES_ERROR;
          permissionHint = VISITOR_HINT;
          showHint();
          renderArEntry();
          return outcome;
        }
        pending = false;
        codesOnly = codesOnlyAfterRequest(outcome);
        const notice = locationRequestNotice(outcome);
        dom.errorBox.textContent = notice.error;
        // Never "your browser will ask" after an answer (M4 review #3) -
        // also not after a later `tourChanged` (r857 review #2): the
        // answer's line is the permission's line from here on.
        permissionHint = notice.hint;
        showHint();
        renderArEntry();
        return outcome;
      },
    },
    tourChanged: () => {
      if (!visitor) return;
      // No stale denial error to clear here (PR #623 review): every tour
      // open empties the error box first (`archive-open.ts` `openTour`),
      // and a tour's `codesUsable() === false` never turns back within it.
      showHint();
      renderArEntry();
    },
  };
}
