/**
 * Tests for the AR entry fly-down (H5, Q5).
 *
 * Why these tests matter: the descent moves the whole city, on the same axis the
 * auto-elevation estimator and the manual trim already move it. Three properties
 * carry the feature — it holds, it lands exactly at zero, and it never produces
 * a value that could put the scene somewhere unrecoverable. The last one is not
 * defensive padding: `applyElevation` writes this straight into the position the
 * city is drawn at, and a NaN there raises no error anywhere. The failure would
 * read as "AR is empty", which is indistinguishable from several other causes.
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  cameraFadeAlpha,
  descentComplete,
  descentMayStart,
  descentOffsetM,
  DESCENT_ESTIMATE_WAIT_S,
  DESCENT_FALL_S,
  DESCENT_HOLD_S,
  DESCENT_MAX_START_M,
} from "./ar-descent.js";

const START_M = 60;

describe("the direction of travel (DEC-Y14)", () => {
  /**
   * Why these tests matter: r541 shipped this term POSITIVE, and a positive
   * offset RAISES the content — `applyElevation` writes
   * `up: geometricOffset.up + offsetM`. So the city started above the user and
   * descended onto them, which is the inverse of the intent and was reported
   * from the field as "genau falsch rum".
   *
   * The intent has always been that the CAMERA starts high. The XR camera is
   * the device pose and cannot be moved, so the height is simulated by moving
   * the world instead: a camera at +H above the world is identical to the world
   * at −H below the camera. The term must therefore be NEGATIVE and rise to 0.
   *
   * Q5's name — "the fly-down" — describes the camera, and reading it as
   * describing the content is how the sign got lost. These tests pin the frame
   * of reference so the next reader cannot make the same substitution.
   */

  it("starts BELOW the user, not above", () => {
    expect(descentOffsetM({ elapsedS: 0, startM: START_M })).toBeLessThan(0);
  });

  it("stays below or level for the whole descent, never above", () => {
    // The single assertion that would have caught r541. A positive value here
    // means the city is over the user's head.
    fc.assert(
      fc.property(fc.double({ min: 0, max: 20, noNaN: true }), (elapsedS) => {
        expect(
          descentOffsetM({ elapsedS, startM: START_M }),
        ).toBeLessThanOrEqual(0);
      }),
    );
  });

  it("keeps the camera fade sweeping 0 to 1 despite the negative offset", () => {
    // Why this test matters: `cameraFadeAlpha` divides by the offset and clamps
    // into [0,1]. A bare sign flip makes `remaining` negative, so `1 − remaining`
    // exceeds 1 and the clamp PINS the alpha at 1 for the entire descent — the
    // camera would be fully visible from the first frame and the fade would
    // silently cease to exist. The visible bug would be traded for an invisible
    // one, which is why the sign change is not a one-character edit.
    expect(cameraFadeAlpha({ elapsedS: 0, startM: START_M })).toBeCloseTo(0, 6);
    expect(
      cameraFadeAlpha({
        elapsedS: DESCENT_HOLD_S + DESCENT_FALL_S,
        startM: START_M,
      }),
    ).toBeCloseTo(1, 6);
    // And strictly rising in between, so it is a fade rather than a jump.
    const mid = cameraFadeAlpha({
      elapsedS: DESCENT_HOLD_S + DESCENT_FALL_S / 2,
      startM: START_M,
    });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("descentOffsetM", () => {
  it("HOLDS at the starting depth for the first few seconds", () => {
    // The request is "nach ein paar Sekunden fängt er dann an". Without the
    // hold the scene is already falling before the user has looked up from the
    // button they pressed, which reads as a slow load rather than a move.
    for (const elapsedS of [0, 1, DESCENT_HOLD_S]) {
      expect(descentOffsetM({ elapsedS, startM: START_M })).toBe(-START_M);
    }
  });

  it("lands at EXACTLY zero, and stays there", () => {
    // Exactly, not approximately: this term is added to the applied elevation
    // forever after, so a residual millimetre is a permanent offset on the
    // whole city.
    const end = DESCENT_HOLD_S + DESCENT_FALL_S;
    expect(descentOffsetM({ elapsedS: end, startM: START_M })).toBe(0);
    expect(descentOffsetM({ elapsedS: end + 60, startM: START_M })).toBe(0);
  });

  it("moves nothing on the first frame after the hold, and nothing at the end", () => {
    // Zero slope at both ends is what makes this read as flying rather than as
    // two jumps. A linear ramp starts and stops abruptly, which on a phone at
    // arm's length looks like the scene was dropped.
    const justAfterHold = descentOffsetM({
      elapsedS: DESCENT_HOLD_S + 0.01,
      startM: START_M,
    });
    expect(Math.abs(justAfterHold - -START_M)).toBeLessThan(0.05);

    const justBeforeEnd = descentOffsetM({
      elapsedS: DESCENT_HOLD_S + DESCENT_FALL_S - 0.01,
      startM: START_M,
    });
    expect(Math.abs(justBeforeEnd)).toBeLessThan(0.05);
  });

  it("is monotone non-DEcreasing, so the city never sinks mid-ascent", () => {
    // RENAMED AND INVERTED with DEC-Y14, not merely re-greened. The old title
    // said "never rises mid-descent" and, once the sign was corrected, asserted
    // the exact opposite of the behaviour it named. The city now travels UP
    // from below, so the offset must never decrease.
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (a, b) => {
          const [earlier, later] = a <= b ? [a, b] : [b, a];
          expect(
            descentOffsetM({ elapsedS: later, startM: START_M }),
          ).toBeGreaterThanOrEqual(
            descentOffsetM({ elapsedS: earlier, startM: START_M }) - 1e-9,
          );
        },
      ),
    );
  });

  it("CAPS the starting height, so a zoomed-out map cannot launch the session to orbit", () => {
    // The 3D view can sit a kilometre up. Starting AR there means looking at
    // nothing, with no way to tell the session from a failed load.
    expect(descentOffsetM({ elapsedS: 0, startM: 5000 })).toBe(
      -DESCENT_MAX_START_M,
    );
  });

  it("never returns a non-finite or POSITIVE offset, for any input", () => {
    // INVERTED with DEC-Y14: a positive value here is the defect r541 shipped -
    // the city over the user's head. The bound that matters is now the upper
    // one, and the magnitude is still capped.
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -100, max: 100, noNaN: true }),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
        ),
        fc.oneof(
          fc.double({ min: -500, max: 5000, noNaN: true }),
          fc.constant(Number.NaN),
        ),
        (elapsedS, startM) => {
          const offset = descentOffsetM({ elapsedS, startM });
          expect(Number.isFinite(offset)).toBe(true);
          expect(offset).toBeLessThanOrEqual(0);
          expect(offset).toBeGreaterThanOrEqual(-DESCENT_MAX_START_M);
        },
      ),
    );
  });

  it("treats a zero start as no descent at all, not as a zero-length animation", () => {
    // AR entered from a ground-level 3D view must behave exactly as it did
    // before this feature existed — including the camera being visible at once.
    expect(descentOffsetM({ elapsedS: 0, startM: 0 })).toBe(0);
    expect(cameraFadeAlpha({ elapsedS: 0, startM: 0 })).toBe(1);
    expect(descentComplete({ elapsedS: 0, startM: 0 })).toBe(true);
  });
});

describe("cameraFadeAlpha", () => {
  it("starts hidden and ends fully visible", () => {
    // 0 = passthrough hidden, so the first moment of AR looks like the 3D view
    // the user was just in — which is the point of starting at their height.
    expect(cameraFadeAlpha({ elapsedS: 0, startM: START_M })).toBe(0);
    expect(
      cameraFadeAlpha({
        elapsedS: DESCENT_HOLD_S + DESCENT_FALL_S,
        startM: START_M,
      }),
    ).toBe(1);
  });

  it("reaches full visibility exactly when the scene lands", () => {
    // Driven by the same clock as the descent so the two cannot drift apart: a
    // camera that finishes fading before the city lands shows the real world
    // with a city still floating above it, which is the datum-bug picture.
    const end = DESCENT_HOLD_S + DESCENT_FALL_S;
    expect(
      cameraFadeAlpha({ elapsedS: end - 0.01, startM: START_M }),
    ).toBeLessThan(1);
    expect(cameraFadeAlpha({ elapsedS: end, startM: START_M })).toBe(1);
  });

  it("stays inside [0,1] for any input", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -50, max: 50, noNaN: true }),
          fc.constant(Number.NaN),
        ),
        fc.oneof(
          fc.double({ min: -500, max: 5000, noNaN: true }),
          fc.constant(Number.NaN),
        ),
        (elapsedS, startM) => {
          const alpha = cameraFadeAlpha({ elapsedS, startM });
          expect(Number.isFinite(alpha)).toBe(true);
          expect(alpha).toBeGreaterThanOrEqual(0);
          expect(alpha).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("descentComplete", () => {
  it("is the END-STATE SIGNAL a stalled descent needs", () => {
    // Why this exists at all: a descent that stalls is indistinguishable from
    // the recorded "flying roughly 50 m above the OSM buildings" datum bug, and
    // that ambiguity is what would make a field report unactionable. A caller
    // uses this to say on screen that the descent finished.
    expect(descentComplete({ elapsedS: 0, startM: START_M })).toBe(false);
    expect(
      descentComplete({
        elapsedS: DESCENT_HOLD_S + DESCENT_FALL_S,
        startM: START_M,
      }),
    ).toBe(true);
  });
});

describe("descentMayStart — the entry gate (r543)", () => {
  // WHY THESE TESTS MATTER. The r543 field report: entering AR the first time
  // placed the city from an elevation estimate that had not arrived, so the
  // user started far under the world and everything jumped when the estimate
  // landed. The descent must not begin until the number it is measured from
  // exists — but it must still begin on a device that never produces one.

  it("starts as soon as an ENGAGED estimate exists, without waiting out the clock", () => {
    expect(descentMayStart({ waitedS: 0, estimateReady: true })).toBe(true);
  });

  it("holds while the estimate is missing", () => {
    // The whole point: this is the state the reported jump came from.
    expect(descentMayStart({ waitedS: 0, estimateReady: false })).toBe(false);
    expect(
      descentMayStart({
        waitedS: DESCENT_ESTIMATE_WAIT_S - 0.01,
        estimateReady: false,
      }),
    ).toBe(false);
  });

  it("gives up and starts anyway once the wait is over", () => {
    // A device with no depth and no DEM never engages the estimator. Waiting
    // forever there is a black screen with no way out — a worse failure than
    // the jump.
    expect(
      descentMayStart({
        waitedS: DESCENT_ESTIMATE_WAIT_S,
        estimateReady: false,
      }),
    ).toBe(true);
  });

  it("treats a non-finite clock as 'not yet', never as 'go'", () => {
    // Failing the other way would place the city from the zeroed estimate this
    // gate exists to wait for — i.e. straight back into the reported bug.
    // BOTH MEMBERS OF THE CLASS. The first version wrote
    // `Number.POSITIVE_INFINITY * 0` for the second case, which IS `NaN` -- so
    // it tested the same input twice and never passed an infinity at all. It
    // would not have caught a mutation from `Number.isFinite` to
    // `!Number.isNaN`. Cold review caught it.
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(descentMayStart({ waitedS: bad, estimateReady: false })).toBe(
        false,
      );
    }
    // ...but an engaged estimate still wins, because then the clock is moot.
    expect(descentMayStart({ waitedS: Number.NaN, estimateReady: true })).toBe(
      true,
    );
  });
});
