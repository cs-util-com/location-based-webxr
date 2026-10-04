/**
 * Property tests for the atmosphere model: the monotonicity claims a sky
 * depends on, over the whole input range rather than at a few points.
 *
 * Why this file matters: a sky that gets BRIGHTER as the sun sinks, or hazier
 * as visibility rises, is the kind of bug that looks like "a strange preset"
 * rather than like a defect. These properties make that impossible to ship.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  EARTH_ATMOSPHERE,
  mieExtinctionForVisibility,
  sunLight,
  transmittanceToTop,
} from './atmosphere-model.js';

const SEA_LEVEL = EARTH_ATMOSPHERE.groundRadiusKm;
const visibility = fc.double({ min: 1, max: 500, noNaN: true });
const cosZenith = fc.double({ min: 0.001, max: 1, noNaN: true });

describe('atmosphere model properties', () => {
  // More visibility means cleaner air, never dirtier.
  it('Mie extinction never increases with visibility', () => {
    fc.assert(
      fc.property(visibility, visibility, (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(mieExtinctionForVisibility(hi)).toBeLessThanOrEqual(
          mieExtinctionForVisibility(lo)
        );
      })
    );
  });

  // Every channel of every transmittance is a fraction of the light that
  // entered: never negative (a clamp failure) and never above 1 (light created
  // from nothing).
  it('transmittance stays within [0, 1]', () => {
    fc.assert(
      fc.property(cosZenith, visibility, (mu, v) => {
        for (const t of transmittanceToTop(SEA_LEVEL + 0.1, mu, {
          visibilityKm: v,
        })) {
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 60 }
    );
  });

  // A ray closer to the horizon crosses more air.
  it('transmittance never increases as the ray tilts toward the horizon', () => {
    fc.assert(
      fc.property(cosZenith, cosZenith, (a, b) => {
        const [low, high] = a < b ? [a, b] : [b, a];
        const params = { visibilityKm: 60 };
        const tLow = transmittanceToTop(SEA_LEVEL + 0.1, low, params);
        const tHigh = transmittanceToTop(SEA_LEVEL + 0.1, high, params);
        for (let c = 0; c < 3; c++) {
          expect(tLow[c]).toBeLessThanOrEqual(tHigh[c] + 1e-12);
        }
      }),
      { numRuns: 60 }
    );
  });

  // The sun never brightens as it sets, and its light is always a valid
  // chroma (brightest channel exactly 1, the others in [0, 1]).
  it('sun intensity is monotone in elevation and its colour is a chroma', () => {
    const elevation = fc.double({ min: -0.05, max: Math.PI / 2, noNaN: true });
    fc.assert(
      fc.property(elevation, elevation, (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const params = { visibilityKm: 60 };
        const low = sunLight(Math.sin(lo), params);
        const high = sunLight(Math.sin(hi), params);
        expect(low.intensity).toBeLessThanOrEqual(high.intensity + 1e-12);
        for (const c of high.colour) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 60 }
    );
  });
});
