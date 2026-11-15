import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  INITIAL_MODEL_VIEW,
  modelViewReducer,
  type CameraPose,
  type ModelViewAction,
} from "./model-compare-view.js";

const coordinate = fc.double({ min: -1e3, max: 1e3, noNaN: true });
const vec = fc.tuple(coordinate, coordinate, coordinate);
const pose = fc.record({ position: vec, target: vec });

describe("model comparison view state, over any sequence of actions", () => {
  // Why this test matters: the camera may only change by the viewer's own
  // orbit or by a new source, never by a switch or the wireframe toggle,
  // whatever the order; and the shown index always names a model.
  it("only an orbit or a new source moves the camera; the shown model is always in range", () => {
    const action: fc.Arbitrary<ModelViewAction> = fc.oneof(
      fc.record({
        type: fc.constant("show" as const),
        index: fc.integer({ min: -2, max: 9 }),
      }),
      fc.record({ type: fc.constant("wireframe" as const), on: fc.boolean() }),
      fc.record({ type: fc.constant("camera" as const), camera: pose }),
      fc.record({
        type: fc.constant("loaded" as const),
        count: fc.integer({ min: 1, max: 8 }),
        camera: pose,
      }),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
        let state = INITIAL_MODEL_VIEW;
        for (const a of actions) {
          const before: CameraPose | null = state.camera;
          const next = modelViewReducer(state, a);
          if (a.type === "show" || a.type === "wireframe") {
            expect(next.camera).toBe(before);
          }
          if (a.type === "show") expect(next.wireframe).toBe(state.wireframe);
          if (next.count > 0) {
            expect(next.shown).toBeGreaterThanOrEqual(0);
            expect(next.shown).toBeLessThan(next.count);
          }
          state = next;
        }
      }),
    );
  });
});
