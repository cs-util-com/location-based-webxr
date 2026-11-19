/**
 * Unit tests for the two-map city shadow's pure rules.
 *
 * Why this file matters: the caster mode has three writers in an app (the
 * AR session, a shadow check, the city setting) and the only thing keeping
 * them from wiping each other's flags is that the mode is derived from all
 * of them on every change. The full truth table below pins that rule; the
 * tier table pins that `low` is one map (so the rewrite stays inert and the
 * sun's own map is the shadow).
 */
import { describe, expect, it } from 'vitest';

import {
  AUTO_SHADOW_TIER,
  SHADOW_TIERS,
  castingMode,
  casterGeneration,
  effectiveShadowTier,
  layerShadowFlags,
  planMapRenders,
  type ShadowLayerRows,
  type ShadowTier,
} from './two-map-shadow-rig.js';

const on = { cast: true, receive: true };
const recv = { cast: false, receive: true };
const none = { cast: false, receive: false };

const TABLE: ShadowLayerRows = {
  rows: {
    buildings: { off: none, ar: recv, city: on },
    trees: { off: none, ar: none, city: recv },
  },
  fallback: { off: none, ar: none, city: none },
};

describe('castingMode', () => {
  // Every combination of the held inputs, written out: the order of the
  // events that set them cannot matter, only their values.
  it.each<[boolean, boolean, ShadowTier, string]>([
    [false, false, 'off', 'off'],
    [true, false, 'off', 'ar'],
    [false, false, 'low', 'city'],
    [true, false, 'low', 'city'],
    [false, false, 'phone', 'city'],
    [true, false, 'high', 'city'],
    [false, true, 'off', 'off'],
    [true, true, 'off', 'ar'],
    [false, true, 'high', 'off'],
    [true, true, 'high', 'ar'],
  ])(
    'arCasting %s, suspended %s, tier %s -> %s',
    (arCasting, suspended, cityTier, mode) => {
      expect(castingMode({ arCasting, suspended, cityTier })).toBe(mode);
    }
  );
});

describe('effectiveShadowTier', () => {
  it('returns the choice, or the device class tier for auto', () => {
    expect(effectiveShadowTier('low', 'phone')).toBe('low');
    expect(effectiveShadowTier('off', 'desktop')).toBe('off');
    expect(effectiveShadowTier('auto', 'desktop')).toBe(
      AUTO_SHADOW_TIER.desktop
    );
    expect(effectiveShadowTier('auto', 'phone')).toBe(AUTO_SHADOW_TIER.phone);
    expect(
      effectiveShadowTier('auto', 'phone', { desktop: 'high', phone: 'off' })
    ).toBe('off');
  });

  it('refuses unknown values', () => {
    expect(() => effectiveShadowTier('ultra' as never, 'phone')).toThrow(
      RangeError
    );
    expect(() => effectiveShadowTier('auto', 'watch' as never)).toThrow(
      RangeError
    );
    expect(() =>
      effectiveShadowTier('auto', 'phone', {
        desktop: 'high',
        phone: 'max' as never,
      })
    ).toThrow(RangeError);
  });
});

describe('SHADOW_TIERS', () => {
  it('makes low one sun map and high two maps at 2048', () => {
    expect(SHADOW_TIERS.low).toEqual({ maps: 1, nearSize: 1024 });
    expect(SHADOW_TIERS.high).toEqual({
      maps: 2,
      nearSize: 2048,
      farSize: 2048,
    });
    expect(SHADOW_TIERS.phone.maps).toBe(2);
    expect(Object.isFrozen(SHADOW_TIERS.high)).toBe(true);
  });
});

describe('layerShadowFlags', () => {
  it('reads the row of the layer, or the fallback', () => {
    expect(layerShadowFlags(TABLE, 'city', 'buildings')).toEqual(on);
    expect(layerShadowFlags(TABLE, 'ar', 'buildings')).toEqual(recv);
    expect(layerShadowFlags(TABLE, 'city', 'pins')).toEqual(none);
    expect(layerShadowFlags(TABLE, 'city', undefined)).toEqual(none);
    // An inherited key is not a layer.
    expect(layerShadowFlags(TABLE, 'city', 'toString')).toEqual(none);
  });
});

describe('casterGeneration', () => {
  it('counts the build and every casting layer, and ignores the rest', () => {
    expect(casterGeneration(3, { buildings: 2, trees: 9 }, 'city', TABLE)).toBe(
      'build:3|buildings:2'
    );
    expect(casterGeneration(3, { buildings: 2 }, 'off', TABLE)).toBe('build:3');
  });

  it('refuses a non-finite generation', () => {
    expect(() => casterGeneration(Number.NaN, {}, 'city', TABLE)).toThrow(
      RangeError
    );
    expect(() =>
      casterGeneration(1, { buildings: Number.NaN }, 'city', TABLE)
    ).toThrow(RangeError);
  });
});

describe('planMapRenders', () => {
  it('renders what wants a render, and splits only a frame that wants both', () => {
    expect(planMapRenders({ near: true, far: true, split: false })).toEqual({
      near: true,
      far: true,
      again: false,
    });
    expect(planMapRenders({ near: true, far: true, split: true })).toEqual({
      near: true,
      far: false,
      again: true,
    });
    expect(planMapRenders({ near: false, far: true, split: true })).toEqual({
      near: false,
      far: true,
      again: false,
    });
    // After a deferral the far map goes first, so it cannot starve.
    expect(
      planMapRenders({ near: true, far: true, split: true, farDeferred: true })
    ).toEqual({ near: false, far: true, again: true });
    expect(
      planMapRenders({ near: true, far: true, split: false, farDeferred: true })
    ).toEqual({ near: true, far: true, again: false });
    expect(planMapRenders({ near: false, far: false, split: true })).toEqual({
      near: false,
      far: false,
      again: false,
    });
  });
});
