/**
 * Test-only: `quadOfClipInto` into fresh pairs, or null, the readable form
 * the travelling box's tests compare against.
 */
import { quadOfClipInto } from "../travelling-box-rules.js";

export function quadOfClip(
  clip: ArrayLike<number>,
  viewW: number,
  viewH: number,
): [number, number][] | null {
  const out: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  return quadOfClipInto(clip, viewW, viewH, out) ? out : null;
}
