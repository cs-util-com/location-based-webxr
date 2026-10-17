/**
 * (Moved from OsmDemo's `arrival-progress.test.ts` with the module, round-4
 * plan 2026-10-11-0122 §5.)
 *
 * Why these tests matter: the globe's fly-in is paced by this number
 * (round-5 plan 2026-10-01-0945 §3.6; `flight-pace.ts` in the globe
 * package). It must come from the real signals (jobs settled, cache hits)
 * and keep three promises the pacing relies on: it never falls (a falling
 * progress would ask the camera to slow down for nothing), it reaches 1
 * exactly when every job has settled (or the flight would wait for work
 * that is already over), and an empty or failed plan reads as finished
 * rather than as "never started" (or a dead network would hold the flight
 * at the cold pace for no gain).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CITY_JOB_WEIGHTS,
  cityLoadProgress,
  cityLoadSettled,
  type CityLoadCounts,
  type CityJobCounts,
} from "./city-progress.js";

const none = (total: number): CityJobCounts => ({
  total,
  warm: 0,
  fetched: 0,
  failed: 0,
});

describe("cityLoadProgress", () => {
  it("is 0 before any job settles", () => {
    expect(cityLoadProgress({ overpass: none(2), dem: none(8) })).toBe(0);
  });

  it("is 1 when every job is settled, whichever way", () => {
    const counts: CityLoadCounts = {
      overpass: { total: 2, warm: 1, fetched: 0, failed: 1 },
      dem: { total: 8, warm: 3, fetched: 5, failed: 0 },
    };
    expect(cityLoadProgress(counts)).toBe(1);
    expect(cityLoadSettled(counts)).toBe(true);
  });

  it("weighs an Overpass tile far above a DEM tile (bytes, not counts)", () => {
    const oneTileOfTwo = cityLoadProgress({
      overpass: { total: 2, warm: 0, fetched: 1, failed: 0 },
      dem: none(8),
    });
    const allDemNoOsm = cityLoadProgress({
      overpass: none(2),
      dem: { total: 8, warm: 0, fetched: 8, failed: 0 },
    });
    expect(oneTileOfTwo).toBeGreaterThan(0.45);
    expect(allDemNoOsm).toBeLessThan(0.1);
    expect(CITY_JOB_WEIGHTS.overpass).toBeGreaterThan(CITY_JOB_WEIGHTS.dem);
  });

  it("reads an empty plan as finished", () => {
    const counts = { overpass: none(0), dem: none(0) };
    expect(cityLoadProgress(counts)).toBe(1);
    expect(cityLoadSettled(counts)).toBe(true);
  });

  it("is defensive against counts that overshoot or are not numbers", () => {
    expect(
      cityLoadProgress({
        overpass: { total: 1, warm: 5, fetched: 5, failed: 5 },
        dem: { total: Number.NaN, warm: -1, fetched: 0, failed: 0 },
      }),
    ).toBe(1);
  });
});

describe("cityLoadProgress over random counts", () => {
  const job = fc
    .record({
      total: fc.integer({ min: 0, max: 20 }),
      warm: fc.integer({ min: 0, max: 20 }),
      fetched: fc.integer({ min: 0, max: 20 }),
      failed: fc.integer({ min: 0, max: 20 }),
    })
    .map((j): CityJobCounts => ({
      total: j.total,
      warm: Math.min(j.warm, j.total),
      fetched: Math.min(j.fetched, j.total - Math.min(j.warm, j.total)),
      failed: 0,
    }));

  it("stays in [0, 1] and never falls as jobs settle", () => {
    fc.assert(
      fc.property(job, job, fc.integer({ min: 0, max: 5 }), (osm, dem, k) => {
        const before = cityLoadProgress({ overpass: osm, dem });
        const room = osm.total - osm.warm - osm.fetched;
        const after = cityLoadProgress({
          overpass: { ...osm, failed: Math.min(k, room) },
          dem,
        });
        expect(before).toBeGreaterThanOrEqual(0);
        expect(after).toBeLessThanOrEqual(1);
        expect(after).toBeGreaterThanOrEqual(before);
      }),
    );
  });

  it("is 1 exactly when everything has settled", () => {
    fc.assert(
      fc.property(job, job, (osm, dem) => {
        const counts = { overpass: osm, dem };
        expect(cityLoadProgress(counts) === 1).toBe(cityLoadSettled(counts));
      }),
    );
  });
});
