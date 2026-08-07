/**
 * When a pass has to rebuild the city and when it may send only slabs.
 *
 * Why these tests matter:
 * This is W6's whole decision, and it can be wrong in two directions with very
 * different costs. Rebuilding too eagerly gives back the saving — three full
 * city meshes per click, which is what shipped. Rebuilding too rarely leaves the
 * previous position's geometry on screen under the current position's cells,
 * which is the half-swapped scene the store, the terrain gate and the mesh
 * handoff ordering all exist to prevent. So every input the geometry depends on
 * gets its own test.
 *
 * @see mesh-planner.ts.md
 */

import { describe, expect, it } from "vitest";

import { createMeshPlanner, type MeshInputs } from "./mesh-planner.js";

const AT: MeshInputs = {
  position: { lat: 50.9413, lng: 6.9583 },
  loadedTileCount: 1,
  terrainStamp: 1,
};

describe("createMeshPlanner", () => {
  it("builds on the first pass, and not again for the same inputs", () => {
    // The three rings of one click: one full build, then slabs. This IS the
    // item — it used to be three full builds of a 2.8 km city.
    const planner = createMeshPlanner();

    expect(planner.needsFullBuild(AT)).toBe(true);
    expect(planner.needsFullBuild(AT)).toBe(false);
    expect(planner.needsFullBuild(AT)).toBe(false);
  });

  it("rebuilds when the user moves far enough to change what is drawn", () => {
    // The dangerous direction. Content is clipped to a box around the position
    // (`clipBoxAround(centre, TERRAIN_EXTENT_M)`), so a user who has moved a
    // long way needs geometry the last build never included — a slabs-only
    // reply would leave them looking at the edge of the old window.
    const planner = createMeshPlanner();
    planner.needsFullBuild(AT);

    expect(
      planner.needsFullBuild({ ...AT, position: { lat: 50.95, lng: 6.9583 } }),
    ).toBe(true);
    expect(
      planner.needsFullBuild({ ...AT, position: { lat: 50.95, lng: 6.96 } }),
    ).toBe(true);
  });

  it("does NOT rebuild for a step, now that the frame no longer moves", () => {
    // THE WIN. The frame used to be anchored at the position, so every vertex
    // moved when the user did and any move meant a full re-extrude. With a
    // fixed scene anchor the coordinates stand still, and a step only needs a
    // rebuild if it changed what should be *drawn* — which a few metres does
    // not.
    const planner = createMeshPlanner();
    planner.needsFullBuild(AT);

    // ~2 m north. Well inside the quantisation bucket.
    expect(
      planner.needsFullBuild({
        ...AT,
        position: { lat: AT.position.lat + 0.00002, lng: AT.position.lng },
      }),
    ).toBe(false);
  });

  it("still rebuilds once the steps accumulate past the bucket", () => {
    // THE COUNTER-CASE THAT MATTERS, and the one that catches the tempting
    // wrong fix: dropping position from the key entirely. That would make a
    // step cheap AND freeze the clipped content forever, so the user would
    // eventually walk off the edge of the drawn world with nothing rebuilding.
    const planner = createMeshPlanner();
    planner.needsFullBuild(AT);

    // ~500 m north — beyond the bucket, well inside the clip extent.
    expect(
      planner.needsFullBuild({
        ...AT,
        position: { lat: AT.position.lat + 0.0045, lng: AT.position.lng },
      }),
    ).toBe(true);
  });

  it("quantises longitude as well as latitude", () => {
    // Both axes, or a bucket that only coarsened one would rebuild on every
    // eastward step while ignoring northward ones — which would look like an
    // intermittent bug rather than a missing clause.
    const planner = createMeshPlanner();
    planner.needsFullBuild(AT);

    expect(
      planner.needsFullBuild({
        ...AT,
        position: { lat: AT.position.lat, lng: AT.position.lng + 0.00002 },
      }),
    ).toBe(false);
    expect(
      planner.needsFullBuild({
        ...AT,
        position: { lat: AT.position.lat, lng: AT.position.lng + 0.0075 },
      }),
    ).toBe(true);
  });

  it("rebuilds when another fetch tile has been merged in", () => {
    // New features are new geometry. Tiles are only ever added, which is what
    // makes a count a faithful signature of the feature set rather than a proxy.
    const planner = createMeshPlanner();
    planner.needsFullBuild(AT);

    expect(planner.needsFullBuild({ ...AT, loadedTileCount: 2 })).toBe(true);
  });

  it("rebuilds when the terrain has been replaced", () => {
    // Every builder samples heights from the field, so a new field is new
    // geometry — including the case that matters most, where the field arrives
    // AFTER the first pass at a position that had none.
    const planner = createMeshPlanner();
    planner.needsFullBuild(AT);

    expect(planner.needsFullBuild({ ...AT, terrainStamp: 2 })).toBe(true);
  });

  it("does NOT rebuild for a category change", () => {
    // The unlooked-for win, and the reason the planner keys on inputs rather
    // than on "was this the first ring": a category change re-enters the mesh
    // build with identical geometry inputs, and used to rebuild the whole city
    // for a recolouring the main thread does anyway.
    const planner = createMeshPlanner();
    planner.needsFullBuild(AT);

    expect(planner.needsFullBuild(AT)).toBe(false);
  });

  it("rebuilds again after returning to a previous position", () => {
    // Only the LAST build is remembered, deliberately: a history of every
    // position visited would be a leak, and the cost of one extra rebuild on a
    // return is milliseconds against a wrong picture.
    const planner = createMeshPlanner();
    planner.needsFullBuild(AT);
    planner.needsFullBuild({ ...AT, position: { lat: 50.95, lng: 6.96 } });

    expect(planner.needsFullBuild(AT)).toBe(true);
  });
});

describe("the saving §1.2 claims, as a number", () => {
  /**
   * WHY THIS TEST MATTERS. "A step no longer re-extrudes the entire city" is the
   * strongest argument for the fixed-frame work that does not mention AR, and it
   * shipped as an assertion because nobody measured it. The e2e cannot: it stubs
   * the network, so its fixture city is small and a full build there is cheap —
   * the saving does not exist in the only environment that can be automated.
   *
   * But the saving is a RATE, not a duration, and the rate is exactly what this
   * module decides. Measured here, deterministically, with no clock involved:
   * of N steps along a walk, how many still force a full build?
   *
   * Multiply by the cost of one build to get the rest. That figure is already
   * recorded from a real run in `demo-worker.ts`: 2 881 ms, of which 2 657 ms
   * was ear-clipping a single 25 001-point administrative boundary relation —
   * paid on every click.
   */
  const STEP_M = 20;
  /** Steps TAKEN — so the walk stands at `STEPS + 1` positions, both ends included. */
  const STEPS = 30;
  const WALK_M = STEPS * STEP_M;
  const METRES_PER_DEG_LAT = 111_320;

  /** Every position a straight `WALK_M` walk in `STEP_M` steps stands at. */
  function walkPositions(): { lat: number; lng: number }[] {
    // `<=`, because N steps is N + 1 standing positions. Raised on #269, where
    // this stopped one short: 30 iterations from 0 walk 580 m, while the comment
    // here and both docs quoting it said 600 m. `walkLengthM` below is the guard
    // that stops the loop bound and the quoted distance drifting apart again.
    return Array.from({ length: STEPS + 1 }, (_unused, i) => ({
      lat: AT.position.lat + (i * STEP_M) / METRES_PER_DEG_LAT,
      lng: AT.position.lng,
    }));
  }

  /** How far `walkPositions()` actually goes, north-south, in metres. */
  function walkLengthM(): number {
    const positions = walkPositions();
    const first = positions[0];
    const last = positions[positions.length - 1];
    if (first === undefined || last === undefined) return 0;
    return (last.lat - first.lat) * METRES_PER_DEG_LAT;
  }

  /** Counts the full builds a straight `WALK_M` walk costs. */
  function rebuildsAlongAWalk(): number {
    const planner = createMeshPlanner();
    let rebuilds = 0;
    for (const position of walkPositions()) {
      if (planner.needsFullBuild({ ...AT, position })) rebuilds += 1;
    }
    return rebuilds;
  }

  it("walks the distance every figure quoted from it claims", () => {
    // WHY THIS TEST MATTERS. The numbers this block produces are quoted outside
    // it — in `mesh-planner.ts.md` and in two docs — as "X builds across a 600 m
    // walk". Nothing connected that sentence to the loop, so an off-by-one in
    // the bound made every quote wrong by a step without any test noticing. This
    // asserts the walk's LENGTH, which is the only part of the claim that lives
    // outside the module under test.
    expect(walkPositions()).toHaveLength(STEPS + 1);
    expect(walkLengthM()).toBeCloseTo(WALK_M, 6);
  });

  it("rebuilds a handful of times across a walk, not once per step", () => {
    // 30 steps of 20 m is a 600 m walk. The bucket is 0.001 deg ~ 110 m of
    // latitude, so the walk crosses about five of them — plus the first pass,
    // which always builds.
    const rebuilds = rebuildsAlongAWalk();

    // THE MEASUREMENT, stated as a range rather than an exact count so that a
    // change to STEP_M or the bucket does not make this a puzzle to re-derive.
    expect(rebuilds).toBeGreaterThanOrEqual(4);
    expect(rebuilds).toBeLessThanOrEqual(8);

    // THE CLAIM, and the reason the range above is worth pinning: before the
    // quantisation every one of these steps was a full rebuild, because the
    // position went into the key verbatim. Anything close to STEPS means the
    // saving has been given back.
    expect(rebuilds).toBeLessThan(STEPS / 3);
  });

  it("is the SAME walk that a verbatim-position key would rebuild every time", () => {
    // The counterweight, and it is what stops the test above passing for a
    // planner that had simply stopped caring about position. Each position is
    // genuinely distinct — so a key holding it verbatim would answer `true` at
    // every one of them, which is the behaviour the bucket replaced.
    const positions = new Set(
      walkPositions().map((position) => `${position.lat},${position.lng}`),
    );

    expect(positions.size).toBe(STEPS + 1);
    expect(rebuildsAlongAWalk()).toBeLessThan(positions.size);
  });
});
