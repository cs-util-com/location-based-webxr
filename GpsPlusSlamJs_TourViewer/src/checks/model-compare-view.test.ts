import { describe, expect, it } from "vitest";
import { OPTIMIZER_SETTINGS } from "../editor/asset-shelf/optimizer-settings.js";
import {
  DEFAULT_TEXTURE_STEP,
  INITIAL_MODEL_VIEW,
  TEXTURE_STEPS,
  framePose,
  modelViewReducer,
  variantSettings,
  type CameraPose,
  type ModelViewAction,
  type ModelViewState,
} from "./model-compare-view.js";

const POSE: CameraPose = { position: [3, 2, 4], target: [0, 0.5, 0] };
const MOVED: CameraPose = { position: [-1, 5, 2], target: [0.2, 0.4, 0] };

/** Seven geometry stops, the default level the fifth, framed. */
const loaded = (): ModelViewState =>
  modelViewReducer(INITIAL_MODEL_VIEW, {
    type: "loaded",
    stops: 7,
    geometry: 4,
    camera: POSE,
  });

describe("model comparison view state", () => {
  // Why this test matters: the whole point of the view is to see a model
  // change at the same spot. A slider move or a checkbox that reframed or
  // reset the camera would make every variant look the same again.
  it("moving either slider or ticking an option keeps the camera where the viewer put it", () => {
    let state = modelViewReducer(loaded(), { type: "camera", camera: MOVED });
    const moves: ModelViewAction[] = [
      { type: "geometry", index: 0 },
      { type: "texture", index: 4 },
      { type: "toggle", name: "webp", on: true },
      { type: "toggle", name: "positions8", on: true },
      { type: "toggle", name: "original", on: true },
      { type: "toggle", name: "wireframe", on: true },
      { type: "geometry", index: 6 },
      { type: "texture", index: 0 },
    ];
    for (const move of moves) {
      state = modelViewReducer(state, move);
      expect(state.camera).toBe(MOVED);
    }
    expect(state).toMatchObject({
      geometry: 6,
      texture: 0,
      webp: true,
      positions8: true,
      original: true,
      wireframe: true,
    });
  });

  // Why this test matters: a new model has its own geometry stops, so its
  // slider starts on its default level and the original is not shown; the
  // texture step, the options and the wireframe look are the viewer's
  // settings, not the model's, and stay as they were left.
  it("a new model starts on its default level and keeps the texture step and options", () => {
    let state = modelViewReducer(loaded(), { type: "texture", index: 3 });
    state = modelViewReducer(state, { type: "geometry", index: 1 });
    state = modelViewReducer(state, {
      type: "toggle",
      name: "wireframe",
      on: true,
    });
    state = modelViewReducer(state, { type: "toggle", name: "webp", on: true });
    state = modelViewReducer(state, {
      type: "toggle",
      name: "original",
      on: true,
    });
    state = modelViewReducer(state, {
      type: "loaded",
      stops: 3,
      geometry: 2,
      camera: MOVED,
    });
    expect(state).toEqual({
      stops: 3,
      geometry: 2,
      texture: 3,
      webp: true,
      positions8: false,
      original: false,
      wireframe: true,
      camera: MOVED,
    });
  });

  // Why this test matters: a stale index after a model with fewer stops,
  // or a slider that has nothing to move yet, must not leave the view
  // naming no variant; the state is returned unchanged instead.
  it("refuses an index out of range or not an integer, and a non-finite pose", () => {
    const state = loaded();
    for (const index of [-1, 7, 1.5, Number.NaN]) {
      expect(modelViewReducer(state, { type: "geometry", index })).toBe(state);
    }
    for (const index of [-1, TEXTURE_STEPS.length, 0.5]) {
      expect(modelViewReducer(state, { type: "texture", index })).toBe(state);
    }
    const bad: CameraPose = { position: [Number.NaN, 0, 0], target: [0, 0, 0] };
    expect(modelViewReducer(state, { type: "camera", camera: bad })).toBe(
      state,
    );
    for (const [stops, geometry] of [
      [0, 0],
      [3, 3],
      [3, -1],
    ] as const) {
      expect(
        modelViewReducer(state, {
          type: "loaded",
          stops,
          geometry,
          camera: POSE,
        }),
      ).toBe(state);
    }
    expect(
      modelViewReducer(INITIAL_MODEL_VIEW, { type: "geometry", index: 0 }),
    ).toBe(INITIAL_MODEL_VIEW);
  });

  // Why this test matters: the texture slider starts where the shelf
  // writes textures, so the page opens on what the editor ships; "original"
  // must be a limit no texture reaches, since the optimizer never enlarges.
  it("the texture steps run from 128 px up to the original, starting on the shelf's limit", () => {
    expect(TEXTURE_STEPS.map((s) => s.side)).toEqual([
      128, 256, 512, 1024, 2048, 16384,
    ]);
    expect(TEXTURE_STEPS[DEFAULT_TEXTURE_STEP]?.side).toBe(
      OPTIMIZER_SETTINGS.model.textureMaxSidePx,
    );
    expect(INITIAL_MODEL_VIEW.texture).toBe(DEFAULT_TEXTURE_STEP);
  });
});

describe("variantSettings", () => {
  const shares = [0.05, 0.12, 0.25, null, 0.5, 1];

  // Why this test matters: these settings are what the optimizer runs for
  // the shown variant, and the key is what the page caches it under; the
  // default stop must leave the shelf's own level choice alone (no
  // detailShare), and two different slider positions must never share one
  // cached model.
  it("maps the sliders and options to the optimizer's model settings", () => {
    const at = (patch: Partial<ModelViewState>): ModelViewState => ({
      ...INITIAL_MODEL_VIEW,
      stops: shares.length,
      geometry: 3,
      ...patch,
    });
    expect(variantSettings(at({}), shares)?.model).toEqual({
      textureMaxSidePx: 1024,
    });
    expect(
      variantSettings(at({ geometry: 2, texture: 5 }), shares)?.model,
    ).toEqual({ detailShare: 0.25, textureMaxSidePx: 16384 });
    expect(
      variantSettings(at({ webp: true, positions8: true }), shares)?.model,
    ).toEqual({
      textureMaxSidePx: 1024,
      textureType: "image/webp",
      positionBits: 8,
      maxPositionError: 0.01,
    });
    const keys = new Set<string>();
    for (let geometry = 0; geometry < shares.length; geometry++) {
      for (let texture = 0; texture < TEXTURE_STEPS.length; texture++) {
        keys.add(variantSettings(at({ geometry, texture }), shares)!.key);
      }
    }
    expect(keys.size).toBe(shares.length * TEXTURE_STEPS.length);
    // The original view and the wireframe look draw the same variant.
    expect(variantSettings(at({ original: true }), shares)?.key).toBe(
      variantSettings(at({ wireframe: true }), shares)?.key,
    );
  });

  it("is null before a model is loaded or when the stops do not match", () => {
    expect(variantSettings(INITIAL_MODEL_VIEW, [])).toBeNull();
    const state = { ...INITIAL_MODEL_VIEW, stops: 2, geometry: 0 };
    expect(variantSettings(state, [0.5, null, 1])).toBeNull();
  });
});

describe("framePose", () => {
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
