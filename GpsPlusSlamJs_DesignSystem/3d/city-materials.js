/**
 * The dense city's varied materials (round-3 plan 2026-09-27-0532,
 * DEC-FB3-3): which catalog entries a building may wear, which N of them the
 * city uses, which lot wears which, and how the lots split into one
 * instanced mesh per material. Also the lots' fixed hash, which the stand-in
 * scene draws every "random" choice from (here because this module is
 * three-free, so `node --test` can check the streams). Pure; the page builds
 * the materials and `stand-in-scene.js` the meshes.
 *
 * @see city-materials.js.md
 */

/**
 * The catalog categories a building may wear: physically based only. An
 * unlit, toon or classic city is not the question the switch answers (does
 * a mix of matte and shiny cost more?). The catalog has no "physical"
 * entry yet, so today the pool is the standard entries.
 */
export const CITY_POOL_CATEGORIES = ["standard", "physical"];
/**
 * Entries left out although their category qualifies: the old white and
 * gold ramp (catalog/ramp.js) is a sky-judging reference, and its gold
 * nearly duplicates the standard gold (round-3 review, finding 5).
 */
const POOL_EXCLUDED_IDS = /^ramp-/;
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
 * entry with `make`, is left out: it is a look, not a building material),
 * without the old ramp row.
 */
export function cityMaterialPool(catalog) {
  if (!Array.isArray(catalog)) throw new TypeError("catalog must be an array");
  return catalog.filter(
    (e) =>
      CITY_POOL_CATEGORIES.includes(e?.category) &&
      !POOL_EXCLUDED_IDS.test(e.id ?? "") &&
      e.make === undefined &&
      POOL_TYPES.includes(e.material?.type),
  );
}

const roughnessOf = (e) => e.material.params.roughness ?? 1;
const isMetal = (e) => (e.material.params.metalness ?? 0) >= 0.5;

/**
 * `count` entries of one kind: the i-th cycles through the kind's colour
 * families (in pool order) and takes the unused entry nearest a roughness
 * target spread evenly from 0 to 1, so every count mixes hues and mirror
 * with matte. Ties go to the earlier entry.
 */
function spread(entries, count) {
  const families = [];
  for (const e of entries) {
    const colour = e.material.params.color;
    let family = families.find((f) => f.colour === colour);
    if (!family) families.push((family = { colour, entries: [] }));
    family.entries.push(e);
  }
  const used = new Set();
  const picks = [];
  for (let i = 0; i < count; i++) {
    const target = count > 1 ? i / (count - 1) : 0.5;
    const family = families[i % families.length].entries.filter(
      (e) => !used.has(e),
    );
    const candidates = family.length
      ? family
      : entries.filter((e) => !used.has(e));
    let best = candidates[0];
    for (const e of candidates) {
      if (
        Math.abs(roughnessOf(e) - target) < Math.abs(roughnessOf(best) - target)
      ) {
        best = e;
      }
    }
    used.add(best);
    picks.push(best);
  }
  return picks;
}

/**
 * `n` distinct entries: half dielectric and half metal while the pool has
 * both (a city is mostly paint and plaster; the pool is three quarters
 * metal, round-3 review finding 5), each half cycling its colour families
 * with roughness spread from mirror to matte. Dielectrics first.
 *
 * @throws RangeError for an `n` that is not an integer in 1..pool.length.
 */
export function pickCityMaterials(pool, n) {
  if (!(Number.isInteger(n) && n >= 1 && n <= pool.length)) {
    throw new RangeError(
      `the material count must be an integer in 1..${pool.length}, got ${n}`,
    );
  }
  const dielectrics = pool.filter((e) => !isMetal(e));
  const metals = pool.filter(isMetal);
  const wanted = Math.ceil(n / 2);
  const nDielectric = Math.max(
    n - metals.length,
    Math.min(wanted, dielectrics.length),
  );
  return [
    ...spread(dielectrics, nDielectric),
    ...spread(metals, n - nDielectric),
  ];
}

/**
 * The lots' fixed hash: a pseudo-random value in [0, 1) for a seed. Every
 * "random" choice of the stand-in scene draws from it, so two screenshots of
 * one preset show the same city.
 */
export function lotHash(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A lot's material draw in [0, 1): its own stream, half-way between integer
 * seeds, where no lot's base stream is (a lot's seed + k is another lot's
 * seed; round-3 review, finding 10).
 */
export function lotMaterialU(seed) {
  return lotHash(seed + 0.5);
}

/** Which of `n` materials the lot with `seed` wears. */
export function lotMaterialIndex(seed, n) {
  return Math.min(n - 1, Math.floor(lotMaterialU(seed) * n));
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
