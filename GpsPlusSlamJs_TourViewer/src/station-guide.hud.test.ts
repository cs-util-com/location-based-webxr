import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { HUD_NEAREST_STATIONS, nearestOf } from "./station-guide";

/**
 * Why these tests matter (visitor plan 2026-10-18-2349, "where the closest
 * five stations are"): the HUD marks the nearest stations whose content is
 * hidden, not every offered one, so a town walk under the `any` order does
 * not fill the view with a hundred markers. `nearestOf` is the choice; the
 * sweep sizes the count by how often two markers would overlap on screen.
 */

describe("nearestOf", () => {
  it("keeps the count nearest in their own order; ties go to the earlier item; no distance counts as farthest", () => {
    const d = new Map([
      ["a", 30],
      ["b", 10],
      ["c", 20],
      ["d", 10],
    ]);
    const pick = (ids: string[], n: number) =>
      nearestOf(ids, n, (id) => d.get(id));
    expect(pick(["a", "b", "c", "d"], 2)).toEqual(["b", "d"]);
    expect(pick(["a", "b", "c", "d"], 3)).toEqual(["b", "c", "d"]);
    // A tie at the cut goes to the earlier item.
    expect(pick(["d", "b", "a"], 1)).toEqual(["d"]);
    expect(pick(["x", "a"], 1)).toEqual(["a"]);
    expect(pick(["x", "y", "a"], 2)).toEqual(["x", "a"]);
    expect(pick(["a"], 5)).toEqual(["a"]);
    expect(pick(["a", "b"], 0)).toEqual([]);
  });

  it("property: min(count, n) items, a subsequence, none dropped nearer than one kept", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.option(fc.integer({ min: 0, max: 50 }), { nil: undefined }),
          {
            maxLength: 20,
          },
        ),
        fc.integer({ min: 0, max: 25 }),
        (distances, count) => {
          const items = distances.map((d, i) => ({ i, d }));
          const kept = nearestOf(items, count, (x) => x.d);
          expect(kept).toHaveLength(Math.min(count, items.length));
          // In their own order.
          expect(kept.map((x) => x.i)).toEqual(
            [...kept.map((x) => x.i)].sort((a, b) => a - b),
          );
          const keptSet = new Set(kept);
          const far = (x: { d: number | undefined }) => x.d ?? Infinity;
          const worstKept = Math.max(-Infinity, ...kept.map(far));
          const dropped = items.filter((x) => !keptSet.has(x));
          expect(dropped.every((x) => far(x) >= worstKept)).toBe(true);
        },
      ),
    );
  });
});

describe("nearestOf with an item always kept (the walk's focus)", () => {
  // Why: the HUD marks the station the walk is about in its own look. A
  // target the visitor chose beyond the nearest five had no marker at all,
  // so the one station the walk guides to was the one not shown. The kept
  // item is always in, and the others fill the rest of the count.
  it("keeps the focus beyond the nearest, with the nearest others filling the count", () => {
    const d = new Map([
      ["a", 10],
      ["b", 20],
      ["c", 30],
      ["far", 90],
    ]);
    const pick = (ids: string[], n: number, focus: string | null) =>
      nearestOf(
        ids,
        n,
        (id) => d.get(id),
        (id) => id === focus,
      );
    expect(pick(["a", "b", "c", "far"], 2, "far")).toEqual(["a", "far"]);
    expect(pick(["far", "a", "b", "c"], 3, "far")).toEqual(["far", "a", "b"]);
    // A focus among the nearest changes nothing; no focus is nearestOf.
    expect(pick(["a", "b", "c", "far"], 2, "b")).toEqual(["a", "b"]);
    expect(pick(["a", "b", "c", "far"], 2, null)).toEqual(["a", "b"]);
    expect(pick(["a", "far"], 0, "far")).toEqual([]);
  });

  it("property: at most the count, the kept item in whenever it is listed, the rest the nearest others", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 20 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: -1, max: 19 }),
        (distances, count, focusIndex) => {
          const items = distances.map((d, i) => ({ i, d }));
          const kept = nearestOf(
            items,
            count,
            (x) => x.d,
            (x) => x.i === focusIndex,
          );
          expect(kept.length).toBe(Math.min(count, items.length));
          expect(kept.map((x) => x.i)).toEqual(
            [...kept.map((x) => x.i)].sort((a, b) => a - b),
          );
          const listed = focusIndex >= 0 && focusIndex < items.length;
          expect(kept.some((x) => x.i === focusIndex)).toBe(
            listed && count > 0,
          );
          const others = kept.filter((x) => x.i !== focusIndex);
          const worst = Math.max(-Infinity, ...others.map((x) => x.d));
          const dropped = items.filter(
            (x) => x.i !== focusIndex && !kept.includes(x),
          );
          expect(dropped.every((x) => x.d >= worst)).toBe(true);
        },
      ),
    );
  });
});

/** 225 stations: a 15 x 15 grid 10 m apart, or scattered over the same
 *  140 m square by a fixed seed (the grid's regular bearings flatter it). */
function layout(kind: "grid" | "scattered"): [number, number][] {
  const out: [number, number][] = [];
  if (kind === "grid") {
    for (let i = 0; i < 15; i += 1) {
      for (let j = 0; j < 15; j += 1) out.push([i * 10, j * 10]);
    }
    return out;
  }
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 225; i += 1) out.push([random() * 140, random() * 140]);
  return out;
}

/**
 * The crowding sweep: the visitor at 100 spots over the middle of the
 * layout, looking every 15°, a phone's view 60° wide. Crowding: pairs of the
 * HUD's markers in view whose bearings lie within `overlapDeg` of each
 * other (two markers on top of each other), averaged per view. Only
 * bearings count, so the layout's scale (a museum's 5 m or a town's 40 m)
 * does not change it.
 */
function crowding(
  count: number,
  kind: "grid" | "scattered",
  overlapDeg: number,
): number {
  const stations = layout(kind);
  let views = 0;
  let pairs = 0;
  for (let a = 0; a < 10; a += 1) {
    for (let b = 0; b < 10; b += 1) {
      const at = [50 + (a + 0.37) * 4, 50 + (b + 0.61) * 4] as const;
      const marked = nearestOf(stations, count, ([n, e]) =>
        Math.hypot(n - at[0], e - at[1]),
      );
      const bearings = marked.map(
        ([n, e]) => (Math.atan2(e - at[1], n - at[0]) * 180) / Math.PI,
      );
      for (let heading = -180; heading < 180; heading += 15) {
        const seen = bearings
          .map((x) => ((x - heading + 540) % 360) - 180)
          .filter((x) => Math.abs(x) <= 30);
        views += 1;
        for (let i = 0; i < seen.length; i += 1) {
          for (let j = i + 1; j < seen.length; j += 1) {
            if (Math.abs(seen[i]! - seen[j]!) < overlapDeg) pairs += 1;
          }
        }
      }
    }
  }
  return pairs / views;
}

describe("how many stations the HUD marks (the sweep)", () => {
  // Measured (pairs per view, 3 / 5 / 6 / 7 / 10 markers):
  //   grid, 6°:       0     / 0     / 0     / 0.020 / 0.107
  //   scattered, 4°:  0.015 / 0.058 / 0.079 / 0.107 / 0.241
  //   scattered, 6°:  0.023 / 0.076 / 0.107 / 0.147 / 0.352
  //   scattered, 10°: 0.039 / 0.129 / 0.188 / 0.247 / 0.550
  // No knee: crowding grows steadily with the count. Five keeps it under
  // one overlap in ten views for markers up to about 6° wide; markers
  // nearer 10° wide would favour four, a grid-like layout allows seven.
  it("crowds more with every marker; five stays under one overlap in ten views at 6°, six does not", () => {
    for (const kind of ["grid", "scattered"] as const) {
      for (const overlap of [4, 6, 10]) {
        let previous = -1;
        for (let count = 3; count <= 10; count += 1) {
          const pairs = crowding(count, kind, overlap);
          expect(pairs).toBeGreaterThanOrEqual(previous);
          previous = pairs;
        }
      }
    }
    expect(HUD_NEAREST_STATIONS).toBe(5);
    expect(crowding(HUD_NEAREST_STATIONS, "scattered", 6)).toBeLessThan(0.1);
    expect(crowding(HUD_NEAREST_STATIONS + 1, "scattered", 6)).toBeGreaterThan(
      0.1,
    );
    expect(crowding(HUD_NEAREST_STATIONS, "grid", 6)).toBe(0);
  });
});
