/**
 * Why these tests matter (UI round 1, U3; owner decisions 2026-10-06: the
 * code's position is automatic, the better one is kept, the walk rule
 * depends on GPS accuracy, a real move keeps the pins): this rule replaces
 * two buttons and a confirmation. A wrong "replace" turns the whole tour
 * for every visitor placed by GPS (the r778 field recording: a standing
 * re-measure turned it 41 degrees); a wrong "keep" leaves a weak position
 * in place forever.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { walkNeededM } from "./code-verdict";
import {
  codePositionSentence,
  decideCodePosition,
  isReliable,
  qualityOfLevel,
  type PositionQuality,
} from "./code-position-rule";

const good: PositionQuality = { extentM: 40, accuracyM: 5 }; // needs ~24 m
const weak: PositionQuality = { extentM: 4, accuracyM: 7 }; // R1: standing
const unknown: PositionQuality = { extentM: null, accuracyM: null };

describe("isReliable - the walk the summary's model needs, at least 10 m", () => {
  it.each<[string, PositionQuality, boolean]>([
    ["40 m at 5 m accuracy (needs about 24 m)", good, true],
    ["the field recording's replace: 3-6 m of spread at 7 m", weak, false],
    ["just under the need at 5 m", { extentM: 23, accuracyM: 5 }, false],
    [
      "at least 10 m even with very good GPS",
      { extentM: 9, accuracyM: 1 },
      false,
    ],
    ["10 m at 1 m accuracy", { extentM: 10, accuracyM: 1 }, true],
    ["unknown extent", { extentM: null, accuracyM: 5 }, false],
    ["unknown accuracy", { extentM: 40, accuracyM: null }, false],
  ])("%s", (_name, q, expected) => {
    expect(isReliable(q)).toBe(expected);
  });

  it("refuses the field recording's standing re-measure at EVERY accuracy from 1 to 20 m (R1, swept)", () => {
    // Why: the owner's rule makes the walk depend on accuracy, so a verdict
    // at one accuracy would be provisional; 6 m (the top of R1's 3-6 m
    // spread) stays below the 10 m minimum whatever the accuracy.
    for (let accuracyM = 1; accuracyM <= 20; accuracyM += 1) {
      expect(isReliable({ extentM: 6, accuracyM })).toBe(false);
    }
  });

  it("asks for more walking the worse the GPS (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 400, noNaN: true }),
        (accuracyM, extentM) => {
          expect(isReliable({ extentM, accuracyM })).toBe(
            extentM >= Math.max(10, walkNeededM(accuracyM)),
          );
        },
      ),
    );
  });
});

describe("decideCodePosition", () => {
  it("keeps the stored position while this visit has not walked enough (R1)", () => {
    expect(
      decideCodePosition({
        stored: unknown,
        candidate: weak,
        offsetM: 0.9,
      }),
    ).toEqual({
      kind: "keep",
      reason: "not-walked",
      // 7 m accuracy needs about 33 m; 4 m were walked.
      walkMoreM: walkNeededM(7) - 4,
    });
  });

  it("keeps a stored position that was itself measured well (no churn per visit, D10b)", () => {
    expect(
      decideCodePosition({
        stored: good,
        candidate: good,
        offsetM: 1,
      }),
    ).toEqual({ kind: "keep", reason: "stored-good" });
  });

  it("replaces a weak or unknown stored position with a well-walked measurement", () => {
    for (const stored of [weak, unknown]) {
      expect(
        decideCodePosition({
          stored,
          candidate: good,
          offsetM: 2,
        }),
      ).toEqual({ kind: "replace" });
    }
  });

  // Far from the saved spot is the automatic code-spot rule's (M6), never
  // a silent replace (D20/D26: the poster may have moved, or be a second
  // print).
  it("never silently replaces a code seen far from its saved spot", () => {
    expect(
      decideCodePosition({
        stored: weak,
        candidate: good,
        offsetM: 20,
      }),
    ).toEqual({ kind: "keep", reason: "far" });
  });

  it("never silently replaces a code beyond the plausibility bound (far), even below 15 m", () => {
    expect(
      decideCodePosition({
        stored: weak,
        candidate: good,
        offsetM: 14,
        far: true,
      }),
    ).toEqual({ kind: "keep", reason: "far" });
  });

  // The automatic code-spot rule (M6, `code-spots.ts`) decided the move;
  // this rule only applies it, whatever the stored quality.
  it("applies an automatic move after a reliable walk, whatever the stored quality", () => {
    expect(
      decideCodePosition({
        stored: good,
        candidate: good,
        offsetM: 30,
        automaticMove: true,
      }),
    ).toEqual({ kind: "move" });
  });

  // Defensive: the spot rule only moves after a reliable walk, but this
  // rule's own promise (nothing changes from an unreliable measurement)
  // must hold whatever its caller asks.
  it("never applies an automatic move from an unreliable walk", () => {
    expect(
      decideCodePosition({
        stored: good,
        candidate: { extentM: 4, accuracyM: 5 },
        offsetM: 30,
        automaticMove: true,
      }),
    ).toEqual({ kind: "keep", reason: "far" });
  });

  it("never replaces from a measurement that is not reliable (property)", () => {
    const q = fc.record({
      extentM: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), {
        nil: null,
      }),
      accuracyM: fc.option(fc.double({ min: 1, max: 40, noNaN: true }), {
        nil: null,
      }),
    });
    fc.assert(
      fc.property(
        q,
        q,
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.boolean(),
        (stored, candidate, offsetM, automaticMove) => {
          const d = decideCodePosition({
            stored,
            candidate,
            offsetM,
            automaticMove,
          });
          const changes = d.kind === "replace" || d.kind === "move";
          expect(!changes || isReliable(candidate)).toBe(true);
        },
      ),
    );
  });
});

describe("qualityOfLevel", () => {
  const level = (mintQuality?: object) =>
    JSON.stringify({
      version: 1,
      qr: {
        physicalSizeM: 0.16,
        geo: { lat: 48.1, lon: 11.5, alt: 520, rotation: [0, 0, 0, 1] },
        ...(mintQuality === undefined ? {} : { mintQuality }),
      },
    });

  it("reads the recorded extent and accuracy (D31)", () => {
    expect(
      qualityOfLevel(level({ gpsAccuracyM: 6, alignmentGpsExtentM: 33 })),
    ).toEqual({ extentM: 33, accuracyM: 6 });
  });

  it("an older level, or a broken file, is unknown - never 'settled'", () => {
    expect(qualityOfLevel(level())).toEqual(unknown);
    expect(qualityOfLevel("{not json")).toEqual(unknown);
  });
});

describe("codePositionSentence - the result screen's line (U3)", () => {
  const outcome = (
    decision: Parameters<typeof codePositionSentence>[0][number]["decision"],
    applied = true,
  ) => ({ decision, applied });

  // Why: the plan asks the result screen to say which happened and why,
  // since no button announces it any more; an applied change outranks a
  // later visit's "kept", or the improvement would go unmentioned.
  it("names an improvement, and that nearby pins and photos moved with it", () => {
    expect(
      codePositionSentence([
        outcome({ kind: "replace" }),
        outcome({ kind: "keep", reason: "stored-good" }),
      ]),
    ).toBe(
      "The code's saved position was improved by this walk; pins and photos within 40 m moved with it.",
    );
  });

  it("names a saved move, and that pins and photos stayed", () => {
    expect(codePositionSentence([outcome({ kind: "move" })])).toBe(
      "The code's saved position moved to the poster's new spot; pins and photos kept their places.",
    );
  });

  // Why (code book plan M6 v5.1): the system undoes an automatic move by
  // itself when the code is seen back at its old spot, so the result screen
  // is the only place the creator learns it - and of a move and its undo
  // since the last Finish, the later one is where the code now is.
  it("names an undone move, and the second print it found", () => {
    const undone =
      "The code was seen back at its earlier spot: its saved position went back there, and the print at the other spot counts as a second copy.";
    expect(codePositionSentence([outcome({ kind: "undo" })])).toBe(undone);
    expect(
      codePositionSentence([
        outcome({ kind: "move" }),
        outcome({ kind: "undo" }),
      ]),
    ).toBe(undone);
    expect(
      codePositionSentence([
        outcome({ kind: "undo" }),
        outcome({ kind: "move" }),
      ]),
    ).toBe(
      "The code's saved position moved to the poster's new spot; pins and photos kept their places.",
    );
  });

  // Why (U3 milestone review #1): the line says how much walking was
  // MISSING, not the total.
  it("says how much more walking a kept position needed", () => {
    expect(
      codePositionSentence([
        outcome({ kind: "keep", reason: "not-walked", walkMoreM: 20.4 }, false),
      ]),
    ).toBe(
      "The code's saved position was kept: this visit's walk was about 20 m too short for the GPS accuracy to improve it.",
    );
  });

  it("says nothing when the position was good already, far (the code-spot rule's), not applied, or not decided", () => {
    expect(
      codePositionSentence([outcome({ kind: "keep", reason: "stored-good" })]),
    ).toBe("");
    expect(
      codePositionSentence([outcome({ kind: "keep", reason: "far" })]),
    ).toBe("");
    expect(codePositionSentence([outcome({ kind: "replace" }, false)])).toBe(
      "",
    );
    expect(codePositionSentence([])).toBe("");
  });
});
