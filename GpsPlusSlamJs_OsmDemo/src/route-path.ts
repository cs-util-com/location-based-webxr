/**
 * The planned route as scene geometry, and as a walk along it.
 *
 * WHY THIS IS ITS OWN MODULE. Two pieces of arithmetic sit between "the worker
 * returned a route" and "an agent is moving along a drawn line", and both are
 * the kind that fail silently:
 *
 * - **The ENU→scene reflection.** `+y` north becomes `-z` north. Get it wrong
 *   and the route is mirrored about the east axis — it still starts at the
 *   agent, still ends near the click, and still looks like a path, while running
 *   south past the wall it was supposed to go round. The package's own
 *   `mesh-orientation.test.ts` exists because exactly that shipped unnoticed.
 * - **The walk.** Reaching the destination is the easy half; REPORTING that it
 *   has been reached is the half the whole stage rests on, because `done` is
 *   what stops the animation. A walk that never finishes is a permanent rAF
 *   loop — measured at ~6x slower e2e with one test into a timeout (DEC-R11-15).
 *
 * Neither needs three.js, a renderer or a worker, so neither should be tested
 * through one. `building-view.ts` keeps the rAF and the `Line`; the judgement is
 * here.
 *
 * **THE ROUTE IS WALKED IN SCENE COORDINATES, NOT IN LAT/LNG.** Converting once,
 * on arrival, means the frame is applied in exactly one place — and the frame is
 * re-taken on a teleport, which is precisely when a second conversion would go
 * stale. It also makes the walk plain metric geometry rather than great-circle
 * arithmetic repeated per frame.
 *
 * @see route-path.ts.md
 */

import type { EnuFrame } from "gps-plus-slam-osm";

import type { RoutePoint } from "./agent-route.js";
import type { ScenePoint } from "./pick.js";

/**
 * How fast the agent moves, metres per second.
 *
 * A DEMO PACE, and deliberately not a human one. At a walking 1.4 m/s a 200 m
 * route takes nearly two and a half minutes — unwatchable, and untestable
 * without a timeout longer than the whole e2e suite's budget. Much above this
 * and the agent reads as a vehicle rather than as someone walking.
 */
export const AGENT_SPEED_MPS = 10;

/**
 * The route in the scene's frame, lifted clear of the ground it was sampled on.
 *
 * `liftM` is `ROUTE_LIFT_M` in production. It is a parameter rather than an
 * import so this module stays free of the layer ladder — and so a test can ask
 * for an unlifted path and read the heights directly.
 *
 * **The route is coplanar with the terrain by construction**: `heightM` IS the
 * ground height at that cell, sampled through the same field the ground plane
 * draws. An unlifted line therefore z-fights the ground along its whole length,
 * which reads as a rendering fault rather than as a route.
 */
export function scenePathOf(
  route: readonly RoutePoint[],
  frame: EnuFrame,
  liftM: number,
): ScenePoint[] {
  return route.map((step) => {
    const enu = frame.toEnu(step.position);
    // THE ONE PLACE THE REFLECTION HAPPENS on this path. `cell-mesh.ts` does the
    // same thing for the grid and the package's `packInstances` for the trees;
    // what must never happen is a fourth copy that disagrees about which way is
    // north.
    return { x: enu.x, y: step.heightM + liftM, z: -enu.y };
  });
}

/** Metres between two scene points, climb included. */
function distanceM(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * The whole path's length in metres, climb included.
 *
 * Climb counts because an agent walking up a hillside must not arrive early —
 * Heidelberg is in the corpus precisely because it has tens of metres of relief
 * inside one tile.
 */
export function pathLengthM(path: readonly ScenePoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += distanceM(path[i - 1]!, path[i]!);
  }
  return total;
}

/**
 * Where the agent is after walking `distanceM` along `path`, and whether it has
 * arrived.
 *
 * `undefined` for an empty path — there is no position to report and a caller
 * that defaulted to the origin would put the agent at the scene anchor, which is
 * a confidently wrong place rather than a missing one.
 *
 * A NEGATIVE DISTANCE CLAMPS to the start rather than extrapolating backwards. A
 * clock that goes backwards is not hypothetical (a tab restored from bfcache, a
 * test that rewinds), and walking off the front of the route is a worse answer
 * than standing still.
 *
 * **`done` is the contract that matters.** It is what stops the animation, so a
 * path that never reports it is a permanent render loop. A single-point path is
 * `done` immediately, which is the shortest route to that failure: a destination
 * in the agent's own cell.
 */
export function pointAlong(
  path: readonly ScenePoint[],
  walkedM: number,
): { point: ScenePoint; done: boolean } | undefined {
  const first = path[0];
  if (first === undefined) return undefined;
  const last = path[path.length - 1]!;
  if (path.length === 1) return { point: first, done: true };
  if (walkedM <= 0) return { point: first, done: false };

  let remaining = walkedM;
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1]!;
    const to = path[i]!;
    const segment = distanceM(from, to);
    // A zero-length segment is skipped rather than divided by. Two consecutive
    // route points can share a cell centre once the heights match, and `0 / 0`
    // would put the agent at `NaN` for the rest of the walk.
    if (segment <= 0) continue;
    if (remaining < segment) {
      const t = remaining / segment;
      return {
        point: {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          z: from.z + (to.z - from.z) * t,
        },
        done: false,
      };
    }
    remaining -= segment;
  }
  return { point: last, done: true };
}
