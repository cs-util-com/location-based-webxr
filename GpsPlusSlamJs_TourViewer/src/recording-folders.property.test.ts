/**
 * The cleanup bound as properties, over any mix of saved, unsaved and empty
 * recording folders, any bound, and any clock.
 *
 * Why this test matters: the example tests pin the chosen bound; these pin
 * the RULE for every bound the sidecar weighs (and any a later change picks),
 * so a reordering or an off-by-one cannot make the cleanup delete an unsaved
 * recording - the one mistake it can never undo - delete a saved copy
 * younger than the minimum age by count (M1b review #1), delete a young empty
 * folder a live page may be about to write into (#2), or keep more than it
 * says (an old empty folder included, #9).
 *
 * @vitest-environment node
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  recordingsToDelete,
  type RecordingFolder,
} from "./recording-folders.js";

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** An age in ms: often hours (where the minimum ages bite), else days. */
const ageArb = fc.oneof(
  fc.integer({ min: 0, max: 3 * HOUR }),
  fc.integer({ min: 0, max: 60 * DAY }),
);

const folderArb = (index: number): fc.Arbitrary<RecordingFolder> =>
  fc
    .record({
      startedAgo: ageArb,
      savedAgo: fc.option(ageArb),
      actionFiles: fc.integer({ min: 0, max: 5000 }),
      tail: fc.boolean(),
    })
    .map(({ startedAgo, savedAgo, actionFiles, tail }) => ({
      name: `f${String(index)}`,
      startedAtMs: NOW - startedAgo,
      actionFiles,
      savedAtMs: savedAgo === null ? null : NOW - savedAgo,
      // A marker with more recording after it is unsaved.
      saved: savedAgo !== null && !tail,
    }));

const foldersArb = fc
  .integer({ min: 0, max: 12 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => folderArb(i))));

const boundsArb = fc.record({
  maxAgeMs: fc.integer({ min: 0, max: 30 * DAY }),
  kept: fc.integer({ min: 0, max: 10 }),
  minAgeMs: fc.integer({ min: 0, max: 3 * DAY }),
  emptyMinAgeMs: fc.integer({ min: 0, max: 2 * HOUR }),
});

/** Saved and holding actions: the copies the age and count rules govern. */
const isSavedCopy = (f: RecordingFolder): boolean =>
  f.saved && f.actionFiles > 0;
const savedAge = (f: RecordingFolder): number => NOW - (f.savedAtMs ?? 0);

describe("recordingsToDelete (properties)", () => {
  it("never deletes an unsaved folder that holds actions", () => {
    fc.assert(
      fc.property(foldersArb, boundsArb, (folders, bounds) => {
        const doomed = new Set(recordingsToDelete(folders, NOW, bounds));
        const lost = folders.filter(
          (f) => !f.saved && f.actionFiles > 0 && doomed.has(f.name),
        );
        expect(lost).toEqual([]);
      }),
    );
  });

  it("deletes an empty folder exactly when it is older than emptyMinAgeMs, saved or not", () => {
    // Why: a young empty folder may be a live page's that has not written
    // yet; an old one holds nothing, whatever its marker says.
    fc.assert(
      fc.property(foldersArb, boundsArb, (folders, bounds) => {
        const doomed = new Set(recordingsToDelete(folders, NOW, bounds));
        for (const f of folders.filter((x) => x.actionFiles === 0)) {
          expect(doomed.has(f.name)).toBe(
            NOW - f.startedAtMs > bounds.emptyMinAgeMs,
          );
        }
      }),
    );
  });

  it("what survives holds no saved copy older than maxAgeMs, and at most `kept` older than minAgeMs", () => {
    fc.assert(
      fc.property(foldersArb, boundsArb, (folders, bounds) => {
        const doomed = new Set(recordingsToDelete(folders, NOW, bounds));
        const survivors = folders.filter(
          (f) => !doomed.has(f.name) && isSavedCopy(f),
        );
        expect(
          survivors.filter((f) => savedAge(f) > bounds.minAgeMs).length,
        ).toBeLessThanOrEqual(bounds.kept);
        for (const f of survivors) {
          expect(savedAge(f)).toBeLessThanOrEqual(bounds.maxAgeMs);
        }
      }),
    );
  });

  it("deletes no saved copy it could keep: every deleted one is too old, or past minAgeMs and saved before `kept` younger ones", () => {
    fc.assert(
      fc.property(foldersArb, boundsArb, (folders, bounds) => {
        const doomed = recordingsToDelete(folders, NOW, bounds);
        const unjustified = doomed.filter((name) => {
          const f = folders.find((x) => x.name === name);
          if (f === undefined) return true; // deleted an unknown folder
          if (f.actionFiles === 0) return false; // the empty rule, above
          if (!f.saved) return true;
          const tooOld = savedAge(f) > bounds.maxAgeMs;
          const pastMinimum = savedAge(f) > bounds.minAgeMs;
          const newer = folders.filter(
            (x) =>
              isSavedCopy(x) &&
              x !== f &&
              ((x.savedAtMs ?? 0) > (f.savedAtMs ?? 0) ||
                ((x.savedAtMs ?? 0) === (f.savedAtMs ?? 0) &&
                  x.startedAtMs >= f.startedAtMs)),
          ).length;
          return !(tooOld || (pastMinimum && newer >= bounds.kept));
        });
        expect(unjustified).toEqual([]);
      }),
    );
  });
});
