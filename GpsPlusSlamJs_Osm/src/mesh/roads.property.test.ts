import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import type { MeshData } from "./mesh-data.js";
import { buildRoads, roadRank, roadWidthM } from "./roads.js";

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

/**
 * A small street network: a 4 x 4 lattice of nodes 15-40 m apart, jittered,
 * and two to five ways walking it from node to neighbouring node, so ways
 * share nodes (ends on another way, crossings, a way visiting a node twice,
 * hairpins where a walk steps back).
 */
const network = fc
  .record({
    spacing: fc.double({ min: 15, max: 40, noNaN: true }),
    jitter: fc.array(fc.double({ min: -4, max: 4, noNaN: true }), {
      minLength: 32,
      maxLength: 32,
    }),
    ways: fc.array(
      fc.record({
        start: fc.nat({ max: 15 }),
        steps: fc.array(fc.nat({ max: 3 }), { minLength: 1, maxLength: 6 }),
        tags,
      }),
      { minLength: 2, maxLength: 5 },
    ),
  })
  .map(({ spacing, jitter, ways }) => {
    const nodes: P[] = [];
    for (let i = 0; i < 16; i += 1) {
      nodes.push({
        x: (i % 4) * spacing + (jitter[2 * i] ?? 0),
        y: Math.floor(i / 4) * spacing + (jitter[2 * i + 1] ?? 0),
      });
    }
    const moves = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    return {
      nodes,
      ways: ways.map(({ start, steps, tags: t }) => {
        const path = [start];
        for (const step of steps) {
          const at = path[path.length - 1] as number;
          const [dx, dy] = moves[step] as readonly [number, number];
          const col = (at % 4) + dx;
          const row = Math.floor(at / 4) + dy;
          // A step off the lattice is not taken.
          if (col < 0 || col > 3 || row < 0 || row > 3) continue;
          path.push(row * 4 + col);
        }
        return { path, tags: t };
      }),
    };
  })
  .filter(({ ways }) => ways.every((w) => w.path.length >= 2));

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

/**
 * The join interior vertex `k` must get, from its geometry and the limit
 * alone (never from the mesh):
 * - a DISC at a hairpin, or where the inner mitre point would run past half
 *   of either neighbouring segment (`h tan(t / 2)`): two joins on one short
 *   segment could otherwise cross and fold the strip;
 * - a BEVEL where the mitre is longer than `limit` half widths
 *   (`1 / cos(t / 2)`) and the bevel's chord is at least 1 mm;
 * - a MITRE otherwise.
 * `undefined` within float noise of a threshold, where either answer is
 * right and the case is skipped rather than asserted on a coin toss.
 */
function expectedJoin(
  enu: readonly P[],
  k: number,
  half: number,
  limit: number,
): "disc" | "bevel" | "mitre" | undefined {
  const a = enu[k - 1] as P;
  const p = enu[k] as P;
  const c = enu[k + 1] as P;
  const halfTurn = (turnDeg(a, p, c) * Math.PI) / 360;
  const shortest = Math.min(
    Math.hypot(p.x - a.x, p.y - a.y),
    Math.hypot(c.x - p.x, c.y - p.y),
  );
  const near = (x: number, y: number): boolean =>
    Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(y));
  if (near(halfTurn, Math.PI / 2)) return undefined;
  if (halfTurn > Math.PI / 2) return "disc";
  const reach = half * Math.tan(halfTurn);
  if (near(reach, shortest / 2)) return undefined;
  if (reach > shortest / 2) return "disc";
  const ratio = 1 / Math.cos(halfTurn);
  const chord = 2 * half * Math.sin(halfTurn);
  if (near(ratio, limit) || near(chord, 1e-3)) return undefined;
  return ratio > limit && chord >= 1e-3 ? "bevel" : "mitre";
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
  // strip has special cases (mitre, bevel, fallback), so the
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

          // Ends keep their discs; every interior vertex gets the join its
          // geometry calls for, and a disc exactly where one is due.
          expect(hasCentreAt(mesh, enu[0] as P)).toBe(true);
          expect(hasCentreAt(mesh, enu[enu.length - 1] as P)).toBe(true);
          let discs = 2;
          let bevels = 0;
          for (let k = 1; k + 1 < enu.length; k += 1) {
            const join = expectedJoin(enu, k, half, limit);
            fc.pre(join !== undefined);
            expect(hasCentreAt(mesh, enu[k] as P)).toBe(join === "disc");
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

  // WHY (M4a review MINOR 3 and NIT 7): ways share nodes in every real
  // city, and since a junction is no longer a break the strip must stay
  // whole through a shared node as through any other: every way's own
  // segments covered (which covers every node it passes, shared or not:
  // `expectSegmentsCovered` samples each segment's ends on its centre line),
  // nothing folded, and each way's ribbon exactly what it is when built
  // alone, positions and indices (the property that makes roads buildable
  // over a delta).
  it("keeps every junction of a random network covered, unfolded and per way", () => {
    fc.assert(
      fc.property(network, mitreLimit, ({ nodes, ways }, limit) => {
        const features = ways.map((w, i) => ({
          type: "way",
          id: i + 1,
          tags: w.tags,
          geometry: w.path.map((n) => FRAME.toLatLng(nodes[n] as P)),
        })) as unknown as OsmFeature[];
        const together = buildRoads(features, {
          frame: FRAME,
          mitreLimit: limit,
        });
        ways.forEach((w, i) => {
          const mesh = together[i]?.mesh as MeshData;
          const tris = planTriangles(mesh);
          for (const tri of tris) {
            expect(signedArea(tri)).toBeGreaterThan(1e-6);
          }
          const enu = enuOf(w.path.map((n) => nodes[n] as P));
          expectSegmentsCovered(tris, enu, roadWidthM(w.tags) / 2);
          const [alone] = buildRoads([features[i] as OsmFeature], {
            frame: FRAME,
            mitreLimit: limit,
          });
          expect([...(alone?.mesh.positions ?? [])]).toEqual([
            ...mesh.positions,
          ]);
          expect([...(alone?.mesh.indices ?? [])]).toEqual([...mesh.indices]);
        });
      }),
      { numRuns: 150 },
    );
  });

  // WHY (owner decision 2026-11-09, city objects plan section 27): the class
  // order rests on millimetres, so every vertex of a way, the strip's and
  // every disc's (ends, hairpins, too-short segments), must sit at ONE lift
  // above the ground under it, `step * (rank + 0.4 f)` with f in [0, 1). A
  // disc lower than its strip shrinks the gap to the class below it (the
  // 0.5 mm end disc that fought at 226 m); a disc higher pokes through.
  // Sampled on a sloped, rippled ground, so the drape cannot hide an offset.
  it("lifts every disc and strip vertex of a way by one lift, its rank's", () => {
    fc.assert(
      fc.property(
        polyline,
        tags,
        fc.double({ min: 0.001, max: 0.01, noNaN: true }),
        fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        (points, t, step, slope) => {
          const ground = (east: number, north: number): number =>
            slope * east + 0.5 * Math.sin(north / 7);
          const [ribbon] = buildRoads([feature(t, points)], {
            frame: FRAME,
            rankStepM: step,
            groundHeightM: (p) => {
              const e = FRAME.toEnu(p);
              return ground(e.x, e.y);
            },
          });
          const pos = (ribbon?.mesh as MeshData).positions;
          const lifts: number[] = [];
          for (let i = 0; i < pos.length; i += 3) {
            const east = pos[i] ?? 0;
            const north = -(pos[i + 2] ?? 0);
            lifts.push((pos[i + 1] ?? 0) - ground(east, north));
          }
          const rank = roadRank(t);
          // Float32 positions over grounds of up to ~100 m: 0.05 mm, under a
          // tenth of the smallest step and far under the old 0.5 step drop.
          for (const lift of lifts) {
            expect(Math.abs(lift - (lifts[0] as number))).toBeLessThan(5e-5);
            expect(lift).toBeGreaterThan(step * rank - 5e-5);
            expect(lift).toBeLessThan(step * (rank + 0.4) + 5e-5);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
