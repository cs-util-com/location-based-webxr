/**
 * Tests for the named look presets.
 *
 * Why this file matters: presets are hand-edited data that reach shaders and
 * light intensities directly. A typo such as `visibilityKm: 0` or an exposure
 * of `-1` renders black without an error, and it would look like "the blue
 * hour preset is broken" rather than like a data defect. Each preset is also
 * held to what its NAME promises, because a "blue hour" with the sun above
 * the horizon is a lie that survives every other check.
 */
import { describe, expect, it } from 'vitest';

import {
  LOOK_PRESETS,
  validateLookPreset,
  type LookPreset,
} from './look-presets.js';

describe('LOOK_PRESETS', () => {
  it('has the five presets the owner accepted, with unique ids', () => {
    expect(LOOK_PRESETS.map((p) => p.id)).toEqual([
      'dawn',
      'noon',
      'golden',
      'blueHour',
      'hazy',
    ]);
  });

  it.each(LOOK_PRESETS.map((p) => [p.id, p] as const))(
    '%s is valid',
    (_id, preset) => {
      expect(validateLookPreset(preset)).toEqual([]);
    }
  );

  // Each name is a promise about where the sun is.
  it('keeps each preset true to its name', () => {
    const byId = Object.fromEntries(LOOK_PRESETS.map((p) => [p.id, p]));
    expect(byId.blueHour!.sunElevationDeg).toBeLessThan(0);
    expect(byId.golden!.sunElevationDeg).toBeGreaterThan(0);
    expect(byId.golden!.sunElevationDeg).toBeLessThan(10);
    expect(byId.noon!.sunElevationDeg).toBeGreaterThan(45);
    expect(byId.dawn!.sunAzimuthDeg).toBeLessThan(135);
    expect(byId.hazy!.visibilityKm).toBeLessThan(byId.noon!.visibilityKm);
  });
});

describe('validateLookPreset', () => {
  const good: LookPreset = LOOK_PRESETS[1]!;

  // Every field that reaches a shader or a light is checked, and every
  // problem is named, so a broken edit says which field broke.
  it.each([
    [{ visibilityKm: 0 }, 'visibilityKm'],
    [{ exposureEv: 12 }, 'exposureEv'],
    [{ sunElevationDeg: 95 }, 'sunElevationDeg'],
    [{ sunAzimuthDeg: Number.NaN }, 'sunAzimuthDeg'],
    [{ cloudCover: 1.5 }, 'cloudCover'],
  ])('names the bad field in %o', (patch, field) => {
    const problems = validateLookPreset({ ...good, ...patch });
    expect(problems.join(' ')).toContain(field);
  });
});
