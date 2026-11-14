/**
 * Why these properties matter: the AO factor is multiplied onto a frame that
 * is already lit, fogged and tone-mapped, so its shape is the whole safety
 * argument. It may only ever darken (a factor above 1 would brighten the
 * light gates), must be exactly 1 past the fade window (the fogged distance
 * keeps today's colour) and at intensity 0 (the identity the parity probe
 * relies on), and must not grow darker with distance (a crease cannot reappear
 * beyond the fade). The exclusion rule's single sentence is checked over
 * random material mixes, and the noise generator over random integer seeds.
 *
 * @see ambient-occlusion.ts.md
 */
import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  aoBlendFactor,
  aoNoiseRandom,
  hiddenFromAoNormals,
} from './ambient-occlusion.js';

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const depth = fc.double({ min: 0, max: 50000, noNaN: true });
const fadeWindow = fc
  .tuple(
    fc.double({ min: 0, max: 5000, noNaN: true }),
    fc.double({ min: 1, max: 5000, noNaN: true })
  )
  .map(([start, width]) => ({ start, end: start + width }));

describe('aoBlendFactor (properties)', () => {
  it('only ever darkens, and never below the AO itself', () => {
    fc.assert(
      fc.property(unit, unit, depth, fadeWindow, (ao, intensity, d, w) => {
        const f = aoBlendFactor(ao, intensity, d, w.start, w.end);
        expect(f).toBeLessThanOrEqual(1);
        expect(f).toBeGreaterThanOrEqual(ao - 1e-12);
      })
    );
  });

  it('is exactly 1 at and past the fade end, and at intensity 0', () => {
    fc.assert(
      fc.property(unit, unit, depth, fadeWindow, (ao, intensity, extra, w) => {
        expect(
          aoBlendFactor(ao, intensity, w.end + extra, w.start, w.end)
        ).toBe(1);
        expect(aoBlendFactor(ao, 0, extra, w.start, w.end)).toBe(1);
        expect(aoBlendFactor(1, intensity, extra, w.start, w.end)).toBe(1);
      })
    );
  });

  it('never grows darker with distance', () => {
    fc.assert(
      fc.property(
        unit,
        unit,
        depth,
        depth,
        fadeWindow,
        (ao, intensity, a, b, w) => {
          const [near, far] = a <= b ? [a, b] : [b, a];
          expect(
            aoBlendFactor(ao, intensity, far, w.start, w.end)
          ).toBeGreaterThanOrEqual(
            aoBlendFactor(ao, intensity, near, w.start, w.end) - 1e-12
          );
        }
      )
    );
  });

  it('is the full AO before the fade starts', () => {
    fc.assert(
      fc.property(unit, fadeWindow, (ao, w) => {
        expect(aoBlendFactor(ao, 1, w.start * 0.5, w.start, w.end)).toBeCloseTo(
          ao,
          12
        );
      })
    );
  });
});

describe('hiddenFromAoNormals (properties)', () => {
  const material = fc
    .record({
      visible: fc.boolean(),
      transparent: fc.boolean(),
      depthWrite: fc.boolean(),
    })
    .map((o) => new THREE.MeshBasicMaterial(o));

  it('hides a mesh exactly when none of its materials is visible, opaque and depth-writing', () => {
    fc.assert(
      fc.property(
        fc.array(material, { minLength: 1, maxLength: 4 }),
        (materials) => {
          const mesh = new THREE.Mesh(
            undefined,
            materials.length === 1 ? materials[0] : materials
          );
          const writes = materials.some(
            (m) => m.visible && !m.transparent && m.depthWrite
          );
          expect(hiddenFromAoNormals(mesh)).toBe(!writes);
        }
      )
    );
  });
});

describe('aoNoiseRandom (properties)', () => {
  it('stays in [0, 1) and repeats per seed for any integer seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: -(2 ** 31), max: 2 ** 32 - 1 }), (seed) => {
        const a = aoNoiseRandom(seed);
        const b = aoNoiseRandom(seed);
        for (let i = 0; i < 8; i++) {
          const v = a();
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
          expect(b()).toBe(v);
        }
      })
    );
  });
});
