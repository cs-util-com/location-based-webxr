/**
 * The approach's one quiet line under its bar, pure: which words name
 * what is still loading, and a hold that keeps each wording on screen long
 * enough to be read (a line that flickers between two words every frame
 * says nothing, and would flood a screen reader).
 *
 * The box's fixed title says "Loading tour"; the line under it carries
 * only the detail. The words never name internal concepts: "Loading
 * stations" while the tour's own objects are on their way, "Loading
 * textures" while the ground's imagery is, and "Loading buildings" while
 * buildings are; nothing while nothing is named.
 *
 * @see approach-status.ts.md
 */

/** The approach box's fixed title, over the bar. */
export const APPROACH_TITLE = "Loading tour";

export const APPROACH_LINES = Object.freeze({
  tour: "Loading stations",
  textures: "Loading textures",
  buildings: "Loading buildings",
});

export type ApproachLine = (typeof APPROACH_LINES)[keyof typeof APPROACH_LINES];

/** What is still on its way (counts; a count that is not a positive
 *  number reads as nothing waiting). */
export interface ApproachPending {
  readonly tour: number;
  readonly textures: number;
  readonly buildings: number;
}

const waiting = (n: number): boolean => Number.isFinite(n) && n > 0;

/**
 * The line's words for `pending`, or null when nothing is waiting. The
 * tour comes first (its stations are what the creator came for), then the
 * textures, then the buildings.
 */
export function approachLine(pending: ApproachPending): ApproachLine | null {
  if (waiting(pending.tour)) return APPROACH_LINES.tour;
  if (waiting(pending.textures)) return APPROACH_LINES.textures;
  if (waiting(pending.buildings)) return APPROACH_LINES.buildings;
  return null;
}

/** The hold's timing: a wording stays at least this long (ms). */
export const LINE_HOLD_MS = 600;

/**
 * A line that changes its shown words only once they have been shown for
 * `holdMs`: `step(nowMs, wanted)` returns the words to show now. A change
 * that comes sooner waits (the latest wanted words win when the hold
 * ends), so the line changes at most once per `holdMs`. RangeError for a
 * hold that is not a number >= 0.
 */
export function createLineHold(holdMs: number = LINE_HOLD_MS): {
  step(nowMs: number, wanted: ApproachLine | null): ApproachLine | null;
  readonly shown: ApproachLine | null;
} {
  if (!(Number.isFinite(holdMs) && holdMs >= 0)) {
    throw new RangeError(`a hold must be a number >= 0, got ${String(holdMs)}`);
  }
  let shown: ApproachLine | null = null;
  let since = Number.NEGATIVE_INFINITY;
  return {
    step(nowMs, wanted) {
      if (wanted !== shown && nowMs - since >= holdMs) {
        shown = wanted;
        since = nowMs;
      }
      return shown;
    },
    get shown() {
      return shown;
    },
  };
}
