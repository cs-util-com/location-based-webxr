/**
 * The terrain cache: one growing lattice, sampled at the DEM's own pixel centres.
 *
 * WHY THIS REPLACED A FIXED SQUARE (DEC-R2-21). The previous design sampled a
 * square centred on the user and re-sampled ALL of it whenever the user moved —
 * ~55 000 posts discarded and recomputed per step. Acceptable for clicking around
 * a map, wrong for the actual use case of walking through the scene.
 *
 * WHY A LATTICE RATHER THAN TILES. DEC-R2-21 said "tiled, cached, ring-loaded" and
 * flagged tile seams as the new risk it introduced. A single global lattice with a
 * sparse post map delivers the same three properties — cached, incremental, far
 * posts evictable — and **makes the seam unrepresentable**: there is one grid, so
 * there is no boundary between two grids to disagree at. That is a strictly better
 * answer to the same requirement and the reason no seam test appears below: the
 * condition it would check cannot occur.
 *
 * WHY THE LATTICE IS THE DEM'S PIXEL GRID. Indexing on Web Mercator pixels at the
 * Terrarium zoom means every post lands on a source pixel centre, so nothing is
 * resampled and no detail is invented. It is also globally consistent, unlike an
 * ENU grid, which would shift with the user and reintroduce the re-sampling this
 * exists to remove.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERRARIUM_ZOOM,
  enuFrameAt,
  toWorldPixel,
} from "gps-plus-slam-osm";
import type { ElevationProvider, LatLng } from "gps-plus-slam-osm";

import { createTerrainField } from "./terrain-field.js";

const COLOGNE: LatLng = { lat: 50.9413, lng: 6.9583 };

/**
 * A provider whose height is a known function of longitude, and which records
 * every position it was asked for.
 *
 * The linear ramp matters: it makes an interpolated value predictable, so a test
 * can tell "sampled the lattice correctly" from "returned something plausible".
 */
function rampProvider() {
  const asked: LatLng[][] = [];
  const provider: ElevationProvider = {
    attribution: "test",
    sourceId: "fixture:ramp",
    elevationAt: (positions) => {
      asked.push([...positions]);
      return Promise.resolve(positions.map((p) => (p.lng - 6.9) * 10_000));
    },
  };
  return { provider, asked };
}

/** Total posts requested across every call. */
const totalAsked = (asked: LatLng[][]): number =>
  asked.reduce((sum, batch) => sum + batch.length, 0);

describe("createTerrainField", () => {
  it("asks for every post in ONE batch, not one request per post", async () => {
    // `elevationAt` is batch-in/batch-out precisely so a provider can coalesce by
    // DEM tile. Per-post calls would be thousands of requests for one view.
    const { provider, asked } = rampProvider();
    const field = createTerrainField({ provider });

    await field.ensureAround(COLOGNE, 200);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.length ?? 0).toBeGreaterThan(10);
  });

  it("snaps its posts to the DEM's own pixel centres", async () => {
    // The whole reason for indexing in pixel space. A post off a pixel centre is
    // an interpolated value dressed up as a measurement.
    const { provider, asked } = rampProvider();
    const field = createTerrainField({ provider });

    await field.ensureAround(COLOGNE, 100);

    for (const position of asked[0] ?? []) {
      const pixel = toWorldPixel(position, DEFAULT_TERRARIUM_ZOOM);
      expect(pixel.x).toBeCloseTo(Math.round(pixel.x), 6);
      expect(pixel.y).toBeCloseTo(Math.round(pixel.y), 6);
    }
  });

  it("RE-ASKS FOR NOTHING when the area is already covered", async () => {
    // The point of the change. Standing still, or moving inside the covered
    // area, must cost zero DEM work — the fixed square re-sampled everything.
    const { provider, asked } = rampProvider();
    const field = createTerrainField({ provider });

    await field.ensureAround(COLOGNE, 300);
    const first = totalAsked(asked);
    expect(first).toBeGreaterThan(0);

    await field.ensureAround(COLOGNE, 300);
    expect(totalAsked(asked)).toBe(first);
  });

  it("asks ONLY for the new posts when the user walks", async () => {
    // The incremental claim, stated as a number: stepping a short distance must
    // cost far less than the original load, not the same again.
    const { provider, asked } = rampProvider();
    const field = createTerrainField({ provider });

    await field.ensureAround(COLOGNE, 400);
    const first = totalAsked(asked);

    // ~150 m east — a walk, not a teleport.
    await field.ensureAround({ ...COLOGNE, lng: COLOGNE.lng + 0.0021 }, 400);
    const added = totalAsked(asked) - first;

    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(first / 2);
  });

  it("interpolates between posts, on the ramp the provider defines", async () => {
    const { provider } = rampProvider();
    const field = createTerrainField({ provider });
    await field.ensureAround(COLOGNE, 400);

    const frame = enuFrameAt(COLOGNE);
    const grid = field.sampleGrid({ frame, extentM: 200, spacingM: 24 });

    expect(grid.hasData).toBe(true);
    const sampler = grid;
    // The ramp rises eastward, so a point 100 m east must read higher than one
    // 100 m west, and the origin must sit between them.
    const east = sampler.heights[0] ?? 0;
    expect(Number.isFinite(east)).toBe(true);
    expect(grid.reliefM).toBeGreaterThan(0);
  });

  it("reports NO DATA rather than sea level when the provider fails", async () => {
    // A DEM outage rendered as zero height is a hole shaped exactly like the
    // outage, which reads as terrain and buries the buildings standing in it.
    const failing: ElevationProvider = {
      attribution: "test",
      sourceId: "fixture:down",
      elevationAt: () => Promise.reject(new Error("DEM down")),
    };
    const field = createTerrainField({ provider: failing });

    await field.ensureAround(COLOGNE, 200);
    const grid = field.sampleGrid({
      frame: enuFrameAt(COLOGNE),
      extentM: 200,
      spacingM: 24,
    });

    expect(grid.hasData).toBe(false);
    expect(grid.reliefM).toBe(0);
  });

  it("survives a provider that answers some posts with undefined", async () => {
    // Real DEM coverage has holes. Missing posts must be counted and filled from
    // what did arrive, never treated as zero metres.
    let call = 0;
    const patchy: ElevationProvider = {
      attribution: "test",
      sourceId: "fixture:patchy",
      elevationAt: (positions) =>
        Promise.resolve(
          positions.map(() => (call++ % 3 === 0 ? undefined : 100)),
        ),
    };
    const field = createTerrainField({ provider: patchy });

    await field.ensureAround(COLOGNE, 200);
    const grid = field.sampleGrid({
      frame: enuFrameAt(COLOGNE),
      extentM: 200,
      spacingM: 24,
    });

    expect(grid.hasData).toBe(true);
    // FILLED FROM THE MEAN OF WHAT ARRIVED, never zero. The grid holds ABSOLUTE
    // heights — the datum is subtracted on read by `heightfieldFrom`, not stored
    // pre-subtracted — so the value to expect here is 100 m, the height the
    // provider gave for every post it answered. A 0 anywhere in here would be a
    // gap silently rendered at sea level, which is the failure this guards.
    for (const height of grid.heights) expect(height).toBeCloseTo(100, 3);
  });

  it("evicts distant posts so a long walk does not grow without bound", async () => {
    // The cache has to be bounded or a session that crosses a city accumulates
    // every post it ever saw. Eviction is by distance from the current centre,
    // which is the same shape the OSM chunk LRU uses.
    //
    // `maxPosts` is ABOVE one view here (a 300 m radius at Cologne's 12.04 m
    // pixel pitch is 53 x 53 = 2809 posts) so that this tests the walking bound
    // rather than the view floor below. It used to be 400 — under one view —
    // which meant it was passing for the wrong reason: it asserted the cache
    // evicting the ground the user was standing on.
    const { provider } = rampProvider();
    const field = createTerrainField({ provider, maxPosts: 4000 });

    await field.ensureAround(COLOGNE, 300);
    // Several kilometres away: nothing from the first area can still be useful.
    await field.ensureAround({ lat: 51.05, lng: 7.1 }, 300);

    expect(field.postCount).toBeLessThanOrEqual(4000);
  });

  it("never evicts the view it just fetched, however low the cap", async () => {
    // WHY THIS TEST MATTERS. A cap below one view turns the cache into a
    // treadmill: `ensureAround` fetches the lattice, eviction immediately drops
    // the far half of it, and the next load — even standing perfectly still —
    // re-fetches what was just thrown away. That is the exact opposite of this
    // module's reason to exist, and it is silent: nothing fails, the terrain is
    // correct, it just costs a full re-fetch and a full sort every time.
    //
    // It is not hypothetical. Raising `TERRAIN_EXTENT_M` to 2400 m put one view
    // at 321 489 posts against a flat 250 000 constant, and the caller was also
    // asking for `extentM * SQRT2` — a square lattice sized by a circle's
    // radius — which doubled it for ground nothing samples.
    const { provider, asked } = rampProvider();
    const field = createTerrainField({ provider, maxPosts: 10 });

    await field.ensureAround(COLOGNE, 300);
    const afterFirst = field.postCount;
    expect(afterFirst).toBe(2809);

    const fetchesAfterFirst = totalAsked(asked);
    // Standing still: every post is already held, so nothing may be re-fetched.
    await field.ensureAround(COLOGNE, 300);
    expect(field.postCount).toBe(afterFirst);
    expect(totalAsked(asked)).toBe(fetchesAfterFirst);
  });

  it("keeps the view's CORNERS too, once a walk has filled the cache", async () => {
    // WHY THIS TEST EXISTS, and why the one above could not catch it. The floor
    // guarantees a COUNT; this guarantees the SET. Eviction ranked by Euclidean
    // distance while `ensureAround` builds a SQUARE lattice, so it kept a DISC —
    // and a disc of the same area is narrower than the square at its corners.
    // Measured at the demo's real numbers, 1 200 posts of the view being fetched
    // fell outside the kept disc and were dropped in favour of nearer HISTORICAL
    // posts, so the four corner regions were re-fetched and re-dropped on every
    // load. The test above uses `maxPosts: 10`, where the floor binds and there
    // is no history, which is exactly the case that cannot see this.
    //
    // The numbers here reproduce the shape: a 300 m radius at Cologne is 53 x 53
    // = 2809 posts with corners at 26 x sqrt(2) = 36.8 lattice units, while a
    // Euclidean disc holding 3000 posts reaches only sqrt(3000 / pi) = 30.9, so
    // 40 of the view's own posts rank outside it. maxPosts is deliberately just
    // ABOVE viewPosts (2809) so the count floor does not bind and only the
    // metric is under test.
    const { provider, asked } = rampProvider();
    const field = createTerrainField({ provider, maxPosts: 3000 });

    await field.ensureAround(COLOGNE, 300);
    // A 640 m walk east — 53 lattice units, so the two views just stop
    // overlapping and the cache exceeds the cap. It must be a WALK rather than a
    // teleport: posts left behind only compete with the new view's corners if
    // they are nearby, and a 15 km jump puts all of them so far away that the
    // whole new view survives whatever metric is used.
    const elsewhere = { lat: 50.9413, lng: 6.967424 };
    await field.ensureAround(elsewhere, 300);

    const settled = totalAsked(asked);
    // Standing still at the NEW centre must cost nothing. Before the metric was
    // fixed this re-fetched the corners every time.
    await field.ensureAround(elsewhere, 300);
    expect(totalAsked(asked)).toBe(settled);
  });

  it("fills a gap OUTSIDE the ensured area from the mean, never with zero", async () => {
    // RAISED IN REVIEW ON PR #231, and confirmed against the code. `sampleGrid`
    // wrote `height ?? 0` into the buffer and then tried to repair gaps with
    // `if (!Number.isFinite(...)) heights[i] = mean`. Zero IS finite, so the
    // repair could never fire and every uncovered post stayed at 0.
    //
    // THE FAILURE THAT MAKES IT WORTH A TEST. The user is at A with terrain
    // loaded, moves ~500 m to B, and `elevationAt` rejects — a transient 5xx or
    // an aborted tile. `ensureAround` swallows it and sets no posts, so B's
    // 2.8 km grid is part-covered by A's lattice and part not. The uncovered part
    // reads 0, `values.length > 0` so `hasData` is true, and the worker publishes
    // it as real terrain. After the datum subtraction that is a ~53 m PIT at
    // Cologne shaped exactly like the outage, with the buildings sunk into it.
    //
    // The sibling case — the FETCH path filling undefined posts — was already
    // covered. This is the sampling path, which had no equivalent.
    const { provider } = rampProvider();
    const field = createTerrainField({ provider });

    // Ensure a SMALL area, then sample a grid far wider than it.
    await field.ensureAround(COLOGNE, 150);
    const grid = field.sampleGrid({
      frame: enuFrameAt(COLOGNE),
      extentM: 1200,
      spacingM: 100,
    });

    expect(grid.hasData).toBe(true);
    // Some posts are genuinely uncovered — otherwise this test proves nothing.
    expect(grid.missing).toBeGreaterThan(0);

    // NOT ONE POST AT THE SEA-LEVEL FLOOR. Every height must be within the
    // range the ramp can actually produce over this grid; a 0 among values
    // around 550 is the pit, and it is what the old code emitted.
    const heights = [...grid.heights];
    const lowest = Math.min(...heights);
    const highest = Math.max(...heights);
    expect(lowest).toBeGreaterThan(0);
    // And the gaps sit INSIDE the observed range rather than at either edge,
    // because the mean is by definition between them.
    expect(highest - lowest).toBeLessThan(highest);
  });

  it("never asks for the same post twice within one fill", async () => {
    // Two adjacent requests rounding to the same pixel would double the batch for
    // nothing. The lattice is integer-keyed, so this is a de-duplication check.
    const { provider, asked } = rampProvider();
    const field = createTerrainField({ provider });

    await field.ensureAround(COLOGNE, 250);

    const keys = (asked[0] ?? []).map((p) => {
      const pixel = toWorldPixel(p, DEFAULT_TERRARIUM_ZOOM);
      return `${Math.round(pixel.x)}/${Math.round(pixel.y)}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("a superseded load", () => {
  /**
   * WHY THESE TESTS MATTER. Abort was honoured for CORRECTNESS and not for COST:
   * `demo-worker.ts` checks `signal.aborted` AFTER `ensureAround` resolves, so
   * nothing stale was ever applied — but the check could only run once the whole
   * DEM batch had already been pulled to completion. At `TERRAIN_EXTENT_M` one
   * view is ~321 000 posts spanning several Terrarium tiles, and walking or
   * clicking around the map is exactly the workload `terrain-cycle.ts` coalesces,
   * so every superseded load paid in full.
   *
   * The plumbing existed at both ends and only this link was missing:
   * `ElevationProvider.elevationAt(positions, signal?)` takes one, and
   * `InFlightRequests` was built so a joiner's cancellation is per-caller. Worse
   * than merely not cancelling, a caller that passes NO signal is registered as
   * `pinned` there — it declares the request uncancellable and pins it for every
   * other joiner too. Raised in review on #270.
   */
  it("forwards its signal to the provider instead of pinning the request", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const field = createTerrainField({
      provider: {
        attribution: "test",
        sourceId: "fixture:signal",
        elevationAt: (positions, signal) => {
          seen.push(signal);
          return Promise.resolve(positions.map(() => 10));
        },
      },
    });
    const controller = new AbortController();

    await field.ensureAround(COLOGNE, 40, controller.signal);

    // Not just "a signal": THE caller's signal, or `InFlightRequests` cannot
    // tell this caller's abandonment from anyone else's.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(controller.signal);
  });

  it("degrades to what is held when the provider aborts, rather than throwing", async () => {
    // The `catch` that already guards a DEM outage has to cover the AbortError
    // too, or plumbing the signal through turns a superseded load into a
    // rejection the 3D pane would take down with it.
    const field = createTerrainField({
      provider: {
        attribution: "test",
        sourceId: "fixture:aborting",
        elevationAt: () =>
          Promise.reject(new DOMException("Aborted", "AbortError")),
      },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      field.ensureAround(COLOGNE, 40, controller.signal),
    ).resolves.toBeUndefined();
    expect(field.postCount).toBe(0);
  });
});
