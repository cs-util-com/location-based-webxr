/**
 * Why these tests matter: this replaces three separate formatters that were
 * each read by a user in a different place. The tests are written as
 * DIFFERENTIAL checks against those three — the exact strings each one used to
 * produce — so "the unification changed nothing on screen" is a claim the suite
 * makes rather than one the commit message asserts.
 *
 * The rest pin the parts that WERE unified: the kilometre boundary, rounding,
 * and what happens to a value that should not exist.
 *
 * @see format-distance.ts.md
 */

import { describe, it, expect } from 'vitest';
import { formatDistance } from './format-distance.js';

/** The three call sites' settings, named as they are used. */
const WAYFINDING_HUD = { kilometreAboveM: null } as const;
const MAP_LABEL = { metreStep: 10, metreDecimals: 0 } as const;
const SESSION_SUMMARY = { kmDecimals: 2 } as const;

describe('formatDistance', () => {
  it('reproduces the wayfinding HUD label exactly', () => {
    // Was `${distance.toFixed(1)} m`, with no kilometre branch at all.
    const previous = (d: number) => `${d.toFixed(1)} m`;
    for (const metres of [0, 0.04, 1, 12.34, 99.95, 1500]) {
      expect(formatDistance(metres, WAYFINDING_HUD)).toBe(previous(metres));
    }
  });

  it('reproduces the OSM demo map label exactly', () => {
    // Was metres rounded to the nearest 10, km to one decimal.
    const previous = (m: number) =>
      m < 1000
        ? `${Math.max(0, Math.round(m / 10) * 10)} m`
        : `${(m / 1000).toFixed(1)} km`;
    for (const metres of [0, 4, 5, 14, 123, 999, 1000, 2149, 12345]) {
      expect(formatDistance(metres, MAP_LABEL)).toBe(previous(metres));
    }
  });

  it('reproduces the recorder session summary exactly', () => {
    // Was metres to one decimal, km to two.
    const previous = (m: number) =>
      m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(2)} km`;
    for (const metres of [0, 0.5, 12.34, 999.94, 1000, 1234.5, 42000]) {
      expect(formatDistance(metres, SESSION_SUMMARY)).toBe(previous(metres));
    }
  });

  it('switches to kilometres at exactly 1000 m by default', () => {
    // The boundary is the one thing all three agreed on, so it is the default
    // and it is pinned rather than inherited silently.
    expect(formatDistance(999.9)).toBe('999.9 m');
    expect(formatDistance(1000)).toBe('1.0 km');
  });

  it('never switches when the caller says the subject is always near', () => {
    expect(formatDistance(5000, { kilometreAboveM: null })).toBe('5000.0 m');
  });

  it('rounds to the requested step before printing', () => {
    expect(formatDistance(123, { metreStep: 10, metreDecimals: 0 })).toBe(
      '120 m'
    );
    expect(formatDistance(125, { metreStep: 10, metreDecimals: 0 })).toBe(
      '130 m'
    );
  });

  it('clamps a negative distance to zero rather than printing it', () => {
    // Distance is a magnitude. A negative one means a caller subtracted in the
    // wrong order, and "-3.0 m" on screen is less useful for finding that out
    // than "0.0 m". All three formatters differed here: one clamped, two did
    // not, and none of them said so.
    expect(formatDistance(-3)).toBe('0.0 m');
    expect(formatDistance(-3, { metreStep: 10, metreDecimals: 0 })).toBe('0 m');
  });

  it('formats a non-finite distance as zero rather than NaN', () => {
    // A `NaN` here reaches the screen as the literal text "NaN m", which is the
    // worst of the available outcomes: it looks like a value.
    expect(formatDistance(Number.NaN)).toBe('0.0 m');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('0.0 m');
  });
});
