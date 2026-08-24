/**
 * A stable per-feature random for the AR shell shader's phase offset.
 *
 * **WHY NOT AN INDEX.** The obvious source is the feature's position in the
 * batch, and it is wrong: the batch is rebuilt whenever a tile lands or the
 * position changes, and the order is not stable across those rebuilds. An
 * index-derived phase would therefore re-shuffle mid-session and the whole city
 * would visibly re-randomise its breathing every refresh — a change nobody
 * asked for, arriving at an arbitrary moment.
 *
 * **WHY THE FIRST VERTEX.** Geometry is the one thing about a building that does
 * not change between rebuilds, so hashing it gives the same value every time for
 * the same building and different values for buildings in different places. It
 * needs no feature key, which matters because the drawn set mixes buildings and
 * barriers and only some of them carry one.
 *
 * @see shell-rand.ts.md
 */

/** The shape this needs — structurally, so nothing is imported for it. */
interface HasPositions {
  readonly positions: Float32Array;
}

/**
 * A deterministic value in `[0, 1)` for a mesh.
 *
 * Empty geometry yields `0`: it produces no triangles and is dropped before it
 * can reach a chunk, so the value is never read — but returning `NaN` from a
 * function that feeds a vertex attribute would take a whole draw call with it.
 */
export function shellRandFor(mesh: HasPositions): number {
  const p = mesh.positions;
  if (p.length < 3) return 0;
  // A small integer hash over the first vertex, scaled so sub-metre differences
  // still separate: raw metres would give neighbouring buildings near-identical
  // phases, which is the lockstep this exists to avoid.
  const x = Math.round(p[0]! * 100);
  const y = Math.round(p[1]! * 100);
  const z = Math.round(p[2]! * 100);
  let h = (x * 73_856_093) ^ (y * 19_349_663) ^ (z * 83_492_791);
  // Final avalanche, so nearby inputs do not produce nearby outputs.
  h = Math.imul(h ^ (h >>> 16), 2_246_822_507);
  h = Math.imul(h ^ (h >>> 13), 3_266_489_909);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4_294_967_296;
}
