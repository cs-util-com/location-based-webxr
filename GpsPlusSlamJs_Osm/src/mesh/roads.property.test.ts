import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import type { MeshData } from "./mesh-data.js";
import { buildRoads, roadWidthM } from "./roads.js";

const FRAME = enuFrameAt({ lat: 50.9413, lng: 6.9583 });

interface P {
  readonly x: number;
  readonly y: number;
}

/** A random polyline: steps of 3-40 m, turns of up to +-175 degrees. */
const polyline = fc
  .array(
    fc.record({
      step: fc.double({ min: 3, max: 40, noNaN: true }),
      turn: fc.double({ min: -175, max: 175, noNaN: true }),
    }),
    { minLength: 1, maxLength: 10 },
  )
  .map((moves) => {
    const points: P[] = [{ x: 0, y: 0 }];
    let heading = 0;
    for (const { step, turn } of moves) {
      heading += (turn * Math.PI) / 180;
      const last = points[points.length - 1] as P;
      points.push({
        x: last.x + step * Math.cos(heading),
        y: last.y + step * Math.sin(heading),
      });
    }
    return points;
  });

/** A polyline turning only a little at each vertex: a curved street. */
const gentle = fc
  .array(fc.double({ min: -12, max: 12, noNaN: true }), {
    minLength: 1,
    maxLength: 12,
  })
  .map((turns) => {
    const points: P[] = [{ x: 0, y: 0 }];
    let heading = 0;
    for (const turn of turns) {
      const last = points[points.length - 1] as P;
      points.push({
        x: last.x + 12 * Math.cos(heading),
        y: last.y + 12 * Math.sin(heading),
      });
      heading += (turn * Math.PI) / 180;
    }
    return points;
  });

const tags = fc.constantFrom<Record<string, string>>(
  { highway: "footway" },
  { highway: "service" },
  { highway: "residential" },
  { highway: "primary", lanes: "4" },
);

const mitreLimit = fc.constantFrom(1, 1.5, 2, 4);

function feature(t: Record<string, string>, points: readonly P[]): OsmFeature {
  return {
    type: "way",
    id: 1,
    tags: t,
    geometry: points.map((p) => FRAME.toLatLng(p)),
  } as unknown as OsmFeature;
}

/** The mesh's triangles in ENU plan (render z is minus north). */
function planTriangles(mesh: MeshData): [P, P, P][] {
  const v = (k: number): P => {
    const base = (mesh.indices[k] ?? 0) * 3;
    return {
      x: mesh.positions[base] ?? 0,
      y: -(mesh.positions[base + 2] ?? 0),
    };
  };
  const out: [P, P, P][] = [];
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    out.push([v(i), v(i + 1), v(i + 2)]);
  }
  return out;
}

/**
 * Signed plan area in ENU. `MeshBuilder` mirrors north onto -z and reverses
 * each triangle, so a face-up triangle reads counter-clockwise (positive)
 * here.
 */
function signedArea([a, b, c]: [P, P, P]): number {
  return ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/** Whether `p` lies in the (counter-clockwise) triangle, within `eps` metres. */
function inside(t: [P, P, P], p: P, eps = 1e-4): boolean {
  for (let i = 0; i < 3; i += 1) {
    const a = t[i] as P;
    const b = t[(i + 1) % 3] as P;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) return false;
    const side = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
    if (side < -eps) return false;
  }
  return true;
}

/** The points the builder actually sees (projected through lat/lng). */
function enuOf(points: readonly P[]): P[] {
  return points.map((p) => FRAME.toEnu(FRAME.toLatLng(p)));
}

/** Whether the mesh has a vertex at plan point `p`: a disc's centre. */
function hasCentreAt(mesh: MeshData, p: P): boolean {
  // A disc's centre is the one vertex its eight triangles share; another
  // disc's rim or a strip corner can land on the same point but is used by
  // at most a few triangles.
  const uses = new Map<number, number>();
  for (const v of mesh.indices) uses.set(v, (uses.get(v) ?? 0) + 1);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (
      Math.abs((mesh.positions[i] ?? 0) - p.x) < 1e-3 &&
      Math.abs((mesh.positions[i + 2] ?? 0) + p.y) < 1e-3 &&
      (uses.get(i / 3) ?? 0) >= 8
    ) {
      return true;
    }
  }
  return false;
}

/** The turn at `b`, 0..180 degrees. */
function turnDeg(a: P, b: P, c: P): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  return Math.abs(
    (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI,
  );
}

/** Every segment's half-width rectangle is covered by some triangle. */
function expectSegmentsCovered(
  tris: readonly [P, P, P][],
  enu: readonly P[],
  half: number,
): void {
  for (let i = 0; i + 1 < enu.length; i += 1) {
    const a = enu[i] as P;
    const b = enu[i + 1] as P;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (let u = 0; u <= 1; u += 0.125) {
      for (const v of [-0.95, -0.5, 0, 0.5, 0.95]) {
        const q = {
          x: a.x + (b.x - a.x) * u + nx * v * half,
          y: a.y + (b.y - a.y) * u + ny * v * half,
        };
        expect(tris.some((tri) => inside(tri, q))).toBe(true);
      }
    }
  }
}

/** What the builder drew at interior vertex `k`: a disc, a bevel or a mitre. */
function joinAt(
  mesh: MeshData,
  enu: readonly P[],
  k: number,
  half: number,
  limit: number,
): "disc" | "bevel" | "mitre" {
  const p = enu[k] as P;
  if (hasCentreAt(mesh, p)) return "disc";
  const turn = turnDeg(enu[k - 1] as P, p, enu[k + 1] as P);
  const ratio = 1 / Math.cos((turn * Math.PI) / 360);
  // The builder mitres a bevel gap under 1 mm whatever the limit.
  const gap = 2 * half * Math.sin((turn * Math.PI) / 360);
  return ratio > limit && gap >= 1e-3 ? "bevel" : "mitre";
}

/**
 * A mitred join at `k` covers the whole outer wedge, the notch a dropped
 * disc used to leave: sampled at 97 % of the half width on both sides.
 */
function expectOuterWedgeCovered(
  tris: readonly [P, P, P][],
  enu: readonly P[],
  k: number,
  half: number,
): void {
  const p = enu[k] as P;
  const before = enu[k - 1] as P;
  const after = enu[k + 1] as P;
  const d1 = Math.atan2(p.y - before.y, p.x - before.x);
  const d2 = Math.atan2(after.y - p.y, after.x - p.x);
  for (let f = 0; f <= 1; f += 0.1) {
    for (const side of [1, -1]) {
      const nx = -Math.sin(d1) * (1 - f) - Math.sin(d2) * f;
      const ny = Math.cos(d1) * (1 - f) + Math.cos(d2) * f;
      const norm = Math.hypot(nx, ny);
      const q = {
        x: p.x + ((side * nx) / norm) * half * 0.97,
        y: p.y + ((side * ny) / norm) * half * 0.97,
      };
      expect(tris.some((tri) => inside(tri, q))).toBe(true);
    }
  }
}

describe("road ribbons - properties (M4a mitre strip)", () => {
  // WHY THIS MATTERS: the strip replaces DEC-R2-13's disc at every vertex,
  // whose one promise was "no gap at any angle, with no special cases". The
  // strip has special cases (mitre, bevel, fallback, junction), so the
  // promise must hold for every polyline rather than for the handful the
  // unit tests draw: nothing folds, every segment's half-width rectangle and
  // every mitred outer wedge is covered, the triangle count is exactly its
  // parts, and the ends keep their discs.
  it("never folds, leaves no gap, and counts exactly its parts", () => {
    fc.assert(
      fc.property(
        fc.oneof(polyline, gentle),
        tags,
        mitreLimit,
        (points, t, limit) => {
          const [ribbon] = buildRoads([feature(t, points)], {
            frame: FRAME,
            mitreLimit: limit,
          });
          const mesh = ribbon?.mesh as MeshData;
          const tris = planTriangles(mesh);
          const enu = enuOf(points);
          const half = roadWidthM(t) / 2;

          // No folded or degenerate triangle.
          for (const tri of tris) {
            expect(signedArea(tri)).toBeGreaterThan(1e-6);
          }

          expectSegmentsCovered(tris, enu, half);

          // Ends keep their discs; count the interior discs and bevels.
          expect(hasCentreAt(mesh, enu[0] as P)).toBe(true);
          expect(hasCentreAt(mesh, enu[enu.length - 1] as P)).toBe(true);
          let discs = 2;
          let bevels = 0;
          for (let k = 1; k + 1 < enu.length; k += 1) {
            const join = joinAt(mesh, enu, k, half, limit);
            if (join === "disc") discs += 1;
            else if (join === "bevel") bevels += 1;
            else expectOuterWedgeCovered(tris, enu, k, half);
          }
          expect(tris.length).toBe(2 * (enu.length - 1) + bevels + 8 * discs);
          // Never more than a disc at every vertex cost (DEC-R2-13).
          expect(tris.length).toBeLessThanOrEqual(
            2 * (enu.length - 1) + 8 * enu.length,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  // WHY: the city is rebuilt in a worker and diffed; a strip that depended
  // on anything but its input would flicker between builds.
  it("is deterministic", () => {
    fc.assert(
      fc.property(polyline, tags, (points, t) => {
        const once = buildRoads([feature(t, points)], { frame: FRAME });
        const twice = buildRoads([feature(t, points)], { frame: FRAME });
        expect(once[0]?.mesh.positions).toEqual(twice[0]?.mesh.positions);
        expect(once[0]?.mesh.indices).toEqual(twice[0]?.mesh.indices);
      }),
      { numRuns: 100 },
    );
  });
});
