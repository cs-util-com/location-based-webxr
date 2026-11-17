import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { EnuPoint } from "./enu.js";
import {
  inventedRoofMesh,
  planInventedRoofs,
  type InventedFootprint,
  type InventedPlan,
} from "./invented-roofs.js";
import { ROOFSCAPE_DEFAULTS } from "./roofscape-rules.js";
import { WELD_M } from "./skeleton-mesh.js";

/**
 * Properties of the invented roofs over random small neighbourhoods.
 *
 * WHY THIS FILE MATTERS. The obstacle index takes a building's height from
 * its plan, and the screen draws the plan's mesh: the drawn top must be the
 * planned top for every plan, not only for the shapes a case list thought
 * of. And no invented roof may rise past the limit, wherever the houses
 * stand and whichever walls they share.
 */

const P = ROOFSCAPE_DEFAULTS;

/** A rectangle, optionally turned, with a notch cut to make an L. */
const houseArb = fc.record({
  x: fc.integer({ min: -60, max: 60 }),
  y: fc.integer({ min: -60, max: 60 }),
  w: fc.double({ min: 4, max: 30, noNaN: true }),
  h: fc.double({ min: 4, max: 30, noNaN: true }),
  turn: fc.double({ min: 0, max: Math.PI, noNaN: true }),
  notch: fc.boolean(),
});

function ringOf(house: {
  x: number;
  y: number;
  w: number;
  h: number;
  turn: number;
  notch: boolean;
}): EnuPoint[] {
  const { w, h } = house;
  const local: [number, number][] = house.notch
    ? [
        [0, 0],
        [w, 0],
        [w, h / 2],
        [w / 2, h / 2],
        [w / 2, h],
        [0, h],
      ]
    : [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ];
  const c = Math.cos(house.turn);
  const s = Math.sin(house.turn);
  return local.map(([u, v]) => ({
    x: house.x + u * c - v * s,
    y: house.y + u * s + v * c,
  }));
}

function footprints(
  houses: readonly Parameters<typeof ringOf>[0][],
): InventedFootprint[] {
  return houses.map((house, i) => {
    const ring = ringOf(house);
    return {
      key: `way/${i}` as InventedFootprint["key"],
      tags: { building: "yes" },
      at: {
        x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
        y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
      },
      polygons: [[ring]],
      hasParts: false,
    };
  });
}

/*
 * How far the mesh may move a raised corner: `WELD_M`, imported from
 * `skeleton-mesh.ts` so the bound moves with the weld.
 *
 * WHY THE DRAWN TOP MAY SIT UP TO THIS BELOW THE PLAN, and no closer bound
 * holds. Near-coincident skeleton events leave corners a hair apart on a
 * ridge, and the stitch welds every raised corner within this distance into
 * one, so the apex can land on a neighbouring event's corner just below it.
 * Two neighbourhoods failed a 0.5 mm closeness this way (drawn 0.62 mm and 1.15 mm
 * below the plan, with the unwelded apex exactly at the planned top): float32
 * at these heights is under a micrometre, and nothing rose above the plan.
 * The weld cannot RAISE the top, because no raised corner stands above the
 * last event, so the bound is one-sided.
 */

/** Float32 rounds a height by at most half an ulp (2^-24 relative); twice that. */
const float32Slack = (heightM: number): number => Math.abs(heightM) * 2 ** -23;

/**
 * The drawn top lies within the weld below the planned top and never above
 * it (beyond float32 rounding), and the plan rises no more than the limit.
 */
function expectTopsWithinWeld(
  houses: readonly Parameters<typeof ringOf>[0][],
): void {
  for (const plan of planInventedRoofs(footprints(houses)).values()) {
    if (plan.kind !== "roof") continue;
    expect(plan.totalM - plan.eaveM).toBeLessThanOrEqual(P.maxRiseM + 1e-9);
    const { positions } = inventedRoofMesh(plan, { lowest: 0, rise: 0 });
    let top = -Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      top = Math.max(top, positions[i] as number);
    }
    expect(top).toBeLessThanOrEqual(plan.totalM + float32Slack(plan.totalM));
    expect(top).toBeGreaterThanOrEqual(
      plan.totalM - WELD_M - float32Slack(plan.totalM),
    );
  }
}

const neighbourhoods = fc.array(houseArb, { minLength: 1, maxLength: 4 });

describe("invented roofs, as properties", () => {
  it("draws every roof's top at its planned top within the weld, never above it or past the rise limit", () => {
    fc.assert(
      fc.property(neighbourhoods, (houses) => expectTopsWithinWeld(houses)),
      {
        numRuns: 60,
      },
    );
  });

  // Why: the two neighbourhoods that failed the former 0.5 mm closeness
  // (drawn 0.62 mm and 1.15 mm below the plan), pinned as literal houses so
  // they keep testing the same ground whatever later happens to the arbitrary.
  it.each([
    {
      name: "an L beside a square",
      houses: [
        {
          x: 0,
          y: 48,
          w: 8.525300000000001,
          h: 8.543500000000003,
          turn: 0,
          notch: true,
        },
        {
          x: 0,
          y: 43,
          w: 6.39395,
          h: 9.271750000000003,
          turn: 0,
          notch: false,
        },
      ],
    },
    {
      name: "an L between two overlapping squares",
      houses: [
        { x: 1, y: 0, w: 4, h: 4, turn: 0, notch: true },
        { x: 3, y: 0, w: 4, h: 4, turn: 0, notch: false },
        { x: 0, y: 0, w: 4, h: 4, turn: 0, notch: false },
      ],
    },
  ])("keeps the drawn top within the weld for $name", ({ houses }) => {
    expectTopsWithinWeld(houses);
  });

  it("plans the same whatever order the footprints arrive in", () => {
    fc.assert(
      fc.property(
        fc.array(houseArb, { minLength: 1, maxLength: 5 }),
        (houses) => {
          const fs = footprints(houses);
          const one = planInventedRoofs(fs);
          const two = planInventedRoofs([...fs].reverse());
          expect([...two.keys()].sort()).toEqual([...one.keys()].sort());
          for (const [key, plan] of one) expect(two.get(key)).toEqual(plan);
        },
      ),
      { numRuns: 40 },
    );
  });
  // Why: a frame is a translation (and a tiny stretch) of the same ground,
  // and the demo re-anchors its frame while the user walks. A roof that
  // changed with the translation would flip on every re-anchor; before the
  // planner worked in each building's own quantised coordinates, a shift of
  // one centimetre changed ten roofs at Meggen.
  it("plans the same decisions and heights wherever the frame's origin lies", () => {
    fc.assert(
      fc.property(
        fc.array(houseArb, { minLength: 1, maxLength: 5 }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        (houses, dx, dy) => {
          const fs = footprints(houses);
          const moved = fs.map((f) => ({
            ...f,
            at: { x: f.at.x + dx, y: f.at.y + dy },
            polygons: f.polygons.map((rings) =>
              rings.map((ring) =>
                ring.map((p) => ({ x: p.x + dx, y: p.y + dy })),
              ),
            ),
          }));
          const one = planInventedRoofs(fs);
          const two = planInventedRoofs(moved);
          expect([...two.keys()].sort()).toEqual([...one.keys()].sort());
          for (const [key, plan] of one) {
            const other = two.get(key);
            expect(other?.kind, key).toBe(plan.kind);
            expect(summary(other), key).toEqual(summary(plan));
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

/** What a plan decided, without its coordinates. */
function summary(plan: InventedPlan | undefined): unknown {
  if (plan === undefined) return undefined;
  if (plan.kind === "lid") return { why: plan.why, h: plan.heightM };
  return {
    style: plan.style,
    totalM: plan.totalM,
    eaveM: plan.eaveM,
    faces: plan.roof.faces.length,
    caps: plan.roof.caps.length,
  };
}
