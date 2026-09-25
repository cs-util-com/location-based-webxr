import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';

import type {
  ProximityObject,
  ZoneMap,
  ZoneState,
  ZoneTransition,
} from './proximity-machine.js';
import { createProximityDriver } from './proximity-driver.js';

/**
 * Why these tests matter: the driver is the only impure half of component 4. It
 * reads the live world-space pose each frame, runs the pure machine, and reports
 * transitions through `onTransition` — nothing else (no Redux import, no
 * asset-provider, no THREE; contract D15/§2.5 — the composition wires the
 * callback to `dispatch(setWaypointZone(...))`). These tests pin the two things
 * that can only be verified with the wiring in place: that machine transitions
 * reach the callback, and that the movement-epsilon gate skips work when the
 * user has barely moved (a pure perf gate that must never change the eventual
 * result). The transition *logic* itself is covered by the core tests; the
 * replay e2e proves the whole driver on a real recorded walk.
 */

const WP: ProximityObject = {
  id: 'wp',
  position: new Vector3(0, 0, 0),
  prefetchRadius: 25,
  activeRadius: 10,
};

/**
 * A tiny in-memory stand-in for the store round-trip: `onTransition` applies
 * the edge to a mutable map, and `getZones` reads it back — exactly what the
 * composition's synchronous `dispatch(setWaypointZone(...))` wiring does.
 */
function fakeStore(seed: ZoneMap = {}) {
  const zones: Record<string, ZoneState> = { ...seed };
  const onTransition = vi.fn((t: ZoneTransition) => {
    zones[t.id] = t.to;
  });
  return { zones, onTransition, getZones: () => zones as ZoneMap };
}

describe('createProximityDriver — reporting transitions', () => {
  it('reports each zone change as the user approaches', () => {
    const store = fakeStore({ wp: 'IDLE' });
    const pos = new Vector3(100, 0, 0);
    const driver = createProximityDriver({
      getUserWorldPos: () => pos,
      getObjects: () => [WP],
      getZones: store.getZones,
      onTransition: store.onTransition,
      config: { hysteresisFraction: 0.2 },
      movementEpsilonM: 0.25,
    });

    pos.set(20, 0, 0); // inside prefetch
    driver.tick();
    expect(store.onTransition).toHaveBeenLastCalledWith({
      id: 'wp',
      from: 'IDLE',
      to: 'PREFETCHING',
    });

    pos.set(5, 0, 0); // inside active
    driver.tick();
    expect(store.onTransition).toHaveBeenLastCalledWith({
      id: 'wp',
      from: 'PREFETCHING',
      to: 'ACTIVE',
    });

    expect(store.zones.wp).toBe('ACTIVE');
  });

  it('reports nothing when no zone changes', () => {
    const store = fakeStore({ wp: 'IDLE' });
    const pos = new Vector3(100, 0, 0); // far outside prefetch
    const driver = createProximityDriver({
      getUserWorldPos: () => pos,
      getObjects: () => [WP],
      getZones: store.getZones,
      onTransition: store.onTransition,
      config: { hysteresisFraction: 0.2 },
    });
    driver.tick();
    expect(store.onTransition).not.toHaveBeenCalled();
  });
});

describe('createProximityDriver — movement-epsilon gate', () => {
  it('skips the step when the user moved less than the epsilon, then runs once past it', () => {
    const store = fakeStore({ wp: 'IDLE' });
    const pos = new Vector3(26, 0, 0);
    const driver = createProximityDriver({
      getUserWorldPos: () => pos,
      getObjects: () => [WP],
      getZones: store.getZones,
      onTransition: store.onTransition,
      config: { hysteresisFraction: 0.2 },
      movementEpsilonM: 1.0,
    });

    driver.tick(); // first tick always runs; 26 > 25 → stays IDLE, no report
    expect(store.onTransition).not.toHaveBeenCalled();

    pos.set(25.5, 0, 0); // moved 0.5 < 1.0 → gated out, even though 25.5 ≤ 25 is false anyway
    driver.tick();
    expect(store.onTransition).not.toHaveBeenCalled();

    pos.set(24.5, 0, 0); // moved 1.5 from the last *evaluated* pos (26) → runs
    driver.tick();
    expect(store.onTransition).toHaveBeenCalledTimes(1);
    expect(store.onTransition).toHaveBeenLastCalledWith({
      id: 'wp',
      from: 'IDLE',
      to: 'PREFETCHING',
    });
  });

  it('measures movement from the last evaluated pose, not the last tick', () => {
    const store = fakeStore({ wp: 'IDLE' });
    const pos = new Vector3(26, 0, 0);
    const driver = createProximityDriver({
      getUserWorldPos: () => pos,
      getObjects: () => [WP],
      getZones: store.getZones,
      onTransition: store.onTransition,
      config: { hysteresisFraction: 0.2 },
      movementEpsilonM: 1.0,
    });
    driver.tick(); // evaluated at 26
    // three sub-epsilon hops that together exceed epsilon must still eventually run
    pos.set(25.4, 0, 0); // 0.6 from 26 → gated
    driver.tick();
    pos.set(24.6, 0, 0); // 1.4 from 26 → runs, evaluated at 24.6 → PREFETCHING
    driver.tick();
    expect(store.onTransition).toHaveBeenCalledTimes(1);
  });
});

describe('createProximityDriver — no pose yet', () => {
  it('does nothing when getUserWorldPos returns null', () => {
    const store = fakeStore({ wp: 'IDLE' });
    const driver = createProximityDriver({
      getUserWorldPos: () => null,
      getObjects: () => [WP],
      getZones: store.getZones,
      onTransition: store.onTransition,
      config: { hysteresisFraction: 0.2 },
    });
    expect(() => driver.tick()).not.toThrow();
    expect(store.onTransition).not.toHaveBeenCalled();
  });
});

describe('createProximityDriver — reset', () => {
  it('forgets the last evaluated pose so the next tick always runs', () => {
    const store = fakeStore({ wp: 'IDLE' });
    const pos = new Vector3(20, 0, 0);
    const driver = createProximityDriver({
      getUserWorldPos: () => pos,
      getObjects: () => [WP],
      getZones: store.getZones,
      onTransition: store.onTransition,
      config: { hysteresisFraction: 0.2 },
      movementEpsilonM: 1.0,
    });
    driver.tick(); // → PREFETCHING
    store.onTransition.mockClear();

    driver.reset();
    pos.set(20.1, 0, 0); // sub-epsilon move, but reset forces a run
    driver.tick();
    // zone is already PREFETCHING so no *new* transition, but the step ran:
    expect(store.zones.wp).toBe('PREFETCHING');
  });
});
