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
        moved: false,
      }),
    ).toEqual({ kind: "keep", reason: "not-walked" });
  });

  it("keeps a stored position that was itself measured well (no churn per visit, D10b)", () => {
    expect(
      decideCodePosition({
        stored: good,
        candidate: good,
        offsetM: 1,
        moved: false,
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
          moved: false,
        }),
      ).toEqual({ kind: "replace" });
    }
  });

  it("leaves a code far from its saved spot to the 'did the poster move?' question", () => {
    expect(
      decideCodePosition({
        stored: weak,
        candidate: good,
        offsetM: 20,
        moved: false,
      }),
    ).toEqual({ kind: "keep", reason: "far" });
  });

  it("applies a confirmed move once this visit walked enough, whatever the stored quality", () => {
    expect(
      decideCodePosition({
        stored: good,
        candidate: good,
        offsetM: 30,
        moved: true,
      }),
    ).toEqual({ kind: "move" });
  });

  it("holds a confirmed move until this visit walked enough, and says how far", () => {
    const decision = decideCodePosition({
      stored: good,
      candidate: { extentM: 4, accuracyM: 5 },
      offsetM: 30,
      moved: true,
    });
    expect(decision.kind).toBe("move-waits");
    expect(decision.kind === "move-waits" ? decision.walkMoreM : 0).toBeCloseTo(
      walkNeededM(5) - 4,
      5,
    );
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
        (stored, candidate, offsetM, moved) => {
          const d = decideCodePosition({ stored, candidate, offsetM, moved });
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
  const at5: PositionQuality = { extentM: 3, accuracyM: 5 };
  const outcome = (
    decision: Parameters<typeof codePositionSentence>[0][number]["decision"],
    applied = true,
  ) => ({ decision, applied, candidate: at5 });

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

  it("says how much walking a kept position or a waiting move needs", () => {
    expect(
      codePositionSentence([
        outcome({ kind: "keep", reason: "not-walked" }, false),
      ]),
    ).toBe(
      `The code's saved position was kept: walk about ${String(Math.round(walkNeededM(5)))} m in AR after seeing the code to improve it.`,
    );
    expect(
      codePositionSentence([
        outcome({ kind: "move-waits", walkMoreM: 12.4 }, false),
      ]),
    ).toBe(
      "The poster's move is not saved yet: walk about 12 m more in AR after seeing the code, then finish again.",
    );
  });

  it("says nothing when the position was good already, far (the question's), not applied, or not decided", () => {
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
