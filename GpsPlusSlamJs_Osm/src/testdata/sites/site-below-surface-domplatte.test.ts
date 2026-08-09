import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { isBelowSurface } from "../../model/below-surface.js";
import { isRoad } from "../../mesh/roads.js";
import { scoreFeature } from "../../score/affordance-scorer.js";
import { snapshotRuleTable } from "../../rules/rule-table-loader.js";
import type { OsmFeature } from "../../model/osm-feature.js";

/**
 * WHY THIS TEST MATTERS. The owner reported (openTodos) that a way *underneath*
 * the Cologne Domplatte was making the heat tile above it read as not walkable,
 * and proposed the blunt fix: **ignore everything carrying a `layer` tag**.
 *
 * The report named a specific way, so it can be checked rather than argued
 * about — and both halves of it are worth pinning:
 *
 * 1. **The symptom is already fixed.** `way/32555488` is the "fiktiver Weg
 *    durch das Parkhaus unter der Domplatte" — `highway=service`,
 *    `service=parking_aisle`, `layer=-1`, `tunnel=yes`. It is excluded twice
 *    over: `isBelowSurface` makes its score factor the multiplicative identity,
 *    and `isRoad` refuses it so it is never drawn. It cannot pull a cell down.
 * 2. **The proposed fix would have been wrong**, and this is the more valuable
 *    half. "Ignore everything with a `layer` tag" would also delete every
 *    `layer > 0` feature — more than twice as many as the below-ground ones at
 *    Cologne (the exact split is asserted below rather than repeated here).
 *    Bridges and elevated walkways are real, walkable surfaces; suppressing them
 *    is the "nothing looks broken, there is simply less map" failure
 *    `below-surface.ts` warns about. The sign of the layer is what carries the
 *    meaning, not its presence.
 *
 * Pinned as counts so a fixture re-capture reports the change rather than
 * hiding it.
 *
 * @see ../../model/below-surface.ts.md
 */

const TABLE = snapshotRuleTable();

const COLOGNE = [
  ...parseOverpassJson(loadSite("cologne-cathedral").payload).features,
];

function feature(id: string): OsmFeature {
  const found = COLOGNE.find((f) => String(f.id) === id);
  if (found === undefined) throw new Error(`way/${id} is not in the fixture`);
  return found;
}

describe("below-surface ways under the Domplatte", () => {
  it("excludes the reported parking aisle from scoring and from drawing", () => {
    const aisle = feature("32555488");

    // The tags the report turns on — if a re-capture changes these, the rest of
    // this test is about a different way and should be re-read, not re-baselined.
    expect(aisle.tags["layer"]).toBe("-1");
    expect(aisle.tags["tunnel"]).toBe("yes");
    expect(aisle.tags["service"]).toBe("parking_aisle");

    // Excluded from SCORING: 1 is the multiplicative identity in the scorer's
    // product, so this feature moves no cell in any direction.
    expect(isBelowSurface(aisle)).toBe(true);

    // Excluded from DRAWING, independently — `isRoad` refuses `tunnel=yes`.
    expect(isRoad(aisle)).toBe(false);
  });

  it("would score BELOW 1 for walkable if it were ever counted", () => {
    // THE TEETH OF THE FIRST TEST. Asserting "we skip it" is only meaningful if
    // counting it would actually have hurt: a parking aisle a lorry cannot walk
    // through scores as an obstruction, so had the below-surface rule not fired,
    // this really would have dragged the Domplatte cell down — exactly the
    // symptom reported. Without this, the skip could be vacuous.
    const aisle = feature("32555488");
    expect(scoreFeature(aisle, "walkable", TABLE)).toBeLessThan(1);
  });

  it("keeps ABOVE-ground layers scoring, which the proposed fix would have deleted", () => {
    // The counter-case to "ignore everything with a layer tag". Cologne carries
    // far more above-ground layered features than below-ground ones, and they
    // are ordinary walkable surfaces — the Domplatte itself is reached by them.
    let above = 0;
    let below = 0;
    for (const f of COLOGNE) {
      const raw = f.tags["layer"];
      if (raw === undefined) continue;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n === 0) continue;
      if (n > 0) above++;
      else below++;
    }

    expect({ above, below }).toEqual({ above: 131, below: 58 });

    // A NOTE ON THE OVERLAP, because it is not zero and that is easy to
    // misread: exactly one `layer > 0` feature at this site is still below-surface. That
    // is not a contradiction — `below-surface.ts` also reads `level`,
    // `location=underground` and subsurface `tunnel` values, so a way can be
    // above the datum on one tag and underground on another (an indoor stair
    // inside a raised structure, typically). The rule deliberately lets any one
    // of those signals win, which is why `layer` alone is the wrong lever.
    const aboveGround = COLOGNE.filter((f) => {
      const n = Number.parseInt(f.tags["layer"] ?? "", 10);
      return Number.isFinite(n) && n > 0;
    });
    const stillBelow = aboveGround.filter((f) => isBelowSurface(f)).length;
    expect(stillBelow).toBe(1);
  });
});
