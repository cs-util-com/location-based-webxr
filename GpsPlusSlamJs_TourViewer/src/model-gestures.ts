/**
 * What a visitor's touch does to a 3D model in AR, and the toy's limits.
 *
 * The rule: a TAP opens a note (on its marker) or the model's sheet (on
 * the model); a PINCH and a DRAG act only on a model in the `toy` view,
 * and only while its sheet is open (the visitor tapped it, so the toy in
 * hand is never a guess). In every other view a pinch or a drag does
 * nothing, so walking around a model never moves it by accident.
 *
 * A toy starts at its real size at its pose. A pinch scales it between
 * 0.1x and 3x of that size, and never beyond 50 m (its largest side); a
 * drag moves it over the ground. Both are a visitor's own play: nothing is
 * saved, and "Back to its place" restores the tour's pose and size.
 *
 * Pure.
 *
 * @see model-gestures.ts.md
 */

import type { TourModelWorldView } from "gps-plus-slam-app-framework/ar/tour-manifest";

/** A touch the visitor made, as the overlay recognised it. */
export type ModelGesture = "tap" | "pinch" | "drag";

/** What a gesture does to a model. */
export type ModelGestureAction = "open" | "scale" | "move" | "none";

/** The smallest toy factor (of the model's real size). */
export const TOY_MIN_FACTOR = 0.1;
/** The largest toy factor (of the model's real size). */
export const TOY_MAX_FACTOR = 3;
/** The largest a toy may grow: its largest side, in metres. */
export const TOY_MAX_SIZE_M = 50;

/**
 * What `gesture` does to a model shown in `view`: a tap opens (a note or
 * the sheet), a pinch scales and a drag moves only a toy that is `held`
 * (its sheet open); anything else does nothing.
 */
export function modelGestureAction(
  view: TourModelWorldView,
  gesture: ModelGesture,
  held: boolean,
): ModelGestureAction {
  if (gesture === "tap") return "open";
  if (view !== "toy" || !held) return "none";
  return gesture === "pinch" ? "scale" : "move";
}

/** The factors a toy of `sizeM` may take: `[0.1, 3]`, the top lowered so
 *  that its largest side stays within 50 m (and never below the bottom).
 *  RangeError for a size that is not finite and > 0. */
export function toyFactorRange(sizeM: number): {
  readonly min: number;
  readonly max: number;
} {
  if (!(Number.isFinite(sizeM) && sizeM > 0)) {
    throw new RangeError(`a toy's size must be finite and > 0, got ${sizeM}`);
  }
  const max = Math.min(TOY_MAX_FACTOR, TOY_MAX_SIZE_M / sizeM);
  return { min: TOY_MIN_FACTOR, max: Math.max(TOY_MIN_FACTOR, max) };
}

/** The factor a toy starts with: its real size, unless that is beyond
 *  50 m (a tour may place a larger model; as a toy it is held at 50 m). */
export function toyStartFactor(sizeM: number): number {
  return Math.min(1, toyFactorRange(sizeM).max);
}

/**
 * The factor after a pinch whose fingers' distance went from `fromPx` to
 * `toPx`: the factor times their ratio, held within `toyFactorRange`. A
 * pinch with a distance that is not finite and > 0 changes nothing.
 */
export function pinchedToyFactor(
  factor: number,
  fromPx: number,
  toPx: number,
  sizeM: number,
): number {
  const range = toyFactorRange(sizeM);
  const held = Math.min(range.max, Math.max(range.min, factor));
  if (!(fromPx > 0 && toPx > 0 && Number.isFinite(fromPx / toPx))) {
    return held;
  }
  return Math.min(range.max, Math.max(range.min, (held * toPx) / fromPx));
}

/**
 * How far a drag of `dxPx`, `dyPx` on a screen `heightPx` tall moves a toy
 * `distanceM` away, over the ground: right on the screen is the camera's
 * right, up on the screen is away from the camera. `fovYRad` is the
 * camera's vertical field of view, `yawRad` its heading (0 looks along
 * -z, positive turns left, three's convention). The scale is the metres
 * one pixel spans at the toy's distance, so the toy follows the finger.
 * Returns `[dx, dz]` in the frame the yaw is measured in; zero for any
 * input that is not finite or a screen or distance that is not > 0.
 */
export function toyDragMetres(input: {
  readonly dxPx: number;
  readonly dyPx: number;
  readonly heightPx: number;
  readonly distanceM: number;
  readonly fovYRad: number;
  readonly yawRad: number;
}): readonly [number, number] {
  const { dxPx, dyPx, heightPx, distanceM, fovYRad, yawRad } = input;
  const values = [dxPx, dyPx, heightPx, distanceM, fovYRad, yawRad];
  if (!values.every(Number.isFinite) || heightPx <= 0 || distanceM <= 0) {
    return [0, 0];
  }
  if (!(fovYRad > 0 && fovYRad < Math.PI)) return [0, 0];
  const metresPerPx = (2 * distanceM * Math.tan(fovYRad / 2)) / heightPx;
  const right = dxPx * metresPerPx;
  const away = -dyPx * metresPerPx;
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  // The camera's right is (cos, -sin) and its forward (-sin, -cos) in x, z.
  return [right * c - away * s, -right * s - away * c];
}
