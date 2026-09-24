/**
 * Property-Based Tests for sun-altitude-lighting.ts
 *
 * These tests use fast-check to assert structural invariants that must hold for
 * EVERY finite altitude in the domain [-π/2, π/2], catching bugs that only
 * appear in the interior of a phase — where example-based tests have no samples.
 *
 * Why these tests matter:
 * 1. The smoothstep interpolation runs between every pair of phase boundaries.
 *    A coefficient error produces wrong outputs only inside a phase — not at
 *    the boundary values pinned by sun-altitude-lighting.test.ts.
 * 2. ambientLevel >= intensity is a visual correctness invariant. Violation
 *    causes the ambient (sky) to appear darker than the directional beam, which
 *    is physically impossible outdoors.
 * 3. Output clamping to [0, 1] must hold everywhere — Three.js clamps light
 *    intensities silently, so a value slightly above 1 would not crash but would
 *    produce inconsistent energy when combined with post-processing bloom.
 * 4. Monotonicity over the full domain guards against sign errors or
 *    inverted smoothstep coefficients that only manifest between two closely
 *    spaced generated samples, not at hand-picked boundary points.
 * 5. color must always be a valid 24-bit integer in [0, 0xffffff] because
 *    THREE.Color.set() silently ignores the fractional part of a float, turning
 *    any rounding error into a wrong hue.
 * 6. Purity (same input → same output) rules out hidden global state or a
 *    broken cache that would make the function non-deterministic per frame.
 *
 * @see sun-altitude-lighting.ts.md for the full specification.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sunAltitudeToLighting } from './sun-altitude-lighting.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Full physical domain of sun altitude, pole-inclusive.
 * noNaN: true excludes NaN — the purity and range properties are only
 * meaningful for finite inputs; non-finite defensiveness is covered by the
 * example-based test file.
 */
const arbAltitude = fc.double({
  min: -Math.PI / 2,
  max: Math.PI / 2,
  noNaN: true,
});

/**
 * A monotonically non-decreasing pair of altitudes for ordering properties.
 * Both elements are drawn from the same arbAltitude range, then sorted so
 * lo <= hi is guaranteed without filtering.
 */
const arbAltitudePair = fc
  .tuple(arbAltitude, arbAltitude)
  .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const);

// ---------------------------------------------------------------------------
// Property 1 — intensity in [0, 1]
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting properties — output ranges', () => {
  /**
   * Why: intensity feeds directly into THREE.DirectionalLight.intensity.
   * Values outside [0, 1] produce out-of-energy lighting that breaks PBR
   * rendering assumptions and may cause visual artefacts with HDR bloom.
   */
  it('intensity is always in [0, 1]', () => {
    fc.assert(
      fc.property(arbAltitude, (alt) => {
        const { intensity } = sunAltitudeToLighting(alt);
        expect(intensity).toBeGreaterThanOrEqual(0);
        expect(intensity).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1000 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 2 — ambientLevel in [0, 1]
  // ---------------------------------------------------------------------------

  /**
   * Why: Same reasoning as intensity; THREE.AmbientLight.intensity is unbounded
   * but values above 1 wash out all shadow detail and break the relative scale
   * between ambient and direct light.
   */
  it('ambientLevel is always in [0, 1]', () => {
    fc.assert(
      fc.property(arbAltitude, (alt) => {
        const { ambientLevel } = sunAltitudeToLighting(alt);
        expect(ambientLevel).toBeGreaterThanOrEqual(0);
        expect(ambientLevel).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1000 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 3 — ambientLevel >= intensity
  // ---------------------------------------------------------------------------

  /**
   * Why: In reality, the diffuse sky dome always carries at least as much
   * energy as the direct beam. This invariant also prevents the ambient from
   * appearing dimmer than the shadow-casting light, which reads as physically
   * wrong to the eye. A violation here would indicate either the intensity
   * ramp or the ambient ramp has an inverted slope or wrong start value.
   */
  it('ambientLevel is never less than intensity', () => {
    fc.assert(
      fc.property(arbAltitude, (alt) => {
        const { intensity, ambientLevel } = sunAltitudeToLighting(alt);
        expect(ambientLevel).toBeGreaterThanOrEqual(intensity);
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Properties 4 & 5 — monotonicity
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting properties — monotonicity', () => {
  /**
   * Why: The sun gets brighter as it rises — there is no physical scenario
   * where a higher altitude produces less direct light than a lower one
   * (atmospheric haze is not modelled here). A violation would mean the
   * smoothstep blending has a sign error or the phase order is wrong.
   * A tiny EPSILON margin accounts for floating-point rounding at boundaries.
   */
  it('intensity is non-decreasing as altitude increases', () => {
    fc.assert(
      fc.property(arbAltitudePair, ([lo, hi]) => {
        const { intensity: iLo } = sunAltitudeToLighting(lo);
        const { intensity: iHi } = sunAltitudeToLighting(hi);
        expect(iHi).toBeGreaterThanOrEqual(iLo - Number.EPSILON);
      }),
      { numRuns: 1000 },
    );
  });

  /**
   * Why: Skylight also increases as the sun rises. A decreasing ambient at
   * higher altitudes would create unrealistic dimming of the scene fill light
   * during the day, and would also risk breaking the ambientLevel >= intensity
   * invariant further up the altitude range.
   */
  it('ambientLevel is non-decreasing as altitude increases', () => {
    fc.assert(
      fc.property(arbAltitudePair, ([lo, hi]) => {
        const { ambientLevel: aLo } = sunAltitudeToLighting(lo);
        const { ambientLevel: aHi } = sunAltitudeToLighting(hi);
        expect(aHi).toBeGreaterThanOrEqual(aLo - Number.EPSILON);
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6 — color is a valid 24-bit integer
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting properties — color validity', () => {
  /**
   * Why: THREE.Color.set(color) silently ignores the fractional part of a
   * float and treats the integer portion as the hex colour. A non-integer or
   * out-of-range value would produce the wrong hue without throwing. This
   * property asserts that the colour interpolation always produces a clean
   * 24-bit integer in [0, 0xffffff].
   */
  it('color is an integer in [0, 0xffffff]', () => {
    fc.assert(
      fc.property(arbAltitude, (alt) => {
        const { color } = sunAltitudeToLighting(alt);
        expect(Number.isInteger(color)).toBe(true);
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7 — purity (determinism)
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting properties — purity', () => {
  /**
   * Why: sunAltitudeToLighting must be idempotent and free of hidden state.
   * Any global mutable variable or incorrectly invalidated cache would make
   * the function non-deterministic per frame, causing flickering lighting.
   * This property calls the function twice with the same altitude and checks
   * that all three output fields are bit-identical.
   */
  it('returns identical output for the same input on successive calls', () => {
    fc.assert(
      fc.property(arbAltitude, (alt) => {
        const a = sunAltitudeToLighting(alt);
        const b = sunAltitudeToLighting(alt);
        expect(a.intensity).toBe(b.intensity);
        expect(a.color).toBe(b.color);
        expect(a.ambientLevel).toBe(b.ambientLevel);
      }),
      { numRuns: 500 },
    );
  });
});
