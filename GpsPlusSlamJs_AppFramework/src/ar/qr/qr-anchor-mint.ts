/**
 * Minting one printed code's world anchor from a whole recording's sightings.
 *
 * This is the step that turns "the camera saw this code eight times over three
 * minutes" into a single geo pose a later visitor can relocalize against.
 *
 * THREE DECISIONS LIVE HERE, and each was argued before it was coded — see
 * `GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
 * §3 M-C:
 *
 * 1. **Did the code move?** (DEC-4) Measured as the rotation disagreement
 *    ACROSS sightings, in the ODOMETRY frame — GPS never enters, so what is
 *    measured is SLAM drift plus real movement rather than alignment churn.
 *    Translation disagreement is reported but does not gate: over a
 *    three-minute walk, drift and a genuinely moved poster produce the same
 *    magnitude, so that threshold cannot be set honestly before field data.
 *
 * 2. **Which alignment?** (DEC-3, the owner's call over the simpler
 *    final-alignment variant) Each sighting is composed with the alignment as
 *    it stood AT that sighting.
 *
 * 3. **How are they combined?** Later sightings weigh more, on the owner's
 *    reasoning that a later alignment has seen more GPS. The counter-argument
 *    is recorded rather than hidden: later sightings also carry more
 *    accumulated drift, so this is a judgement the field probe is meant to
 *    settle. Both the weighted and the unweighted answer are returned, so the
 *    difference is visible instead of assumed.
 */

import { geodesicAngleRad } from '../../utils/geodesic-angle.js';
import { interpolatingMedian, weightedMedian } from '../../utils/median.js';
import { averageRotation } from './qr-pose-aggregation.js';
import {
  mintQrLevelFromWorld,
  qrWorldPoseFromOdom,
  type MintAlignmentInfo,
  type MintQrLevelResult,
  type WorldNuePose,
} from './qr-mint-level.js';
import type { QrSighting } from './qr-sighting-accumulator.js';
import type { Quaternion } from 'gps-plus-slam-js';

/**
 * Rotation disagreement across sightings above which the code is declared
 * MOVED and no anchor is written.
 *
 * A GUESS until the field recordings measure it. The planned negative-case
 * recording re-hangs the poster rotated by twenty degrees or more, so the
 * threshold sits below that and above what SLAM drift plausibly contributes
 * over a three-minute walk. The probe replaces it with a measured number.
 */
export const DEFAULT_MAX_FIXED_ROTATION_SPREAD_DEG = 15;

/**
 * How fast a sighting's influence decays with age (seconds).
 *
 * Weight is `1 / (1 + age / halfLife)`, age measured back from the LAST
 * sighting. Also a guess — the probe sets it, and until then the summary
 * screen shows the unweighted answer alongside so the difference is visible
 * in the field rather than assumed.
 */
export const DEFAULT_RECENCY_HALF_LIFE_S = 60;

export type QrAnchorDeclineReason =
  | 'no-sightings'
  | 'frame-changed'
  | 'moved'
  | 'no-alignment';

export interface QrAnchorQuality {
  sightingCount: number;
  detectionCount: number;
  /** Outlier-INCLUSIVE max pairwise rotation angle across sightings (deg). */
  rotationSpreadDeg: number;
  /** Max pairwise distance between sightings' odometry positions (m). */
  translationSpreadM: number;
  sizeM: number;
  sizeSpreadM: number;
  /** The same mint without recency weighting — for comparison in the field. */
  unweighted: { lat: number; lon: number; alt: number };
}

export type QrAnchorMintResult =
  | { ok: true; level: MintQrLevelResult; quality: QrAnchorQuality }
  | { ok: false; reason: QrAnchorDeclineReason; detail: string };

/** A sighting that has everything needed to place it, narrowed. */
interface PlaceableSighting {
  sighting: QrSighting;
  alignmentMatrix: NonNullable<QrSighting['alignmentMatrix']>;
  zero: NonNullable<QrSighting['zero']>;
}

export interface MintQrAnchorInput {
  sightings: readonly QrSighting[];
  /** From the accumulator: do these sightings straddle a frame change? */
  spansFrameChange: boolean;
  nowIso: string;
  maxFixedRotationSpreadDeg?: number;
  recencyHalfLifeS?: number;
}

/**
 * The cross-sighting rotation disagreement, OUTLIER-INCLUSIVE.
 *
 * Deliberately NOT `aggregateQrPose`/`averageRotation`: that function's
 * spread is documented as the max angle among the INLIERS to its robust mean,
 * with a 12-degree inlier threshold. A poster re-hung at twenty degrees is
 * therefore discarded as an outlier and the reported spread stays SMALL —
 * which would make this gate blind to exactly the case it exists to catch.
 * (M-A/M-C cold review, blocker 3.)
 */
export function maxPairwiseRotationDeg(
  rotations: readonly Quaternion[]
): number {
  let worst = 0;
  for (let i = 0; i < rotations.length; i += 1) {
    for (let j = i + 1; j < rotations.length; j += 1) {
      const a = rotations[i];
      const b = rotations[j];
      if (a === undefined || b === undefined) continue;
      const deg = (geodesicAngleRad(a, b) * 180) / Math.PI;
      if (deg > worst) worst = deg;
    }
  }
  return worst;
}

/** Max pairwise distance between positions (m) — reported, never gating. */
function maxPairwiseDistanceM(
  positions: readonly (readonly [number, number, number])[]
): number {
  let worst = 0;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const a = positions[i];
      const b = positions[j];
      if (a === undefined || b === undefined) continue;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/**
 * Combine one code's sightings into an anchor, or decline with a reason.
 *
 * Never throws: the callers are a zip contributor and a summary panel, and
 * both want a verdict rather than an exception.
 */
/**
 * Everything that can refuse before any composition happens: no evidence, a
 * frame change, or a code that turned too far between visits.
 */
function refuseUnusable(
  input: MintQrAnchorInput,
  rotationSpreadDeg: number
): QrAnchorMintResult | null {
  const maxSpread =
    input.maxFixedRotationSpreadDeg ?? DEFAULT_MAX_FIXED_ROTATION_SPREAD_DEG;
  if (input.sightings.length === 0) {
    return {
      ok: false,
      reason: 'no-sightings',
      detail: 'This code was never seen for long enough to place it.',
    };
  }
  if (input.spansFrameChange) {
    return {
      ok: false,
      reason: 'frame-changed',
      detail:
        'Tracking restarted while this code was being recorded, so its ' +
        'sightings are in different frames and cannot be compared.',
    };
  }
  if (rotationSpreadDeg > maxSpread) {
    return {
      ok: false,
      reason: 'moved',
      detail:
        `This code turned by ${rotationSpreadDeg.toFixed(1)}° between ` +
        `sightings, so it was probably moved. Nothing was written for it.`,
    };
  }
  return null;
}

/** The sightings that can be placed at all, narrowed by construction — a
 *  filter would not tell the compiler the fields are non-null, and casting
 *  one away is how a null reaches the composition. */
function placeableSightings(
  sightings: readonly QrSighting[]
): PlaceableSighting[] {
  const placeable: PlaceableSighting[] = [];
  for (const sighting of sightings) {
    const { alignmentMatrix, zero } = sighting;
    if (alignmentMatrix === null || zero === null) continue;
    placeable.push({ sighting, alignmentMatrix, zero });
  }
  return placeable;
}

/** `1 / (1 + age / halfLife)`, age measured back from the last sighting. */
function recencyWeights(
  placeable: readonly PlaceableSighting[],
  halfLifeS: number
): number[] {
  const lastAt = placeable.at(-1)?.sighting.lastTimestamp ?? 0;
  return placeable.map((p) => {
    const ageS = Math.max(0, (lastAt - p.sighting.lastTimestamp) / 1000);
    return 1 / (1 + ageS / halfLifeS);
  });
}

/** The combined world position, weighted and unweighted, plus the robust
 *  rotation — `null` when no orientation could be formed at all. */
function combinePlacements(
  worlds: readonly WorldNuePose[],
  weights: readonly number[]
): {
  weighted: { x: number; y: number; z: number };
  unweighted: { x: number; y: number; z: number };
  rotation: Quaternion | null;
} {
  const xs = worlds.map((w) => w.position.x);
  const ys = worlds.map((w) => w.position.y);
  const zs = worlds.map((w) => w.position.z);
  const averaged = averageRotation(worlds.map((w) => w.rotation));
  return {
    weighted: {
      x: weightedMedian(xs, weights),
      y: weightedMedian(ys, weights),
      z: weightedMedian(zs, weights),
    },
    unweighted: {
      x: interpolatingMedian(xs),
      y: interpolatingMedian(ys),
      z: interpolatingMedian(zs),
    },
    rotation: averaged?.quat ?? worlds.at(-1)?.rotation ?? null,
  };
}

/** The quality block, before the unweighted comparison is filled in. */
function buildQuality(
  sightings: readonly QrSighting[],
  sortedSizes: readonly number[],
  rotationSpreadDeg: number
): QrAnchorQuality {
  return {
    sightingCount: sightings.length,
    detectionCount: sightings.reduce((sum, s) => sum + s.detectionCount, 0),
    rotationSpreadDeg,
    translationSpreadM: maxPairwiseDistanceM(
      sightings.map((s) => s.odomPose.position)
    ),
    sizeM: interpolatingMedian(sortedSizes),
    sizeSpreadM:
      sortedSizes.length === 0
        ? 0
        : (sortedSizes.at(-1) ?? 0) - (sortedSizes[0] ?? 0),
    unweighted: { lat: 0, lon: 0, alt: 0 },
  };
}

/** The alignment facts the level assembly needs, from the last sighting. */
function tailAlignment(tail: PlaceableSighting | undefined): MintAlignmentInfo {
  return {
    hasMatrix: true,
    sampleCount: tail?.sighting.alignmentSampleCount ?? 0,
    ...(tail?.sighting.gpsAccuracyM !== undefined
      ? { gpsAccuracyM: tail.sighting.gpsAccuracyM }
      : {}),
  };
}

/**
 * Place every usable sighting and combine them — or the reason none of that
 * was possible. Both refusals live here so the entry point stays one
 * straight line, which is also what keeps it under the complexity budget.
 */
function placeOrRefuse(
  sightings: readonly QrSighting[],
  halfLifeS: number
):
  | { refusal: QrAnchorMintResult }
  | {
      placeable: PlaceableSighting[];
      combined: ReturnType<typeof combinePlacements>;
      rotation: Quaternion;
    } {
  const placeable = placeableSightings(sightings);
  if (placeable.length === 0) {
    return {
      refusal: {
        ok: false,
        reason: 'no-alignment',
        detail:
          'This code was seen, but the session never had a GPS alignment to ' +
          'place it against.',
      },
    };
  }
  const worlds = placeable.map((p) =>
    qrWorldPoseFromOdom(p.sighting.odomPose, p.alignmentMatrix)
  );
  const combined = combinePlacements(
    worlds,
    recencyWeights(placeable, halfLifeS)
  );
  if (combined.rotation === null) {
    return {
      refusal: {
        ok: false,
        reason: 'no-alignment',
        detail: 'No usable orientation could be combined for this code.',
      },
    };
  }
  return { placeable, combined, rotation: combined.rotation };
}

export function mintQrAnchorFromSightings(
  input: MintQrAnchorInput
): QrAnchorMintResult {
  const { sightings, nowIso } = input;
  const rotationSpreadDeg =
    sightings.length === 0
      ? 0
      : maxPairwiseRotationDeg(sightings.map((s) => s.odomPose.rotation));

  const refusal = refuseUnusable(input, rotationSpreadDeg);
  if (refusal !== null) return refusal;

  const placed = placeOrRefuse(
    sightings,
    input.recencyHalfLifeS ?? DEFAULT_RECENCY_HALF_LIFE_S
  );
  if ('refusal' in placed) return placed.refusal;
  const { placeable, combined, rotation } = placed;

  const sortedSizes = placeable
    .map((p) => p.sighting.sizeM)
    .sort((a, b) => a - b);
  const quality = buildQuality(sightings, sortedSizes, rotationSpreadDeg);
  const tail = placeable.at(-1);
  const shared = {
    zero: tail?.zero ?? null,
    alignment: tailAlignment(tail),
    sizeM: quality.sizeM,
    nowIso,
  };

  const level = mintQrLevelFromWorld({
    ...shared,
    world: { position: combined.weighted, rotation },
    quality: {
      sightingCount: quality.sightingCount,
      detectionCount: quality.detectionCount,
      rotationSpreadDeg: quality.rotationSpreadDeg,
      translationSpreadM: quality.translationSpreadM,
      physicalSizeSpreadM: quality.sizeSpreadM,
    },
  });
  if (!level.ok) {
    return { ok: false, reason: 'no-alignment', detail: level.error };
  }

  // The same mint WITHOUT recency weighting, so the field can see whether the
  // half-life guess is doing anything at all.
  const plain = mintQrLevelFromWorld({
    ...shared,
    world: { position: combined.unweighted, rotation },
  });
  const plainGeo = plain.ok ? plain.level.qr.geo : undefined;
  if (plainGeo !== undefined) {
    quality.unweighted = {
      lat: plainGeo.lat,
      lon: plainGeo.lon,
      alt: plainGeo.alt,
    };
  }

  return { ok: true, level, quality };
}
