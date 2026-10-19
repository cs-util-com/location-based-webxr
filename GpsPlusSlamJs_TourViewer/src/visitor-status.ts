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

import { codeLinedUp, type ArStatusInput } from "./tour-flow.js";
/** The in-AR scan line without location (QR-first M1b-1), under the scan
 *  card's title ("Scan the code again so the tour can start"): what the
 *  absence of location means, not a second "scan". */
const CODES_ONLY_SCAN_LINE =
  "Without location, the tour's printed codes place it - any of them will do.";

/** Without location, why nothing can place the tour, per waived gate
 *  (QR-first M1b-1 review #2): never a "placed by GPS" line. */
const CODES_ONLY_NOTHING: Record<
  "no-detector" | "no-lockable-level" | "levels-unavailable",
  string
> = {
  "no-detector":
    "This browser can't read the tour's codes, and without location nothing can place the tour.",
  "no-lockable-level":
    "This tour has no printed codes, and without location nothing can place it.",
  "levels-unavailable":
    "The tour's code file could not be read, and without location nothing can place it.",
};

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
  | "to-station"
  | "placed-gps"
  | "tracking-lost"
  | "finding-direction"
  | "needs-code"
  | "nothing";

export interface VisitorStatus {
  readonly state: VisitorStatusState;
  /** The sentence, with what could not load after it; "" when the page's
   *  own screen speaks (before AR). */
  readonly text: string;
}

const LOOK_AROUND = "Look around.";
/** Placed, every piece of content waiting at a station the visitor is not
 *  at: nothing is in view to look at. */
const TO_STATION = "Walk to a station to see its content.";
const GPS_PLACED = "Tour placed by GPS (less exact)";

/** The guide waits for a heading (D34): the arrows, the breadcrumbs and a
 *  story's figure need one, and a few steps give it. */
const WALK = "Walk a few steps so the guide knows the direction.";

/** Whether the line asks for a few steps (D34): the guide waits for a
 *  heading, tracking runs - not while it initializes (the coaching says
 *  hold steady) nor once it is lost (its own hint is the cure) - and
 *  walking can earn one: never without location, where only a code gives a
 *  heading (after a veto, too). */
function asksForSteps(input: ArStatusInput): boolean {
  const phase = input.readiness?.phase;
  return (
    input.stationsAwaitHeading === true &&
    input.codesOnly !== true &&
    phase !== undefined &&
    phase !== "initializing" &&
    phase !== "ar-lost"
  );
}

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
    return "This phone can't start AR for this tour, which needs an Android phone with Chrome. Open this page there.";
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
        // The button under it copies the link (polish round M4a, V4).
        text: "This tour needs an Android phone with Chrome, and this phone or browser can't show it in AR. Copy the link and open it in Chrome on an Android phone.",
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
 *  line the tour up. While the guide waits for a heading (`walk`, D34) the
 *  bare placed line gives way to the request; a GPS placement keeps its
 *  reason, the request in place of "Look around.". Away from every
 *  station (`awayFromStations`) "Look around." gives way to the station
 *  request; the request for steps still comes first, since walking
 *  answers both. */
function placedSentence(input: ArStatusInput, walk: boolean): VisitorStatus {
  const { gate } = input;
  const away = input.awayFromStations === true;
  if (!gpsOnly(gate) || codeLinedUp(input.qr)) {
    if (walk) return { state: "finding-direction", text: WALK };
    return away
      ? { state: "to-station", text: TO_STATION }
      : { state: "placed", text: `Tour placed. ${LOOK_AROUND}` };
  }
  const next = walk ? WALK : away ? TO_STATION : LOOK_AROUND;
  if (gate.kind === "not-required" && gate.reason === "no-detector") {
    return {
      state: "placed-gps",
      text: `${GPS_PLACED}: this browser can't read codes. ${next}`,
    };
  }
  if (gate.kind === "passed" && gate.via === "ignored") {
    return {
      state: "placed-gps",
      text: `${GPS_PLACED}: its code seems to have been moved. ${next}`,
    };
  }
  if (gate.kind === "passed" && gate.via === "skipped") {
    return {
      state: "placed-gps",
      text: `${GPS_PLACED}. ${next} Find the poster's code to line it up.`,
    };
  }
  return { state: "placed-gps", text: `${GPS_PLACED}. ${next}` };
}

/** The code is in view and its pose still settles (plan §66's hint):
 *  guidance a visitor can act on, until its first vote. The page passes
 *  no hint for the code the moved-code check ignores (`ar-entry.ts`),
 *  only for the code evaluated, so a veto never hides another code's
 *  (r881 re-review L1). */
function measuringHint(qr: ArStatusInput["qr"]): string | null {
  if (qr.votedLocks > 0) return null;
  return qr.fusedHint ?? null;
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
  const hint = measuringHint(qr);
  if (hint !== null) return { state: "measuring-code", text: hint };
  if (gate.kind === "scanning") {
    // Without location the codes are the only way in (QR-first M1b-1).
    if (input.codesOnly === true) {
      return { state: "scan", text: CODES_ONLY_SCAN_LINE };
    }
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
  // Without location, a gate waived for any reason but the creator's
  // leaves nothing that can place the tour (QR-first M1b-1, review #2).
  if (
    input.codesOnly === true &&
    input.gate.kind === "not-required" &&
    input.gate.reason !== "creator"
  ) {
    return { state: "nothing", text: CODES_ONLY_NOTHING[input.gate.reason] };
  }
  if (isPlaced(input)) {
    // Tracking lost after placing: the framework's hint (DEC-H3), since
    // the placed tour drifts until it recovers (U1 review #7).
    if (input.readiness?.phase === "ar-lost") {
      return { state: "tracking-lost", text: input.readiness.hint };
    }
    return placedSentence(input, asksForSteps(input));
  }
  // A code situation needs the visitor to point elsewhere first; any other
  // sentence keeps what it says, the guide's wait for a heading after it
  // (D34).
  const code = codeSentence(input);
  if (code !== null) return code;
  return withWalkRequest(input, placementSentence(input));
}

/** The placing line, with the walk request after it while the guide waits
 *  for a heading - except at a dead end: no step makes a tour with nothing
 *  to show, or one that only a code can place, appear. */
function withWalkRequest(
  input: ArStatusInput,
  placing: VisitorStatus,
): VisitorStatus {
  const deadEnd = placing.state === "nothing" || placing.state === "needs-code";
  return asksForSteps(input) && !deadEnd
    ? { state: placing.state, text: `${placing.text} ${WALK}` }
    : placing;
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
