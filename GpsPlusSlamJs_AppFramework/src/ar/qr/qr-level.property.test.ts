import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Quaternion } from 'gps-plus-slam-js';

import { parseQrLevel, serializeQrLevel } from './qr-level';
import { renormalizeUnitQuaternion } from './qr-geo-pose-minting';

/**
 * Why this property matters (M1 milestone review #3): the authoring loop
 * stands on "the exported file is re-readable" — for EVERY valid level, not
 * the two examples the unit tests happen to pick. The generator covers the
 * whole capability lattice (size / geo-with-heading / geo-with-rotation /
 * consistent-both / mintQuality), and the round-trip must be exact.
 */

// All numeric arbitraries map -0 → +0: the parser's domain is JSON
// documents, and JSON.parse can never produce a negative zero (the
// quaternion path additionally canonicalizes in the parser itself).
const jsonDouble = (opts: { min: number; max: number }) =>
  fc.double({ ...opts, noNaN: true }).map((v) => v + 0);

const arbHeading = jsonDouble({ min: 0, max: 359.9 });

/** Vertical-poster quaternion for a heading — the consistent-both case. */
function verticalQuaternion(headingDeg: number): Quaternion {
  const half = (-headingDeg * Math.PI) / 180 / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

const arbOrientation = fc.oneof(
  arbHeading.map((headingDeg) => ({ headingDeg })),
  arbHeading.map((h) => ({ rotation: verticalQuaternion(h) })),
  arbHeading.map((h) => ({ headingDeg: h, rotation: verticalQuaternion(h) }))
);

const arbGeo = fc.record({
  lat: jsonDouble({ min: -89, max: 89 }),
  lon: jsonDouble({ min: -179, max: 179 }),
  alt: jsonDouble({ min: -400, max: 4000 }),
});

const arbMintQuality = fc.record(
  {
    gpsAccuracyM: jsonDouble({ min: 0.1, max: 100 }),
    alignmentSampleCount: fc.integer({ min: 0, max: 10_000 }),
    alignmentRmseM: jsonDouble({ min: 0, max: 50 }),
    mintedAtIso: fc.constant('2026-08-25T12:00:00Z'),
  },
  { requiredKeys: [] }
);

const arbLevel = fc.record(
  {
    version: fc.constant(1),
    physicalSizeM: jsonDouble({ min: 0.01, max: 2 }),
    geoParts: fc.tuple(arbGeo, arbOrientation),
    mintQuality: arbMintQuality,
  },
  { requiredKeys: ['version'] }
);

describe('serializeQrLevel — round-trip property', () => {
  it('every valid level survives serialize → JSON.parse → parseQrLevel', () => {
    fc.assert(
      fc.property(arbLevel, (parts) => {
        const level = parseQrLevel({
          version: parts.version,
          qr: {
            ...(parts.physicalSizeM !== undefined
              ? { physicalSizeM: parts.physicalSizeM }
              : {}),
            ...(parts.geoParts !== undefined
              ? { geo: { ...parts.geoParts[0], ...parts.geoParts[1] } }
              : {}),
            ...(parts.mintQuality !== undefined
              ? { mintQuality: parts.mintQuality }
              : {}),
          },
        });

        const reparsed = parseQrLevel(JSON.parse(serializeQrLevel(level)));
        expect(reparsed).toEqual(level);
      })
    );
  });
});

describe('renormalizeUnitQuaternion — the shared contract rejects bad input', () => {
  /**
   * Why this test matters (PR #383 review): the JSDoc promises `undefined`
   * for anything off the unit sphere, but every comparison against NaN is
   * false — so `Math.abs(NaN - 1) > 1e-3` did NOT reject, and a non-finite
   * quaternion came back as itself. Every caller had grown its own
   * `length === 4 && every(Number.isFinite)` prelude to compensate, three of
   * them in `capture-geo-join.ts` alone, each added by a separate review
   * round. Nothing here exercised non-finite input, so the gap was invisible.
   */
  it('returns undefined when any component is non-finite', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY
        ),
        fc.integer({ min: 0, max: 3 }),
        (bad, index) => {
          const q: number[] = [0, 0, 0, 1];
          q[index] = bad;
          expect(
            renormalizeUnitQuaternion(q as unknown as Quaternion)
          ).toBeUndefined();
        }
      )
    );
  });

  it('returns undefined for a quaternion that is not four components', () => {
    // `Math.hypot(0, 0, 0, undefined)` is NaN, so a short array used to come
    // back as `[0, 0, 0, NaN]` rather than being refused.
    for (const q of [[], [0, 0, 0], [0, 0, 0, 1, 0]]) {
      expect(
        renormalizeUnitQuaternion(q as unknown as Quaternion)
      ).toBeUndefined();
    }
  });

  it('still accepts and renormalizes a within-tolerance quaternion', () => {
    // The guard must not have narrowed what the contract accepts.
    fc.assert(
      fc.property(fc.double({ min: -5e-4, max: 5e-4, noNaN: true }), (off) => {
        const result = renormalizeUnitQuaternion([0, 0, 0, 1 + off]);
        expect(result).toBeDefined();
        expect(Math.hypot(...result!)).toBeCloseTo(1, 9);
      })
    );
  });
});
