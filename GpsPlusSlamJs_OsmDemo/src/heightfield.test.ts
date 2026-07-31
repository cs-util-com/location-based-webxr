/**
 * The terrain heightfield.
 *
 * Why these tests matter:
 * The status line reported "guessed heights" and the ground was a flat plane at
 * y = 0, which read as "it knows the elevation and just is not drawing it"
 * (finding M13). It does not — no elevation provider was wired at all. Wiring
 * one has three ways to go quietly wrong, and each is asserted here.
 *
 * 1. **`undefined` is not `0`.** A DEM tile that fails to load must never drop
 *    the ground to sea level under the buildings. That is the one failure that
 *    looks like data rather than like an error.
 * 2. **It must be RELATIVE.** The provider returns orthometric height —
 *    ~50 m at Cologne — while the mesh frame puts the user at y = 0. Feeding
 *    absolute metres straight in lifts the whole city off the camera.
 * 3. **The sampler is synchronous.** `buildBuildings` takes a plain
 *    `groundHeightM(position)`, so the fetching has to be finished before the
 *    mesh build starts, not interleaved with it.
 *
 * @see heightfield.ts.md
 */

import { describe, it, expect, vi } from "vitest";
import { enuFrameAt } from "gps-plus-slam-osm";
import type { ElevationProvider, LatLng } from "gps-plus-slam-osm";

import {
  buildHeightfield,
  buildHeightfieldData,
  createHeightfieldCache,
  NEAR_FIELD_M,
} from "./heightfield.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(COLOGNE);

/** A provider returning `f(lat, lng)` metres, counting its calls. */
function providerOf(
  f: (position: LatLng) => number | undefined,
): ElevationProvider & { calls: number } {
  const provider = {
    attribution: "test",
    sourceId: "test",
    calls: 0,
    elevationAt(positions: readonly LatLng[]) {
      provider.calls++;
      return Promise.resolve(positions.map(f));
    },
  };
  return provider;
}

/** 600 m across, 50 m posts — coarse enough to keep the assertions readable. */
const OPTIONS = { frame: FRAME, extentM: 300, spacingM: 50 };

describe("buildHeightfield — the relative surface", () => {
  it("is zero at the frame origin, whatever the absolute elevation is", () => {
    // The datum cancels because the view is standalone 3D with no AR: only
    // relative relief is being drawn. Absolute orthometric metres would lift
    // the whole city ~50 m off a camera that looks at y = 10.
    return buildHeightfield(
      providerOf(() => 53.7),
      OPTIONS,
    ).then((field) => {
      expect(field.heightAt({ x: 0, y: 0 })).toBeCloseTo(0, 6);
    });
  });

  it("reproduces a known slope, relative to the origin", async () => {
    // 0.1 m of rise per metre of east. At x = +100 that is +10 m relative.
    const field = await buildHeightfield(
      providerOf((p) => 100 + FRAME.toEnu(p).x * 0.1),
      OPTIONS,
    );
    expect(field.heightAt({ x: 100, y: 0 })).toBeCloseTo(10, 1);
    expect(field.heightAt({ x: -100, y: 0 })).toBeCloseTo(-10, 1);
  });

  it("interpolates between posts rather than stepping", async () => {
    // A nearest-neighbour sampler would return the same value across a whole
    // 50 m cell, which reads as terraced farmland everywhere.
    const field = await buildHeightfield(
      providerOf((p) => FRAME.toEnu(p).x * 0.1),
      OPTIONS,
    );
    const quarter = field.heightAt({ x: 12.5, y: 0 });
    const half = field.heightAt({ x: 25, y: 0 });
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(half);
  });

  it("clamps outside its extent instead of returning NaN", async () => {
    // The ground plane and the affordance grid both sample it, and a NaN vertex
    // silently removes a triangle rather than reporting anything.
    const field = await buildHeightfield(
      providerOf((p) => FRAME.toEnu(p).x * 0.1),
      OPTIONS,
    );
    for (const point of [
      { x: 10_000, y: 0 },
      { x: -10_000, y: 0 },
      { x: 0, y: 10_000 },
      { x: 0, y: -10_000 },
    ]) {
      expect(Number.isFinite(field.heightAt(point))).toBe(true);
    }
  });
});

describe("buildHeightfield — missing data", () => {
  it("falls back to FLAT when nothing came back, and says so", async () => {
    // Not "sea level": the buildings would sink into a hole shaped exactly like
    // the DEM outage, which looks like terrain rather than like a failure.
    const field = await buildHeightfield(
      providerOf(() => undefined),
      OPTIONS,
    );
    expect(field.hasData).toBe(false);
    expect(field.heightAt({ x: 0, y: 0 })).toBe(0);
    expect(field.heightAt({ x: 120, y: -80 })).toBe(0);
  });

  it("never digs a sea-level pit where a few posts are missing", async () => {
    // A coastline or a tile edge legitimately has holes. Filling them with 0
    // would drop a 100 m cliff into the middle of otherwise fine terrain.
    let n = 0;
    const field = await buildHeightfield(
      providerOf((p) => {
        n++;
        return n % 5 === 0 ? undefined : 100 + FRAME.toEnu(p).y * 0.01;
      }),
      OPTIONS,
    );
    expect(field.hasData).toBe(true);
    expect(field.missing).toBeGreaterThan(0);
    // Every sample stays inside the range the real data spans, so no hole can
    // read as a feature.
    for (let x = -300; x <= 300; x += 25) {
      for (let y = -300; y <= 300; y += 25) {
        expect(Math.abs(field.heightAt({ x, y }))).toBeLessThan(20);
      }
    }
  });

  it("reports the peak-to-trough relief, so flat terrain is distinguishable from none", async () => {
    // "The DEM loaded and this place is flat" and "the DEM did not load" render
    // identically. Only a number tells them apart, which is why the status line
    // carries it.
    const sloped = await buildHeightfield(
      providerOf((p) => 100 + FRAME.toEnu(p).x * 0.1),
      OPTIONS,
    );
    expect(sloped.reliefM).toBeCloseTo(60, 0);

    const plain = await buildHeightfield(
      providerOf(() => 100),
      OPTIONS,
    );
    expect(plain.reliefM).toBe(0);
    expect(plain.hasData).toBe(true);

    const none = await buildHeightfield(
      providerOf(() => undefined),
      OPTIONS,
    );
    expect(none.reliefM).toBe(0);
    expect(none.hasData).toBe(false);
  });

  it("reports how many posts were missing, for the status line", async () => {
    const field = await buildHeightfield(
      providerOf(() => undefined),
      OPTIONS,
    );
    expect(field.missing).toBe(field.total);
    expect(field.total).toBeGreaterThan(0);
  });
});

describe("buildHeightfield — the fetch", () => {
  it("asks for every post in ONE batch", async () => {
    // `elevationAt` is batch-in/batch-out precisely so a provider can coalesce
    // by DEM tile. One call per post would be ~2500 requests for one view.
    const provider = providerOf(() => 100);
    await buildHeightfield(provider, OPTIONS);
    expect(provider.calls).toBe(1);
  });

  it("samples at the source's resolution, not finer", async () => {
    // ~50x50 posts over 600 m at 12 m/px (Terrarium z13). A much finer grid
    // interpolates invented detail at real network cost.
    const provider = providerOf(() => 100);
    const field = await buildHeightfield(provider, {
      frame: FRAME,
      extentM: 300,
      spacingM: 12,
    });
    expect(field.total).toBeGreaterThan(2000);
    expect(field.total).toBeLessThan(3000);
  });

  it("degrades to flat when the provider rejects, rather than failing the view", async () => {
    // A DEM outage must cost the relief, not the whole 3D pane — the buildings
    // and the affordance grid are still worth looking at.
    const failing: ElevationProvider = {
      attribution: "",
      sourceId: "boom",
      elevationAt: () => Promise.reject(new Error("network down")),
    };
    const field = await buildHeightfield(failing, OPTIONS);
    expect(field.hasData).toBe(false);
    expect(field.heightAt({ x: 0, y: 0 })).toBe(0);
  });

  it("passes the abort signal through", async () => {
    const seen = vi.fn();
    const provider: ElevationProvider = {
      attribution: "",
      sourceId: "t",
      elevationAt: (positions, signal) => {
        seen(signal);
        return Promise.resolve(positions.map(() => 10));
      },
    };
    const controller = new AbortController();
    await buildHeightfield(provider, { ...OPTIONS, signal: controller.signal });
    expect(seen).toHaveBeenCalledWith(controller.signal);
  });
});

describe("buildHeightfieldData — nearReliefM is the NEAR field (PR #231)", () => {
  it("reports less relief near the origin than across the whole grid", async () => {
    // RAISED IN REVIEW ON PR #231 and confirmed: `nearReliefM` was
    // `peakToTrough(known)` — byte-identical to `reliefM` — and `NEAR_FIELD_M`
    // appeared nowhere in this file except its own declaration.
    //
    // DEC-R2-22 added the second number precisely because they must differ:
    // over a 2.8 km square the whole-field relief can be tens of metres while
    // the ground under the user is flat, and a status line showing one number
    // for both cannot tell "this place is hilly" from "somewhere in view is".
    //
    // This path has no production consumer today — the demo goes through
    // `terrainField.sampleGrid`, which does restrict correctly — so it is a trap
    // for the next consumer rather than a live defect. `mesh-layers.test.ts`
    // already records that a dropped field in this exact function shipped once.
    //
    // The provider makes a FLAT centre inside a steep rim, so the two numbers
    // are forced apart: anything within the near field is 100, everything
    // beyond it ramps away hard.
    const provider: ElevationProvider = {
      attribution: "test",
      sourceId: "test",
      elevationAt: (positions) =>
        Promise.resolve(
          positions.map((p) => {
            const east = (p.lng - COLOGNE.lng) * 70_000;
            const north = (p.lat - COLOGNE.lat) * 111_320;
            const far = Math.max(Math.abs(east), Math.abs(north));
            return far <= NEAR_FIELD_M ? 100 : 100 + (far - NEAR_FIELD_M);
          }),
        ),
    };

    const field = await buildHeightfieldData(provider, {
      frame: enuFrameAt(COLOGNE),
      extentM: 1200,
      spacingM: 100,
    });

    expect(field.hasData).toBe(true);
    // The whole grid climbs ~900 m from the rim; the near field is dead flat.
    expect(field.reliefM).toBeGreaterThan(500);
    expect(field.nearReliefM).toBeLessThan(5);
  });

  it("falls back to the whole field when the extent is smaller than the near field", async () => {
    // Not zero, and not a throw: a 200 m grid has no posts beyond NEAR_FIELD_M,
    // so "the near field" is the whole thing. Reporting 0 would read as flat
    // ground rather than as a grid too small to distinguish.
    const provider: ElevationProvider = {
      attribution: "test",
      sourceId: "test",
      elevationAt: (positions) =>
        Promise.resolve(positions.map((_, i) => i * 2)),
    };
    const field = await buildHeightfieldData(provider, {
      frame: enuFrameAt(COLOGNE),
      extentM: 100,
      spacingM: 50,
    });
    expect(field.nearReliefM).toBe(field.reliefM);
    expect(field.nearReliefM).toBeGreaterThan(0);
  });
});

describe("createHeightfieldCache — one sampler per terrain (PR #239)", () => {
  /** Minimal real data: a 2×2 field, so `hasData` takes the sampling branch. */
  function dataOf(datum: number) {
    return {
      heights: new Float32Array([0, 1, 2, 3]),
      side: 2,
      extentM: 100,
      datum,
      hasData: true,
      missing: 0,
      total: 4,
      reliefM: 3,
      nearReliefM: 3,
    };
  }

  it("rebuilds the sampler only when the DATA changes, not per sample", () => {
    // WHY THIS TEST MATTERS. `heightAtEnu` in `demo-worker.ts` called
    // `heightfieldFrom(terrain)` inside itself, so the whole affordance grid —
    // ~931 cells, several vertices each — allocated a fresh spread of
    // `HeightfieldData` plus a closure PER SAMPLED VERTEX, on every rebuild.
    // Identity is the assertion because it is the only thing that distinguishes
    // "cached" from "cheap enough that nobody noticed": a value-equal sampler
    // rebuilt every call would pass any assertion about the heights it returns.
    const cache = createHeightfieldCache();
    const data = dataOf(0);
    expect(cache(data)).toBe(cache(data));
    // A NEW terrain must not be answered from the old sampler — that would show
    // as relief lagging one position behind the user, which reads as a DEM
    // problem rather than as a cache bug.
    const next = dataOf(10);
    const before = cache(data);
    expect(cache(next)).not.toBe(before);
    expect(cache(next)?.datum).toBe(10);
  });

  it("passes `undefined` through, because no terrain is a legitimate state", () => {
    // A DEM outage costs the relief and nothing else (see `buildHeightfieldData`),
    // so the absent case must stay absent rather than becoming a flat sampler the
    // callers can no longer tell apart from real flat ground.
    const cache = createHeightfieldCache();
    expect(cache(undefined)).toBeUndefined();
  });
});
