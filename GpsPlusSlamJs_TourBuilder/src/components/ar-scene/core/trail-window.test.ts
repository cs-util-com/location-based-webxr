import { describe, expect, it } from "vitest";

import {
  assignOrbSlots,
  selectTrailWindow,
  type HorizontalPoint,
} from "./trail-window.js";

/** A straight line of points 1 m apart along +X. */
function line(count: number): HorizontalPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: i, z: 0 }));
}

const CONFIG = { maxOrbs: 4, radiusM: 5 };

describe("selectTrailWindow", () => {
  it("returns nothing without a user pose", () => {
    expect(selectTrailWindow(line(10), null, CONFIG)).toEqual([]);
  });

  it("keeps only points inside the radius", () => {
    // User at x=0: points 0..5 are within 5 m, but the cap keeps the 4 nearest.
    expect(selectTrailWindow(line(20), { x: 0, z: 0 }, CONFIG)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("returns the nearest points, not the first ones", () => {
    // From x=10 the ranking is 10, then the 9/11 tie (lower index first), then
    // 8 — so the window straddles the user rather than starting at the trail head.
    expect(selectTrailWindow(line(20), { x: 10, z: 0 }, CONFIG)).toEqual([
      8, 9, 10, 11,
    ]);
  });

  it("returns indices in ascending order for a stable frame-to-frame result", () => {
    const selected = selectTrailWindow(line(20), { x: 10.4, z: 0 }, CONFIG);
    expect([...selected]).toEqual([...selected].sort((a, b) => a - b));
  });

  it("ignores the Y axis entirely (contract D17)", () => {
    // Only x/z exist in the type; a tall offset in the user pose must not be
    // representable here — the window is a ground-plane decision by construction.
    const near = selectTrailWindow([{ x: 0, z: 3 }], { x: 0, z: 0 }, CONFIG);
    expect(near).toEqual([0]);
  });

  it("skips points that could not be converted to world space", () => {
    const points = [{ x: 0, z: 0 }, null, { x: 1, z: 0 }];
    expect(selectTrailWindow(points, { x: 0, z: 0 }, CONFIG)).toEqual([0, 2]);
  });

  it("respects a zero cap", () => {
    expect(
      selectTrailWindow(line(5), { x: 0, z: 0 }, { maxOrbs: 0, radiusM: 5 }),
    ).toEqual([]);
  });

  it("includes a point exactly on the radius", () => {
    expect(selectTrailWindow([{ x: 5, z: 0 }], { x: 0, z: 0 }, CONFIG)).toEqual(
      [0],
    );
  });
});

describe("selectTrailWindow — minSeparationM (overlapping orbs)", () => {
  const USER = { x: 0, z: 0 };
  const WIDE = { maxOrbs: 16, radiusM: 50, minSeparationM: 1 };

  it("draws one orb for points stacked on the same spot, keeping the lowest index", () => {
    const stacked = [
      { x: 5, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 0.2 },
    ];
    expect(selectTrailWindow(stacked, USER, WIDE)).toEqual([0]);
  });

  it("keeps every point of a normally spaced trail", () => {
    const spaced = Array.from({ length: 10 }, (_, i) => ({ x: i * 3, z: 0 }));
    expect(selectTrailWindow(spaced, USER, WIDE)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("a retraced stretch collapses to the original trail, not to a single orb", () => {
    // 40 m out and back over the very same points, 3 m apart.
    const out = Array.from({ length: 14 }, (_, i) => ({ x: i * 3, z: 0 }));
    const retraced = [...out, ...[...out].reverse()];
    const kept = selectTrailWindow(retraced, USER, WIDE);
    expect(kept).toEqual(out.map((_, i) => i));
  });

  it("compares against points actually kept, so a chain of close points does not eat the trail", () => {
    // 0.8 m steps: 0 kept, 0.8 dropped (< 1 m from 0), 1.6 kept (1.6 m from 0),
    // 2.4 dropped (0.8 m from 1.6), 3.2 kept. Chaining through dropped points
    // would delete everything after the first.
    const chain = Array.from({ length: 5 }, (_, i) => ({ x: i * 0.8, z: 0 }));
    expect(selectTrailWindow(chain, USER, WIDE)).toEqual([0, 2, 4]);
  });

  it("picks the survivor by index, not by distance to the user, so it cannot flip as the user walks", () => {
    const pair = [
      { x: 10, z: 0 },
      { x: 10.3, z: 0 },
    ];
    expect(selectTrailWindow(pair, { x: 10.3, z: 0 }, WIDE)).toEqual([0]);
    expect(selectTrailWindow(pair, { x: 0, z: 0 }, WIDE)).toEqual([0]);
  });

  it("removes duplicates before the cap, so stacked points do not use up the pool", () => {
    const points = [
      { x: 1, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 0 },
      { x: 4, z: 0 },
      { x: 7, z: 0 },
    ];
    expect(
      selectTrailWindow(points, USER, {
        maxOrbs: 3,
        radiusM: 50,
        minSeparationM: 1,
      }),
    ).toEqual([0, 3, 4]);
  });

  it("does nothing when minSeparationM is omitted (existing behaviour)", () => {
    const stacked = [
      { x: 5, z: 0 },
      { x: 5, z: 0 },
    ];
    expect(
      selectTrailWindow(stacked, USER, { maxOrbs: 16, radiusM: 50 }),
    ).toEqual([0, 1]);
  });
});

describe("assignOrbSlots", () => {
  it("fills empty slots in order", () => {
    expect(assignOrbSlots([null, null, null], [7, 8], 3)).toEqual([7, 8, null]);
  });

  it("keeps a still-selected index in the slot it already occupies", () => {
    // Slot 2 already shows 8; it must not be shuffled to slot 0 just because
    // the selection order changed — re-pointing an anchor is the cost we avoid.
    expect(assignOrbSlots([null, null, 8], [8, 9], 3)).toEqual([9, null, 8]);
  });

  it("frees slots whose index left the window", () => {
    expect(assignOrbSlots([1, 2, 3], [2], 3)).toEqual([null, 2, null]);
  });

  it("never exceeds the pool size", () => {
    expect(assignOrbSlots([], [1, 2, 3, 4, 5], 2)).toHaveLength(2);
  });

  it("always returns exactly poolSize entries", () => {
    expect(assignOrbSlots([1], [], 4)).toEqual([null, null, null, null]);
  });

  it("does not duplicate an index across two slots", () => {
    const next = assignOrbSlots([5, 5], [5], 2);
    expect(next.filter((i) => i === 5)).toHaveLength(1);
  });
});
