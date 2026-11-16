import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { EnuPoint } from "./enu.js";
import {
  inventedRoofMesh,
  planInventedRoofs,
  type InventedFootprint,
} from "./invented-roofs.js";

/**
 * Every invented roof the planner grants can be meshed, at any ground height.
 *
 * WHY THIS FILE MATTERS. `inventedRoofMesh` checks the stitched roof is
 * closed and throws `SkeletonFailure` when it is not. The planner did not run
 * that check, so a roof it granted could throw at mesh time, and one throwing
 * building failed the whole city build. And the mesh is built at the real
 * eave height (the ground under the building plus its walls), where float32
 * positions are coarser than at 0 m, so a roof that closes at 0 m is not
 * proof that it closes on a hill.
 */

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
  for (const lowest of GROUNDS) {
    expect(() => inventedRoofMesh(plan, { lowest, rise: 0 })).not.toThrow();
  }
}

describe("invented roofs, meshed on any ground", () => {
  it("meshes every planned roof without throwing, on grounds from 0 to 600 m", () => {
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
    const plan = planInventedRoofs([house]).get(house.key);
    expect(plan?.kind).toBe("roof");
    if (plan?.kind !== "roof") return;
    expect(plan.style).toBe("hip");
    expectMeshedEverywhere(shape, 102);
  });
});
