/**
 * What the affordance scores actually LOOK like, over the real corpus
 * (§6 step 0, DEC-R6-21).
 *
 * WHY THIS RUNS BEFORE ANY §6 CODE. Two questions were left open by the round-6
 * plan, and both are about MEANING rather than about a value, so neither is
 * answerable from the armchair. **Both turned out to have answers opposite to
 * the ones the plan assumed**, which is the entire justification for doing the
 * measurement first.
 *
 * MEASURED, 2026-08-02, `walkable`, one score-chunk disk at each site, against
 * the checked-in rule-table snapshot:
 *
 * - **Cologne Cathedral** (n = 927): p05 = 0, p50 = **0.048**, p90 = 3.9e3,
 *   p99 = 8.1e6, max = 1.4e12. **46.3 % score above 1; 44.9 % above 9.**
 * - **Heidelberg Altstadt** (n = 931): p50 = **0.8**, **29.8 % above 9.**
 *
 * **Q-R6-4 — `heat > 9` is in the BULK, not the tail.** The gate is inherited
 * verbatim from `GeoEvent.cs`, and it accepts roughly a third to a half of all
 * ground. A hill-climb gated on it would accept almost anywhere, so the "find a
 * good spot" behaviour would be close to noise. **It cannot be ported as a
 * number.** The C# heat map was a sum of counts; ours is a product of rule
 * factors, and 9 means something entirely different in each.
 *
 * **Q-R6-3 — the distribution spans TWELVE orders of magnitude** (0 to 1.4e12),
 * because a product of factors compounds. That decides the aggregate question in
 * a way the C# reference cannot: a SUM over a coarse cell's children is
 * dominated by its single largest child, so sum and max are very nearly the same
 * statistic here, while an arithmetic mean is the same statistic divided by a
 * child count that varies with pentagons. Any of the three is really "the
 * biggest thing in this cell". **If a genuine average is wanted it has to be
 * geometric** — the mean of the logs — because that is the mean that matches how
 * the score is built.
 *
 * WHY IT IS A TEST AND NOT A SCRIPT. A script produces a figure that is right on
 * the day and silently rots. These assertions fail when the rule table or the
 * scorer changes the distribution — which is exactly when the two answers above
 * need revisiting.
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

/** Every walkable score at one corpus site, sorted ascending. */
function scoresFor(siteId: string): number[] {
  const site = CORPUS_SITES.find((candidate) => candidate.id === siteId);
  if (site === undefined) throw new Error(`no corpus site ${siteId}`);
  const features = parseOverpassJson(loadSite(site.id).payload).features;

  const index = new AffordanceIndex({ table: TABLE });
  const centreCell = latLngToCell(
    site.position.lat,
    site.position.lng,
    AFFORDANCE_RES,
  );
  index.acceptTile({
    tile: toFetchTile(centreCell),
    features,
    schemaVersion: OVERPASS_SCHEMA_VERSION,
    fetchedAt: 0,
    sourceId: `fixture:${site.id}`,
    skipped: [],
  });
  // A POSITION, not a chunk id — `update` re-derives the chunk itself.
  index.update(site.position);

  const scores: number[] = [];
  for (const cell of index.scoresByCell().values()) {
    const score = cell.scores["walkable"];
    if (typeof score === "number" && Number.isFinite(score)) scores.push(score);
  }
  return scores.sort((a, b) => a - b);
}

/** The value at a quantile of a sorted array. */
function at(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * quantile),
  );
  return sorted[index] ?? Number.NaN;
}

/** What fraction of scores exceed `threshold`. */
function fractionAbove(sorted: number[], threshold: number): number {
  return sorted.filter((score) => score > threshold).length / sorted.length;
}

const COLOGNE = scoresFor("cologne-cathedral");
const HEIDELBERG = scoresFor("heidelberg-altstadt");

describe("the corpus score distribution (§6 step 0)", () => {
  it("scores enough cells at both sites for the sample to mean anything", () => {
    // Guards the guard: a fixture that scored nothing would make every
    // assertion below vacuously true.
    expect(COLOGNE.length).toBeGreaterThan(500);
    expect(HEIDELBERG.length).toBeGreaterThan(500);
  });

  it("has a median BELOW the identity, not at it", () => {
    // The assumption this measurement overturned. The intuition is "most ground
    // is mentioned by no rule, so it scores exactly 1" — but the score is a
    // PRODUCT and plenty of rule factors are below 1, so the typical cell is
    // suppressed rather than neutral. Measured: 0.048 at Cologne, 0.8 at
    // Heidelberg.
    expect(at(COLOGNE, 0.5)).toBeLessThan(1);
    expect(at(HEIDELBERG, 0.5)).toBeLessThanOrEqual(1);
  });

  it("spans at least ten orders of magnitude", () => {
    // THE FACT THAT DECIDES Q-R6-3. With this spread, a sum over a coarse
    // cell's children IS its largest child to within a rounding error, so sum,
    // max and mean are not three meaningfully different aggregates — they are
    // one statistic and two scalings of it. A genuine average has to be
    // geometric.
    const top = COLOGNE[COLOGNE.length - 1] ?? 0;
    const p50 = at(COLOGNE, 0.5);
    expect(p50).toBeGreaterThan(0);
    expect(Math.log10(top / p50)).toBeGreaterThan(10);
  });

  it("shows `heat > 9` selecting the BULK of the ground, not the tail", () => {
    // THE ANSWER TO Q-R6-4, and the reason the C# gate cannot be ported as a
    // number. It accepts 44.9 % of Cologne and 29.8 % of Heidelberg — a
    // hill-climb gated on this would accept very nearly anywhere.
    expect(fractionAbove(COLOGNE, 9)).toBeGreaterThan(0.2);
    expect(fractionAbove(HEIDELBERG, 9)).toBeGreaterThan(0.2);
  });

  it("would need a threshold four orders of magnitude higher to select a tail", () => {
    // What a REPLACEMENT gate has to look like if it is expressed as an
    // absolute number at all. p99 is ~8e6 at Cologne, so "the top one per cent"
    // lives up there rather than at 9.
    //
    // The better answer is probably not an absolute number: a QUANTILE of the
    // locally scored distribution would carry the same intent — "somewhere
    // unusually good" — without needing to be re-derived per city, and these two
    // sites already differ by a factor of ~16 at the median.
    expect(at(COLOGNE, 0.99)).toBeGreaterThan(1e5);
    // 1e5 selects 5.4 % where 9 selects 44.9 % — an eightfold difference in how
    // exclusive the gate is, from moving it four orders of magnitude. That
    // ratio is the point rather than either number.
    expect(fractionAbove(COLOGNE, 1e5)).toBeLessThan(0.1);
    expect(
      fractionAbove(COLOGNE, 9) / fractionAbove(COLOGNE, 1e5),
    ).toBeGreaterThan(5);
  });

  it("differs enough between the two sites to rule out one global constant", () => {
    // Cologne's median is 0.048 and Heidelberg's 0.8 — a factor of ~16 on the
    // typical cell. Any absolute gate tuned on one site is wrong on the other by
    // about that much, which is the argument for a quantile.
    const ratio = at(HEIDELBERG, 0.5) / at(COLOGNE, 0.5);
    expect(ratio).toBeGreaterThan(4);
  });
});
