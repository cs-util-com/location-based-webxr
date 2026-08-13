/**
 * What every category's scores look like — the evidence for a shared heat cap.
 *
 * WHY THIS EXISTS. `corpus-score-distribution.test.ts` measured `walkable` and
 * only `walkable`, and the heat-scale plan then chose a fixed colour ceiling of
 * 1e4 from it (DEC-H5). **A cap chosen from one category is the same mistake as
 * one chosen from one place** — which that plan already made once and caught, so
 * DEC-H9 made this measurement a precondition of the colour work.
 *
 * ## The answer: ONE shared cap at 1e4, no per-category table
 *
 * Percentage of scored cells above each threshold, one score-chunk disk per
 * site, against the checked-in rule table. Measured 2026-08-13.
 *
 * **Cologne Cathedral** (n = 927):
 *
 * | category | max | >1 | >10 | >1e3 | >1e4 |
 * | --- | ---: | ---: | ---: | ---: | ---: |
 * | battleArea | 6.0e3 | 61.6 | 36.9 | 0.3 | 0 |
 * | spawnPoint | 1.9e4 | 61.4 | 29.9 | 1.2 | 0.1 |
 * | treasureReward | 518 | 57.7 | 26.1 | 0 | 0 |
 * | restingArea | 4.2e3 | 57.8 | 10.8 | 0.2 | 0 |
 * | questGiver | 1.1e3 | 59.7 | 29.3 | 0.3 | 0 |
 * | **walkable** | 1.7e11 | 52.8 | 51.0 | 20.2 | **9.8** |
 *
 * **Heidelberg Altstadt** (n = 931):
 *
 * | category | max | >1 | >10 | >1e3 | >1e4 |
 * | --- | ---: | ---: | ---: | ---: | ---: |
 * | battleArea | 5.6e9 | 25.2 | 20.6 | 7.6 | 2.8 |
 * | spawnPoint | 4.7e10 | 27.6 | 18.5 | 8.6 | 3.7 |
 * | treasureReward | 1.5e10 | 27.7 | 18.3 | 4.6 | 1.2 |
 * | restingArea | 5.6e9 | 24.9 | 19.9 | 7.1 | 2.8 |
 * | questGiver | 4.0e9 | 28.0 | 18.4 | 8.4 | 3.9 |
 * | **walkable** | 3.0e17 | 32.9 | 29.8 | 22.8 | **13.9** |
 *
 * Three things fall out, and together they settle DEC-H9's open question:
 *
 * - **The five non-walkable categories are not five distributions, they are one
 *   distribution repeated.** At each site their bands sit within a few points of
 *   each other. A per-category table would be five nearly identical rows.
 * - **`walkable` is the outlier at both sites** — the fattest tail by orders of
 *   magnitude and 2.5–5× as many cells above 1e4 as any other category. If any
 *   category ever earns its own cap it is this one, and 1e4 is the number that
 *   was chosen FOR it.
 * - **1e4 clips ≤ 3.9 % of every other category.** That is a smaller cost than
 *   the 9.8–13.9 % already accepted for `walkable` in DEC-H5.
 *
 * ## And it refutes a worry the plan carried
 *
 * `heat-colours.ts` argues a fixed scale "would make most categories look
 * uniformly dark and hide precisely the variation being judged". **Not at 1e4.**
 * The ramp is logarithmic, so at Cologne — the site where the five categories
 * are weakest — their maxima land at 68 %, 76 %, 91 %, 95 % and 107 % of a log
 * ramp running 1 → 1e4. Only `treasureReward` fails to reach the top third, and
 * it still uses two thirds of the ramp. At Heidelberg every category exceeds the
 * cap. The concern was reasonable and the arithmetic does not support it.
 *
 * @see corpus-score-distribution.test.ts for the original `walkable` measurement
 *   and the two conclusions that came out of it.
 */

import { describe, expect, it } from "vitest";
import { latLngToCell } from "h3-js";

import { AffordanceIndex } from "./affordance-index.js";
import { DEFAULT_RULE_TABLE_CSV } from "../rules/default-rules.js";
import { parseRuleTable } from "../rules/rule-table.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { CORPUS_SITES } from "../places/sites.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import { AFFORDANCE_RES, toFetchTile } from "../spatial/resolutions.js";

const TABLE = parseRuleTable(DEFAULT_RULE_TABLE_CSV, {
  source: "snapshot",
  fetchedAt: 0,
});

/** Every category the shipped rule table declares. */
const CATEGORIES = TABLE.categories;

/** The cap DEC-H5 chose, and the thing under test here. */
const CAP = 1e4;

/** Every cell's scores at one corpus site, per category, sorted ascending. */
function scoresAt(siteId: string): Map<string, number[]> {
  const site = CORPUS_SITES.find((candidate) => candidate.id === siteId);
  if (site === undefined) throw new Error(`no corpus site ${siteId}`);
  const features = parseOverpassJson(loadSite(site.id).payload).features;

  const index = new AffordanceIndex({ table: TABLE });
  index.acceptTile({
    tile: toFetchTile(
      latLngToCell(site.position.lat, site.position.lng, AFFORDANCE_RES),
    ),
    features,
    schemaVersion: OVERPASS_SCHEMA_VERSION,
    fetchedAt: 0,
    sourceId: `fixture:${site.id}`,
    skipped: [],
  });
  // A POSITION, not a chunk id — `update` re-derives the chunk itself.
  index.update(site.position);

  const byCategory = new Map<string, number[]>(
    CATEGORIES.map((category) => [category, []]),
  );
  for (const cell of index.scoresByCell().values()) {
    for (const category of CATEGORIES) {
      const score = cell.scores[category];
      if (typeof score === "number" && Number.isFinite(score)) {
        byCategory.get(category)?.push(score);
      }
    }
  }
  for (const scores of byCategory.values()) scores.sort((a, b) => a - b);
  return byCategory;
}

const COLOGNE = scoresAt("cologne-cathedral");
const HEIDELBERG = scoresAt("heidelberg-altstadt");
const SITES = [
  ["Cologne", COLOGNE],
  ["Heidelberg", HEIDELBERG],
] as const;

/** Fraction of scores strictly above `threshold`. */
function above(scores: readonly number[], threshold: number): number {
  return scores.filter((score) => score > threshold).length / scores.length;
}

function scoresFor(
  site: ReadonlyMap<string, number[]>,
  category: string,
): readonly number[] {
  return site.get(category) ?? [];
}

/** The other five — `walkable` is measured separately and behaves differently. */
const OTHERS = CATEGORIES.filter((category) => category !== "walkable");

describe("every category, not just walkable", () => {
  it("scores every declared category at both sites", () => {
    // Guards the guard: a category the scorer silently skipped would make every
    // statement below vacuously true for it, and this whole file exists because
    // measuring one category and generalising was the original mistake.
    expect(CATEGORIES).toContain("walkable");
    expect(OTHERS.length).toBeGreaterThan(3);
    for (const [, site] of SITES) {
      for (const category of CATEGORIES) {
        expect(scoresFor(site, category).length).toBeGreaterThan(500);
      }
    }
  });

  it("clips at most a few per cent of every category except walkable", () => {
    // THE MEASUREMENT DEC-H9 ASKED FOR. 1e4 was chosen from `walkable`, and the
    // open question was whether it is wrong for the others. It is not: it costs
    // them less than it costs the category it was chosen for.
    for (const [, site] of SITES) {
      for (const category of OTHERS) {
        expect(above(scoresFor(site, category), CAP)).toBeLessThan(0.05);
      }
    }
  });

  it("shows walkable as the outlier that the cap was chosen for", () => {
    // If any category ever earns its own cap it is this one — it has the fattest
    // tail at BOTH sites, which is what makes "the cap is a walkable decision"
    // true rather than an accident of which category was measured first.
    for (const [, site] of SITES) {
      const walkable = above(scoresFor(site, "walkable"), CAP);
      for (const category of OTHERS) {
        expect(walkable).toBeGreaterThan(above(scoresFor(site, category), CAP));
      }
    }
  });

  it("keeps the five non-walkable categories within a few points of each other", () => {
    // WHY A PER-CATEGORY TABLE WOULD BE FIVE IDENTICAL ROWS. They are the same
    // distribution, so the extra structure would carry no information — which is
    // the whole argument for a single constant over a table.
    for (const [, site] of SITES) {
      const fractions = OTHERS.map((category) =>
        above(scoresFor(site, category), CAP),
      );
      const spread = Math.max(...fractions) - Math.min(...fractions);
      expect(spread).toBeLessThan(0.04);
    }
  });

  it("leaves the weakest category using most of the ramp, not a dark corner", () => {
    // THE REFUTATION OF `heat-colours.ts`'s STATED WORRY: that a fixed scale
    // "would make most categories look uniformly dark". The ramp is
    // LOGARITHMIC, so a category topping out at 518 still reaches 68 % of it.
    // Cologne is the harder site — Heidelberg's categories all exceed the cap.
    //
    // Asserted on the ramp fraction rather than on the raw maximum, because the
    // raw maximum is not what a reader sees; the position on the ramp is.
    for (const category of OTHERS) {
      const max = scoresFor(COLOGNE, category).at(-1) ?? 0;
      const rampFraction = Math.log10(max) / Math.log10(CAP);
      expect(rampFraction).toBeGreaterThan(0.6);
    }
  });
});
