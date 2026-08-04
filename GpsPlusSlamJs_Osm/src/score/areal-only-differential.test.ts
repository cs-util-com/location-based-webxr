import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildFeatureIndex } from "../spatial/h3-feature-index.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { parseRuleTable } from "../rules/rule-table.js";
import { DEFAULT_RULE_TABLE_CSV } from "../rules/default-rules.js";
import { scoreCells } from "./affordance-scorer.js";
import { enuFrameAt } from "../mesh/enu.js";
import { buildBuildings } from "../mesh/buildings.js";
import { buildAreaPlates } from "../mesh/plates.js";
import { buildRoads } from "../mesh/roads.js";

/**
 * F32's differential test: does `areal-only` change the SCORES?
 *
 * WHY THIS IS THE ONLY THING THAT CAN CLOSE F32, and why the sweep could not.
 * The 2026-08-03 sweep answered "which query form is cheapest" — decisively,
 * `areal-only` is 3.2x smaller than production's `plain` at res 7 for the same
 * latency. It said nothing about whether the cheap form is CORRECT. §0.3 of the
 * round-6 plan names the hazard exactly: `areal-only` drops route, waterway and
 * power relations that currently arrive carrying scoring tags, and **the failure
 * mode is a score that changes silently — no error, no visible artefact.**
 *
 * WHY IT NEEDED A NEW CAPTURE. The existing fixture corpus CANNOT answer this,
 * because it is already in the candidate form: `capture-fixtures.mjs` drops
 * non-areal relations client-side, which is precisely what `areal-only` does
 * server-side. So every test, every score and §6 step 0's whole distribution
 * measurement has always run on areal-only data, while production fetched
 * `plain`. **The two have disagreed all along and nothing compared them.**
 *
 * `scripts/capture-non-areal.mjs` captured the missing half — the 85 relations
 * the Cologne fixture dropped — so `plain` is reconstructible offline as
 * `fixture + dropped` and the differential is an ordinary unit test.
 *
 * COLOGNE IS THE WORST CASE IN THE CORPUS: 84 dropped relations against
 * Heidelberg's 2, Manhattan's 7 and Sylt's 0. If the scores agree here they
 * agree everywhere.
 */

const NON_AREAL_PATH = join(
  process.cwd(),
  "src",
  "testdata",
  "sites",
  "cologne-cathedral.non-areal.json",
);

interface NonArealCapture {
  readonly of: string;
  readonly elementCount: number;
  readonly expectedCount: number;
  /** Members dropped at capture time. See the shrink-invariant test below. */
  readonly membersOmitted: number;
  readonly elements: readonly { readonly members?: readonly unknown[] }[];
}

const capture = JSON.parse(
  readFileSync(NON_AREAL_PATH, "utf8"),
) as NonArealCapture;

const table = parseRuleTable(DEFAULT_RULE_TABLE_CSV, {
  source: "default-rules",
  fetchedAt: 0,
});
const site = loadSite("cologne-cathedral");

/** The fixture as it ships: what `areal-only` would deliver. */
const arealOnly = parseOverpassJson(site.payload).features;

/** The fixture plus what it dropped: what `plain` delivered before F32. */
const sitePayload = site.payload as { elements: unknown[] };
const plain = parseOverpassJson({
  ...sitePayload,
  elements: [...sitePayload.elements, ...capture.elements],
}).features;

const scoresBy = (features: typeof arealOnly): Map<string, number> => {
  const result = scoreCells(buildFeatureIndex(features), table);
  const out = new Map<string, number>();
  for (const cell of result.cells) {
    for (const [category, score] of Object.entries(cell.scores)) {
      out.set(`${cell.cell}|${category}`, score);
    }
  }
  return out;
};

describe("areal-only vs plain, scored over the Cologne fixture", () => {
  it("captured the relations the fixture says it dropped", () => {
    // A MISMATCH MEANS THE TWO SIDES ARE DIFFERENT WORLDS. The fixture was
    // captured earlier than the companion, so OSM may have moved under us — and
    // a differential between data from two dates measures editing activity
    // rather than the query form. Small drift is expected and fine; a large one
    // invalidates the comparison.
    expect(capture.of).toBe("cologne-cathedral");
    expect(capture.elementCount).toBeGreaterThan(0);
    expect(
      Math.abs(capture.elementCount - capture.expectedCount),
    ).toBeLessThanOrEqual(5);
  });

  it("carries no member geometry — the shrink invariant", () => {
    // WHY THIS TEST MATTERS. As first captured this file was 24.9 MB written
    // and 41.4 MB committed across 1 128 493 lines — two thirds of PR #249's
    // entire diff — and every byte beyond ~50 kB was `out geom` printing
    // 590 061 member positions that NOTHING here reads: `relationToGeometry`
    // checks `isArealRelation` before it ever calls `memberGeometries`, so all
    // 85 are rejected on `type` first (proved by the last test in this file).
    // `capture-non-areal.mjs` therefore empties the member lists.
    //
    // This assertion is what stops a re-capture silently putting the 41 MB
    // back. It is the outcome, not the script, so it also catches a fixture
    // restored from an old copy.
    for (const element of capture.elements) {
      expect(element.members).toEqual([]);
    }
    // The arrays must still EXIST. `parseRelation` skips a relation whose
    // `members` is not an array, which would take `dropped.length` to 0 and
    // make the `unsupported-relation-type` loop below iterate over nothing —
    // passing vacuously while proving the opposite of what it claims.
    expect(
      capture.elements.every((element) => Array.isArray(element.members)),
    ).toBe(true);
    // What was thrown away is recorded rather than forgotten, so nobody reads
    // these relations as genuinely memberless.
    expect(capture.membersOmitted).toBe(77_381);
  });

  it("adds features under plain, so the comparison is not vacuous", () => {
    // The guard that stops this whole suite passing by comparing a set with
    // itself — which it would do if the capture were empty or misparsed.
    expect(plain.length).toBeGreaterThan(arealOnly.length);
  });

  // WALL-CLOCK HEAVY, AND EXPLICITLY BUDGETED. This scores the full Cologne
  // extract TWICE — 86 172 cell-category pairs each side. Isolated it runs in
  // ~1.4 s; inside the full suite, where vitest runs files in parallel and
  // steals CPU, it was measured at 19.6 s and blew the default timeout. A test
  // that clocks near its budget in isolation will flake as the suite grows, so
  // the budget is stated rather than inherited.
  it(
    "ENUMERATES every cell whose score the query form changes",
    { timeout: 120_000 },
    () => {
      // THE ANSWER F32 NEEDS, and it is reported rather than merely asserted: §0.3
      // requires "every disagreement enumerated by feature", so a legitimately
      // dropped route relation is separated from a scoring defect.
      const before = scoresBy(plain);
      const after = scoresBy(arealOnly);

      const changed: { key: string; plain: number; arealOnly: number }[] = [];
      for (const [key, value] of before) {
        const other = after.get(key);
        if (other === undefined) {
          changed.push({ key, plain: value, arealOnly: Number.NaN });
          continue;
        }
        // Relative comparison: the scorer multiplies rule factors and the corpus
        // spans twelve orders of magnitude, so an absolute tolerance would be
        // meaningless at both ends.
        const ratio =
          value === 0 ? (other === 0 ? 1 : Infinity) : other / value;
        if (Math.abs(Math.log(Math.max(ratio, 1e-300))) > 1e-9) {
          changed.push({ key, plain: value, arealOnly: other });
        }
      }
      const appeared = [...after.keys()].filter((k) => !before.has(k));

      console.log(
        `areal-only differential @ cologne-cathedral:\n` +
          `  cells x categories scored under plain: ${before.size}\n` +
          `  scored under areal-only:               ${after.size}\n` +
          `  DISAGREEING:                           ${changed.length}\n` +
          `  present only under areal-only:         ${appeared.length}`,
      );
      for (const row of changed.slice(0, 20)) {
        console.log(
          `    ${row.key}  plain=${row.plain.toExponential(3)}  areal-only=${row.arealOnly.toExponential(3)}`,
        );
      }
      if (changed.length > 20) {
        console.log(`    … and ${changed.length - 20} more`);
      }

      // MEASURED AT ZERO, and asserted at zero, because §2 below establishes it
      // is zero STRUCTURALLY rather than by luck: the indexer already rejects the
      // same class of relation the query would omit. A future non-zero here means
      // that structural fact has changed and the adoption needs re-deciding.
      expect(changed).toEqual([]);
      expect(appeared).toEqual([]);
      expect(before.size).toBeGreaterThan(0);
    },
  );

  it("rejects every dropped relation as non-areal BEFORE it can score", () => {
    // WHY THE DIFFERENTIAL IS ZERO, and this is the assertion that makes the one
    // above meaningful rather than lucky. `buildFeatureIndex` already refuses a
    // relation whose `type` is not areal — so the scorer has NEVER seen one of
    // these, whatever the query fetched.
    //
    // **The package therefore already does client-side exactly what `areal-only`
    // does server-side.** §0.3 of the round-6 plan named the hazard as "drops
    // route, waterway and power relations that currently arrive carrying scoring
    // tags"; they arrive and are discarded on the next line. The 3.2x payload
    // difference is data fetched, parsed and thrown away.
    const dropped = parseOverpassJson({
      elements: capture.elements,
    }).features;
    const index = buildFeatureIndex(dropped);

    expect(dropped.length).toBe(capture.elementCount);
    expect(index.byCell.size).toBe(0);
    expect(index.byFeature.size).toBe(0);
    expect(index.failed.length).toBe(dropped.length);
    for (const failure of index.failed) {
      expect(failure.reason).toBe("unsupported-relation-type");
    }
  });

  // Also wall-clock heavy: it builds every building, plate and road twice.
  it(
    "leaves buildings, plates and roads bit-identical too",
    { timeout: 120_000 },
    () => {
      // THE SCORER IS NOT THE ONLY CONSUMER, and a differential that only checked
      // scores would miss a geometry regression. Two of the 85 dropped relations
      // carry `type=building`, which goes to a different builder than the one the
      // scoring index feeds — so the geometry path is checked explicitly rather
      // than assumed to follow.
      const frame = enuFrameAt({ lat: 50.9413, lng: 6.9583 });
      const triangles = (
        parts: { mesh: { triangleCount: number } }[],
      ): number =>
        parts.reduce((total, part) => total + part.mesh.triangleCount, 0);

      const before = {
        buildings: buildBuildings(plain, { frame }),
        plates: buildAreaPlates(plain, { frame }),
        roads: buildRoads(plain, { frame }),
      };
      const after = {
        buildings: buildBuildings(arealOnly, { frame }),
        plates: buildAreaPlates(arealOnly, { frame }),
        roads: buildRoads(arealOnly, { frame }),
      };

      expect({
        buildings: after.buildings.length,
        buildingTris: triangles(after.buildings),
        plates: after.plates.length,
        plateTris: triangles(after.plates),
        roads: after.roads.length,
      }).toEqual({
        buildings: before.buildings.length,
        buildingTris: triangles(before.buildings),
        plates: before.plates.length,
        plateTris: triangles(before.plates),
        roads: before.roads.length,
      });
    },
  );
});
