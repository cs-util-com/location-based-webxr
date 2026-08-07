import { describe, expect, it } from "vitest";

import { CORPUS_SITES, siteById, type CorpusSite } from "./sites.js";

/**
 * WHY THESE TESTS MATTER. This table has two consumers that must never drift
 * apart (DEC-R4-11): the offline fixture suite captures an extract per entry,
 * and the demo's location picker offers the same entries to a human. A site
 * that exists in one and not the other reproduces exactly the condition that
 * produced the round-3 cathedral finding — the demo was only ever looked at in
 * one place, and that place was the only place the tests covered.
 *
 * So the assertions here are about the table being *usable as a key*: unique
 * ids, real coordinates, and a stated reason, because "why is this place in the
 * corpus" is the thing that gets lost first and is unrecoverable afterwards.
 */
describe("CORPUS_SITES", () => {
  it("has the six sites DEC-R4-2 asked for", () => {
    // SIX, not three. The owner widened this deliberately: the demo had been
    // tested at exactly one spot for three rounds, which is the condition that
    // produced the cathedral finding. A shrinking table is a decision being
    // quietly reversed, so the count is asserted rather than implied.
    expect(CORPUS_SITES).toHaveLength(6);
  });

  it("gives every site a unique id", () => {
    const ids = CORPUS_SITES.map((site) => site.id);
    // A duplicate id would make `siteById` return whichever came first and the
    // fixture capture overwrite one extract with another's data — silently, and
    // in a way that looks like the site simply has odd data.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses ids that are safe as filenames and URL parameters", () => {
    // The id becomes `src/testdata/sites/<id>.json` and is a candidate for a
    // URL parameter. Anything outside this class turns a path into a traversal
    // or a query string into a parse error.
    for (const site of CORPUS_SITES) {
      expect(site.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("places every site at real, in-range coordinates", () => {
    for (const site of CORPUS_SITES) {
      expect(Number.isFinite(site.position.lat)).toBe(true);
      expect(Number.isFinite(site.position.lng)).toBe(true);
      expect(Math.abs(site.position.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(site.position.lng)).toBeLessThanOrEqual(180);
      // 0,0 is the Gulf of Guinea and is what an unset pair looks like — the
      // same defect `parseStartPosition` guards against in the demo.
      expect(site.position.lat === 0 && site.position.lng === 0).toBe(false);
    }
  });

  it("states why each site is in the corpus", () => {
    for (const site of CORPUS_SITES) {
      expect(site.name.length).toBeGreaterThan(0);
      // The reason is the whole value of the table over a list of coordinates.
      // Without it a later reader cannot tell whether a site may be replaced.
      expect(site.reason.length).toBeGreaterThan(20);
    }
  });

  it("covers each of the six reasons exactly once", () => {
    // The six are a SPREAD, not a sample: each was chosen for a different way of
    // being awkward. Two sites sharing a trait would mean one of the six kinds
    // of awkwardness is untested while the table still looks complete.
    const traits = CORPUS_SITES.map((site) => site.trait).sort();
    expect(traits).toEqual([
      "coastline",
      "dense-highrise",
      "landmark-parts",
      "messy-tagging",
      "non-european-tagging",
      "relief",
    ]);
  });

  it("resolves a site by id and reports an unknown one as undefined", () => {
    const first = CORPUS_SITES[0] as CorpusSite;
    expect(siteById(first.id)).toBe(first);
    // `undefined` rather than a throw: the id may come from a URL, and an
    // unknown one means "fall back to the default", not "the app is broken".
    expect(siteById("nowhere-at-all")).toBeUndefined();
  });

  it("keeps the cathedral, because it is the open finding", () => {
    // R3-1/R4-7 cannot be diagnosed without this site's real tags. If it ever
    // leaves the table, the finding silently stops being reproducible.
    const cathedral = siteById("cologne-cathedral");
    expect(cathedral).toBeDefined();
    expect(cathedral?.trait).toBe("landmark-parts");
  });
});
