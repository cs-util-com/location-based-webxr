# city-materials.js - the dense city's varied materials

- Purpose: round-3 plan 2026-09-27-0532, DEC-FB3-3 (the owner: "could the
  city's buildings use the catalog's materials at random? Matte and shiny
  mixed would show the reflections in the distance and answer whether many
  shiny surfaces cost more"). Which catalog entries a building may wear,
  which N of them the city uses, the "all shiny / all matte" A/B, and the
  lot split into one instanced mesh per material. Pure (no three), so
  `node --test` runs it.
- Public API:
  - `CITY_POOL_CATEGORIES` - `["standard", "physical"]`.
  - `CITY_MATERIAL_COUNTS` - `[4, 8, 12]`, the cost sweep's counts;
    `DEFAULT_CITY_MATERIALS` - the page's default (12).
  - `CITY_FINISHES` - `{ mixed: null, shiny: 0, matte: 1 }`: the roughness
    every city material takes (`null`: each entry's own).
  - `cityMaterialPool(catalog)` - the entries of the pool categories that
    name a `MeshStandardMaterial` or `MeshPhysicalMaterial`, in catalog
    order; a custom shader (`make`) is left out. `TypeError` for a
    non-array.
  - `pickCityMaterials(pool, n)` - n entries spread evenly over the pool
    (the middle of each of n equal spans). `RangeError` unless
    `1 <= n <= pool.length`, integer.
  - `groupRanks(groupOfLot, groupCount)` - per group, the ascending indices
    of its lots (`Int32Array`). `RangeError` for a group outside the range.
  - `countBelow(sorted, n)` - how many entries of an ascending array are
    below n (binary search).
- Invariants & assumptions:
  - The pool is physically based only: an unlit, classic or toon city would
    change the question (the cost of MIXING roughness and metalness), and
    the owner asked about matte against shiny.
  - Every swept count mixes matte (roughness >= 0.8) with shiny (<= 0.2)
    and dielectric with metal; taking the first n would give one hue from
    mirror to matte.
  - For any split and any n, the groups' `countBelow(ranks, n)` add up to
    min(n, lots): the nearest n lots, whatever the number of meshes. That
    is what makes the material count change the DRAWS and nothing else.
  - The catalog has no `physical` entry yet (2026-09-27), so the pool is
    the standard entries (the ramp row included).
- Examples:
  `pickCityMaterials(cityMaterialPool(CATALOG), 8).map(catalogMaterial)`
  gives the page's eight city materials; `denseCity(pitch, { materials })`
  (stand-in-scene.js) splits the lots with `groupRanks`.
- Tests: `city-materials.test.mjs` (the pool, every swept count's mix, the
  refusals, and a 100-trial property check of the split); the page's use in
  `lookdev-tidy.smoke.spec.mjs`.
