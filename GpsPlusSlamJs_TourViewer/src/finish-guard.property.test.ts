/**
 * Why these properties matter: the leave guard is the last thing between
 * a creator's placed work and a reload, a closed tab or an AR crash. With
 * no tour open (or a backup write failed) the page keeps that work only in
 * memory, so the guard must ask whenever there is any; and it must stay
 * quiet whenever a backup holds it and no rebuilt file waits, or every
 * reload of an ordinary session would nag.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  leaveNeedsConfirm,
  leaveQuestion,
  unsavedWork,
  type FinishGuardInput,
} from "./finish-guard";

const guardInput: fc.Arbitrary<FinishGuardInput> = fc.record({
  sessionLive: fc.boolean(),
  arAvailable: fc.boolean(),
  placedCount: fc.nat({ max: 5 }),
  deletedCount: fc.nat({ max: 5 }),
  tourChanged: fc.boolean(),
  codeCount: fc.nat({ max: 5 }),
  rebuilt: fc.option(fc.record({ delivered: fc.boolean() }), { nil: null }),
  draftPersists: fc.boolean(),
  finishFailed: fc.boolean(),
});

const nothingUnsaved = guardInput.map((input): FinishGuardInput => ({
  ...input,
  placedCount: 0,
  deletedCount: 0,
  tourChanged: false,
  codeCount: 0,
  rebuilt: input.rebuilt === null ? null : { delivered: true },
}));

describe("leaveNeedsConfirm (properties)", () => {
  it("asks whenever unsaved work has no backup", () => {
    fc.assert(
      fc.property(guardInput, (input) => {
        fc.pre(!input.draftPersists && unsavedWork(input));
        expect(leaveNeedsConfirm(input)).toBe(true);
        expect(leaveQuestion(input)).toContain("holds no backup copy");
      }),
    );
  });

  it("asks whenever a rebuilt file was not saved, backup or not", () => {
    fc.assert(
      fc.property(guardInput, (input) => {
        fc.pre(input.rebuilt !== null && !input.rebuilt.delivered);
        expect(leaveNeedsConfirm(input)).toBe(true);
      }),
    );
  });

  it("stays quiet when a backup holds the work and no rebuilt file waits", () => {
    fc.assert(
      fc.property(guardInput, (input) => {
        fc.pre(
          input.draftPersists &&
            (input.rebuilt === null || input.rebuilt.delivered),
        );
        expect(leaveNeedsConfirm(input)).toBe(false);
      }),
    );
  });

  it("stays quiet with nothing unsaved at all", () => {
    fc.assert(
      // Built with nothing unsaved: a filter would reject almost every
      // generated input.
      fc.property(nothingUnsaved, (input) => {
        expect(unsavedWork(input)).toBe(false);
        expect(leaveNeedsConfirm(input)).toBe(false);
      }),
    );
  });
});
