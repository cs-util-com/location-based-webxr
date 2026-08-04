import { describe, expect, it } from "vitest";

import { MeshBuilder, type MeshData } from "./mesh-data.js";
import {
  box,
  composed,
  disc,
  gable,
  prism,
  pyramid,
  quad,
  scaledToHeight,
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

  it("squashes to `radiusY` when one is given, leaving x and z alone", () => {
    // WHY THIS EXISTS AT ALL. Four of the six prototypes build their rounded
    // parts from `IcosahedronGeometry` under a NON-UNIFORM scale — P's tree
    // canopies are `(1, .85, 1)`, its sculpture blob `(1, .7, 1)`, D's
    // headstone caps `(1, .7, .45)`. The first ports approximated all of them
    // with a round sphere and recorded that as a known loss. The owner's
    // verdict on the gallery was specifically that "the 3d models/shapes I
    // liked look very different", so a squash that flattens a canopy by 30 %
    // is exactly the class of difference being judged, not a rounding detail.
    //
    // Only the Y axis is parameterised: every non-uniform `ico` in the four
    // liked P kinds squashes Y alone, and a primitive with three radii would be
    // an ellipsoid nobody has a caller for.
    const { lo, hi } = bounds(
      composed((b) => sphere(b, 1, 2, 12, 6, 0, 0, 0.5)),
    );
    expect(hi.x - lo.x).toBeCloseTo(2, 4);
    expect(hi.z - lo.z).toBeCloseTo(2, 4);
    expect(hi.y - lo.y).toBeCloseTo(1, 4);
    // Still centred where it was put — a squash must not also move it.
    expect((hi.y + lo.y) / 2).toBeCloseTo(2, 4);
  });

  it("carries the ELLIPSOID's normal, not the sphere's, when squashed", () => {
    // THE INVISIBLE HALF OF A NON-UNIFORM SCALE. Positions scale by `(1, k, 1)`
    // but normals scale by the INVERSE TRANSPOSE — `(1, 1/k, 1)`, renormalised.
    // Reusing the unit-sphere direction leaves every normal tilted toward the
    // poles, which shades a flattened canopy as though it were still round.
    // Nothing about the silhouette changes, so this is the failure mode that
    // survives a screenshot review; §4's winding bug was the same shape of bug.
    const radiusY = 0.5;
    const mesh = composed((b) => sphere(b, 1, 0, 16, 8, 0, 0, radiusY));
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const p = vertexAt(mesh, i);
      const n = {
        x: mesh.normals[i * 3] as number,
        y: mesh.normals[i * 3 + 1] as number,
        z: mesh.normals[i * 3 + 2] as number,
      };
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
      // Gradient of x^2/a^2 + y^2/b^2 + z^2/c^2 = 1 at the surface point.
      const g = { x: p.x, y: p.y / (radiusY * radiusY), z: p.z };
      const len = Math.hypot(g.x, g.y, g.z);
      expect(n.x).toBeCloseTo(g.x / len, 5);
      expect(n.y).toBeCloseTo(g.y / len, 5);
      expect(n.z).toBeCloseTo(g.z / len, 5);
    }
  });

  it("is still a closed solid wound outward once squashed", () => {
    // The squash must not flip anything: the volume of an ellipsoid of
    // revolution is the sphere's times `radiusY / radius`, and it stays
    // inscribed, so the same band applies scaled by that factor.
    const mesh = composed((b) => sphere(b, 1, 1, 12, 6, 0, 0, 0.4));
    const volume = signedVolume6(mesh) / 6;
    const analytic = (4 / 3) * Math.PI * 0.4;
    expect(volume).toBeGreaterThan(analytic * 0.8);
    expect(volume).toBeLessThan(analytic);
    expect(allFinite(mesh)).toBe(true);
  });
});

describe("gable", () => {
  /**
   * WHY THIS IS A PRIMITIVE NOW. It was always inside `hut`, and this sidecar
   * said so — _"if a later model needs a true gable it is `hut`'s roof half"_.
   * `poi-variants-l.ts` is that later model: L's church puts a gable on a nave
   * and a hip roof on its tower, and the two are the whole read of the
   * silhouette. The `D` port approximated its gable with `pyramid`, which turns
   * a ridged roof into a pyramid — acceptable on a 20 cm weather hood, not on
   * a church.
   *
   * Extracting it rather than copying it is what keeps `hut` and the standalone
   * roof from drifting: `hut` now calls this, so `hut`'s own tests cover it too.
   */
  it("puts its ridge along Z, spanning the full depth", () => {
    const { lo, hi } = bounds(composed((b) => gable(b, 2, 6, 1, 0.5)));
    expect(hi.x - lo.x).toBeCloseTo(2, 6);
    expect(hi.z - lo.z).toBeCloseTo(6, 6);
    expect(lo.y).toBeCloseTo(0.5, 6);
    expect(hi.y).toBeCloseTo(1.5, 6);
  });

  it("sits where it is put, in ENU, which the builder reflects", () => {
    // THE OFFSET IS ENU (`+z` north) AND THE BUILT MESH IS RENDER-FRAME
    // (`-z` north): `MeshBuilder.vertex` applies the reflection. So an ENU
    // `offsetZ` of -3 reads back as +3, and x is untouched. Pinning it here
    // rather than asserting a symmetric case is the point — a primitive that
    // pre-reflected its own z would double-apply it, which mirrors every
    // asymmetric model about the north axis and reads as "the door is on the
    // wrong side" rather than as a bug.
    const { lo, hi } = bounds(composed((b) => gable(b, 2, 2, 1, 0, 5, -3)));
    expect((lo.x + hi.x) / 2).toBeCloseTo(5, 6);
    expect((lo.z + hi.z) / 2).toBeCloseTo(3, 6);
  });

  it("winds every triangle to agree with its own normal", () => {
    // THE INVARIANT §4's inversion bug broke across all fifty models. A gable
    // is `FrontSide` + `flatShading` like everything else, so a reversed slope
    // draws the roof's underside: unchanged silhouette, wrong shading, and it
    // vanishes the moment culling is on. Only `hut`'s SLOPES were reversed and
    // its gable ends were not, so the two halves have to be checked together.
    const mesh = composed((b) => gable(b, 2, 3, 1.2));
    for (let t = 0; t * 3 < mesh.indices.length; t++) {
      const ia = mesh.indices[t * 3] as number;
      const a = vertexAt(mesh, ia);
      const b2 = vertexAt(mesh, mesh.indices[t * 3 + 1] as number);
      const c = vertexAt(mesh, mesh.indices[t * 3 + 2] as number);
      const ux = b2.x - a.x;
      const uy = b2.y - a.y;
      const uz = b2.z - a.z;
      const vx = c.x - a.x;
      const vy = c.y - a.y;
      const vz = c.z - a.z;
      const wx = uy * vz - uz * vy;
      const wy = uz * vx - ux * vz;
      const wz = ux * vy - uy * vx;
      const nx = mesh.normals[ia * 3] as number;
      const ny = mesh.normals[ia * 3 + 1] as number;
      const nz = mesh.normals[ia * 3 + 2] as number;
      expect(wx * nx + wy * ny + wz * nz).toBeGreaterThan(0);
    }
  });

  it("closes both gable ends rather than leaving a tent", () => {
    // Six triangles: two per slope, one per end. An open end is a hole
    // straight through the building from a low camera, which is every camera
    // in an AR overlay.
    expect(composed((b) => gable(b, 2, 3, 1)).triangleCount).toBe(6);
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

/**
 * WHY THESE LIVE HERE NOW. `scaledToHeight` and `groundedMesh` moved out of
 * `poi-variants.ts` when the gallery verdict was adopted (DEC-R7b-2a) — they are
 * mesh transforms with no opinion about variants, and the registry that needs
 * them could not import that file without a cycle. These tests came with them;
 * the file they were written in no longer exists.
 */
describe("scaledToHeight", () => {
  /**
   * WHY THIS EXISTS (DEC-V5). The `D` prototype is a DIORAMA: every kind fits a
   * common display envelope, with tiers at 0.35–0.7 m, 0.8–1.2 m and 1.35–1.9 m
   * "above the plinth" regardless of what the thing really is. Its
   * `place_of_worship` is ~1.9 m where the shipped one is 12 m.
   *
   * DEC-R6-8 keeps real-world scale, and §4 of this plan compares variants at
   * true size because that is part of what is being judged. Porting D's numbers
   * verbatim would put a 1.9 m church next to a 1.8 m human reference, which is
   * not a comparison of shapes — it is a comparison of one shape against a
   * mistake.
   *
   * So D's models are scaled UNIFORMLY to the height of the model already
   * shipped for that kind. Uniform is the whole point: it preserves every
   * proportion inside the model, which is exactly what the owner said they are
   * judging — _"I dont care about lighting or colors but the 3d models/shapes
   * ... look very different to each other"_.
   */
  it("scales a mesh uniformly to a target height", () => {
    const builder = new MeshBuilder();
    builder.vertex(1, 0, 0, 0, 1, 0);
    builder.vertex(0, 2, 0, 0, 1, 0);
    builder.vertex(0, 0, 1, 0, 1, 0);
    const scaled = scaledToHeight(builder.build(), 6);
    // Height 2 -> 6, so every coordinate triples.
    expect(scaled.positions[0]).toBeCloseTo(3, 6);
    expect(scaled.positions[4]).toBeCloseTo(6, 6);
  });

  it("leaves NORMALS untouched, because a uniform scale does not turn them", () => {
    // A non-uniform scale would need the inverse transpose; a uniform one does
    // not change any direction. Scaling the normals as well would be a no-op at
    // best and a denormalisation at worst — and a denormalised normal shades
    // wrong without changing any silhouette, which is this round's recurring
    // class of invisible defect.
    const builder = new MeshBuilder();
    builder.vertex(0, 1, 0, 0.6, 0.8, 0);
    const scaled = scaledToHeight(builder.build(), 5);
    expect(scaled.normals[0]).toBeCloseTo(0.6, 6);
    expect(scaled.normals[1]).toBeCloseTo(0.8, 6);
  });

  it("keeps the base on the ground", () => {
    // The contract every model and variant is held to. Scaling about the origin
    // preserves a zero base; scaling about the centre would not, and would bury
    // or float every ported model by half its height.
    const builder = new MeshBuilder();
    builder.vertex(0, 0, 0, 0, 1, 0);
    builder.vertex(0, 3, 0, 0, 1, 0);
    const scaled = scaledToHeight(builder.build(), 9);
    expect(scaled.positions[1]).toBeCloseTo(0, 6);
    expect(scaled.positions[4]).toBeCloseTo(9, 6);
  });

  it("returns the mesh unchanged when it has no height to scale", () => {
    // A flat model — a ground marking — has zero height, and dividing by it
    // would put Infinity into every position and remove the object from the
    // scene with nothing reported.
    const builder = new MeshBuilder();
    builder.vertex(0, 0, 0, 0, 1, 0);
    builder.vertex(1, 0, 1, 0, 1, 0);
    const mesh = builder.build();
    expect(scaledToHeight(mesh, 5)).toBe(mesh);
  });

  it("carries the colours through", () => {
    const builder = new MeshBuilder();
    builder.paint(0xff0000);
    builder.vertex(0, 0, 0, 0, 1, 0);
    builder.vertex(0, 1, 0, 0, 1, 0);
    const scaled = scaledToHeight(builder.build(), 2);
    expect(scaled.colours?.[0]).toBe(1);
  });
});

/**
 * WHY THESE EXIST (review, PR #250). `scaledToHeight` read the maximum y as the
 * mesh's height, which is only the same thing for a mesh already sitting on the
 * ground. Every caller today grounds first, so nothing was wrong in the
 * shipped path — but the function became a public export of this module when it
 * moved here, and the assumption was neither stated nor enforced.
 */
describe("scaledToHeight — inputs the shipped path never produces", () => {
  const spanning = (lowY: number, highY: number): MeshData => {
    const builder = new MeshBuilder();
    builder.vertex(0, lowY, 0, 0, 1, 0);
    builder.vertex(0, highY, 0, 0, 1, 0);
    builder.vertex(1, lowY, 0, 0, 1, 0);
    return builder.build();
  };

  it("scales by the EXTENT, not the distance from the origin", () => {
    // A 2 m object floating at y = 10. Reading the peak as its height would
    // scale it by 2/12 and return something 0.33 m tall.
    const scaled = scaledToHeight(spanning(10, 12), 2);
    let lowest = Infinity;
    let peak = -Infinity;
    for (let i = 1; i < scaled.positions.length; i += 3) {
      const y = scaled.positions[i] as number;
      if (y < lowest) lowest = y;
      if (y > peak) peak = y;
    }
    expect(peak - lowest).toBeCloseTo(2, 6);
  });

  it("returns the mesh unchanged for a non-finite target", () => {
    // `Infinity * 0` is NaN, and one NaN position removes the object from the
    // scene with nothing reported.
    const mesh = spanning(0, 3);
    expect(scaledToHeight(mesh, Number.POSITIVE_INFINITY)).toBe(mesh);
    expect(scaledToHeight(mesh, Number.NaN)).toBe(mesh);
  });

  it("returns the mesh unchanged when its own extent is non-finite", () => {
    const mesh = spanning(0, Number.POSITIVE_INFINITY);
    expect(scaledToHeight(mesh, 5)).toBe(mesh);
  });
});
