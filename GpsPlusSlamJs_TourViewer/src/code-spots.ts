/**
 * Whether a stored code moved, decided by the system with no question
 * (code book plan, M6 v5; owner decisions before the AFK days). Pure: the
 * settle measures each sighting's distance from every KNOWN spot of the code
 * with the viewer's rigid fit, and this decides.
 *
 * ONE TEST. A sighting belongs to the nearest known spot whose fit is within
 * the floor (`MOVED_CODE_FLOOR_M`, the viewer's), or to no spot. The known
 * spots are the code's current pose, the pose an automatic move left
 * (`previous`) and the spots found to hold a second print (`copies`):
 * - seen at the current spot (by ANY sighting of the visit): nothing;
 * - seen at `previous`: the move is undone, and the spot it had moved to is
 *   a second print (the owner's rule);
 * - seen at a copy: nothing, it is the second print;
 * - seen at no spot, and the pose a move would mint also clear of every
 *   spot: the code moves;
 * - seen at the current spot a day or more after an automatic move: the move
 *   is confirmed.
 *
 * A spot the code leaves for good (the spot before a second move, the spot a
 * confirmed move left) is kept as a copy: forgetting it let three prints, or
 * two prints visited a day apart, move the code on every visit.
 *
 * Measured on the real-walk corpus (`code-displacement.recordings.test.ts`,
 * `D20_REAL=m6`): 0.4 % of unmoved code-visits trigger, at 1 of 42 points;
 * 94 % of 30 m moves are caught; a false move from a biased visit is undone
 * by every later walk measured; a real 20 m move is falsely undone on 0.5 %.
 *
 * @see code-spots.ts.md
 */

import { MOVED_CODE_FLOOR_M } from "./code-displacement.js";

/** A known spot of one code. */
export type SpotRef =
  | { readonly kind: "current" }
  | { readonly kind: "previous" }
  | { readonly kind: "copy"; readonly index: number };

/** One sighting's fit against each known spot: the distance (m) at which
 *  it reads the code from that spot. Empty: the visit had no gated fit. */
export interface SightingFit {
  readonly distancesM: readonly {
    readonly spot: SpotRef;
    readonly m: number;
  }[];
}

export type CodeSpotDecision =
  | {
      readonly kind: "none";
      readonly reason: "not-judged" | "at-current" | "near-known";
    }
  | { readonly kind: "copy"; readonly index: number }
  | { readonly kind: "undo" }
  | { readonly kind: "move" }
  /** Seen at the current spot a day or more after an automatic move: the
   *  move stands, and the spot it left becomes a copy (M6 v5.1). */
  | { readonly kind: "confirm" };

/** The second prints a level remembers; the oldest is dropped first. */
export const MAX_CODE_COPIES = 4;

function checkFloor(floorM: number): void {
  if (!Number.isFinite(floorM) || floorM <= 0) {
    throw new RangeError(`floor must be a positive number, got ${floorM}`);
  }
}

/**
 * The known spot a sighting belongs to: the nearest within `floorM`, the
 * current spot winning a tie; "new" when none is within it; null without a
 * fit. A non-finite distance never matches.
 */
export function nearestSpot(
  fit: SightingFit,
  floorM: number = MOVED_CODE_FLOOR_M,
): SpotRef | "new" | null {
  checkFloor(floorM);
  if (fit.distancesM.length === 0) return null;
  const within = fit.distancesM.filter(
    (d) => Number.isFinite(d.m) && d.m < floorM,
  );
  const best = within.reduce<(typeof within)[number] | null>(
    (b, d) => (b === null || nearer(d, b) ? d : b),
    null,
  );
  return best === null ? "new" : best.spot;
}

/** `a` is nearer than `b`; the current spot wins a tie. */
const nearer = (
  a: { spot: SpotRef; m: number },
  b: { spot: SpotRef; m: number },
): boolean => a.m < b.m || (a.m === b.m && a.spot.kind === "current");

/** The decision for a sighting that belongs to a known spot. */
function decisionAt(spot: SpotRef): CodeSpotDecision {
  switch (spot.kind) {
    case "previous":
      return { kind: "undo" };
    case "copy":
      return { kind: "copy", index: spot.index };
    case "current":
      return { kind: "none", reason: "at-current" };
  }
}

/**
 * @param input.sightings the visit's kept sightings of the code, oldest
 *   first
 * @param input.candidateDistancesM how far the pose a move would mint lies
 *   from each known spot (m)
 * @param input.reliable the visit's walk is reliable (U3's `isReliable`)
 * @param input.previousExpires the code has a `previous` spot and this
 *   visit is at least a day after the move: a sighting at the current spot
 *   then confirms the move
 * @param input.frameChanged the odometry frame changed during the visit:
 *   fixes and sightings are then not in one frame
 */
export function decideCodeSpot(input: {
  sightings: readonly SightingFit[];
  candidateDistancesM: readonly number[];
  reliable: boolean;
  frameChanged: boolean;
  previousExpires?: boolean;
  floorM?: number;
}): CodeSpotDecision {
  const floorM = input.floorM ?? MOVED_CODE_FLOOR_M;
  checkFloor(floorM);
  if (!input.reliable || input.frameChanged) {
    return { kind: "none", reason: "not-judged" };
  }
  const judged = input.sightings
    .map((s) => nearestSpot(s, floorM))
    .filter((s): s is SpotRef | "new" => s !== null);
  // A visit that saw the code at home too was looking at a second print,
  // whichever it saw last.
  if (judged.some((s) => s !== "new" && s.kind === "current")) {
    return input.previousExpires === true
      ? { kind: "confirm" }
      : { kind: "none", reason: "at-current" };
  }
  const latest = judged.at(-1);
  if (latest === undefined) return { kind: "none", reason: "not-judged" };
  if (latest !== "new") return decisionAt(latest);
  // The move mints the candidate, so it too must clear every known spot:
  // otherwise two known spots could end up closer than the floor.
  const clear = input.candidateDistancesM.every(
    (m) => Number.isFinite(m) && m >= floorM,
  );
  return clear ? { kind: "move" } : { kind: "none", reason: "near-known" };
}

/** A code's known spots, as its level file remembers them. */
export interface CodeSpotMemory<S> {
  readonly current: S;
  /** The spot an automatic move left, until the move is undone or another
   *  move replaces it. */
  readonly previous: S | null;
  /** Spots holding a second print, oldest first. */
  readonly copies: readonly S[];
}

/**
 * The memory after `decision`: a move keeps the old spot as `previous`; an
 * undo restores `previous` exactly and remembers the spot it had moved to
 * as a copy. Anything else returns `memory` itself.
 *
 * @param moveTo the pose a move mints (unused otherwise)
 * @throws RangeError for an undo without a `previous` spot
 */
export function applyCodeSpotDecision<S>(
  memory: CodeSpotMemory<S>,
  decision: CodeSpotDecision,
  moveTo: S,
): CodeSpotMemory<S> {
  // A spot the code leaves for good is kept as a copy: forgetting it let
  // three prints, or two visited a day apart, move the code on every visit.
  const keep = (spot: S | null): readonly S[] =>
    spot === null
      ? memory.copies
      : [...memory.copies, spot].slice(-MAX_CODE_COPIES);
  if (decision.kind === "move") {
    return {
      current: moveTo,
      previous: memory.current,
      copies: keep(memory.previous),
    };
  }
  if (decision.kind === "undo") {
    if (memory.previous === null) {
      throw new RangeError("an undo needs the spot the code was moved from");
    }
    return {
      current: memory.previous,
      previous: null,
      copies: keep(memory.current),
    };
  }
  if (decision.kind === "confirm") {
    return { ...memory, previous: null, copies: keep(memory.previous) };
  }
  return memory;
}
