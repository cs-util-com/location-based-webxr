/**
 * Proximity driver — the thin impure half of component 4 (TASK.md §2.3).
 *
 * The pure machine (`../core/proximity-machine.ts`) turns positions into zones;
 * this driver is the only part that touches the running app. Once per frame it:
 *   1. reads the live world-space user pose (injected — never mirrored into
 *      Redux, contract D11),
 *   2. runs the pure `step()` against the currently-anchored objects and the
 *      `zones` slice snapshot, and
 *   3. reports each transition through the injected `onTransition` callback —
 *      the composition wires that to `dispatch(setWaypointZone(...))`, keeping
 *      this file (and the whole view layer) Redux-free.
 *
 * That is *all* it does. It never imports the asset-provider or THREE — acting
 * on a zone (fetch / show / dispose) belongs to the consumer that reads the
 * `zones` slice (component 8, contract D15/§2.5). Everything the driver needs is
 * injected, so the same driver runs unchanged from the replay e2e and the
 * composed app; only the injected sources differ.
 *
 * **Movement-epsilon gate (perf only).** Walking proximity changes slowly, so
 * re-running `step()` when the user has moved less than a few centimetres is
 * wasted work that yields identical zones. The driver skips those ticks. This is
 * a pure optimisation — because the machine is memoryless in time (contract
 * §2.5), skipping a tick can never change the eventual zone, only defer an update
 * until the user has actually moved. Movement is measured from the last
 * *evaluated* pose, not the last tick, so many sub-epsilon hops still accumulate.
 *
 * @see plans/2026-07-14-proximity-plan.md
 */

import type { Vector3 } from 'three';

import {
  step,
  type ProximityObject,
  type StepConfig,
  type ZoneMap,
  type ZoneTransition,
} from './proximity-machine.js';

/** Default movement gate: skip re-evaluation below ~25 cm of horizontal motion. */
const DEFAULT_MOVEMENT_EPSILON_M = 0.25;

export interface ProximityDriverDeps {
  /** Live world-space user position, or `null` before a pose is available. */
  readonly getUserWorldPos: () => Vector3 | null;
  /** The currently-anchored objects only (unanchored waypoints are filtered
   *  out upstream — contract Q5; the machine leaves them at their seeded IDLE). */
  readonly getObjects: () => readonly ProximityObject[];
  /** Current zone snapshot (e.g. from a `zones` selector). */
  readonly getZones: () => ZoneMap;
  /** Called once per emitted zone edge, in input order. The composition wires
   *  this to `dispatch(setWaypointZone({ id, zone: to }))` — the callback must
   *  make the change visible to the next `getZones()` read (RTK dispatch is
   *  synchronous, so the real store satisfies this for free). */
  readonly onTransition: (transition: ZoneTransition) => void;
  readonly config: StepConfig;
  /** Horizontal movement below this (metres) skips the tick. Default 0.25. */
  readonly movementEpsilonM?: number;
}

export interface ProximityDriver {
  /** Evaluate one update. Call from the framework frame loop. */
  tick(): void;
  /** Forget the last evaluated pose so the next `tick()` always runs (e.g. on
   *  tour load / teleport). */
  reset(): void;
}

/** Squared horizontal (X/Z) distance — avoids a sqrt in the hot gate. */
function horizontalDistSq(
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function createProximityDriver(
  deps: ProximityDriverDeps
): ProximityDriver {
  const epsilon = deps.movementEpsilonM ?? DEFAULT_MOVEMENT_EPSILON_M;
  const epsilonSq = epsilon * epsilon;

  // Last pose the machine was actually evaluated at (null = never / after reset).
  let lastX: number | null = null;
  let lastZ = 0;

  return {
    tick(): void {
      const pos = deps.getUserWorldPos();
      if (pos === null) return;

      if (
        lastX !== null &&
        horizontalDistSq(pos.x, pos.z, lastX, lastZ) < epsilonSq
      ) {
        return; // gated: barely moved since the last evaluation
      }

      const { transitions } = step(
        deps.getZones(),
        pos,
        deps.getObjects(),
        deps.config
      );
      for (const t of transitions) {
        deps.onTransition(t);
      }

      lastX = pos.x;
      lastZ = pos.z;
    },

    reset(): void {
      lastX = null;
    },
  };
}
