/**
 * The agent's smoothed motion (DEC-R13-3, DEC-R13-4, DEC-R13-5, DEC-R13-14).
 *
 * Why these tests matter:
 * The ninth session liked that the exact path is drawn and disliked that the
 * figure slides exactly along it — "diesen Zickzack-Pfad ... sollte man als
 * Referenzkurve sehen", with the movement led smoothly along an averaged curve,
 * ideally with mass and velocity as in the C# code. DEC-R13-3 keeps the drawn
 * line exact, so this is the ONLY thing that removes the zigzag from what the
 * user sees.
 *
 * Two claims carry the round's risk and neither is observable on screen:
 *
 * - **it settles rather than oscillates.** A follower that rings around its
 *   target reads as a wobble, and one that never settles is a permanent rAF
 *   loop — measured at ~6x slower e2e once already (DEC-R11-15).
 * - **it stays inside the corridor the planner cleared** (DEC-R13-5, bounded by
 *   DEC-R13-14). A lagging follower always cuts the INSIDE of a corner, and the
 *   inside of a corner is exactly where the wall is when the route turns to go
 *   round something. Barrier avoidance is what this session praised by name, so
 *   the smoothing must not quietly undo it.
 */

import { describe, expect, it } from "vitest";

import {
  FOLLOWER_MAX_DEVIATION_M,
  FOLLOWER_SMOOTH_TIME_S,
  followerAt,
  followerSettled,
  stepFollower,
  type Follower,
} from "./agent-follower.js";
import { AGENT_SPEED_MPS, pathLengthM, pointAlong } from "./route-path.js";
import type { ScenePoint } from "./pick.js";

const at = (x: number, z: number): ScenePoint => ({ x, y: 0, z });

const distance = (a: ScenePoint, b: ScenePoint): number =>
  Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** Perpendicular distance from `point` to the segment `a`–`b`. */
function distanceToSegment(
  point: ScenePoint,
  a: ScenePoint,
  b: ScenePoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (lengthSq === 0) return distance(point, a);
  const t = Math.min(
    1,
    Math.max(
      0,
      ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) /
        lengthSq,
    ),
  );
  return distance(point, {
    x: a.x + dx * t,
    y: a.y + dy * t,
    z: a.z + dz * t,
  });
}

/** How far `point` strays from the polyline — the corridor measure. */
function distanceToPath(
  point: ScenePoint,
  path: readonly ScenePoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let at = 1; at < path.length; at += 1) {
    best = Math.min(best, distanceToSegment(point, path[at - 1]!, path[at]!));
  }
  return best;
}

/**
 * Walks `path` at `AGENT_SPEED_MPS`, stepping the follower at `dtS`, and reports
 * the worst distance it ever strayed from the polyline.
 *
 * This is the whole walk, exactly as `building-view.ts` runs it: the target is
 * `pointAlong` on the EXACT path (DEC-R13-3) and only the follower is smoothed.
 */
function worstStrayWalking(
  path: readonly ScenePoint[],
  dtS: number,
  speedMps = AGENT_SPEED_MPS,
): number {
  let follower: Follower = followerAt(path[0]!);
  let walkedM = 0;
  let worst = 0;
  const totalM = pathLengthM(path);
  // A generous margin past arrival, so the settle after the final vertex counts.
  for (let elapsed = 0; elapsed < totalM / speedMps + 4; elapsed += dtS) {
    walkedM += speedMps * dtS;
    const target = pointAlong(path, walkedM)!;
    follower = stepFollower(follower, target.point, dtS);
    worst = Math.max(worst, distanceToPath(follower.position, path));
  }
  return worst;
}

describe("stepFollower", () => {
  /**
   * CRITICALLY DAMPED, WHICH IS THE POINT OF DEC-R13-4 OVER A SPLINE. Towards a
   * stationary target the error must fall monotonically — a single step that
   * grows it is an overshoot, and an overshoot at a corner is the agent stepping
   * into whatever the route went around.
   */
  it("converges to a stationary target without ever overshooting", () => {
    const target = at(10, 0);
    let follower = followerAt(at(0, 0));
    let error = distance(follower.position, target);

    for (let step = 0; step < 200; step += 1) {
      follower = stepFollower(follower, target, 1 / 60);
      const now = distance(follower.position, target);
      expect(now).toBeLessThanOrEqual(error + 1e-9);
      error = now;
    }
    expect(error).toBeLessThan(0.01);
  });

  /**
   * THE OTHER HALF OF "NO OVERSHOOT": it must not sail PAST the target and come
   * back. Monotone error already implies it, but asserting the side as well is
   * what distinguishes critical damping from a fast underdamped spring that
   * happens to look monotone at 60 Hz.
   */
  it("never crosses to the far side of a stationary target", () => {
    const target = at(10, 0);
    let follower = followerAt(at(0, 0));
    for (let step = 0; step < 200; step += 1) {
      follower = stepFollower(follower, target, 1 / 60);
      expect(follower.position.x).toBeLessThanOrEqual(target.x + 1e-9);
    }
  });

  /**
   * ON A STRAIGHT RUN THE FOLLOWER IS ON THE LINE, and that is the honest form
   * of "smoothing must not move it off the path where there are no corners". It
   * does LAG along the line — any follower does, and the lag is what buys the
   * corner smoothing — so the assertion is about the perpendicular distance,
   * which is the thing a corridor cares about.
   */
  it("stays on the line itself while following a straight path", () => {
    const path = [at(0, 0), at(200, 0)];
    expect(worstStrayWalking(path, 1 / 60)).toBeLessThan(0.01);
  });

  /**
   * THE ASK, AS AN ASSERTION. Around a corner the smoothed route is SHORTER than
   * the polyline — that shortening IS the removed zigzag — while still tracking
   * it closely enough to read as the same route.
   */
  it("cuts a corner, which is what removes the zigzag", () => {
    const path = [at(0, 0), at(50, 0), at(50, 50)];
    let follower = followerAt(path[0]!);
    let walkedM = 0;
    let travelled = 0;
    for (let step = 0; step < 2000; step += 1) {
      walkedM += AGENT_SPEED_MPS / 60;
      const target = pointAlong(path, walkedM)!;
      const next = stepFollower(follower, target.point, 1 / 60);
      travelled += distance(follower.position, next.position);
      follower = next;
      if (target.done && followerSettled(follower, target.point)) break;
    }
    expect(travelled).toBeLessThan(pathLengthM(path));
    // ...but it really did go round the corner, rather than cutting the whole
    // thing off. Anything under the straight line start-to-end is not following.
    expect(travelled).toBeGreaterThan(distance(path[0]!, path[2]!));
  });

  /**
   * THE TUNING, PINNED — and this exists because the corridor PROPERTY does not
   * pin it. `FOLLOWER_MAX_DEVIATION_M` is a res-13 cell's inradius, chosen so
   * the follower cannot clip what the route went around; the shipped tuning
   * comes in six times under it, so the property stays green through a
   * four-fold mis-tuning. That is correct for a safety invariant and useless as
   * a guard on the number, so the number gets its own case.
   *
   * The measured figures at `FOLLOWER_SMOOTH_TIME_S = 0.25` and
   * `AGENT_SPEED_MPS = 10`, on a long approach into a 60° hex corner: 2.42 m of
   * along-track lag and 0.56 m of corner cut. The bounds below bracket both —
   * loose enough not to flake on the last decimal, tight enough that doubling
   * the smoothing fails them.
   */
  it("lags and cuts by the amounts the shipped tuning intends", () => {
    const span = 4.09 * Math.sqrt(3) * 4;
    const corner = [
      at(0, 0),
      at(span, 0),
      at(span + span * Math.cos(Math.PI / 3), span * Math.sin(Math.PI / 3)),
    ];

    let follower = followerAt(corner[0]!);
    let walkedM = 0;
    let worstLag = 0;
    for (let step = 0; step < 200; step += 1) {
      walkedM += AGENT_SPEED_MPS / 60;
      const target = pointAlong(corner, walkedM)!;
      follower = stepFollower(follower, target.point, 1 / 60);
      worstLag = Math.max(worstLag, distance(follower.position, target.point));
    }

    // The lag IS the smoothing: roughly speed × smooth time.
    expect(worstLag).toBeGreaterThan(
      AGENT_SPEED_MPS * FOLLOWER_SMOOTH_TIME_S * 0.8,
    );
    expect(worstLag).toBeLessThan(
      AGENT_SPEED_MPS * FOLLOWER_SMOOTH_TIME_S * 1.2,
    );
    // And the cut it buys stays far inside the corridor.
    expect(worstStrayWalking(corner, 1 / 60)).toBeGreaterThan(0.3);
    expect(worstStrayWalking(corner, 1 / 60)).toBeLessThan(0.8);
    expect(worstStrayWalking(corner, 1 / 60)).toBeLessThan(
      FOLLOWER_MAX_DEVIATION_M,
    );
  });

  /**
   * FRAME-RATE INDEPENDENCE, AND IT IS LOAD-BEARING. The follower is integrated
   * once per rAF frame, so a 144 Hz display and a throttled background tab step
   * it at very different rates. Without this the corridor property below would
   * pass at the test's step size and fail on someone's monitor.
   */
  it("ends in the same place whatever the step size", () => {
    const target = at(10, 7);
    const settleFrom = (dtS: number): ScenePoint => {
      let follower = followerAt(at(0, 0));
      for (let elapsed = 0; elapsed < 3; elapsed += dtS) {
        follower = stepFollower(follower, target, dtS);
      }
      return follower.position;
    };
    expect(distance(settleFrom(1 / 144), settleFrom(1 / 20))).toBeLessThan(
      0.05,
    );
  });

  /**
   * A NON-ADVANCING CLOCK MUST NOT MOVE THE AGENT. `dt <= 0` happens for real —
   * a tab restored from bfcache, a paused-then-resumed rAF, a test that rewinds
   * — and dividing by it would put the agent at `NaN` for the rest of the walk,
   * which `route-path.ts` already guards against on its own side.
   */
  it("ignores a non-advancing or non-finite step", () => {
    const start = followerAt(at(1, 2));
    for (const dtS of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stepFollower(start, at(99, 99), dtS)).toEqual(start);
    }
  });

  /**
   * A NON-FINITE TARGET IS REFUSED RATHER THAN CHASED. The target comes from
   * `pointAlong` over worker-supplied geometry, and one `NaN` reaching the
   * integrator poisons the follower's velocity permanently — the agent would
   * never move again, with nothing on screen to say why.
   */
  /**
   * A NON-FINITE SMOOTH TIME FALLS BACK RATHER THAN POISONING (review on #276).
   * `NaN` propagates into the velocity for ever; `Infinity` makes `omega` zero,
   * so the agent never moves and `followerSettled` never agrees — and since
   * `advanceWalk` keeps requesting frames until it does, that is exactly the
   * permanent rAF loop DEC-R11-15 exists to prevent. It is a parameter of an
   * exported function, so it is caller data like `dtS` and the target.
   */
  it("falls back to the default for a non-finite smooth time", () => {
    const target = at(10, 0);
    for (const smoothTimeS of [Number.NaN, Number.POSITIVE_INFINITY]) {
      let follower = followerAt(at(0, 0));
      for (let step = 0; step < 200; step += 1) {
        follower = stepFollower(follower, target, 1 / 60, smoothTimeS);
      }
      expect(Number.isFinite(follower.position.x)).toBe(true);
      expect(followerSettled(follower, target)).toBe(true);
    }
  });

  it("ignores a non-finite target", () => {
    const start = followerAt(at(1, 2));
    expect(stepFollower(start, { x: Number.NaN, y: 0, z: 0 }, 1 / 60)).toEqual(
      start,
    );
  });
});

describe("followerSettled", () => {
  /**
   * WHAT STOPS THE rAF LOOP once the walk has finished. `pointAlong` reports
   * `done` when the path has been consumed, but the follower is still metres
   * behind at that moment — so the loop has to keep drawing until this says the
   * body has caught up. A follower that asymptotically approaches and never
   * reports settled is a permanent render loop (DEC-R11-15).
   */
  it("is false while still approaching and true once arrived", () => {
    const target = at(10, 0);
    let follower = followerAt(at(0, 0));
    expect(followerSettled(follower, target)).toBe(false);

    let settledAfter = -1;
    for (let step = 0; step < 600; step += 1) {
      follower = stepFollower(follower, target, 1 / 60);
      if (followerSettled(follower, target)) {
        settledAfter = step;
        break;
      }
    }
    expect(settledAfter).toBeGreaterThan(0);
    // AND IT SETTLES PROMPTLY. A bound in seconds is what keeps "eventually
    // quiet" from meaning "quiet after ten seconds of an idle render loop".
    expect(settledAfter / 60).toBeLessThan(FOLLOWER_SMOOTH_TIME_S * 12);
  });

  it("is true for a follower that has not moved from its target", () => {
    expect(followerSettled(followerAt(at(3, 4)), at(3, 4))).toBe(true);
  });
});
