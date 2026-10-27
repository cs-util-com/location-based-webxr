/**
 * The tour document's codes (debug-captures plan M3a): the code book and
 * the hosted level texts it is judged against, in the store. The phone
 * reads `tour.json` and the levels concurrently, so either may land first;
 * the hosted texts are held per open, never reset by `opened`.
 */

import { describe, expect, it } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { createEmptyTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  codeSavedText,
  documentCodes,
  hostedLevels,
  hostedLevelTexts,
  hostedLevelsUnreadable,
  initialTourDocumentState,
  documentObjects,
  levelsNotHosted,
  levelsToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import type { CodeMeasurement } from "./visit-settle.js";
import { tourOf } from "./test-support/tour-of.js";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

const HOSTED = [{ id: "h", json: "hosted-h" }];

const MEASUREMENT: CodeMeasurement = {
  levelId: "m",
  text: "https://example.invalid/?qr=m",
  odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  sizeM: 0.16,
  visit: 0,
};

function run(...actions: Parameters<typeof reduce>[1][]): TourDocumentState {
  return actions.reduce(reduce, initialTourDocumentState);
}

const opened = act.opened({ manifest: createEmptyTourManifest() });

describe("the tour document's hosted level texts", () => {
  // Why this test matters (plan M3a, cold review #3): the levels and
  // `tour.json` are read concurrently, so the store must reach the same
  // state whichever lands first - an `opened` that reset the codes would
  // drop levels that arrived before it.
  it("holds the levels whichever lands first, the levels or the tour", () => {
    const levelsFirst = run(
      act.levelsCleared({ session: 1 }),
      act.levelsArrived({ session: 1, texts: HOSTED }),
      opened,
    );
    const tourFirst = run(
      act.levelsCleared({ session: 1 }),
      opened,
      act.levelsArrived({ session: 1, texts: HOSTED }),
    );
    for (const state of [levelsFirst, tourFirst]) {
      expect([...(hostedLevelTexts(state) ?? [])]).toEqual([["h", "hosted-h"]]);
      expect(hostedLevelsUnreadable(state)).toBe(false);
    }
  });

  // Why this test matters: a slow level read of a tour closed since must
  // not install its texts as the next tour's - every saved code of the
  // new tour would be judged against another tour's files.
  it("drops an older open's late levels, and a newer open's replace them", () => {
    const late = run(
      act.levelsCleared({ session: 2 }),
      act.levelsArrived({ session: 1, texts: HOSTED }),
    );
    expect(hostedLevelTexts(late)).toBeNull();
    const newer = run(
      act.levelsArrived({ session: 1, texts: HOSTED }),
      act.levelsArrived({ session: 2, texts: [{ id: "n", json: "next" }] }),
    );
    expect([...(hostedLevelTexts(newer) ?? [])]).toEqual([["n", "next"]]);
  });

  // Why this test matters: a failed read is its own state - the levels
  // never come, so the visitor's line says no code can place the tour -
  // and with no hosted text every saved code is one to write and one the
  // draft keeps (characterized in creator-codes.test.ts).
  it("says a failed read, and counts every saved code as new against no hosted text", () => {
    const failed = run(
      act.levelsCleared({ session: 1 }),
      act.levelsUnreadable({ session: 1 }),
      act.codeTaken({
        level: { id: "h", json: "hosted-h" },
        measurement: null,
      }),
    );
    expect(hostedLevelsUnreadable(failed)).toBe(true);
    expect(hostedLevelTexts(failed)).toBeNull();
    expect(levelsToWrite(failed)).toEqual([{ id: "h", json: "hosted-h" }]);
    expect(levelsNotHosted(failed)).toEqual([{ id: "h", json: "hosted-h" }]);
    const next = reduce(failed, act.levelsCleared({ session: 2 }));
    expect(hostedLevelsUnreadable(next)).toBe(false);
  });

  // Why this test matters: the map is read on every render (the Finish's
  // readiness, the print panel); one per change keeps a reader's identity
  // check meaningful.
  it("hands out the same map until the levels change", () => {
    const state = run(act.levelsArrived({ session: 0, texts: HOSTED }));
    expect(hostedLevelTexts(state)).toBe(hostedLevelTexts(state));
  });
});

describe("the tour document's parsed hosted levels (plan M3b)", () => {
  const level = (lat: number): QrLevel => ({
    version: 1,
    qr: { geo: { lat, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] } },
  });
  const ids = (state: TourDocumentState) => [
    ...(hostedLevels(state)?.keys() ?? []),
  ];

  // Why this test matters (the r902 review #4): the parsed levels - the
  // numbering's order and the hosted poses the codes read - lived on the
  // session beside the texts in the store, so the hosted levels were held
  // twice. In the store they follow the texts' rules: per open, in the
  // zip's order, in either order with the texts, never an older open's.
  it("holds the open's parsed levels in the zip's order, beside its texts in either order", () => {
    const parsed = act.levelsParsed({
      session: 1,
      levels: [
        { id: "b", level: level(47.2) },
        { id: "a", level: level(47.1) },
      ],
    });
    const arrived = act.levelsArrived({ session: 1, texts: HOSTED });
    for (const state of [
      run(act.levelsCleared({ session: 1 }), parsed, arrived),
      run(act.levelsCleared({ session: 1 }), arrived, parsed),
    ]) {
      expect(ids(state)).toEqual(["b", "a"]);
      expect(hostedLevels(state)?.get("a")?.qr.geo?.lat).toBe(47.1);
      expect([...(hostedLevelTexts(state) ?? [])]).toEqual([["h", "hosted-h"]]);
    }
  });

  // Why this test matters: a slow parse of a tour closed since must not
  // number the next tour's codes, and a newer open starts with none.
  it("drops an older open's parsed levels, and a newer open starts with none", () => {
    const late = run(
      act.levelsCleared({ session: 2 }),
      act.levelsParsed({ session: 1, levels: [{ id: "a", level: level(47) }] }),
    );
    expect(hostedLevels(late)).toBeNull();
    const next = run(
      act.levelsParsed({ session: 1, levels: [{ id: "a", level: level(47) }] }),
      act.levelsCleared({ session: 2 }),
    );
    expect(hostedLevels(next)).toBeNull();
    const cleared = run(
      act.levelsParsed({ session: 1, levels: [{ id: "a", level: level(47) }] }),
      act.levelsParsed({ session: 1, levels: null }),
    );
    expect(hostedLevels(cleared)).toBeNull();
  });

  // Why this test matters: the viewer pipeline reads the levels on every
  // frame through the session's view; one map per change keeps that cheap
  // and a reader's identity check meaningful.
  it("hands out the same map until the parsed levels change", () => {
    const state = run(
      act.levelsParsed({ session: 0, levels: [{ id: "a", level: level(47) }] }),
    );
    expect(hostedLevels(state)).toBe(hostedLevels(state));
  });
});

describe("a settle as one step of the document (plan M3b, Q-D)", () => {
  const PIN: TourObject = {
    id: "p",
    kind: "shortText",
    view: "pin",
    caption: "Gate",
    createdAtIso: "2026-10-21T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
  };
  const tourOpened = act.opened({ manifest: tourOf([PIN]) });
  const stored = { id: "c", json: "stored-c" };
  const improved = { id: "c", json: "improved-c" };
  const movedTo = {
    lat: 48.5201,
    lon: 9.0501,
    alt: 340,
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  };
  const settle = act.settleApplied({
    changes: [{ kind: "station", stationId: "st-p", geo: movedTo }],
    codes: [improved],
    hand: improved,
    what: "the settle of this visit",
  });
  const pinGeo = (state: TourDocumentState) =>
    documentObjects(state).find((o) => o.object.id === "p")?.object.geo;
  const stationGeo = (state: TourDocumentState) =>
    state.stations.find((s) => s.id === "st-p")?.geo;

  // Why this test matters: the settle moved every station and object as
  // an action of its own and saved the code outside the history, so an
  // undo took back the last move only and left the improved code. One
  // settle is one step: its undo takes back the stations, their items and
  // the code's text together, and its redo brings them back.
  it("moves the stations and saves the codes in one step, and its undo and redo take them all", () => {
    const before = run(
      tourOpened,
      act.codeTaken({ level: stored, measurement: null }),
    );
    const settled = reduce(before, settle);
    expect(settled.past).toHaveLength(before.past.length + 1);
    expect(settled.past.at(-1)?.what).toBe("the settle of this visit");
    expect(stationGeo(settled)).toEqual(movedTo);
    expect(pinGeo(settled)).not.toEqual(pinGeo(before));
    expect(codeSavedText(settled, "c")).toBe("improved-c");

    const undone = reduce(settled, act.undone());
    expect(stationGeo(undone)).toEqual(stationGeo(before));
    expect(pinGeo(undone)).toEqual(pinGeo(before));
    expect(codeSavedText(undone, "c")).toBe("stored-c");

    const redone = reduce(undone, act.redone());
    expect(stationGeo(redone)).toEqual(movedTo);
    expect(codeSavedText(redone, "c")).toBe("improved-c");
  });

  // Why this test matters: the codes take no history step of their own,
  // so a code measured again after the settle is newer work than the
  // step; the undo must not put the settle's earlier text over it.
  it("leaves a code changed since the settle as it is at the undo", () => {
    const remeasured = { id: "c", json: "remeasured-c" };
    const undone = run(
      tourOpened,
      act.codeTaken({ level: stored, measurement: null }),
      settle,
      act.codeTaken({ level: remeasured, measurement: MEASUREMENT }),
      act.undone(),
    );
    expect(codeSavedText(undone, "c")).toBe("remeasured-c");
    expect(stationGeo(undone)).not.toEqual(movedTo);
  });

  // Why this test matters: a visit whose settle moved nothing and saved
  // no new text takes no step, or an undo would take back nothing while
  // withdrawing the creator's last edit from reach.
  it("takes no step when it moves nothing and changes no code's text", () => {
    const before = run(
      tourOpened,
      act.codeTaken({ level: stored, measurement: null }),
    );
    const same = reduce(
      before,
      act.settleApplied({
        changes: [],
        codes: [stored],
        hand: stored,
        what: "the settle of this visit",
      }),
    );
    expect(same.past).toHaveLength(before.past.length);
    expect(same.revision).toBe(before.revision);
  });
});

describe("the tour document's code book", () => {
  // Why this test matters: the codes are no edit of the tour's content -
  // an undo takes back the creator's last edit, not a code's measurement
  // (that is M3b's one compound step) - and they outlive `opened` and
  // `closed`, which a draft restored before the manifest settled relies
  // on. Only `codesForgotten` (a tour's close) empties the book.
  it("takes no history step, survives opened, closed and an undo, and goes at codesForgotten", () => {
    const level = { id: "m", json: "measured-m" };
    const measured = run(
      opened,
      act.settingsChanged({ needsNoGps: true, what: "the setting" }),
      act.codeTaken({ level, measurement: MEASUREMENT }),
    );
    expect(measured.past).toHaveLength(1);
    expect(measured.revision).toBe(1);
    const undone = reduce(measured, act.undone());
    expect(undone.needsNoGps, "the undo took the setting back").toBe(false);
    for (const after of [
      undone,
      reduce(measured, opened),
      reduce(measured, act.closed()),
    ]) {
      expect(codeSavedText(after, "m")).toBe("measured-m");
    }
    const gone = reduce(measured, act.codesForgotten());
    expect(documentCodes(gone)).toEqual([]);
  });

  // Why this test matters: the rule of the module's one book write before
  // the store moved into the reducers (`withHand`) - the book never holds
  // another text for the code in hand than the hand does,
  // whichever action wrote it. The action names the hand after it.
  it("keeps the hand's text for its own code when a change would replace it", () => {
    const live = { id: "m", json: "measured-m" };
    const state = run(
      act.codeTaken({ level: live, measurement: MEASUREMENT }),
      act.codeMeasurementDropped({ levelId: "m", hand: live }),
    );
    expect(codeSavedText(state, "m")).toBe("measured-m");
    const without = run(
      act.codeTaken({ level: live, measurement: MEASUREMENT }),
      act.codeMeasurementDropped({ levelId: "m", hand: null }),
    );
    expect(codeSavedText(without, "m")).toBeNull();
  });
});
