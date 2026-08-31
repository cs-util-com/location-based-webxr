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
  /** Sightings the position was actually combined from. */
  sightingCount: number;
  /** Sightings the fixedness gate looked at, placeable or not. */
  sightingsSeen: number;
  detectionCount: number;
  /** Outlier-INCLUSIVE max pairwise rotation angle across sightings (deg). */
  rotationSpreadDeg: number;
  /**
   * Outlier-INCLUSIVE max pairwise distance between sightings' odometry
   * positions (m) — the same set as {@link rotationSpreadDeg}, which it was
   * NOT until 2026-08-30 (it covered placeable sightings only).
   */
  translationSpreadM: number;
  sizeM: number;
  sizeSpreadM: number;
  /**
   * The same mint without recency weighting - for comparison in the field.
   *
   * OPTIONAL on purpose. It used to default to {0,0,0}, so an unweighted mint
   * that failed left Null Island in place and the session summary reported
   * something like "newest-visit weighting moved it 5500000.0 m" for a code
   * that minted fine. The comparison exists so the half-life guess can be
   * checked in the field, and a bogus number there is worse than none - so the
   * field is absent when it was not computed, and the summary skips the
   * sentence.
   */
  unweighted?: { lat: number; lon: number; alt: number };
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
  /**
   * **MUST be in ascending `lastTimestamp` order.** Three separate things
   * take "the latest sighting" as `placeable.at(-1)` — the recency weighting,
   * the GPS `zero` the anchor is minted against, and the stamped
   * `alignmentSampleCount` — so an unordered array does not merely weight
   * oddly, it mints against the wrong reference position.
   *
   * The one production caller (`qr-sighting-accumulator`) appends in arrival
   * order and therefore satisfies this for free, which is why nothing caught
   * it: the contract was real but unstated (PR #375 review). A second caller
   * assembling sightings from a map, a filter, or a persisted archive has no
   * such guarantee, and would fail silently rather than loudly.
   */
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

/**
 * The caller's half-life, or the default — rejecting values that would make
 * {@link recencyWeights} produce weights `weightedMedian` silently drops
 * (PR #390 review).
 *
 * `0` yields NaN for the newest sighting and 0 for every older one; a negative
 * value can make the denominator exactly 0, yielding Infinity. In both cases
 * `weightedMedian` discards the lot and falls back to the unweighted median,
 * so the weighting does not run AND `quality.unweighted` matches the weighted
 * answer — the readout that exists to show the weighting's effect reports
 * "0 m moved" precisely when it never happened. Loud beats silent here.
 *
 * "No decay" is expressible as a large finite half-life; Infinity is rejected
 * so the contract stays a single positive finite number.
 */
function resolveRecencyHalfLifeS(value: number | undefined): number {
  const halfLifeS = value ?? DEFAULT_RECENCY_HALF_LIFE_S;
  if (!Number.isFinite(halfLifeS) || halfLifeS <= 0) {
    throw new RangeError(
      'recencyHalfLifeS must be a positive, finite number of seconds; got ' +
        String(halfLifeS)
    );
  }
  return halfLifeS;
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
  const flat = worlds.map(() => 1);
  return {
    weighted: {
      x: weightedMedian(xs, weights),
      y: weightedMedian(ys, weights),
      z: weightedMedian(zs, weights),
    },
    // The SAME estimator with flat weights, deliberately — not
    // `interpolatingMedian`. That one averages the two middles while the
    // weighted median returns an observed sample, so for any even number of
    // sightings the two differ even with the weighting disabled, and the
    // "weighting moved it N m" readout would report a difference the
    // weighting did not cause. This comparison exists to make an unearned
    // half-life checkable in the field; confounding it defeats the point.
    unweighted: {
      x: weightedMedian(xs, flat),
      y: weightedMedian(ys, flat),
      z: weightedMedian(zs, flat),
    },
    rotation: averaged?.quat ?? worlds.at(-1)?.rotation ?? null,
  };
}

/** The quality block, before the unweighted comparison is filled in. */
function buildQuality(
  sightings: readonly QrSighting[],
  sortedSizes: readonly number[],
  rotationSpreadDeg: number,
  translationSpreadM: number
): QrAnchorQuality {
  return {
    sightingCount: sightings.length,
    detectionCount: sightings.reduce((sum, s) => sum + s.detectionCount, 0),
    rotationSpreadDeg,
    translationSpreadM,
    sizeM: interpolatingMedian(sortedSizes),
    sizeSpreadM:
      sortedSizes.length === 0
        ? 0
        : (sortedSizes.at(-1) ?? 0) - (sortedSizes[0] ?? 0),
    sightingsSeen: sightings.length,
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

/**
 * Combine one code's sightings into an anchor, or decline with a reason.
 *
 * (This doc comment sat above `refuseUnusable` until 2026-08-31, orphaned by a
 * refactor — it has always described THIS function.)
 *
 * **Never throws for a DATA condition.** The callers are a zip contributor and
 * a summary panel, and both want a verdict rather than an exception, so "never
 * seen", "tracking restarted" and "the poster moved" all come back as
 * `{ ok: false, reason }`.
 *
 * **It does throw `RangeError` for a caller BUG** — today only a
 * `recencyHalfLifeS` that is not a positive finite number. That is not a
 * softening of the contract above but its complement: a bad half-life is not
 * something the recording did, it is something the calling code did, and
 * {@link resolveRecencyHalfLifeS} records why degrading silently is the worse
 * option (the readout that would reveal it is the one it suppresses).
 */
export function mintQrAnchorFromSightings(
  input: MintQrAnchorInput
): QrAnchorMintResult {
  const { sightings, nowIso } = input;
  // Validated BEFORE the refusal paths below: a bad half-life is a caller bug,
  // and letting it hide behind "these sightings were unusable anyway" means it
  // only ever surfaces on the sessions that would otherwise have succeeded.
  const recencyHalfLifeS = resolveRecencyHalfLifeS(input.recencyHalfLifeS);
  // No empty-guard on either: both helpers start at `worst = 0` and their
  // nested loops do not execute for an empty array, so the ternaries that
  // used to sit here were provably dead branches — and removing them is what
  // keeps this function under the complexity limit after the change below.
  const rotationSpreadDeg = maxPairwiseRotationDeg(
    sightings.map((s) => s.odomPose.rotation)
  );
  // Outlier-INCLUSIVE like the rotation spread beside it, and it was not
  // (PR #377 review): it was computed inside buildQuality over PLACEABLE
  // sightings only, so two numbers printed side by side covered different
  // sets with nothing saying so. It is the only signal an author gets for a
  // poster that was SLID rather than turned, and on an authoring walk the
  // filtered-out sightings are exactly the early ones - precisely the visits
  // a move would show up between. Not a gate input, so widening it changes a
  // reported number and no decision.
  const translationSpreadM = maxPairwiseDistanceM(
    sightings.map((s) => s.odomPose.position)
  );

  const refusal = refuseUnusable(input, rotationSpreadDeg);
  if (refusal !== null) return refusal;

  const placed = placeOrRefuse(sightings, recencyHalfLifeS);
  if ('refusal' in placed) return placed.refusal;
  const { placeable, combined, rotation } = placed;

  const sortedSizes = placeable
    .map((p) => p.sighting.sizeM)
    .sort((a, b) => a - b);
  // Counted over the sightings actually USED, not every sighting seen: a
  // session whose early visits had no alignment would otherwise report
  // "placed from 8 visits" when three were placed.
  const quality = buildQuality(
    placeable.map((p) => p.sighting),
    sortedSizes,
    rotationSpreadDeg,
    translationSpreadM
  );
  // The gate ran over ALL sightings, so the spread it refused on is the one
  // reported, even when fewer were placeable.
  quality.sightingsSeen = sightings.length;
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
