/**
 * The alignments a running authoring visit's objects settle through (owner
 * decision D33, authoring plan 2026-09-28-0953 §6): for every object placed
 * or moved in the visit, for the code measured in it, and for each stable
 * sighting of the code in hand, the FIRST MATURE alignment at or after that
 * moment (`gps-plus-slam-app-framework/state/alignment-maturity`, 40 m of
 * session GPS extent) - or, while none has matured, the latest usable one,
 * which at the visit's end IS the end-of-visit fallback.
 *
 * WHY. The settle used to compose everything through the visit's alignment
 * at its END, so a note placed early and walked away from inherited all the
 * SLAM drift after it (8.4 m at 500 m and 1 % / 1 deg per 100 m,
 * `visit-settle.left-behind.test.ts`). The store keeps only the current
 * alignment, so the picks are folded here while it evolves; nothing is
 * dispatched or persisted (a replay re-solves the same alignments).
 *
 * The rule itself is the framework's (DEC-H3: the QR mint, the GPS anchor's
 * `'mature-alignment'` start-up and this settle fold the same pick); this
 * module only keys it by object, measurement and sighting, and keeps the
 * events' times and walked distances for "the code event nearest each note"
 * (D33, D10b; reviews R1 and R3).
 *
 * @see visit-alignment-picks.ts.md
 */

import type { MintAlignmentInfo } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import {
  advanceMatureAlignmentPick,
  openMatureAlignmentPick,
  type AlignmentMoment,
  type MatureAlignmentPick,
} from "gps-plus-slam-app-framework/state/alignment-maturity";

import type {
  CodeSighting,
  TimedAlignment,
  VisitAlignmentPicks,
} from "./visit-settle.js";

/**
 * Sightings within this window (ms) of the first one of a run are one
 * sighting: the newest replaces the rest, so the list keeps about one entry
 * per second of looking. A stable code is re-evaluated many times a second
 * while in view; "the sighting nearest a note" needs a resolution of the
 * walk's drift, about 1 cm per second at 1 % and walking pace, so 1 s loses
 * nothing measurable. It would matter only above tens of seconds.
 */
export const SIGHTING_SPACING_MS = 1_000;

/**
 * The alignment as it stands at one moment, with what the mint gate knows
 * about it (fix count, GPS accuracy): a code re-minted through a pick
 * records the quality block of THAT alignment, not of the visit end one.
 */
interface PickedAlignmentMoment extends AlignmentMoment {
  readonly alignmentInfo?: MintAlignmentInfo | undefined;
  /** How far the author has walked in the visit by now
   *  (`walked-distance-tracker.ts`); absent when the caller does not know. */
  readonly walkedM?: number | undefined;
}

export interface VisitAlignmentTracker {
  /** The alignment as it stands now (call on every change, and before
   *  every note below). */
  noteAlignment(now: PickedAlignmentMoment): void;
  /** An object was placed, or moved, at `atMs` (re-opens it). */
  notePlacement(id: string, atMs: number): void;
  /** The code was measured in this visit at `atMs` (re-opens it). */
  noteMeasurement(atMs: number): void;
  /** A stable sighting of the code in hand at `atMs`. */
  noteSighting(sighting: CodeSighting, atMs: number): void;
  /** What the settle reads: every pick as it stands now. */
  picks(): VisitAlignmentPicks;
  /** Forget everything (a new visit). */
  reset(): void;
}

interface Timed {
  readonly atMs: number;
  /** The walked distance at the event's own moment (R1, R3 of D33). */
  readonly walkedM: number | undefined;
  pick: MatureAlignmentPick<PickedAlignmentMoment>;
}

const NO_ALIGNMENT: PickedAlignmentMoment = {
  alignmentMatrix: null,
  zero: null,
};

/** A pick's alignment as the settle reads it: 16 numbers, or null when no
 *  usable alignment was ever seen (the settle then uses the end one). */
function timedAlignment(t: Timed): TimedAlignment {
  const {
    alignmentMatrix: matrix,
    alignmentInfo,
    gpsExtentM,
  } = t.pick.alignment;
  const walked = t.walkedM === undefined ? {} : { walkedM: t.walkedM };
  if (matrix === null) return { atMs: t.atMs, alignment: null, ...walked };
  return {
    atMs: t.atMs,
    ...walked,
    ...(gpsExtentM === undefined ? {} : { gpsExtentM }),
    alignment: Array.from(matrix),
    ...(alignmentInfo === undefined
      ? {}
      : { alignmentInfo: { ...alignmentInfo } }),
  };
}

export function createVisitAlignmentTracker(): VisitAlignmentTracker {
  let current: PickedAlignmentMoment = NO_ALIGNMENT;
  const objects = new Map<string, Timed>();
  let measurement: Timed | null = null;
  /** `windowStartMs`: when the run this entry stands for began. */
  const sightings: (Timed & {
    readonly sighting: CodeSighting;
    readonly windowStartMs: number;
  })[] = [];

  const open = (atMs: number): Timed => ({
    atMs,
    walkedM:
      typeof current.walkedM === "number" && Number.isFinite(current.walkedM)
        ? current.walkedM
        : undefined,
    pick: openMatureAlignmentPick(current),
  });
  const advance = (t: Timed): void => {
    t.pick = advanceMatureAlignmentPick(t.pick, current);
  };

  return {
    noteAlignment(now) {
      current = now;
      for (const t of objects.values()) advance(t);
      if (measurement !== null) advance(measurement);
      for (const t of sightings) advance(t);
    },
    notePlacement(id, atMs) {
      objects.set(id, open(atMs));
    },
    noteMeasurement(atMs) {
      measurement = open(atMs);
    },
    noteSighting(sighting, atMs) {
      const last = sightings.at(-1);
      const sameRun =
        last !== undefined &&
        last.sighting.levelId === sighting.levelId &&
        atMs - last.windowStartMs < SIGHTING_SPACING_MS;
      if (sameRun) sightings.pop();
      sightings.push({
        ...open(atMs),
        sighting,
        windowStartMs:
          sameRun && last !== undefined ? last.windowStartMs : atMs,
      });
    },
    picks() {
      return {
        objects: new Map(
          [...objects].map(([id, t]) => [id, timedAlignment(t)] as const),
        ),
        measurement: measurement === null ? null : timedAlignment(measurement),
        sightings: sightings.map((t) => ({
          ...timedAlignment(t),
          sighting: t.sighting,
        })),
      };
    },
    reset() {
      current = NO_ALIGNMENT;
      objects.clear();
      measurement = null;
      sightings.length = 0;
    },
  };
}
