import { describe, expect, it } from "vitest";

import type { EnuPoint } from "./enu.js";
import { signedArea2 } from "./enu.js";
import type { SkeletonPoint, SkeletonRoof } from "./roof-skeleton.js";
import {
  faceTriangles,
  skeletonPlanArea,
  skeletonRoof,
  SkeletonFailure,
} from "./roof-skeleton.js";
import { containsPoint } from "../spatial/point-in-ring.js";

/**
 * The skeleton roof over any footprint.
 *
 * Why this file matters: the roof's one promise is that it fills its real
 * footprint and nothing else (no overhang over air, no roof across a
 * courtyard, L, T and U shapes closed) and that its ridge sits where the
 * walls' geometry puts it. Those are geometric facts with closed forms on the
 * shapes below, so they are pinned against those forms rather than against
 * the code's own output.
 */

const ring = (points: readonly (readonly [number, number])[]): EnuPoint[] =>
  points.map(([x, y]) => ({ x, y }));

const RECT = ring([
  [0, 0],
  [12, 0],
  [12, 8],
  [0, 8],
]);
/** Arms 6 m wide; the x arm is 14 long, the y arm 14 tall. */
const L_SHAPE = ring([
  [0, 0],
  [14, 0],
  [14, 6],
  [6, 6],
  [6, 14],
  [0, 14],
]);
const T_SHAPE = ring([
  [0, 0],
  [18, 0],
  [18, 6],
  [12, 6],
  [12, 14],
  [6, 14],
  [6, 6],
  [0, 6],
]);
const U_SHAPE = ring([
  [0, 0],
  [16, 0],
  [16, 12],
  [10, 12],
  [10, 6],
  [6, 6],
  [6, 12],
  [0, 12],
]);
/** An L whose bounding box is clearly longer along x (20 x 10). */
const LONG_L = ring([
  [0, 0],
  [20, 0],
  [20, 6],
  [6, 6],
  [6, 10],
  [0, 10],
]);

const area = (points: readonly EnuPoint[]): number =>
  Math.abs(signedArea2(points)) / 2;

/** The time (height over slope) of the roof straight above `p`. */
function tAt(roof: SkeletonRoof, p: EnuPoint): number | undefined {
  for (const face of roof.faces) {
    if (face.vertical) continue;
    for (const [a, b, c] of faceTriangles(face)) {
      const weights = barycentric(a, b, c, p);
      if (weights === undefined) continue;
      if (weights.every((w) => w >= -1e-9)) {
        return weights[0] * a.t + weights[1] * b.t + weights[2] * c.t;
      }
    }
  }
  return undefined;
}

function barycentric(
  a: EnuPoint,
  b: EnuPoint,
  c: EnuPoint,
  p: EnuPoint,
): [number, number, number] | undefined {
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-12) return undefined;
  const wa = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
  const wb = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
  return [wa, wb, 1 - wa - wb];
}

function slopeCentroids(roof: SkeletonRoof): EnuPoint[] {
  const out: EnuPoint[] = [];
  for (const face of roof.faces) {
    if (face.vertical) continue;
    for (const [a, b, c] of faceTriangles(face)) {
      out.push({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 });
    }
  }
  return out;
}

const eavePoints = (roof: SkeletonRoof): SkeletonPoint[] =>
  roof.faces.flatMap((face) => face.points.filter((p) => p.t === 0));

describe("skeletonRoof on a rectangle", () => {
  it("gives one ridge at half the width and covers the footprint", () => {
    const roof = skeletonRoof([RECT]);
    expect(roof.ridgeT).toBeCloseTo(4, 2);
    expect(skeletonPlanArea(roof)).toBeCloseTo(96, 1);
    expect(roof.gables).toBe(0);
    expect(roof.caps).toHaveLength(0);
  });

  it("puts the eaves exactly on the given corners, jitter or not", () => {
    // Why: the walls are built from the unjittered ring. An eave half a
    // millimetre off would leave a crack along every wall top.
    const roof = skeletonRoof([RECT]);
    const given = new Set(RECT.map((p) => `${p.x},${p.y}`));
    const eaves = eavePoints(roof);
    expect(eaves.length).toBeGreaterThan(0);
    for (const p of eaves) expect(given.has(`${p.x},${p.y}`)).toBe(true);
  });

  it("keeps a collinear corner on the eave, so the wall top meets it", () => {
    // The collinear corner is dropped before the run (it would be a zero-angle
    // event) and put back on its face's eave afterwards.
    const withMid = ring([
      [0, 0],
      [6, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ]);
    const roof = skeletonRoof([withMid]);
    const eaves = eavePoints(roof).map((p) => `${p.x},${p.y}`);
    expect(eaves).toContain("6,0");
    expect(skeletonPlanArea(roof)).toBeCloseTo(96, 1);
  });

  it("reads either winding and a repeated closing point the same way", () => {
    const ccw = skeletonRoof([RECT]);
    const cw = skeletonRoof([[...RECT].reverse()]);
    const closed = skeletonRoof([[...RECT, { x: 0, y: 0 }]]);
    for (const roof of [cw, closed]) {
      expect(roof.ridgeT).toBeCloseTo(ccw.ridgeT, 6);
      expect(skeletonPlanArea(roof)).toBeCloseTo(skeletonPlanArea(ccw), 6);
    }
  });

  it("turns a wall of weight zero into a vertical gable", () => {
    // Walls 1 and 3 are the 8 m ends.
    const roof = skeletonRoof([RECT], { weights: [[1, 0, 1, 0]] });
    const vertical = roof.faces.filter((face) => face.vertical);
    expect(vertical).toHaveLength(2);
    expect(vertical.map((face) => face.wall).sort()).toEqual([1, 3]);
    expect(roof.gables).toBe(2);
    expect(roof.ridgeT).toBeCloseTo(4, 2);
    expect(skeletonPlanArea(roof)).toBeCloseTo(96, 1);
  });

  it("reads weights against the ring as given, even when it winds clockwise", () => {
    // Clockwise: wall 0 runs up x = 0, wall 2 down x = 12, both 8 m ends.
    const cw = ring([
      [0, 0],
      [0, 8],
      [12, 8],
      [12, 0],
    ]);
    const roof = skeletonRoof([cw], { weights: [[0, 1, 0, 1]] });
    const vertical = roof.faces.filter((face) => face.vertical);
    expect(vertical.map((face) => face.wall).sort()).toEqual([0, 2]);
    const xs = vertical.map(
      (face) =>
        // `+ 0` turns the -0 of a centroid a hair below zero into 0.
        Math.round(
          face.points.reduce((s, p) => s + p.x, 0) / face.points.length,
        ) + 0,
    );
    expect(xs.sort((a, b) => a - b)).toEqual([0, 12]);
  });

  it("stops at maxT and closes the rest with a flat cap", () => {
    // For invented roofs (a later milestone): a wide hall must not grow a roof
    // of invented metres. The tagged path never passes maxT.
    const roof = skeletonRoof([RECT], { maxT: 2 });
    expect(roof.ridgeT).toBe(2);
    expect(roof.caps).toHaveLength(1);
    expect(skeletonPlanArea(roof)).toBeCloseTo(96, 1);
  });

  it("is deterministic, and a second attempt is a different but sound run", () => {
    expect(skeletonRoof([U_SHAPE])).toEqual(skeletonRoof([U_SHAPE]));
    const again = skeletonRoof([U_SHAPE], { attempt: 1 });
    expect(again).not.toEqual(skeletonRoof([U_SHAPE]));
    expect(skeletonPlanArea(again)).toBeCloseTo(area(U_SHAPE), 0);
  });
});

describe("skeletonRoof on L, T and U footprints (closed forms)", () => {
  // Every arm is 6 m wide, so the ridge stands at t = 3, and at a point well
  // inside an arm (away from the ends and the junctions) the roof rises with
  // the distance to the nearer long wall: t = min(d, 6 - d).
  const cases: readonly {
    name: string;
    footprint: EnuPoint[];
    samples: readonly { p: EnuPoint; t: number }[];
  }[] = [
    {
      name: "L",
      footprint: L_SHAPE,
      samples: [
        ...[0.5, 1.5, 2.5, 3].map((y) => ({ p: { x: 10, y }, t: y })),
        ...[0.5, 1.5, 2.5, 3].map((x) => ({ p: { x, y: 10 }, t: x })),
        { p: { x: 10, y: 4.5 }, t: 1.5 },
      ],
    },
    {
      name: "T",
      footprint: T_SHAPE,
      samples: [
        ...[0.5, 1.5, 2.5, 3].map((y) => ({ p: { x: 4, y }, t: y })),
        { p: { x: 4, y: 4.5 }, t: 1.5 },
        ...[6.5, 7.5, 8.5, 9].map((x) => ({ p: { x, y: 10 }, t: x - 6 })),
      ],
    },
    {
      name: "U",
      footprint: U_SHAPE,
      samples: [
        ...[0.5, 1.5, 2.5, 3].map((x) => ({ p: { x, y: 9 }, t: x })),
        ...[0.5, 1.5, 2.5, 3].map((y) => ({ p: { x: 8, y }, t: y })),
        { p: { x: 8, y: 4.5 }, t: 1.5 },
      ],
    },
  ];

  for (const { name, footprint, samples } of cases) {
    it(`fills the ${name} exactly, overhangs nothing, ridge at t = 3`, () => {
      const roof = skeletonRoof([footprint]);
      const want = area(footprint);
      expect(Math.abs(skeletonPlanArea(roof) - want)).toBeLessThan(
        want * 0.002,
      );
      for (const c of slopeCentroids(roof)) {
        expect(containsPoint(footprint, c)).toBe(true);
      }
      expect(roof.ridgeT).toBeCloseTo(3, 2);
      for (const { p, t } of samples) {
        expect(tAt(roof, p), `${name} at ${p.x},${p.y}`).toBeCloseTo(t, 2);
      }
    });
  }

  it("leaves a courtyard open, slopes down to it, tops out at half the widest band", () => {
    const outer = ring([
      [0, 0],
      [30, 0],
      [30, 24],
      [0, 24],
    ]);
    const yard = ring([
      [10, 8],
      [10, 16],
      [20, 16],
      [20, 8],
    ]);
    const roof = skeletonRoof([outer, yard]);
    const want = area(outer) - area(yard);
    expect(Math.abs(skeletonPlanArea(roof) - want)).toBeLessThan(want * 0.002);
    for (const c of slopeCentroids(roof)) {
      expect(containsPoint(yard, c)).toBe(false);
    }
    // The bands are 10, 10, 8 and 8 m wide: one pitch everywhere, so the
    // 8 m bands ridge at t = 4 and the 10 m bands, the top, at t = 5.
    expect(roof.ridgeT).toBeCloseTo(5, 2);
    expect(tAt(roof, { x: 15, y: 4 })).toBeCloseTo(4, 2);
    expect(tAt(roof, { x: 15, y: 2 })).toBeCloseTo(2, 2);
    expect(tAt(roof, { x: 15, y: 6 })).toBeCloseTo(2, 2);
  });
});

describe("skeletonRoof gable ends", () => {
  const gableWalls = (roof: SkeletonRoof): number[] =>
    roof.faces
      .filter((face) => face.vertical)
      .map((face) => face.wall)
      .sort((a, b) => a - b);

  it("neighbour rule: a triangular end gets a gable when no neighbour is one", () => {
    // Why: the rule decides which wing ends of every tagged gabled roof on a
    // non-rectangle stand vertical. The arm ends are the walls opposite the
    // corner; every other wall carries a long slope.
    const rule = { gableEnds: { kind: "neighbours" } } as const;
    expect(gableWalls(skeletonRoof([L_SHAPE], rule))).toEqual([1, 4]);
    expect(gableWalls(skeletonRoof([T_SHAPE], rule))).toEqual([1, 4, 7]);
    expect(gableWalls(skeletonRoof([U_SHAPE], rule))).toEqual([2, 6]);
  });

  it("neighbour rule: an outline of all-triangle faces stays hipped", () => {
    // A regular hexagon: every face is a triangular end with triangular
    // neighbours, so no wall qualifies and the roof is a plain hip.
    const hexagon = Array.from({ length: 6 }, (_, i) => ({
      x: 8 * Math.cos((i * Math.PI) / 3),
      y: 8 * Math.sin((i * Math.PI) / 3),
    }));
    const roof = skeletonRoof([hexagon], { gableEnds: { kind: "neighbours" } });
    expect(roof.gables).toBe(0);
  });

  it("axis rule: only the ends facing along the tagged ridge axis stand vertical", () => {
    // LONG_L's triangular ends are the x = 20 wall (wall 1, normal along x)
    // and the y = 10 wall (wall 4, normal along y).
    const along = skeletonRoof([LONG_L], {
      gableEnds: { kind: "axis", axis: { x: 1, y: 0 } },
    });
    const across = skeletonRoof([LONG_L], {
      gableEnds: { kind: "axis", axis: { x: 0, y: 1 } },
    });
    const both = skeletonRoof([LONG_L], { gableEnds: { kind: "neighbours" } });
    expect(gableWalls(along)).toEqual([1]);
    expect(gableWalls(across)).toEqual([4]);
    expect(gableWalls(both)).toEqual([1, 4]);
  });
});

describe("skeletonRoof over a caller-given eave ring (invented roofs)", () => {
  // An invented roof (a later milestone) reaches 0.32 m past its walls, so it
  // runs over the offset ring. The soundness check and the eave snap must use
  // THAT ring: against the footprint the area would be 9 % off and the run
  // would be refused.
  const offset = ring([
    [-0.32, -0.32],
    [12.32, -0.32],
    [12.32, 8.32],
    [-0.32, 8.32],
  ]);

  it("snaps the eaves to the given ring and checks the area against it", () => {
    const roof = skeletonRoof([offset]);
    const given = new Set(offset.map((p) => `${p.x},${p.y}`));
    for (const p of eavePoints(roof)) {
      expect(given.has(`${p.x},${p.y}`)).toBe(true);
    }
    expect(skeletonPlanArea(roof)).toBeCloseTo(area(offset), 1);
    expect(skeletonPlanArea(roof) / area(RECT)).toBeGreaterThan(1.004);
  });

  it("combines with maxT: a soffit-ring roof cut flat at a height limit", () => {
    const roof = skeletonRoof([offset], { maxT: 1.5 });
    expect(roof.ridgeT).toBe(1.5);
    expect(roof.caps).toHaveLength(1);
    expect(skeletonPlanArea(roof)).toBeCloseTo(area(offset), 1);
  });
});

describe("skeletonRoof expectRefused what it cannot roof soundly", () => {
  // Why: the caller's fallback ladder depends on a refusal being a
  // SkeletonFailure (the next step) rather than a wrong roof or a TypeError.
  const expectRefused = (rings: readonly (readonly EnuPoint[])[]): void => {
    expect(() => skeletonRoof(rings)).toThrow(SkeletonFailure);
  };

  it("a bow-tie", () => {
    expectRefused([
      ring([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ]);
  });

  it("a ring that touches itself at a corner", () => {
    expectRefused([
      ring([
        [0, 0],
        [10, 0],
        [5, 5],
        [10, 10],
        [0, 10],
        [5, 5],
      ]),
    ]);
  });

  it("fewer than three distinct corners", () => {
    expectRefused([
      ring([
        [0, 0],
        [10, 0],
      ]),
    ]);
    expectRefused([
      ring([
        [0, 0],
        [10, 0],
        [10, 0],
      ]),
    ]);
    expectRefused([
      ring([
        [0, 0],
        [5, 0],
        [10, 0],
      ]),
    ]);
  });

  it("a corner that is not a finite number", () => {
    expectRefused([
      ring([
        [0, 0],
        [10, 0],
        [10, Number.NaN],
        [0, 10],
      ]),
    ]);
  });

  it("a hole outside its outer ring, or crossing it", () => {
    expectRefused([
      RECT,
      ring([
        [20, 20],
        [22, 20],
        [22, 22],
      ]),
    ]);
    expectRefused([
      RECT,
      ring([
        [10, 2],
        [14, 2],
        [14, 4],
      ]),
    ]);
  });

  it("no rings at all", () => {
    expectRefused([]);
  });
});

describe("skeletonRoof is the same roof wherever the frame puts it", () => {
  // Why: the corner nudge was keyed on absolute ENU coordinates, and the ENU
  // origin is each app's own choice, so the same building could get other
  // gables in two apps (M2 review finding 4: 6 to 9 corpus roofs changed with
  // the origin). Keyed on coordinates relative to the ring's lowest corner,
  // a translated footprint gets the same roof, translated.
  const STAR = ring([
    [21.05, 0],
    [6.593, 2.385],
    [5.957, 4.751],
    [6.03, 9.517],
    [4.203, 24.154],
    [-3.036, 16.506],
    [-2.141, 3.959],
    [-9.346, 5.627],
    [-4.699, 0.037],
    [-8.23, -5.695],
    [-7.891, -9.366],
    [-2.136, -14.155],
    [4.286, -9.009],
    [8.103, -4.686],
  ]);
  /**
   * Every roof point, shifted back by (dx, dy), in a canonical order. A point
   * repeated within 1e-7 m along a face outline counts once: far from the
   * frame origin one event can reach a face twice, a rounding error apart
   * (both copies weld into one corner in the mesh), and that is not a
   * different roof.
   */
  const points = (roof: SkeletonRoof, dx = 0, dy = 0): number[][] =>
    roof.faces
      .flatMap((face) =>
        face.points.filter((p, i) => {
          const q = face.points[i - 1];
          return (
            q === undefined ||
            Math.hypot(p.x - q.x, p.y - q.y, p.t - q.t) > 1e-7
          );
        }),
      )
      .map((p) => [p.x - dx, p.y - dy, p.t])
      .sort(
        (a, b) =>
          (a[0] as number) - (b[0] as number) ||
          (a[1] as number) - (b[1] as number) ||
          (a[2] as number) - (b[2] as number),
      );
  const expectSameRoof = (
    a: SkeletonRoof,
    b: SkeletonRoof,
    dx: number,
    dy: number,
  ): void => {
    expect(b.gables).toBe(a.gables);
    expect(b.ridgeT).toBeCloseTo(a.ridgeT, 6);
    const pa = points(a);
    const pb = points(b, dx, dy);
    expect(pb.length).toBe(pa.length);
    const worst = Math.max(
      ...pa.flatMap((p, i) =>
        p.map((v, k) => Math.abs(v - (pb[i]?.[k] ?? Number.NaN))),
      ),
    );
    // 1 micrometre: a different nudge moves the inner points by about 0.1 mm.
    expect(worst).toBeLessThan(1e-6);
  };

  // The star is a hip-roof fixture (roof.test.ts drew it hipped), so it is
  // checked hipped; the L with and without gables.
  const GABLED = { gableEnds: { kind: "neighbours" } } as const;
  for (const [name, footprint, optionSets] of [
    ["an L", L_SHAPE, [{}, GABLED]],
    ["a star", STAR, [{}]],
  ] as const) {
    it(`translated by (+1234.5, -987.25), ${name} keeps its roof`, () => {
      const [dx, dy] = [1234.5, -987.25];
      const moved = footprint.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      for (const options of optionSets) {
        for (const attempt of [0, 1]) {
          expectSameRoof(
            skeletonRoof([footprint], { ...options, attempt }),
            skeletonRoof([moved], { ...options, attempt }),
            dx,
            dy,
          );
        }
      }
    });

    // Why (delta review MINOR 1, 2026-11-08): a north-south move of the ENU
    // origin rescales x by cos(originLat), so a house's corners move by
    // millimetres relative to each other. Keyed on those coordinates the
    // nudge changed with them (2-7 of 508 corpus roofs). Keyed on the corner's
    // index, a similar footprint gets the same nudges: scaled by 1 + 1e-4
    // about its lowest corner, the roof is the scaled roof to well under the
    // 0.1 mm a different nudge moves the inner points.
    it(`scaled by 1 + 1e-4, ${name} keeps its nudges`, () => {
      const s = 1 + 1e-4;
      const o = footprint.reduce((best, p) =>
        p.x < best.x || (p.x === best.x && p.y < best.y) ? p : best,
      );
      const scaled = footprint.map((p) => ({
        x: o.x + (p.x - o.x) * s,
        y: o.y + (p.y - o.y) * s,
      }));
      for (const options of optionSets) {
        const a = skeletonRoof([footprint], options);
        const b = skeletonRoof([scaled], options);
        expect(b.gables).toBe(a.gables);
        const pa = points(a).map(([x, y, t]) => [
          o.x + ((x as number) - o.x) * s,
          o.y + ((y as number) - o.y) * s,
          (t as number) * s,
        ]);
        const pb = points(b);
        expect(pb.length).toBe(pa.length);
        const worst = Math.max(
          ...pa.flatMap((p, i) =>
            p.map((v, k) => Math.abs(v - (pb[i]?.[k] ?? Number.NaN))),
          ),
        );
        expect(worst).toBeLessThan(1e-5);
      }
    });

    it(`started at another corner, ${name} keeps its roof`, () => {
      const turned = [...footprint.slice(3), ...footprint.slice(0, 3)];
      for (const options of optionSets) {
        expectSameRoof(
          skeletonRoof([footprint], options),
          skeletonRoof([turned], options),
          0,
          0,
        );
      }
    });
  }
});
