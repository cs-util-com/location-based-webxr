/**
 * Why these tests matter: the printed code may point at the hosted file
 * before the creator's first Finish, so a visitor can open a zip without
 * `tour.json`, or a tour without stations. That is the normal order of
 * making a tour, so the visitor is told plainly that it is not finished
 * (with whom to ask, when the tour names a contact), and the creator is
 * told what a visitor reads and what finishes it - never an error, and
 * never content a visitor of a finished tour would not see.
 */
import { describe, expect, it } from "vitest";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { tourOf } from "./test-support/tour-of.js";
import {
  NOT_FINISHED,
  notFinishedSentence,
  tourUnfinished,
  unfinishedNote,
} from "./tour-unfinished.js";

const pin = {
  id: "p1",
  kind: "shortText",
  view: "pin",
  caption: "Gate",
  geo: { lat: 47, lon: 8, alt: 400, rotation: [0, 0, 0, 1] },
  createdAtIso: "2026-10-20T00:00:00.000Z",
} as unknown as TourObject;

describe("tourUnfinished", () => {
  it("is a zip without tour.json, or a tour without stations", () => {
    expect(tourUnfinished(null)).toBe(true);
    expect(tourUnfinished(tourOf([]))).toBe(true);
    // A tour with a station is finished, even one whose station holds only
    // a pin.
    expect(tourUnfinished(tourOf([pin]))).toBe(false);
  });
});

describe("notFinishedSentence", () => {
  it("says the tour is not finished, and whom to ask when it names a contact", () => {
    expect(notFinishedSentence(undefined)).toBe(
      "This tour is not finished yet.",
    );
    expect(notFinishedSentence("mailto:guide@example.org")).toBe(
      "This tour is not finished yet. Questions about this tour? Contact its maker: guide@example.org",
    );
    // A contact a visitor may not follow is not named.
    expect(notFinishedSentence("javascript:alert(1)")).toBe(NOT_FINISHED);
  });
});

describe("unfinishedNote", () => {
  it("tells the creator what a visitor reads while the hosted file is unfinished", () => {
    expect(unfinishedNote(null)).toContain(`"${NOT_FINISHED}"`);
    expect(unfinishedNote(tourOf([]))).toContain(`"${NOT_FINISHED}"`);
    expect(unfinishedNote(tourOf([pin]))).toBeNull();
  });
});
