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

import { GROUND_LAYERS, RENDER_ORDER, groundLift } from "./layer-order.js";
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

/**
 * WHY THIS EXISTS (DEC-R7b-7, and a review finding on PR #250). The transparent
 * layers are ordered coarse-to-fine so the finer claim composites on top. That
 * shipped half-applied: `RENDER_ORDER.areas` was assigned to the slab and
 * `RENDER_ORDER.cells` was assigned to NOTHING, so the grid kept three's default
 * `0` — below the slab — and the documented invariant was inverted in the scene
 * while a test compared the two constants to each other and passed.
 *
 * The lesson is in the second test below: the failure was possible because `0`
 * is both "the default" and "a legal-looking value", so a rung that was never
 * applied is indistinguishable from one applied and set to the bottom.
 *
 * The APPLICATION is not asserted here — the grid is built by `building-view.ts`,
 * which needs a WebGL context. That gap is real and recorded in the round-8
 * summary rather than papered over.
 */
describe("RENDER_ORDER", () => {
  it("orders coarse before fine, so the finer claim draws last", () => {
    // Larger `renderOrder` draws later, and later means on top for transparent
    // geometry. A region is a flood fill OVER cells, so the cells are the finer
    // claim and must win.
    expect(RENDER_ORDER.areas).toBeLessThan(RENDER_ORDER.cells);
  });

  it("gives every layer a NON-ZERO rung", () => {
    // The guard that would have caught the shipped bug. `0` is three's default,
    // so a layer that is never assigned looks exactly like one deliberately
    // placed at the bottom. Keeping every rung above 0 means "unset" and "set
    // low" stop being the same observable state.
    for (const [layer, order] of Object.entries(RENDER_ORDER)) {
      expect(order, layer).toBeGreaterThan(0);
    }
  });
});
