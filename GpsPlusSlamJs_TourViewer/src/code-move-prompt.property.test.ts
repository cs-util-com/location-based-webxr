/**
 * Properties of the move prompt's tracker (authoring plan 2026-09-28-0953
 * §3.6, M5b).
 *
 * Why these properties matter: the creator setup feeds the tracker on every
 * store change, in whatever order sightings, fixes and gate changes happen
 * to arrive. For ANY such sequence:
 * - a prompt is only ever shown for a horizontal refusal with the mint gate
 *   open, beyond the floor, for a spot no remembered answer covers (§7j
 *   #8, #9, #14; M5b review #1);
 * - a prompt means the refusal has lasted, without a break, for at least
 *   the rule's fixes and seconds - counted from the start of the CURRENT
 *   run of refusals, never from an earlier one.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  isHorizontalRefusal,
  trackMovePrompt,
  type MovePromptInput,
  type MovePromptOnset,
  type RememberedMoveAnswer,
} from "./code-move-prompt.js";

const RULE = { minFixes: 4, minSeconds: 6, sameSpotM: 20, floorM: 20 };

const step = fc.record({
  levelId: fc.constantFrom("a", "b"),
  horizontalM: fc.double({ min: 0, max: 80, noNaN: true }),
  // The refusal's bound: under the floor (small reported accuracies) or above.
  boundM: fc.double({ min: 10, max: 40, noNaN: true }),
  yawDeg: fc.double({ min: 0, max: 180, noNaN: true }),
  northM: fc.double({ min: -80, max: 80, noNaN: true }),
  eastM: fc.double({ min: -80, max: 80, noNaN: true }),
  gateOpen: fc.boolean(),
  newFixes: fc.integer({ min: 0, max: 3 }),
  dtS: fc.integer({ min: 0, max: 4 }),
  timed: fc.boolean(),
});

const answer: fc.Arbitrary<RememberedMoveAnswer> = fc.record({
  levelId: fc.constantFrom("a", "b"),
  northM: fc.double({ min: -80, max: 80, noNaN: true }),
  eastM: fc.double({ min: -80, max: 80, noNaN: true }),
  answer: fc.constantFrom("second-copy" as const, "not-now" as const),
});

describe("trackMovePrompt (properties)", () => {
  it("prompts only for a lasting horizontal refusal, with the gate open, at an unanswered spot", () => {
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
            const refusal = {
              horizontalM: s.horizontalM,
              yawDeg: s.yawDeg,
              maxHorizontalM: s.boundM,
              maxYawDeg: 120,
            };
            const input: MovePromptInput = {
              levelId: s.levelId,
              refusal,
              offset: { northM: s.northM, eastM: s.eastM },
              gateOpen: s.gateOpen,
              fixCount,
              lastFixMs: s.timed ? tMs : null,
              answers,
            };
            const qualifies =
              s.gateOpen &&
              isHorizontalRefusal(refusal) &&
              refusal.horizontalM > RULE.floorM;
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
          const refusal = {
            horizontalM: s.horizontalM,
            yawDeg: s.yawDeg,
            maxHorizontalM: s.boundM,
            maxYawDeg: 120,
          };
          const qualifies =
            s.gateOpen &&
            isHorizontalRefusal(refusal) &&
            refusal.horizontalM > RULE.floorM;
          if (!qualifies) runStartMs = null;
          else if (runStartMs === null || runLevel !== s.levelId) {
            runStartMs = tMs;
            runLevel = s.levelId;
          }
          const r = trackMovePrompt(
            onset,
            {
              levelId: s.levelId,
              refusal,
              offset: { northM: s.northM, eastM: s.eastM },
              gateOpen: s.gateOpen,
              fixCount,
              lastFixMs: tMs,
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
