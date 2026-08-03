import { describe, expect, it } from "vitest";

import type { MeshData } from "./mesh-data.js";
import {
  box,
  composed,
  disc,
  prism,
  pyramid,
  quad,
  sphere,
} from "./poi-primitives.js";

/**
 * WHY THESE TESTS MATTER (§4, DEC-R6-11/R6-15). Our vocabulary had no quads, no
 * discs, no pyramids and no rounded solids, and those are exactly what the
 * prototypes use to get their detail — so 34 models are about to be rebuilt on
 * primitives that have never existed before. A primitive that is subtly wrong is
 * multiplied by every model that composes it, and the three ways it can be wrong
 * are all invisible in a status line:
 *
 * - **Inside out.** Lit correctly, culled backwards. The object vanishes the
 *   moment a renderer turns culling on, which is the default.
 * - **Wrong size or off-origin.** `poi-models.test.ts` asserts every model sits
 *   ON the ground with its base at `y = 0`, so a primitive that emits around its
 *   own centre buries half of every model that uses it.
 * - **Degenerate.** A zero-area triangle produces NaN normals downstream, and
 *   NaN in an instance transform REMOVES the object with nothing reported.
 *
 * Each primitive is therefore checked for the same three things the plan asked
 * for — vertex count, bounding box, outward winding — plus finiteness.
 */

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const vertexAt = (mesh: MeshData, i: number): Vec3 => ({
  x: mesh.positions[i * 3] as number,
  y: mesh.positions[i * 3 + 1] as number,
  z: mesh.positions[i * 3 + 2] as number,
});

/**
 * Six times the signed volume, by the divergence theorem.
 *
 * WHY THIS AND NOT "normals point away from the centre". For a CLOSED solid this
 * is the exact statement of "wound outward" — positive means every face is wound
 * counter-clockwise seen from outside — and unlike the centroid test it needs no
 * convexity assumption, which matters because a sphere's caps and a pyramid's
 * apex fan are where a sign error actually hides.
 */
function signedVolume6(mesh: MeshData): number {
  let total = 0;
  for (let t = 0; t * 3 < mesh.indices.length; t++) {
    const a = vertexAt(mesh, mesh.indices[t * 3] as number);
    const b = vertexAt(mesh, mesh.indices[t * 3 + 1] as number);
    const c = vertexAt(mesh, mesh.indices[t * 3 + 2] as number);
    total +=
      a.x * (b.y * c.z - b.z * c.y) -
      a.y * (b.x * c.z - b.z * c.x) +
      a.z * (b.x * c.y - b.y * c.x);
  }
  return total;
}

function bounds(mesh: MeshData): { lo: Vec3; hi: Vec3 } {
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const v = vertexAt(mesh, i);
    lo.x = Math.min(lo.x, v.x);
    lo.y = Math.min(lo.y, v.y);
    lo.z = Math.min(lo.z, v.z);
    hi.x = Math.max(hi.x, v.x);
    hi.y = Math.max(hi.y, v.y);
    hi.z = Math.max(hi.z, v.z);
  }
  return { lo, hi };
}

const allFinite = (mesh: MeshData): boolean =>
  [...mesh.positions, ...mesh.normals].every((v) => Number.isFinite(v));

describe("disc", () => {
  it("emits a fan of `sides` triangles around one centre", () => {
    const mesh = composed((b) => disc(b, 1, 0, 8, true));
    expect(mesh.triangleCount).toBe(8);
    // A centre plus one rim vertex per side. Sharing the rim between adjacent
    // triangles is safe here and only here: a disc is FLAT, so every vertex
    // carries the same normal and there is no edge to smear across.
    expect(mesh.positions.length / 3).toBe(9);
  });

  it("lies in its own plane at the requested height", () => {
    const { lo, hi } = bounds(composed((b) => disc(b, 2, 1.5, 12, true)));
    expect(lo.y).toBeCloseTo(1.5, 6);
    expect(hi.y).toBeCloseTo(1.5, 6);
    expect(hi.x).toBeCloseTo(2, 6);
    expect(lo.x).toBeCloseTo(-2, 6);
  });

  it("faces up or down as asked, and the winding follows the normal", () => {
    // A DISC IS NOT CLOSED, so signed volume says nothing about it — the check
    // that means something is that the winding agrees with the assigned normal.
    // Disagreement is the "lit right, culled backwards" failure, and for a lid
    // on a fountain or a table top it is the difference between a surface and a
    // hole.
    for (const up of [true, false]) {
      const mesh = composed((b) => disc(b, 1, 0, 6, up));
      const a = vertexAt(mesh, mesh.indices[0] as number);
      const b2 = vertexAt(mesh, mesh.indices[1] as number);
      const c = vertexAt(mesh, mesh.indices[2] as number);
      // The y component of (b - a) x (c - a).
      const wy = (b2.z - a.z) * (c.x - a.x) - (b2.x - a.x) * (c.z - a.z);
      expect(Math.sign(wy)).toBe(up ? 1 : -1);
      expect(Math.sign(mesh.normals[1] as number)).toBe(up ? 1 : -1);
    }
  });
});

describe("quad", () => {
  it("emits two triangles over four corners", () => {
    const mesh = composed((b) =>
      quad(
        b,
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        [0, 0, -1],
      ),
    );
    expect(mesh.triangleCount).toBe(2);
    expect(mesh.positions.length / 3).toBe(4);
  });

  it("derives a normal from the corners when none is given", () => {
    // THE ESCAPE HATCH'S SHARP EDGE. `quad` exists so a model can place a panel
    // at an arbitrary angle — a sign face, a pitched solar panel, a lectern —
    // and having to hand-compute a normal for each is how a model ends up lit
    // as though it were flat. Deriving it is the default; passing one is the
    // override for a deliberately faceted look.
    // Wound counter-clockwise seen from ABOVE in ENU, so the derived normal is
    // +y. The convention is `(p1 - p0) x (p3 - p0)`, the same right-hand rule
    // every other emitter here uses.
    const mesh = composed((b) =>
      quad(b, [
        [0, 0, 0],
        [0, 0, 2],
        [2, 0, 2],
        [2, 0, 0],
      ]),
    );
    expect(mesh.normals[1]).toBeCloseTo(1, 6);
    expect(mesh.normals[0]).toBeCloseTo(0, 6);
  });
});

describe("pyramid", () => {
  it("emits four sides and a base", () => {
    const mesh = composed((b) => pyramid(b, 2, 2, 3));
    // Four side triangles plus two for the square base.
    expect(mesh.triangleCount).toBe(6);
  });

  it("sits on its base with the apex at the requested height", () => {
    const { lo, hi } = bounds(composed((b) => pyramid(b, 2, 4, 3, 0.5)));
    expect(lo.y).toBeCloseTo(0.5, 6);
    expect(hi.y).toBeCloseTo(3.5, 6);
    expect(hi.x).toBeCloseTo(1, 6);
    expect(hi.z).toBeCloseTo(2, 6);
  });

  it("is a closed solid wound outward", () => {
    const mesh = composed((b) => pyramid(b, 2, 2, 3));
    // Volume of a rectangular pyramid is base x height / 3 = 4.
    expect(signedVolume6(mesh) / 6).toBeCloseTo(4, 4);
    expect(allFinite(mesh)).toBe(true);
  });
});

describe("sphere", () => {
  it("is a closed solid wound outward, at roughly the right volume", () => {
    // A LOW-POLY SPHERE IS INSCRIBED, so its volume is BELOW the analytic
    // 4/3 pi r^3 and approaches it as the segment count rises. Asserting a
    // band rather than a value is the honest form — and the lower bound is
    // what a flipped cap or a missing ring would break.
    const mesh = composed((b) => sphere(b, 1, 1, 12, 6));
    const volume = signedVolume6(mesh) / 6;
    const analytic = (4 / 3) * Math.PI;
    expect(volume).toBeGreaterThan(analytic * 0.8);
    expect(volume).toBeLessThan(analytic);
    expect(allFinite(mesh)).toBe(true);
  });

  it("sits where it is put, not at the origin", () => {
    const { lo, hi } = bounds(composed((b) => sphere(b, 0.5, 2, 10, 5)));
    expect(lo.y).toBeCloseTo(1.5, 4);
    expect(hi.y).toBeCloseTo(2.5, 4);
  });

  it("emits no degenerate triangle at either pole", () => {
    // THE POLE IS WHERE A UV SPHERE GOES WRONG. Rings collapse to a point, so a
    // naive quad loop emits a zero-area triangle per segment at the top and
    // bottom — and `computeVertexNormals` turns those into NaN, which removes
    // the whole object from the scene. `prism` already had to learn this for
    // its cone case.
    const mesh = composed((b) => sphere(b, 1, 1, 10, 5));
    for (let t = 0; t * 3 < mesh.indices.length; t++) {
      const a = vertexAt(mesh, mesh.indices[t * 3] as number);
      const b2 = vertexAt(mesh, mesh.indices[t * 3 + 1] as number);
      const c = vertexAt(mesh, mesh.indices[t * 3 + 2] as number);
      const ux = b2.x - a.x;
      const uy = b2.y - a.y;
      const uz = b2.z - a.z;
      const vx = c.x - a.x;
      const vy = c.y - a.y;
      const vz = c.z - a.z;
      const area = Math.hypot(
        uy * vz - uz * vy,
        uz * vx - ux * vz,
        ux * vy - uy * vx,
      );
      expect(area).toBeGreaterThan(1e-9);
    }
  });
});

describe("box face painting", () => {
  it("paints only the named faces, leaving the rest the model's colour", () => {
    // THE CAPABILITY DEC-R6-15 WAS CHOSEN FOR. `poi-markers-gallery (2)`'s bench
    // — the one model the owner rated best — gets its read from a seat painted
    // differently from the frame it sits on. One box, two colours.
    const mesh = composed((b) =>
      box(b, 1, 1, 1, 0, 0, 0, { top: 0xff0000, north: 0x00ff00 }),
    );
    const colours = mesh.colours;
    expect(colours).toBeDefined();
    expect(colours?.length).toBe(mesh.positions.length);
    const distinct = new Set<string>();
    for (let i = 0; i < (colours?.length ?? 0); i += 3) {
      distinct.add(`${colours?.[i]},${colours?.[i + 1]},${colours?.[i + 2]}`);
    }
    // Red, green, and white for the four faces left alone.
    expect(distinct.size).toBe(3);
    expect(distinct.has("1,1,1")).toBe(true);
  });

  it("stays unpainted when no faces are named", () => {
    // The cost guard, at the primitive rather than the builder: `box` is called
    // by nearly every model and by `slabOnLegs`, `canopy` and `hut`. If it
    // painted unconditionally, every model would carry a colour buffer.
    expect(composed((b) => box(b, 1, 1, 1)).colours).toBeUndefined();
  });

  it("still emits a closed box wound outward when painted", () => {
    // Painting must not disturb the geometry — the failure mode of a face-keyed
    // emitter is emitting a face twice or skipping one, and neither changes the
    // vertex count in a way anyone would notice.
    const painted = composed((b) =>
      box(b, 2, 3, 4, 0, 0, 0, { top: 0xff0000 }),
    );
    const plain = composed((b) => box(b, 2, 3, 4));
    expect(painted.triangleCount).toBe(plain.triangleCount);
    expect(signedVolume6(painted) / 6).toBeCloseTo(24, 4);
    expect(signedVolume6(plain) / 6).toBeCloseTo(24, 4);
  });
});

/** Triangles whose vertex ORDER faces the opposite way from their own normal. */
function disagreeingTriangles(mesh: MeshData): number[] {
  const bad: number[] = [];
  for (let t = 0; t * 3 < mesh.indices.length; t++) {
    const ia = mesh.indices[t * 3] as number;
    const a = vertexAt(mesh, ia);
    const b = vertexAt(mesh, mesh.indices[t * 3 + 1] as number);
    const c = vertexAt(mesh, mesh.indices[t * 3 + 2] as number);
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const wx = uy * vz - uz * vy;
    const wy = uz * vx - ux * vz;
    const wz = ux * vy - uy * vx;
    if (Math.hypot(wx, wy, wz) < 1e-9) continue;
    const nx = mesh.normals[ia * 3] as number;
    const ny = mesh.normals[ia * 3 + 1] as number;
    const nz = mesh.normals[ia * 3 + 2] as number;
    if (wx * nx + wy * ny + wz * nz <= 0) bad.push(t);
  }
  return bad;
}

describe("every primitive's winding agrees with its own normals", () => {
  /**
   * THE BUG THIS TEST WAS WRITTEN TO FIND, and it found it immediately.
   *
   * `box` and `prism` emitted EVERY triangle wound against its own normal —
   * all 12 faces of a box, all 32 of an 8-sided prism — and through them so did
   * `slabOnLegs`, `canopy`, `postWithHead` and `hut`. Since those compose all
   * fifty POI models, **every marker in the demo was inside out**: the POI
   * material is `FrontSide` (three's default, and nothing overrides it for
   * markers), so what was drawn was the far interior wall of each object rather
   * than its near face.
   *
   * WHY IT SURVIVED SINCE W16. The silhouette is identical, the lighting is
   * computed from the assigned normals so it still looks lit, and the shape is
   * still recognisably a bench. `mesh-orientation.test.ts` pins exactly this
   * property — but only for `extrude.ts` and `roof.ts`, the two emitters that
   * had already been caught getting it wrong. `poi-primitives.ts` was never
   * covered, and `poi-models.test.ts` asserted counts, bounds and finiteness,
   * none of which a reversed winding disturbs.
   *
   * The lesson is the general one this repo keeps relearning: a property that
   * is worth a test for one emitter is worth it for ALL of them, or the next
   * emitter reintroduces the bug the test was written for.
   */
  const cases: readonly [string, MeshData][] = [
    ["box", composed((b) => box(b, 2, 3, 4))],
    [
      "box, painted",
      composed((b) => box(b, 2, 3, 4, 0, 0, 0, { top: 0xff0000 })),
    ],
    ["prism", composed((b) => prism(b, 1, 1, 2, 8))],
    ["cone (prism with a zero top)", composed((b) => prism(b, 1, 0, 2, 8))],
    ["disc facing up", composed((b) => disc(b, 1, 0, 8, true))],
    ["disc facing down", composed((b) => disc(b, 1, 0, 8, false))],
    ["pyramid", composed((b) => pyramid(b, 2, 2, 3))],
    ["sphere", composed((b) => sphere(b, 1, 1, 10, 5))],
    [
      "quad",
      composed((b) =>
        quad(b, [
          [0, 0, 0],
          [0, 0, 2],
          [2, 0, 2],
          [2, 0, 0],
        ]),
      ),
    ],
  ];

  for (const [name, mesh] of cases) {
    it(`holds for every triangle of ${name}`, () => {
      expect(mesh.triangleCount).toBeGreaterThan(0);
      expect(disagreeingTriangles(mesh)).toEqual([]);
    });
  }
});

describe("the primitives that already shipped", () => {
  it("keeps `box` and `prism` closed and outward-wound", () => {
    expect(signedVolume6(composed((b) => box(b, 2, 3, 4))) / 6).toBeCloseTo(
      24,
      4,
    );
    // A 16-sided prism of radius 1 and height 2 is inscribed in the cylinder,
    // so its volume is just under 2 pi and approaches it with the side count.
    const cyl = signedVolume6(composed((b) => prism(b, 1, 1, 2, 16))) / 6;
    expect(cyl).toBeLessThan(Math.PI * 2);
    expect(cyl).toBeGreaterThan(Math.PI * 2 * 0.9);
  });
});
