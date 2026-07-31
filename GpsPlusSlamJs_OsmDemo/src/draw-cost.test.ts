/**
 * WHY THESE TESTS MATTER (W10, N5). The readout exists so that Stage 3's
 * central trade — chunking the city geometry so it can be frustum-culled at
 * all, at the cost of many draw calls instead of one — is a measurement rather
 * than an argument. A readout that is silently absent, or that reports zero as
 * though it were a measurement, would make that trade unfalsifiable while
 * looking like it had been checked.
 *
 * So the interesting assertion is not the happy path; it is that "not measured
 * yet" and "measured as nothing" stay distinguishable.
 */

import { describe, expect, it } from "vitest";

import { describeDrawCost } from "./draw-cost.js";

describe("describeDrawCost", () => {
  it("reports calls and triangles for a drawn frame", () => {
    expect(describeDrawCost({ calls: 7, triangles: 1234 })).toBe(
      "7 draws / 1,234 tri",
    );
  });

  it("separates thousands, because the comparisons are six figures", () => {
    // The status line is read at a glance; an unseparated digit string of that
    // length cannot be, and glancing is its entire use.
    expect(describeDrawCost({ calls: 412, triangles: 1_284_930 })).toBe(
      "412 draws / 1,284,930 tri",
    );
  });

  it("says NOTHING before a frame has been drawn", () => {
    // Not "0 draws". Before the first render, "the renderer has drawn nothing"
    // and "the renderer drew a frame containing nothing" are different claims,
    // and only the second is a defect — printing a zero for both would hide it.
    // `writeStatus` drops empty parts, so an unmeasured cost simply does not
    // appear rather than appearing as a false measurement.
    expect(describeDrawCost(undefined)).toBe("");
    expect(describeDrawCost({ calls: 0, triangles: 0 })).toBe("");
  });
});
