/**
 * Rule-table tests.
 *
 * Why these tests matter:
 * This is the policy layer, and every mistake it can make is SILENT. A wrong
 * separator, a blank cell read as zero, a missing category — none of them throw;
 * they all produce a table that scores every cell at the multiplicative
 * identity, which downstream reads as "nothing is mapped here" rather than as a
 * bug. So the assertions here are mostly about distinguishing "absent" from
 * "zero" and about refusing to guess.
 *
 * The oracle values are the C# reference's own, verified against the live sheet
 * on 2026-07-28.
 *
 * @see rule-table.ts.md
 */

import { describe, it, expect } from "vitest";
import {
  parseRuleTable,
  ruleValue,
  thresholdFor,
  ruleTableKeys,
  DEFAULT_THRESHOLD,
} from "./rule-table.js";

const META = { source: "test", fetchedAt: 1_000_000 };

/** A miniature sheet with the real column layout. */
const SHEET = [
  "id,seperator,Key,Value,Count,w,Description,battleArea,walkable",
  'surface_sand,_,surface,sand,"415 431\n2%",,Loose sand.,5,5',
  'natural_beach,_,natural,beach,"158 284\n1%",,A beach.,8,7',
  'building_house,_,building,house,"49 004 484\n50%",,A house.,0,0',
  'landuse_farmland,_,landuse,farmland,"8 212 797\n9%",,Farmland.,0.8,0.6',
].join("\n");

describe("the C# oracle values reproduce", () => {
  // These are what make the port VERIFIABLE rather than merely plausible: the
  // reference's tests pin exact expected products, so if these lookups are
  // right the whole scoring chain can be checked against known answers.
  const table = parseRuleTable(SHEET, META);

  it.each<[string, string, number]>([
    ["surface_sand", "walkable", 5],
    ["natural_beach", "walkable", 7],
    ["landuse_grass", "walkable", 1], // absent from this mini sheet -> identity
    ["building_house", "battleArea", 0],
    ["landuse_farmland", "battleArea", 0.8],
  ])("%s -> %s = %s", (key, category, expected) => {
    expect(ruleValue(table, key, category)).toBe(expected);
  });

  it("gives beach = sand 5 x beach 7 = 35 for walkable", () => {
    // The published oracle product. Asserted here as arithmetic over the table
    // so that a lookup regression fails before the scoring engine is involved.
    expect(
      ruleValue(table, "surface_sand", "walkable") *
        ruleValue(table, "natural_beach", "walkable"),
    ).toBe(35);
  });
});

describe("category discovery — never hardcoded", () => {
  const table = parseRuleTable(SHEET, META);

  it("finds the numeric columns", () => {
    expect(table.categories).toEqual(["battleArea", "walkable"]);
  });

  it("excludes the sheet's own bookkeeping columns", () => {
    // `Count` is the dangerous one: it is not numeric TODAY ("415 431\n2%"),
    // but a formatting change could make it parse, and a usage-count column
    // silently becoming a scoring category would produce enormous meaningless
    // scores. It is blacklisted by name, not left to the numeric test.
    for (const excluded of [
      "id",
      "Key",
      "Value",
      "Count",
      "Description",
      "w",
    ]) {
      expect(table.categories).not.toContain(excluded);
    }
  });

  it("picks up a NEW category with no code change", () => {
    // The live-tuning loop §2.1 chose to keep: adding a column to the sheet must
    // add a category.
    const withNew = SHEET.replace(
      ",battleArea,walkable",
      ",battleArea,walkable,climbable",
    )
      .replace(",Loose sand.,5,5", ",Loose sand.,5,5,3")
      .replace(",A beach.,8,7", ",A beach.,8,7,2")
      .replace(",A house.,0,0", ",A house.,0,0,0")
      .replace(",Farmland.,0.8,0.6", ",Farmland.,0.8,0.6,1");

    const table2 = parseRuleTable(withNew, META);
    expect(table2.categories).toContain("climbable");
    expect(ruleValue(table2, "surface_sand", "climbable")).toBe(3);
  });

  it("refuses a table with no categories at all", () => {
    // Returning it would present downstream as "this entire area is unmapped".
    expect(() => parseRuleTable("id,Key,Value\nx,a,b\n", META)).toThrow(
      /no numeric categories/i,
    );
  });
});

describe("absent is NOT zero — the most destructive available misreading", () => {
  // Zero is a hard veto that short-circuits scoring. Reading a blank cell as
  // zero would veto on every unfilled cell in a deliberately sparse sheet.
  const sparse = [
    "id,Key,Value,battleArea,walkable",
    "surface_sand,surface,sand,,5",
    "natural_beach,natural,beach,0,7",
  ].join("\n");
  const table = parseRuleTable(sparse, META);

  it("returns the identity for a blank cell", () => {
    expect(ruleValue(table, "surface_sand", "battleArea")).toBe(1);
  });

  it("returns 0 for a cell that really says 0", () => {
    expect(ruleValue(table, "natural_beach", "battleArea")).toBe(0);
  });

  it("does not coerce whitespace to zero either", () => {
    const padded = parseRuleTable(
      "id,Key,Value,walkable,battleArea\nx,a,b,   ,5",
      META,
    );
    expect(ruleValue(padded, "x", "walkable")).toBe(1);
  });
});

describe("thresholds", () => {
  it("defaults to the multiplicative identity when undeclared", () => {
    // The only defensible default: "at least one rule said something positive
    // about this cell". Higher would silently hide regions, lower would make
    // every unmapped cell one.
    const table = parseRuleTable(SHEET, META);
    expect(thresholdFor(table, "walkable")).toBe(DEFAULT_THRESHOLD);
    expect(DEFAULT_THRESHOLD).toBe(1);
  });

  it("reads a per-category threshold row when the sheet declares one", () => {
    // Closes OsmToStoreConnectorV2.cs:151's open TODO — the reference had one
    // global threshold and a comment wishing for per-category ones.
    const withThresholds = `${SHEET}\n__threshold__,,,,,,,25,4`;
    const table = parseRuleTable(withThresholds, META);
    expect(thresholdFor(table, "battleArea")).toBe(25);
    expect(thresholdFor(table, "walkable")).toBe(4);
  });

  it("does not turn the threshold row into a rule", () => {
    const withThresholds = `${SHEET}\n__threshold__,,,,,,,25,4`;
    const table = parseRuleTable(withThresholds, META);
    expect(table.rules["__threshold__"]).toBeUndefined();
  });
});

describe("rows the parser refuses are COUNTED, not dropped", () => {
  it("counts rows with an empty id", () => {
    // 8 such rows exist on the live sheet — spacers and notes. Not an error, but
    // the number must be visible rather than mysterious.
    const withBlanks = `${SHEET}\n,,,,,,,,\n,,,,,,,,`;
    const table = parseRuleTable(withBlanks, META);
    expect(table.skipped.filter((s) => s.id === "(empty)")).toHaveLength(2);
  });

  it("counts a row that scores nothing anywhere", () => {
    const withDud = `${SHEET}\nfoo_bar,_,foo,bar,,,Nothing.,,`;
    const table = parseRuleTable(withDud, META);
    expect(table.skipped.some((s) => s.id === "foo_bar")).toBe(true);
    expect(table.rules["foo_bar"]).toBeUndefined();
  });

  it("counts a row whose field count disagrees with the header", () => {
    const withShort = `${SHEET}\nshort_row,_,short`;
    const table = parseRuleTable(withShort, META);
    expect(table.skipped.some((s) => s.reason.includes("fields"))).toBe(true);
  });

  it("rejects an absurdly long column name rather than accepting it", () => {
    // Ported from OsmRules.EnsureFieldNamesValid. A 40+ char column name means
    // the CSV is not the sheet we think it is — most likely an HTML error page
    // that happened to contain commas.
    const bad = `id,${"x".repeat(41)},walkable\na,1,2`;
    expect(() => parseRuleTable(bad, META)).toThrow(/40/);
  });
});

describe("ruleTableKeys — what the Overpass filter should cover", () => {
  it("extracts the OSM key from each rule id, splitting on the FIRST underscore", () => {
    // An OSM value may itself contain underscores: `surface_fine_gravel` is
    // key `surface`, value `fine_gravel`. Splitting on the last underscore, or
    // on all of them, silently produces keys that match nothing.
    const table = parseRuleTable(
      [
        "id,Key,Value,walkable",
        "surface_fine_gravel,surface,fine_gravel,5",
        "landuse_farmyard,landuse,farmyard,2",
      ].join("\n"),
      META,
    );
    expect(ruleTableKeys(table)).toEqual(["landuse", "surface"]);
  });

  it("is sorted and deduplicated, so it is stable to check in", () => {
    const table = parseRuleTable(SHEET, META);
    const keys = ruleTableKeys(table);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("an over-long column name is recorded, not silently dropped", () => {
  /**
   * WHY THIS MATTERS. The 40-char field-name check throws loudly; the 20-char
   * category check used to `continue` with nothing recorded anywhere. A sheet
   * edit adding a legitimately numeric column with a 21–40 char name would be
   * treated as "not a category", and every cell would then score the identity
   * for it — indistinguishable from unmapped ground, which is the failure mode
   * this module makes visible everywhere else (see the `Count` blacklist and
   * the "absent is not zero" rule).
   */
  it("names the column and the reason in `skipped`", () => {
    const longName = "a".repeat(25);
    const table = parseRuleTable(
      [`id,Key,Value,walkable,${longName}`, `k_a,k,a,5,9`].join("\n"),
      { source: "test", fetchedAt: 0 },
    );

    expect(table.categories).toEqual(["walkable"]);
    expect(
      table.skipped.some(
        (s) => s.id.includes(longName) && /20-char/.test(s.reason),
      ),
    ).toBe(true);
  });

  it("still accepts a name exactly at the limit", () => {
    const atLimit = "b".repeat(20);
    const table = parseRuleTable(
      [`id,Key,Value,${atLimit}`, `k_a,k,a,5`].join("\n"),
      { source: "test", fetchedAt: 0 },
    );
    expect(table.categories).toEqual([atLimit]);
  });
});
