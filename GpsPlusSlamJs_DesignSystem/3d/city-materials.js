/**
 * The dense city's varied materials (round-3 plan 2026-09-27-0532,
 * DEC-FB3-3): which catalog entries a building may wear, which N of them the
 * city uses, and how the lots split into one instanced mesh per material.
 * Pure (no three), so `node --test` runs it; the page builds the materials
 * and `stand-in-scene.js` the meshes.
 *
 * @see city-materials.js.md
 */

/**
 * The catalog categories a building may wear: physically based only. An
 * unlit, toon or classic city is not the question the switch answers (does
 * a mix of matte and shiny cost more?).
 */
export const CITY_POOL_CATEGORIES = ["standard", "physical"];
/** The material classes of those categories. */
const POOL_TYPES = ["MeshStandardMaterial", "MeshPhysicalMaterial"];

/** The material counts the cost sweep covers (plan §6). */
export const CITY_MATERIAL_COUNTS = [4, 8, 12];
/** The page's default count. */
export const DEFAULT_CITY_MATERIALS = 12;

/**
 * The owner's A/B (DEC-FB3-3): every city material at one roughness, the
 * rest (colour, metalness) as the entry has it. `mixed` leaves each entry's
 * own roughness.
 */
export const CITY_FINISHES = { mixed: null, shiny: 0, matte: 1 };

/**
 * The entries a building may wear, in catalog order: the pool categories'
 * entries that name a standard or physical material (a custom shader, an
 * entry with `make`, is left out: it is a look, not a building material).
 */
export function cityMaterialPool(catalog) {
  if (!Array.isArray(catalog)) throw new TypeError("catalog must be an array");
  return catalog.filter(
    (e) =>
      CITY_POOL_CATEGORIES.includes(e?.category) &&
      e.make === undefined &&
      POOL_TYPES.includes(e.material?.type),
  );
}

/**
 * `n` entries spread evenly over the pool (the middle of each of n equal
 * spans), so every count mixes families and roughnesses rather than taking
 * the first n (which would be one hue from mirror to matte).
 *
 * @throws RangeError for an `n` that is not an integer in 1..pool.length.
 */
export function pickCityMaterials(pool, n) {
  if (!(Number.isInteger(n) && n >= 1 && n <= pool.length)) {
    throw new RangeError(
      `the material count must be an integer in 1..${pool.length}, got ${n}`,
    );
  }
  return Array.from(
    { length: n },
    (_, k) => pool[Math.floor(((k + 0.5) * pool.length) / n)],
  );
}

/**
 * The lots split by group: for each group, the ascending indices of its
 * lots in the radius-ordered lot list. A mesh draws the first
 * `countBelow(ranks, n)` of its instances to show the nearest n lots.
 *
 * @throws RangeError for a group index outside 0..groupCount-1.
 */
export function groupRanks(groupOfLot, groupCount) {
  const sizes = new Array(groupCount).fill(0);
  for (const g of groupOfLot) {
    if (!(Number.isInteger(g) && g >= 0 && g < groupCount)) {
      throw new RangeError(`group ${g} outside 0..${groupCount - 1}`);
    }
    sizes[g] += 1;
  }
  const ranks = sizes.map((size) => new Int32Array(size));
  const filled = new Array(groupCount).fill(0);
  groupOfLot.forEach((g, i) => {
    ranks[g][filled[g]++] = i;
  });
  return ranks;
}

/** How many entries of an ascending array are below `n` (a binary search). */
export function countBelow(sorted, n) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < n) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
