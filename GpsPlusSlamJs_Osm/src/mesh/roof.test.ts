/**
 * `buildRoof`'s fallback ladder: which builder draws which footprint, what it
 * says about itself (`method`, `isApproximate`, `surfaceVertices`), and that
 * it never throws whatever ring it is given.
 *
 * The skeleton itself is tested in `roof-skeleton*.test.ts`; the tag-driven
 * behaviour through `extrudeBuilding` in `mesh-orientation.test.ts` and the
 * S3DB tests. This file pins the ladder between them.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { EnuPoint } from "./enu.js";
import type { RoofShape } from "./building-heights.js";
import type { RoofMesh, RoofOptions } from "./roof.js";
import { buildRoof } from "./roof.js";
import { triangulate } from "./triangulate.js";

const EAVE = 6;
const RIDGE = 11;

function roofOf(
  rings: readonly (readonly EnuPoint[])[],
  shape: RoofShape,
  extra: Partial<RoofOptions> = {},
): RoofMesh {
  return buildRoof(rings, triangulate(rings), {
    shape,
    eaveHeightM: EAVE,
    ridgeHeightM: RIDGE,
    ...extra,
  });
}

const vertexCount = (mesh: RoofMesh): number => mesh.positions.length / 3;

function heights(mesh: RoofMesh): number[] {
  const ys: number[] = [];
  for (let i = 1; i < mesh.positions.length; i += 3) {
    ys.push(mesh.positions[i] as number);
  }
  return ys;
}

// Positions are float32, so heights hold to about 0.1 mm.
const top = (mesh: RoofMesh): number => Math.max(...heights(mesh));

const RECTANGLE: EnuPoint[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 8 },
  { x: 0, y: 8 },
];

const L_SHAPE: EnuPoint[] = [
  { x: 0, y: 0 },
  { x: 14, y: 0 },
  { x: 14, y: 6 },
  { x: 6, y: 6 },
  { x: 6, y: 14 },
  { x: 0, y: 14 },
];

/** `ring` with `extra` collinear corners spread along its first edge. */
function withCollinearCorners(ring: EnuPoint[], extra: number): EnuPoint[] {
  const [a, b] = ring as [EnuPoint, EnuPoint];
  const along = Array.from({ length: extra }, (_, i) => {
    const k = (i + 1) / (extra + 1);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  });
  return [a, ...along, ...ring.slice(1)];
}

describe("buildRoof: the exact rungs", () => {
  // Why: a plain rectangle is most of the corpus and must keep the cheap box
  // roof; anything else must get the skeleton of its real outline.
  it("draws a rectangle with the box roof, gables after the slopes", () => {
    const gabled = roofOf([RECTANGLE], "gabled");
    expect(gabled.method).toBe("box");
    expect(gabled.isApproximate).toBe(false);
    expect(gabled.surfaceVertices).toBeLessThan(vertexCount(gabled));
    expect(top(gabled)).toBeCloseTo(RIDGE, 3);

    const hipped = roofOf([RECTANGLE], "hipped");
    expect(hipped.method).toBe("box");
    expect(hipped.surfaceVertices).toBe(vertexCount(hipped));
  });

  it("draws an L with the skeleton, up to the tagged ridge", () => {
    const gabled = roofOf([L_SHAPE], "gabled");
    expect(gabled.method).toBe("skeleton");
    expect(gabled.isApproximate).toBe(false);
    // The two wing ends are gables: vertical walls the caller paints as wall.
    expect(gabled.surfaceVertices).toBeLessThan(vertexCount(gabled));
    expect(top(gabled)).toBeCloseTo(RIDGE, 3);
    expect(Math.min(...heights(gabled))).toBeCloseTo(EAVE, 3);

    const hipped = roofOf([L_SHAPE], "hipped");
    expect(hipped.method).toBe("skeleton");
    expect(hipped.isApproximate).toBe(false);
    expect(hipped.surfaceVertices).toBe(vertexCount(hipped));
    expect(top(hipped)).toBeCloseTo(RIDGE, 3);
  });

  it("draws an L with the skeleton at any eave height, above and below zero", () => {
    // Why: positions are float32 and the eave a float64. Where float32 rounds
    // the eave UP by more than the closure check's 1e-6 (from |eave| >= 32 m,
    // and eaves are frame-relative, so relief puts real roofs there) every eave
    // vertex read as raised, the closure check failed and the roof fell to the
    // prism (M2 review finding 1, 2026-11-08: both corpus prisms). 40.3 m rounds
    // down and always passed; 40.4 m and -250.9 m round up and did not.
    for (const eave of [40.3, 40.4, 123.45, -250.9, 499.9, -0.7]) {
      for (const shape of ["gabled", "hipped"] as const) {
        const roof = roofOf([L_SHAPE], shape, {
          eaveHeightM: eave,
          ridgeHeightM: eave + 5,
        });
        expect(`${shape} at ${eave} m: ${roof.method}`).toBe(
          `${shape} at ${eave} m: skeleton`,
        );
      }
    }
  });

  it("draws a courtyard with the skeleton, never the box", () => {
    const hole: EnuPoint[] = [
      { x: 4, y: 3 },
      { x: 4, y: 5 },
      { x: 8, y: 5 },
      { x: 8, y: 3 },
    ];
    const roof = roofOf([RECTANGLE, hole], "hipped");
    expect(roof.method).toBe("skeleton");
    expect(roof.isApproximate).toBe(false);
  });

  it("says a gambrel or round roof off a rectangle is approximate", () => {
    // No cross-section on a skeleton yet: drawn as plain gabled, and says so.
    for (const shape of ["gambrel", "round"] as const) {
      const roof = roofOf([L_SHAPE], shape);
      expect(roof.method).toBe("skeleton");
      expect(roof.isApproximate).toBe(true);
    }
  });
});

describe("buildRoof: the fallback rungs", () => {
  // Why: each rung is reached only by footprints the corpus rarely holds, so a
  // regression in one would otherwise go unseen until a city showed it.
  it("retries with another nudge when the stitched mesh does not close", () => {
    // A random star whose first nudge leaves a fold in the stitched mesh
    // (SkeletonFailure from skeleton-mesh.ts); the second nudge closes it.
    const star: EnuPoint[] = [
      { x: 14.078632394317538, y: 0 },
      { x: 9.914552187653287, y: 3.965452538505752 },
      { x: 7.942324767425197, y: 7.108508336003523 },
      { x: 1.4819450636918365, y: 4.752134179571199 },
      { x: -0.8995241110352774, y: 3.5361902375786003 },
      { x: -3.532773438116367, y: 3.634847131191911 },
      { x: -11.226735419329124, y: 4.027197387935776 },
      { x: -8.85981942015947, y: -2.5169607564268626 },
      { x: -19.668436545102193, y: -11.509916277519967 },
      { x: -11.012314412095389, y: -17.734966374736988 },
      { x: -0.6932731115709576, y: -4.828911726210062 },
      { x: 2.4813352341943635, y: -4.918632280652562 },
      { x: 20.26382220028862, y: -11.924646203202599 },
    ];
    const roof = roofOf([star], "hipped");
    expect(roof.method).toBe("skeleton");
    expect(roof.isApproximate).toBe(false);
  });

  it("falls back to a hipped skeleton when no gabled one closes", () => {
    // Fails as gabled with both nudges (found by a random search).
    const star: EnuPoint[] = [
      { x: 21.05, y: 0 },
      { x: 6.593, y: 2.385 },
      { x: 5.957, y: 4.751 },
      { x: 6.03, y: 9.517 },
      { x: 4.203, y: 24.154 },
      { x: -3.036, y: 16.506 },
      { x: -2.141, y: 3.959 },
      { x: -9.346, y: 5.627 },
      { x: -4.699, y: 0.037 },
      { x: -8.23, y: -5.695 },
      { x: -7.891, y: -9.366 },
      { x: -2.136, y: -14.155 },
      { x: 4.286, y: -9.009 },
      { x: 8.103, y: -4.686 },
    ];
    const roof = roofOf([star], "gabled");
    expect(roof.method).toBe("hipped-skeleton");
    expect(roof.isApproximate).toBe(true);
    expect(roof.surfaceVertices).toBe(vertexCount(roof));
  });

  it("takes the box roof when a gabled skeleton finds no gable end", () => {
    // Heidelberg way/247081699: a 9 x 7 m quadrilateral tagged
    // roof:orientation=across, not rectangular to 2 %. Across puts the gables
    // on its long walls, which are not wing ends of the all-slopes skeleton,
    // so the skeleton finds none. The box roof turned across still fits
    // within the overhang limit and draws the tagged gables, as it did before
    // the skeleton; a hipped roof would drop the tag. 39 of the corpus's 52
    // across-tagged skeleton roofs were such (2026-11-08).
    const quad: EnuPoint[] = [
      { x: 23.81, y: -42.69 },
      { x: 27.59, y: -51.29 },
      { x: 20.87, y: -53.7 },
      { x: 17.09, y: -45.42 },
    ];
    const roof = roofOf([quad], "gabled", { orientation: "across" });
    expect(roof.method).toBe("box-fallback");
    expect(roof.isApproximate).toBe(true);
    expect(roof.surfaceVertices).toBeLessThan(vertexCount(roof));
    // Untagged, the same quad has wing ends on its short walls.
    expect(roofOf([quad], "gabled").method).toBe("skeleton");
  });

  it("takes the box roof for a near-rectangle above the vertex cap", () => {
    // A 20 x 10 m block with a 10 x 0.6 m notch: 3 % short of its rectangle,
    // so not the exact box, but within the 1 m overhang limit. 300 corners on
    // one edge put it above the cap.
    const notched: EnuPoint[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 15, y: 10 },
      { x: 15, y: 9.4 },
      { x: 5, y: 9.4 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(roofOf([notched], "gabled").method).toBe("skeleton");
    const roof = roofOf([withCollinearCorners(notched, 300)], "gabled");
    expect(roof.method).toBe("box-fallback");
    expect(roof.isApproximate).toBe(true);
  });

  it("draws an L above the vertex cap as a full-height prism", () => {
    // Its rectangle overhangs it by 8 m, so the box roof would span the yard.
    const roof = roofOf([withCollinearCorners(L_SHAPE, 300)], "hipped");
    expect(roof.method).toBe("prism");
    expect(roof.isApproximate).toBe(true);
    expect(top(roof)).toBeCloseTo(RIDGE, 3);
    // The lid is the roof surface; the prism's sides are wall.
    expect(roof.surfaceVertices).toBeGreaterThan(0);
    expect(roof.surfaceVertices).toBeLessThan(vertexCount(roof));
    const lid = heights(roof).slice(0, roof.surfaceVertices);
    expect(lid.every((y) => Math.abs(y - RIDGE) < 1e-4)).toBe(true);
  });

  it("never throws on a malformed ring", () => {
    // Why: one building with a broken way must not take its chunk down.
    const broken = [
      [{ x: 0, y: 0 }, undefined, { x: 5, y: 5 }, { x: 0, y: 5 }],
    ] as unknown as EnuPoint[][];
    const nan: EnuPoint[] = [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 3 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    for (const shape of ["gabled", "hipped", "gambrel"] as const) {
      expect(() =>
        buildRoof(
          broken,
          { vertices: [], indices: [], forcedEars: 0 },
          {
            shape,
            eaveHeightM: EAVE,
            ridgeHeightM: RIDGE,
          },
        ),
      ).not.toThrow();
      expect(() => roofOf([nan], shape)).not.toThrow();
    }
  });
});

describe("buildRoof over any ring (fuzz)", () => {
  // Why: OSM holds self-crossing, self-touching, duplicated and collinear
  // rings. Whatever comes in, the roof is finite, inside its tagged heights,
  // and its surface block is a prefix of its vertices.
  const coordinate = fc.double({ min: -30, max: 30, noNaN: true });
  const point = fc.record({ x: coordinate, y: coordinate });
  const ring = fc
    .array(point, { minLength: 3, maxLength: 14 })
    .chain((points) =>
      // Repeat some corners, so rings with duplicates are common.
      fc
        .array(fc.nat({ max: points.length - 1 }), { maxLength: 3 })
        .map((repeats) => {
          const out = [...points];
          for (const i of repeats) out.splice(i, 0, points[i] as EnuPoint);
          return out;
        }),
    );
  const shape = fc.constantFrom<RoofShape>(
    "gabled",
    "hipped",
    "gambrel",
    "round",
  );

  it("is finite, between eaves and ridge, and never throws", () => {
    fc.assert(
      fc.property(ring, shape, fc.boolean(), (footprint, tag, across) => {
        const roof = roofOf(
          [footprint],
          tag,
          across ? { orientation: "across" } : {},
        );
        expect(roof.positions.every(Number.isFinite)).toBe(true);
        for (const y of heights(roof)) {
          expect(y).toBeGreaterThanOrEqual(EAVE - 1e-4);
          expect(y).toBeLessThanOrEqual(RIDGE + 1e-4);
        }
        expect(roof.surfaceVertices).toBeGreaterThanOrEqual(0);
        expect(roof.surfaceVertices).toBeLessThanOrEqual(vertexCount(roof));
      }),
      { numRuns: 200 },
    );
  });
});
