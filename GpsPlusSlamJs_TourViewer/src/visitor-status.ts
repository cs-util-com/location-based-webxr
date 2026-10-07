/**
 * The visitor's AR status as ONE plain sentence (UI round 1, U1; usability
 * review F1, F15). The full technical line (`arStatusLine` in
 * `tour-flow.ts`: frames, vote batches, pose error, fixes) stays for the
 * creator and for a visitor's `?debug=1`; every other visitor reads this.
 *
 * `state` names the situation for the page (`data-state`) and the tests, so
 * neither depends on the wording.
 *
 * @see visitor-status.ts.md
 */

import type { ArStatusInput } from "./tour-flow.js";

type VisitorStatusState =
  | "before-ar"
  | "checking"
  | "starting"
  | "stopping"
  | "unsupported"
  | "error"
  | "no-tour"
  | "scan"
  | "measuring-code"
  | "code-other-tour"
  | "code-unusable"
  | "code-moved"
  | "locking"
  | "warming-up"
  | "placing"
  | "placed"
  | "placed-gps"
  | "tracking-lost"
  | "needs-code"
  | "nothing";

export interface VisitorStatus {
  readonly state: VisitorStatusState;
  /** The sentence, with what could not load after it; "" when the page's
   *  own screen speaks (before AR). */
  readonly text: string;
}

const LOOK_AROUND = "Look around.";
const GPS_PLACED = "Tour placed by GPS (less exact)";

/** Why AR did not start, from the controller's error message (the
 *  framework keeps only the message, not the exception's name): the causes
 *  a visitor can act on, else a plain retry. */
function startFailureText(error: string | null | undefined): string {
  if (error != null && /location permission/i.test(error)) {
    return "Location access was blocked. Allow location for this site in the browser settings, then tap Try again.";
  }
  if (
    error != null &&
    /NotAllowedError|camera|permission denied/i.test(error)
  ) {
    return "Camera access was blocked. Allow the camera for this site in the browser settings, then tap Try again.";
  }
  if (error != null && /NotSupportedError|not supported/i.test(error)) {
    return "This phone can't start AR for this tour. Open this page in Chrome on an Android phone that supports AR.";
  }
  return "AR could not start. Tap Try again.";
}

/** Before or around the session: the button and the visitor screen carry
 *  the action; the line says only what is happening. */
function beforeRunning(
  arStatus: ArStatusInput["arStatus"],
  arError: string | null | undefined,
): VisitorStatus {
  switch (arStatus) {
    case "checking":
      return {
        state: "checking",
        text: "Checking whether this phone can show the tour in AR…",
      };
    case "starting":
      return { state: "starting", text: "Starting AR…" };
    case "stopping":
      return { state: "stopping", text: "Closing AR…" };
    case "unsupported":
      return {
        state: "unsupported",
        text: "This phone or browser can't show the tour in AR. Open this page in Chrome on an Android phone that supports AR.",
      };
    case "error":
      return { state: "error", text: startFailureText(arError) };
    default:
      return { state: "before-ar", text: "" };
  }
}

/** What could not load, as sentences after the state's own. */
function loadNotes(input: ArStatusInput): string[] {
  const notes: string[] = [];
  if (input.content.kind === "placed" && input.content.skipped > 0) {
    const n = input.content.skipped;
    notes.push(`${String(n)} ${n === 1 ? "item" : "items"} could not load.`);
  }
  if (input.planesError !== null) notes.push("Some photos could not load.");
  if (input.contentError !== null) {
    notes.push("Some of the tour's content could not load.");
  }
  return notes;
}

/** Placed by GPS only: the visitor skipped the code, the code is ignored,
 *  or the code cannot be read here. */
function gpsOnly(gate: ArStatusInput["gate"]): boolean {
  return (
    (gate.kind === "passed" && gate.via !== "code") ||
    (gate.kind === "not-required" &&
      (gate.reason === "no-detector" || gate.reason === "levels-unavailable"))
  );
}

/** A code lined the tour up: its votes were cast (after the escape too -
 *  the gate stays "skipped" when a later lock votes). */
function codeLinedUp(input: ArStatusInput): boolean {
  return input.qr.lockedText !== null && input.qr.votedLocks > 0;
}

/** The tour has no code that can lock (the photo ring needs one). */
function noUsableCodes(input: ArStatusInput): boolean {
  const { tour, gate } = input;
  return (
    (tour.kind === "open" && tour.levelCount === 0) ||
    (gate.kind === "not-required" &&
      (gate.reason === "no-lockable-level" ||
        gate.reason === "levels-unavailable"))
  );
}

function isPlaced(input: ArStatusInput): boolean {
  return input.placement.kind === "placed" || input.content.kind === "placed";
}

/** Placed: through the code, or by GPS - with the one hint that can still
 *  help (find the code) only after the escape, never when the code cannot
 *  line the tour up. */
function placedSentence(input: ArStatusInput): VisitorStatus {
  const { gate } = input;
  if (!gpsOnly(gate) || codeLinedUp(input)) {
    return { state: "placed", text: `Tour placed. ${LOOK_AROUND}` };
  }
  if (gate.kind === "not-required" && gate.reason === "no-detector") {
    return {
      state: "placed-gps",
      text: `${GPS_PLACED}: this browser can't read codes. ${LOOK_AROUND}`,
    };
  }
  if (gate.kind === "passed" && gate.via === "ignored") {
    return {
      state: "placed-gps",
      text: `${GPS_PLACED}: its code seems to have been moved. ${LOOK_AROUND}`,
    };
  }
  if (gate.kind === "passed" && gate.via === "skipped") {
    return {
      state: "placed-gps",
      text: `${GPS_PLACED}. ${LOOK_AROUND} Find the poster's code to line it up.`,
    };
  }
  return { state: "placed-gps", text: `${GPS_PLACED}. ${LOOK_AROUND}` };
}

/** The code situations that come before placement: they need the visitor
 *  to point elsewhere. Never once the tour is placed (a passing product
 *  code must not take over a placed tour; U1 review #3). */
function codeSentence(input: ArStatusInput): VisitorStatus | null {
  const { qr, gate } = input;
  const escape = gate.kind === "scanning" && gate.escapeOffered;
  if (qr.unknownCode !== null) {
    return {
      state: "code-other-tour",
      text: "This code isn't part of this tour. Point your phone at the tour's own code.",
    };
  }
  if (qr.unusableCode != null) {
    return {
      state: "code-unusable",
      text: escape
        ? "This code can't line up the tour. Point your phone at another of the tour's codes, or tap Continue with GPS only below."
        : "This code can't line up the tour. Point your phone at another of the tour's codes.",
    };
  }
  // The code is in view and its pose still settles (plan §66's hint):
  // guidance a visitor can act on, until its first vote.
  if (qr.fusedHint != null && qr.votedLocks === 0) {
    return { state: "measuring-code", text: qr.fusedHint };
  }
  if (gate.kind === "scanning") {
    return {
      state: "scan",
      text: escape
        ? "Point your phone at the tour's code (on the poster), or tap Continue with GPS only below."
        : "Point your phone at the tour's code (on the poster).",
    };
  }
  return null;
}

/** Nothing placed yet, the code situation settled: what is happening. */
function placementSentence(input: ArStatusInput): VisitorStatus {
  const { placement, gate, qr } = input;
  if (placement.kind === "placing") {
    return {
      state: "placing",
      text:
        placement.phase === "loading-photos"
          ? "Loading the photos…"
          : "Placing the photos…",
    };
  }
  if (placement.kind === "waiting-ready") {
    return {
      state: "warming-up",
      // The framework's coaching copy (DEC-H3: shared with the other apps).
      text:
        input.readiness?.hint ??
        "Move the phone slowly so it can see the surroundings.",
    };
  }
  const declined =
    placement.kind === "declined" || placement.kind === "nothing-to-place";
  // A declined photo join leaves the ring, which needs a code (U1 review
  // #2, the F3 case): with no code to lock there is nothing to show; after
  // the escape, the code would still show the photos.
  if (declined && noUsableCodes(input)) {
    return { state: "nothing", text: "This tour has nothing to show here." };
  }
  if (declined && gate.kind === "passed" && gate.via === "skipped") {
    return {
      state: "needs-code",
      text: "Nothing to show by GPS alone. Point your phone at the tour's code to show the photos.",
    };
  }
  if (qr.ignoredCode != null) {
    return {
      state: "code-moved",
      text: "This code seems to have been moved, so the tour is placed by GPS (less exact).",
    };
  }
  if (gate.kind === "passed" && gate.via === "code") {
    return { state: "locking", text: "Code found - placing the tour…" };
  }
  return {
    state: "placing",
    text: gpsOnly(gate)
      ? "Placing the tour by GPS (less exact)…"
      : "Placing the tour…",
  };
}

function runningSentence(input: ArStatusInput): VisitorStatus {
  if (input.tour.kind === "none") {
    return {
      state: "no-tour",
      text: "No tour is open here, so there is nothing to show. Open the tour's link again.",
    };
  }
  if (isPlaced(input)) {
    // Tracking lost after placing: the framework's hint (DEC-H3), since
    // the placed tour drifts until it recovers (U1 review #7).
    if (input.readiness?.phase === "ar-lost") {
      return { state: "tracking-lost", text: input.readiness.hint };
    }
    return placedSentence(input);
  }
  return codeSentence(input) ?? placementSentence(input);
}

/** The visitor's status for a state of the page. */
export function visitorStatus(input: ArStatusInput): VisitorStatus {
  if (input.arStatus !== "running") {
    return beforeRunning(input.arStatus, input.arError);
  }
  const main = runningSentence(input);
  const notes = loadNotes(input);
  return notes.length === 0
    ? main
    : { state: main.state, text: [main.text, ...notes].join(" ") };
}
