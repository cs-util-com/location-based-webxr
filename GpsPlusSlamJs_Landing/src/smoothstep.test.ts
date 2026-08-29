/**
 * Why this test matters: the curve is shared by the hero veil and both scene
 * gradients, so "the fades look like each other" is now a fact rather than a
 * coincidence — and a change to the feel of one is a change to all three. The
 * endpoint and midpoint values are what make that visible if someone edits it.
 *
 * The unclamped contract is pinned deliberately: it is the reason each caller
 * still clamps, and a future session that "helpfully" clamps in here would
 * make the caller-side `clamp01` calls look redundant and invite their removal.
 */
import { describe, expect, it } from "vitest";

import { smoothstep } from "./smoothstep.js";

describe("smoothstep", () => {
  it("pins both ends of the curve", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
  });

  it("is symmetric about the midpoint", () => {
    expect(smoothstep(0.5)).toBe(0.5);
    for (const t of [0.1, 0.25, 0.4]) {
      expect(smoothstep(t) + smoothstep(1 - t)).toBeCloseTo(1, 12);
    }
  });

  it("has zero slope at both ends, which is the whole point", () => {
    // A linear ramp would move by ~1e-6 here; the cubic moves by ~1e-12.
    expect(smoothstep(1e-6)).toBeLessThan(1e-11);
    expect(1 - smoothstep(1 - 1e-6)).toBeLessThan(1e-11);
  });

  it("does NOT clamp — callers own that", () => {
    // Documents the contract rather than the arithmetic: out-of-range input
    // leaves the unit interval instead of being silently pinned.
    expect(smoothstep(2)).toBe(-4); // 4 · (3 − 4)
    expect(smoothstep(-1)).toBe(5); // 1 · (3 + 2)
  });
});
