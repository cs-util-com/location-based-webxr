/**
 * Slope, aspect and normal-space isoclines — the arithmetic behind §2's ground.
 *
 * WHY THESE TESTS MATTER, AND WHY THE THIRD ONE IS THE POINT. The prototype the
 * owner picked draws contour lines of constant STEEPNESS, not of constant
 * height. That distinction is the whole idea and it is very easy to implement
 * the other thing by accident — height contours look plausible, are what
 * everyone has seen on a map, and would pass any test that only checked "there
 * are lines". The assertion that separates them is that **a uniformly tilted
 * plane has no lines at all**: its steepness is the same everywhere, so there is
 * no isocline to draw. A height-contour implementation would stripe it densely.
 *
 * The rest is the usual reason this repo keeps its arithmetic in pure modules:
 * CI has no GPU and jsdom cannot compile a shader, so anything expressed only in
 * GLSL is untestable. This is what the fragment shader does, in JS — the same
 * relationship `sampleTerrainTexture` already has to the vertex shader, and for
 * the same reason (`terrain-texture.ts`: "if the two disagree, the GPU becomes a
 * second source of truth").
 */

import { describe, expect, it } from "vitest";

import {
  FLAT_FADE_STEEPNESS,
  ISOCLINE_FREQUENCY,
  isoclinePhase,
  slopeAspect,
  slopeSteepness,
  slopeTreatmentStrength,
} from "./terrain-slope.js";

/** A unit normal for a plane that drops by `grad` per metre towards `+x`. */
function normalForGradient(dx: number, dy: number): [number, number, number] {
  const length = Math.hypot(dx, 1, dy);
  return [-dx / length, 1 / length, -dy / length];
}

describe("slopeSteepness", () => {
  it("is 0 on flat ground", () => {
    expect(slopeSteepness(normalForGradient(0, 0))).toBeCloseTo(0, 12);
  });

  it("is the SINE of the slope angle, so it saturates at 1", () => {
    // Not the gradient itself: `length(N.xz)` is bounded, which is what lets the
    // isocline frequency be a fixed number rather than something that has to be
    // re-tuned for mountainous terrain.
    for (const degrees of [10, 30, 45, 60, 80]) {
      const gradient = Math.tan((degrees * Math.PI) / 180);
      expect(slopeSteepness(normalForGradient(gradient, 0))).toBeCloseTo(
        Math.sin((degrees * Math.PI) / 180),
        9,
      );
    }
  });

  it("is monotonic in the gradient magnitude", () => {
    let previous = -1;
    for (let gradient = 0; gradient < 8; gradient += 0.25) {
      const steepness = slopeSteepness(normalForGradient(gradient, 0));
      expect(steepness).toBeGreaterThan(previous);
      previous = steepness;
    }
  });

  it("does not care which way the slope faces", () => {
    // Steepness is a magnitude; the direction is `slopeAspect`'s job. A
    // steepness that varied with aspect would draw a contour line where the
    // ground merely turns.
    const east = slopeSteepness(normalForGradient(0.5, 0));
    const north = slopeSteepness(normalForGradient(0, 0.5));
    const both = slopeSteepness(
      normalForGradient(0.5 / Math.SQRT2, 0.5 / Math.SQRT2),
    );
    expect(north).toBeCloseTo(east, 12);
    expect(both).toBeCloseTo(east, 12);
  });
});

describe("slopeAspect", () => {
  it("is stable in [-π, π] and turns with the slope direction", () => {
    const east = slopeAspect(normalForGradient(1, 0));
    const west = slopeAspect(normalForGradient(-1, 0));
    expect(east).toBeGreaterThanOrEqual(-Math.PI);
    expect(east).toBeLessThanOrEqual(Math.PI);
    // Opposite slopes face opposite ways: half a turn apart, whichever
    // representative the branch cut picks.
    const apart = Math.abs(east - west);
    expect(Math.min(apart, 2 * Math.PI - apart)).toBeCloseTo(Math.PI, 9);
  });

  it("does not jump for a slope rotating through the branch cut", () => {
    // The tint derived from aspect must not have a visible seam running across
    // the terrain. `atan2` has a cut; what matters is that neighbouring
    // directions stay neighbouring once wrapped.
    const step = 0.05;
    let previous = slopeAspect(normalForGradient(Math.cos(0), Math.sin(0)));
    for (let angle = step; angle <= 2 * Math.PI; angle += step) {
      const now = slopeAspect(
        normalForGradient(Math.cos(angle), Math.sin(angle)),
      );
      const delta = Math.abs(now - previous);
      expect(Math.min(delta, 2 * Math.PI - delta)).toBeLessThan(0.2);
      previous = now;
    }
  });
});

describe("isoclinePhase — lines of constant SLOPE, not of constant height", () => {
  it("is the same for every slope of equal steepness, whatever way it faces", () => {
    // THE TEST THAT SEPARATES THIS FROM HEIGHT CONTOURS.
    //
    // A first version of this looped over positions on a tilted plane and
    // asserted the phase was constant — which passed by construction, because
    // position is not an argument. That is a vacuous test and worse than none:
    // it reads like a real guarantee.
    //
    // The property that CAN break is that the phase depends on steepness and
    // NOTHING ELSE. Fold in aspect (or height, once the shader has it in scope)
    // and a uniformly tilted plane starts drawing bands — which looks entirely
    // convincing in a screenshot, and is the wrong picture: an isocline field
    // must be empty wherever the surface has constant lean.
    const steepness = Math.tan(Math.PI / 6);
    const reference = isoclinePhase(normalForGradient(steepness, 0));
    for (let angle = 0; angle < 2 * Math.PI; angle += 0.3) {
      const phase = isoclinePhase(
        normalForGradient(
          steepness * Math.cos(angle),
          steepness * Math.sin(angle),
        ),
      );
      expect(phase).toBeCloseTo(reference, 9);
    }
  });

  it("advances with steepness, so a curving hillside gets bands", () => {
    // The other half: where steepness DOES change, the phase must move enough
    // to cross a line. Between flat and 45° the phase must sweep several
    // periods, or the treatment would draw one band across the whole world.
    const flat = isoclinePhase(normalForGradient(0, 0));
    const steep = isoclinePhase(normalForGradient(1, 0));
    expect(steep - flat).toBeGreaterThan(2 * Math.PI);
  });

  it("fades the whole treatment out on genuinely flat ground", () => {
    // NOT DECORATION, and this is the reason it is a named function rather than
    // an inline smoothstep. At exactly flat, `slopeAspect` has no horizontal
    // component to take an angle of and the isocline phase is zero everywhere at
    // once — so a large flat area would be uniformly inside a line or uniformly
    // outside it, flipping between the two on the slightest numerical noise. A
    // whole car park strobing is the failure being prevented.
    expect(slopeTreatmentStrength(normalForGradient(0, 0))).toBe(0);
    expect(
      slopeTreatmentStrength(normalForGradient(FLAT_FADE_STEEPNESS * 2, 0)),
    ).toBe(1);
  });

  it("ramps monotonically between the two, with no step", () => {
    // A hard cutoff would draw a visible ring around every flat area — the
    // treatment appearing all at once at a threshold. Smooth is what makes the
    // boundary invisible.
    let previous = -1;
    for (let gradient = 0; gradient <= 0.4; gradient += 0.01) {
      const strength = slopeTreatmentStrength(normalForGradient(gradient, 0));
      expect(strength).toBeGreaterThanOrEqual(previous);
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(1);
      previous = strength;
    }
  });

  it("uses a frequency high enough to band ordinary terrain", () => {
    // Cologne's relief is about ±25 m over kilometres, so the steepness range
    // in play is small and a low frequency would produce no visible banding at
    // all — which is exactly the "the ground looks flat" complaint (R5-2) that
    // this stage exists to answer.
    expect(ISOCLINE_FREQUENCY).toBeGreaterThanOrEqual(20);
  });
});
