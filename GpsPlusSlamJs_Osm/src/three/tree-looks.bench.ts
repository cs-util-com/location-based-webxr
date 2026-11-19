import { describe, test } from "vitest";

import { buildCity } from "../mesh/city.js";
import { enuFrameAt } from "../mesh/enu.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { FOUR_LOOKS } from "../test-utils/rule-looks.js";
import { setTreeLookWeights, treeObjects } from "./city-objects.js";
import { repackTreeLod } from "./trunk-trees.js";

/**
 * What one look-mix step of the trees costs: `setTreeLookWeights` over every
 * mapped and invented tree of a dense site baked in four looks, in both tree
 * forms (the trunk form after one LOD sort, so its slot rewrite runs).
 *
 * Why this bench matters: a time of day mixes the tree colours on the CPU at
 * every sun step, and the budget for that step is 4 ms on the phone; a
 * desktop reading far below it leaves the phone headroom, one near it means
 * the mix belongs on the GPU. The fixture of Heidelberg's old town holds a
 * few hundred trees; the demo's Heidelberg window holds 23 077 crowns, so
 * the fixture's trees (in four looks, with their real variant mix) are
 * tiled to that count: the mix costs per instance and per look, not per
 * place. p50 and p90 are in `tree-looks.ts.md`; run with
 * `pnpm run bench src/three/tree-looks.bench.ts --reporter=verbose`.
 */

const ROUNDS = 200;
/** The tree crowns of the demo's Heidelberg window. */
const HEIDELBERG_CROWNS = 23_077;
const WARMUP_ROUNDS = 20;

/** The `q` quantile of `values` (nearest rank). */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ??
    Number.NaN
  );
}

/** `placements` repeated, each copy shifted 1 km east, to `count` trees. */
function tiled<T extends { readonly position: { x: number; y: number } }>(
  placements: readonly T[],
  count: number,
): T[] {
  return Array.from({ length: count }, (_, i) => {
    const source = placements[i % placements.length]!;
    const copy = Math.floor(i / placements.length);
    return {
      ...source,
      position: { x: source.position.x + copy * 1000, y: source.position.y },
    };
  });
}

describe("setTreeLookWeights at Heidelberg", () => {
  test("heidelberg-altstadt", () => {
    const site = loadSite("heidelberg-altstadt");
    const features = parseOverpassJson(site.payload).features;
    const city = buildCity(
      features,
      { frame: enuFrameAt(site.centre) },
      {
        window: site.bbox,
        roads: true,
        cosmeticTrees: true,
        groundTint: true,
        inventedRoofs: true,
        looks: FOUR_LOOKS,
      },
    );
    for (const form of ["crown", "trunk"] as const) {
      const all = [...city.trees, ...(city.cosmeticTrees ?? [])];
      const objects = treeObjects(tiled(all, HEIDELBERG_CROWNS), { form });
      for (const mesh of objects) repackTreeLod(mesh, { x: 0, y: 0, z: 0 });
      const times: number[] = [];
      let trees = 0;
      for (let round = 0; round < ROUNDS + WARMUP_ROUNDS; round++) {
        const t = (round % 50) / 49;
        const weights = [1 - t, t * 0.5, t * 0.3, t * 0.2];
        const start = performance.now();
        trees = setTreeLookWeights(objects, weights);
        if (round >= WARMUP_ROUNDS) times.push(performance.now() - start);
      }
      console.info(
        `${form} form, ${trees} trees: p50 ${quantile(times, 0.5).toFixed(2)} ms, p90 ${quantile(times, 0.9).toFixed(2)} ms`,
      );
    }
  });
});
