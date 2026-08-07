/**
 * What a geo-event search actually cost (DEC-G7, W7).
 *
 * WHY MEASURE BEFORE OPTIMISING, stated as the decision rather than as a slogan.
 * The session offered three explanations for "5–10 s on the phone with the data
 * already cached" — no early stop, climbs wandering too far, no parallelism —
 * and they predict DIFFERENT profiles, so one measurement picks the lever and
 * two of the three cost nothing to reject. One of them is already disproved on
 * the code alone: `newGeoEventFor` produces exactly one pick per tile and
 * `bestPickForTile` returns at the first passing batch, so there is no
 * post-sixth probing to remove.
 *
 * THE PREDICTION THIS EXISTS TO TEST, stated up front so a null result is still
 * a result. `affordance-index.ts` sizes one candidate batch at ~190 chunks and
 * concludes that against its 488-chunk cap "that cannot happen" — but a
 * geo-event pins the union over up to SEVEN tiles, on the order of ~1300. So
 * `pinnedOverCap` should be non-zero, and a zero is the interesting outcome,
 * because it would mean the reach is far smaller than the arithmetic says and
 * the cost is somewhere else entirely.
 *
 * WHY LOOKUPS RATHER THAN CLIMB COUNT ALONE. A climb that starts on unscored
 * ground returns after ONE lookup; a climb with somewhere to go does five steps
 * of seven-neighbour reads. So "how many climbs" and "how much work" are
 * different numbers by two orders of magnitude, and only the second one
 * explains a wall-clock figure.
 *
 * @see geo-event-stats.ts.md
 */

/** One search's counters and timings. Plain data — it crosses a worker. */
export interface GeoEventStats {
  /** Cells the ensure set covered, i.e. the derived reach of every climb. */
  readonly reachCells: number;
  /** Tiles that had to be downloaded before the climbs could start. */
  readonly tilesFetched: number;
  /** Climbs started — one per candidate evaluated, across every batch. */
  readonly climbsStarted: number;
  /**
   * Heat lookups, the honest measure of climb work.
   *
   * A climb starting on unscored ground costs one; a climb with somewhere to
   * go costs `steps × neighbours` — so this and {@link climbsStarted} differ by
   * two orders of magnitude, and only this one explains a wall-clock number.
   */
  readonly heatLookups: number;
  /** Chunks pinned at the peak of the search. */
  readonly chunksPinnedPeak: number;
  /**
   * How far the pinned set pushed the cache past its cap.
   *
   * The index calls a non-zero value here a bug in normal use. For a geo-event
   * it is the PREDICTION — see the module header — so it is reported rather
   * than assumed either way.
   */
  readonly pinnedOverCap: number;
  /** Deriving the reach, in ms: seeding batch 0 and expanding each candidate. */
  readonly deriveMs: number;
  /** Scoring that reach and downloading whatever it needed, in ms. */
  readonly ensureMs: number;
  /** The pinned climb itself, in ms. */
  readonly climbMs: number;
}

/** Milliseconds, rounded for display — sub-millisecond precision is noise. */
function ms(value: number): string {
  return `${Math.round(value)} ms`;
}

/**
 * One line for the status bar and the console.
 *
 * PHASES FIRST, because the whole point is which of the three dominates: if it
 * is `ensure`, the lever is the size of the reach; if it is `climb`, it is the
 * step count or parallelism; if it is neither, the 5–10 s is somewhere this does
 * not measure and the next round instruments that instead.
 */
export function describeGeoEventStats(stats: GeoEventStats): string {
  const overCap =
    stats.pinnedOverCap > 0 ? ` · ${stats.pinnedOverCap} OVER CAP` : "";
  return [
    `geo-event: derive ${ms(stats.deriveMs)}`,
    `ensure ${ms(stats.ensureMs)}`,
    `climb ${ms(stats.climbMs)}`,
    `${stats.reachCells} cells`,
    `${stats.tilesFetched} tiles fetched`,
    `${stats.climbsStarted} climbs / ${stats.heatLookups} lookups`,
    `${stats.chunksPinnedPeak} pinned${overCap}`,
  ].join(" · ");
}
