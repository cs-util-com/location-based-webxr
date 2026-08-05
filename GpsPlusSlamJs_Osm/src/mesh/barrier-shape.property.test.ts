/**
 * Barrier footprint properties.
 *
 * Why these tests matter:
 * `barrier-shape.ts.md` makes one headline claim — "every vertex is within half
 * a thickness of its own segment, whatever the way does" — and the example
 * suite pins it with a single hand-picked hairpin. That is the shape of
 * evidence a mitred implementation would also pass on most inputs; the whole
 * argument for per-segment quads is about arbitrary geometry, so the claim has
 * to be checked over arbitrary geometry.
 *
 * Raised in review on #259, which noted the package applies property tests
 * consistently elsewhere and these two modules had none.
 *
 * @see barrier-shape.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { barrierFootprints } from "./barrier-shape.js";
import { signedArea2, type EnuPoint } from "./enu.js";

/** Distance from `v` to the SEGMENT ab — not to the infinite line. */
function distanceToSegment(v: EnuPoint, a: EnuPoint, b: EnuPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(v.x - a.x, v.y - a.y);

  const t = Math.max(
    0,
    Math.min(1, ((v.x - a.x) * dx + (v.y - a.y) * dy) / lengthSquared),
  );
  return Math.hypot(v.x - (a.x + t * dx), v.y - (a.y + t * dy));
}

const coordinate = fc.double({
  min: -500,
  max: 500,
  noNaN: true,
  noDefaultInfinity: true,
});

const point = fc.record({ x: coordinate, y: coordinate });

/** Polylines long enough to have joins, short enough to stay fast. */
const polyline = fc.array(point, { minLength: 2, maxLength: 8 });

const thickness = fc.double({
  min: 0.05,
  max: 5,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * The same threshold `barrierFootprints` drops segments at.
 *
 * Mirrored rather than imported because the module keeps it private, and a
 * test that used a different bound would disagree with the code about how many
 * rings to expect — which is how this helper first failed.
 */
const MIN_SEGMENT_M = 1e-9;

/** The segments that actually produced a ring, in order. */
function realSegments(line: readonly EnuPoint[]): [EnuPoint, EnuPoint][] {
  const out: [EnuPoint, EnuPoint][] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) > MIN_SEGMENT_M) out.push([a, b]);
  }
  return out;
}

describe("barrier footprint properties", () => {
  it("keeps every vertex within half a thickness of its own segment", () => {
    // THE SIDECAR'S HEADLINE CLAIM, as a property rather than as one hairpin.
    // A mitred outline violates this without bound as a turn approaches 180
    // degrees; per-segment quads cannot, and this is what says so.
    fc.assert(
      fc.property(polyline, thickness, (line, thicknessM) => {
        const rings = barrierFootprints(line, thicknessM);
        const segments = realSegments(line);
        expect(rings).toHaveLength(segments.length);

        for (let i = 0; i < rings.length; i++) {
          const [a, b] = segments[i]!;
          for (const vertex of rings[i]!) {
            // A small absolute slack, because the half-offset is computed
            // through a square root and a division.
            expect(distanceToSegment(vertex, a, b)).toBeLessThanOrEqual(
              thicknessM / 2 + 1e-9,
            );
          }
        }
      }),
    );
  });

  it("gives each quad the area of its segment times the thickness", () => {
    fc.assert(
      fc.property(polyline, thickness, (line, thicknessM) => {
        const rings = barrierFootprints(line, thicknessM);
        const segments = realSegments(line);

        for (let i = 0; i < rings.length; i++) {
          const [a, b] = segments[i]!;
          const expected = Math.hypot(b.x - a.x, b.y - a.y) * thicknessM;
          const actual = Math.abs(signedArea2(rings[i]!) / 2);
          // Relative tolerance: these coordinates reach 500 m, where an
          // absolute epsilon would be tighter than the arithmetic.
          expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
            1e-6 * Math.max(1, expected),
          );
        }
      }),
    );
  });

  it("winds every quad the same way", () => {
    // `triangulate` reads the sign as orientation, so a single disagreeing
    // quad extrudes with its faces inverted. One example cannot establish this
    // for arbitrary segment directions — which is exactly what varies.
    fc.assert(
      fc.property(polyline, thickness, (line, thicknessM) => {
        const signs = barrierFootprints(line, thicknessM).map((ring) =>
          Math.sign(signedArea2(ring)),
        );
        expect(new Set(signs).size).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("never emits a non-finite vertex", () => {
    // A NaN vertex reaches the mesh, where three.js draws nothing and reports
    // nothing. Zero-length segments are the known source; this says no other
    // input reaches it either.
    fc.assert(
      fc.property(polyline, thickness, (line, thicknessM) => {
        for (const ring of barrierFootprints(line, thicknessM)) {
          for (const v of ring) {
            expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
          }
        }
      }),
    );
  });
});
