import { describe, expect, it } from "vitest";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS_SITES } from "../../places/sites.js";
import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";

const SITES_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * WHY THESE TESTS MATTER (W2). A fixture corpus fails in exactly one way that
 * matters: it looks complete and is not. Every assertion downstream then passes
 * vacuously — over five sites instead of six, or over an extract that parsed to
 * zero features — and the suite reports green while covering nothing. That is
 * the same silent-absence shape that let a scene-wide shader outage survive ten
 * work items in round 2, and it is why these are asserted rather than assumed.
 *
 * They also pin the corpus to the shared table (DEC-R4-11): a site added to
 * `places/sites.ts` without an extract fails here, and an extract captured from
 * a stale or hand-edited table fails the centre comparison rather than shipping
 * the wrong place under the right name.
 */
describe("the six site extracts", () => {
  it.each(CORPUS_SITES.map((site) => [site.id, site] as const))(
    "%s has an extract that matches its table entry",
    (_id, site) => {
      const extract = loadSite(site.id);

      // Captured where the table says, at the resolution the table says. This
      // is the guard against a capture taken before a table edit: the extract
      // would otherwise be a real, valid capture of the WRONG place, which is
      // undetectable by any assertion about its contents.
      expect(extract.centre.lat).toBeCloseTo(site.position.lat, 6);
      expect(extract.centre.lng).toBeCloseTo(site.position.lng, 6);
      expect(extract.captureRes).toBe(site.captureRes);
    },
  );

  it.each(CORPUS_SITES.map((site) => [site.id] as const))(
    "%s parses into a non-trivial feature set",
    (id) => {
      const extract = loadSite(id);
      const parsed = parseOverpassJson(extract.payload);

      // NOT just "parses". An empty extract parses perfectly, and every later
      // geometry assertion over it would pass — which is precisely the vacuous
      // green this corpus exists to make impossible.
      expect(parsed.features.length).toBeGreaterThan(50);
      expect(
        parsed.features.some((f) => f.tags["building"] !== undefined),
      ).toBe(true);
    },
  );

  it.each(CORPUS_SITES.map((site) => [site.id] as const))(
    "%s stays small enough to live in the repo",
    (id) => {
      const bytes = statSync(join(SITES_DIR, `${id}.json`)).size;
      // 2 MB per site. The ceiling is the reason the non-areal relation filter
      // exists at all: the unfiltered res-9 cathedral capture was 24.6 MB, of
      // which 97 % was international train-route relations the package turns
      // into no geometry whatsoever. Committing six of those would add ~100 MB
      // to a repository whose entire fixture corpus is under 7 MB.
      expect(bytes).toBeLessThan(2 * 1024 * 1024);
    },
  );

  it("records what each extract dropped, rather than dropping it silently", () => {
    for (const site of CORPUS_SITES) {
      const extract = loadSite(site.id);
      // The count may legitimately be zero (a site nowhere near a rail hub),
      // so this asserts the field EXISTS rather than that it is positive. A
      // missing field would mean the extract predates the filter and is
      // therefore an unfiltered capture wearing a filtered capture's name.
      expect(typeof extract.droppedNonArealRelations).toBe("number");
      expect(extract.droppedNonArealRelations).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps no relation the package cannot turn into geometry", () => {
    // The filter's contract, checked against the shipped data rather than
    // against the script that produced it. If the script's predicate ever
    // drifts from the package's, this fails on the next re-capture.
    for (const site of CORPUS_SITES) {
      const extract = loadSite(site.id);
      const elements = (
        extract.payload as {
          elements?: readonly { type: string; tags?: Record<string, string> }[];
        }
      ).elements;
      const badRelations = (elements ?? []).filter(
        (element) =>
          element.type === "relation" &&
          !["multipolygon", "boundary"].includes(element.tags?.["type"] ?? ""),
      );
      expect(badRelations).toHaveLength(0);
    }
  });

  it("captures the cathedral wide enough to contain the cathedral", () => {
    // The one site-specific assertion, and the reason `captureRes` is per site
    // at all: Cologne Cathedral's footprint is 144 x 86 m and a res-10 cell is
    // ~114 m across the flats. An extract that clips the building under
    // investigation cannot answer the question it was captured for.
    const extract = loadSite("cologne-cathedral");
    const widthM =
      (extract.bbox.east - extract.bbox.west) *
      111_320 *
      Math.cos((extract.centre.lat * Math.PI) / 180);
    const heightM = (extract.bbox.north - extract.bbox.south) * 110_540;
    expect(widthM).toBeGreaterThan(200);
    expect(heightM).toBeGreaterThan(200);
  });
});
