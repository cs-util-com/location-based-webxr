/**
 * One printed code's world pose from the poses several AR visits measured
 * (authoring plan 2026-09-28-0953 §3.3, milestone M3a).
 *
 * Each visit measures the code through its OWN GPS alignment: a separate
 * WebXR session, a separate solve, a separate GPS error. This combines
 * those per-visit poses into one, the way the M3a spike measured best on
 * synthetic multi-visit fixtures (`code-estimate-across-visits.test.ts`):
 *
 * - **Position: weighted by 1/accuracy, over the best visits only.** The
 *   visits are taken best accuracy first, as many as minimise the
 *   predicted error `sqrt(k) / sum(1/a)`, so one more visit never raises
 *   it (M3a/M3b review #3: over every visit, 3.7 m and 30 m predicted
 *   4.66 m). Measured with five visits at 3 degrees of yaw noise (p50, the
 *   spike's four bias arms): it ties plain 1/accuracy where the bias
 *   tracks the accuracy (3.1 m against 2.9 for 1/accuracy² and 4.0 for the
 *   mean), gains 0.4-0.5 m where the visits' biases share a direction, and
 *   loses 0.3 m (1.0 m at p90) where the bias ignores the accuracy (4.3 m
 *   against 4.0 for 1/accuracy and 3.8 for the mean). Field data decides
 *   which world the phones live in; the sidecar names the reversal.
 * - **Heading: weighted by the heading model**, `1 / sigma²` with
 *   `sigma = hypot(code yaw noise, atan(accuracy / baseline))` (plan §3.3).
 *   A short walk cannot fix the alignment's yaw, and the page measures the
 *   walk itself, so this weighting won in every measured arm.
 *
 * Pure and NOT wired anywhere: whether the summary screen shows it, and
 * whether it ever replaces the stored reference (D10b), are M3b and an
 * owner decision.
 *
 * @see code-visit-combine.ts.md
 */

import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import { Quaternion } from "three";

import { objectPoseNue } from "./content-placement.js";

/**
 * The code's own pose-solve yaw error per visit (degrees, one sigma), the
 * floor of the heading model; an assumption for a stable fused pose of a
 * 16 cm code at 1-3 m, not a measurement. Swept 1/2/3/5° in the M3a spike
 * (M3a/M3b review #4; synthetic yaw noise 1/3/5°, two visit mixes, four
 * bias arms, 5,000 codes per row): in the default mix the share of codes
 * called Good moved by at most 1 point (41 % to 40 % at 5°), its precision
 * by at most 2, and the combined heading by at most 0.1° p50 - the
 * atan(accuracy / walk) term dominates; in the hurried mix (4-20 m GPS,
 * 10-30 m walks) almost no code is Good at any sigma. What it does move is
 * the "walk further" distance:
 * 4.72 x the accuracy at 1°, 4.77 x at 2°, 4.86 x at 3°, 5.19 x at 5°.
 */
export const CODE_YAW_NOISE_DEG = 2;

/**
 * The smallest accuracy a visit is credited with (m). A phone's reported
 * accuracy below this is optimism, and an honest-looking 0.1 m would take
 * all the weight from every other visit.
 */
export const MIN_VISIT_ACCURACY_M = 1;

/** The smallest walked baseline credited (m): keeps `atan(a / L)` finite. */
export const MIN_BASELINE_M = 1;

/** One visit's measurement of a code. */
export interface CodeVisitPose {
  /** The code through THIS visit's own alignment (not code-corrected). */
  readonly geo: QrGeoPose;
  /** The visit's median reported GPS accuracy (m). */
  readonly gpsAccuracyM: number;
  /** The largest horizontal extent of the visit's walk (m). */
  readonly baselineM: number;
}

export interface CombinedCodePose {
  /** The combined pose, minted like any level (`mintQrGeoPose`). */
  readonly geo: QrGeoPose;
  /** The visits actually combined (unusable ones are skipped); every one
   *  has its say in the heading. */
  readonly visitCount: number;
  /** How many of them the position combines: the best by accuracy, as
   *  many as minimise `predictedHorizontalM`. */
  readonly positionVisitCount: number;
  /** `sqrt(k) / sum(1 / accuracy)` over the position's visits: the
   *  horizontal error expected if each errs by about its accuracy,
   *  independently (m). The ring's radius; never rises with another
   *  visit. */
  readonly predictedHorizontalM: number;
  /** `1 / sqrt(sum(1 / sigma²))` of the heading model (degrees). An upper
   *  bound in the spike: the measured error sat at 0.1-0.4 of it at the
   *  median. */
  readonly predictedHeadingDeg: number;
  /** The largest horizontal distance of a visit from the result (m). */
  readonly maxOffsetM: number;
  /** The largest yaw of a visit from the result (degrees). */
  readonly maxHeadingOffsetDeg: number;
}

interface UsableVisit {
  readonly position: readonly [number, number, number];
  readonly rotation: Quaternion;
  readonly accuracyM: number;
  readonly baselineM: number;
}

const RAD = Math.PI / 180;

function finite(...values: readonly unknown[]): boolean {
  return values.every((v) => typeof v === "number" && Number.isFinite(v));
}

function hasOrientation(geo: QrGeoPose): boolean {
  if (geo.rotation !== undefined) {
    return (
      geo.rotation.length === 4 &&
      finite(...geo.rotation) &&
      Math.hypot(...geo.rotation) > 1e-6
    );
  }
  return finite(geo.headingDeg);
}

function isUsable(visit: CodeVisitPose): boolean {
  const { geo } = visit;
  return (
    finite(geo.lat, geo.lon, geo.alt, visit.gpsAccuracyM, visit.baselineM) &&
    visit.gpsAccuracyM > 0 &&
    visit.baselineM >= 0 &&
    hasOrientation(geo)
  );
}

function usable(visit: CodeVisitPose, zero: LatLong): UsableVisit {
  const pose = objectPoseNue(visit.geo, zero);
  return {
    position: pose.positionNue,
    rotation: new Quaternion(...pose.rotationNue).normalize(),
    accuracyM: Math.max(visit.gpsAccuracyM, MIN_VISIT_ACCURACY_M),
    baselineM: Math.max(visit.baselineM, MIN_BASELINE_M),
  };
}

/** The heading model's sigma for one visit (radians). */
function headingSigmaRad(v: UsableVisit): number {
  return Math.hypot(
    CODE_YAW_NOISE_DEG * RAD,
    Math.atan(v.accuracyM / v.baselineM),
  );
}

/** The yaw (radians, about Up) of `rotation · reference⁻¹`, or null for
 *  the pair with no defined yaw (a half turn about a horizontal axis). */
function yawFrom(reference: Quaternion, rotation: Quaternion): number | null {
  const delta = rotation.clone().multiply(reference.clone().invert());
  if (Math.hypot(delta.y, delta.w) < 1e-9) return null;
  return 2 * Math.atan2(delta.y, delta.w);
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** `sqrt(k) / sum(1 / a)`: the horizontal error expected from `visits`
 *  weighted by 1/accuracy if each errs by about its accuracy,
 *  independently. */
function predictedHorizontal(visits: readonly UsableVisit[]): number {
  return (
    Math.sqrt(visits.length) / visits.reduce((s, v) => s + 1 / v.accuracyM, 0)
  );
}

/**
 * The visits the position combines: the best ones by accuracy, as many as
 * minimise {@link predictedHorizontal}. For each count k the k most
 * accurate visits give the smallest prediction, so this is the best subset
 * of any size - and one more visit can only add a candidate, never take
 * one away, so the prediction never rises (M3a/M3b review #3). A tie keeps
 * the larger subset: more visits, the same prediction. Equal accuracies are
 * ordered by position, so the result never depends on the visits' order.
 */
function positionSubset(visits: readonly UsableVisit[]): UsableVisit[] {
  const sorted = [...visits].sort(
    (a, b) =>
      a.accuracyM - b.accuracyM ||
      a.position[0] - b.position[0] ||
      a.position[2] - b.position[2] ||
      a.position[1] - b.position[1],
  );
  let bestK = 1;
  let best = Number.POSITIVE_INFINITY;
  let inverse = 0;
  sorted.forEach((v, i) => {
    inverse += 1 / v.accuracyM;
    const predicted = Math.sqrt(i + 1) / inverse;
    if (predicted <= best) {
      best = predicted;
      bestK = i + 1;
    }
  });
  return sorted.slice(0, bestK);
}

function weightedPosition(
  visits: readonly UsableVisit[],
): [number, number, number] {
  const weights = visits.map((v) => 1 / v.accuracyM);
  const total = weights.reduce((a, b) => a + b, 0);
  const sum = (axis: 0 | 1 | 2): number =>
    visits.reduce((s, v, i) => s + v.position[axis] * weights[i]!, 0) / total;
  return [sum(0), sum(1), sum(2)];
}

/** The combined rotation: the best-weighted visit's rotation turned about
 *  Up by the weighted circular mean of every visit's yaw from it. Tilt is
 *  the reference visit's (pose-solve noise; the settle never turns Up
 *  either). Also each visit's yaw from the result, for the offset. */
function weightedRotation(visits: readonly UsableVisit[]): {
  rotation: Quaternion;
  yawOffsets: number[];
} {
  const weights = visits.map((v) => 1 / headingSigmaRad(v) ** 2);
  const best = weights.indexOf(Math.max(...weights));
  const reference = visits[best]!.rotation;
  const yaws = visits.map((v) => yawFrom(reference, v.rotation));
  let s = 0;
  let c = 0;
  yaws.forEach((yaw, i) => {
    if (yaw === null) return; // no defined yaw: no say in the heading
    s += weights[i]! * Math.sin(yaw);
    c += weights[i]! * Math.cos(yaw);
  });
  const mean = Math.atan2(s, c);
  const turn = new Quaternion(0, Math.sin(mean / 2), 0, Math.cos(mean / 2));
  return {
    rotation: turn.multiply(reference).normalize(),
    yawOffsets: yaws.flatMap((yaw) => (yaw === null ? [] : [wrap(yaw - mean)])),
  };
}

/**
 * Combine one code's per-visit measurements into one world pose.
 *
 * @returns null when no visit is usable (non-finite numbers, a
 *   non-positive accuracy, a negative baseline or no orientation are
 *   skipped, not repaired), or the result cannot be minted.
 */
export function combineCodeVisits(
  visits: readonly CodeVisitPose[],
): CombinedCodePose | null {
  const valid = visits.filter(isUsable);
  const first = valid[0];
  if (first === undefined) return null;
  const zero: LatLong = { lat: first.geo.lat, lon: first.geo.lon };
  const placed = valid.map((v) => usable(v, zero));
  const subset = positionSubset(placed);
  const position = weightedPosition(subset);
  // The heading takes EVERY usable visit: its weights are the inverse
  // variance of its own model, so under that model another visit only adds
  // information and its prediction cannot rise; a poor-GPS visit with a
  // long walk is a good heading witness.
  const { rotation, yawOffsets } = weightedRotation(placed);
  let geo: QrGeoPose;
  try {
    geo = mintQrGeoPose({
      worldNuePosition: { x: position[0], y: position[1], z: position[2] },
      worldNueRotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      zero,
    });
  } catch {
    return null;
  }
  const headingInfo = placed.reduce(
    (s, v) => s + 1 / headingSigmaRad(v) ** 2,
    0,
  );
  return {
    geo,
    visitCount: placed.length,
    positionVisitCount: subset.length,
    predictedHorizontalM: predictedHorizontal(subset),
    predictedHeadingDeg: 1 / Math.sqrt(headingInfo) / RAD,
    maxOffsetM: Math.max(
      ...placed.map((v) =>
        Math.hypot(v.position[0] - position[0], v.position[2] - position[2]),
      ),
    ),
    maxHeadingOffsetDeg: Math.max(
      0,
      ...yawOffsets.map((y) => Math.abs(y) / RAD),
    ),
  };
}
