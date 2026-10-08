/**
 * The settle's measurement for the automatic code-spot rule (code book plan,
 * M6 v5.1): for each sighting of a stored code, how far the visit's GPS puts
 * the code from each of its KNOWN spots, by the viewer's own rigid fit
 * (`estimateCodeDisplacement`, `CODE_MOVE_ESTIMATOR`, the shipped gate) over
 * the viewer's window around the sighting (`MOVED_CODE_FIT_WINDOW_S` before,
 * `MOVED_CODE_HORIZON_S` after); then `code-spots.ts` decides. Pure and
 * geometry-only: the caller hands every pose in the visit's NUE frame.
 *
 * @see code-spot-settle.ts.md
 */

import {
  CODE_MOVE_ESTIMATOR,
  CODE_MOVE_RULE,
  estimateCodeDisplacement,
  MOVED_CODE_FLOOR_M,
  pinCode,
  type DisplacementSample,
} from "./code-displacement.js";
import {
  decideCodeSpot,
  nearestSpot,
  type CodeSpotDecision,
  type SightingFit,
  type SpotRef,
} from "./code-spots.js";
import {
  MOVED_CODE_FIT_WINDOW_S,
  MOVED_CODE_HORIZON_S,
} from "./moved-code-rule.js";
import type { NuePose } from "./visit-anchoring.js";

/** One kept sighting of the code in the visit. */
export interface SpotSighting {
  /** When it was seen (epoch ms): the fit's window is centred here. */
  readonly atMs: number;
  /** The code's stable pose in odometry-NUE (`odomNueFromWebXr`). */
  readonly codeOdomNue: NuePose;
  /** Where the visit's alignment saw it (north, east): classifies it when
   *  the visit has no gated fit. */
  readonly seenNue?: readonly [number, number];
}

export interface CodeSpotJudgement {
  readonly decision: CodeSpotDecision;
  /** Per sighting, the known spot it belongs to ("new": none; null: no
   *  fit and no alignment view). */
  readonly classes: readonly (SpotRef | "new" | null)[];
}

const horizontal = (
  a: readonly number[],
  b: readonly [number, number],
): number => Math.hypot(a[0]! - b[0], a[2]! - b[1]);

/** The fit of one sighting against every spot, or no distances when the
 *  viewer's gate is not met (too short, or too little spread). */
function fitOf(
  sighting: SpotSighting,
  spots: readonly { spot: SpotRef; pose: NuePose }[],
  samples: readonly DisplacementSample[],
): SightingFit {
  const from = sighting.atMs - MOVED_CODE_FIT_WINDOW_S * 1000;
  const to = sighting.atMs + MOVED_CODE_HORIZON_S * 1000;
  const window = samples.filter((s) => s.tMs >= from && s.tMs <= to);
  const distancesM: { spot: SpotRef; m: number }[] = [];
  for (const { spot, pose } of spots) {
    const pin = pinCode(sighting.codeOdomNue, pose);
    const est =
      pin === null
        ? null
        : estimateCodeDisplacement(window, pin, CODE_MOVE_ESTIMATOR);
    if (
      est === null ||
      !(est.spanS >= CODE_MOVE_RULE.minSpanS) ||
      !(est.spreadM >= CODE_MOVE_RULE.minSpreadM)
    ) {
      return { distancesM: [] };
    }
    distancesM.push({ spot, m: est.magnitudeM });
  }
  return { distancesM };
}

/**
 * @param input.spots the code's known spots in the visit's NUE frame: the
 *   current one first, then `previous` and the copies
 * @param input.candidate where a move would mint the code (north, east),
 *   or null when it cannot: then nothing moves
 */
export function judgeCodeSpots(input: {
  spots: readonly { spot: SpotRef; pose: NuePose }[];
  sightings: readonly SpotSighting[];
  samples: readonly DisplacementSample[];
  candidate: readonly [number, number] | null;
  reliable: boolean;
  frameChanged: boolean;
  previousExpires: boolean;
  floorM?: number;
}): CodeSpotJudgement {
  const fits = input.sightings.map((s) => fitOf(s, input.spots, input.samples));
  const { candidate } = input;
  const decision = decideCodeSpot({
    sightings: fits,
    candidateDistancesM:
      candidate === null
        ? [Number.NaN]
        : input.spots.map(({ pose }) => horizontal(pose.position, candidate)),
    reliable: input.reliable,
    frameChanged: input.frameChanged,
    previousExpires: input.previousExpires,
    ...(input.floorM === undefined ? {} : { floorM: input.floorM }),
  });
  const classes = input.sightings.map((s, i) => {
    // After a frame change the fit mixes two frames, so it classifies
    // nothing (M6 milestone review #5); the sighting is placed by the
    // visit's end alignment instead (`spotByAlignment`). That view mixes
    // the frames too when the frame changed between the sighting and the
    // end - accepted (PR #566 review): it can only call a sighting a second
    // print, with half the floor as margin, which excludes it from this
    // visit's corrections; nothing is judged after a frame change, so it
    // never moves a code.
    const byFit = input.frameChanged
      ? null
      : nearestSpot(fits[i]!, input.floorM);
    if (byFit !== null || s.seenNue === undefined) return byFit;
    return spotByAlignment(s.seenNue, input.spots, input.floorM);
  });
  return { decision, classes };
}

/**
 * A sighting placed without a fit, by where the visit's alignment saw it:
 * GPS alone, so another known spot wins only when the sighting lies well
 * inside half the floor of it - a wrong "second print" refuses the
 * correction a sighting at home needs (M6 milestone review #6) - and the
 * current spot within the floor otherwise.
 */
export function spotByAlignment(
  seen: readonly [number, number],
  spots: readonly { spot: SpotRef; pose: NuePose }[],
  floorM = MOVED_CODE_FLOOR_M,
): SpotRef | "new" | null {
  const distancesM = spots.map(({ spot, pose }) => ({
    spot,
    m: horizontal(pose.position, seen),
  }));
  const nearest = nearestSpot({ distancesM }, floorM);
  if (nearest === null || nearest === "new" || nearest.kind === "current") {
    return nearest;
  }
  const m = distancesM.find((d) => d.spot === nearest)?.m ?? Infinity;
  if (m < floorM / 2) return nearest;
  const home = distancesM.find((d) => d.spot.kind === "current");
  return home !== undefined && home.m < floorM ? home.spot : "new";
}
