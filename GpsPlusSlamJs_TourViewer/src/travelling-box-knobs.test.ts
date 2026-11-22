/**
 * Why this test matters: the travelling box's tuning (threshold, keep
 * factor, holds, lock, angle, flight time) can be changed from the
 * address for a field sweep, but only behind `?debug=1` and only to the
 * values the sweep compares; a visitor's address must never change how the
 * words behave, and a typo must fall back to the default rather than to a
 * value nobody judged.
 */

import { describe, expect, it } from "vitest";

import { travellingBoxKnobs } from "./travelling-box-knobs";
import { TRAVELLING_BOX_DEFAULTS } from "./travelling-box-rules";

describe("travellingBoxKnobs", () => {
  it("has the chosen defaults", () => {
    expect(TRAVELLING_BOX_DEFAULTS).toEqual({
      thr: 12,
      metric: "min",
      keep: 0.95,
      holdDock: 0.3,
      holdPlate: 0.3,
      lock: 0.3,
      angle: 60,
      fly: 0.6,
      grow: true,
    });
    expect(travellingBoxKnobs("", true)).toEqual(TRAVELLING_BOX_DEFAULTS);
  });

  it("reads nothing from the address without debug", () => {
    expect(
      travellingBoxKnobs("?tb.thr=20&tb.grow=off&tb.metric=h", false),
    ).toEqual(TRAVELLING_BOX_DEFAULTS);
  });

  it("takes each knob's allowed values with debug", () => {
    expect(
      travellingBoxKnobs(
        "?debug=1&tb.thr=16&tb.metric=h&tb.keep=0.85&tb.holdDock=1&tb.holdPlate=0.6&tb.lock=0&tb.angle=45&tb.fly=0.35&tb.grow=off",
        true,
      ),
    ).toEqual({
      thr: 16,
      metric: "h",
      keep: 0.85,
      holdDock: 1,
      holdPlate: 0.6,
      lock: 0,
      angle: 45,
      fly: 0.35,
      // The growth is the replay's to decide, never the address's.
      grow: true,
    });
  });

  it("falls back to the default for a value outside its list", () => {
    expect(
      travellingBoxKnobs(
        "?tb.thr=13&tb.metric=w&tb.keep=0.5&tb.lock=-1&tb.angle=90&tb.fly=2&tb.grow=yes&tb.holdDock=",
        true,
      ),
    ).toEqual(TRAVELLING_BOX_DEFAULTS);
  });
});
