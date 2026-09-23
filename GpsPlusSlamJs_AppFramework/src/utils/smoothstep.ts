/**
 * The package's one three-argument smoothstep: GLSL's built-in `smoothstep`
 * (clamped Hermite), mirrored exactly for the TS twins of shaders.
 *
 * WHY IT IS SHARED. It was a private copy in `visualization/occlusion-mesh.ts`
 * until the atmosphere code needed the same curve twice (haze boundary, cloud
 * density), and DEC-H3 allows a one-liner once per package, not once per file.
 *
 * DELIBERATELY NOT THE SAME FUNCTION as the one-argument `smoothstep(t)` in
 * `GpsPlusSlamJs_OsmDemo/src/easing.ts` and `GpsPlusSlamJs_Landing`: that is
 * an easing curve on [0, 1]; this takes two edges and clamps, because its job
 * is to match the shader beside it line for line. The duplicate-helper guard's
 * exemption for the name carries the same reason.
 *
 * @see smoothstep.ts.md
 */

/** GLSL `smoothstep(edge0, edge1, x)`: 0 at/below edge0, 1 at/above edge1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
