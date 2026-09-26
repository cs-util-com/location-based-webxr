/**
 * The balls' state for the status line (owner feedback round 2, plan
 * 2026-09-26-2055 M1): how many rest (a resting ball is where a shadow is
 * seen), how many fell through the reconstructed floor (on a sparse room
 * they do, measured 2026-09-26), and how many lie within the shadow's reach.
 * Readable on the phone, where the desktop replay cannot look.
 *
 * @see ball-status.ts.md
 */

import type * as THREE from "three";

/** A ball is still in a step where it moved less than this (metres). */
export const RESTING_MOVE_M = 0.002;
/**
 * A ball rests after this many still steps in a row (half a second at the
 * physics' fixed 1/60 s step): one still step is only a bounce's apex.
 */
export const STILL_STEPS = 30;
/**
 * A ball this far below the viewer has left the room through its floor: a
 * phone is held about 1.4 m above the floor, so 3 m below it is well under.
 */
export const FELL_THROUGH_BELOW_VIEWER_M = 3;

export interface BallStatus {
  readonly balls: number;
  readonly resting: number;
  readonly fellThrough: number;
  /** Balls within the shadow's reach (0 when no predicate was given). */
  readonly inRange: number;
}

/**
 * Per physics step, from the balls' world positions and the viewer's world
 * height. Each ball is compared with its position one step before, by its
 * place in the list; when the number of balls changes (a spawn, a despawn,
 * a clear) every stillness count starts over. (A despawn and a spawn in the
 * same step keep the number, so a pair can be wrong for one step: at worst
 * a ball reads as not resting for half a second more.)
 */
export function createBallStatus() {
  let previous: THREE.Vector3[] = [];
  let still: number[] = [];
  return {
    update(
      balls: readonly { position: THREE.Vector3 }[],
      viewerY: number,
      inRange?: (position: THREE.Vector3) => boolean,
    ): BallStatus {
      const same = previous.length === balls.length;
      if (!same) still = balls.map(() => 0);
      let resting = 0;
      let fellThrough = 0;
      let near = 0;
      balls.forEach((ball, i) => {
        const moved = same
          ? ball.position.distanceTo(previous[i]!)
          : Number.POSITIVE_INFINITY;
        still[i] = moved < RESTING_MOVE_M ? (still[i] ?? 0) + 1 : 0;
        if (inRange?.(ball.position)) near += 1;
        if (ball.position.y < viewerY - FELL_THROUGH_BELOW_VIEWER_M) {
          fellThrough += 1;
        } else if (still[i] >= STILL_STEPS) {
          resting += 1;
        }
      });
      previous = balls.map((b) => b.position.clone());
      return { balls: balls.length, resting, fellThrough, inRange: near };
    },
  };
}

/**
 * "balls 3 (2 resting, 1 fell through, 2 in shadow range)"; only the counts
 * that are there.
 */
export function ballStatusText(status: BallStatus): string {
  const parts = [
    status.resting > 0 ? `${status.resting} resting` : "",
    status.fellThrough > 0 ? `${status.fellThrough} fell through` : "",
    status.inRange > 0 ? `${status.inRange} in shadow range` : "",
  ].filter(Boolean);
  return parts.length > 0
    ? `balls ${status.balls} (${parts.join(", ")})`
    : `balls ${status.balls}`;
}

/**
 * The stats line, one format for AR and the replay (the e2e reads "balls N "
 * and "collider N tris" from it): the balls, the collider, the shadows' note.
 */
export function statsText(
  status: BallStatus,
  colliderTris: number,
  shadowsNote: string,
): string {
  return `${ballStatusText(status)} · collider ${colliderTris} tris${shadowsNote}`;
}
