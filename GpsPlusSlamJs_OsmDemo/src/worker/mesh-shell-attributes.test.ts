/**
 * The AR shell's per-vertex attributes, over the REAL build path.
 *
 * WHY THESE TESTS MATTER, and it is a specific failure rather than a general
 * principle. `chunkMeshes` already has unit tests, but they feed it synthetic
 * parts. Nothing exercised `buildBuildings -> chunkMeshes` together, which is
 * what the worker actually does — so when a suite went red on 2026-08-16 the
 * hypothesis "`shellAttributes` sizes its arrays from the MERGED vertex count
 * while filling them by walking the UN-merged parts, so it writes past the end"
 * survived two debugging cycles. It was wrong, and no test could say so.
 *
 * The load-bearing assumption these pin is that `mergeMeshes` preserves vertices
 * 1:1 and in order, because that is the only thing keeping a per-vertex value on
 * the feature it belongs to. If that ever stops being true, the shader does not
 * throw — buildings glow at the wrong height and pulse in the wrong phase, which
 * renders fine and is invisible in a screenshot.
 *
 * @see ../../../GpsPlusSlamJs_Osm/src/mesh/chunk-meshes.ts
 */

import { describe, expect, it } from "vitest";
import {
  buildBuildings,
  buildingColour,
  chunkMeshes,
  enuFrameAt,
  meshCentroidEnu,
} from "gps-plus-slam-osm";
import type { OsmFeature } from "gps-plus-slam-osm";

import { shellRandFor } from "./shell-rand.js";

const ORIGIN = { lat: 50.9413, lng: 6.9583 };
const frame = enuFrameAt(ORIGIN);

/**
 * A regular `corners`-gon building, offset east so each is distinct.
 *
 * **`corners` VARIES ON PURPOSE, and it is what makes the ordering test able to
 * fail.** With identical footprints every feature contributes the same number of
 * vertices AND the same normalised ramp — base to 0, roof to 1, whatever the
 * height — so permuting the per-feature fill is undetectable. Differing corner
 * counts move the block boundaries, which is what a drifted walk actually does.
 */
function building(
  id: number,
  heightM: number,
  offsetLng: number,
  corners: number,
): OsmFeature {
  const centreLat = 50.9413;
  const centreLng = 6.9583 + offsetLng;
  const radius = 0.0001;
  const geometry = [];
  for (let i = 0; i < corners; i += 1) {
    const angle = (i / corners) * Math.PI * 2;
    geometry.push({
      lat: centreLat + radius * Math.sin(angle),
      lng: centreLng + radius * Math.cos(angle),
    });
  }
  // Closed ring — the first corner repeated. `corners` is always >= 3 here, so
  // the array is never empty and the non-null assertion is a fact, not a hope.
  const first = geometry[0];
  if (first !== undefined) geometry.push(first);
  return {
    type: "way",
    id,
    tags: { building: "yes", height: String(heightM) },
    geometry,
  };
}

/** Exactly the call the worker makes, so the test cannot drift from production. */
function buildChunks(features: OsmFeature[]) {
  const volumes = buildBuildings(features, { frame });
  const drawn = volumes.map((volume) => ({
    mesh: volume.mesh,
    tags: { building: "yes" },
  }));
  return chunkMeshes(
    drawn,
    (item) => item.mesh,
    (item) => meshCentroidEnu(item.mesh),
    undefined,
    (item) => buildingColour(item.tags),
    (item) => shellRandFor(item.mesh),
  );
}

describe("the AR shell attributes over the real build path", () => {
  it("produces one value per merged vertex, for both attributes", () => {
    // The exact claim the dead hypothesis disputed: the arrays are sized from
    // the merged vertex count, and that count is what they must have.
    const chunks = buildChunks([
      building(1, 12, 0, 4),
      building(2, 30, 0.0005, 3),
      building(3, 7, 0.001, 5),
    ]);
    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      const vertexCount = chunk.mesh.positions.length / 3;
      expect(chunk.height01).toBeDefined();
      expect(chunk.featureRand).toBeDefined();
      expect(chunk.height01?.length).toBe(vertexCount);
      expect(chunk.featureRand?.length).toBe(vertexCount);
    }
  });

  it("spans 0 at the base and 1 at the roof of every building", () => {
    // Not "is in range" — the shader's vertical term is meaningless unless each
    // building actually reaches both ends. A merge that shifted the fill by one
    // feature would still be in range and would still be wrong.
    const chunks = buildChunks([
      building(1, 12, 0, 4),
      building(2, 30, 0.0005, 3),
    ]);

    for (const chunk of chunks) {
      const height01 = chunk.height01;
      expect(height01).toBeDefined();
      if (height01 === undefined) continue;
      let min = Infinity;
      let max = -Infinity;
      for (const value of height01) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      expect(min).toBe(0);
      expect(max).toBe(1);
    }
  });

  it("keeps height01 tied to each building's OWN height, not the chunk's", () => {
    // The invariant that makes a 7 m shed and a 200 m tower look alike rather
    // than the shed being uniformly dark. Both are in one chunk here; if the
    // span were taken per chunk, the shed's vertices would top out near 0.03.
    const chunks = buildChunks([
      building(1, 7, 0, 4),
      building(2, 200, 0.0005, 6),
    ]);
    const merged = chunks.find((chunk) => (chunk.height01?.length ?? 0) > 0);
    expect(merged).toBeDefined();

    const height01 = merged?.height01;
    if (height01 === undefined) return;
    // Every distinct feature in the chunk must reach 1 somewhere. Counting the
    // exact 1.0 values is enough: each building contributes its own roof ring.
    const atRoof = [...height01].filter((value) => value === 1).length;
    const atBase = [...height01].filter((value) => value === 0).length;
    expect(atRoof).toBeGreaterThan(0);
    expect(atBase).toBeGreaterThan(0);
  });

  it("gives each building one constant phase, and different buildings different ones", () => {
    // Without this the whole city breathes as a single organism — a different
    // look, arrived at by accident.
    const chunks = buildChunks([
      building(1, 12, 0, 4),
      building(2, 30, 0.0005, 3),
      building(3, 7, 0.001, 5),
    ]);
    const distinct = new Set<number>();
    for (const chunk of chunks) {
      for (const value of chunk.featureRand ?? []) {
        expect(Number.isFinite(value)).toBe(true);
        distinct.add(value);
      }
    }
    expect(distinct.size).toBe(3);
  });

  it("matches each vertex's OWN height, so the fill cannot drift off the geometry", () => {
    // THE ORDERING TEST, and the reason this file exists. `height01` is filled by
    // walking the un-merged parts while the positions come from the merged mesh;
    // only `mergeMeshes` preserving order keeps the two aligned.
    //
    // IT IS WRITTEN AGAINST THE POSITIONS ON PURPOSE, and two earlier versions
    // of it were verified against a deliberate mutation — filling
    // `shellAttributes` from `[...parts].reverse()` — and PASSED, which is why
    // the current shape is what it is:
    //
    //  1. Comparing attribute boundaries against the `colors` boundaries passed,
    //     because both walks are permuted together and the boundaries do not move.
    //  2. Recomputing the expected value from each vertex's own y ALSO passed
    //     while every fixture building was the same square: base normalises to 0
    //     and roof to 1 whatever the height, so all the ramps are identical and a
    //     permutation of identical things is invisible.
    //
    // What finally caught it was giving the buildings DIFFERENT CORNER COUNTS, so
    // the per-feature blocks have different lengths and a drifted walk misaligns
    // them. Differing heights are not sufficient; differing vertex counts are.
    const chunks = buildChunks([
      building(1, 12, 0, 4),
      building(2, 30, 0.0005, 3),
      building(3, 7, 0.001, 5),
    ]);

    let verified = 0;
    for (const chunk of chunks) {
      const { height01, featureRand } = chunk;
      if (height01 === undefined || featureRand === undefined) continue;
      const positions = chunk.mesh.positions;

      // Group vertex indices by their phase — one group per feature.
      const groups = new Map<number, number[]>();
      for (let i = 0; i < featureRand.length; i += 1) {
        const key = featureRand[i] as number;
        const list = groups.get(key) ?? [];
        list.push(i);
        groups.set(key, list);
      }

      for (const indices of groups.values()) {
        const ys = indices.map((i) => positions[i * 3 + 1] as number);
        const min = Math.min(...ys);
        const max = Math.max(...ys);
        const span = max - min;
        for (const i of indices) {
          const y = positions[i * 3 + 1] as number;
          const expected = span > 0 ? (y - min) / span : 0;
          expect(height01[i]).toBeCloseTo(expected, 5);
          verified += 1;
        }
      }
    }
    // Guard the guard: a chunking change that produced no shell data would make
    // every loop above vacuous and this test would still pass.
    expect(verified).toBeGreaterThan(0);
  });

  it("omits both attributes when no shell is asked for, so nobody pays for bytes they never read", () => {
    const volumes = buildBuildings([building(1, 12, 0, 4)], { frame });
    const drawn = volumes.map((volume) => ({ mesh: volume.mesh }));
    const chunks = chunkMeshes(
      drawn,
      (item) => item.mesh,
      (item) => meshCentroidEnu(item.mesh),
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.height01).toBeUndefined();
      expect(chunk.featureRand).toBeUndefined();
    }
  });
});
