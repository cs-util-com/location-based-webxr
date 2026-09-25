import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  step,
  type ProximityObject,
  type StepConfig,
  type ZoneMap,
  type ZoneTransition,
} from './proximity-machine.js';

/**
 * Why these tests matter: this is the pure heart of the app (TASK.md §2.3
 * component 4). It turns world-space distances into per-waypoint zone states,
 * and every guarantee the rest of the app relies on lives here — the fractional
 * hysteresis bands (contract D16), the one-step-per-update clamp that keeps
 * PREFETCH strictly before ACTIVE so the GLTF parse jank is hidden (D15/§2.5),
 * and horizontal-only distance so altitude noise can't corrupt zones (D17).
 * These are hand-picked synthetic distances — no framework, no phone — exactly
 * the level the spec asks to pin the logic at. The replay e2e proves it on a
 * real recorded walk on top of this.
 */

// h=0.2 gives round exit bands: active 10 → out 12; prefetch 25 → out 30.
const CONFIG: StepConfig = { hysteresisFraction: 0.2 };

const WP: ProximityObject = {
  id: 'wp',
  position: new Vector3(0, 0, 0),
  prefetchRadius: 25,
  activeRadius: 10,
};

/** A user position `d` metres from the origin along +X (horizontal). */
const at = (d: number): Vector3 => new Vector3(d, 0, 0);

/** Run one step for a single waypoint and return [nextZone, transitions]. */
function once(
  prevZone: ZoneMap[string] | undefined,
  d: number,
  wp: ProximityObject = WP
): { zone: ZoneMap[string]; transitions: readonly ZoneTransition[] } {
  const prev: ZoneMap = prevZone === undefined ? {} : { [wp.id]: prevZone };
  const r = step(prev, at(d), [wp], CONFIG);
  return { zone: r.zones[wp.id]!, transitions: r.transitions };
}

describe('step — entering the bands (approaching)', () => {
  it('stays IDLE while outside the prefetch radius', () => {
    const { zone, transitions } = once('IDLE', 26);
    expect(zone).toBe('IDLE');
    expect(transitions).toHaveLength(0);
  });

  it('enters PREFETCHING at the prefetch radius', () => {
    const { zone, transitions } = once('IDLE', 25);
    expect(zone).toBe('PREFETCHING');
    expect(transitions).toEqual([
      { id: 'wp', from: 'IDLE', to: 'PREFETCHING' },
    ]);
  });

  it('goes PREFETCHING → ACTIVE at the active radius', () => {
    const { zone, transitions } = once('PREFETCHING', 10);
    expect(zone).toBe('ACTIVE');
    expect(transitions).toEqual([
      { id: 'wp', from: 'PREFETCHING', to: 'ACTIVE' },
    ]);
  });
});

describe('step — one-step clamp (no IDLE↔ACTIVE skip)', () => {
  it('an IDLE object deep inside the active radius only reaches PREFETCHING this step', () => {
    const { zone, transitions } = once('IDLE', 2); // well inside active
    expect(zone).toBe('PREFETCHING');
    expect(transitions).toEqual([
      { id: 'wp', from: 'IDLE', to: 'PREFETCHING' },
    ]);
  });

  it('reaches ACTIVE only on the following step', () => {
    const { zone } = once('PREFETCHING', 2);
    expect(zone).toBe('ACTIVE');
  });

  it('an ACTIVE object that suddenly jumps far only drops to PREFETCHING this step', () => {
    const { zone, transitions } = once('ACTIVE', 100); // teleport well outside
    expect(zone).toBe('PREFETCHING');
    expect(transitions).toEqual([
      { id: 'wp', from: 'ACTIVE', to: 'PREFETCHING' },
    ]);
  });

  it('drops to IDLE only on the following step', () => {
    const { zone } = once('PREFETCHING', 100);
    expect(zone).toBe('IDLE');
  });
});

describe('step — hysteresis (no flicker on a boundary)', () => {
  it('ACTIVE holds inside the active exit band (radius … radius·(1+h))', () => {
    // 11 is outside activeRadius (10) but inside activeOut (12): must NOT drop.
    const { zone, transitions } = once('ACTIVE', 11);
    expect(zone).toBe('ACTIVE');
    expect(transitions).toHaveLength(0);
  });

  it('ACTIVE drops to PREFETCHING only past the active exit band', () => {
    const { zone } = once('ACTIVE', 12.01); // just past activeOut = 12
    expect(zone).toBe('PREFETCHING');
  });

  it('PREFETCHING holds inside the prefetch exit band (radius … radius·(1+h))', () => {
    // 27 is outside prefetchRadius (25) but inside prefetchOut (30): must hold.
    const { zone, transitions } = once('PREFETCHING', 27);
    expect(zone).toBe('PREFETCHING');
    expect(transitions).toHaveLength(0);
  });

  it('PREFETCHING drops to IDLE only past the prefetch exit band', () => {
    const { zone } = once('PREFETCHING', 30.01); // just past prefetchOut = 30
    expect(zone).toBe('IDLE');
  });

  it('oscillating on the active boundary emits no transitions after entry', () => {
    let prev: ZoneMap = { wp: 'ACTIVE' };
    const distances = [10, 11, 9.9, 11.5, 10.5, 11.9]; // all within [activeRadius, activeOut]
    for (const d of distances) {
      const r = step(prev, at(d), [WP], CONFIG);
      expect(r.transitions).toHaveLength(0);
      expect(r.zones.wp).toBe('ACTIVE');
      prev = r.zones;
    }
  });
});

describe('step — horizontal (X/Z) distance only (D17)', () => {
  it('ignores a large vertical (Y) delta', () => {
    // Horizontal distance is exactly activeRadius; a huge Y must not push it out.
    const userPos = new Vector3(10, 500, 0);
    const r = step({ wp: 'PREFETCHING' }, userPos, [WP], CONFIG);
    expect(r.zones.wp).toBe('ACTIVE');
  });

  it('uses X and Z symmetrically', () => {
    // (6,8) → hypot = 10 = activeRadius on the ground plane.
    const userPos = new Vector3(6, 0, 8);
    const r = step({ wp: 'PREFETCHING' }, userPos, [WP], CONFIG);
    expect(r.zones.wp).toBe('ACTIVE');
  });
});

describe('step — multiple objects with different radii', () => {
  it('evaluates each object against its own radii in one step', () => {
    const near: ProximityObject = {
      id: 'near',
      position: new Vector3(0, 0, 0),
      prefetchRadius: 25,
      activeRadius: 10,
    };
    const far: ProximityObject = {
      id: 'far',
      position: new Vector3(100, 0, 0),
      prefetchRadius: 15,
      activeRadius: 6,
    };
    const prev: ZoneMap = { near: 'PREFETCHING', far: 'IDLE' };
    const r = step(prev, at(5), [near, far], CONFIG);
    expect(r.zones.near).toBe('ACTIVE'); // 5 ≤ 10
    expect(r.zones.far).toBe('IDLE'); // 95 > 15
    expect(r.transitions).toEqual([
      { id: 'near', from: 'PREFETCHING', to: 'ACTIVE' },
    ]);
  });
});

describe('step — defaults', () => {
  it('treats an object absent from prev as IDLE', () => {
    const { zone } = once(undefined, 26); // no prev entry, outside prefetch
    expect(zone).toBe('IDLE');
  });

  it('seeds an absent object then enters PREFETCHING when in range', () => {
    const { zone, transitions } = once(undefined, 20);
    expect(zone).toBe('PREFETCHING');
    expect(transitions).toEqual([
      { id: 'wp', from: 'IDLE', to: 'PREFETCHING' },
    ]);
  });
});
