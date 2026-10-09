/**
 * The flat cloud layer's share by altitude (round-2 plan 2026-10-07-2350,
 * DEC-FR2-5 as revised by its cold review, finding 4): the NASA cloud map,
 * painted into the ground high up and on the cloud shell lower down.
 *
 * The owner (2026-10-07, on r793): the layer "is still too visible at 1,000
 * km and at 100 km; it should weaken much earlier and be gone at the latest
 * when the volumetric clouds are fully in". So:
 *
 * - full from `topM` up;
 * - easing in the altitude's logarithm to `weakShare` by `weakM`;
 * - from the volume's ceiling down, `weakShare` x (1 - the volume's share),
 *   the volume's own fade: gone exactly when the volume is full, and never
 *   the clouds twice or not at all (the C2 invariant of
 *   `globe-cloud-volume.ts`).
 *
 * Pure. The caller scales both of the layer's forms with it (the painted
 * term and the shell), and their shadow and the water's cloud mask, never
 * the global cloud opacity (the volume reads that too).
 *
 * @see globe-cloud-flat-fade.ts.md
 */

import { cloudVolumeShare } from "./globe-cloud-volume.js";
import { smoothstep } from "./globe-ease.js";

export const GLOBE_CLOUD_FLAT = {
  /** Full from here up, m (the owner: "at 3,500 km still quite visible"). */
  topM: 5_000_000,
  /** Weak by here, m (the owner: "at 100 km still too visible"). */
  weakM: 100_000,
  /** The share it weakens to, before the volume takes over. */
  weakShare: 0.3,
} as const;

/**
 * The flat layer's share at `altitudeM`, 0-1, for a volume fading in over
 * `fadeKm` below `ceilingKm` (pass the values the volume is drawn with).
 * RangeError for an altitude that is not finite, a weak share outside
 * [0, 1], or `topM` not above `weakM`.
 */
export function flatCloudShare(
  altitudeM: number,
  options: {
    readonly ceilingKm: number;
    readonly fadeKm: number;
    readonly topM?: number;
    readonly weakM?: number;
    readonly weakShare?: number;
  },
): number {
  const {
    topM = GLOBE_CLOUD_FLAT.topM,
    weakM = GLOBE_CLOUD_FLAT.weakM,
    weakShare = GLOBE_CLOUD_FLAT.weakShare,
  } = options;
  if (!Number.isFinite(altitudeM)) {
    throw new RangeError(`the altitude must be finite, got ${altitudeM}`);
  }
  if (!(weakShare >= 0 && weakShare <= 1)) {
    throw new RangeError(`the weak share must be in [0, 1], got ${weakShare}`);
  }
  if (!(topM > weakM && weakM > 0)) {
    throw new RangeError(
      `the top must be above the weak altitude, got ${topM}, ${weakM}`,
    );
  }
  const h = Math.max(altitudeM, 1);
  const x = Math.log(topM / h) / Math.log(topM / weakM);
  const weaken = 1 - (1 - weakShare) * smoothstep(x);
  const volume = cloudVolumeShare(h / 1000, {
    ceilingKm: options.ceilingKm,
    fadeKm: options.fadeKm,
  });
  return weaken * (1 - volume);
}
