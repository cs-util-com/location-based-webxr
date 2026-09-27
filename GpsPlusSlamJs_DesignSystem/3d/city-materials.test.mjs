/**
 * The dense city's varied materials (round-3 plan 2026-09-27-0532,
 * DEC-FB3-3), under Node's own runner.
 *
 * Why this test matters: the switch answers the owner's question "does a
 * mix of matte and shiny cost more?", so the pool must hold only physically
 * based entries (an unlit or toon building would change the question), and
 * every count the cost sweep uses must really mix matte with shiny and
 * dielectric with metal (the first n of the catalog would be one hue from
 * mirror to matte). The lot split is what keeps "the nearest n lots" exact
 * across N meshes: a lot lost or counted twice between groups would change
 * the building count with the material count, and the cost comparison would
 * compare different cities.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CATALOG } from "./catalog/index.js";
import {
  CITY_FINISHES,
  CITY_MATERIAL_COUNTS,
  cityMaterialPool,
  countBelow,
  DEFAULT_CITY_MATERIALS,
  groupRanks,
  pickCityMaterials,
} from "./city-materials.js";

const roughnessOf = (e) => e.material.params.roughness ?? 1;
const metalnessOf = (e) => e.material.params.metalness ?? 0;

describe("cityMaterialPool", () => {
  it("holds only the catalog's standard and physical entries", () => {
    const pool = cityMaterialPool(CATALOG);
    assert.ok(pool.length >= 12, `pool of ${pool.length}`);
    for (const e of pool) {
      assert.ok(["standard", "physical"].includes(e.category), e.id);
      assert.match(e.material.type, /^Mesh(Standard|Physical)Material$/);
    }
    // Every classic and toon entry is left out.
    const left = CATALOG.filter((e) => !pool.includes(e));
    assert.ok(left.some((e) => e.category === "classic"));
    assert.ok(
      left.every(
        (e) => !["standard", "physical"].includes(e.category) || e.make,
      ),
    );
  });

  it("leaves out a custom shader even in a pool category", () => {
    const custom = {
      id: "x",
      category: "physical",
      make: () => ({}),
      cacheKey: "x",
      color: 0x336699,
    };
    assert.deepEqual(cityMaterialPool([custom]), []);
    assert.throws(() => cityMaterialPool(null), TypeError);
  });
});

describe("pickCityMaterials", () => {
  const pool = cityMaterialPool(CATALOG);

  // The sweep's counts and the default each mix matte with shiny, and
  // dielectric with metal, and pick distinct entries.
  for (const n of [...CITY_MATERIAL_COUNTS, DEFAULT_CITY_MATERIALS]) {
    it(`mixes matte, shiny, dielectric and metal at n = ${n}`, () => {
      const picked = pickCityMaterials(pool, n);
      assert.equal(picked.length, n);
      assert.equal(new Set(picked.map((e) => e.id)).size, n);
      assert.ok(
        picked.some((e) => roughnessOf(e) <= 0.2),
        "a shiny one",
      );
      assert.ok(
        picked.some((e) => roughnessOf(e) >= 0.8),
        "a matte one",
      );
      assert.ok(
        picked.some((e) => metalnessOf(e) >= 0.5),
        "a metal",
      );
      assert.ok(
        picked.some((e) => metalnessOf(e) < 0.5),
        "a dielectric",
      );
    });
  }

  it("is deterministic and takes the whole pool at n = pool size", () => {
    assert.deepEqual(pickCityMaterials(pool, 8), pickCityMaterials(pool, 8));
    assert.deepEqual(pickCityMaterials(pool, pool.length), pool);
  });

  it("refuses a count outside 1..pool size", () => {
    for (const n of [0, -1, 1.5, pool.length + 1, Number.NaN]) {
      assert.throws(() => pickCityMaterials(pool, n), RangeError);
    }
  });
});

describe("the finishes", () => {
  it("are mixed (each entry's own), all shiny and all matte", () => {
    assert.deepEqual(CITY_FINISHES, { mixed: null, shiny: 0, matte: 1 });
  });
});

describe("groupRanks and countBelow", () => {
  it("splits lots by group, in order, each lot exactly once", () => {
    const ranks = groupRanks([1, 0, 1, 2, 0], 3);
    assert.deepEqual(
      ranks.map((r) => [...r]),
      [[1, 4], [0, 2], [3]],
    );
  });

  it("refuses a group outside the range", () => {
    assert.throws(() => groupRanks([0, 3], 3), RangeError);
    assert.throws(() => groupRanks([0.5], 3), RangeError);
  });

  it("counts entries below n", () => {
    const sorted = Int32Array.from([1, 4, 9]);
    assert.deepEqual(
      [0, 1, 2, 4, 5, 9, 10].map((n) => countBelow(sorted, n)),
      [0, 0, 1, 1, 2, 2, 3],
    );
    assert.equal(countBelow(new Int32Array(0), 5), 0);
  });

  // The invariant the dense city rests on: for any split and any n, the
  // groups' counts below n add up to n (the nearest n lots, no more, no
  // fewer), whatever the number of groups.
  it("the groups' prefixes always add up to the nearest n lots", () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let trial = 0; trial < 100; trial++) {
      const groups = 1 + Math.floor(random() * 14);
      const lots = Math.floor(random() * 400);
      const assign = Array.from({ length: lots }, () =>
        Math.floor(random() * groups),
      );
      const ranks = groupRanks(assign, groups);
      for (const n of [0, 1, Math.floor(lots / 2), lots, lots + 5]) {
        const total = ranks.reduce((s, r) => s + countBelow(r, n), 0);
        assert.equal(total, Math.min(n, lots));
      }
    }
  });
});
