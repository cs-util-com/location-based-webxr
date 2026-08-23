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
 * than plates. Vertex count is deterministic and identical on any machine — a
 * wall-clock bound here would be exactly the load-sensitive assertion this repo
 * has spent two sessions removing from its gates.
 *
 * **KNOW THIS BEFORE TRUSTING THE FIXTURE.** On `london-westminster` the entire
 * effect comes from **one feature**: `relation/28934`, `natural=water` — the
 * Thames. Of 1 894 geometried elements exactly one is partly outside the box and
 * none is fully outside, so the distribution is bimodal: **54.5 % of floats
 * removed, or 0 %.** A fixture recapture that drops or trims that relation takes
 * the effect straight to zero and turns the first two tests red against entirely
 * correct production code.
 *
 * That also means the equal-plate-count assertion is a property of THIS capture,
 * not of `clipTo`: production deliberately drops fully-outside plates
 * (`polygonsOf` returns `[]` when `clipToBbox` yields nothing), and this fixture
 * has none because its ~390 m capture sits well inside a ~4.8 km box. A wider
 * recapture would legitimately break it.
 *
 * The complementary half — that PRODUCTION actually passes `clipTo` — cannot be
 * checked from this package and lives in
 * `GpsPlusSlamJs_OsmDemo/src/worker/plate-clip-call-site.test.ts`.
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

  // ROUGHLY the production scale, and deliberately not a claim of fidelity.
  // Production's `clipBoxAround` runs `metresToDegrees`, which applies the
  // 1/cos(lat) longitude scaling, so at 51.5° its half-widths are ~0.0228° lat
  // by ~0.0364° lng — a square in METRES. This box is square in DEGREES, i.e.
  // ~2400 m by ~1495 m. It cannot catch a bug in `clipBoxAround` (that lives in
  // another package and cannot be imported here); it only needs to be a box of
  // the right order for the volume comparison below.
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
    // subtly-broken bbox would take. Measured at ~55 % fewer floats here.
    //
    // THE 20 % BOUND BUYS NO FLAKE MARGIN, and saying otherwise would be a lie
    // about why it is there: the effect is bimodal (see the header), so the real
    // value is 54.5 % or 0 % and nothing lands in between. The threshold exists
    // only to separate "clipped something substantial" from "clipped essentially
    // nothing"; any value in (0, 54) would do the same job.
    const unclipped = meshFloats(buildAreaPlates(features, { frame }));
    const clipped = meshFloats(
      buildAreaPlates(features, { frame, clipTo: productionClip }),
    );

    expect(clipped).toBeLessThan(unclipped * 0.8);
  });

  it("honours the box it is GIVEN, not some fixed extent of its own", () => {
    // RENAMED after cold review. This was called a "vacuity check" and claimed
    // to guard against the file passing while guarding nothing — which it never
    // did: if the fixture sat entirely inside the box, the first test's
    // `toBeLessThan` fails LOUDLY. There is no silent-pass mode here, so there
    // was nothing to guard.
    //
    // What it actually catches is worth keeping, so it stays with an honest
    // name: a `clipTo` implementation that ignored the coordinates it was handed
    // and clipped to some hard-coded extent would satisfy both tests above —
    // fewer floats than unclipped, by a large fraction — and only fail here,
    // where a much smaller box must remove strictly more.
    const tiny = {
      south: site.centre.lat - 0.0005,
      north: site.centre.lat + 0.0005,
      west: site.centre.lng - 0.0005,
      east: site.centre.lng + 0.0005,
    };
    // A box ~43× smaller must cut strictly more than the production one. An
    // implementation clipping to a fixed extent would return the same volume
    // for both and fail here.
    expect(
      meshFloats(buildAreaPlates(features, { frame, clipTo: tiny })),
    ).toBeLessThan(
      meshFloats(buildAreaPlates(features, { frame, clipTo: productionClip })),
    );
  });
});
