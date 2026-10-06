/**
 * `creator-codes.ts`: the one owner of the codes while authoring (code book
 * refactor plan M4a). Every creator module reads and writes the code in
 * hand, its measurement, the visit's sightings and the levels a Finish
 * wrote through it; the session fields are a mirror only it writes.
 */

import { describe, expect, it } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { wireCreatorCodes } from "./creator-codes.js";
import { createTourViewerSession } from "./tour-viewer-session.js";
import type { CodeMeasurement, CodeSighting } from "./visit-settle.js";

/** A level text whose `storedGeo` reads (the parser's minimal shape). */
function levelJson(lat: number): string {
  return JSON.stringify({
    version: 1,
    qr: {
      text: "https://example.invalid/?qr=x",
      physicalSizeM: 0.16,
      geo: { lat, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
    },
  });
}

function hostedLevel(lat: number | null): QrLevel {
  return {
    qr: {
      text: "https://example.invalid/?qr=h",
      physicalSizeM: 0.16,
      ...(lat === null
        ? {}
        : { geo: { lat, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] } }),
    },
  } as unknown as QrLevel;
}

const MEASUREMENT: CodeMeasurement = {
  levelId: "a",
  text: "https://example.invalid/?qr=x",
  odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  sizeM: 0.16,
  visit: 0,
};

const SIGHTING: CodeSighting = {
  text: "https://example.invalid/?qr=x",
  levelId: "a",
  odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
};

describe("creator-codes: the code in hand", () => {
  // Why this test matters: `archive-open.ts` (the close) and `scan-open.ts`
  // still read the session fields until M5, so the owner must keep them
  // exactly in step with what it holds.
  it("mirrors the code in hand, its measurement and the sighting into the session", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const level = { id: "a", json: levelJson(47.5) };
    codes.setInHand(level, MEASUREMENT);
    codes.setSighting(SIGHTING);
    expect(ctx.mintedLevel).toBe(level);
    expect(ctx.codeMeasurement).toBe(MEASUREMENT);
    expect(ctx.visitCodeSighting).toBe(SIGHTING);
    expect(codes.inHand()).toBe(level);
    expect(codes.measurement()).toBe(MEASUREMENT);
    expect(codes.sighting()).toBe(SIGHTING);
    codes.clearInHand();
    codes.clearSighting();
    expect(ctx.mintedLevel).toBeNull();
    expect(ctx.codeMeasurement).toBeNull();
    expect(ctx.visitCodeSighting).toBeNull();
  });

  // Why this test matters: the archive's close clears the session fields
  // directly; the owner must read that, not a stale copy of its own.
  it("reads what the tour's close cleared", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    ctx.mintedLevel = null;
    ctx.codeMeasurement = null;
    expect(codes.inHand()).toBeNull();
    expect(codes.measurement()).toBeNull();
  });

  // Why this test matters: a restored draft hands its level back only when
  // nothing is in hand - a live measurement is newer (`creator-draft.ts`).
  it("restores a draft's level only into an empty hand", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const drafted = { id: "d", json: levelJson(47.4) };
    expect(codes.restoreInHand(drafted)).toBe(true);
    expect(codes.inHand()).toBe(drafted);
    const live = { id: "a", json: levelJson(47.5) };
    codes.setInHand(live, MEASUREMENT);
    expect(codes.restoreInHand(drafted)).toBe(false);
    expect(codes.inHand()).toBe(live);
  });

  // Why this test matters: the settle re-mints the code in hand and keeps
  // its measurement (the settle re-mints FROM it).
  it("re-mints the level in hand and keeps its measurement", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    const reminted = { id: "a", json: levelJson(47.6) };
    codes.remint(reminted);
    expect(codes.inHand()).toBe(reminted);
    expect(codes.measurement()).toBe(MEASUREMENT);
  });
});

describe("creator-codes: stored codes and what Finish wrote", () => {
  // Why this test matters: "a stored pose" decides whether a code in view
  // is a sighting for the visit log or a new code to measure.
  it("knows which codes have a stored pose: in hand, or in the open tour with a geo", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevels = new Map([
      ["h", hostedLevel(47.3)],
      ["nogeo", hostedLevel(null)],
    ]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, null);
    expect(codes.hasStoredPose("a")).toBe(true);
    expect(codes.hasStoredPose("h")).toBe(true);
    expect(codes.hasStoredPose("nogeo")).toBe(false);
    expect(codes.hasStoredPose("x")).toBe(false);
  });

  // Why this test matters: the summary and the object list both read every
  // code's stored pose - the code in hand first, then the tour's others,
  // and never the code in hand twice.
  it("lists every code's stored pose, the code in hand first and once", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevels = new Map([
      ["a", hostedLevel(47.0)],
      ["h", hostedLevel(47.3)],
      ["nogeo", hostedLevel(null)],
    ]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, null);
    const refs = codes.references();
    expect(refs.map((r) => r.levelId)).toEqual(["a", "h", "nogeo"]);
    expect(refs[0]!.geo?.lat).toBe(47.5);
    expect(refs[2]!.geo).toBeNull();
    expect(codes.storedPoses().map((g) => g.lat)).toEqual([47.5, 47.3]);
  });

  // Why this test matters (code book plan M4e): a code measured on this
  // page and then followed by another one leaves the hand, but it is still
  // a code of the tour - the next Finish writes it. The summary listed only
  // the code in hand and the hosted ones, so after measuring two new codes
  // it showed "The code" for one of them and nothing for the other; the
  // object list measured distances to one code only.
  it("lists every code of the book too, at its saved pose, before the hosted others", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevels = new Map([
      ["h", hostedLevel(47.3)],
      ["a", hostedLevel(47.0)],
    ]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    codes.setInHand(
      { id: "b", json: levelJson(47.6) },
      { ...MEASUREMENT, levelId: "b" },
    );
    const refs = codes.references();
    expect(refs.map((r) => r.levelId)).toEqual(["b", "a", "h"]);
    // The book's saved pose, not the hosted one it replaces.
    expect(refs[1]!.geo?.lat).toBe(47.5);
    expect(codes.storedPoses().map((g) => g.lat)).toEqual([47.6, 47.5, 47.3]);
  });

  // Why this test matters: a new code may take the hand only once the code
  // in hand is saved in the tour - hosted, or written by a Finish of this
  // page (U3 milestone review #7) - and the Finish's set goes with its tour.
  it("counts a code as saved when the tour hosts it or a Finish wrote it, until the tour closes", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevels = new Map([["h", hostedLevel(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    expect(codes.isSaved("h")).toBe(true);
    expect(codes.isSaved("a")).toBe(false);
    codes.finished([{ id: "a", json: levelJson(47.5) }]);
    expect(codes.isSaved("a")).toBe(true);
    codes.reset();
    expect(codes.isSaved("a")).toBe(false);
  });

  // Why this test matters: the visit log reads every stored code's latest
  // sighting of the visit; a visit's sightings must not leak into the next.
  it("keeps the latest sighting per stored code, tagged with its visit, until the visit ends", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.noteStoredSighting("h", 0, SIGHTING);
    const later = { ...SIGHTING, levelId: "h" };
    codes.noteStoredSighting("h", 0, later);
    expect([...codes.storedSightings()]).toEqual([
      { visit: 0, sighting: later },
    ]);
    codes.endVisit();
    expect([...codes.storedSightings()]).toEqual([]);
    expect(codes.sighting()).toBeNull();
  });
});

describe("creator-codes: the book of codes a Finish writes (M4c-1)", () => {
  // Why this test matters: each Finish wrote ONE level, the code in hand;
  // the book keeps every code this page took, and a Finish writes each one
  // whose saved text differs from what the zip it rebuilds from holds -
  // the last Finish's text, else the hosted one (M1 review #1).
  it("writes every code changed in this page, and after a Finish only what changed since", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevelTexts = new Map([["h", levelJson(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    const a = { id: "a", json: levelJson(47.5) };
    codes.setInHand(a, MEASUREMENT);
    expect(codes.toWrite()).toEqual([a]);
    codes.finished([a]);
    expect(codes.toWrite()).toEqual([]);
    expect(codes.isSaved("a")).toBe(true);
    const b = { id: "b", json: levelJson(47.6) };
    codes.setInHand(b, { ...MEASUREMENT, levelId: "b" });
    // Both are in the book; only B changed since the Finish.
    expect(codes.toWrite()).toEqual([b]);
    const a2 = { id: "a", json: levelJson(47.55) };
    codes.setInHand(a2, MEASUREMENT);
    // In the order the codes were first taken.
    expect(codes.toWrite()).toEqual([a2, b]);
  });

  // Why this test matters: a stored code kept as the reference (its saved
  // pose unchanged) is already in the zip - writing it again changes
  // nothing, and leaving it out keeps the Finish's file list honest.
  it("does not write a hosted code whose saved text is unchanged", () => {
    const ctx = createTourViewerSession();
    const hosted = levelJson(47.3);
    ctx.currentLevelTexts = new Map([["h", hosted]]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "h", json: hosted }, null);
    expect(codes.toWrite()).toEqual([]);
    const improved = { id: "h", json: levelJson(47.31) };
    codes.remint(improved);
    expect(codes.toWrite()).toEqual([improved]);
  });

  // Why this test matters: until M5 the session field is still written
  // from outside this module (the composed tests, and the tour's close),
  // so the book takes whatever is in hand when it is read.
  it("takes a level written straight into the session field into the book", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const a = { id: "a", json: levelJson(47.5) };
    ctx.mintedLevel = a;
    expect(codes.toWrite()).toEqual([a]);
  });

  // Why this test matters: the book belongs to the tour - a closed tour's
  // codes must not be written into the next tour's zip.
  it("empties the book when the tour closes", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    ctx.mintedLevel = null;
    codes.reset();
    expect(codes.toWrite()).toEqual([]);
  });
});

describe("creator-codes: the visit's codes for the settle (M4c-2)", () => {
  // Why this test matters: the settle can tie each note to the nearest
  // code event of ANY code of the visit (M4b), but only if it is handed
  // them: every code measured in this visit, and every stored code seen
  // stable in it - not only the code in hand.
  it("lists the codes measured in the visit and the stored codes sighted in it", () => {
    const ctx = createTourViewerSession();
    const hosted = levelJson(47.3);
    ctx.currentLevelTexts = new Map([["h", hosted]]);
    ctx.currentLevels = new Map([["h", hostedLevel(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    const a = { id: "a", json: levelJson(47.5) };
    const b = { id: "b", json: levelJson(47.6) };
    codes.setInHand(a, { ...MEASUREMENT, visit: 2 });
    codes.setInHand(b, { ...MEASUREMENT, levelId: "b", visit: 2 });
    codes.noteStoredSighting("h", 2, { ...SIGHTING, levelId: "h" });
    // An older visit's measurement is not this visit's code event.
    codes.setInHand(
      { id: "c", json: levelJson(47.7) },
      { ...MEASUREMENT, levelId: "c", visit: 1 },
    );
    codes.setInHand(b, { ...MEASUREMENT, levelId: "b", visit: 2 });
    const listed = codes.visitCodes(2);
    expect(
      listed.map((c) => [c.level.id, c.measurement?.visit ?? null]),
    ).toEqual([
      ["a", 2],
      ["b", 2],
      ["h", null],
    ]);
    expect(listed[2]!.level.json).toBe(hosted);
  });

  // Why this test matters: a visit that measured two codes re-mints both;
  // the one not in hand must be saved in the book without taking the hand.
  it("saves a re-minted code that is not in hand, without taking the hand", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const a = { id: "a", json: levelJson(47.5) };
    const b = { id: "b", json: levelJson(47.6) };
    codes.setInHand(a, MEASUREMENT);
    codes.setInHand(b, { ...MEASUREMENT, levelId: "b" });
    const a2 = { id: "a", json: levelJson(47.55) };
    codes.saveLevel(a2);
    expect(codes.inHand()).toBe(b);
    expect(codes.toWrite()).toEqual([a2, b]);
    expect(codes.inBook("a")).toBe(true);
    expect(codes.inBook("z")).toBe(false);
  });
});

describe("creator-codes: every code this page holds (M4d)", () => {
  // Why this test matters: the print step warns that printing a code would
  // strand the tour's MEASURED codes; it read only the hosted ones, so a
  // code measured on this page and not yet hosted went unwarned.
  it("lists every code of the book, the code in hand included", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    ctx.mintedLevel = { id: "b", json: levelJson(47.6) };
    expect(codes.ids()).toEqual(["a", "b"]);
  });
});
