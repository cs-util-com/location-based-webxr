/**
 * The 3D model comparison view's state on the asset optimizer check page
 * (`asset-optimizer-check.html`): where its two sliders stand (geometry:
 * the triangles kept near; texture: the largest texture side), its
 * options (WebP textures, 8-bit vertex positions, showing the original),
 * whether the wireframe look is on, where the camera is, the loaded
 * model's geometry stops and which variant is drawn. A pure
 * reducer, so the view's promises are tested without a browser: no slider
 * or checkbox ever moves the camera, and the wireframe look stays on
 * across every change.
 *
 * @see model-compare-view.ts.md
 */
import type { ModelSettings } from "../editor/asset-shelf/optimizer-settings.js";
import { OPTIMIZER_SETTINGS } from "../editor/asset-shelf/optimizer-settings.js";

/** A point as [x, y, z]. */
export type Vec3 = readonly [number, number, number];

/** Where the camera is and what it looks at. */
export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

/** The texture slider's steps, left to right, so right means more, as
 *  on the geometry slider. "Original" is a limit no texture reaches (the
 *  optimizer never enlarges), so it keeps each texture's own size. */
export const TEXTURE_STEPS: readonly {
  readonly label: string;
  readonly side: number;
}[] = [
  { label: "128 px", side: 128 },
  { label: "256 px", side: 256 },
  { label: "512 px", side: 512 },
  { label: "1024 px", side: 1024 },
  { label: "2048 px", side: 2048 },
  { label: "original size", side: 16384 },
];

/** The step the shelf writes textures at. */
export const DEFAULT_TEXTURE_STEP = Math.max(
  0,
  TEXTURE_STEPS.findIndex(
    (s) => s.side === OPTIMIZER_SETTINGS.model.textureMaxSidePx,
  ),
);

/** One stop of the geometry slider: the level's share of the triangles
 *  (null: the default level, chosen by the optimizer's budget), its
 *  triangles and its deviation in metres. */
export interface GeometryStop {
  readonly share: number | null;
  readonly triangles: number;
  readonly deviation: number;
}

export interface ModelViewState {
  /** The geometry slider's stops, fewest triangles first (none until a
   *  model is loaded). */
  readonly stops: readonly GeometryStop[];
  /** The loaded model's triangles and size (its box diagonal, metres),
   *  which the geometry readout measures against. */
  readonly trianglesBefore: number;
  readonly size: number;
  /** The geometry stop, fewest triangles first. */
  readonly geometry: number;
  /** The texture step, an index into `TEXTURE_STEPS`. */
  readonly texture: number;
  /** Lossy textures as WebP in place of JPEG. */
  readonly webp: boolean;
  /** Vertex positions at 8 bits with a 1 % error budget, not 16. */
  readonly positions8: boolean;
  /** The original file shown in place of the variant. */
  readonly original: boolean;
  /** Triangles drawn as a wireframe over flat grey, textures off. */
  readonly wireframe: boolean;
  /** Null until the first model is framed. */
  readonly camera: CameraPose | null;
  /** The variant drawn: "original", a `variantSettings` key, or null
   *  before a model is shown. While the asked variant is made, the one
   *  before stays drawn, so this can differ from the asked key. */
  readonly shownKey: string | null;
}

type ModelViewToggle = "webp" | "positions8" | "original" | "wireframe";

export type ModelViewAction =
  /** A new model: its geometry stops, the default level's stop, its
   *  triangles and size, the camera framed anew, and the variant drawn
   *  first; the variant shown, not the original. */
  | {
      readonly type: "loaded";
      readonly stops: readonly GeometryStop[];
      readonly geometry: number;
      readonly trianglesBefore: number;
      readonly size: number;
      readonly camera: CameraPose;
      readonly shownKey: string;
    }
  | { readonly type: "geometry"; readonly index: number }
  | { readonly type: "texture"; readonly index: number }
  | {
      readonly type: "toggle";
      readonly name: ModelViewToggle;
      readonly on: boolean;
    }
  /** The viewer orbited or zoomed. */
  | { readonly type: "camera"; readonly camera: CameraPose }
  /** The page swapped in another variant (or the original). */
  | { readonly type: "shown"; readonly key: string };

export const INITIAL_MODEL_VIEW: ModelViewState = {
  stops: [],
  trianglesBefore: 0,
  size: 0,
  geometry: 0,
  texture: DEFAULT_TEXTURE_STEP,
  webp: false,
  positions8: false,
  original: false,
  wireframe: false,
  camera: null,
  shownKey: null,
};

const finitePose = (pose: CameraPose): boolean =>
  [...pose.position, ...pose.target].every(Number.isFinite);

const inRange = (index: number, count: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < count;

const nonNegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const validStop = (stop: GeometryStop): boolean =>
  (stop.share === null || (stop.share > 0 && stop.share <= 1)) &&
  nonNegative(stop.triangles) &&
  nonNegative(stop.deviation);

/**
 * The next state. An action that does not apply (an index out of range
 * or not an integer, no stops or a stop with a share outside (0, 1] or a
 * negative or non-finite count, a pose with a non-finite number, an
 * empty key) returns `state` itself, unchanged.
 */
export function modelViewReducer(
  state: ModelViewState,
  action: ModelViewAction,
): ModelViewState {
  switch (action.type) {
    case "loaded":
      if (!inRange(action.geometry, action.stops.length)) return state;
      if (!action.stops.every(validStop)) return state;
      if (!nonNegative(action.trianglesBefore) || !nonNegative(action.size)) {
        return state;
      }
      if (!finitePose(action.camera) || action.shownKey === "") return state;
      return {
        ...state,
        stops: action.stops,
        geometry: action.geometry,
        trianglesBefore: action.trianglesBefore,
        size: action.size,
        original: false,
        camera: action.camera,
        shownKey: action.shownKey,
      };
    case "geometry":
      if (!inRange(action.index, state.stops.length)) return state;
      return action.index === state.geometry
        ? state
        : { ...state, geometry: action.index };
    case "texture":
      if (!inRange(action.index, TEXTURE_STEPS.length)) return state;
      return action.index === state.texture
        ? state
        : { ...state, texture: action.index };
    case "toggle":
      return state[action.name] === action.on
        ? state
        : { ...state, [action.name]: action.on };
    case "camera":
      return finitePose(action.camera)
        ? { ...state, camera: action.camera }
        : state;
    case "shown":
      return action.key === "" || action.key === state.shownKey
        ? state
        : { ...state, shownKey: action.key };
  }
}

/** The 8-bit position option's error budget, as a share of the size. */
const POSITION8_ERROR = 0.01;

/**
 * The optimizer settings of the variant the sliders and options name,
 * and the key the page caches its result under. The geometry stop's
 * share is the level kept near; the default stop (share null) leaves the
 * level to the optimizer's budget. Null before a model is loaded.
 * Showing the original and the wireframe look change what is drawn, not
 * the variant.
 */
export function variantSettings(
  state: ModelViewState,
): { readonly key: string; readonly model: Partial<ModelSettings> } | null {
  const stop = state.stops[state.geometry];
  const step = TEXTURE_STEPS[state.texture];
  if (stop === undefined || step === undefined) return null;
  const model: Partial<ModelSettings> = {
    ...(stop.share === null ? {} : { detailShare: stop.share }),
    textureMaxSidePx: step.side,
    ...(state.webp ? { textureType: "image/webp" as const } : {}),
    ...(state.positions8
      ? { positionBits: 8, maxPositionError: POSITION8_ERROR }
      : {}),
  };
  return { key: JSON.stringify(model), model };
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
