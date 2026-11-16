import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { EnuFrame, EnuPoint } from "./enu.js";
import { enuFrameAt } from "./enu.js";
import type { ExtrudedBuilding } from "./extrude.js";
import {
  inventedRoofMesh,
  inventedTotalM,
  planInventedRoofs,
  type InventedFootprint,
  type InventedRoof,
} from "./invented-roofs.js";
import type { MeshData } from "./mesh-data.js";
import { ROOFSCAPE_DEFAULTS } from "./roofscape-rules.js";
import { skeletonMesh } from "./skeleton-mesh.js";
import { mixedUnit } from "./stable-jitter.js";

/**
 * Every invented roof the planner grants can be meshed, at any ground height.
 *
 * WHY THIS FILE MATTERS. `inventedRoofMesh` checks the stitched roof is
 * closed and throws `SkeletonFailure` when it is not. The planner did not run
 * that check, so a roof it granted could throw at mesh time, and one throwing
 * building failed the whole city build. The mesh is drawn at the real eave
 * height (the ground under the building plus its walls), where float32
 * positions are coarser than at 0 m; it is the checked eave-0 mesh lifted
 * there, and this file meshes every granted roof on every ground to pin
 * that the drawn mesh never throws.
 *
 * NOT THROWING IS NOT ENOUGH. A granted roof is drawn from the planner's
 * cached eave-0 mesh, so `inventedRoofMesh` neither stitches nor checks it
 * again, and a broken lift could never throw here. So the drawn roof is also
 * compared with a fresh stitch of the same roof at an eave of 0 m, lifted
 * and placed by hand: the same triangles, every corner within float32 slack
 * of where the fresh stitch puts it, and closed above the eave. (The fresh
 * stitch is at 0 m, not at the real eave, because at the real eave float32
 * can refuse a roof that closes at 0 m, which is why the cache exists.)
 */

/** How far a drawn corner may sit from the fresh stitch, metres (float32 at 600 m is 0.06 mm). */
const SLACK_M = 1e-3;

/** The ground heights the mesh is built on, metres. */
const GROUNDS = [0, 31, 33, 100, 300, 600] as const;

type Shape =
  | { kind: "star"; n: number; outer: number; inner: number; turn: number }
  | { kind: "L"; a: number; b: number; wa: number; wb: number; turn: number }
  | {
      kind: "T";
      bar: number;
      stem: number;
      wb: number;
      ws: number;
      turn: number;
    }
  | { kind: "square"; side: number; turn: number };

const turnArb = fc.double({ min: 0, max: Math.PI, noNaN: true });
const size = (min: number, max: number) =>
  fc.integer({ min: min * 10, max: max * 10 }).map((v) => v / 10);

const starArb = fc.record({
  kind: fc.constant("star" as const),
  n: fc.integer({ min: 4, max: 9 }),
  outer: size(6, 20),
  inner: fc.double({ min: 0.35, max: 0.9, noNaN: true }),
  turn: turnArb,
});
const lArb = fc.record({
  kind: fc.constant("L" as const),
  a: size(8, 25),
  b: size(8, 25),
  wa: size(4, 9),
  wb: size(4, 9),
  turn: turnArb,
});
/** An L whose two wings are the same length and width: a symmetric L. */
const equalLArb = fc
  .record({ a: size(8, 25), w: size(4, 9), turn: turnArb })
  .map(({ a, w, turn }) => ({
    kind: "L" as const,
    a,
    b: a,
    wa: w,
    wb: w,
    turn,
  }));
const tArb = fc.record({
  kind: fc.constant("T" as const),
  bar: size(12, 30),
  stem: size(5, 20),
  wb: size(4, 9),
  ws: size(4, 9),
  turn: turnArb,
});
const squareArb = fc.record({
  kind: fc.constant("square" as const),
  side: size(5, 25),
  turn: turnArb,
});
const shapeArb: fc.Arbitrary<Shape> = fc.oneof(
  starArb,
  lArb,
  equalLArb,
  tArb,
  squareArb,
);

function ringOf(shape: Shape): EnuPoint[] {
  let local: [number, number][];
  switch (shape.kind) {
    case "star":
      local = Array.from({ length: shape.n * 2 }, (_, i) => {
        const r = i % 2 === 0 ? shape.outer : shape.outer * shape.inner;
        const angle = (i * Math.PI) / shape.n;
        return [r * Math.cos(angle), r * Math.sin(angle)];
      });
      break;
    case "L": {
      const { a, b, wa, wb } = shape;
      local = [
        [0, 0],
        [a, 0],
        [a, wa],
        [wb, wa],
        [wb, b],
        [0, b],
      ];
      break;
    }
    case "T": {
      const { bar, stem, wb, ws } = shape;
      const l = (bar - ws) / 2;
      local = [
        [0, 0],
        [bar, 0],
        [bar, wb],
        [l + ws, wb],
        [l + ws, wb + stem],
        [l, wb + stem],
        [l, wb],
        [0, wb],
      ];
      break;
    }
    case "square":
      local = [
        [0, 0],
        [shape.side, 0],
        [shape.side, shape.side],
        [0, shape.side],
      ];
  }
  const c = Math.cos(shape.turn);
  const s = Math.sin(shape.turn);
  return local.map(([u, v]) => ({ x: u * c - v * s, y: u * s + v * c }));
}

/** One house; `seed` varies the key, so the slope and the gable wish. */
function footprint(shape: Shape, seed: number): InventedFootprint {
  const ring = ringOf(shape);
  return {
    key: `way/${seed}` as InventedFootprint["key"],
    tags: { building: "house" },
    at: {
      x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
      y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
    },
    polygons: [[ring]],
    hasParts: false,
  };
}

/** Plans the house and meshes its roof on every ground in `GROUNDS`. */
function expectMeshedEverywhere(shape: Shape, seed: number): void {
  const house = footprint(shape, seed);
  const plan = planInventedRoofs([house]).get(house.key);
  if (plan?.kind !== "roof") return;
  const fresh = skeletonMesh(plan.roof, { eaveM: 0, slope: plan.tan }).mesh;
  for (const lowest of GROUNDS) {
    const drawn = inventedRoofMesh(plan, { lowest, rise: 0 });
    expectDrawnAsStitched(drawn, fresh, plan, lowest + plan.eaveM);
  }
}

/**
 * The roof in `drawn` is `fresh` lifted to `eaveM` and placed by
 * `plan.place`: the same triangles, the corners within `SLACK_M`, and every
 * edge above the eave shared by exactly two triangles wound against each
 * other (`skeletonMesh`'s closure rule).
 */
function expectDrawnAsStitched(
  drawn: ExtrudedBuilding,
  fresh: MeshData,
  plan: InventedRoof,
  eaveM: number,
): void {
  const start = drawn.roofVertices.start;
  const count = fresh.positions.length / 3;
  const inRoof = (v: number): boolean => v >= start && v < start + count;
  const triangles: number[] = [];
  for (let i = 0; i < drawn.indices.length; i += 3) {
    const tri = [0, 1, 2].map((k) => drawn.indices[i + k] as number);
    if (tri.every(inRoof)) triangles.push(...tri.map((v) => v - start));
  }
  expect(triangles.length / 3).toBe(fresh.triangleCount);
  expect(triangles).toEqual([...fresh.indices]);

  const { x, y, xScale } = plan.place;
  let worst = 0;
  for (let v = 0; v < count; v++) {
    const at = (k: number): number =>
      drawn.positions[(start + v) * 3 + k] as number;
    const want = (k: number): number => fresh.positions[v * 3 + k] as number;
    worst = Math.max(
      worst,
      Math.abs(at(0) - (want(0) * xScale + x)),
      Math.abs(at(1) - (want(1) + eaveM)),
      Math.abs(at(2) - (want(2) - y)),
    );
  }
  expect(worst).toBeLessThan(SLACK_M);
  expectClosedAbove(drawn.positions, start, triangles, eaveM);
}

/**
 * `skeletonMesh`'s closure rule on the drawn roof: corners at one position
 * are one corner, and every edge above the eave is used once in each
 * direction.
 */
function expectClosedAbove(
  positions: Float32Array,
  start: number,
  triangles: readonly number[],
  eaveM: number,
): void {
  const ids = new Map<string, number>();
  const id = (v: number): number => {
    const o = (start + v) * 3;
    const key = `${positions[o]},${positions[o + 1]},${positions[o + 2]}`;
    const known = ids.get(key);
    if (known !== undefined) return known;
    ids.set(key, ids.size);
    return ids.size - 1;
  };
  const eave = Math.fround(eaveM);
  const raised = (v: number): boolean =>
    (positions[(start + v) * 3 + 1] as number) > eave + 1e-6;
  const uses = new Map<string, { count: number; raised: boolean }>();
  for (let i = 0; i < triangles.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const p = triangles[i + k] as number;
      const q = triangles[i + ((k + 1) % 3)] as number;
      const edge = `${id(p)}>${id(q)}`;
      const seen = uses.get(edge);
      uses.set(edge, {
        count: (seen?.count ?? 0) + 1,
        raised: raised(p) || raised(q),
      });
    }
  }
  const faults = [...uses].filter(([edge, use]) => {
    const [from, to] = edge.split(">");
    return use.count > 1 || (use.raised && !uses.has(`${to}>${from}`));
  });
  expect(faults).toEqual([]);
}

describe("invented roofs, meshed on any ground", () => {
  it("draws every planned roof as its stitched, closed mesh, on grounds from 0 to 600 m", () => {
    fc.assert(
      fc.property(shapeArb, fc.integer({ min: 0, max: 1e6 }), (shape, seed) =>
        expectMeshedEverywhere(shape, seed),
      ),
      // 120 runs keep the file inside the gate time limit on a loaded
      // machine; the counterexamples below are pinned whatever the sample.
      { numRuns: 120 },
    );
  });

  // THE SHRUNK COUNTEREXAMPLE of the property above, before the fix. Eight
  // walls meet at the apex of this hip roof; the planner nudges every corner
  // by half a millimetre, so the skeleton puts the apex down as a cluster of
  // nodes wider than the weld, and the nearest-corner weld folded faces across
  // it: the stitched roof was not closed, at every ground height. Asserting a
  // hip roof (not a lid) pins the weld fix in skeletonMesh, because without it
  // the planner closure check would demote this house to a flat lid.
  it("meshes the hip roof of an eight-pointed star whose apex nodes spread wider than the weld", () => {
    const shape: Shape = {
      kind: "star",
      n: 8,
      outer: 6,
      inner: 0.6467924792197227,
      turn: 0,
    };
    const house = footprint(shape, 0);
    const plan = planInventedRoofs([house]).get(house.key);
    expect(plan?.kind).toBe("roof");
    if (plan?.kind !== "roof") return;
    expect(plan.style).toBe("hip");
    expectMeshedEverywhere(shape, 0);
  });

  // A house that wishes for gables, whose gabled roof does not close even
  // with the weld fix. The planner tries the next roof (hipped) rather than
  // granting one that would throw at mesh time.
  it("gives a star whose gabled roof does not close a hipped roof instead", () => {
    const shape: Shape = {
      kind: "star",
      n: 7,
      outer: 9.7,
      inner: 0.35,
      turn: 3.1415926535897905,
    };
    const house = footprint(shape, 102);
    // The house must wish for gables, or a hipped roof proves nothing.
    expect(mixedUnit(house.key, "roofscape-gable")).toBeLessThan(
      ROOFSCAPE_DEFAULTS.gableShare,
    );
    const plan = planInventedRoofs([house]).get(house.key);
    expect(plan?.kind).toBe("roof");
    if (plan?.kind !== "roof") return;
    expect(plan.style).toBe("hip");
    expectMeshedEverywhere(shape, 102);
  });
});

/** `house`, whose ring is in `from`'s metres, in `to`'s metres. */
function moved(
  house: InventedFootprint,
  from: EnuFrame,
  to: EnuFrame,
): InventedFootprint {
  const shift = (p: EnuPoint): EnuPoint => to.toEnu(from.toLatLng(p));
  return {
    ...house,
    at: shift(house.at),
    polygons: house.polygons.map((rings) =>
      rings.map((ring) => ring.map(shift)),
    ),
  };
}

// The city plans in the scene's frame and the obstacle index in a frame over
// the buildings; the closure check is sensitive to a fraction of a
// millimetre, so a borderline roof could be granted in one frame and demoted
// in the other, and an agent would then walk through a roof that is drawn.
// The houses pinned above are exactly such borderline roofs.
describe("the pinned houses, planned in two frames", () => {
  const near = enuFrameAt({ lat: 47.05, lng: 8.35 });
  const far = enuFrameAt({ lat: 47.0536, lng: 8.3553 });
  const pinned: readonly (readonly [Shape, number])[] = [
    [{ kind: "star", n: 8, outer: 6, inner: 0.6467924792197227, turn: 0 }, 0],
    [
      { kind: "star", n: 7, outer: 9.7, inner: 0.35, turn: 3.1415926535897905 },
      102,
    ],
  ];

  it.each(pinned)("plans the same roof in both frames: %o", (shape, seed) => {
    const house = footprint(shape, seed);
    const a = planInventedRoofs([house], { frame: near }).get(house.key);
    const b = planInventedRoofs([moved(house, near, far)], {
      frame: far,
    }).get(house.key);
    expect(a?.kind).toBe("roof");
    expect(b?.kind).toBe(a?.kind);
    if (a?.kind !== "roof" || b?.kind !== "roof") return;
    expect(b.style).toBe(a.style);
    // Within a centimetre, as the site frames test: the latitude scale of a
    // building's own coordinates moves with the frame by a hair.
    expect(Math.abs(inventedTotalM(b) - inventedTotalM(a))).toBeLessThan(0.01);
  });
});
