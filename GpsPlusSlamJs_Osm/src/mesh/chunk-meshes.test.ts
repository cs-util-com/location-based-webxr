import { describe, expect, it } from "vitest";

import {
  CHUNK_SIZE_M,
  chunkKeyFor,
  chunkMeshes,
  meshCentroidEnu,
} from "./chunk-meshes.js";
import { MeshBuilder, type MeshData } from "./mesh-data.js";
import { box, composed } from "./poi-primitives.js";

/**
 * WHY THESE TESTS MATTER (W20). Chunking is a pure refactor of WHERE triangles
 * live, and its failure mode is that it is not: a grouping bug drops geometry at
 * a chunk boundary, and missing buildings in an OSM scene look exactly like
 * sparse OSM data. Nothing throws, nothing counts differently unless the counter
 * happens to be derived from the same place, and the only person who could
 * notice is someone who already knows what should be there.
 *
 * So the load-bearing assertion is conservation: the union of the chunks must
 * equal the merge that used to happen, triangle for triangle.
 */

/** One unit cube at an ENU offset, as a per-feature mesh. */
function cube(eastM: number, northM: number): MeshData {
  const builder = new MeshBuilder();
  box(builder, 1, 1, 1, 0, eastM, northM);
  return builder.build();
}

describe("chunkMeshes", () => {
  it("conserves every triangle, which is the whole claim", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Chunking changes where triangles are
    // batched and nothing else; a boundary bug that dropped a building would
    // read as sparse data rather than as a defect.
    const items = [
      cube(0, 0),
      cube(2000, 0),
      cube(0, 2000),
      cube(2000, 2000),
      cube(10, 10),
    ];
    const chunks = chunkMeshes(
      items,
      (m) => m,
      (m) => meshCentroidEnu(m),
    );
    const total = chunks.reduce((sum, c) => sum + c.mesh.triangleCount, 0);
    const expected = items.reduce((sum, m) => sum + m.triangleCount, 0);
    expect(total).toBe(expected);
  });

  it("groups nearby geometry together and distant geometry apart", () => {
    // The point of the exercise: a chunk has to be a compact group, or its
    // bounding box covers the whole scene and culling it is culling everything.
    const chunks = chunkMeshes(
      [cube(0, 0), cube(10, 10), cube(3000, 3000)],
      (m) => m,
      (m) => meshCentroidEnu(m),
    );
    expect(chunks).toHaveLength(2);
    const sizes = chunks.map((c) => c.mesh.triangleCount).sort((a, b) => a - b);
    expect(sizes[0]).toBeLessThan(sizes[1] as number);
  });

  it("produces NO chunk for an empty input, not one empty chunk", () => {
    // An empty BufferGeometry in the scene is still a draw call and a disposal
    // obligation, and "the layer drew nothing" should look like nothing.
    expect(chunkMeshes([], (m: MeshData) => m, meshCentroidEnu)).toEqual([]);
  });

  it("skips a feature that produced no triangles", () => {
    const empty = composed(() => undefined);
    const chunks = chunkMeshes(
      [empty, cube(0, 0)],
      (m) => m,
      (m) => meshCentroidEnu(m),
    );
    expect(chunks).toHaveLength(1);
  });

  it("is deterministic, because the e2e suite compares rendered frames", () => {
    const items = [cube(0, 0), cube(2000, 0), cube(5, 5)];
    const a = chunkMeshes(items, (m) => m, meshCentroidEnu);
    const b = chunkMeshes(items, (m) => m, meshCentroidEnu);
    expect(a.map((c) => c.key)).toEqual(b.map((c) => c.key));
    expect([...(a[0]?.mesh.positions ?? [])]).toEqual([
      ...(b[0]?.mesh.positions ?? []),
    ]);
  });
});

describe("chunkKeyFor", () => {
  it("puts a point and its near neighbour in the same cell", () => {
    expect(chunkKeyFor({ x: 10, y: 10 })).toBe(chunkKeyFor({ x: 20, y: 20 }));
  });

  it("separates points more than a chunk apart", () => {
    expect(chunkKeyFor({ x: 10, y: 0 })).not.toBe(
      chunkKeyFor({ x: 10 + CHUNK_SIZE_M * 2, y: 0 }),
    );
  });

  it("handles negative coordinates without folding them onto zero", () => {
    // `Math.trunc` would put -10 and +10 in the same cell, doubling the size of
    // the four chunks around the origin — which is exactly where the user is.
    expect(chunkKeyFor({ x: -10, y: -10 })).not.toBe(
      chunkKeyFor({ x: 10, y: 10 }),
    );
  });
});

describe("meshCentroidEnu", () => {
  it("returns ENU north, not the render frame's -z", () => {
    // Mixing the frames here would scatter each layer into a DIFFERENT set of
    // chunks — self-consistent per layer, and therefore invisible until two
    // layers had to agree about where something is.
    const centroid = meshCentroidEnu(cube(0, 100));
    expect(centroid.y).toBeCloseTo(100, 6);
    expect(centroid.x).toBeCloseTo(0, 6);
  });

  it("is the origin for an empty mesh rather than NaN", () => {
    // NaN would propagate into the chunk key as "NaN,NaN" — one chunk holding
    // every degenerate feature, at no location at all.
    expect(meshCentroidEnu(composed(() => undefined))).toEqual({ x: 0, y: 0 });
  });
});
