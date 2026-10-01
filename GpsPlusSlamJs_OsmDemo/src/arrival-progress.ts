/**
 * The arrival prefetch's progress, 0 to 1, from its real signals: how many
 * of the plan's jobs have settled, as cache hits (`warm`), as fetches, or as
 * failures. Pure. Read every frame by the globe's flight clock (round-5
 * plan 2026-10-01-0945 §3.6; `flight-pace.ts`).
 *
 * WHY A FAILURE COUNTS AS SETTLED. The progress answers "how much of the
 * wait is over", not "how much is warm": once a job has failed, waiting
 * longer warms nothing, so the flight should not hold the cold pace for it.
 * How much was actually warmed is in the counts (`warm + fetched`).
 *
 * WHY WEIGHTED BY BYTES. A cold res-7 Overpass tile is about 21 MB and
 * 15-90 s (`prefetch-queue.ts`), a DEM tile 0.1-0.3 MB; counted equally,
 * eight DEM tiles landing in a second would read as 80 % done while the
 * one tile that matters had not started.
 *
 * @see arrival-progress.ts.md
 */

/** One kind of job: how many the plan has, and how each one ended. */
export interface JobCounts {
  readonly total: number;
  /** Already in the cache when the prefetch looked (no network). */
  readonly warm: number;
  /** Fetched and stored. */
  readonly fetched: number;
  /** Given up on (network, HTTP status, timeout). Settled, not warm. */
  readonly failed: number;
}

export interface ArrivalCounts {
  readonly overpass: JobCounts;
  readonly dem: JobCounts;
}

/**
 * Expected bytes per job, the weights. Overpass: about 21 MB per cold res-7
 * tile (`fetch-extent.ts`, the 2026-08-01 sweep). DEM: about 0.2 MB, between
 * an AWS 256 px PNG (about 0.1 MB) and a Mapterhorn 512 px WebP (about
 * 0.3 MB, `caching-tile-fetch.ts`).
 */
export const ARRIVAL_JOB_WEIGHTS = {
  overpass: 21_000_000,
  dem: 200_000,
} as const;

/** A count as a non-negative integer; anything else is 0. */
function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function settledOf(job: JobCounts): { settled: number; total: number } {
  const total = count(job.total);
  const settled = Math.min(
    total,
    count(job.warm) + count(job.fetched) + count(job.failed),
  );
  return { settled, total };
}

/** Whether every job of the plan has settled (an empty plan has). */
export function arrivalSettled(counts: ArrivalCounts): boolean {
  return [counts.overpass, counts.dem].every((job) => {
    const { settled, total } = settledOf(job);
    return settled === total;
  });
}

/**
 * The share of the expected bytes whose jobs have settled, in [0, 1]. It
 * is 1 exactly when {@link arrivalSettled}; an empty plan is 1.
 */
export function arrivalProgress(
  counts: ArrivalCounts,
  weights: {
    readonly overpass: number;
    readonly dem: number;
  } = ARRIVAL_JOB_WEIGHTS,
): number {
  if (arrivalSettled(counts)) return 1;
  const osm = settledOf(counts.overpass);
  const dem = settledOf(counts.dem);
  const done = weights.overpass * osm.settled + weights.dem * dem.settled;
  const all = weights.overpass * osm.total + weights.dem * dem.total;
  const share = all > 0 ? done / all : 0;
  // Not settled is never quite 1, however the floating point rounds: the
  // flight treats 1 as "go".
  return Math.min(share, 1 - Number.EPSILON);
}
