/**
 * What crosses the worker boundary must survive `structuredClone`.
 *
 * WHY THESE TESTS MATTER, AND WHY THEY ARE HERE RATHER THAN IN A TYPE. The
 * structured-clone algorithm is a RUNTIME contract that TypeScript cannot check:
 * a class instance, a getter or a method type-checks perfectly and then either
 * throws `DataCloneError` or — worse — arrives silently stripped, as an object
 * whose shape looks right until something calls the method that is no longer
 * there. `Heightfield.heightAt` is exactly that case, which is why the boundary
 * carries `HeightfieldData` and rebuilds the sampler on the far side.
 *
 * `toStrictEqual`, never `toEqual`: `toEqual` ignores object TYPE, so a class
 * instance compares equal to the plain object it clones into and the assertion
 * passes for precisely the value that would have failed. That hole was found in
 * this repo before, in the snapshot serialisability guard.
 */

import { describe, expect, it } from "vitest";
import { enuFrameAt } from "gps-plus-slam-osm";
import type { ElevationProvider, LatLng } from "gps-plus-slam-osm";

import { planRoute } from "../agent-route.js";
import { buildHeightfieldData, heightfieldFrom } from "../heightfield.js";

const FRAME = enuFrameAt({ lat: 50.9413, lng: 6.9583 });

/** A provider whose height varies with longitude, so the field has real relief. */
function slopingProvider(): ElevationProvider {
  return {
    attribution: "test",
    sourceId: "test",
    elevationAt: (positions: readonly LatLng[]) =>
      Promise.resolve(positions.map((p) => (p.lng - 6.9583) * 100_000)),
  };
}

describe("the heightfield across the worker boundary", () => {
  it("survives structuredClone as plain data", async () => {
    const data = await buildHeightfieldData(slopingProvider(), {
      frame: FRAME,
      extentM: 120,
      spacingM: 40,
    });

    // The whole claim: no DataCloneError, and nothing quietly changed type.
    const cloned = structuredClone(data);
    expect(cloned).toStrictEqual(data);
    expect(cloned.heights).toBeInstanceOf(Float32Array);
  });

  it("samples IDENTICALLY after the round trip, including outside the extent", async () => {
    // WHY THIS TEST MATTERS. This is the assertion that the rebuilt sampler is
    // the same function, not merely a similar one. The datum is the easy thing
    // to lose — it used to be captured in a closure and is now a field, so a
    // rebuild that forgot to subtract it would return ALTITUDE instead of
    // relief: ~53 m at Cologne, which lifts the whole city off a camera looking
    // at y = 10 and reads as "the terrain broke" rather than "the datum moved".
    //
    // The out-of-extent probes matter for the same reason the clamp exists: both
    // sides must agree about the edge value, or the ground plane and the meshes
    // that stand on it would disagree at the boundary.
    const data = await buildHeightfieldData(slopingProvider(), {
      frame: FRAME,
      extentM: 120,
      spacingM: 40,
    });
    const original = heightfieldFrom(data);
    const rebuilt = heightfieldFrom(structuredClone(data));

    const probes = [
      { x: 0, y: 0 },
      { x: 37, y: -14 },
      { x: -119, y: 119 },
      // Deliberately outside: the clamp is a documented behaviour, so it is
      // part of the contract that has to round-trip.
      { x: 5000, y: -5000 },
    ];
    for (const probe of probes) {
      expect(rebuilt.heightAt(probe)).toBe(original.heightAt(probe));
    }
    // And the field really does vary, or the assertion above is trivially true
    // for a flat zero surface.
    expect(Math.abs(original.heightAt({ x: 100, y: 0 }))).toBeGreaterThan(0.5);
  });

  it("rebuilds a FAILED field as flat rather than as sea level", async () => {
    // `hasData: false` must sample 0 relief, not "0 metres altitude" — a DEM
    // outage rendered as sea level is a hole shaped exactly like the outage,
    // which reads as terrain and buries the buildings standing in it.
    const failing: ElevationProvider = {
      attribution: "test",
      sourceId: "test",
      elevationAt: () => Promise.reject(new Error("DEM down")),
    };
    const data = await buildHeightfieldData(failing, {
      frame: FRAME,
      extentM: 120,
      spacingM: 40,
    });
    expect(data.hasData).toBe(false);

    const rebuilt = heightfieldFrom(structuredClone(data));
    expect(rebuilt.heightAt({ x: 50, y: 50 })).toBe(0);
    expect(rebuilt.hasData).toBe(false);
    // Still cloneable — a failure path that cannot cross the boundary would
    // turn a DEM outage into a dead worker.
    expect(structuredClone(data)).toStrictEqual(data);
  });

  it("carries a planned route back as plain data", () => {
    // WHY THIS TEST MATTERS. `planRoute` is the third handler that runs in the
    // worker because its STATE cannot cross — `ObstacleIndex` exposes
    // `obstaclesIn` as a method — so the whole design rests on the RESULT being
    // cloneable when the index is not. `RoutePoint[]` is plain objects and
    // numbers today; anything that later grew a class instance or a getter here
    // would throw `DataCloneError` inside the worker, where an exception rejects
    // nothing and the click would simply never settle.
    //
    // `toStrictEqual`, not `toEqual`: `toEqual` ignores object TYPE, so a class
    // instance compares equal to the plain object it clones into — passing for
    // precisely the value that would have failed.
    const route = planRoute(
      [],
      { lat: 50.9413, lng: 6.9583 },
      { lat: 50.9415, lng: 6.9583 },
      { frame: FRAME, field: undefined },
    );
    expect(route).toBeDefined();

    expect(structuredClone(route)).toStrictEqual(route);
    expect(structuredClone(route)?.[0]?.position.lat).toBeTypeOf("number");
  });

  it("computes relief for a field past the spread-argument limit", async () => {
    // WHY THIS TEST MATTERS (found while refactoring for the worker). `reliefM`
    // was `Math.max(...known) - Math.min(...known)`, and a spread passes ONE
    // ARGUMENT PER ELEMENT. Measured in this Node, `Math.max(...arr)` starts
    // throwing `RangeError: Maximum call stack size exceeded` between 100 000 and
    // 125 000 elements.
    //
    // To be accurate about the risk: W8's extent (~2.8 km at 12 m) is ~55 000
    // posts, so the spread was NOT yet broken. But it is within ~2x of the
    // limit, and an ordinary follow-up change reaches it — the same extent at
    // 8 m spacing is ~123 000 posts. The failure mode would be a `RangeError`
    // thrown from inside terrain loading, surfacing only after the spacing
    // changed and looking like a bug in the spacing change.
    //
    // 160 000 posts is past the measured limit, so this pins the FOLD rather
    // than the accident of today's grid size. It goes through
    // `buildHeightfieldData` deliberately: asserting on a hand-built
    // `HeightfieldData` would never run the code that does the reducing.
    const data = await buildHeightfieldData(slopingProvider(), {
      frame: FRAME,
      extentM: 399,
      spacingM: 2, // side = 2*399/2 + 1 = 400, so 160 000 posts
    });

    expect(data.total).toBe(160_000);
    expect(data.hasData).toBe(true);
    expect(Number.isFinite(data.reliefM)).toBe(true);
    expect(data.reliefM).toBeGreaterThan(0);
  });
});
