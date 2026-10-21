/**
 * `creator-codes.ts`: the one owner of the codes while authoring (code book
 * refactor plan M4a). Every creator module reads and writes the code in
 * hand, its measurement, the visit's sightings and the levels a Finish
 * wrote through it; the session fields are a mirror only it writes.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { wireCreatorCodes } from "./creator-codes.js";
import {
  hostedLevels,
  selectTourDocument,
  tourDocumentActions,
} from "./tour-document.js";
import { createTourViewerSession } from "./tour-viewer-session.js";
import { tourOf } from "./test-support/v3-tour.js";
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

  // Why this test matters: a null level empties the hand and keeps the
  // book - the composed tests' way to empty the hand without a new print
  // size (no production caller since M6 follow-ups #10).
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
  // Why these tests matter (the M5d + S2 milestone review's #1): before
  // the first Finish the book does not hold the hosted texts, so a stored
  // code this page only KEPT at its hosted pose looked changed live, and a
  // draft's newer measurement of it was dropped - from the hand and from
  // the book alike. Liveness is judged against the open tour's texts.
  it("restores a draft's newer text into the hand over a code only kept at its hosted pose", () => {
    const ctx = createTourViewerSession();
    const hosted = { id: "a", json: levelJson(47.5) };
    ctx.currentLevelTexts = new Map([["a", hosted.json]]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand(hosted, null);
    codes.setInHand(
      { id: "b", json: levelJson(47.6) },
      { ...MEASUREMENT, levelId: "b" },
    );
    codes.clearInHand();
    const drafted = { id: "a", json: levelJson(47.45) };
    codes.restoreLevels([drafted]);
    expect(codes.restoreInHand(drafted)).toBe(true);
    expect(codes.inHand()).toEqual(drafted);
    expect(codes.toWrite()).toEqual([drafted]);
  });

  it("restores a draft's newer text into the book for a kept code not in hand", () => {
    const ctx = createTourViewerSession();
    const hosted = { id: "a", json: levelJson(47.5) };
    ctx.currentLevelTexts = new Map([["a", hosted.json]]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand(hosted, null);
    const other = { id: "c", json: levelJson(47.7) };
    codes.setInHand(other, { ...MEASUREMENT, levelId: "c" });
    const drafted = { id: "a", json: levelJson(47.45) };
    codes.restoreLevels([drafted]);
    expect(codes.savedText("a")).toBe(drafted.json);
    expect(codes.inHand()).toEqual(other);
  });

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

describe("creator-codes: the open tour's codes come from the store (plan M3b)", () => {
  // Why this test matters (the r902 review #4): the numbering, the
  // references and the stored-pose question read the parsed levels from
  // the session, not from the store that holds the tour's other codes, so
  // the hosted levels lived twice and a store-only reader saw no tour
  // codes. They read the store's now, the open's own.
  it("numbers, lists and counts the store's parsed levels of the open", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    ctx.store.dispatch(
      tourDocumentActions.levelsParsed({
        session: ctx.openGeneration,
        levels: [
          { id: "h", level: hostedLevel(47.3) },
          { id: "nogeo", level: hostedLevel(null) },
        ],
      }),
    );
    expect(codes.numbering()).toEqual(["h", "nogeo"]);
    expect(codes.references().map((r) => r.levelId)).toEqual(["h", "nogeo"]);
    expect(codes.hasStoredPose("h")).toBe(true);
    expect(codes.hasStoredPose("nogeo")).toBe(false);
  });

  // Why this test matters: the session's levels are a view of the store,
  // so the viewer pipeline and the codes can never read two different
  // tours' levels; an assignment lands in the store for the running open.
  it("makes the session's levels a view of the store", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevels = new Map([["h", hostedLevel(47.3)]]);
    const held = hostedLevels(selectTourDocument(ctx.store.getState()));
    expect([...(held?.keys() ?? [])]).toEqual(["h"]);
    expect(ctx.currentLevels).toBe(held);
    ctx.currentLevels = null;
    expect(ctx.currentLevels).toBeNull();
  });
});

describe("creator-codes: a settle's codes, and its undo (plan M3b, Q-D)", () => {
  function settled() {
    const ctx = createTourViewerSession();
    let heard = 0;
    const codes = wireCreatorCodes({
      ctx,
      onIdsChanged: () => {
        heard += 1;
      },
    });
    ctx.tourDocument.open(tourOf([]));
    return { ctx, codes, heard: () => heard };
  }
  const a1 = { id: "a", json: levelJson(47.5) };
  const a2 = { id: "a", json: levelJson(47.6) };
  const b = { id: "b", json: levelJson(47.7) };

  // Why this test matters: a settle saves its re-minted codes with its
  // document changes as ONE step; the hand takes a code's new text only if
  // it held that code (as `saveLevel` did), and a code that joins the
  // book is heard by the print panel as by any other door.
  it("saves the settle's codes with its changes, the hand following its own code, a joining code heard", () => {
    const { ctx, codes, heard } = settled();
    codes.setInHand(a1, MEASUREMENT);
    const past = ctx.tourDocument.state().past.length;
    codes.applySettle(ctx.tourDocument.settleBatch(), [a2, b], "the settle");
    expect(codes.inHand()).toEqual(a2);
    expect(codes.savedText("b")).toBe(b.json);
    expect(ctx.tourDocument.state().past.length).toBe(past + 1);
    expect(heard()).toBe(2);
  });

  // Why this test matters: the hand's text wins at every change of the
  // book, so an undo that only put the book back would see the improved
  // text return at the next write. The undo makes the hand let go of the
  // code it took back, its measurement with it.
  it("lets the hand go of a code the undo took back", () => {
    const { ctx, codes } = settled();
    codes.setInHand(a1, MEASUREMENT);
    codes.applySettle(ctx.tourDocument.settleBatch(), [a2], "the settle");
    expect(ctx.tourDocument.undo().kind).toBe("undone");
    expect(codes.inHand()).toBeNull();
    expect(codes.measurement()).toBeNull();
    expect(codes.savedText("a")).toBe(a1.json);
    codes.saveLevel(b);
    expect(codes.savedText("a"), "and nothing puts it back").toBe(a1.json);
  });

  // Why this test matters: only the codes the undo changed are let go - a
  // hand on another code is live work the undo says nothing about.
  it("keeps a hand of a code the undo did not change", () => {
    const { ctx, codes } = settled();
    codes.setInHand(a1, MEASUREMENT);
    codes.applySettle(ctx.tourDocument.settleBatch(), [b], "the settle");
    ctx.tourDocument.undo();
    expect(codes.inHand()).toEqual(a1);
    expect(codes.measurement()).toBe(MEASUREMENT);
    expect(codes.savedText("b")).toBeNull();
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

  // Why these tests matter (PR #568 review): a draft offered when the
  // tour opens holds work that was never published - newer than the hosted
  // text. A code the hand only KEPT at its hosted pose is no live work, so
  // the draft's text takes the hand as well as the book (the hand's text
  // used to be put straight back, before and after a Finish alike); a code
  // the hand changed live keeps its live text.
  it("restores a draft's newer text into the hand that holds the kept code", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevelTexts = new Map([["h", levelJson(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "h", json: levelJson(47.3) }, null);
    const drafted = { id: "h", json: levelJson(47.39) };
    codes.restoreLevels([drafted]);
    expect(codes.restoreInHand(drafted)).toBe(false);
    expect(codes.inHand()).toEqual(drafted);
    expect(codes.toWrite()).toEqual([drafted]);
  });

  it("restores it after a Finish too", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevelTexts = new Map([["h", levelJson(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "h", json: levelJson(47.3) }, null);
    codes.finished([]);
    const drafted = { id: "h", json: levelJson(47.39) };
    codes.restoreLevels([drafted]);
    expect(codes.inHand()).toEqual(drafted);
    expect(codes.toWrite()).toEqual([drafted]);
  });

  it("keeps the hand's live text over a draft's", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevelTexts = new Map([["h", levelJson(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    const live = { id: "h", json: levelJson(47.31) };
    codes.setInHand(live, { ...MEASUREMENT, levelId: "h" });
    codes.restoreLevels([{ id: "h", json: levelJson(47.39) }]);
    expect(codes.inHand()).toEqual(live);
    expect(codes.toWrite()).toEqual([live]);
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

describe("creator-codes: the page hears when the set of codes changes (follow-up F16)", () => {
  // Why this test matters: the print panel numbers the next code after the
  // tour's codes, but it read them once per open - codes restored from a
  // draft or measured later left the numbering and the spelling behind, so
  // a new poster could repeat a code's number.
  it("says so when a code joins, by a measurement or a restored draft, and not otherwise", () => {
    const ctx = createTourViewerSession();
    let heard = 0;
    const codes = wireCreatorCodes({
      ctx,
      onIdsChanged: () => {
        heard += 1;
      },
    });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    expect(heard).toBe(1);
    // The same code again: the set did not change.
    codes.setInHand({ id: "a", json: levelJson(47.6) }, MEASUREMENT);
    expect(heard).toBe(1);
    codes.restoreLevels([{ id: "b", json: levelJson(47.7) }]);
    expect(heard).toBe(2);
    expect(codes.ids().sort()).toEqual(["a", "b"]);
  });
});

// --- Characterization before the codes move into the store ------------------
// Plan GpsPlusSlamJs_Docs/docs/2026-10-20-1159-debug-captures-and-codes-in-store-plan.md
// M3a: these pin TODAY's rules of the closure state, green by design, so
// the move into the Redux store cannot change any of them silently. Each
// names the line of `creator-codes.ts` it rests on.

/** Ops a property drives the module with; texts repeat on purpose, so a
 *  sequence can return a code to an earlier (or the hosted) text. */
type CodesOp =
  | {
      kind: "measure" | "keep" | "save" | "restoreHand";
      id: string;
      v: number;
    }
  | { kind: "restore"; levels: { id: string; v: number }[] }
  | { kind: "drop"; id: string }
  | { kind: "clear" | "finish" | "levelsArrive" };

function codesOps(ids: readonly string[]): fc.Arbitrary<CodesOp> {
  const id = fc.constantFrom(...ids);
  return fc.oneof(
    fc.record({
      kind: fc.constantFrom(
        "measure" as const,
        "keep" as const,
        "save" as const,
        "restoreHand" as const,
      ),
      id,
      v: fc.nat(2),
    }),
    fc.record({
      kind: fc.constant("restore" as const),
      levels: fc.array(fc.record({ id, v: fc.nat(2) }), { maxLength: 3 }),
    }),
    fc.record({ kind: fc.constant("drop" as const), id }),
    fc.record({
      kind: fc.constantFrom(
        "clear" as const,
        "finish" as const,
        "levelsArrive" as const,
      ),
    }),
  );
}

/** The level texts a property's ops produce: "a0" and "b0" are the
 *  hosted ones `levelsArrive` installs. */
const opText = (id: string, v: number): string => `${id}${String(v)}`;

function applyCodesOp(
  ctx: ReturnType<typeof createTourViewerSession>,
  codes: ReturnType<typeof wireCreatorCodes>,
  o: CodesOp,
): void {
  if (o.kind === "measure") {
    codes.setInHand(
      { id: o.id, json: opText(o.id, o.v) },
      { ...MEASUREMENT, levelId: o.id },
    );
  } else if (o.kind === "keep") {
    codes.setInHand({ id: o.id, json: opText(o.id, o.v) }, null);
  } else if (o.kind === "save") {
    codes.saveLevel({ id: o.id, json: opText(o.id, o.v) });
  } else if (o.kind === "restoreHand") {
    codes.restoreInHand({ id: o.id, json: opText(o.id, o.v) });
  } else if (o.kind === "restore") {
    codes.restoreLevels(
      o.levels.map((l) => ({ id: l.id, json: opText(l.id, l.v) })),
    );
  } else if (o.kind === "drop") {
    codes.dropMeasurement(o.id);
  } else if (o.kind === "clear") {
    codes.clearInHand();
  } else if (o.kind === "finish") {
    codes.finished(codes.toWrite());
  } else {
    ctx.currentLevelTexts = new Map([
      ["a", "a0"],
      ["b", "b0"],
    ]);
  }
}

describe("creator-codes: the hand's text wins in the book (setBook, creator-codes.ts:173-185)", () => {
  // Why this test matters: a measurement dropped for a new print size
  // falls the book back to the zip's text (`withoutMeasurement`); for the
  // code still in hand `setBook` puts the hand's text straight back, or
  // the next Finish would write a pose the hand no longer agrees with.
  it("keeps the hand's text, and its reference, when the hand's measurement is dropped", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevelTexts = new Map([["a", levelJson(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    const live = { id: "a", json: levelJson(47.5) };
    codes.setInHand(live, MEASUREMENT);
    codes.dropMeasurement("a");
    expect(codes.inHand()).toEqual(live);
    expect(codes.savedText("a")).toBe(live.json);
    expect(codes.references()[0]?.levelId).toBe("a");
    expect(codes.toWrite()).toEqual([live]);
    // The book entry's measurement went, though: `measuredIn` reads it,
    // while the hand's own measurement is a separate field the drop leaves.
    expect(codes.measuredIn("a", 0)).toBe(false);
    expect(codes.measurement()).toBe(MEASUREMENT);
  });

  // Why this test matters: `setBook` is the one write of the book, and its
  // rule is that the book never holds another text for the code in hand
  // than the hand does - whatever wrote the book (a restore, a dropped
  // measurement, a re-mint, a Finish, the levels arriving). The store's
  // reducers will be several; this law is what they must keep together.
  it("never lets the book and the hand disagree about the code in hand, for any sequence (property)", () => {
    fc.assert(
      fc.property(
        fc.array(codesOps(["a", "b", "c"]), { maxLength: 20 }),
        (ops) => {
          const ctx = createTourViewerSession();
          const codes = wireCreatorCodes({ ctx });
          for (const o of ops) {
            applyCodesOp(ctx, codes, o);
            const hand = codes.inHand();
            const held = hand === null ? null : codes.savedText(hand.id);
            expect(held).toBe(hand?.json ?? null);
            const first =
              hand === null ? null : (codes.references()[0]?.levelId ?? null);
            expect(first).toBe(hand?.id ?? null);
          }
        },
      ),
    );
  });
});

type LiveOp =
  { kind: "measure"; id: string; v: number } | { kind: "clear" | "finish" };

/** Drive `ops`, keeping the model beside them: the live text per code,
 *  voided by a new print size (`clearInHand`), and the code in hand. */
function liveWork(
  codes: ReturnType<typeof wireCreatorCodes>,
  ops: readonly LiveOp[],
): { live: Map<string, string>; hand: string | null } {
  const live = new Map<string, string>();
  let hand: string | null = null;
  for (const o of ops) {
    if (o.kind === "measure") {
      const json = `live-${opText(o.id, o.v)}`;
      codes.setInHand({ id: o.id, json }, { ...MEASUREMENT, levelId: o.id });
      live.set(o.id, json);
      hand = o.id;
    } else if (o.kind === "clear") {
      codes.clearInHand();
      if (hand !== null) live.delete(hand);
      hand = null;
    } else {
      codes.finished(codes.toWrite());
    }
  }
  return { live, hand };
}

describe("creator-codes: live work wins over a draft restore (creator-codes.ts:227-235, :309-325)", () => {
  // Why this test matters: a draft is offered after the tour opened, so a
  // code measured in this page since is newer than anything the draft
  // holds. Whatever the creator measured (and did not void by a new print
  // size), neither restore - the book's (`restoreLevels`) nor the hand's
  // (`restoreInHand`) - may put the draft's older text over it; every code
  // without live work takes the draft's.
  it("keeps every live measurement and takes the draft's text for every other code, for any sequence (property)", () => {
    const ids = fc.constantFrom("a", "b", "c");
    const op: fc.Arbitrary<LiveOp> = fc.oneof(
      fc.record({
        kind: fc.constant("measure" as const),
        id: ids,
        v: fc.nat(2),
      }),
      fc.record({ kind: fc.constantFrom("clear" as const, "finish" as const) }),
    );
    const draftOf = fc.uniqueArray(fc.record({ id: ids, v: fc.nat(2) }), {
      selector: (l) => l.id,
      minLength: 1,
      maxLength: 3,
    });
    fc.assert(
      fc.property(
        fc.array(op, { maxLength: 12 }),
        draftOf,
        fc.boolean(),
        (ops, drafted, hostedKnown) => {
          const ctx = createTourViewerSession();
          if (hostedKnown) {
            ctx.currentLevelTexts = new Map([
              ["a", "a0"],
              ["b", "b0"],
            ]);
          }
          const codes = wireCreatorCodes({ ctx });
          const { live, hand } = liveWork(codes, ops);
          const levels = drafted.map((l) => ({
            id: l.id,
            json: `draft-${opText(l.id, l.v)}`,
          }));
          codes.restoreLevels(levels);
          const first = levels[0]!;
          expect(codes.restoreInHand(first)).toBe(hand === null);
          for (const l of levels) {
            expect(codes.savedText(l.id)).toBe(live.get(l.id) ?? l.json);
          }
          for (const [id, json] of live) {
            expect(codes.savedText(id)).toBe(json);
          }
          // The hand: the live code it held, else the draft's code, at its
          // live text if it has one.
          const handId = hand ?? first.id;
          expect(codes.inHand()).toEqual({
            id: handId,
            json: live.get(handId) ?? first.json,
          });
        },
      ),
    );
  });
});

describe("creator-codes: two baselines, kept apart (code-book.ts:83-85, :199-219)", () => {
  // Why this test matters: `toWrite` asks the zip the next Finish rebuilds
  // from (the last Finish's text, else the hosted one), `notHosted` asks
  // the hosted file only. After a Finish wrote a code, the next Finish has
  // nothing to write for it, but the draft must keep it until the creator
  // uploads that file - a crash in between otherwise loses the measurement.
  it("leaves a Finish's code out of the next Finish, and keeps it in the draft", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevelTexts = new Map([["h", levelJson(47.3)]]);
    const codes = wireCreatorCodes({ ctx });
    const improved = { id: "h", json: levelJson(47.31) };
    codes.setInHand(improved, { ...MEASUREMENT, levelId: "h" });
    expect(codes.toWrite()).toEqual([improved]);
    expect(codes.notHosted()).toEqual([improved]);
    codes.finished(codes.toWrite());
    expect(codes.toWrite()).toEqual([]);
    expect(codes.notHosted()).toEqual([improved]);
    // Back to the hosted text after that Finish: the zip holds the
    // improvement, so it is written again, while the hosted file already
    // holds this text and the draft has nothing to keep.
    const back = { id: "h", json: levelJson(47.3) };
    codes.saveLevel(back);
    expect(codes.toWrite()).toEqual([back]);
    expect(codes.notHosted()).toEqual([]);
  });
});

describe("creator-codes: the hosted baseline is read lazily (withHostedTexts, creator-codes.ts:188-190)", () => {
  // Why these tests matter: the tour's level files arrive AFTER the open
  // (archive-open.ts reads them beside tour.json), and this module holds
  // no copy of them before a Finish: each `toWrite`/`notHosted` reads
  // `ctx.currentLevelTexts` as it stands, and the restores judge live work
  // against it at their call. The store must keep that (plan M3a): a code
  // the hand only kept is "nothing new" once the levels land, whenever
  // they land.
  it("counts a code kept at its hosted text as new until the levels arrive, and as unchanged after", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const hosted = { id: "h", json: levelJson(47.3) };
    codes.setInHand(hosted, null);
    // Unknown so far: written, to be safe.
    expect(codes.toWrite()).toEqual([hosted]);
    expect(codes.notHosted()).toEqual([hosted]);
    ctx.currentLevelTexts = new Map([["h", hosted.json]]);
    expect(codes.toWrite()).toEqual([]);
    expect(codes.notHosted()).toEqual([]);
  });

  it("judges a draft restore by the levels as they stand at the restore", () => {
    // Before the levels: the kept code looks changed live, so the draft's
    // text does not take it. After them: it is no live work, and does.
    const hosted = { id: "h", json: levelJson(47.3) };
    const drafted = { id: "h", json: levelJson(47.39) };
    const other = { id: "o", json: levelJson(47.6) };

    const early = createTourViewerSession();
    const before = wireCreatorCodes({ ctx: early });
    before.setInHand(hosted, null);
    before.setInHand(other, null);
    before.restoreLevels([drafted]);
    expect(before.savedText("h"), "levels not arrived yet").toBe(hosted.json);

    const late = createTourViewerSession();
    const after = wireCreatorCodes({ ctx: late });
    after.setInHand(hosted, null);
    after.setInHand(other, null);
    late.currentLevelTexts = new Map([["h", hosted.json]]);
    after.restoreLevels([drafted]);
    expect(after.savedText("h"), "levels arrived").toBe(drafted.json);
  });

  // Why this test matters, and a difference from the plan: today a failed
  // level read (archive-open.ts:589-603) sets only `ctx.levelsUnreadable`
  // and leaves `ctx.currentLevelTexts` null, and this module reads no
  // failure flag. So nothing is ever compared with a hosted text: every
  // saved code counts as one to write and one the draft keeps, a draft's
  // code identical to the unreadable file included. The plan's
  // `levelsUnreadable` action ("nothing counts as new") must either keep
  // this or change it on purpose; this test pins what the code does now.
  it("after a failed level read, counts every saved code as new, against no hosted text", () => {
    const ctx = createTourViewerSession();
    ctx.levelsUnreadable = true;
    const codes = wireCreatorCodes({ ctx });
    const drafted = { id: "h", json: levelJson(47.3) };
    codes.restoreLevels([drafted]);
    expect(codes.restoreInHand(drafted)).toBe(true);
    expect(codes.toWrite()).toEqual([drafted]);
    expect(codes.notHosted()).toEqual([drafted]);
  });

  // Why this test matters: a Finish takes the hosted texts INTO the book
  // (`finished` -> `afterFinish(withHostedTexts(), ...)`, creator-codes.ts:
  // 326-328); before it the book holds none. From then on the book knows
  // a code's hosted text even without the level read's map.
  it("takes the hosted texts into the book at a Finish", () => {
    const ctx = createTourViewerSession();
    const hosted = levelJson(47.3);
    ctx.currentLevelTexts = new Map([["h", hosted]]);
    const codes = wireCreatorCodes({ ctx });
    codes.setInHand({ id: "h", json: hosted }, null);
    codes.finished([]);
    ctx.currentLevelTexts = null;
    expect(codes.toWrite()).toEqual([]);
    expect(codes.notHosted()).toEqual([]);
  });
});

describe("creator-codes: what a visit's end and a tour's close clear (creator-codes.ts:329-340)", () => {
  // Why these tests matter (plan M3a): the store splits this state into
  // a part cleared per visit and a part cleared per tour. Today
  // a visit's end clears ONLY the sightings (odometry does not carry
  // over); the hand, its measurement, the book and every code's
  // measurement survive into the next visit of the same tour.
  it("clears only the sightings at a visit's end", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const a = { id: "a", json: levelJson(47.5) };
    const b = { id: "b", json: levelJson(47.6) };
    const bMeasured = { ...MEASUREMENT, levelId: "b", visit: 3 };
    codes.setInHand(a, { ...MEASUREMENT, visit: 3 });
    codes.setInHand(b, bMeasured);
    codes.setSighting({ ...SIGHTING, levelId: "b" });
    codes.noteStoredSighting("h", 3, SIGHTING);
    codes.endVisit();
    expect(codes.sighting()).toBeNull();
    expect([...codes.storedSightings()]).toEqual([]);
    expect(codes.inHand()).toEqual(b);
    expect(codes.measurement()).toEqual(bMeasured);
    expect(codes.measuredIn("a", 3)).toBe(true);
    expect(codes.visitCodes(3).map((c) => c.level.id)).toEqual(["a", "b"]);
    expect(codes.toWrite()).toEqual([a, b]);
  });

  // Why this test matters: a tour's close drops the hand, its measurement,
  // every code's measurement and what this page's Finishes wrote. The
  // finished texts are the subtle one: if they survived, the next tour's
  // first Finish would skip a code whose text a Finish of the CLOSED tour
  // happened to write.
  it("clears the hand, the measurements and the finished texts at a tour's close", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    const a = { id: "a", json: levelJson(47.5) };
    codes.setInHand(a, { ...MEASUREMENT, visit: 2 });
    codes.finished(codes.toWrite());
    expect(codes.toWrite()).toEqual([]);
    codes.reset();
    expect(codes.inHand()).toBeNull();
    expect(codes.measurement()).toBeNull();
    expect(codes.measuredIn("a", 2)).toBe(false);
    expect(codes.visitCodes(2)).toEqual([]);
    expect(codes.ids()).toEqual([]);
    expect(codes.numbering()).toEqual([]);
    expect(codes.notHosted()).toEqual([]);
    // The same text again in the next tour: written, no Finish wrote it.
    codes.setInHand(a, { ...MEASUREMENT, visit: 0 });
    expect(codes.toWrite()).toEqual([a]);
  });

  // Why this test matters: today the close leaves the sightings to the
  // visit's end (creator-codes.ts:334-336: a tour cannot close inside a
  // visit), so the two resets do not overlap. Pinned so a reducer for the
  // close does not quietly take over the visit's part, or the reverse.
  it("leaves the sightings to the visit's end at a tour's close", () => {
    const ctx = createTourViewerSession();
    const codes = wireCreatorCodes({ ctx });
    codes.setSighting(SIGHTING);
    codes.noteStoredSighting("h", 1, SIGHTING);
    codes.reset();
    expect(codes.sighting()).toEqual(SIGHTING);
    expect([...codes.storedSightings()]).toEqual([
      { visit: 1, sighting: SIGHTING },
    ]);
  });
});

describe("creator-codes: the measurements per measured code (visitCodes/measuredIn, creator-codes.ts:267-287, :307-308)", () => {
  // Why this test matters: the settle reads a visit's codes from here,
  // and the store will hold the per-code measurements in its own slice.
  // The rules: a measured code is listed once even when it was also
  // sighted as stored; a sighting of another visit is not listed; a
  // sighted code takes the book's saved text over the hosted file's, and
  // one with no text anywhere is left out; a dropped measurement is not
  // "measured in" any visit, and its code is no longer listed as measured.
  it("lists each code once, by its own visit, at the book's text", () => {
    const ctx = createTourViewerSession();
    ctx.currentLevelTexts = new Map([
      ["kept", levelJson(47.1)],
      ["hosted", levelJson(47.2)],
    ]);
    const codes = wireCreatorCodes({ ctx });
    const m = { id: "m", json: levelJson(47.5) };
    codes.setInHand(m, { ...MEASUREMENT, levelId: "m", visit: 4 });
    const keptBetter = { id: "kept", json: levelJson(47.15) };
    codes.saveLevel(keptBetter);
    codes.noteStoredSighting("m", 4, SIGHTING);
    codes.noteStoredSighting("kept", 4, SIGHTING);
    codes.noteStoredSighting("hosted", 4, SIGHTING);
    codes.noteStoredSighting("other-visit", 3, SIGHTING);
    codes.noteStoredSighting("no-text", 4, SIGHTING);
    expect(
      codes
        .visitCodes(4)
        .map((c) => [c.level.id, c.level.json, c.measurement?.visit ?? null]),
    ).toEqual([
      ["m", m.json, 4],
      ["kept", keptBetter.json, null],
      ["hosted", levelJson(47.2), null],
    ]);
    expect(codes.measuredIn("m", 4)).toBe(true);
    expect(codes.measuredIn("m", 3)).toBe(false);
    expect(codes.measuredIn("kept", 4)).toBe(false);
    codes.setInHand(null, null);
    codes.dropMeasurement("m");
    expect(codes.measuredIn("m", 4)).toBe(false);
    // Its sighting of this visit remains, but it has no saved text left
    // (no Finish or hosted file holds it): not listed at all.
    expect(codes.visitCodes(4).map((c) => c.level.id)).toEqual([
      "kept",
      "hosted",
    ]);
  });
});

describe("creator-codes: the print panel hears only a change of the SET of ids (setBook, creator-codes.ts:179-184)", () => {
  // Why these tests matter (follow-up F16): the print panel renumbers on
  // this signal (main.ts `onCodesChanged` -> `presentTourCodes`), which
  // runs a spelling search over the codes - so it must fire when a code
  // joins and never for a change of a known code's text. A store
  // subscription that fired on every book change would rerun that search
  // on every re-mint.
  it("stays quiet for a re-mint, a kept code, a dropped measurement, a Finish, a restore of known codes and a cleared hand", () => {
    const ctx = createTourViewerSession();
    let heard = 0;
    const codes = wireCreatorCodes({
      ctx,
      onIdsChanged: () => {
        heard += 1;
      },
    });
    const a = { id: "a", json: levelJson(47.5) };
    codes.setInHand(a, MEASUREMENT);
    expect(heard).toBe(1);
    codes.saveLevel({ id: "a", json: levelJson(47.51) });
    codes.setInHand(a, null);
    codes.dropMeasurement("a");
    codes.finished(codes.toWrite());
    codes.restoreLevels([{ id: "a", json: levelJson(47.52) }]);
    codes.clearInHand();
    codes.restoreInHand({ id: "a", json: levelJson(47.53) });
    expect(heard).toBe(1);
    // A new code by any door is heard: a re-mint of an unknown code, the
    // hand restored from a draft.
    codes.saveLevel({ id: "b", json: levelJson(47.6) });
    expect(heard).toBe(2);
    codes.clearInHand();
    codes.restoreInHand({ id: "c", json: levelJson(47.7) });
    expect(heard).toBe(3);
  });

  // Why this test matters: the close empties the book without `setBook`
  // (creator-codes.ts:339), so it is NOT heard here; the print panel
  // learns of a closed tour through its own `presentNoTour`. Pinned so the
  // store's close does not start renumbering a panel that has no tour.
  it("is not heard at a tour's close, and the same id after it joins again", () => {
    const ctx = createTourViewerSession();
    let heard = 0;
    const codes = wireCreatorCodes({
      ctx,
      onIdsChanged: () => {
        heard += 1;
      },
    });
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    codes.reset();
    expect(heard).toBe(1);
    codes.setInHand({ id: "a", json: levelJson(47.5) }, MEASUREMENT);
    expect(heard).toBe(2);
  });

  it("is heard exactly when a code joins, for any sequence (property)", () => {
    fc.assert(
      fc.property(
        fc.array(codesOps(["a", "b", "c", "d"]), { maxLength: 20 }),
        (ops) => {
          const ctx = createTourViewerSession();
          let heard = 0;
          const codes = wireCreatorCodes({
            ctx,
            onIdsChanged: () => {
              heard += 1;
            },
          });
          for (const o of ops) {
            const before = new Set(codes.ids());
            const heardBefore = heard;
            applyCodesOp(ctx, codes, o);
            const after = codes.ids();
            // No op of an open tour takes a code out of the book.
            expect(after.length).toBeGreaterThanOrEqual(before.size);
            const joined = after.some((id) => !before.has(id));
            expect(heard - heardBefore).toBe(joined ? 1 : 0);
          }
        },
      ),
    );
  });
});
