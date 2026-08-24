/**
 * Why this test matters: `isBridgeCrossing` decides where a river bank may be
 * opened (DEC-R1). A wrong `true` puts an agent on open water; a wrong `false`
 * leaves a shipped picker location unroutable. Three earlier formulations of the
 * rule were each refuted against this exact fixture, and each time by reading
 * the tags rather than by reasoning — so the rule is pinned against the real
 * data, not only against hand-written cases in `roads.test.ts`.
 *
 * The counts are the assertion. They would have caught every one of the three
 * refuted drafts:
 *
 * - `bridge=yes` alone → 8 of 14, missing Tower Bridge's own bascule spans.
 * - bare `bridge=*` → 18, opening the bank along two closed structural areas
 *   whose `min_height` is 40 m.
 * - "the deck is a highway" → 16, admitting two walkways 43 m in the air.
 */

import { describe, expect, it } from "vitest";

import { isBridgeCrossing } from "./roads.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";

describe("isBridgeCrossing over the Tower Bridge corpus", () => {
  const { features } = parseOverpassJson(
    loadSite("london-tower-bridge").payload,
  );
  const bridgeTagged = features.filter(
    (feature) =>
      feature.type !== "node" &&
      (feature.tags as Record<string, string> | undefined)?.["bridge"] !==
        undefined,
  );

  it("selects exactly the ground-level decks", () => {
    // 18 ways carry a `bridge` tag; 14 of them are ground-level decks an agent
    // could walk. The other four are the two `layer=2` high walkways and the two
    // `building:part` structural areas.
    expect(bridgeTagged).toHaveLength(18);
    expect(bridgeTagged.filter(isBridgeCrossing)).toHaveLength(14);
  });

  it("keeps the bascule spans, which a `bridge=yes` rule would drop", () => {
    const chosen = bridgeTagged.filter(isBridgeCrossing);
    const values = new Set(
      chosen.map(
        (feature) =>
          (feature.tags as Record<string, string>)["bridge"] as string,
      ),
    );
    // Both values must survive: `movable` is Tower Bridge's opening deck.
    expect(values).toEqual(new Set(["yes", "movable"]));
  });

  it("rejects every way that is not at ground level or carries no way", () => {
    for (const feature of bridgeTagged.filter((f) => !isBridgeCrossing(f))) {
      const tags = feature.tags as Record<string, string>;
      const highLevel =
        tags["layer"] !== undefined && Number(tags["layer"]) > 1;
      const noWay = tags["highway"] === undefined;
      expect(
        highLevel || noWay,
        `${String(feature.id)} was rejected for neither reason`,
      ).toBe(true);
    }
  });
});
