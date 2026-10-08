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
  // Why this test matters: every creator module reads the code in hand,
  // its measurement and the visit's sighting through this module, so what
  // it was given is what it must hand back - and a cleared hand drops the
  // measurement with the code.
  it("holds the code in hand, its measurement and the sighting", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const level = { id: "a", json: levelJson(47.5) };
    codes.setInHand(level, MEASUREMENT);
    codes.setSighting(SIGHTING);
    expect(codes.inHand()).toEqual(level);
    expect(codes.measurement()).toEqual(MEASUREMENT);
    expect(codes.sighting()).toEqual(SIGHTING);
    codes.clearInHand();
    expect(codes.inHand()).toBeNull();
    expect(codes.measurement()).toBeNull();
  });

  // Why this test matters (code book plan M5d, the review's #2): "the
  // measurement" is the HAND's, not the book entry's. A code taken as a
  // stored reference has none, even when the book still holds one from
  // an earlier visit - two readers (the settle's size and its re-mint)
  // do not filter by visit.
  it("gives no measurement for a code taken as a reference, whatever the book holds", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const a = { id: "a", json: levelJson(47.5) };
    codes.setInHand(a, MEASUREMENT);
    codes.setInHand({ id: "b", json: levelJson(47.6) }, null);
    codes.setInHand(a, null);
    expect(codes.measurement()).toBeNull();
    expect(codes.measuredIn("a", 0)).toBe(true);
  });

  // Why this test matters: a failed identity hands back an empty hand
  // (`creator-measuring.ts`); the book keeps what it holds.
  it("empties the hand on a null level and keeps the book", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    codes.setInHand(null, null);
    expect(codes.inHand()).toBeNull();
    expect(codes.measurement()).toBeNull();
    expect(codes.ids()).toEqual(["a"]);
  });

  // Why this test matters: a restored draft hands its level back only when
  // nothing is in hand - a live measurement is newer (`creator-draft.ts`).
  it("restores a draft's level only into an empty hand", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const drafted = { id: "d", json: levelJson(47.4) };
    expect(codes.restoreInHand(drafted)).toBe(true);
    expect(codes.inHand()).toEqual(drafted);
    const live = { id: "a", json: levelJson(47.5) };
    codes.setInHand(live, MEASUREMENT);
    expect(codes.restoreInHand(drafted)).toBe(false);
    expect(codes.inHand()).toEqual(live);
  });

  // Why this test matters (DEC-A3, found by the M5d-2 review, #9a): a live
  // measurement is newer than a draft. A code measured in this page and
  // then put down (the hand moved on and was emptied by a new print size)
  // keeps its live text when the draft restores the book's codes - and
  // it must keep it when the draft also hands it back into the empty
  // hand, or the next Finish writes the draft's older pose under this
  // page's measurement.
  it("restores a draft's code into the hand at its live text", () => {
    const codes = wireCreatorCodes({ ctx: createTourViewerSession() });
    const live = { id: "a", json: levelJson(47.5) };
    codes.setInHand(live, MEASUREMENT);
    codes.setInHand({ id: "b", json: levelJson(47.6) }, null);
    codes.clearInHand();
    const drafted = { id: "a", json: levelJson(47.4) };
    codes.restoreLevels([drafted]);
    expect(codes.restoreInHand(drafted)).toBe(true);
    expect(codes.inHand()).toEqual(live);
    expect(codes.savedText("a")).toBe(live.json);
  });

  // Why this test matters: the settle re-mints the code in hand through
  // `saveLevel` (code book plan M5d: one write for every re-mint) and keeps
  // its measurement (the settle re-mints FROM it).
  it("re-mints the level in hand through saveLevel and keeps its measurement", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    const reminted = { id: "a", json: levelJson(47.6) };
    codes.saveLevel(reminted);
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

  // Why this test matters (M4 milestone review #1): measuring asks
  // `hasStoredPose` whether a code it sees is a reference to keep or a
  // code to measure. A code this page measured, after another one took the
  // hand, must stay a reference - else a later visit re-measures it through
  // its own GPS and replaces the pose its notes were placed against.
  it("counts a code of the book as stored, and hands out its saved text", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const a = { id: "a", json: levelJson(47.5) };
    codes.setInHand(a, MEASUREMENT);
    codes.setInHand(
      { id: "b", json: levelJson(47.6) },
      { ...MEASUREMENT, levelId: "b" },
    );
    expect(codes.hasStoredPose("a")).toBe(true);
    expect(codes.savedText("a")).toBe(a.json);
    expect(codes.hasStoredPose("z")).toBe(false);
    expect(codes.savedText("z")).toBeNull();
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
    codes.saveLevel(improved);
    expect(codes.toWrite()).toEqual([improved]);
  });

  // Why this test matters (code book plan M5d, the review's #1): the
  // code in hand's text wins for its own code. A draft restored after a
  // Finish would otherwise replace the hand's code with the draft's older
  // measurement, and the settle would correct through it.
  it("keeps the code in hand's text over a draft's", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevelTexts = new Map([["h", levelJson(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    const hosted = { id: "h", json: levelJson(47.3) };
    codes.setInHand(hosted, null);
    codes.finished([]);
    codes.restoreLevels([{ id: "h", json: levelJson(47.39) }]);
    expect(codes.inHand()).toEqual(hosted);
    expect(codes.savedText("h")).toBe(hosted.json);
    expect(codes.toWrite()).toEqual([]);
  });

  // Why this test matters: the book belongs to the tour - a closed tour's
  // codes must not be written into the next tour's zip, and its code in
  // hand must not be the next tour's either (M5 review #9; since M5d-2 the
  // close reaches the hand only through here).
  it("empties the book and the hand when the tour closes", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    codes.reset();
    expect(codes.toWrite()).toEqual([]);
    expect(codes.inHand()).toBeNull();
    expect(codes.measurement()).toBeNull();
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

describe("creator-codes: one numbering for every label (code book plan M5b)", () => {
  // Why this test matters: "Code 2" was the index in an order that put the
  // code in hand first, so a code's number changed whenever another code
  // took the hand - the summary and the panel could name the same code
  // differently. The tour's own codes come first in the tour's order, then
  // the codes this page added, in the order it took them.
  it("numbers the tour's codes first, then this page's, whatever is in hand", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevels = new Map([
      ["h1", hostedLevel(47.1)],
      ["h2", hostedLevel(47.2)],
    ]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "n1", json: levelJson(47.5) }, MEASUREMENT);
    const before = codes.numbering();
    codes.setInHand(
      { id: "n2", json: levelJson(47.6) },
      { ...MEASUREMENT, levelId: "n2" },
    );
    codes.setInHand({ id: "h2", json: levelJson(47.2) }, null);
    expect(before).toEqual(["h1", "h2", "n1"]);
    expect(codes.numbering()).toEqual(["h1", "h2", "n1", "n2"]);
  });

  // Why this test matters (M5b review #6): a code with no saved pose (one
  // this page measured, then voided by a size adoption before any Finish)
  // is not among the summary's references, so numbering it shifted every
  // later code's number between the panel and the summary.
  it("leaves out a code with no saved pose", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "x", json: levelJson(47.5) }, MEASUREMENT);
    codes.setInHand(
      { id: "y", json: levelJson(47.6) },
      { ...MEASUREMENT, levelId: "y" },
    );
    codes.dropMeasurement("x");
    expect(codes.savedText("x")).toBeNull();
    expect(codes.numbering()).toEqual(["y"]);
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
    codes.setInHand({ id: "b", json: levelJson(47.6) }, null);
    expect(codes.ids()).toEqual(["a", "b"]);
  });
});
