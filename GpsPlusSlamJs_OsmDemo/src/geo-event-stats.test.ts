/**
 * WHY THESE TESTS MATTER (DEC-G7, W7).
 *
 * The counters themselves are produced by the worker and asserted where they
 * are produced. What this file protects is the READING: a benchmark line is
 * only useful if the number that decides the next move is impossible to miss,
 * and `pinnedOverCap` is that number. It is the plan's falsifiable prediction —
 * a geo-event pins the union over up to seven tiles, ~1300 chunks against a
 * 488-chunk cap, so it should be non-zero — and the index's own comment calls a
 * non-zero value a bug. A line that renders it the same way as any other
 * counter would let the answer scroll past.
 */

import { describe, expect, it } from "vitest";

import {
  describeGeoEventStats,
  type GeoEventStats,
} from "./geo-event-stats.js";

const BASE: GeoEventStats = {
  reachCells: 8918,
  tilesFetched: 0,
  climbsStarted: 70,
  heatLookups: 2450,
  chunksPinnedPeak: 1330,
  pinnedOverCap: 0,
  deriveMs: 12.4,
  ensureMs: 4820.7,
  climbMs: 391.2,
};

describe("describeGeoEventStats", () => {
  it("leads with the three phases, because that is what picks the lever", () => {
    // If `ensure` dominates the lever is the size of the reach; if `climb`
    // does, it is the step count or parallelism; if neither, the 5-10 s is
    // somewhere this does not measure and the next round instruments that.
    const line = describeGeoEventStats(BASE);
    expect(line.indexOf("derive")).toBeLessThan(line.indexOf("ensure"));
    expect(line.indexOf("ensure")).toBeLessThan(line.indexOf("climb"));
    expect(line).toContain("derive 12 ms");
    expect(line).toContain("ensure 4821 ms");
  });

  it("reports climbs and lookups as SEPARATE numbers", () => {
    // They differ by two orders of magnitude and mean different things: a climb
    // starting on unscored ground costs one lookup, a climb with somewhere to
    // go costs steps x neighbours. Collapsing them into "70 climbs" would hide
    // the entire cost model.
    expect(describeGeoEventStats(BASE)).toContain("70 climbs / 2450 lookups");
  });

  it("says nothing about the cap when the pinned set fits", () => {
    // The quiet case has to stay quiet, or the loud case below stops carrying
    // any signal.
    expect(describeGeoEventStats(BASE)).not.toContain("OVER CAP");
  });

  it("SHOUTS when the pinned set exceeded the cap", () => {
    // The prediction the round exists to test. The index's own comment calls a
    // non-zero value here "a bug rather than normal use" — for a geo-event it
    // is the expected outcome, and either way it is the number that decides
    // what W8 does, so it must not read like the six counters beside it.
    const line = describeGeoEventStats({ ...BASE, pinnedOverCap: 842 });
    expect(line).toContain("842 OVER CAP");
  });
});
