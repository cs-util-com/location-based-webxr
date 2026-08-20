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
  descentOffsetM,
  DESCENT_FALL_S,
  DESCENT_HOLD_S,
  DESCENT_MAX_START_M,
} from "./ar-descent.js";

const START_M = 60;

describe("descentOffsetM", () => {
  it("HOLDS at the starting height for the first few seconds", () => {
    // The request is "nach ein paar Sekunden fängt er dann an". Without the
    // hold the scene is already falling before the user has looked up from the
    // button they pressed, which reads as a slow load rather than a move.
    for (const elapsedS of [0, 1, DESCENT_HOLD_S]) {
      expect(descentOffsetM({ elapsedS, startM: START_M })).toBe(START_M);
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
    expect(START_M - justAfterHold).toBeLessThan(0.05);

    const justBeforeEnd = descentOffsetM({
      elapsedS: DESCENT_HOLD_S + DESCENT_FALL_S - 0.01,
      startM: START_M,
    });
    expect(justBeforeEnd).toBeLessThan(0.05);
  });

  it("is monotone non-increasing, so the city never rises mid-descent", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (a, b) => {
          const [earlier, later] = a <= b ? [a, b] : [b, a];
          expect(
            descentOffsetM({ elapsedS: later, startM: START_M }),
          ).toBeLessThanOrEqual(
            descentOffsetM({ elapsedS: earlier, startM: START_M }) + 1e-9,
          );
        },
      ),
    );
  });

  it("CAPS the starting height, so a zoomed-out map cannot launch the session to orbit", () => {
    // The 3D view can sit a kilometre up. Starting AR there means looking at
    // nothing, with no way to tell the session from a failed load.
    expect(descentOffsetM({ elapsedS: 0, startM: 5000 })).toBe(
      DESCENT_MAX_START_M,
    );
  });

  it("never returns a non-finite or negative offset, for any input", () => {
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
          expect(offset).toBeGreaterThanOrEqual(0);
          expect(offset).toBeLessThanOrEqual(DESCENT_MAX_START_M);
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
