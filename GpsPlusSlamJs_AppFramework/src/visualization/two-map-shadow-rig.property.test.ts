/**
 * Property tests for the two-map city shadow's pure rules.
 *
 * Why this file matters: a woods governor thins trees step by step in a
 * timelapse; if a step of a layer that casts no shadow counted as a caster
 * change, every step would re-render both maps (the cost the cached maps
 * exist to avoid). And `auto` must never pick a tier the device class does
 * not allow.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  castingMode,
  casterGeneration,
  effectiveShadowTier,
  layerShadowFlags,
  type ShadowCastingMode,
  type ShadowChoice,
  type ShadowDeviceClass,
  type ShadowLayerRows,
  type ShadowTier,
} from './two-map-shadow-rig.js';

const flagsArb = fc.record({ cast: fc.boolean(), receive: fc.boolean() });
const modeRowArb = fc.record({ off: flagsArb, ar: flagsArb, city: flagsArb });
const LAYERS = ['buildings', 'barriers', 'trees', 'pins', 'roads'] as const;
const tableArb: fc.Arbitrary<ShadowLayerRows> = fc.record({
  rows: fc.dictionary(fc.constantFrom(...LAYERS), modeRowArb),
  fallback: modeRowArb,
});
const modeArb = fc.constantFrom<ShadowCastingMode>('off', 'ar', 'city');
const layersArb = fc.dictionary(
  fc.constantFrom(...LAYERS),
  fc.integer({ min: 0, max: 1000 })
);
const tierArb = fc.constantFrom<ShadowTier>('off', 'low', 'phone', 'high');

describe('casterGeneration', () => {
  it('never changes when only a layer that does not cast changes', () => {
    fc.assert(
      fc.property(
        tableArb,
        modeArb,
        fc.integer({ min: 0, max: 100 }),
        layersArb,
        fc.constantFrom(...LAYERS),
        fc.integer({ min: 0, max: 1000 }),
        (table, mode, build, layers, layer, next) => {
          const before = casterGeneration(build, layers, mode, table);
          const after = casterGeneration(
            build,
            { ...layers, [layer]: next },
            mode,
            table
          );
          const casts = layerShadowFlags(table, mode, layer).cast;
          const changed = layers[layer] !== next;
          expect(after !== before).toBe(casts && changed);
        }
      )
    );
  });

  it('does not depend on the order the layers are listed in', () => {
    fc.assert(
      fc.property(tableArb, modeArb, layersArb, (table, mode, layers) => {
        const reversed = Object.fromEntries(Object.entries(layers).reverse());
        expect(casterGeneration(1, reversed, mode, table)).toBe(
          casterGeneration(1, layers, mode, table)
        );
      })
    );
  });
});

describe('effectiveShadowTier', () => {
  it('returns the choice unless it is auto, and for auto the device tier', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ShadowChoice>('auto', 'off', 'low', 'phone', 'high'),
        fc.constantFrom<ShadowDeviceClass>('desktop', 'phone'),
        tierArb,
        tierArb,
        (choice, device, desktop, phone) => {
          const auto = { desktop, phone };
          const tier = effectiveShadowTier(choice, device, auto);
          expect(tier).toBe(choice === 'auto' ? auto[device] : choice);
        }
      )
    );
  });
});

describe('castingMode', () => {
  it('is city exactly when not suspended and the tier is on', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), tierArb, (ar, sus, tier) => {
        const mode = castingMode({
          arCasting: ar,
          suspended: sus,
          cityTier: tier,
        });
        const city = !sus && tier !== 'off';
        expect(mode).toBe(city ? 'city' : ar ? 'ar' : 'off');
      })
    );
  });
});
