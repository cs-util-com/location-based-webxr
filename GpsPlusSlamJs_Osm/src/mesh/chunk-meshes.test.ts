import { describe, expect, it } from "vitest";

import {
  CHUNK_SIZE_M,
  chunkKeyFor,
  chunkMeshes,
  meshCentroidEnu,
  type RoofPaint,
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

describe("chunkMeshes — per-feature colours (W22/W23)", () => {
  it("gives every vertex of a feature that feature's colour, flat", () => {
    // FLAT PER FEATURE. A building whose walls faded into its neighbour's class
    // colour would read as a gradient someone chose, not as a bug.
    const chunks = chunkMeshes(
      [cube(0, 0), cube(10, 10)],
      (m) => m,
      meshCentroidEnu,
      CHUNK_SIZE_M,
      (_m) => 0xff0000,
    );
    const colors = chunks[0]?.colors;
    expect(colors).toBeDefined();
    for (let i = 0; i < (colors?.length ?? 0); i += 3) {
      expect(colors?.[i]).toBeCloseTo(1, 6);
      expect(colors?.[i + 1]).toBeCloseTo(0, 6);
      expect(colors?.[i + 2]).toBeCloseTo(0, 6);
    }
  });

  it("keeps each feature's colour on its OWN vertices", () => {
    // The merge preserves order, and this is what proves the colour fill follows
    // it. Getting it wrong paints building A with building B's colour — a wrong
    // answer that looks exactly like a right one.
    const items = [cube(0, 0), cube(10, 10)];
    const colours = [0xff0000, 0x0000ff];
    const chunks = chunkMeshes(
      items,
      (m) => m,
      meshCentroidEnu,
      CHUNK_SIZE_M,
      (m) => colours[items.indexOf(m)] as number,
    );
    const colors = chunks[0]?.colors as Float32Array;
    const perCube = (items[0] as MeshData).positions.length; // 3 floats/vertex
    // First cube red, second blue.
    expect(colors[0]).toBeCloseTo(1, 6);
    expect(colors[2]).toBeCloseTo(0, 6);
    expect(colors[perCube]).toBeCloseTo(0, 6);
    expect(colors[perCube + 2]).toBeCloseTo(1, 6);
  });

  it("emits NO colour buffer when the layer is one colour throughout", () => {
    // Bytes and a shader define bought for nothing.
    const chunks = chunkMeshes([cube(0, 0)], (m) => m, meshCentroidEnu);
    expect(chunks[0]?.colors).toBeUndefined();
  });

  it("sizes the colour buffer to the merged vertex count", () => {
    const chunks = chunkMeshes(
      [cube(0, 0), cube(5, 5)],
      (m) => m,
      meshCentroidEnu,
      CHUNK_SIZE_M,
      () => 0x00ff00,
    );
    const chunk = chunks[0];
    expect(chunk?.colors?.length).toBe(chunk?.mesh.positions.length);
  });
});

/**
 * Why these tests matter: the AR shell shader reads both of these per vertex,
 * and both are silent when wrong. A `height01` that is off puts the pulse phase
 * in the wrong place — which looks like a stylistic choice, not a bug. A
 * `featureRand` that leaks across the feature boundary makes neighbouring
 * buildings breathe in lockstep, which looks deliberate too. The only way either
 * is caught is here, where the feature boundaries still exist.
 */
describe("chunkMeshes - roof colours (bug 8, review finding 3)", () => {
  // WHY THESE TESTS MATTER. `roof:colour` was read nowhere and a chunk held one
  // colour per feature, so a red-tiled roof on white walls drew all white.
  // BASELINE MOVED BY PLAN (review finding 3, 2026-11-07): the roof was told
  // apart by an upward normal, which left an onion's downward-facing lower
  // half in the wall colour. It is now the item's roof vertex ranges, and in
  // them every face that is not vertical. These pin that rule on a cube whose
  // whole mesh is declared roof (top AND bottom paint, sides do not), that a
  // vertex outside the ranges never paints, and that a feature with no roof
  // colour is unchanged.
  const paint = (roof: RoofPaint | undefined) =>
    chunkMeshes(
      [cube(0, 0)],
      (m) => m,
      () => ({ x: 0, y: 0 }),
      undefined,
      () => 0xffffff,
      undefined,
      () => roof,
    )[0];
  const CUBE_VERTICES = cube(0, 0).positions.length / 3;

  /** "r,g,b" per vertex, split by whether the face is vertical. */
  function byFacing(chunk: ReturnType<typeof paint>): {
    vertical: Set<string>;
    other: Set<string>;
  } {
    const normals = chunk?.mesh.normals ?? new Float32Array();
    const colors = chunk?.colors ?? new Float32Array();
    const vertical = new Set<string>();
    const other = new Set<string>();
    for (let i = 0; i < normals.length / 3; i++) {
      const rgb = [...colors.slice(i * 3, i * 3 + 3)].join(",");
      (Math.abs(normals[i * 3 + 1] as number) < 1e-6 ? vertical : other).add(
        rgb,
      );
    }
    return { vertical, other };
  }

  it("paints the non-vertical vertices of the roof ranges, the rest with the wall colour", () => {
    const { vertical, other } = byFacing(
      paint({
        colour: 0xff0000,
        vertexRanges: [{ start: 0, end: CUBE_VERTICES }],
      }),
    );
    // Both sets non-empty and one colour each: equality with one-element sets.
    expect(other).toEqual(new Set(["1,0,0"]));
    expect(vertical).toEqual(new Set(["1,1,1"]));
  });

  it("never paints a vertex outside the ranges, whatever it faces", () => {
    const { vertical, other } = byFacing(
      paint({ colour: 0xff0000, vertexRanges: [] }),
    );
    expect(other).toEqual(new Set(["1,1,1"]));
    expect(vertical).toEqual(new Set(["1,1,1"]));
  });

  it("clamps a range that runs past the mesh, so it cannot paint a neighbour", () => {
    // Defensive: the ranges come from the caller. Two cubes in one chunk, the
    // first declaring a range far past its own end.
    const items: { mesh: MeshData; roof?: RoofPaint }[] = [
      {
        mesh: cube(0, 0),
        roof: { colour: 0xff0000, vertexRanges: [{ start: -5, end: 1e9 }] },
      },
      { mesh: cube(1, 0) },
    ];
    const chunk = chunkMeshes(
      items,
      (item) => item.mesh,
      () => ({ x: 0, y: 0 }),
      undefined,
      () => 0xffffff,
      undefined,
      (item) => item.roof,
    )[0];
    const colors = chunk?.colors ?? new Float32Array();
    const second = [...colors.slice(CUBE_VERTICES * 3)];
    expect(second.length).toBe(CUBE_VERTICES * 3);
    expect(new Set(second)).toEqual(new Set([1]));
  });

  it("is unchanged for a feature without a roof colour", () => {
    const plain = chunkMeshes(
      [cube(0, 0)],
      (m) => m,
      () => ({ x: 0, y: 0 }),
      undefined,
      () => 0x336699,
    )[0];
    const unpainted = chunkMeshes(
      [cube(0, 0)],
      (m) => m,
      () => ({ x: 0, y: 0 }),
      undefined,
      () => 0x336699,
      undefined,
      () => undefined,
    )[0];
    expect(unpainted?.colors).toEqual(plain?.colors);
  });
});

describe("chunkMeshes shell attributes", () => {
  /** A box from y=base to y=top, as two triangles' worth of vertices. */
  const column = (base: number, top: number): MeshData => ({
    positions: new Float32Array([
      0,
      base,
      0,
      1,
      base,
      0,
      1,
      top,
      0,
      0,
      top,
      0,
      0,
      base,
      0,
      1,
      top,
      0,
    ]),
    // `mergeMeshes` walks positions and normals in lockstep, so a fixture
    // without normals throws rather than failing an assertion.
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    triangleCount: 2,
    forcedEars: 0,
  });

  it("emits nothing extra unless a shell random is supplied", () => {
    // Every other layer must not pay two Float32Arrays for bytes it never reads.
    const [chunk] = chunkMeshes(
      [column(0, 10)],
      (m) => m,
      () => ({ x: 0, y: 0 }),
    );
    expect(chunk?.height01).toBeUndefined();
    expect(chunk?.featureRand).toBeUndefined();
  });

  it("normalises height within each feature's OWN extent", () => {
    // A part starting at min_height reads 0 at ITS base, not at the ground —
    // so each part breathes over its own extent.
    const [chunk] = chunkMeshes(
      [column(20, 30)],
      (m) => m,
      () => ({ x: 0, y: 0 }),
      CHUNK_SIZE_M,
      undefined,
      () => 0.5,
    );
    const h = chunk?.height01;
    expect(h).toBeDefined();
    // y=20 is the base ⇒ 0; y=30 is the top ⇒ 1.
    expect(Math.min(...(h ?? []))).toBeCloseTo(0, 6);
    expect(Math.max(...(h ?? []))).toBeCloseTo(1, 6);
  });

  it("keeps each feature's random on its OWN vertices", () => {
    // The failure this prevents: a fill that walks vertices without respecting
    // part boundaries, which desynchronises nothing and is invisible on screen.
    const [chunk] = chunkMeshes(
      [column(0, 10), column(0, 20)],
      (m) => m,
      () => ({ x: 0, y: 0 }),
      CHUNK_SIZE_M,
      undefined,
      (m) => (m.positions[7] === 10 ? 0.25 : 0.75),
    );
    const r = chunk?.featureRand ?? new Float32Array();
    expect(r).toHaveLength(12);
    // First feature's six vertices, then the second's — merge order preserved.
    expect([...r.slice(0, 6)]).toEqual([0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
    expect([...r.slice(6)]).toEqual([0.75, 0.75, 0.75, 0.75, 0.75, 0.75]);
  });

  it("yields 0 for a feature with no vertical extent, not NaN", () => {
    // A flat plate or a degenerate footprint divides by a zero span. NaN in a
    // vertex attribute takes the whole draw call with it.
    const [chunk] = chunkMeshes(
      [column(5, 5)],
      (m) => m,
      () => ({ x: 0, y: 0 }),
      CHUNK_SIZE_M,
      undefined,
      () => 0.5,
    );
    for (const v of chunk?.height01 ?? []) expect(v).toBe(0);
  });

  it("still carries colours when both are requested", () => {
    // The two fills are separate loops over the same parts; one must not have
    // displaced the other.
    const [chunk] = chunkMeshes(
      [column(0, 10)],
      (m) => m,
      () => ({ x: 0, y: 0 }),
      CHUNK_SIZE_M,
      () => 0xff0000,
      () => 0.5,
    );
    expect(chunk?.colors?.[0]).toBeCloseTo(1, 6);
    expect(chunk?.featureRand?.[0]).toBeCloseTo(0.5, 6);
    expect(chunk?.height01).toBeDefined();
  });
});
