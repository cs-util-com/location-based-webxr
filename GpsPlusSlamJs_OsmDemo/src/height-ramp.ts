/**
 * The terrain debug ramp: height in metres to a colour, per vertex.
 *
 * WHY THIS LAYER EXISTS (DEC-R2-25, plan item W24). DEC-R2-1 chose a reflective
 * near-neutral ground and explicitly rejected a hypsometric colour ramp — as the
 * PRIMARY look. The accepted consequence is that Cologne renders nearly flat,
 * which leaves `terrain ±N m` in the status line as the only thing distinguishing
 * "the DEM loaded and this place is flat" from "the DEM never arrived". DEC-R2-22
 * already had to widen that into two numbers to keep it honest. A toggleable ramp
 * answers the same question at a glance, and W10's layer registry means it is one
 * entry plus a material rather than a new mechanism.
 *
 * WHY THE RANGE IS THE DATA'S OWN. `geo-three`'s `HeightDebugProvider` normalises
 * by the theoretical maximum of the height encoding (`1667721.6`), so real terrain
 * occupies a sliver at the bottom of the ramp and the output is effectively
 * monochrome — which looks exactly like flat ground, i.e. it produces the very
 * answer the layer was added to rule out. The range here is computed from the
 * finite samples actually present.
 *
 * WHY IT IS PIXEL ARITHMETIC IN ITS OWN FILE, like `sky-gradient.ts`. A ramp can
 * be inverted, non-monotonic, or collapsed to one colour, and all three look
 * deliberate on screen rather than broken. None of them needs a GPU to detect.
 *
 * @see height-ramp.ts.md
 */

/** The finite extent of a height field, metres. */
export interface RampRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Magenta — deliberately outside the ramp, so a missing post cannot be mistaken
 * for a height. Every ramp colour below is blue/cyan/yellow/red, none of which
 * has this combination of full red and full blue with no green.
 */
export const NO_DATA_RGB: readonly [number, number, number] = [1, 0, 1];

/**
 * The ramp's stops, low to high.
 *
 * Chosen for MONOTONIC LUMINANCE rather than for prettiness: a ramp that dips in
 * the middle gives two different heights the same apparent brightness, and the
 * reader cannot tell which way the slope runs. Deep blue through cyan and amber
 * to near-white rises throughout, and the four hues make bands easy to count.
 *
 * The obvious choice — ending in RED, as `HeightDebugProvider` does — was written
 * first and the monotonicity test rejected it: red is DARKER than the yellow
 * before it (luma 0.39 against 0.86), so the top of the ramp doubled back and the
 * highest ground read as mid-height. Ending bright is what keeps it single-valued.
 */
const STOPS: readonly (readonly [number, number, number])[] = [
  [0.05, 0.05, 0.35],
  [0.1, 0.65, 0.75],
  [0.95, 0.75, 0.2],
  [1, 1, 0.9],
];

/**
 * The finite min and max of a height field, or `undefined` when it has no data.
 *
 * NOT `Math.min(...heights)`: that throws `RangeError` above roughly 100–125 k
 * arguments, and the ground lattice is already 16 641 posts with W23 removing the
 * cap that keeps it there. This repo has had to fix that exact call once already.
 *
 * Non-finite samples are SKIPPED rather than propagated. A single `NaN` in a
 * spread-based min/max makes both ends `NaN`, every later comparison against it
 * is false, and the whole ramp silently collapses to one colour — which is
 * indistinguishable from flat ground, the one thing this layer must never say by
 * accident.
 */
export function rampRange(heights: ArrayLike<number>): RampRange | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < heights.length; i += 1) {
    const height = heights[i];
    if (height === undefined || !Number.isFinite(height)) continue;
    if (height < min) min = height;
    if (height > max) max = height;
  }
  return min === Number.POSITIVE_INFINITY ? undefined : { min, max };
}

/**
 * The ramp colour at `t`, clamped to `[0, 1]`.
 *
 * Clamped rather than extrapolated: a channel outside the unit range wraps in the
 * shader instead of saturating, so a slightly out-of-range sample would render as
 * a hole of the opposite colour rather than as the ramp's end.
 */
export function rampColour(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const span = STOPS.length - 1;
  const scaled = clamped * span;
  const index = Math.min(span - 1, Math.floor(scaled));
  const local = scaled - index;
  const from = STOPS[index] ?? STOPS[0];
  const to = STOPS[index + 1] ?? STOPS[span];
  if (from === undefined || to === undefined) return [0, 0, 0];
  return [
    from[0] + (to[0] - from[0]) * local,
    from[1] + (to[1] - from[1]) * local,
    from[2] + (to[2] - from[2]) * local,
  ];
}

/**
 * One RGB triple per height, ready for a `color` buffer attribute.
 *
 * A flat field (`min === max`) maps entirely to the ramp's floor. The naive
 * normalisation is `0 / 0 = NaN` in every channel, and a `NaN` vertex colour
 * renders as black or as driver-dependent garbage — a rendering artefact that
 * reads as a bug in the terrain rather than as "this ground is flat".
 */
export function heightRampColours(heights: ArrayLike<number>): Float32Array {
  const colours = new Float32Array(heights.length * 3);
  const range = rampRange(heights);
  const span = range === undefined ? 0 : range.max - range.min;
  for (let i = 0; i < heights.length; i += 1) {
    const height = heights[i];
    const [r, g, b] =
      range === undefined || height === undefined || !Number.isFinite(height)
        ? NO_DATA_RGB
        : rampColour(span === 0 ? 0 : (height - range.min) / span);
    colours[i * 3] = r;
    colours[i * 3 + 1] = g;
    colours[i * 3 + 2] = b;
  }
  return colours;
}
