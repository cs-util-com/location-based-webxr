/**
 * Why these tests matter: the HUD polls getTargets() from the frame loop, so
 * every consumer mistake at that boundary must become "hide it, log once"
 * rather than a throw logged 60–90 times a second — and the ONCE must be
 * per offending target, cleared when it heals, or a real regression stays
 * silent forever. Until 2026-09-04 these rules were only reachable through
 * the rendering HUD (a THREE scene per test); this is the direct pin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const { mockError } = vi.hoisted(() => ({ mockError: vi.fn() }));
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    error: mockError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createTargetResolver } from './wayfinding-targets';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

beforeEach(() => {
  mockError.mockClear();
});

describe('createTargetResolver', () => {
  it('resolves a well-formed list: id or index keys, HUD-level deadband defaults, flag defaults', () => {
    const r = createTargetResolver({ distanceMin: 2, distanceMax: 5 });
    const out = r.resolve([
      { id: 'a', position: v(1), distanceMin: 1 },
      {
        position: v(2),
        showArrowWhenInactive: true,
        showLabelWhenInactive: false,
      },
    ]);
    expect(out).toEqual([
      {
        key: 'a',
        position: v(1),
        distanceMin: 1,
        distanceMax: 5,
        showArrowWhenInactive: false,
        showLabelWhenInactive: true,
      },
      {
        key: 1,
        position: v(2),
        distanceMin: 2,
        distanceMax: 5,
        showArrowWhenInactive: true,
        showLabelWhenInactive: false,
      },
    ]);
    expect(mockError).not.toHaveBeenCalled();
  });

  it('treats a non-array getter result as empty, logging once across frames', () => {
    const r = createTargetResolver({ distanceMin: 2, distanceMax: 5 });
    expect(r.resolve(undefined)).toEqual([]);
    expect(r.resolve('nope')).toEqual([]);
    expect(mockError).toHaveBeenCalledTimes(1);
  });

  it('hides a legacy plain Vector3 and a shapeless element, each logged once, and other targets keep working', () => {
    const r = createTargetResolver({ distanceMin: 2, distanceMax: 5 });
    const raw = [v(1), { nope: true }, { id: 'ok', position: v(3) }];
    const first = r.resolve(raw);
    const second = r.resolve(raw);
    expect(first.map((t) => t.key)).toEqual(['ok']);
    expect(second.map((t) => t.key)).toEqual(['ok']);
    expect(mockError).toHaveBeenCalledTimes(2);
    expect(mockError.mock.calls[0]?.[0]).toContain(
      'plain THREE.Vector3 at index 0'
    );
    expect(mockError.mock.calls[1]?.[0]).toContain(
      'index 1 is not a WayfindingTarget'
    );
  });

  it('shows only the first occurrence of a duplicate id, logs once, and logs again after the duplication heals and returns', () => {
    const r = createTargetResolver({ distanceMin: 2, distanceMax: 5 });
    const dup = [
      { id: 'x', position: v(1) },
      { id: 'x', position: v(2) },
    ];
    expect(r.resolve(dup).map((t) => t.position.x)).toEqual([1]);
    r.resolve(dup);
    expect(mockError).toHaveBeenCalledTimes(1);
    // Healed: the entry clears only once the duplication is gone.
    r.resolve([{ id: 'x', position: v(1) }]);
    r.resolve(dup);
    expect(mockError).toHaveBeenCalledTimes(2);
  });

  it('hides a target whose deadband breaks 0 ≤ min ≤ max, logs once, and logs again after it heals and regresses', () => {
    const r = createTargetResolver({ distanceMin: 2, distanceMax: 5 });
    const bad = [{ id: 'd', position: v(), distanceMin: 6 }];
    expect(r.resolve(bad)).toEqual([]);
    r.resolve(bad);
    expect(mockError).toHaveBeenCalledTimes(1);
    expect(
      r.resolve([{ id: 'd', position: v(), distanceMin: 1 }])
    ).toHaveLength(1);
    r.resolve(bad);
    expect(mockError).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-finite or negative deadband and a non-string id', () => {
    const r = createTargetResolver({ distanceMin: 2, distanceMax: 5 });
    expect(
      r.resolve([
        { id: 'n', position: v(), distanceMax: Number.NaN },
        { id: 'neg', position: v(), distanceMin: -1 },
        { id: 7 as unknown as string, position: v() },
      ])
    ).toEqual([]);
    expect(mockError).toHaveBeenCalledTimes(3);
  });
});
