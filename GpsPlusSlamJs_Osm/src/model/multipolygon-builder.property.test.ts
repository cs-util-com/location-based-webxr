/**
 * Ring-stitching property tests.
 *
 * Why these tests matter:
 * The plan names multipolygon ring stitching as "specifically where hand-rolled
 * converters diverge", and the C# reference it ports from has two known limits
 * (single ring only; only one orientation flip). Example tests can pin the
 * cases we thought of; these pin the algebra for cases we did not.
 *
 * The generator builds a ring, cuts it into segments, then shuffles and
 * randomly reverses them — which is exactly what OSM does when several mappers
 * draw parts of one boundary in different sessions and directions.
 *
 * @see multipolygon-builder.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  stitchRings,
  isClosedRing,
  isPointInRing,
  groupRingsIntoPolygons,
  signedRingArea,
} from "./multipolygon-builder.js";
import type { LatLng } from "./osm-feature.js";

/** A convex polygon ring with `n` corners on a circle of radius `r`. */
function circleRing(n: number, r: number, cx = 0, cy = 0): LatLng[] {
  const ring: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push({
      lat: +(cy + r * Math.sin(a)).toFixed(9),
      lng: +(cx + r * Math.cos(a)).toFixed(9),
    });
  }
  ring.push(ring[0]!);
  return ring;
}

/** Cuts a closed ring into `pieces` open segments that share endpoints. */
function cutRing(ring: LatLng[], pieces: number): LatLng[][] {
  const open = ring.slice(0, -1);
  const n = open.length;
  const size = Math.max(2, Math.ceil(n / pieces));
  const segments: LatLng[][] = [];
  for (let start = 0; start < n; start += size) {
    const seg: LatLng[] = [];
    for (let k = start; k <= Math.min(start + size, n); k++) {
      seg.push(open[k % n]!);
    }
    if (seg.length >= 2) {
      segments.push(seg);
    }
  }
  return segments;
}

const ringSpec = fc.record({
  corners: fc.integer({ min: 4, max: 14 }),
  pieces: fc.integer({ min: 1, max: 5 }),
  seed: fc.integer({ min: 0, max: 2 ** 31 }),
});

/** Deterministic shuffle + per-segment reversal driven by `seed`. */
function scramble<T extends LatLng[]>(segments: T[], seed: number): T[] {
  let s = seed || 1;
  const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff);
  const out = segments.map((seg) =>
    next() % 2 === 0 ? ([...seg].reverse() as T) : seg,
  );
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe("stitchRings properties", () => {
  it("a ring cut into pieces, shuffled and randomly reversed, always stitches back into ONE closed ring", () => {
    fc.assert(
      fc.property(ringSpec, ({ corners, pieces, seed }) => {
        const ring = circleRing(corners, 1);
        const segments = scramble(cutRing(ring, pieces), seed);

        const result = stitchRings(segments);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        expect(result.rings).toHaveLength(1);
        expect(isClosedRing(result.rings[0]!)).toBe(true);
      }),
    );
  });

  it("is order-independent: input order never changes the resulting ring as a SET of positions", () => {
    fc.assert(
      fc.property(ringSpec, ({ corners, pieces, seed }) => {
        const ring = circleRing(corners, 1);
        const segments = cutRing(ring, pieces);

        const a = stitchRings(segments);
        const b = stitchRings(scramble(segments, seed));
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) {
          return;
        }
        const key = (r: readonly LatLng[]) =>
          [...new Set(r.map((p) => `${p.lat},${p.lng}`))].sort().join("|");
        expect(key(b.rings[0]!)).toBe(key(a.rings[0]!));
      }),
    );
  });

  it("an already-closed ring passes through untouched", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 20 }), (corners) => {
        const ring = circleRing(corners, 1);
        const result = stitchRings([ring]);
        expect(result.ok && result.rings[0]).toEqual(ring);
      }),
    );
  });

  it("two disjoint rings stitch into exactly two rings, never merged", () => {
    fc.assert(
      fc.property(ringSpec, ({ corners, pieces, seed }) => {
        const near = circleRing(corners, 1, 0, 0);
        const far = circleRing(corners, 1, 100, 100);
        const segments = scramble(
          [...cutRing(near, pieces), ...cutRing(far, pieces)],
          seed,
        );
        const result = stitchRings(segments);
        expect(result.ok).toBe(true);
        expect(result.ok && result.rings).toHaveLength(2);
      }),
    );
  });

  it("a chain that cannot be closed reports failure and returns the partial chain", () => {
    fc.assert(
      fc.property(ringSpec, ({ corners, pieces }) => {
        const ring = circleRing(corners, 1);
        const segments = cutRing(ring, Math.max(2, pieces));
        // Drop one segment so the ring can never close.
        const broken = segments.slice(0, -1);
        fc.pre(broken.length >= 1);

        const result = stitchRings(broken);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.unclosed.length).toBeGreaterThan(
          0,
        );
      }),
    );
  });
});

describe("isPointInRing properties", () => {
  it("the centre of a circle-derived ring is inside it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 30 }), (corners) => {
        expect(isPointInRing({ lat: 0, lng: 0 }, circleRing(corners, 1))).toBe(
          true,
        );
      }),
    );
  });

  it("a point well outside the ring is outside it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 30 }), (corners) => {
        expect(
          isPointInRing({ lat: 50, lng: 50 }, circleRing(corners, 1)),
        ).toBe(false);
      }),
    );
  });

  it("is translation-invariant", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 20 }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        (corners, shift) => {
          const shifted = circleRing(corners, 1, shift, shift);
          expect(isPointInRing({ lat: shift, lng: shift }, shifted)).toBe(true);
        },
      ),
    );
  });
});

describe("groupRingsIntoPolygons properties", () => {
  it("every hole lands in the outer ring that geometrically contains it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 12 }), (corners) => {
        const outerA = circleRing(corners, 10, 0, 0);
        const outerB = circleRing(corners, 10, 100, 100);
        const holeInB = circleRing(corners, 2, 100, 100);

        const polygons = groupRingsIntoPolygons([outerA, outerB], [holeInB]);
        expect(polygons[0]).toHaveLength(1); // A got no hole
        expect(polygons[1]).toHaveLength(2); // B got its hole
      }),
    );
  });

  it("a hole inside nothing is dropped, never attached to an arbitrary outer ring", () => {
    // Silently punching a hole in the wrong building is worse than ignoring a
    // malformed relation member.
    const outer = circleRing(8, 1, 0, 0);
    const orphan = circleRing(8, 1, 500, 500);
    const polygons = groupRingsIntoPolygons([outer], [orphan]);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(1);
  });

  it("nested holes attach to the SMALLEST containing ring", () => {
    const block = circleRing(12, 100, 0, 0);
    const courtyard = circleRing(12, 30, 0, 0);
    const shed = circleRing(12, 5, 0, 0);
    const polygons = groupRingsIntoPolygons([block, courtyard], [shed]);
    // courtyard is smaller than block, so the shed belongs to it
    expect(polygons[1]).toHaveLength(2);
    expect(polygons[0]).toHaveLength(1);
  });

  it("outer-ring count is preserved regardless of holes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (n) => {
        const outers = Array.from({ length: n }, (_, i) =>
          circleRing(8, 1, i * 50, 0),
        );
        const holes = outers.map((_, i) => circleRing(8, 0.3, i * 50, 0));
        expect(groupRingsIntoPolygons(outers, holes)).toHaveLength(n);
      }),
    );
  });
});

describe("signedRingArea", () => {
  it("has magnitude independent of winding direction", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 20 }), (corners) => {
        const ring = circleRing(corners, 3);
        const reversed = [...ring].reverse();
        expect(Math.abs(signedRingArea(reversed))).toBeCloseTo(
          Math.abs(signedRingArea(ring)),
          9,
        );
      }),
    );
  });

  it("flips sign when winding flips", () => {
    const ring = circleRing(8, 3);
    expect(Math.sign(signedRingArea([...ring].reverse()))).toBe(
      -Math.sign(signedRingArea(ring)),
    );
  });
});
