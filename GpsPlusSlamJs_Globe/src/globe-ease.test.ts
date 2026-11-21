/**
 * The package's progress clamp. Why this file matters: the fly-in clock
 * and the pin flight both read their progress through `clampProgress`, and
 * both rely on NaN reading as "not started" (0), which `clamp01` does not
 * give. The property pins the whole contract against a reference.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { clamp01, clampProgress } from "./globe-ease.js";

describe("clampProgress", () => {
  it("reads NaN and anything at or below 0 as 0, and 1 or more as 1", () => {
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampProgress(-0.5)).toBe(0);
    expect(clampProgress(-0)).toBe(0);
    expect(clampProgress(0.25)).toBe(0.25);
    expect(clampProgress(1)).toBe(1);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("differs from clamp01 only on NaN", () => {
    expect(clamp01(Number.NaN)).toBeNaN();
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (p) => {
        expect(clampProgress(p)).toBe(clamp01(p) === 0 ? 0 : clamp01(p));
      }),
    );
  });

  it("is always in [0, 1]", () => {
    fc.assert(
      fc.property(fc.double(), (p) => {
        const c = clampProgress(p);
        expect(c >= 0 && c <= 1).toBe(true);
      }),
    );
  });

  it("leaves a value inside (0, 1) unchanged", () => {
    fc.assert(
      fc.property(
        fc.double({
          min: 0,
          max: 1,
          minExcluded: true,
          maxExcluded: true,
          noNaN: true,
        }),
        (p) => {
          expect(clampProgress(p)).toBe(p);
        },
      ),
    );
  });
});
