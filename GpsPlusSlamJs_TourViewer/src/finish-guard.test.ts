/**
 * Why these tests matter (UI round 1, U2; owner: "nothing the creator can
 * forget"): the creator's work reaches visitors only once the rebuilt tour
 * file is SAVED and uploaded. These rules decide when the page leads with
 * saving, when Finish steps aside for the result, and when leaving asks
 * first - the difference between a published tour and one silently left
 * on a phone.
 */
import { describe, expect, it } from "vitest";

import {
  finishButtonText,
  leaveQuestion,
  hideFinishForResult,
  leaveNeedsConfirm,
  unsavedWork,
  type FinishGuardInput,
} from "./finish-guard";

function input(overrides: Partial<FinishGuardInput> = {}): FinishGuardInput {
  return {
    sessionLive: false,
    arAvailable: true,
    placedCount: 0,
    deletedCount: 0,
    codeCount: 0,
    rebuilt: null,
    draftPersists: true,
    finishFailed: false,
    ...overrides,
  };
}

describe("unsavedWork", () => {
  it.each<[string, Partial<FinishGuardInput>, boolean]>([
    ["nothing done", {}, false],
    ["a pin placed", { placedCount: 1 }, true],
    ["a deletion", { deletedCount: 1 }, true],
    // Why (code book plan M4c-1): a code measured or improved and not yet
    // written by a Finish is work the creator would lose.
    ["a code measured, not finished", { codeCount: 1 }, true],
    ["a rebuilt file not saved yet", { rebuilt: { delivered: false } }, true],
    ["a rebuilt file saved", { rebuilt: { delivered: true } }, false],
  ])("%s", (_name, o, expected) => {
    expect(unsavedWork(input(o))).toBe(expected);
  });
});

describe("finishButtonText", () => {
  it("in AR it is the plain Finish", () => {
    expect(finishButtonText(input({ sessionLive: true, placedCount: 2 }))).toBe(
      "Finish - rebuild the zip",
    );
  });

  it("after leaving AR with unfinished changes it leads with saving them", () => {
    // The back gesture ends a session without a Finish (plan review F-3).
    expect(finishButtonText(input({ placedCount: 2 }))).toBe(
      "Finish and save your changes",
    );
  });

  it("with nothing new it stays the plain Finish", () => {
    expect(finishButtonText(input())).toBe("Finish - rebuild the zip");
  });
});

describe("hideFinishForResult", () => {
  it("steps aside on a phone while the rebuilt file waits to be saved", () => {
    expect(hideFinishForResult(input({ rebuilt: { delivered: false } }))).toBe(
      true,
    );
  });

  it("stays on a desktop, where editing and finishing again is the flow (plan review D-8)", () => {
    expect(
      hideFinishForResult(
        input({ arAvailable: false, rebuilt: { delivered: false } }),
      ),
    ).toBe(false);
  });

  it("comes back once there is new work, or the file was saved", () => {
    expect(
      hideFinishForResult(
        input({ placedCount: 1, rebuilt: { delivered: false } }),
      ),
    ).toBe(false);
    expect(hideFinishForResult(input({ rebuilt: { delivered: true } }))).toBe(
      false,
    );
  });
});

describe("leaveNeedsConfirm", () => {
  it("asks only while a rebuilt file was not saved", () => {
    expect(leaveNeedsConfirm(input({ rebuilt: { delivered: false } }))).toBe(
      true,
    );
    expect(leaveNeedsConfirm(input({ rebuilt: { delivered: true } }))).toBe(
      false,
    );
    // Unfinished pins survive in the draft and are offered again: no ask.
    expect(leaveNeedsConfirm(input({ placedCount: 3 }))).toBe(false);
  });
});

describe("the guard without a backup, and after a failed Finish (U2 milestone review #3, #4)", () => {
  // Why: "your changes stay on this phone" was a promise the page could
  // not keep on a device whose draft backup failed - leaving then lost the
  // work without a word; and a Finish that failed after its file was made
  // hid Finish for good, leaving neither a retry nor a save.
  it("asks before leaving with unfinished changes when nothing backs them up", () => {
    expect(
      leaveNeedsConfirm(input({ placedCount: 2, draftPersists: false })),
    ).toBe(true);
    expect(leaveNeedsConfirm(input({ placedCount: 2 }))).toBe(false);
  });

  it("never promises the phone keeps work that no backup holds", () => {
    expect(leaveQuestion(input({ rebuilt: { delivered: false } }))).toMatch(
      /stay on this phone/,
    );
    const noBackup = leaveQuestion(
      input({ placedCount: 1, draftPersists: false }),
    );
    expect(noBackup).not.toMatch(/stay on this phone/);
    expect(noBackup).toMatch(/not saved anywhere/);
  });

  it("keeps Finish after a failed Finish, whatever file it left", () => {
    expect(
      hideFinishForResult(
        input({ rebuilt: { delivered: false }, finishFailed: true }),
      ),
    ).toBe(false);
  });
});
