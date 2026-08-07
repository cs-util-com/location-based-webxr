/**
 * Ignored-tag list tests.
 *
 * Why these tests matter:
 * This list has no effect on any score — it exists so the "unmapped tag"
 * diagnostic stays readable. Its failure mode is therefore not a wrong answer
 * but an abandoned tool: if `addr:housenumber`, `source` and `name` are in the
 * output, nobody reads the output, and the rule table stops improving. The
 * assertions below are about keeping the signal-to-noise ratio, plus one guard
 * against the list quietly swallowing something that matters.
 *
 * @see ignored-tags.ts.md
 */

import { describe, it, expect } from "vitest";
import {
  isIgnoredTagKey,
  interestingUnmappedTags,
  IGNORED_TAG_PREFIXES,
} from "./ignored-tags.js";

describe("the noise the C# reference specifically named", () => {
  it.each([
    "addr:housenumber",
    "addr:street",
    "source",
    "source:date",
    "name",
    "name:de",
    "alt_name",
    "maxspeed",
    "operator",
    "brand",
    "religion",
    "denomination",
    "wikidata",
    "wikipedia",
    "website",
    "cuisine",
    "surveillance",
    "building:levels",
    "roof:shape",
    "opening_hours",
    "admin_level",
    "start_date",
  ])("ignores %s", (key) => {
    expect(isIgnoredTagKey(key)).toBe(true);
  });
});

describe("what must NOT be swallowed", () => {
  it.each([
    "highway",
    "surface",
    "landuse",
    "natural",
    "leisure",
    "amenity",
    "barrier",
    "wheelchair",
    "playground",
    "waterway",
    "sport",
    "tourism",
  ])("keeps %s visible", (key) => {
    // These are the keys the rule table actually scores on. A prefix that
    // accidentally matched one of them would hide exactly the tags worth
    // learning from — the diagnostic's whole purpose inverted.
    expect(isIgnoredTagKey(key)).toBe(false);
  });

  it("keeps an unknown key visible, because unknown is the interesting case", () => {
    expect(isIgnoredTagKey("some_new_osm_key")).toBe(false);
  });

  it("keeps a mixed-case key visible", () => {
    // OSM keys are lowercase by convention, so a mixed-case one is unexpected —
    // and unexpected is precisely what the diagnostic is for.
    expect(isIgnoredTagKey("Surface")).toBe(false);
  });
});

describe("interestingUnmappedTags", () => {
  it("strips the noise and keeps the candidates, preserving counts", () => {
    expect(
      interestingUnmappedTags({
        "addr:housenumber": 412,
        source: 88,
        name: 350,
        tactile_paving: 7,
        some_new_key: 3,
      }),
    ).toEqual({ tactile_paving: 7, some_new_key: 3 });
  });

  it("returns an empty object when everything was noise", () => {
    expect(interestingUnmappedTags({ name: 1, source: 2 })).toEqual({});
  });

  it("handles an empty input", () => {
    expect(interestingUnmappedTags({})).toEqual({});
  });
});

describe("the list itself", () => {
  it("has no duplicates", () => {
    expect(new Set(IGNORED_TAG_PREFIXES).size).toBe(
      IGNORED_TAG_PREFIXES.length,
    );
  });

  it("contains no empty prefix, which would ignore every tag", () => {
    // A single empty string here would silence the entire diagnostic, and
    // nothing else would fail.
    expect(IGNORED_TAG_PREFIXES).not.toContain("");
    for (const prefix of IGNORED_TAG_PREFIXES) {
      expect(prefix.trim()).not.toBe("");
    }
  });
});
