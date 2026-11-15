import { describe, expect, it } from "vitest";
import {
  INITIAL_MODEL_VIEW,
  framePose,
  modelViewReducer,
  type CameraPose,
  type ModelViewState,
} from "./model-compare-view.js";

const POSE: CameraPose = { position: [3, 2, 4], target: [0, 0.5, 0] };
const MOVED: CameraPose = { position: [-1, 5, 2], target: [0.2, 0.4, 0] };

/** Seven models (the original and six variants), framed. */
const loaded = (): ModelViewState =>
  modelViewReducer(INITIAL_MODEL_VIEW, {
    type: "loaded",
    count: 7,
    camera: POSE,
  });

describe("model comparison view state", () => {
  // Why this test matters: the whole point of the view is to see a model
  // jump at the same spot. A switch that reframed or reset the camera
  // would make every variant look the same again.
  it("switching the model keeps the camera exactly where the viewer put it", () => {
    let state = modelViewReducer(loaded(), { type: "camera", camera: MOVED });
    for (const index of [3, 1, 6, 0, 2]) {
      state = modelViewReducer(state, { type: "show", index });
      expect(state.shown).toBe(index);
      expect(state.camera).toBe(MOVED);
    }
  });

  // Why this test matters: removed geometry is only visible with the
  // wireframe on, and the comparison is a sequence of switches, so the
  // look must survive every switch and a new source alike.
  it("the wireframe look stays on across switches and a new source", () => {
    let state = modelViewReducer(loaded(), { type: "wireframe", on: true });
    for (const index of [2, 5, 0]) {
      state = modelViewReducer(state, { type: "show", index });
      expect(state.wireframe).toBe(true);
    }
    state = modelViewReducer(state, { type: "loaded", count: 4, camera: POSE });
    expect(state.wireframe).toBe(true);
    expect(state.shown).toBe(0);
    state = modelViewReducer(state, { type: "wireframe", on: false });
    expect(state.wireframe).toBe(false);
  });

  // Why this test matters: a button for a variant that failed, or a stale
  // index after a smaller source, must not leave the view pointing at no
  // model; the state is returned unchanged instead.
  it("refuses an index out of range or not an integer, and a non-finite pose", () => {
    const state = loaded();
    for (const index of [-1, 7, 1.5, Number.NaN]) {
      expect(modelViewReducer(state, { type: "show", index })).toBe(state);
    }
    const bad: CameraPose = { position: [Number.NaN, 0, 0], target: [0, 0, 0] };
    expect(modelViewReducer(state, { type: "camera", camera: bad })).toBe(
      state,
    );
    expect(
      modelViewReducer(state, { type: "loaded", count: 0, camera: POSE }),
    ).toBe(state);
    expect(
      modelViewReducer(INITIAL_MODEL_VIEW, { type: "show", index: 0 }),
    ).toBe(INITIAL_MODEL_VIEW);
  });

  // Why this test matters: the first frame decides whether the model is
  // in view at all; the camera looks at the box's centre from outside it.
  it("frames a box: looks at its centre from outside, 2.6 half diagonals away", () => {
    const pose = framePose([-1, 0, -2], [1, 2, 2]);
    expect(pose.target).toEqual([0, 1, 0]);
    const halfDiagonal = Math.hypot(2, 2, 4) / 2;
    const distance = Math.hypot(
      ...pose.position.map((v, i) => v - pose.target[i]!),
    );
    expect(distance).toBeCloseTo(halfDiagonal * 2.6, 9);
    expect(pose.position[1]).toBeGreaterThan(pose.target[1]);
    expect(() => framePose([0, 0, 0], [0, 0, 0])).toThrow(/empty/);
    expect(() => framePose([0, 0, 0], [1, Number.NaN, 1])).toThrow(/finite/);
  });
});
