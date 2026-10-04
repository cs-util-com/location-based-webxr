/**
 * The light dialog's two readouts, from an RGBA frame (plan
 * 2026-09-24-2140, DEC-LIGHT-3): the brightness of the lit surfaces and the
 * frame's mean chroma, whose difference with and without the heat grid is
 * the DEC-R4-5 margin. The same measures as the e2e sweep's inline
 * `litSurfaceLuma` and `meanChroma` (`playwright-tests/scene-3d.spec.js`),
 * which stay as the independent reference; a parity e2e holds the two
 * together (plan §7 item 4).
 *
 * @see light-readouts.ts.md
 */

/** Chroma below which a warm pixel counts as a lit neutral surface. */
const LIT_SURFACE_MAX_CHROMA = 60;

/**
 * Mean Rec. 709 luma of the warm, low-saturation pixels (r ≥ b, chroma below
 * 60): the lit buildings and roads. NaN when the frame has none.
 *
 * @throws RangeError when the buffer is not a whole number of RGBA pixels.
 */
export function litSurfaceLuma(rgba: Uint8Array | Uint8ClampedArray): number {
  checkRgba(rgba);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    if (
      r >= b &&
      Math.max(r, g, b) - Math.min(r, g, b) < LIT_SURFACE_MAX_CHROMA
    ) {
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
    }
  }
  return count === 0 ? Number.NaN : sum / count;
}

/**
 * Mean absolute chroma (max − min channel) over every pixel. NaN for an
 * empty frame.
 *
 * @throws RangeError when the buffer is not a whole number of RGBA pixels.
 */
export function meanChroma(rgba: Uint8Array | Uint8ClampedArray): number {
  checkRgba(rgba);
  if (rgba.length === 0) return Number.NaN;
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    sum += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return sum / (rgba.length / 4);
}

function checkRgba(rgba: Uint8Array | Uint8ClampedArray): void {
  if (rgba.length % 4 !== 0) {
    throw new RangeError(
      `an RGBA frame needs a multiple of 4 bytes, got ${rgba.length}`,
    );
  }
}
