/**
 * The camera's heading for the visitor's walk (visitor walk W4 build plan
 * 2026-10-21-1105, M3 and its review's finding 1): the bearing of the
 * camera's forward, held while the forward has too little of a horizontal
 * part to have a bearing worth showing. A phone held nearly flat over the
 * ground swings that bearing by tens of degrees per degree of hand tremor
 * (about 27 at 88 degrees down), which would spin the heading-up radar and
 * flip the direction words while the visitor holds still.
 *
 * @see camera-heading.ts.md
 */

import { nueBearingDeg } from "gps-plus-slam-app-framework/utils/nue-bearing";

/**
 * The horizontal share of the forward below which the heading is held
 * (`horizontalShare`): 0.25, the camera within about 14.5 degrees of
 * straight down. Swept 0.15-0.45 against 0.5-2 degrees of tremor
 * (`camera-heading.test.ts`; the sidecar has the table): the smallest
 * share keeping a degree of tremor under the direction words' 5 degree
 * hysteresis with a margin (3.9 degrees; 0.2 reaches 4.9, at the edge),
 * at the price of a heading held from about 75.5 degrees down. Reversed
 * by phone data showing more tremor at steep pitches (2 degrees needs
 * 0.4) or visitors guided with the phone between 65 and 75 degrees down.
 */
export const WALK_HEADING_MIN_SHARE = 0.25;

/** The forward's horizontal part over its length (0 straight up or down,
 *  1 level); 0 for a forward that is no direction. */
export function horizontalShare(
  forward: readonly [number, number, number],
): number {
  const [n, u, e] = forward;
  const length = Math.hypot(n, u, e);
  if (!Number.isFinite(length) || length === 0) return 0;
  return Math.hypot(n, e) / length;
}

/**
 * The camera's bearing, degrees from north, from its forward in NUE; the
 * last heading (`lastDeg`, null before any) while there is no forward or
 * its horizontal share is below `minShare`.
 */
export function cameraHeadingDeg(
  forward: readonly [number, number, number] | null,
  lastDeg: number | null,
  minShare: number = WALK_HEADING_MIN_SHARE,
): number | null {
  if (forward === null || horizontalShare(forward) < minShare) return lastDeg;
  return nueBearingDeg(forward[0], forward[2]) ?? lastDeg;
}
