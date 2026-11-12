/**
 * The sounds' warm glow: the one palette every mark of a sound in the
 * world draws with, so an ambient zone's glow, its range ring and a
 * narration circle's plume read as one family. Linear RGB triples in
 * 0..1, as a shader takes them.
 *
 * @see warm-glow.ts.md
 */

/** One colour as a shader's `vec3`. */
export type Rgb = readonly [number, number, number];

export const WARM_GLOW = Object.freeze({
  /** An ambient zone's ground glow, and a narration plume's motes. */
  glow: Object.freeze([1.0, 0.82, 0.45]) as Rgb,
  /** A zone's range ring in the editor, and a narration circle's rim. */
  rim: Object.freeze([1.0, 0.75, 0.32]) as Rgb,
  /** The hot centre of a mote. */
  spark: Object.freeze([1.0, 0.96, 0.86]) as Rgb,
  /** The dark edge that keeps a rim legible on a bright ground. */
  ink: Object.freeze([0.078, 0.086, 0.11]) as Rgb,
});
