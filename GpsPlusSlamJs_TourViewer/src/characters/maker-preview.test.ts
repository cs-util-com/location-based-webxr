import { describe, expect, it } from "vitest";

import {
  BACKDROPS,
  beckonIndex,
  createAnimSet,
  talkIndex,
} from "./maker-preview.js";

describe("maker-preview", () => {
  // Why: the talking preview rests closed for a moment, then talks in the
  // prototype's mouth pattern, so the author sees each frame often enough
  // to catch a flicker at the feet.
  it("talks in a repeating pattern after a pause", () => {
    expect(talkIndex(0)).toBe(0);
    expect(talkIndex(899)).toBe(0);
    expect(talkIndex(900)).toBe(1);
    expect(talkIndex(1010)).toBe(2);
    expect(talkIndex(2700)).toBe(0);
    expect(talkIndex(2800 + 900)).toBe(1);
    const seen = new Set<number>();
    for (let t = 0; t < 2800; t += 10) seen.add(talkIndex(t));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("points the way part of the time", () => {
    expect(beckonIndex(500)).toBe(0);
    expect(beckonIndex(1500)).toBe(3);
    expect(beckonIndex(3000)).toBe(0);
  });

  // Why: four outdoor backdrops chosen by hand, meadow first.
  it("offers the four outdoor backdrops", () => {
    expect(BACKDROPS.map((b) => b.id)).toEqual([
      "meadow",
      "autumn",
      "city",
      "snow",
    ]);
  });
});

describe("createAnimSet", () => {
  // Why: each re-cut rebuilds the talk-style previews with new canvases;
  // kept by slot, the earlier ones go, so N re-cuts leave one set instead
  // of N (each holding its canvas and the cut frames it draws).
  it("N re-cuts leave one animation per slot", () => {
    const set = createAnimSet<{ cut: number }>();
    set.put("pvTalk", { cut: 0 });
    for (let cut = 1; cut <= 7; cut++) {
      set.put("pvDrawn", { cut });
      set.put("pvSteady", { cut });
    }
    expect(set.size).toBe(3);
    expect([...set.all()].map((a) => a.cut)).toEqual([0, 7, 7]);
  });
});
