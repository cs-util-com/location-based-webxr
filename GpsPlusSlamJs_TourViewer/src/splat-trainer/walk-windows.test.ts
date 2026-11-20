import { describe, expect, it } from "vitest";
import type { Vector3 } from "gps-plus-slam-app-framework/core";

import { TRAINER_DEFAULTS, type TrainerSettings } from "./trainer-defaults.js";
import {
  holdoutIndices,
  jumpSegments,
  planWindows,
  type WalkFrame,
} from "./walk-windows.js";

/** A straight walk along x: `count` frames `stepM` apart, `dtMs` apart. */
function straightWalk(count: number, stepM = 1, dtMs = 1000): WalkFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    position: [i * stepM, 0, 0] as Vector3,
    capturedAt: i * dtMs,
  }));
}

const SMALL: TrainerSettings = {
  ...TRAINER_DEFAULTS,
  windowM: 10,
  minFrames: 4,
  maxFrames: 12,
  holdoutEvery: 4,
  minHoldouts: 2,
  overlapFraction: 0.2,
};

describe("jumpSegments", () => {
  it("keeps a walk at walking speed in one segment", () => {
    // Why: a normal walk must never be cut; 1 m/s is under any jump speed.
    expect(jumpSegments(straightWalk(5), 3)).toEqual([[0, 1, 2, 3, 4]]);
  });

  it("cuts where the camera moved faster than the jump speed", () => {
    // Why: a tracking relocalisation shows as a step no walker makes; the
    // frames on either side are in different frames of reference.
    const walk = straightWalk(6);
    walk[3] = { position: [50, 0, 0], capturedAt: 3000 };
    walk[4] = { position: [51, 0, 0], capturedAt: 4000 };
    walk[5] = { position: [52, 0, 0], capturedAt: 5000 };
    expect(jumpSegments(walk, 3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
  });

  it("cuts a step taken in no time, and never cuts at an untimed frame", () => {
    // Why: a zero time step with movement is an infinite speed; without a
    // time there is no speed to judge, so the walk is kept whole.
    const sameTime: WalkFrame[] = [
      { position: [0, 0, 0], capturedAt: 0 },
      { position: [1, 0, 0], capturedAt: 0 },
    ];
    expect(jumpSegments(sameTime, 3)).toEqual([[0], [1]]);
    const untimed: WalkFrame[] = [
      { position: [0, 0, 0], capturedAt: 0 },
      { position: [100, 0, 0], capturedAt: null },
    ];
    expect(jumpSegments(untimed, 3)).toEqual([[0, 1]]);
  });

  it("returns no segment for no frames and rejects a bad jump speed", () => {
    expect(jumpSegments([], 3)).toEqual([]);
    expect(() => jumpSegments(straightWalk(2), 0)).toThrow(RangeError);
    expect(() => jumpSegments(straightWalk(2), Number.NaN)).toThrow(RangeError);
  });
});

describe("holdoutIndices", () => {
  it("holds out the middle frame of every block, never the first frame", () => {
    // Why: a hold-out between two trained frames is scored on a view the
    // trainer saw around, not at the walk's open end.
    expect([...holdoutIndices(20, 8)]).toEqual([4, 12]);
    expect([...holdoutIndices(3, 8)]).toEqual([]);
    expect([...holdoutIndices(6, 2)]).toEqual([1, 3, 5]);
  });

  it("rejects a hold-out step below 2", () => {
    expect(() => holdoutIndices(10, 1)).toThrow(RangeError);
    expect(() => holdoutIndices(10, 2.5)).toThrow(RangeError);
  });
});

describe("planWindows", () => {
  it("cuts a long walk into windows of about the window length", () => {
    // Why: a window is what fits in memory; its length is the knob.
    const plan = planWindows(straightWalk(40), SMALL);
    expect(plan.windows.map((w) => [w.core[0], w.core.at(-1)])).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
      [30, 39],
    ]);
    expect(plan.holdouts).toEqual([2, 6, 10, 14, 18, 22, 26, 30, 34, 38]);
  });

  it("trains each window on its neighbours' nearby frames too, never on a hold-out", () => {
    // Why: the overlap blends the seams; a hold-out in it would leak the
    // evaluation frames into training.
    const plan = planWindows(straightWalk(40), SMALL);
    const second = plan.windows[1];
    // Overlap reach is 0.2 x 10 m = 2 m on each side of the core (10..19).
    expect(second?.train).toEqual([8, 9, 11, 12, 13, 15, 16, 17, 19, 20, 21]);
  });

  it("merges a window with too few training frames into its neighbour", () => {
    // Why: a window of a handful of frames trains a poor splat; its frames
    // are better spent in the window next to it.
    const plan = planWindows(straightWalk(24), SMALL);
    expect(plan.windows.map((w) => [w.core[0], w.core.at(-1)])).toEqual([
      [0, 9],
      [10, 23],
    ]);
  });

  it("splits a window with too many training frames into balanced parts", () => {
    // Why: a slow walk packs many frames into one window length; the
    // memory budget is per frame, so the window is split by count.
    const plan = planWindows(straightWalk(40, 0.1), SMALL);
    const counts = plan.windows.map(
      (w) => w.core.filter((i) => !plan.holdouts.includes(i)).length,
    );
    expect(counts).toEqual([10, 10, 10]);
  });

  it("borrows hold-outs from neighbouring windows when its own are too few", () => {
    // Why: one or two hold-outs give a score too noisy to trust.
    const plan = planWindows(straightWalk(40), { ...SMALL, minHoldouts: 4 });
    const first = plan.windows[0];
    expect(first?.holdouts).toEqual([2, 6, 10, 14]);
    expect(first?.tooFewHoldouts).toBe(false);
  });

  it("flags a window whose hold-outs stay too few after borrowing", () => {
    const plan = planWindows(straightWalk(10), { ...SMALL, minHoldouts: 4 });
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0]?.holdouts).toEqual([2, 6]);
    expect(plan.windows[0]?.tooFewHoldouts).toBe(true);
  });

  it("never lets a window reach across a jump", () => {
    // Why: the two sides of a jump are in different frames of reference;
    // one splat over both would be torn.
    const walk = [
      ...straightWalk(12),
      ...straightWalk(12).map((f, i) => ({
        position: [500 + i, 0, 0] as Vector3,
        capturedAt: (f.capturedAt ?? 0) + 12000,
      })),
    ];
    const plan = planWindows(walk, SMALL);
    expect(plan.segments).toEqual([
      [...Array(12).keys()],
      [...Array(12).keys()].map((i) => i + 12),
    ]);
    expect(plan.windows.map((w) => w.segment)).toEqual([0, 1]);
    expect(plan.windows[0]?.train.every((i) => i < 12)).toBe(true);
  });

  it("rejects settings whose frame limits cannot both hold", () => {
    // Why: with fewer than twice the minimum as maximum, a split can make
    // a part under the minimum; the settings are a programming mistake.
    expect(() =>
      planWindows(straightWalk(4), { ...SMALL, minFrames: 7, maxFrames: 12 }),
    ).toThrow(RangeError);
    expect(() =>
      planWindows(straightWalk(4), { ...SMALL, windowM: 0 }),
    ).toThrow(RangeError);
  });

  it("plans nothing for no frames", () => {
    expect(planWindows([], SMALL)).toEqual({
      segments: [],
      holdouts: [],
      windows: [],
    });
  });
});
