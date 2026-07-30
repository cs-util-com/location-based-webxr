/**
 * The ground-layer ladder.
 *
 * WHY THESE TESTS MATTER. Coplanar geometry z-fights, and z-fighting is the kind of
 * defect that reads as "the renderer is broken" rather than "two layers were given
 * the same height". Five things now want to be at ground level, so the invariant is
 * that no two of them share an offset — and that is only worth asserting because the
 * failure is visual, camera-dependent, and therefore invisible to every other test.
 */

import { describe, expect, it } from "vitest";

import { GROUND_LAYERS, groundLift } from "./layer-order.js";
import { ALL_LAYERS } from "./layers.js";

describe("groundLift", () => {
  it("is strictly increasing along the ladder", () => {
    // The z-fighting guard. Equal values are the bug; the ORDER is the design
    // decision documented in `layer-order.ts`.
    const lifts = GROUND_LAYERS.map(groundLift);
    for (let i = 1; i < lifts.length; i++) {
      expect(lifts[i]).toBeGreaterThan(lifts[i - 1] ?? 0);
    }
  });

  it("gives every ground layer a DISTINCT non-zero lift", () => {
    const lifts = GROUND_LAYERS.map(groundLift);
    expect(new Set(lifts).size).toBe(lifts.length);
    for (const lift of lifts) expect(lift).toBeGreaterThan(0);
  });

  it("puts cells at the TOP, because they are what is being inspected", () => {
    // The per-cell grid is the finest-grained claim and the thing a user clicks to
    // interrogate. Occluding it with a coarser layer would defeat the demo.
    const highest = Math.max(...GROUND_LAYERS.map(groundLift));
    expect(groundLift("cells")).toBe(highest);
  });

  it("does not lift anything that stands up from the ground", () => {
    // Buildings, trees and markers are separated by their own geometry. Lifting
    // them would only make them float above the surface they sit on.
    expect(groundLift("buildings")).toBe(0);
    expect(groundLift("trees")).toBe(0);
    expect(groundLift("poi")).toBe(0);
  });

  it("answers for EVERY layer, so a new one cannot be forgotten", () => {
    // Exhaustive over the union at compile time too; this catches the dynamic path.
    for (const layer of ALL_LAYERS) {
      expect(Number.isFinite(groundLift(layer))).toBe(true);
    }
  });

  it("keeps every lift small enough not to look like floating", () => {
    // Large enough to beat depth precision across a 0.5 m..4000 m frustum, small
    // enough to be invisible. Both halves matter: a 1 m lift would put the
    // affordance grid visibly above the ground it describes.
    for (const layer of ALL_LAYERS) {
      expect(groundLift(layer)).toBeLessThan(0.3);
    }
  });
});
