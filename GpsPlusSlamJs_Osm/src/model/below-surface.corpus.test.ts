/**
 * How much of the REAL corpus does `isBelowSurface` reach?
 *
 * WHY THIS EXISTS. Applying the predicate moved the corpus score distribution a
 * long way — the walkable median went from below the multiplicative identity to
 * tens — and a change that large is as consistent with an over-broad predicate
 * (the mirror bug: silently deleting real ground) as with a real fix. The plan
 * flagged "not measured over the corpus" as an honest gap; this closes it.
 *
 * It asserts a BAND rather than a number. The point is not the exact share, it
 * is that the share stays plausible: a predicate reaching a few percent of
 * features is doing what it was designed for, and one reaching a third of them
 * has stopped being about underground structures.
 */

import { describe, expect, it } from "vitest";

import { isBelowSurface } from "./below-surface.js";
import { parseOverpassJson } from "./overpass-parser.js";
import { CORPUS_SITES } from "../places/sites.js";
import { loadSite } from "../test-utils/load-fixtures.js";

/** Which tag made each flagged feature below-surface, for the diagnosis. */
function reasonFor(tags: Record<string, string | undefined>): string {
  if (tags["tunnel"] !== undefined) return `tunnel=${tags["tunnel"]}`;
  if (tags["location"] === "underground") return "location=underground";
  if (tags["layer"] !== undefined) return "layer";
  if (tags["level"] !== undefined) return "level";
  return "other";
}

describe("isBelowSurface over the corpus", () => {
  it("flags a small minority of features, not a large share", () => {
    let total = 0;
    let below = 0;
    const reasons = new Map<string, number>();

    for (const site of CORPUS_SITES) {
      for (const feature of parseOverpassJson(loadSite(site.id).payload)
        .features) {
        total += 1;
        if (!isBelowSurface(feature)) continue;
        below += 1;
        const reason = reasonFor(feature.tags);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }

    expect(total).toBeGreaterThan(1000);

    // THE BAND. Below-surface structures are real and not rare — culverts alone
    // number in the millions across OSM — but they are a minority of mapped
    // features anywhere. A predicate crossing 20% is not describing what it
    // claims to.
    const share = below / total;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.2);
  });
});
