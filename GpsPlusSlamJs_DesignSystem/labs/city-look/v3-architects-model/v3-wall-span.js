/**
 * Where each wall vertex lies along its wall. The library gives every wall
 * quad its own four vertices, so a wall's length can travel with them.
 *
 * @see v3-wall-span.js.md
 */

/** A face steeper than this counts as a wall (|normal.y| below it). */
const WALL_NORMAL_Y = 0.05;

/**
 * `[metres along the wall, wall length]` per vertex as a flat `Float32Array`;
 * 0, 0 for every vertex that belongs to no wall. Runs of triangles on one
 * vertex overwrite each other, which is safe because a wall's two triangles
 * span the same edge. Assumes unshared wall vertices, as `extrude.ts` writes.
 */
export function wallSpans({ positions, normals, indices }) {
  const spans = new Float32Array((positions.length / 3) * 2);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    const nx = normals[corners[0] * 3];
    const ny = normals[corners[0] * 3 + 1];
    const nz = normals[corners[0] * 3 + 2];
    if (Math.abs(ny) > WALL_NORMAL_Y) continue;
    const length = Math.hypot(nx, nz);
    if (length === 0) continue;
    const along = corners.map(
      (v) => (positions[v * 3] * nz - positions[v * 3 + 2] * nx) / length,
    );
    const start = Math.min(...along);
    const span = Math.max(...along) - start;
    corners.forEach((v, i) => {
      spans[v * 2] = along[i] - start;
      spans[v * 2 + 1] = span;
    });
  }
  return spans;
}
