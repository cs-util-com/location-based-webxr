import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { EnuPoint } from "./enu.js";
import { signedArea2 } from "./enu.js";
import type { SkeletonRoof } from "./roof-skeleton.js";
import {
  faceTriangles,
  SkeletonFailure,
  skeletonFootprint,
  skeletonPlanArea,
  skeletonRoof,
} from "./roof-skeleton.js";
import { skeletonMesh } from "./skeleton-mesh.js";
import type { MeshData } from "./mesh-data.js";
import { buildRoof } from "./roof.js";
import { triangulate } from "./triangulate.js";
import { containsPoint } from "../spatial/point-in-ring.js";

/**
 * Properties of the skeleton roof over random simple footprints.
 *
 * Why this file matters: every non-rectangular ridged roof in every city goes
 * through `skeletonRoof`, and the shapes OSM holds are far more varied than
 * any hand-written case. The properties are the roof's contract (it covers
 * the footprint, stays inside it, never folds, never produces NaN) checked
 * over shapes nobody chose, plus an oracle that does not share the code's
 * reasoning: on a convex footprint every point's height is its distance to
 * the nearest wall line.
 */

/** A star-shaped polygon: simple by construction, reflex corners included. */
const starPolygon = fc
  .record({
    n: fc.integer({ min: 4, max: 18 }),
    radii: fc.array(fc.double({ min: 3, max: 25, noNaN: true }), {
      minLength: 18,
      maxLength: 18,
    }),
    gaps: fc.array(fc.double({ min: 0.4, max: 1, noNaN: true }), {
      minLength: 18,
      maxLength: 18,
    }),
  })
  .map(({ n, radii, gaps }) => {
    const used = gaps.slice(0, n);
    const total = used.reduce((s, g) => s + g, 0);
    let angle = 0;
    return used.map((gap, i) => {
      const r = radii[i] ?? 10;
      const point = { x: r * Math.cos(angle), y: r * Math.sin(angle) };
      angle += (gap / total) * 2 * Math.PI;
      return point;
    });
  });

/** A convex polygon: corners on a circle at increasing angles. */
const convexPolygon = fc
  .record({
    radius: fc.double({ min: 3, max: 30, noNaN: true }),
    gaps: fc.array(fc.double({ min: 0.3, max: 1, noNaN: true }), {
      minLength: 3,
      maxLength: 12,
    }),
  })
  .map(({ radius, gaps }) => {
    const total = gaps.reduce((s, g) => s + g, 0);
    let angle = 0;
    return gaps.map((gap) => {
      const point = {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      };
      angle += (gap / total) * 2 * Math.PI;
      return point;
    });
  })
  .filter((ring) => {
    // Drop near-degenerate triangles: an angle under a few degrees is a
    // sliver, outside what the oracle tolerance is sized for.
    return ring.every((p, i) => {
      const a = ring[(i + ring.length - 1) % ring.length] as EnuPoint;
      const b = ring[(i + 1) % ring.length] as EnuPoint;
      const turn = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
      return turn > 0.5;
    });
  });

const area = (points: readonly EnuPoint[]): number =>
  Math.abs(signedArea2(points)) / 2;

function distanceToWalls(points: readonly EnuPoint[], p: EnuPoint): number {
  let best = Number.POSITIVE_INFINITY;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as EnuPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const k = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
    );
    best = Math.min(best, Math.hypot(p.x - a.x - k * dx, p.y - a.y - k * dy));
  });
  return best;
}

function distanceToWallLines(points: readonly EnuPoint[], p: EnuPoint): number {
  let best = Number.POSITIVE_INFINITY;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as EnuPoint;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const gap = Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x));
    best = Math.min(best, gap / length);
  });
  return best;
}

function tAt(roof: SkeletonRoof, p: EnuPoint): number | undefined {
  for (const face of roof.faces) {
    if (face.vertical) continue;
    for (const [a, b, c] of faceTriangles(face)) {
      const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(det) < 1e-12) continue;
      const wa = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
      const wb = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
      const wc = 1 - wa - wb;
      if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) {
        return wa * a.t + wb * b.t + wc * c.t;
      }
    }
  }
  return undefined;
}

describe("skeletonRoof over random star-shaped footprints", () => {
  it("covers the footprint within 0.5 %, stays inside it, never folds, no NaN", () => {
    fc.assert(
      fc.property(starPolygon, (footprint) => {
        const roof = skeletonRoof([footprint]);
        const want = area(footprint);
        expect(Math.abs(skeletonPlanArea(roof) - want)).toBeLessThan(
          want * 0.005,
        );
        const points = roof.faces.flatMap((face) => face.points);
        expect(points.every((p) => Number.isFinite(p.x + p.y + p.t))).toBe(
          true,
        );
        const slopes = roof.faces.filter((face) => !face.vertical);
        const outside = slopes
          .flatMap((face) => face.points)
          .filter((p) => !containsPoint(footprint, p))
          .map((p) => distanceToWalls(footprint, p));
        expect(outside.filter((d) => d >= 0.01)).toEqual([]);
        // A slope face runs up from its wall and back down to it, so in plan
        // it winds against the outline (clockwise for the counter-clockwise
        // outer ring); a face that winds the other way has folded over its
        // neighbour.
        const folded = slopes
          .map((face) => signedArea2(face.points))
          .filter((area) => area >= 1e-6);
        expect(folded).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });
});

describe("skeletonRoof against an independent oracle", () => {
  it("on a convex footprint, the height is the distance to the nearest wall line", () => {
    // Why: in a convex polygon every wall can see every point, so the
    // wavefront reaches a point exactly at its distance to the nearest wall
    // line. Nothing in that statement depends on how the events are found.
    fc.assert(
      fc.property(convexPolygon, (footprint) => {
        const roof = skeletonRoof([footprint]);
        const c = footprint.reduce(
          (s, p) => ({
            x: s.x + p.x / footprint.length,
            y: s.y + p.y / footprint.length,
          }),
          { x: 0, y: 0 },
        );
        for (const corner of footprint) {
          for (const k of [0.25, 0.5, 0.8]) {
            const p = {
              x: c.x + (corner.x - c.x) * k,
              y: c.y + (corner.y - c.y) * k,
            };
            const t = tAt(roof, p);
            expect(t).toBeDefined();
            // 0.5 mm of jitter moves a wall line by at most about 1 mm.
            expect(
              Math.abs((t ?? Number.NaN) - distanceToWallLines(footprint, p)),
            ).toBeLessThan(0.003);
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});

/** The mesh as a list of corner keys per triangle, in emitted order. */
function triangleKeys(mesh: MeshData): string[][] {
  const key = (i: number): string =>
    [0, 1, 2].map((k) => mesh.positions[i * 3 + k]).join(",");
  const out: string[][] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    out.push([0, 1, 2].map((k) => key(mesh.indices[i + k] as number)));
  }
  return out;
}

/**
 * The edges used by only one triangle, and every directed edge used twice.
 * A closed, consistently wound surface has none of the second kind, and its
 * open boundary is exactly the eave ring.
 */
function openEdges(mesh: MeshData): { open: string[][]; repeated: string[] } {
  const directed = new Map<string, number>();
  for (const [a, b, c] of triangleKeys(mesh)) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = `${p}>${q}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
  }
  const open: string[][] = [];
  const repeated: string[] = [];
  for (const [k, count] of directed) {
    const [p, q] = k.split(">") as [string, string];
    if (count > 1) repeated.push(k);
    if (!directed.has(`${q}>${p}`)) open.push([p, q]);
  }
  return { open, repeated };
}

/**
 * True when the corner key lies at the eaves on a wall of `eaves`, within 1 mm.
 * The mesh is in the render frame, where ENU north is -z.
 */
function onEaveRing(
  key: string,
  eaves: readonly EnuPoint[],
  eaveM: number,
): boolean {
  const [x, y, z] = key.split(",").map(Number) as [number, number, number];
  return (
    Math.abs(y - eaveM) < 1e-3 && distanceToWalls(eaves, { x, y: -z }) < 1e-3
  );
}

/** Every surface triangle faces up, and every triangle agrees with its normal. */
function badNormals(mesh: MeshData, surfaceVertices: number): number[] {
  const bad: number[] = [];
  const p = (i: number, k: number): number =>
    mesh.positions[i * 3 + k] as number;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[t + k] as number) as [
      number,
      number,
      number,
    ];
    const u = [0, 1, 2].map((k) => p(b, k) - p(a, k));
    const v = [0, 1, 2].map((k) => p(c, k) - p(a, k));
    const cross = [
      (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
      (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
      (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
    ];
    const n = [0, 1, 2].map((k) => mesh.normals[a * 3 + k] as number);
    const agree = cross.reduce((s, x, k) => s + x * (n[k] as number), 0);
    const up =
      a < surfaceVertices
        ? (n[1] as number) > 0
        : Math.abs(n[1] as number) < 1e-6;
    if (agree < 0 || !up) bad.push(t / 3);
  }
  return bad;
}

describe("the skeleton roof as a mesh (skeleton-mesh.ts)", () => {
  // Why: the mesh is what is drawn. A crack along a ridge shows sky, an edge
  // used twice in one direction is a fold or a duplicate, and a slope facing
  // down is culled. So: normals up on every surface, gables vertical, and the
  // surface closed except along the ring it stands on.
  const expectClosedSurface = (
    mesh: MeshData,
    surfaceVertices: number,
    eaves: readonly EnuPoint[],
    eaveM: number,
  ): void => {
    expect(badNormals(mesh, surfaceVertices)).toEqual([]);
    const { open, repeated } = openEdges(mesh);
    expect(repeated).toEqual([]);
    const strays = open.filter(
      ([p, q]) =>
        !onEaveRing(p as string, eaves, eaveM) ||
        !onEaveRing(q as string, eaves, eaveM),
    );
    expect(strays).toEqual([]);
  };
  const expectClosedMesh = (
    roof: SkeletonRoof,
    eaves: readonly EnuPoint[],
  ): void => {
    const { mesh, surfaceVertices } = skeletonMesh(roof, {
      eaveM: 7,
      slope: 0.8,
    });
    expectClosedSurface(mesh, surfaceVertices, eaves, 7);
  };

  it("draws the same rung at any eave, closed and facing up, at any slope", () => {
    // Through buildRoof, so nothing the closure check rejects is discarded:
    // a roof that fails takes the next rung, and the rung it lands on must not
    // depend on the eave. The eave sweeps [-500, 500] m because eaves are
    // frame-relative and positions float32 (M2 review finding 1: from
    // |eave| >= 32 m the old check refused a quarter to a half of all stars and
    // L-shapes, so they became prisms); the rise sweeps slopes from about 0.02
    // to over 10. Not "always the skeleton": about one random star in 2,700
    // fails both nudges as a hipped roof at every eave (2026-11-08, 5,400
    // stars), which is the ladder working, and asserting it away would make
    // this property flaky.
    fc.assert(
      fc.property(
        starPolygon,
        fc.constantFrom<"gabled" | "hipped">("gabled", "hipped"),
        // Whole millimetres, not fc.double: a double drawn from [-500, 500]
        // is nearly always a tiny number or a bound (it is uniform over bit
        // patterns), and neither ever showed finding 1.
        fc.integer({ min: -500_000, max: 500_000 }).map((mm) => mm / 1000),
        fc.integer({ min: 300, max: 40_000 }).map((mm) => mm / 1000),
        (footprint, shape, eaveM, rise) => {
          const roof = buildRoof([footprint], triangulate([footprint]), {
            shape,
            eaveHeightM: eaveM,
            ridgeHeightM: eaveM + rise,
          });
          const atZero = buildRoof([footprint], triangulate([footprint]), {
            shape,
            eaveHeightM: 0,
            ridgeHeightM: rise,
          });
          expect(roof.method).toBe(atZero.method);
          if (!roof.method.includes("skeleton")) return;
          expectClosedSurface(roof, roof.surfaceVertices, footprint, eaveM);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("is closed up to a soffit ring when it stands on an offset ring", () => {
    // An invented roof (M8) stands on the footprint grown by its 0.32 m
    // overhang; the open boundary is then that ring, not the walls.
    const o = 0.32;
    const soffit: EnuPoint[] = [
      { x: -o, y: -o },
      { x: 14 + o, y: -o },
      { x: 14 + o, y: 6 + o },
      { x: 6 + o, y: 6 + o },
      { x: 6 + o, y: 14 + o },
      { x: -o, y: 14 + o },
    ];
    expectClosedMesh(
      skeletonRoof([soffit], { gableEnds: { kind: "neighbours" } }),
      soffit,
    );
    expectClosedMesh(skeletonRoof([soffit], { maxT: 1.5 }), soffit);
  });
});

describe("skeletonFootprint (the ladder's footprint)", () => {
  // Why: buildRoof draws every skeleton rung through skeletonFootprint, which
  // reuses one all-slopes run for the gabled pre-run and the hipped rung of a
  // nudge. The cost cut is only allowed if it changes nothing, so the
  // footprint must give exactly skeletonRoof's roof, or fail where it fails.
  const outcome = (draw: () => SkeletonRoof): SkeletonRoof | string => {
    try {
      return draw();
    } catch (error) {
      return error instanceof SkeletonFailure ? "failure" : String(error);
    }
  };
  // Both attempts on ONE footprint, the four rungs in a random order (delta
  // review MINOR 3): with one attempt per footprint, a cache that ignored the
  // attempt would still have passed.
  it("draws exactly skeletonRoof's roofs, both attempts, the rungs in any order", () => {
    const rule = { kind: "neighbours" } as const;
    const RUNGS = ["hipped/0", "gabled/0", "hipped/1", "gabled/1"] as const;
    fc.assert(
      fc.property(
        starPolygon,
        fc.shuffledSubarray([...RUNGS], { minLength: 4, maxLength: 4 }),
        (footprint, order) => {
          const draw = (
            rung: (typeof RUNGS)[number],
            shared?: ReturnType<typeof skeletonFootprint>,
          ): SkeletonRoof | string => {
            const [kind, n] = rung.split("/");
            const attempt = Number(n);
            // Branch on the cache's absence, not on a nullish fallback: a
            // cache answering nullish must fail here, not fall back to the
            // uncached roof (M7 review NIT 5).
            return outcome(() => {
              if (shared === undefined) {
                return kind === "hipped"
                  ? skeletonRoof([footprint], { attempt })
                  : skeletonRoof([footprint], { attempt, gableEnds: rule });
              }
              return kind === "hipped"
                ? shared.hipped(attempt)
                : shared.gabled(attempt, rule);
            });
          };
          const want = Object.fromEntries(RUNGS.map((r) => [r, draw(r)]));
          const shared = skeletonFootprint([footprint]);
          const got = Object.fromEntries(
            order.map((r) => [r, draw(r, shared)]),
          );
          expect(got).toEqual(want);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("rejects a ring the preparation rejects, before any nudge", () => {
    // A bow tie is not simple; no nudge makes it so, so the ladder skips
    // every rung at once.
    const bowTie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(() => skeletonFootprint([bowTie])).toThrow(SkeletonFailure);
    expect(() => skeletonRoof([bowTie])).toThrow(SkeletonFailure);
  });
});
