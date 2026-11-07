/**
 * Proximity & zone state machine — the pure heart of the tour (TASK.md §2.3
 * component 4). Given the user's world-space position and each waypoint's
 * anchored world position, it drives every waypoint through two concentric
 * zones: `IDLE → PREFETCHING → ACTIVE`.
 *
 * This module is deliberately pure and dependency-light:
 * - **No store, no THREE runtime, no clock.** `Vector3` is imported type-only,
 *   so the core carries zero runtime dependency and is reusable in any Three.js
 *   project (upstream-PR candidate, TASK.md §2.6). Same inputs → same output.
 * - **Horizontal (X/Z) distance only** (contract D17): altitude is the noisiest
 *   GPS axis and some waypoints omit it, so the ground-plane distance is what
 *   drives zones. `Vector3.y` is ignored by design.
 * - **Fractional hysteresis** (contract D16): a boundary is entered at `radius`
 *   and left only past `radius·(1+h)`, so a position jittering on the line does
 *   not flicker between states.
 * - **One-step-per-update, both directions** (contract D15/§2.5): the transition
 *   table below can only move a waypoint to an *adjacent* zone, so `IDLE↔ACTIVE`
 *   can never happen directly. This guarantees `PREFETCHING` (fetch+parse) always
 *   fires — and gets at least one update — before `ACTIVE` (visible), which is
 *   what hides the GLTF parse jank (§2.5.3). The clamp is not a separate step:
 *   it falls out of a per-current-state transition table.
 *
 * The machine writes zone *state* only; acting on it (fetch / show / dispose)
 * belongs to the consumer that reads the `zones` slice (component 8), never here.
 *
 * @see plans/2026-07-14-proximity-plan.md
 * @see plans/Shared-Contract.md §2.5 (zone-state consumer contract)
 */

import type { Vector3 } from 'three';

/** A waypoint's proximity zone (mirrors the `zones` slice's `ZoneState`). */
export type ZoneState = 'IDLE' | 'PREFETCHING' | 'ACTIVE';

/** A tracked object: a waypoint's resolved world-space anchor + its radii. */
export interface ProximityObject {
  readonly id: string;
  /** Resolved world-space anchor position (metres). Only X/Z are read (D17). */
  readonly position: Vector3;
  readonly prefetchRadius: number; // metres, IDLE ↔ PREFETCHING boundary
  readonly activeRadius: number; // metres, PREFETCHING ↔ ACTIVE boundary
}

/** Per-object zone state (the shape stored in the `zones` slice). */
export type ZoneMap = Readonly<Record<string, ZoneState>>;

/** One adjacent zone change emitted this update (drives consumer side effects). */
export interface ZoneTransition {
  readonly id: string;
  readonly from: ZoneState;
  readonly to: ZoneState;
}

export interface StepResult {
  /** Next zone for every input object (a superset is never produced). */
  readonly zones: ZoneMap;
  /** Adjacent edges that changed this update, in input order. */
  readonly transitions: readonly ZoneTransition[];
}

export interface StepConfig {
  /** Hysteresis fraction `h`: exit a boundary only past `radius·(1+h)` (D16). */
  readonly hysteresisFraction: number;
}

/** Ground-plane (X/Z) distance between two world positions, ignoring Y (D17). */
function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * The one-step transition table. Given the current zone and the horizontal
 * distance, return the *adjacent* next zone. Because each branch can only move
 * to a neighbour, the single-step clamp (D15) is structural — an `IDLE` object
 * deep inside the active radius still only reaches `PREFETCHING` this update.
 * Hysteresis (D16) lives in the asymmetric thresholds: enter at `radius`, leave
 * at `radius·(1+h)`.
 */
function nextZone(
  current: ZoneState,
  distance: number,
  obj: ProximityObject,
  h: number
): ZoneState {
  const activeExit = obj.activeRadius * (1 + h);
  const prefetchExit = obj.prefetchRadius * (1 + h);
  switch (current) {
    case 'IDLE':
      return distance <= obj.prefetchRadius ? 'PREFETCHING' : 'IDLE';
    case 'PREFETCHING':
      if (distance <= obj.activeRadius) return 'ACTIVE';
      if (distance > prefetchExit) return 'IDLE';
      return 'PREFETCHING';
    case 'ACTIVE':
      return distance > activeExit ? 'PREFETCHING' : 'ACTIVE';
  }
}

/**
 * Advance the machine one update. Pure: reads `prev[id]` (defaulting to `IDLE`)
 * for each object, computes its horizontal distance to the user, and applies the
 * transition table. Returns the next zone for every input object plus the list
 * of adjacent edges that changed.
 */
export function step(
  prev: ZoneMap,
  userPos: Vector3,
  objects: readonly ProximityObject[],
  config: StepConfig
): StepResult {
  const zones: Record<string, ZoneState> = {};
  const transitions: ZoneTransition[] = [];

  for (const obj of objects) {
    const from: ZoneState = prev[obj.id] ?? 'IDLE';
    const distance = horizontalDistance(userPos, obj.position);
    const to = nextZone(from, distance, obj, config.hysteresisFraction);
    zones[obj.id] = to;
    if (to !== from) transitions.push({ id: obj.id, from, to });
  }

  return { zones, transitions };
}
