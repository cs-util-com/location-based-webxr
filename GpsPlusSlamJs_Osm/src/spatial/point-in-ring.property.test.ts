/**
 * Point-in-ring properties.
 *
 * Why these tests matter:
 * `obstacles.ts` asks this predicate in DEGREES while `mesh/buildings.ts` asks
 * it in ENU METRES, and the justification for one implementation serving both
 * is a specific mathematical claim: crossing parity is invariant under any
 * invertible affine map, and lat/lng → local ENU is affine at this scale.
 *
 * That claim is load-bearing — if it were false, the obstacle index would be
 * quietly wrong everywhere — and the example suite backed it with a single
 * 10⁻⁴° square. A property over random rings, random points and random
 * invertible affine maps asserts the claim itself rather than one instance of
 * it. Raised in review on #259.
 *
 * @see point-in-ring.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { containsPoint, type PlanarPoint } from "./point-in-ring.js";

/** Twice the signed area — used only to reject degenerate generated rings. */
function twiceArea(ring: readonly PlanarPoint[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Distance from `v` to the segment ab. */
function distanceToSegment(
  v: PlanarPoint,
  a: PlanarPoint,
  b: PlanarPoint,
): number {
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

/** Distance from a point to the nearest edge of a ring. */
function distanceToRing(ring: readonly PlanarPoint[], v: PlanarPoint): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, distanceToSegment(v, ring[j]!, ring[i]!));
  }
  return best;
}

const coordinate = fc.double({
  min: -100,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

const point = fc.record({ x: coordinate, y: coordinate });

/**
 * Rings with enough vertices to be non-convex, AND with real area.
 *
 * fast-check reaches subnormal doubles (5e-324), and a "ring" whose vertices
 * differ by that much is entirely boundary — where
 * [`point-in-ring.ts.md`](./point-in-ring.ts.md) states the answer is
 * deliberately undefined.
 */
const ring = fc
  .array(point, { minLength: 3, maxLength: 10 })
  .filter((vertices) => Math.abs(twiceArea(vertices)) > 1);

/**
 * A ring and a probe that is not ON it.
 *
 * **This filter is the scope of the claim, not a convenience.** The sidecar
 * says containment for a point exactly on an edge is undefined — it lands on
 * whichever side the floating-point comparison falls. An affine map moves that
 * comparison, so an on-edge probe can legitimately flip, and asserting
 * otherwise would be asserting something the module explicitly does not
 * promise. fast-check finds those probes immediately (a subnormal `x` against
 * a ring with a vertex at the origin), which is how this scope got stated
 * rather than assumed.
 */
const ringAndProbe = fc
  .tuple(ring, point)
  .filter(([vertices, probe]) => distanceToRing(vertices, probe) > 1e-6);

interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** An invertible affine map: `ae - bd` bounded away from zero. */
const affine = fc
  .record({
    a: fc.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
    b: fc.double({ min: -5, max: 5, noNaN: true, noDefaultInfinity: true }),
    d: fc.double({ min: -5, max: 5, noNaN: true, noDefaultInfinity: true }),
    e: fc.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
    c: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
    f: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
  })
  .filter((m) => Math.abs(m.a * m.e - m.b * m.d) > 0.5);

const apply = (m: Affine, p: PlanarPoint): PlanarPoint => ({
  x: m.a * p.x + m.b * p.y + m.c,
  y: m.d * p.x + m.e * p.y + m.f,
});

describe("point-in-ring properties", () => {
  it("is invariant under any invertible affine map", () => {
    // THE CLAIM `obstacles.ts` RESTS ON, stated directly. Scaling one axis —
    // which is all the lat/lng anisotropy is — cannot change the answer, and
    // neither can rotation, shear or translation.
    fc.assert(
      fc.property(ringAndProbe, affine, ([vertices, probe], map) => {
        const before = containsPoint(vertices, probe);
        const after = containsPoint(
          vertices.map((v) => apply(map, v)),
          apply(map, probe),
        );
        expect(after).toBe(before);
      }),
    );
  });

  it("does not depend on the ring's winding", () => {
    fc.assert(
      fc.property(ringAndProbe, ([vertices, probe]) => {
        expect(containsPoint([...vertices].reverse(), probe)).toBe(
          containsPoint(vertices, probe),
        );
      }),
    );
  });

  it("does not depend on where the ring starts", () => {
    // A ring is a cycle, so rotating the vertex list names the same polygon.
    // An implementation that treated the first vertex specially — or that
    // missed the closing edge — would break this and nothing else.
    fc.assert(
      fc.property(ringAndProbe, fc.nat(), ([vertices, probe], offset) => {
        const shift = offset % vertices.length;
        const rotated = [...vertices.slice(shift), ...vertices.slice(0, shift)];
        expect(containsPoint(rotated, probe)).toBe(
          containsPoint(vertices, probe),
        );
      }),
    );
  });

  it("says no to points far outside the ring's extent", () => {
    // The one ABSOLUTE anchor: every property above is a self-consistency
    // claim, and a predicate that always returned `true` would satisfy all of
    // them. This is what stops that.
    fc.assert(
      fc.property(ring, (vertices) => {
        const maxX = Math.max(...vertices.map((v) => v.x));
        const maxY = Math.max(...vertices.map((v) => v.y));
        expect(containsPoint(vertices, { x: maxX + 1, y: maxY + 1 })).toBe(
          false,
        );
      }),
    );
  });

  it("finds an interior point of a generated convex ring", () => {
    // The other absolute anchor, in the opposite direction: a predicate that
    // always returned `false` would also satisfy every self-consistency claim.
    // A triangle's centroid is inside it, always.
    fc.assert(
      fc.property(point, point, point, (a, b, c) => {
        const triangle = [a, b, c];
        fc.pre(Math.abs(twiceArea(triangle)) > 1);
        const centroid = {
          x: (a.x + b.x + c.x) / 3,
          y: (a.y + b.y + c.y) / 3,
        };
        expect(containsPoint(triangle, centroid)).toBe(true);
      }),
    );
  });
});
