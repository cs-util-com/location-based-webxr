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
