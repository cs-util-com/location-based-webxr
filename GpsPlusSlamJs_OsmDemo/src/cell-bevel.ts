/**
 * Faked bevel normals for the affordance cells (DEC-S2).
 *
 * WHY THIS EXISTS. The owner liked the shiny hexagon tiles in a prototype, and a
 * large part of that look is that its tiles are hexagonal PRISMS: the side faces
 * catch the light at a different angle from the top, so every tile has an edge
 * highlight. Ours are flat fans, and making them real prisms costs roughly three
 * times the vertices on up to 2 989 cells, rebuilt on every publish.
 *
 * So this lies instead. Each corner's normal leans outward from the cell's
 * centroid, and the fan interpolates between them — the tile shades as though
 * its rim were rolled off, and a specular highlight sweeps across it as the
 * camera orbits. Zero extra vertices; one extra attribute.
 *
 * WHY IT IS A LIE WORTH BOUNDING, and where the bound is. Every vertex of a cell
 * is a rim corner — the fan pivots on corner 0, there is no centre vertex — so
 * there is nothing holding the middle flat. If the outward leans did not cancel
 * around the ring, the hexagon would shade as a SLOPED tile, and in a view whose
 * job is showing scores on level ground that is a picture that lies about the
 * terrain. `cell-bevel.test.ts` asserts the cancellation directly; it is the
 * assertion to keep if any other is ever dropped.
 *
 * WHERE IT BREAKS DOWN, stated rather than discovered: at grazing angles, and at
 * arm's length in AR, a flat tile pretending to have a rolled edge reads as odd
 * shading rather than as an edge. That was accepted when DEC-S2 chose this over
 * real extrusion, and {@link BEVEL_STRENGTH} is the one number that walks it
 * back — set it to 0 and the surface is exactly the flat one it replaced.
 *
 * @see cell-bevel.ts.md
 */

/**
 * How far a corner's normal leans away from the cell centre, as a ratio of the
 * horizontal lean to the vertical.
 *
 * 0.45 is a shoulder rather than a wall: it puts the rim normal about 24° off
 * vertical, enough for the highlight to find an edge and not so much that a tile
 * reads as a cone. The unit tests pin it inside (0, 1) so a later "make it pop"
 * cannot quietly turn the grid into a field of spikes.
 */
export const BEVEL_STRENGTH = 0.45;

/** A corner of one cell, in the scene's coordinates. */
export interface BevelCorner {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Per-corner normals for ONE cell, as a flat `[x, y, z, ...]` list.
 *
 * HEIGHT IS DELIBERATELY IGNORED. Cells sit on terrain, so their corners are not
 * coplanar — but the ground plane underneath already shades that relief, and
 * letting the cell normals follow it too would apply the same terrain twice.
 * The lean is computed from the horizontal offset alone, which also makes the
 * result independent of how much relief a cell happens to straddle.
 */
export function bevelNormals(
  corners: readonly BevelCorner[],
  strength: number = BEVEL_STRENGTH,
): number[] {
  const normals: number[] = [];
  if (corners.length === 0) return normals;

  let cx = 0;
  let cz = 0;
  for (const corner of corners) {
    cx += corner.x;
    cz += corner.z;
  }
  cx /= corners.length;
  cz /= corners.length;

  for (const corner of corners) {
    const dx = corner.x - cx;
    const dz = corner.z - cz;
    const span = Math.hypot(dx, dz);
    if (span === 0 || strength === 0) {
      // A corner exactly on the centroid has no outward direction, and a zero
      // strength is the documented way back to the flat surface. Both are "up".
      normals.push(0, 1, 0);
      continue;
    }
    const nx = (dx / span) * strength;
    const nz = (dz / span) * strength;
    const length = Math.hypot(nx, 1, nz);
    normals.push(nx / length, 1 / length, nz / length);
  }
  return normals;
}
