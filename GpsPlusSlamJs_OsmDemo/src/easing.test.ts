/**
 * Why these tests matter: this curve now drives all three fades of the AR
 * entry, so a change here changes what the user sees on entry three times over.
 * The two properties below are the ones the entry actually depends on — the
 * ends are pinned (a fade that starts at 0.02 opacity is a visible pop) and the
 * curve is monotone (a fade that goes backwards reads as a flicker).
 *
 * The identity at the endpoints is also what makes the three previously
 * separate copies provably interchangeable with this one.
 *
 * @see easing.ts.md
 */

import { describe, it, expect } from "vitest";
import { smoothstep } from "./easing.js";

describe("smoothstep", () => {
  it("pins both ends exactly", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
  });

  it("is symmetric about the midpoint", () => {
    expect(smoothstep(0.5)).toBe(0.5);
    for (const t of [0.1, 0.25, 0.4]) {
      expect(smoothstep(t) + smoothstep(1 - t)).toBeCloseTo(1, 12);
    }
  });

  it("rises monotonically across the unit interval", () => {
    // A fade that ever goes backwards reads as a flicker. Sampled densely
    // rather than at a few points, because the failure would be local.
    let previous = -1;
    for (let i = 0; i <= 200; i += 1) {
      const value = smoothstep(i / 200);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it("has zero slope at both ends, which is the reason to use it", () => {
    // The property that distinguishes it from a linear ramp: the first and last
    // steps are far smaller than the middle one, so neither end steps.
    const step = 1 / 1000;
    const atStart = smoothstep(step) - smoothstep(0);
    const atMiddle = smoothstep(0.5 + step) - smoothstep(0.5);
    const atEnd = smoothstep(1) - smoothstep(1 - step);

    expect(atStart).toBeLessThan(atMiddle / 100);
    expect(atEnd).toBeLessThan(atMiddle / 100);
  });

  it("matches the three copies it replaces", () => {
    // The literal expression that lived in `ar-descent.ts`,
    // `ar-entry-dom-veil.ts` and `ar-entry-veil.ts`, kept as the proof that
    // this is a move and not a redesign.
    const original = (t: number): number => t * t * (3 - 2 * t);
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      expect(smoothstep(t)).toBe(original(t));
    }
  });
});
