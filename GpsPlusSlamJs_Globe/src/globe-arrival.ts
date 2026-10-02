/**
 * The pin's arrival, as the globe lab shows and times it (round-5 plan
 * 2026-10-01-0945 §3.6): the status line that says how the city's data is
 * loading, and the dive's clock, paced by that loading (`flight-pace.ts`)
 * or fixed by hand (`diveMs`). Pure, apart from the clock's own state.
 *
 * The counts are OsmDemo's arrival prefetch's (`arrival-progress.ts` there),
 * declared here structurally: this package does not depend on OsmDemo.
 *
 * @see globe-arrival.ts.md
 */

import {
  startPace,
  stepPace,
  type FlightPaceParams,
  type FlightPaceState,
} from "./flight-pace.js";

/** One kind of job, as the prefetch counts it. */
export interface ArrivalJobs {
  readonly total: number;
  readonly warm: number;
  readonly fetched: number;
  readonly failed: number;
}

/** What the status line is built from. */
export interface ArrivalSnapshot {
  /**
   * The prefetch's outcome once it ended (`settled`, `aborted`,
   * `no-persistent-store`, `store-unwritable`, `invalid-target`), the lab's
   * own `unavailable` when its module could not load, or null while it runs.
   */
  readonly outcome: string | null;
  readonly counts: {
    readonly overpass: ArrivalJobs;
    readonly dem: ArrivalJobs;
  };
}

function sum(a: ArrivalJobs, b: ArrivalJobs): ArrivalJobs {
  return {
    total: a.total + b.total,
    warm: a.warm + b.warm,
    fetched: a.fetched + b.fetched,
    failed: a.failed + b.failed,
  };
}

/**
 * The status line: tiles warmed of the total and whether the cache was cold
 * or warm while loading; how it ended afterwards.
 */
export function arrivalStatusText(snapshot: ArrivalSnapshot): string {
  const all = sum(snapshot.counts.overpass, snapshot.counts.dem);
  const ofTotal = `${all.warm + all.fetched} of ${all.total} tiles`;
  if (snapshot.outcome === null) return runningText(all, ofTotal);
  if (snapshot.outcome === "settled") return settledText(all, ofTotal);
  return ENDED[snapshot.outcome] ?? ENDED.unavailable!;
}

/** While it runs: checking, then cold (with what was stored) or warm. */
function runningText(all: ArrivalJobs, ofTotal: string): string {
  if (all.total === 0) return "City data: checking what is stored...";
  if (all.warm === all.total) {
    return `City data: already stored (${ofTotal}), warm.`;
  }
  const stored = all.warm > 0 ? ` (${all.warm} were stored)` : "";
  return `City data loading: ${ofTotal}, cold${stored}...`;
}

/** Every job ended: warm, ready, or ready with failures. */
function settledText(all: ArrivalJobs, ofTotal: string): string {
  if (all.warm === all.total) {
    return `City data already stored (${ofTotal}): warm.`;
  }
  return all.failed > 0
    ? `City data: ${ofTotal} ready, ${all.failed} failed.`
    : `City data ready: ${ofTotal}.`;
}

/** The other ends, by outcome (`unavailable` also stands for any unknown). */
const ENDED: Readonly<Record<string, string>> = {
  aborted: "City data: loading stopped.",
  "no-persistent-store":
    "City data cannot be stored here; the city loads it on arrival.",
  "store-unwritable":
    "City data cannot be stored here; the city loads it on arrival.",
  "invalid-target": "City data: no city data for this place.",
  unavailable:
    "City data: the loader could not start; the city loads it on arrival.",
};

/** How the dive is timed. */
export type DiveClockMode =
  | { readonly kind: "fixed"; readonly durationMs: number }
  | {
      readonly kind: "paced";
      readonly durationMs: number;
      readonly pace: FlightPaceParams;
    };

/** The dive's clock: the elapsed time `diveStep` is given. */
export interface DiveClock {
  /** Whether the prefetch paces it (false: the fixed `diveMs`). */
  readonly paced: boolean;
  /**
   * The dive's elapsed time for the real `elapsedMs` since the dive began
   * and the prefetch's `progress`: as it is when fixed; the path fraction
   * times `durationMs` when paced (so the dive's own easing stays).
   */
  elapsedMs(elapsedMs: number, progress: number): number;
  /** The path's rate, per ms (fixed: 1 / durationMs). */
  rate(): number;
}

/** A dive clock. RangeError for a duration that is not a positive number. */
export function createDiveClock(mode: DiveClockMode): DiveClock {
  const { durationMs } = mode;
  if (!(Number.isFinite(durationMs) && durationMs > 0)) {
    throw new RangeError(
      `durationMs must be a positive number, got ${durationMs}`,
    );
  }
  if (mode.kind === "fixed") {
    return {
      paced: false,
      elapsedMs: (elapsedMs) => elapsedMs,
      rate: () => 1 / durationMs,
    };
  }
  const { pace } = mode;
  let state: FlightPaceState = startPace(pace);
  return {
    paced: true,
    elapsedMs(elapsedMs, progress) {
      state = stepPace(state, progress, elapsedMs, pace);
      return state.done ? durationMs : state.s * durationMs;
    },
    rate: () => state.rate,
  };
}
