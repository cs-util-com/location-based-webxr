/**
 * Why this test matters: the live noise belongs to the noise PLANE, not to
 * the caller's frame. A caller carries where its frame's origin lies on the
 * plane (float64, unwrapped, thousands of km) and the frame's rotation; the
 * basis reduces each octave's offset modulo the lattice so the shader sees
 * small numbers. If that reduction, the composition of the rotations or the
 * float64 path were wrong, the clouds would jump at a recentre or a drift
 * wrap (the owner's "clouds jump", 2026-10-08). The property: a local point
 * reads exactly the noise of its plane position, whatever the origin and
 * the rotation that put it there.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { cloudLiveBasis, cloudLiveSample } from './cloud-live-noise.js';

const far = fc.double({ min: -50_000, max: 50_000, noNaN: true });
const local = fc.double({ min: -300, max: 300, noNaN: true });
const angle = fc.double({ min: -20, max: 20, noNaN: true });

describe('cloudLiveSample (properties)', () => {
  it('reads a local point at its noise-plane position, for any origin and rotation', () => {
    fc.assert(
      fc.property(far, far, angle, local, local, (px, py, rot, x, y) => {
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        // The point's plane position, and the same point as the origin of a
        // frame with no rotation.
        const planeX = px + c * x - s * y;
        const planeY = py + s * x + c * y;
        const viaFrame = cloudLiveSample(
          cloudLiveBasis({ originKm: [px, py], rotationRad: rot }),
          x,
          y
        );
        const atPlane = cloudLiveSample(
          cloudLiveBasis({ originKm: [planeX, planeY], rotationRad: 0 }),
          0,
          0
        );
        expect(Math.abs(viaFrame - atPlane)).toBeLessThan(1e-7);
      })
    );
  });

  it('stays within the field’s range and never returns NaN for any footprint', () => {
    fc.assert(
      fc.property(
        far,
        far,
        angle,
        local,
        local,
        fc.double({ min: 0, max: 100, noNaN: true }),
        (px, py, rot, x, y, footprint) => {
          const v = cloudLiveSample(
            cloudLiveBasis({ originKm: [px, py], rotationRad: rot }),
            x,
            y,
            footprint
          );
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(-0.5);
          expect(v).toBeLessThan(1.3);
        }
      )
    );
  });
});
