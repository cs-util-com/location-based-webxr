/**
 * The 3D model comparison view's state on the asset optimizer check page
 * (`asset-optimizer-check.html`): which model is shown (the original or
 * one variant), whether the wireframe look is on, and where the camera
 * is. A pure reducer, so the view's two promises are tested without a
 * browser: switching the model never moves the camera, and the wireframe
 * look stays on across switches.
 *
 * @see model-compare-view.ts.md
 */

/** A point as [x, y, z]. */
export type Vec3 = readonly [number, number, number];

/** Where the camera is and what it looks at. */
export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

export interface ModelViewState {
  /** How many models can be shown: the original (0) and its variants. */
  readonly count: number;
  /** The shown model: 0 is the original, 1.. the variants in order. */
  readonly shown: number;
  /** Triangles drawn as a wireframe over flat grey, textures off. */
  readonly wireframe: boolean;
  /** Null until the first model is framed. */
  readonly camera: CameraPose | null;
}

export type ModelViewAction =
  /** A new set of models (a new source): the original shown, the camera
   *  framed anew; the wireframe look stays as the viewer left it. */
  | {
      readonly type: "loaded";
      readonly count: number;
      readonly camera: CameraPose;
    }
  | { readonly type: "show"; readonly index: number }
  | { readonly type: "wireframe"; readonly on: boolean }
  /** The viewer orbited or zoomed. */
  | { readonly type: "camera"; readonly camera: CameraPose };

export const INITIAL_MODEL_VIEW: ModelViewState = {
  count: 0,
  shown: 0,
  wireframe: false,
  camera: null,
};

const finitePose = (pose: CameraPose): boolean =>
  [...pose.position, ...pose.target].every(Number.isFinite);

/**
 * The next state. An action that does not apply (an index out of range
 * or not an integer, a count under 1, a pose with a non-finite number)
 * returns `state` itself, unchanged.
 */
export function modelViewReducer(
  state: ModelViewState,
  action: ModelViewAction,
): ModelViewState {
  switch (action.type) {
    case "loaded":
      if (!Number.isInteger(action.count) || action.count < 1) return state;
      if (!finitePose(action.camera)) return state;
      return { ...state, count: action.count, shown: 0, camera: action.camera };
    case "show":
      if (!Number.isInteger(action.index)) return state;
      if (action.index < 0 || action.index >= state.count) return state;
      if (action.index === state.shown) return state;
      return { ...state, shown: action.index };
    case "wireframe":
      return action.on === state.wireframe
        ? state
        : { ...state, wireframe: action.on };
    case "camera":
      return finitePose(action.camera)
        ? { ...state, camera: action.camera }
        : state;
  }
}

/**
 * A camera framing a model's box (`min`, `max` corners): looking at its
 * centre from above and to the side, at 2.6 times the half diagonal, so
 * the whole model is in view with a 40 degree field of view. Throws on a
 * box that is empty or not finite.
 */
export function framePose(min: Vec3, max: Vec3): CameraPose {
  if (![...min, ...max].every(Number.isFinite)) {
    throw new Error("the model's box is not finite");
  }
  const size = max.map((v, i) => v - min[i]!);
  const radius = Math.hypot(...size) / 2;
  if (!(radius > 0) || size.some((s) => s < 0)) {
    throw new Error("the model's box is empty");
  }
  const target = min.map((v, i) => (v + max[i]!) / 2) as unknown as Vec3;
  const away = [1, 0.7, 1.2];
  const length = Math.hypot(...away);
  const position = target.map(
    (v, i) => v + (away[i]! / length) * radius * 2.6,
  ) as unknown as Vec3;
  return { position, target };
}
