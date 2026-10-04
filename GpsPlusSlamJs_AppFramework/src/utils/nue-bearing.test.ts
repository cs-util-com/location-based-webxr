/**
 * The geographic bearing of an NUE direction (lifted from OsmDemo's
 * `ar-origin.ts` with its tests, 2026-09-24, DEC-H3: the AR sun check needs
 * the same conversion, and a second copy is how conventions drift).
 *
 * WHY THESE TESTS MATTER: the NUE axis order (x north, z east) is easy to
 * swap, and a swapped or mirrored bearing still passes a north-only check.
 * `ar-scene-hierarchy.ts` records that two independent readers already got
 * the alignment frame backwards; a bearing on the wrong axes is not
 * obviously wrong on screen, it is a plausible number that is simply not
 * north, the worst failure available for a compass readout.
 * A vertical direction has no bearing, and reporting 0 for it would be a
 * confident "facing north" while the phone points at the ground.
 */
import { describe, expect, it } from 'vitest';

import { nueBearingDeg } from './nue-bearing.js';

describe('nueBearingDeg', () => {
  it('maps the four cardinal directions in NUE (x=north, z=east)', () => {
    expect(nueBearingDeg(1, 0)).toBe(0); // facing north
    expect(nueBearingDeg(0, 1)).toBe(90); // facing east
    expect(nueBearingDeg(-1, 0)).toBe(180); // facing south
    expect(nueBearingDeg(0, -1)).toBe(270); // facing west
  });

  it('turns CLOCKWISE from north, which is what a compass does', () => {
    // The sign error that would pass every cardinal test but one: swapping the
    // atan2 arguments gives anticlockwise, and north/south/east/west alone
    // cannot always catch it.
    expect(nueBearingDeg(1, 1)).toBeCloseTo(45, 6); // north-east
    expect(nueBearingDeg(-1, 1)).toBeCloseTo(135, 6); // south-east
  });

  it('always lands in [0, 360)', () => {
    expect(nueBearingDeg(1, -0.0001)).toBeGreaterThanOrEqual(0);
    expect(nueBearingDeg(1, -0.0001)).toBeLessThan(360);
  });

  it('refuses a degenerate direction rather than claiming north', () => {
    expect(nueBearingDeg(0, 0)).toBeUndefined();
    expect(nueBearingDeg(1e-9, -1e-9)).toBeUndefined();
    expect(nueBearingDeg(Number.NaN, 1)).toBeUndefined();
  });
});
