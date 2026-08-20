import { describe, expect, it } from "vitest";

import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { enuFrameAt } from "./enu.js";
import { buildAreaPlates } from "./plates.js";

/**
 * Why this file exists: `clipTo` is the single most expensive option in the
 * mesh build, and until now **nothing failed when it was absent.**
 *
 * Measured 2026-08-21 on the replicated london-westminster fixture (16 copies,
 * warm-up discarded, variant order alternated across three repeats to rule out
 * JIT): `buildAreaPlates` costs **~2 160 ms unclipped against ~135 ms with the
 * production clip** — a ~16× difference — while returning the **same 1 520
 * plates** either way.
 *
 * That equal plate count is exactly what makes the regression invisible. A
 * caller that drops `clipTo`, widens it, or adds a new call site without it
 * gets every plate it expected and a ~2 s stall, with no assertion anywhere to
 * notice. `plates.bench.ts` measures the cost but a benchmark cannot fail a
 * gate.
 *
 * **The guard is on GEOMETRY VOLUME, not on a clock.** Clipping happens before
 * `ringToEnu` and therefore before triangulation, so it removes vertices rather
 * than plates: a handful of large ways (parks, water, landuse) reach far past
 * the rendered extent, and trimming them is where the time goes. Vertex count is
 * deterministic, machine-checkable, and identical on any machine — a wall-clock
 * bound here would be exactly the load-sensitive assertion this repo has spent
 * two sessions removing from its gates.
 */

const SITE = "london-westminster";

/** Total floats across every plate's mesh — the work triangulation produced. */
function meshFloats(
  plates: readonly { mesh: { positions: ArrayLike<number> } }[],
): number {
  return plates.reduce(
    (total, plate) => total + plate.mesh.positions.length,
    0,
  );
}

describe("buildAreaPlates clipTo", () => {
  const site = loadSite(SITE);
  const features = [...parseOverpassJson(site.payload).features];
  const frame = enuFrameAt(site.centre);

  // The production box: `TERRAIN_EXTENT_M = 2400` with the demo's slack, around
  // the click centre. ~0.0216° of latitude at this site.
  const HALF_DEG = 0.0216;
  const productionClip = {
    south: site.centre.lat - HALF_DEG,
    north: site.centre.lat + HALF_DEG,
    west: site.centre.lng - HALF_DEG,
    east: site.centre.lng + HALF_DEG,
  };

  it("removes geometry without removing plates", () => {
    // THE ASSERTION THAT WOULD CATCH A DROPPED CLIP. Both halves matter: equal
    // plate counts prove the clip is not silently deleting content the user
    // should see, and strictly fewer floats prove it is actually doing the work
    // that makes the build affordable. Asserting only the second would pass for
    // a clip that threw half the city away.
    const unclipped = buildAreaPlates(features, { frame });
    const clipped = buildAreaPlates(features, {
      frame,
      clipTo: productionClip,
    });

    expect(clipped.length).toBe(unclipped.length);
    expect(meshFloats(clipped)).toBeLessThan(meshFloats(unclipped));
  });

  it("is not a rounding difference — the clip removes a large fraction", () => {
    // Why this test matters: `toBeLessThan` alone would stay green if the clip
    // degenerated to trimming a handful of stray vertices, which is the shape a
    // subtly-broken bbox would take. Measured at ~55 % fewer floats on this
    // fixture; the bound is deliberately loose at 20 % so ordinary fixture
    // churn cannot flake it, while a clip that had stopped working could not
    // possibly reach it.
    const unclipped = meshFloats(buildAreaPlates(features, { frame }));
    const clipped = meshFloats(
      buildAreaPlates(features, { frame, clipTo: productionClip }),
    );

    expect(clipped).toBeLessThan(unclipped * 0.8);
  });

  it("keeps the fixture honest: the unclipped build really does exceed the box", () => {
    // VACUITY CHECK. Every assertion above is meaningless if this fixture's
    // geometry happens to sit entirely inside the clip box — the two builds
    // would then be identical for reasons having nothing to do with clipping,
    // and the file would pass forever while guarding nothing. If a future
    // fixture change trips this, the fixture is wrong, not the clip.
    const unclipped = meshFloats(buildAreaPlates(features, { frame }));
    expect(unclipped).toBeGreaterThan(0);

    const tiny = {
      south: site.centre.lat - 0.0005,
      north: site.centre.lat + 0.0005,
      west: site.centre.lng - 0.0005,
      east: site.centre.lng + 0.0005,
    };
    // A box two orders of magnitude smaller must cut far more than the
    // production one, which can only be true if there is geometry out there to
    // cut.
    expect(
      meshFloats(buildAreaPlates(features, { frame, clipTo: tiny })),
    ).toBeLessThan(
      meshFloats(buildAreaPlates(features, { frame, clipTo: productionClip })),
    );
  });
});
