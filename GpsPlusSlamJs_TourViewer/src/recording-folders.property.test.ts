/**
 * The cleanup bound as properties, over any mix of saved, unsaved and empty
 * recording folders, any bound, and any clock.
 *
 * Why this test matters: the example tests pin the chosen bound; these pin
 * the RULE for every bound the sidecar weighs (and any a later change picks),
 * so a reordering or an off-by-one cannot make the cleanup delete an unsaved
 * recording - the one mistake it can never undo - or keep more than it says.
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
const DAY = 24 * 60 * 60 * 1000;

const folderArb = (index: number): fc.Arbitrary<RecordingFolder> =>
  fc
    .record({
      startedAgo: fc.integer({ min: 0, max: 60 * DAY }),
      savedAgo: fc.option(fc.integer({ min: 0, max: 60 * DAY })),
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
});

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

  it("what survives holds at most `kept` saved folders, none older than `maxAgeMs`", () => {
    fc.assert(
      fc.property(foldersArb, boundsArb, (folders, bounds) => {
        const doomed = new Set(recordingsToDelete(folders, NOW, bounds));
        const survivors = folders.filter(
          (f) => !doomed.has(f.name) && f.saved && f.actionFiles > 0,
        );
        expect(survivors.length).toBeLessThanOrEqual(bounds.kept);
        for (const f of survivors) {
          expect(NOW - (f.savedAtMs ?? 0)).toBeLessThanOrEqual(bounds.maxAgeMs);
        }
      }),
    );
  });

  it("deletes no saved folder it could keep: every deleted one is too old, or saved before `kept` younger ones", () => {
    fc.assert(
      fc.property(foldersArb, boundsArb, (folders, bounds) => {
        const doomed = recordingsToDelete(folders, NOW, bounds);
        const unjustified = doomed.filter((name) => {
          const f = folders.find((x) => x.name === name);
          if (f === undefined) return true; // deleted an unknown folder
          if (f.actionFiles === 0) return false; // nothing to save
          if (!f.saved) return true;
          const tooOld = NOW - (f.savedAtMs ?? 0) > bounds.maxAgeMs;
          const newer = folders.filter(
            (x) =>
              x.saved &&
              x.actionFiles > 0 &&
              x !== f &&
              ((x.savedAtMs ?? 0) > (f.savedAtMs ?? 0) ||
                ((x.savedAtMs ?? 0) === (f.savedAtMs ?? 0) &&
                  x.startedAtMs >= f.startedAtMs)),
          ).length;
          return !(tooOld || newer >= bounds.kept);
        });
        expect(unjustified).toEqual([]);
      }),
    );
  });
});
