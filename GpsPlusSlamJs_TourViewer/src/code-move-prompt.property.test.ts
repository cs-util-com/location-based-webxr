/**
 * Properties of the move prompt's tracker (authoring plan 2026-09-28-0953
 * §3.6, M5b).
 *
 * Why these properties matter: the creator setup feeds the tracker on every
 * store change, in whatever order sightings, fixes and gate changes happen
 * to arrive. For ANY such sequence:
 * - a prompt is only ever shown for a horizontal offset beyond the trigger
 *   (D26: its own, whatever the settle refuses) with the mint gate open,
 *   for a spot no remembered answer covers (§7j #8, #9, #14);
 * - a prompt means the offset has lasted beyond the trigger, without a
 *   break, for at least the rule's fixes and seconds - counted from the
 *   start of the CURRENT run, never from an earlier one.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  isSecondCopySpot,
  trackMovePrompt,
  type MovePromptInput,
  type MovePromptOnset,
  type RememberedMoveAnswer,
} from "./code-move-prompt.js";

const RULE = { minFixes: 4, minSeconds: 6, sameSpotM: 20, floorM: 15 };

const step = fc.record({
  levelId: fc.constantFrom("a", "b"),
  horizontalM: fc.double({ min: 0, max: 80, noNaN: true }),
  yawDeg: fc.double({ min: 0, max: 180, noNaN: true }),
  northM: fc.double({ min: -80, max: 80, noNaN: true }),
  eastM: fc.double({ min: -80, max: 80, noNaN: true }),
  gateOpen: fc.boolean(),
  newFixes: fc.integer({ min: 0, max: 3 }),
  dtS: fc.integer({ min: 0, max: 4 }),
  timed: fc.boolean(),
  savedKey: fc.constantFrom("k1", "k2"),
});

const answer: fc.Arbitrary<RememberedMoveAnswer> = fc.record({
  levelId: fc.constantFrom("a", "b"),
  northM: fc.double({ min: -80, max: 80, noNaN: true }),
  eastM: fc.double({ min: -80, max: 80, noNaN: true }),
  answer: fc.constantFrom("second-copy" as const, "not-now" as const),
  savedKey: fc.constantFrom("k1", "k2"),
});

describe("trackMovePrompt (properties)", () => {
  it("prompts only for a lasting offset beyond the trigger, with the gate open, at an unanswered spot", () => {
    fc.assert(
      fc.property(
        fc.array(step, { minLength: 1, maxLength: 60 }),
        fc.array(answer, { maxLength: 3 }),
        (steps, answers) => {
          let onset: MovePromptOnset | null = null;
          let fixCount = 0;
          let tMs = 0;
          // The start of the current unbroken run of qualifying inputs.
          let run: { levelId: string; fixCount: number; tMs: number } | null =
            null;
          for (const s of steps) {
            fixCount += s.newFixes;
            tMs += s.dtS * 1000;
            const input: MovePromptInput = {
              levelId: s.levelId,
              offset: {
                horizontalM: s.horizontalM,
                northM: s.northM,
                eastM: s.eastM,
                yawDeg: s.yawDeg,
              },
              gateOpen: s.gateOpen,
              fixCount,
              lastFixMs: s.timed ? tMs : null,
              savedKey: s.savedKey,
              answers,
            };
            const qualifies = s.gateOpen && s.horizontalM > RULE.floorM;
            if (!qualifies) run = null;
            else if (run === null || run.levelId !== s.levelId) {
              run = { levelId: s.levelId, fixCount, tMs };
            }
            const r = trackMovePrompt(onset, input, RULE);
            onset = r.onset;
            if (r.prompt === null) continue;
            expect(qualifies).toBe(true);
            expect(
              answers.some(
                (a) =>
                  a.levelId === s.levelId &&
                  a.savedKey === s.savedKey &&
                  Math.hypot(a.northM - s.northM, a.eastM - s.eastM) <= 20,
              ),
            ).toBe(false);
            expect(run).not.toBeNull();
            expect(fixCount - run!.fixCount).toBeGreaterThanOrEqual(
              RULE.minFixes,
            );
            expect(r.prompt.fixes).toBe(fixCount - run!.fixCount);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("with timed fixes, never prompts before the rule's seconds have passed in the current run", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 60 }), (steps) => {
        let onset: MovePromptOnset | null = null;
        let fixCount = 0;
        let tMs = 0;
        let runStartMs: number | null = null;
        let runLevel: string | null = null;
        for (const s of steps) {
          fixCount += s.newFixes;
          tMs += s.dtS * 1000;
          const qualifies = s.gateOpen && s.horizontalM > RULE.floorM;
          if (!qualifies) runStartMs = null;
          else if (runStartMs === null || runLevel !== s.levelId) {
            runStartMs = tMs;
            runLevel = s.levelId;
          }
          const r = trackMovePrompt(
            onset,
            {
              levelId: s.levelId,
              offset: {
                horizontalM: s.horizontalM,
                northM: s.northM,
                eastM: s.eastM,
                yawDeg: s.yawDeg,
              },
              gateOpen: s.gateOpen,
              fixCount,
              lastFixMs: tMs,
              savedKey: s.savedKey,
              answers: [],
            },
            RULE,
          );
          onset = r.onset;
          // A prompt only once the current run lasted the rule's seconds.
          expect(
            r.prompt === null || tMs - runStartMs! >= RULE.minSeconds * 1000,
          ).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("isSecondCopySpot (properties, M5b review #11)", () => {
  // Why: whether a sighting is kept out of the visit log must depend on
  // the creator's "It's a second copy" answers alone. A "Not now" leaves
  // the question open, so for ANY answers adding one never changes the
  // verdict; and a second-copy answer for the sighting's own level, saved
  // pose and spot always makes it a second copy.
  const sighting = fc.record({
    levelId: fc.constantFrom("a", "b"),
    savedKey: fc.constantFrom("k1", "k2"),
    offset: fc.record({
      northM: fc.double({ min: -80, max: 80, noNaN: true }),
      eastM: fc.double({ min: -80, max: 80, noNaN: true }),
    }),
  });

  it("a 'Not now' never changes the verdict; a second copy at the sighting's own spot always makes it one", () => {
    fc.assert(
      fc.property(
        fc.array(answer, { maxLength: 5 }),
        answer,
        sighting,
        (answers, extra, seen) => {
          const before = isSecondCopySpot(answers, seen, RULE.sameSpotM);
          const notNow = { ...extra, answer: "not-now" as const };
          expect(
            isSecondCopySpot([...answers, notNow], seen, RULE.sameSpotM),
          ).toBe(before);
          const copy: RememberedMoveAnswer = {
            levelId: seen.levelId,
            savedKey: seen.savedKey,
            northM: seen.offset.northM,
            eastM: seen.offset.eastM,
            answer: "second-copy",
          };
          expect(
            isSecondCopySpot([...answers, copy], seen, RULE.sameSpotM),
          ).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
