/**
 * The vertical walls of one ring between two heights.
 *
 * Its own module because two builders need exactly the same strip: the
 * building's walls (`extrude.ts`, ground to eaves) and the full-height prism
 * a ridged roof falls back to (`roof.ts`, eaves to the tagged top). Two copies
 * of the winding rule below would be two places to get it wrong.
 *
 * @see walls.ts.md
 */

import type { EnuPoint } from "./enu.js";
import { isCounterClockwise } from "./enu.js";
import type { MeshBuilder } from "./mesh-data.js";
import { dropClosingPoint } from "./triangulate.js";

/**
 * Adds the quad strip for one ring between `bottomM` and `topM`.
 *
 * `outward` is true for an outer ring and false for a hole, whose walls face
 * into the courtyard. Nothing is added when `topM <= bottomM` or the ring has
 * fewer than three corners; a repeated corner (a zero-length wall) is skipped.
 */
export function addWalls(
  builder: MeshBuilder,
  ring: readonly EnuPoint[],
  bottomM: number,
  topM: number,
  outward: boolean,
): void {
  if (topM <= bottomM) return;

  const points = dropClosingPoint(ring);
  if (points.length < 3) return;

  // Normalise winding so the emitted quads face consistently, then flip for
  // holes. Real OSM rings arrive both ways round.
  const ccw = isCounterClockwise(points);
  const ordered = ccw === outward ? points : [...points].reverse();

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    if (a === undefined || b === undefined) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue; // repeated node: a zero-area wall
    // Outward normal of a CCW ring is (dy, -dx) normalised, with Y up in 3D.
    const nx = dy / length;
    const nz = -dx / length;

    const i0 = builder.vertex(a.x, bottomM, a.y, nx, 0, nz);
    const i1 = builder.vertex(b.x, bottomM, b.y, nx, 0, nz);
    const i2 = builder.vertex(b.x, topM, b.y, nx, 0, nz);
    const i3 = builder.vertex(a.x, topM, a.y, nx, 0, nz);
    // REVERSED, for the same reason `addCap` reverses: everything in this file
    // works in the ENU frame — a counter-clockwise ring in (east, north) reads
    // as clockwise once Y is up — so the straightforward (i0, i1, i2) would
    // wind these quads INWARD while the normal above points outward, leaving
    // the wall lit correctly and culled backwards. `side: DoubleSide` in the
    // demo hides that, which is exactly why it needs a test rather than a look.
    //
    // This is NOT the ENU→render reflection; `MeshBuilder` owns that and
    // applies it to every vertex and every triangle centrally. This ordering is
    // about the ring's own winding and would be needed either way.
    builder.triangle(i0, i2, i1);
    builder.triangle(i0, i3, i2);
  }
}
