/**
 * The terrain lab's committed fixtures: their budget and their provenance
 * (terrain plan 2026-09-27-0605 §9 finding 6, DEC-TR-8).
 *
 * Why this file matters: the repo is public and every clone carries these
 * bytes forever. The owner set the budget (5 MB for all four places, the
 * Appalachians about 1.5 MB), and nothing else guards a directory's total:
 * the repo checks single files only. A tile without a provenance line is a
 * tile nobody can re-fetch or re-license.
 */
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** DEC-TR-8: every place's fixtures together. */
const ALL_PLACES_BUDGET_BYTES = 5_000_000;
/** Each place's share (the T1 brief: about 1.5 MB or less). */
const PLACE_BUDGET_BYTES = 1_500_000;
/** Each place's committed z8 tiles (fixtures/PROVENANCE.md). */
const PLACES = {
  appalachians: /^terrarium\/8\/7[0-2]\/9[7-9]\.png$/,
  alps: /^terrarium\/8\/13[3-5]\/(89|9[01])\.png$/,
};

/** Every file under a directory, as posix paths relative to FIXTURES. */
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    return d.isDirectory()
      ? files(path)
      : [
          {
            rel: relative(FIXTURES, path).split(sep).join("/"),
            bytes: statSync(path).size,
          },
        ];
  });
}

describe("the terrain fixtures", () => {
  const all = files(FIXTURES);
  const tiles = all.filter((f) => f.rel.endsWith(".png"));
  const total = (list) => list.reduce((sum, f) => sum + f.bytes, 0);

  // Non-vacuous: each place's nine z8 tiles are here, and no tile belongs
  // to no place.
  for (const [id, pattern] of Object.entries(PLACES)) {
    it(`holds the ${id} place's nine tiles`, () => {
      assert.equal(tiles.filter((f) => pattern.test(f.rel)).length, 9);
    });
  }
  it("holds no tile outside the places", () => {
    const stray = tiles.filter(
      (f) => !Object.values(PLACES).some((p) => p.test(f.rel)),
    );
    assert.deepEqual(stray, []);
  });

  it(`stays within the ${ALL_PLACES_BUDGET_BYTES} byte budget for all places`, () => {
    assert.ok(total(all) <= ALL_PLACES_BUDGET_BYTES, `${total(all)} bytes`);
  });

  for (const [id, pattern] of Object.entries(PLACES)) {
    it(`keeps the ${id} place within ${PLACE_BUDGET_BYTES} bytes`, () => {
      const own = tiles.filter((f) => pattern.test(f.rel));
      assert.ok(total(own) <= PLACE_BUDGET_BYTES, `${total(own)} bytes`);
    });
  }

  // Plan §9 finding 6: real fixtures at z8 or coarser only.
  it("holds no real tile finer than z8", () => {
    for (const { rel } of tiles) {
      const z = Number(rel.split("/")[1]);
      assert.ok(z <= 8, rel);
    }
  });

  it("names every tile in PROVENANCE.md with its size", () => {
    const provenance = readFileSync(join(FIXTURES, "PROVENANCE.md"), "utf8");
    for (const { rel, bytes } of tiles) {
      assert.ok(provenance.includes(`\`${rel}\`: ${bytes} bytes`), rel);
    }
  });
});
