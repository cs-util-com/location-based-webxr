/**
 * Winding and normals, checked as INVARIANTS rather than per-shape expectations.
 *
 * WHY THIS FILE EXISTS. `buildings.test.ts` already asserts triangle counts,
 * bounding boxes in metres, and that wall normals are horizontal — and every one
 * of those passed while every wall quad in the package was wound inside-out.
 * They could not have failed: a count is blind to orientation, and "ny === 0"
 * is equally true of an outward normal and its negation.
 *
 * The reason orientation is easy to get wrong here is one line in `extrude.ts`:
 * the ENU→3D mapping is `(p.x, height, p.y)`, i.e. 3D z = ENU **north**. With Y
 * up that is a HANDEDNESS FLIP — a counter-clockwise loop in `(east, north)` is
 * *clockwise* seen from +Y. `flatCap` and `addCap` compensate by emitting
 * `(a, c, b)`; anything that emits `(a, b, c)` on ENU-ordered points is
 * silently reversed. Nothing in the type system says so, so it has to be a test.
 *
 * The two invariants below are deliberately shape-agnostic, because the failure
 * is not about pyramids or gables — it is about that one mapping, and any new
 * roof shape will meet it too:
 *
 * 1. **The assigned normal agrees with the emitted winding.** Otherwise the
 *    surface is lit as if it faced one way and culled as if it faced the other.
 * 2. **Normals point away from the inside of the volume.** Otherwise the
 *    building is inside-out: correct in silhouette, invisible or black under
 *    backface culling.
 *
 * Neither is caught by rendering the demo, because `building-view.ts` sets
 * `side: THREE.DoubleSide` — which is there to make a *wrongly wound* wall show
 * up as a shading oddity instead of a hole, and therefore also hides it.
 */

import { describe, expect, it } from "vitest";

import type { EnuPoint } from "./enu.js";
import { extrudeBuilding } from "./extrude.js";
import type { ExtrudedBuilding } from "./extrude.js";
import type { MeshData } from "./mesh-data.js";
import type { RoofShape } from "./building-heights.js";

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function vertex(mesh: MeshData, index: number): Vec3 {
  return {
    x: mesh.positions[index * 3] as number,
    y: mesh.positions[index * 3 + 1] as number,
    z: mesh.positions[index * 3 + 2] as number,
  };
}

function normal(mesh: MeshData, index: number): Vec3 {
  return {
    x: mesh.normals[index * 3] as number,
    y: mesh.normals[index * 3 + 1] as number,
    z: mesh.normals[index * 3 + 2] as number,
  };
}

/** `(b - a) x (c - a)`, unnormalised — the direction the winding faces. */
function windingNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Centre of the mesh's bounding box — inside the volume for a convex footprint. */
function meshCentre(mesh: MeshData): Vec3 {
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i] as number;
    const y = mesh.positions[i + 1] as number;
    const z = mesh.positions[i + 2] as number;
    lo.x = Math.min(lo.x, x);
    lo.y = Math.min(lo.y, y);
    lo.z = Math.min(lo.z, z);
    hi.x = Math.max(hi.x, x);
    hi.y = Math.max(hi.y, y);
    hi.z = Math.max(hi.z, z);
  }
  return {
    x: (lo.x + hi.x) / 2,
    y: (lo.y + hi.y) / 2,
    z: (lo.z + hi.z) / 2,
  };
}

interface Triangle {
  readonly index: number;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly c: Vec3;
  /** The face direction implied by the vertex ORDER. */
  readonly winding: Vec3;
  /** The normal actually written into the buffer (averaged over the corners). */
  readonly assigned: Vec3;
  readonly centre: Vec3;
}

function triangles(mesh: MeshData): Triangle[] {
  const out: Triangle[] = [];
  for (let t = 0; t * 3 < mesh.indices.length; t++) {
    const ia = mesh.indices[t * 3] as number;
    const ib = mesh.indices[t * 3 + 1] as number;
    const ic = mesh.indices[t * 3 + 2] as number;
    const a = vertex(mesh, ia);
    const b = vertex(mesh, ib);
    const c = vertex(mesh, ic);
    const na = normal(mesh, ia);
    const nb = normal(mesh, ib);
    const nc = normal(mesh, ic);
    out.push({
      index: t,
      a,
      b,
      c,
      winding: windingNormal(a, b, c),
      assigned: {
        x: (na.x + nb.x + nc.x) / 3,
        y: (na.y + nb.y + nc.y) / 3,
        z: (na.z + nb.z + nc.z) / 3,
      },
      centre: {
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        z: (a.z + b.z + c.z) / 3,
      },
    });
  }
  // Degenerate slivers carry no orientation, so they cannot be judged.
  return out.filter((t) => length(t.winding) > 1e-6);
}

/**
 * Triangles whose assigned normal points back INTO the volume.
 *
 * A rectangular footprint gives a convex volume, so "away from the bounding-box
 * centre" is exactly "outward" and no winding-number machinery is needed.
 */
function inwardTriangles(mesh: MeshData): Triangle[] {
  const centre = meshCentre(mesh);
  return triangles(mesh).filter((t) => {
    const away = {
      x: t.centre.x - centre.x,
      y: t.centre.y - centre.y,
      z: t.centre.z - centre.z,
    };
    return dot(t.assigned, away) <= 0;
  });
}

/** A 20 x 10 m rectangle, counter-clockwise in ENU — the common OSM case. */
const RECTANGLE: readonly EnuPoint[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
];

/** The same rectangle wound the other way. Real OSM rings arrive both ways. */
const CLOCKWISE: readonly EnuPoint[] = [...RECTANGLE].reverse();

/**
 * A rectangle whose FIRST edge is the short one.
 *
 * This is not a cosmetic variation. `orientedBoundingBox` walks edges in ring
 * order and swaps `axis`/`cross` when the first edge turns out to be the short
 * side — but it keeps `cross` as the old `axis`, and since `cross` was
 * `rot90(axis)`, the swapped pair is `rot(-90)` instead. The frame is MIRRORED,
 * so every outward direction derived from it flips. A ridged roof therefore
 * comes out inside-out for exactly half of all rectangular footprints, decided
 * by which corner the mapper happened to start at — which is why `RECTANGLE`
 * alone cannot prove `ridgeRoof` correct.
 */
const SHORT_SIDE_FIRST: readonly EnuPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 20 },
  { x: 0, y: 20 },
];

const SHAPES: readonly RoofShape[] = [
  "flat",
  "pyramidal",
  "dome",
  "skillion",
  "gabled",
  "hipped",
];

function build(
  ring: readonly EnuPoint[],
  roofShape: RoofShape,
): ExtrudedBuilding {
  return extrudeBuilding([ring], {
    minHeightM: 0,
    eaveHeightM: 8,
    totalHeightM: roofShape === "flat" ? 8 : 12,
    roofShape,
  });
}

describe("the emitted winding agrees with the assigned normal", () => {
  /**
   * WHY THIS MATTERS. Shading comes from the normal buffer and backface culling
   * comes from the winding. When they disagree the surface is lit correctly and
   * culled backwards, so it looks right in a screenshot with culling off and
   * vanishes the moment a renderer turns culling on — which is the default. It
   * is the single hardest class of geometry bug to see, because the "proof" a
   * developer reaches for (a screenshot) is exactly the artefact that hides it.
   *
   * `flatCap`/`addCap` already handle the handedness flip with `(a, c, b)`. This
   * pins that EVERY emitter does, so the compensation cannot be forgotten in one
   * of them again.
   */
  for (const shape of SHAPES) {
    it(`holds for every triangle of a ${shape} roof`, () => {
      const mesh = build(RECTANGLE, shape);
      expect(mesh.triangleCount).toBeGreaterThan(0);

      const disagreeing = triangles(mesh).filter(
        (t) => dot(t.winding, t.assigned) <= 0,
      );
      expect(
        disagreeing.map((t) => ({
          triangle: t.index,
          winding: t.winding,
          assigned: t.assigned,
        })),
      ).toEqual([]);
    });
  }

  it("assigns normals that lie in the face plane, not merely near it", () => {
    // A skillion is by definition a SLOPED plane. Giving its vertices the flat
    // normal (0, 1, 0) makes it shade identically to a flat roof, so the slope
    // is only visible in silhouette — the geometry is right and the picture is
    // wrong, which reads as "the roof tag did nothing".
    const mesh = build(RECTANGLE, "skillion");
    for (const t of triangles(mesh)) {
      const cosine =
        dot(t.winding, t.assigned) / (length(t.winding) * length(t.assigned));
      expect(cosine).toBeCloseTo(1, 3);
    }
  });
});

describe("normals point out of the volume, not into it", () => {
  /**
   * WHY THIS MATTERS, and why it is a separate check. `apexRoof` and `ridgeRoof`
   * derive the normal from the winding with `faceNormal`, so the two ALWAYS
   * agree — the check above is structurally incapable of failing for them. What
   * can still be wrong is the direction both of them share, and for those two
   * functions it was: every face of a pyramid, gable and hip pointed down and
   * inward, so a roof was lit from underneath.
   *
   * A rectangular footprint gives a convex volume, so "away from the centre" is
   * exactly "outward" and needs no winding-number machinery.
   */
  for (const shape of SHAPES) {
    it(`holds for every triangle of a ${shape} roof`, () => {
      const mesh = build(RECTANGLE, shape);
      expect(
        inwardTriangles(mesh).map((t) => ({
          triangle: t.index,
          normal: t.assigned,
        })),
      ).toEqual([]);
    });
  }

  it("does not depend on which way the caller wound the ring", () => {
    // `addWalls` normalises winding with `isCounterClockwise`; the roof builders
    // read `rings[0]` raw. So a clockwise footprint — half of real OSM data —
    // could produce correct walls under an inside-out roof, and the building
    // would be wrong only from certain angles.
    for (const shape of SHAPES) {
      const inward = inwardTriangles(build(CLOCKWISE, shape)).length;
      expect({ shape, inward }).toEqual({ shape, inward: 0 });
    }
  });

  it("does not depend on which corner the ring starts at", () => {
    // See SHORT_SIDE_FIRST: the oriented bounding box mirrors its own frame
    // when the ring's first edge is the short side, which inverts every ridged
    // roof built on it. Half of all rectangles start that way, so this is a
    // coin flip per building rather than a rare edge case.
    for (const shape of SHAPES) {
      const inward = inwardTriangles(build(SHORT_SIDE_FIRST, shape)).length;
      expect({ shape, inward }).toEqual({ shape, inward: 0 });
    }
  });
});

describe("the roof approximation flag reaches a consumer", () => {
  /**
   * WHY THIS MATTERS. `roof.ts` computes `isApproximate` carefully and its
   * docstring says a consumer "that wants to know how much of what it draws is
   * real can ask" — but `extrudeBuilding` returned a bare `MeshData`, so no
   * consumer could. The demo substituted
   * `roofShape === 'gabled' || roofShape === 'hipped'`, which is a DIFFERENT
   * claim: a gabled roof on an actual rectangle is exact, and that is the
   * common case the whole approximation argument rests on. So the counter that
   * exists to confirm the census on real data was measuring something else.
   */
  it("reports a gabled roof on a real rectangle as EXACT", () => {
    const mesh = build(RECTANGLE, "gabled");
    expect(mesh.roofIsApproximate).toBe(false);
  });

  it("reports a gabled roof on an L-shape as approximated", () => {
    // The oriented bounding rectangle is not the footprint here, so the ridge
    // is in approximately — not exactly — the right place.
    const lShape: readonly EnuPoint[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 8 },
      { x: 8, y: 8 },
      { x: 8, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(build(lShape, "gabled").roofIsApproximate).toBe(true);
  });

  it("reports a flat roof as exact, because it is", () => {
    expect(build(RECTANGLE, "flat").roofIsApproximate).toBe(false);
  });

  it("reports a courtyard building's ridge roof as approximated", () => {
    // `ridgeRoof` only ever reads `rings[0]`, so a rectangular outer ring with
    // an inner ring gets a SOLID ridge roof spanning the courtyard while
    // `isRectangular(outer, box)` is true — the one case where the flag
    // asserted something false rather than merely being conservative. European
    // blocks like the `building-block` fixture are exactly this shape.
    const courtyard: readonly EnuPoint[] = [
      { x: 6, y: 6 },
      { x: 6, y: 14 },
      { x: 14, y: 14 },
      { x: 14, y: 6 },
    ];
    const mesh = extrudeBuilding([RECTANGLE, courtyard], {
      minHeightM: 0,
      eaveHeightM: 8,
      totalHeightM: 12,
      roofShape: "gabled",
    });
    expect(mesh.roofIsApproximate).toBe(true);
  });
});
