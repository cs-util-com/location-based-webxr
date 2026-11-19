import { describe, test } from "vitest";

import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { median } from "../utils/median.js";
import { buildCity, type CityOptions } from "./city.js";
import {
  DEFAULT_CITY_COLOUR_SCHEME,
  type CityColourScheme,
} from "./colour-scheme.js";
import { enuFrameAt } from "./enu.js";

/**
 * What baking looks (`CityOptions.looks`) adds to a full city build, against
 * the same build in one scheme.
 *
 * Why this bench matters: the looks build runs the geometry once and only
 * repeats the colour picks and one byte buffer per look per chunk, so its
 * cost should be a small fraction of the build (estimated +7-11 % at four
 * looks). If it grows towards a second build, the design (geometry once) has
 * regressed. The options are the OSM demo's full pass: roads, cosmetic trees,
 * the ground tint and invented roofs. Two dense sites, Cologne's cathedral
 * and Heidelberg's old town.
 *
 * INTERLEAVED, NOT ONE BENCH PER CASE: run one after the other, tinybench's
 * cases differ by JIT warm-up and GC state as much as by the work (a first
 * run read +59 % at Cologne that the interleaved medians did not repeat), so
 * the cases alternate in a rotating order and the median of each is
 * compared. Medians are in `city.ts.md`; run with
 * `pnpm run bench src/mesh/city-looks.bench.ts --reporter=verbose`.
 */

const ROUNDS = 24;
const WARMUP_ROUNDS = 2;

const SITES = ["cologne-cathedral", "heidelberg-altstadt"] as const;

/** A look whose colour lists and one rule differ from the default's. */
function variant(delta: number, flip: boolean): CityColourScheme {
  const shift = (rgb: number): number => (rgb + delta) & 0xffffff;
  const d = DEFAULT_CITY_COLOUR_SCHEME;
  return {
    ...d,
    walls: d.walls.map(shift),
    flatRoofs: d.flatRoofs.map(shift),
    pitchedRoofs: d.pitchedRoofs.map(shift),
    honourColourTags: flip ? !d.honourColourTags : d.honourColourTags,
    ground: shift(d.ground),
  };
}

const LOOKS: readonly CityColourScheme[] = [
  DEFAULT_CITY_COLOUR_SCHEME,
  variant(0x101010, true),
  variant(0x202020, false),
  variant(0x303030, true),
];

const CASES: readonly (readonly [string, Partial<CityOptions>])[] = [
  ["one scheme", {}],
  ["1 look", { looks: LOOKS.slice(0, 1) }],
  ["2 looks", { looks: LOOKS.slice(0, 2) }],
  ["4 looks", { looks: LOOKS }],
];

describe("buildCity in one scheme and in looks", () => {
  for (const id of SITES) {
    test(id, () => {
      const site = loadSite(id);
      const features = parseOverpassJson(site.payload).features;
      const frame = enuFrameAt(site.centre);
      const base: CityOptions = {
        window: site.bbox,
        roads: true,
        cosmeticTrees: true,
        groundTint: true,
        inventedRoofs: true,
      };
      const times = CASES.map(() => [] as number[]);
      for (let round = 0; round < ROUNDS + WARMUP_ROUNDS; round++) {
        for (let j = 0; j < CASES.length; j++) {
          const i = (j + round) % CASES.length;
          const start = performance.now();
          buildCity(features, { frame }, { ...base, ...CASES[i]![1] });
          if (round >= WARMUP_ROUNDS) times[i]!.push(performance.now() - start);
        }
      }
      const one = median(times[0]!) ?? Number.NaN;
      for (const [i, [label]] of CASES.entries()) {
        const m = median(times[i]!) ?? Number.NaN;
        console.info(
          `${id} ${label}: median ${m.toFixed(1)} ms (${((m / one - 1) * 100).toFixed(1)} %)`,
        );
      }
    });
  }
});
