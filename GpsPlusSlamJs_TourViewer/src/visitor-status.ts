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
  | "nothing";

export interface VisitorStatus {
  readonly state: VisitorStatusState;
  /** The sentence, with what could not load after it; "" when the page's
   *  own screen speaks (before AR). */
  readonly text: string;
}

const LOOK_AROUND = "Look around.";

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

/** Why AR did not start, from the browser's error (its DOMException name
 *  leads the message): the two causes a visitor can act on, else a plain
 *  retry. */
function startFailureText(error: string | null | undefined): string {
  if (error != null && /NotAllowedError|permission/i.test(error)) {
    return "Camera access was blocked. Allow the camera for this site in the browser settings, then tap Try again.";
  }
  if (error != null && /NotSupportedError/.test(error)) {
    return "This phone can't start AR for this tour. Open this page in Chrome on an Android phone that supports AR.";
  }
  return "AR could not start. Tap Try again.";
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

function isPlaced(input: ArStatusInput): boolean {
  return input.placement.kind === "placed" || input.content.kind === "placed";
}

/** The code situations that outrank placement: they need the visitor to
 *  point elsewhere, or explain why GPS places the tour. */
function codeSentence(input: ArStatusInput): VisitorStatus | null {
  const { qr, gate } = input;
  if (qr.ignoredCode != null) {
    return {
      state: "code-moved",
      text: "This code seems to have been moved, so the tour is placed by GPS (less exact).",
    };
  }
  if (qr.unknownCode !== null) {
    return {
      state: "code-other-tour",
      text: "This code isn't part of this tour. Point your phone at the tour's own code.",
    };
  }
  if (qr.unusableCode != null) {
    return {
      state: "code-unusable",
      text: "This code can't line up the tour. Point your phone at another of the tour's codes, or continue with GPS only.",
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
      text: gate.escapeOffered
        ? "Point your phone at the tour's code (on the poster), or tap Continue with GPS only below."
        : "Point your phone at the tour's code (on the poster).",
    };
  }
  return null;
}

/** Placed: through the code, or by GPS (and why, when the browser cannot
 *  read codes at all). */
function placedSentence(gate: ArStatusInput["gate"]): VisitorStatus {
  if (!gpsOnly(gate)) {
    return { state: "placed", text: `Tour placed. ${LOOK_AROUND}` };
  }
  return {
    state: "placed-gps",
    text:
      gate.kind === "not-required" && gate.reason === "no-detector"
        ? `Tour placed by GPS (less exact): this browser can't read codes. ${LOOK_AROUND}`
        : `Tour placed by GPS (less exact). ${LOOK_AROUND} Find the poster's code to line it up.`,
  };
}

/** The placement's sentence once the code situation is settled. */
function placementSentence(input: ArStatusInput): VisitorStatus {
  const { placement, gate } = input;
  if (placement.kind === "nothing-to-place") {
    return { state: "nothing", text: "This tour has nothing to show here." };
  }
  if (placement.kind === "placing") {
    return {
      state: "placing",
      text:
        placement.phase === "loading-photos"
          ? `Loading photos (${String(placement.done)} of ${String(placement.total)})…`
          : "Placing the photos…",
    };
  }
  if (isPlaced(input)) return placedSentence(gate);
  if (placement.kind === "waiting-ready") {
    return {
      state: "warming-up",
      // The framework's coaching copy (DEC-H3: shared with the other apps).
      text:
        input.readiness?.hint ??
        "Move the phone slowly so it can see the surroundings.",
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

/** The visitor's status for a state of the page. */
export function visitorStatus(input: ArStatusInput): VisitorStatus {
  if (input.arStatus !== "running") {
    return beforeRunning(input.arStatus, input.arError);
  }
  const main = codeSentence(input) ?? placementSentence(input);
  const notes = loadNotes(input);
  return notes.length === 0
    ? main
    : { state: main.state, text: [main.text, ...notes].join(" ") };
}
