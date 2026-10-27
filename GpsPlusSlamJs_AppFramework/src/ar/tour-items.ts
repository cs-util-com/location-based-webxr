/**
 * Where a station's blocks stand: a LOCAL pose relative to the station
 * (`tour-stations.ts`), which carries the geo pose. A station moves
 * rigidly with everything it holds: moving it changes its own geo pose,
 * never its blocks' local poses (`tour-station-pose.ts` converts both
 * ways).
 *
 * Defensive by the rule of `tour-manifest.ts`: hand-editable external data,
 * checked at the boundary. A pose is structural, so a bad one fails at
 * every minor (no later revision can make it a pose).
 *
 * @see tour-items.ts.md
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import { renormalizeUnitQuaternion } from './qr/qr-geo-pose-minting.js';
import type { Pose } from './qr/qr-pose.js';
import type { TourFail } from './tour-fields.js';

/**
 * A pose in a station's own frame: `position` in metres along the
 * station's rotated North, Up and East axes from its geo position;
 * `rotation` a unit quaternion `[x, y, z, w]` relative to the station's.
 */
export type TourLocalPose = Pose;

/**
 * How far a block may stand from its station, per axis (m). Not a design
 * limit (the editor keeps stations far smaller): a sanity bound, so a
 * hand-edited or corrupted number cannot put a block a planet away, where
 * the station's flat frame means nothing.
 */
export const TOUR_ITEM_MAX_OFFSET_M = 10_000;

/** A local pose: three finite offsets within the sanity bound, and a unit
 *  quaternion renormalized by the level files' one rule. */
export function parseTourLocalPose(
  value: unknown,
  at: string,
  fail: TourFail
): TourLocalPose {
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  const { position, rotation } = value;
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(
      (v) => isFiniteNumber(v) && Math.abs(v) <= TOUR_ITEM_MAX_OFFSET_M
    )
  ) {
    fail(
      `"${at}.position" must be three numbers within ${String(TOUR_ITEM_MAX_OFFSET_M)} m`
    );
  }
  const unit =
    Array.isArray(rotation) && rotation.every(isFiniteNumber)
      ? renormalizeUnitQuaternion(rotation as [number, number, number, number])
      : undefined;
  if (unit === undefined)
    return fail(`"${at}.rotation" must be a unit quaternion`);
  const [n, u, e] = position as [number, number, number];
  // `+ 0` canonicalizes -0, which JSON cannot carry (round trips exact).
  return { position: [n + 0, u + 0, e + 0], rotation: unit };
}
