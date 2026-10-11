/**
 * How far the author has WALKED in the running visit so far: the odometry
 * path length over the store's device fixes, folded as the GPS list grows
 * (review R1 and R3 of D33, authoring plan 2026-09-28-0953 §7p).
 *
 * WHY. SLAM drift grows with the distance walked, not with time: an author
 * who stands still for five minutes adds no drift, one who walks 300 m and
 * back to the same spot adds 300 m worth. So the settle measures "near a
 * code event" (R1) and "the sighting nearest a note" (R3) in walked metres,
 * which a displacement would get wrong for every out-and-back.
 *
 * The fixes come through `deviceSamples` (`visit-log.ts`), the ONE
 * device-only filter of the store's GPS history (DEC-H3): a synthetic code
 * vote's odometry is the code's corner, not a place anybody walked.
 *
 * @see walked-distance-tracker.ts.md
 */

import { deviceSamples, type VisitLogInput } from "./visit-log.js";

type WalkedInput = Pick<VisitLogInput, "gpsPositions" | "odometryPositions">;

export interface WalkedDistanceTracker {
  /**
   * The path length (m) walked over the device fixes of the input, folding
   * only the fixes added since the last call. A list shorter than the last
   * one, or starting with another fix object, is a new walk (a store reset,
   * a new AR entry) and is counted from scratch.
   */
  update(input: WalkedInput): number;
}

export function createWalkedDistanceTracker(): WalkedDistanceTracker {
  let folded = 0;
  let first: unknown = null;
  /** The odometry (north, east) of the last device fix folded. */
  let last: readonly [number, number] | null = null;
  let walked = 0;

  return {
    update(input) {
      const { gpsPositions, odometryPositions } = input;
      const head: unknown = gpsPositions[0] ?? null;
      if (gpsPositions.length < folded || (folded > 0 && head !== first)) {
        folded = 0;
        last = null;
        walked = 0;
      }
      first = head;
      if (gpsPositions.length === folded) return walked;
      const tail = deviceSamples({
        gpsPositions: gpsPositions.slice(folded),
        // Unpaired lists give no odometry (`deviceSamples`), so no step.
        odometryPositions:
          odometryPositions.length === gpsPositions.length
            ? odometryPositions.slice(folded)
            : [],
      });
      for (const { odom } of tail) {
        if (odom === null) continue;
        const at: [number, number] = [odom[0]!, odom[2]!];
        if (last !== null)
          walked += Math.hypot(at[0] - last[0], at[1] - last[1]);
        last = at;
      }
      folded = gpsPositions.length;
      return walked;
    },
  };
}
