/**
 * Example-Based Tests for sun-altitude-lighting.ts
 *
 * These tests pin concrete phase-boundary values and structural rules of the
 * altitude-driven lighting model. They verify that specific known altitudes
 * produce the expected intensity, colour, and ambient level outputs.
 *
 * Why these tests matter:
 * 1. Phase-boundary spot-checks guard against off-by-one errors in the phase
 *    thresholds (e.g., night ends at -18°, not -17° or -19°).
 * 2. The monotonicity scan across a dense altitude grid catches sign errors or
 *    inverted interpolations that would make the sun appear to dim as it rises.
 * 3. The ambientLevel >= intensity invariant check ensures the sky dome is
 *    never rendered darker than the direct beam, which is physically wrong.
 * 4. Colour-channel trend tests guard against swapped R/G/B components or a
 *    mis-ordered colour palette that would produce the wrong sky hue per phase.
 * 5. Non-finite defensiveness tests ensure the function never throws when fed
 *    NaN or ±Infinity, which can arise from upstream SunCalc on invalid dates.
 *
 * @see sun-altitude-lighting.ts.md for the full specification.
 */
import { describe, it, expect } from 'vitest';
import {
  sunAltitudeToLighting,
  type SunLightingResult,
} from './sun-altitude-lighting.js';

// ---------------------------------------------------------------------------
// Altitude constants (radians) matching the five phases in the spec
// ---------------------------------------------------------------------------

/** Deep inside the Night phase (<-18°). */
const ALT_NIGHT = -0.5; // ~-28.6°

/** Mid astronomical twilight (~-12°). */
const ALT_ASTRO_TWILIGHT = (-12 * Math.PI) / 180;

/** Mid civil twilight / dawn (~-3°). */
const ALT_CIVIL_TWILIGHT = (-3 * Math.PI) / 180;

/** Just above horizon — golden hour (~+3°). */
const ALT_GOLDEN = (3 * Math.PI) / 180;

/** Full daytime — high sun (~+45°). */
const ALT_DAYTIME = Math.PI / 4;

/** Near zenith — the equatorial midday example from the spec. */
const ALT_ZENITH = 1.3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the individual R, G, B channels from a 24-bit hex colour integer.
 */
function channels(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

// ---------------------------------------------------------------------------
// Phase boundary spot-checks
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting — phase boundary spot-checks', () => {
  it('night floor: intensity = 0 and ambientLevel = 0.02', () => {
    const result = sunAltitudeToLighting(ALT_NIGHT);
    expect(result.intensity).toBe(0);
    expect(result.ambientLevel).toBeCloseTo(0.02, 5);
  });

  it('night floor: color is deep navy #0a0a1e', () => {
    const { color } = sunAltitudeToLighting(ALT_NIGHT);
    expect(color).toBe(0x0a0a1e);
  });

  it('astronomical twilight: intensity remains 0', () => {
    const { intensity } = sunAltitudeToLighting(ALT_ASTRO_TWILIGHT);
    expect(intensity).toBe(0);
  });

  it('astronomical twilight: ambient is elevated above night floor', () => {
    const { ambientLevel } = sunAltitudeToLighting(ALT_ASTRO_TWILIGHT);
    expect(ambientLevel).toBeGreaterThan(0.02);
    expect(ambientLevel).toBeLessThanOrEqual(0.15);
  });

  it('civil twilight: intensity has begun to ramp above 0', () => {
    const { intensity } = sunAltitudeToLighting(ALT_CIVIL_TWILIGHT);
    expect(intensity).toBeGreaterThan(0);
    expect(intensity).toBeLessThan(0.15);
  });

  it('civil twilight: ambient is in the civil twilight range', () => {
    const { ambientLevel } = sunAltitudeToLighting(ALT_CIVIL_TWILIGHT);
    expect(ambientLevel).toBeGreaterThan(0.15);
    expect(ambientLevel).toBeLessThanOrEqual(0.35);
  });

  it('golden hour: intensity is in the golden hour range', () => {
    const { intensity } = sunAltitudeToLighting(ALT_GOLDEN);
    expect(intensity).toBeGreaterThan(0.15);
    expect(intensity).toBeLessThanOrEqual(0.55);
  });

  it('golden hour: ambient is in the golden hour range', () => {
    const { ambientLevel } = sunAltitudeToLighting(ALT_GOLDEN);
    expect(ambientLevel).toBeGreaterThan(0.35);
    expect(ambientLevel).toBeLessThanOrEqual(0.65);
  });

  it('daytime: intensity approaches 1 for a high sun', () => {
    const { intensity } = sunAltitudeToLighting(ALT_DAYTIME);
    expect(intensity).toBeGreaterThan(0.55);
  });

  it('zenith (altitudeRad ≈ 1.3): intensity = 1 and ambientLevel = 1', () => {
    const { intensity, ambientLevel } = sunAltitudeToLighting(ALT_ZENITH);
    expect(intensity).toBe(1);
    expect(ambientLevel).toBe(1);
  });

  it('zenith (altitudeRad ≈ 1.3): color is white 0xffffff', () => {
    const { color } = sunAltitudeToLighting(ALT_ZENITH);
    expect(color).toBe(0xffffff);
  });
});

// ---------------------------------------------------------------------------
// Monotonicity scan
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting — monotonicity', () => {
  /**
   * Build a dense, sorted sequence of altitudes from -π/2 to π/2 and verify
   * that intensity and ambientLevel never decrease as altitude increases.
   * Any sign error or inverted smoothstep would violate this.
   */
  it('intensity is non-decreasing as altitude rises from -π/2 to π/2', () => {
    const steps = 360;
    let prevIntensity = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const alt = -Math.PI / 2 + (i / steps) * Math.PI;
      const { intensity } = sunAltitudeToLighting(alt);
      // Allow a tiny floating-point margin
      expect(intensity).toBeGreaterThanOrEqual(prevIntensity - Number.EPSILON);
      prevIntensity = intensity;
    }
  });

  it('ambientLevel is non-decreasing as altitude rises from -π/2 to π/2', () => {
    const steps = 360;
    let prevAmbient = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const alt = -Math.PI / 2 + (i / steps) * Math.PI;
      const { ambientLevel } = sunAltitudeToLighting(alt);
      expect(ambientLevel).toBeGreaterThanOrEqual(prevAmbient - Number.EPSILON);
      prevAmbient = ambientLevel;
    }
  });
});

// ---------------------------------------------------------------------------
// ambientLevel >= intensity invariant
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting — ambientLevel >= intensity', () => {
  it('holds at every phase boundary sample', () => {
    const alts = [
      ALT_NIGHT,
      ALT_ASTRO_TWILIGHT,
      ALT_CIVIL_TWILIGHT,
      ALT_GOLDEN,
      ALT_DAYTIME,
      ALT_ZENITH,
      // Exact phase-boundary radians from the spec
      (-18 * Math.PI) / 180,
      (-6 * Math.PI) / 180,
      0,
      (6 * Math.PI) / 180,
    ];
    for (const alt of alts) {
      const { intensity, ambientLevel } = sunAltitudeToLighting(alt);
      expect(ambientLevel, `ambientLevel >= intensity at alt=${alt}`).toBeGreaterThanOrEqual(
        intensity,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Colour channel progression per phase
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting — colour channel trends', () => {
  /**
   * Night: deep navy — blue channel must dominate over red and green.
   * Spec colour: #0a0a1e → B=0x1e=30, R=G=0x0a=10
   */
  it('night color has blue dominant over red and green', () => {
    const { r, g, b } = channels(sunAltitudeToLighting(ALT_NIGHT).color);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  /**
   * Astronomical twilight: blue-violet — blue must still dominate.
   * Spec colour: #1a1040 → B=0x40=64, R=0x1a=26, G=0x10=16
   */
  it('astronomical twilight color has blue dominant', () => {
    const { r, g, b } = channels(sunAltitudeToLighting(ALT_ASTRO_TWILIGHT).color);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  /**
   * Civil twilight / dawn: orange-red — red channel must dominate.
   * Spec colour: #ff6020 → R=0xff=255, G=0x60=96, B=0x20=32
   */
  it('civil twilight color has red dominant', () => {
    const { r, g, b } = channels(sunAltitudeToLighting(ALT_CIVIL_TWILIGHT).color);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  /**
   * Golden hour: warm amber — red dominant, blue must be the weakest channel.
   * Spec colour: #ffb060 → R=0xff=255, G=0xb0=176, B=0x60=96
   */
  it('golden hour color has red dominant and blue weakest', () => {
    const { r, g, b } = channels(sunAltitudeToLighting(ALT_GOLDEN).color);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  /**
   * Zenith: pure white — all channels must be 0xff.
   */
  it('zenith color has all channels at 0xff', () => {
    const { r, g, b } = channels(sunAltitudeToLighting(ALT_ZENITH).color);
    expect(r).toBe(0xff);
    expect(g).toBe(0xff);
    expect(b).toBe(0xff);
  });

  /**
   * As altitude rises from night to zenith, the red channel must increase
   * (night navy → orange twilight → warm white).
   */
  it('red channel increases from night through golden hour', () => {
    const rNight = channels(sunAltitudeToLighting(ALT_NIGHT).color).r;
    const rAstro = channels(sunAltitudeToLighting(ALT_ASTRO_TWILIGHT).color).r;
    const rCivil = channels(sunAltitudeToLighting(ALT_CIVIL_TWILIGHT).color).r;
    const rGolden = channels(sunAltitudeToLighting(ALT_GOLDEN).color).r;
    expect(rAstro).toBeGreaterThanOrEqual(rNight);
    expect(rCivil).toBeGreaterThanOrEqual(rAstro);
    expect(rGolden).toBeGreaterThanOrEqual(rCivil);
  });
});

// ---------------------------------------------------------------------------
// Non-finite input defensiveness
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting — non-finite input', () => {
  const NON_FINITE_INPUTS = [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it.each(NON_FINITE_INPUTS)(
    'does not throw for altitudeRad = %s',
    (alt) => {
      expect(() => sunAltitudeToLighting(alt)).not.toThrow();
    },
  );

  it.each(NON_FINITE_INPUTS)(
    'returns intensity = 0 for altitudeRad = %s',
    (alt) => {
      expect(sunAltitudeToLighting(alt).intensity).toBe(0);
    },
  );

  it.each(NON_FINITE_INPUTS)(
    'returns ambientLevel = 0.02 for altitudeRad = %s',
    (alt) => {
      expect(sunAltitudeToLighting(alt).ambientLevel).toBeCloseTo(0.02, 5);
    },
  );

  it.each(NON_FINITE_INPUTS)(
    'returns color = 0x0a0a1e (deep navy) for altitudeRad = %s',
    (alt) => {
      expect(sunAltitudeToLighting(alt).color).toBe(0x0a0a1e);
    },
  );
});

// ---------------------------------------------------------------------------
// Output type sanity
// ---------------------------------------------------------------------------

describe('sunAltitudeToLighting — output type sanity', () => {
  it('returns an object with intensity, color, and ambientLevel fields', () => {
    const result: SunLightingResult = sunAltitudeToLighting(0);
    expect(typeof result.intensity).toBe('number');
    expect(typeof result.color).toBe('number');
    expect(typeof result.ambientLevel).toBe('number');
  });
});
