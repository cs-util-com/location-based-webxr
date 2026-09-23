/**
 * Property tests for the exposure maths.
 *
 * Why this file matters: the auto-exposure runs on every sun change, over
 * every sky the model can produce, and a non-monotone exposure (more light →
 * brighter image) or an irradiance that is not linear in radiance would show
 * as a scene that "pumps" when the time-of-day slider moves. These hold the
 * two shapes over the whole input range rather than at the handful of points
 * the unit tests pin.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { autoExposure, skyIrradiance } from './atmosphere-exposure.js';
import { EARTH_ATMOSPHERE } from './atmosphere-model.js';

const R = EARTH_ATMOSPHERE.groundRadiusKm + 0.2;
const illuminance = fc.double({ min: 1e-9, max: 100, noNaN: true });

describe('atmosphere exposure properties', () => {
  // More light never gives MORE exposure.
  it('auto-exposure never increases with illuminance', () => {
    fc.assert(
      fc.property(illuminance, illuminance, (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(autoExposure(hi)).toBeLessThanOrEqual(autoExposure(lo));
      })
    );
  });

  // The image brightness (exposure × illuminance) still rises with the light
  // under partial adaptation: twilight stays darker than noon.
  it('exposed brightness rises with illuminance', () => {
    fc.assert(
      fc.property(illuminance, illuminance, (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(hi * autoExposure(hi)).toBeGreaterThanOrEqual(
          lo * autoExposure(lo) * (1 - 1e-12)
        );
      })
    );
  });

  // Irradiance is an integral: scaling every radiance by k scales it by k.
  it('sky irradiance is linear in radiance', () => {
    const width = 16;
    const height = 12;
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 10, noNaN: true }), {
          minLength: width * height * 4,
          maxLength: width * height * 4,
        }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        (values, k) => {
          const base = skyIrradiance(
            Float32Array.from(values),
            width,
            height,
            R
          );
          const scaled = skyIrradiance(
            Float32Array.from(values.map((v) => v * k)),
            width,
            height,
            R
          );
          for (let c = 0; c < 3; c++) {
            expect(scaled[c]).toBeCloseTo(base[c] * k, 3);
          }
        }
      ),
      { numRuns: 40 }
    );
  });
});
