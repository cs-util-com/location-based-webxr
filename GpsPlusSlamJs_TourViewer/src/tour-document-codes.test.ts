/**
 * The tour document's codes (debug-captures plan M3a): the code book and
 * the hosted level texts it is judged against, in the store. The phone
 * reads `tour.json` and the levels concurrently, so either may land first;
 * the hosted texts are held per open, never reset by `opened`.
 */

import { describe, expect, it } from "vitest";
import { createEmptyTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  codeSavedText,
  documentCodes,
  hostedLevelTexts,
  hostedLevelsUnreadable,
  initialTourDocumentState,
  levelsNotHosted,
  levelsToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import type { CodeMeasurement } from "./visit-settle.js";

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

  // Why this test matters: `setBook`'s rule moved into the reducers - the
  // book never holds another text for the code in hand than the hand does,
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
