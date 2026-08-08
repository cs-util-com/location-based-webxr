/**
 * The agent as a body with mass, following the path (DEC-R13-3 … DEC-R13-5,
 * DEC-R13-14).
 *
 * WHAT THE SESSION ASKED FOR. The drawn route is exact and should stay exact —
 * "den exakten Pfad ... finde ich sehr gut" — but the figure sliding exactly
 * along it makes every hex vertex a hard direction change. The path should be a
 * REFERENCE curve, with the movement led smoothly along an averaged one,
 * "vielleicht sogar mit so einem typischen, physikbasierten, inertiabasierten
 * Lerping ... da hat er dann quasi so eine Masse und eine Geschwindigkeit". That
 * is what this is: the path position is a moving target and the agent
 * accelerates towards it, so the zigzag lives in the drawn line and not in the
 * motion.
 *
 * **THE PATH IS NOT SMOOTHED, THE AGENT IS** (DEC-R13-3). Drawing the smoothed
 * curve instead would look finished and destroy the view of what the planner
 * actually chose — which is the thing the session was trying to diagnose.
 *
 * **CRITICALLY DAMPED, NOT CLAMPED** (DEC-R13-5). The alternative was to clamp
 * the smoothed position back inside the routed cells, which guarantees the
 * invariant by construction and shows as the agent hugging a wall at a tight
 * corner. Tuning carries the invariant instead, so the invariant is written as a
 * property test rather than as a comment — see `agent-follower.property.test.ts`.
 *
 * **AND THE PROPERTY IS BOUNDED AT THE SHIPPED SPEED** (DEC-R13-14). Critical
 * damping bounds overshoot past a STATIONARY target; it does not bound
 * corner-cutting against a MOVING one. A lagging follower always cuts the inside
 * of a corner, and the cut grows without bound with speed — so "at any speed"
 * would be false by construction rather than untuned.
 *
 * @see agent-follower.ts.md
 */

import type { ScenePoint } from "./pick.js";

/**
 * Roughly how long the agent takes to close a gap to its target, in seconds.
 *
 * THE TUNABLE, and it trades two visible things against each other. Larger is
 * smoother and lags further behind the path; smaller tracks the polyline more
 * exactly and puts the zigzag back into the motion. It also sets the corner cut,
 * which at the demo's 10 m/s is what {@link FOLLOWER_MAX_DEVIATION_M} has to
 * cover — so raising it means re-running the corridor property, not just
 * watching the demo.
 *
 * 0.25 s is a quarter of a second of "body", which at `AGENT_SPEED_MPS` is
 * ~2.5 m of lag: enough to rounds off a 60° hex vertex, comfortably inside a
 * res-13 cell's 3.54 m inradius.
 */
export const FOLLOWER_SMOOTH_TIME_S = 0.25;

/**
 * How far the smoothed position may stray from the drawn polyline, in metres.
 *
 * THE RES-13 INRADIUS (edge 4.09 m → 4.09·√3/2 = 3.54 m), and the number is
 * chosen rather than measured on purpose: a point within one inradius of the
 * line joining two adjacent cell centres is inside one of the two cells the
 * planner actually cleared. So this is "the corridor the route was planned
 * through", expressed as a distance a test can evaluate — the route is a list of
 * points, and nothing in the codebase had a corridor object to assert against.
 *
 * The margin is deliberately not padded: the property is meant to fail if the
 * follower would clip a wall, and a generous bound is a property that cannot.
 */
export const FOLLOWER_MAX_DEVIATION_M = 3.54;

/** How close, and how slow, counts as arrived. */
const SETTLED_M = 0.05;
const SETTLED_MPS = 0.05;

/** The agent's smoothed position and the velocity carrying it. */
export interface Follower {
  readonly position: ScenePoint;
  /** Metres per second, in scene axes. */
  readonly velocity: ScenePoint;
}

/** A follower standing still at `position`. */
export function followerAt(position: ScenePoint): Follower {
  return { position, velocity: { x: 0, y: 0, z: 0 } };
}

function isFinitePoint(point: ScenePoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

/**
 * Advances the follower `dtS` seconds towards `target`.
 *
 * A CRITICALLY DAMPED SPRING, integrated in the closed form that stays stable at
 * any step size. The naive `velocity += (target - position) * k * dt` explodes
 * when `dt` is large — which is exactly what a backgrounded tab hands back on
 * its first frame — and would make the corridor property pass at 60 Hz and fail
 * at 20. Here a large `dt` simply arrives: the exponential term goes to zero and
 * the position lands on the target, which is the right answer for "the tab was
 * hidden for two seconds".
 *
 * **A NON-ADVANCING CLOCK RETURNS THE FOLLOWER UNCHANGED.** `dt <= 0` is real —
 * a tab restored from bfcache, a paused and resumed rAF, a test that rewinds —
 * and it is the same defence `route-path.ts` already makes on its own side.
 *
 * **A NON-FINITE TARGET IS REFUSED RATHER THAN CHASED.** The target comes from
 * `pointAlong` over worker-supplied geometry, and one `NaN` reaching the
 * integrator poisons the velocity permanently: the agent would never move again,
 * with nothing on screen to say why.
 */
export function stepFollower(
  follower: Follower,
  target: ScenePoint,
  dtS: number,
  smoothTimeS: number = FOLLOWER_SMOOTH_TIME_S,
): Follower {
  if (!Number.isFinite(dtS) || dtS <= 0) return follower;
  if (!isFinitePoint(target)) return follower;

  // The undamped angular frequency of a critically damped system whose
  // "roughly this long to arrive" is `smoothTimeS`.
  const omega = 2 / Math.max(1e-4, smoothTimeS);
  const x = omega * dtS;
  // A Padé-style approximation of `exp(-x)`, which is what makes the step
  // stable at any `dt` without calling `Math.exp` per axis per frame.
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  const axis = (
    position: number,
    velocity: number,
    to: number,
  ): { position: number; velocity: number } => {
    const offset = position - to;
    const damped = (velocity + omega * offset) * dtS;
    return {
      position: to + (offset + damped) * decay,
      velocity: (velocity - omega * damped) * decay,
    };
  };

  const x1 = axis(follower.position.x, follower.velocity.x, target.x);
  const y1 = axis(follower.position.y, follower.velocity.y, target.y);
  const z1 = axis(follower.position.z, follower.velocity.z, target.z);

  return {
    position: { x: x1.position, y: y1.position, z: z1.position },
    velocity: { x: x1.velocity, y: y1.velocity, z: z1.velocity },
  };
}

/**
 * Whether the agent has caught up with `target` and stopped.
 *
 * WHAT LETS THE rAF LOOP END. `pointAlong` reports `done` when the path has been
 * consumed, but the follower is still metres behind at that moment — so the walk
 * is over only once BOTH are true. A follower that approaches asymptotically and
 * never reports settled is a permanent render loop, which DEC-R11-15 measured at
 * ~6x slower e2e with one test into a timeout; the velocity term is what stops a
 * near-miss position reading as arrival while the body is still moving.
 */
export function followerSettled(
  follower: Follower,
  target: ScenePoint,
): boolean {
  const gap = Math.hypot(
    target.x - follower.position.x,
    target.y - follower.position.y,
    target.z - follower.position.z,
  );
  const speed = Math.hypot(
    follower.velocity.x,
    follower.velocity.y,
    follower.velocity.z,
  );
  return gap <= SETTLED_M && speed <= SETTLED_MPS;
}
