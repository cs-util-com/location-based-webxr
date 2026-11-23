/**
 * The synthetic rotation pairs' frames: a photo cut to its centre square
 * and turned clockwise by an exact quarter or half turn (a pixel copy, no
 * resampling). A square is never turned again by the XFeat input rule
 * (`quarterTurnFits` is false for it), so every method sees the same turn.
 *
 * @see rotation-square.ts.md
 */
import { turnQuarter, type Frame } from "./bench-image";
import type { DerivedPair } from "./scenes";

export type TurnDegrees = 0 | 90 | 180;

/**
 * The clockwise turn of B in a synthetic rotation pair, in degrees; null
 * for a real pair (two photos, measured as taken).
 */
export function turnOf(kind: DerivedPair["kind"]): TurnDegrees | null {
  switch (kind) {
    case "turn0":
      return 0;
    case "turn90":
      return 90;
    case "turn180":
      return 180;
    default:
      return null;
  }
}

/** The square cut from a frame, in that frame's pixels. */
export interface SquareCrop {
  readonly x: number;
  readonly y: number;
  readonly side: number;
}

/** The centre square of a `width` x `height` frame: side = the short edge. */
export function centreCrop(width: number, height: number): SquareCrop {
  if (
    !(Number.isInteger(width) && Number.isInteger(height)) ||
    width < 1 ||
    height < 1
  ) {
    throw new RangeError(
      `frame size must be positive integers, got ${String(width)}x${String(height)}`,
    );
  }
  const side = Math.min(width, height);
  return {
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    side,
  };
}

/**
 * `frame` cut to its centre square and turned `degrees` clockwise: pixel
 * (x, y) of the n x n square lands at (n-1-y, x) per quarter turn.
 *
 * @throws RangeError on an empty frame, an RGBA length that does not match
 *   the size, or a turn that is not 0, 90 or 180.
 */
export function rotationSquare(
  frame: Frame,
  degrees: TurnDegrees,
): { readonly frame: Frame; readonly crop: SquareCrop } {
  if (degrees !== 0 && degrees !== 90 && degrees !== 180) {
    throw new RangeError(`turn must be 0, 90 or 180, got ${String(degrees)}`);
  }
  const crop = centreCrop(frame.width, frame.height);
  if (frame.rgba.length !== frame.width * frame.height * 4) {
    throw new RangeError("rgba length does not match the frame size");
  }
  const { x, y, side } = crop;
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let row = 0; row < side; row++) {
    const from = ((y + row) * frame.width + x) * 4;
    rgba.set(frame.rgba.subarray(from, from + side * 4), row * side * 4);
  }
  let out: Frame = { width: side, height: side, rgba };
  for (let q = 0; q < degrees / 90; q++) out = turnQuarter(out);
  return { frame: out, crop };
}
