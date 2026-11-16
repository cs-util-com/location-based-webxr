import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  INITIAL_MODEL_VIEW,
  TEXTURE_STEPS,
  modelViewReducer,
  type CameraPose,
  type ModelViewAction,
} from "./model-compare-view.js";

const coordinate = fc.double({ min: -1e3, max: 1e3, noNaN: true });
const vec = fc.tuple(coordinate, coordinate, coordinate);
const pose = fc.record({ position: vec, target: vec });

describe("model comparison view state, over any sequence of actions", () => {
  // Why this test matters: the camera may only change by the viewer's own
  // orbit or by a new model, never by a slider or a checkbox, whatever the
  // order; the wireframe look only changes by its own checkbox; and both
  // sliders always name a stop that exists.
  it("only an orbit or a new model moves the camera; both sliders are always in range", () => {
    const action: fc.Arbitrary<ModelViewAction> = fc.oneof(
      fc.record({
        type: fc.constant("geometry" as const),
        index: fc.integer({ min: -2, max: 9 }),
      }),
      fc.record({
        type: fc.constant("texture" as const),
        index: fc.integer({ min: -2, max: TEXTURE_STEPS.length + 1 }),
      }),
      fc.record({
        type: fc.constant("toggle" as const),
        name: fc.constantFrom(
          "webp" as const,
          "positions8" as const,
          "original" as const,
          "wireframe" as const,
        ),
        on: fc.boolean(),
      }),
      fc.record({ type: fc.constant("camera" as const), camera: pose }),
      fc.record({
        type: fc.constant("loaded" as const),
        stops: fc.integer({ min: 0, max: 8 }),
        geometry: fc.integer({ min: -1, max: 8 }),
        camera: pose,
      }),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
        let state = INITIAL_MODEL_VIEW;
        const broken: string[] = [];
        for (const a of actions) {
          const before: CameraPose | null = state.camera;
          const next = modelViewReducer(state, a);
          const movesCamera = a.type === "camera" || a.type === "loaded";
          if (!movesCamera && next.camera !== before) {
            broken.push(`${a.type} moved the camera`);
          }
          const wireToggle = a.type === "toggle" && a.name === "wireframe";
          if (!wireToggle && next.wireframe !== state.wireframe) {
            broken.push(`${a.type} changed the wireframe look`);
          }
          if (
            next.stops > 0 &&
            (next.geometry < 0 || next.geometry >= next.stops)
          ) {
            broken.push(`geometry ${next.geometry} of ${next.stops}`);
          }
          if (next.texture < 0 || next.texture >= TEXTURE_STEPS.length) {
            broken.push(`texture ${next.texture}`);
          }
          state = next;
        }
        expect(broken).toEqual([]);
      }),
    );
  });
});
