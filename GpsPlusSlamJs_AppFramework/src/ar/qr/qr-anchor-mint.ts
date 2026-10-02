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
 * 2. **Which alignment?** ONE for every sighting: the most informed one that
 *    still describes their odometry frame - the session's at mint time when
 *    it is in their segment, else the newest sighting's own snapshot. This
 *    superseded DEC-3 (each sighting through the alignment as it stood AT
 *    that sighting) by the owner's decision of 2026-10-02: a sighting taken
 *    before the alignment had any walk behind it carries an arbitrary yaw,
 *    and through it a recording that started at the code minted a heading
 *    72 degrees off p50 and a position 2.9 m off p50, against 1.0-4.9
 *    degrees from 30 m walks up (7-10 at 15 m) and 1.3 m through the
 *    alignment at mint time (`qr-anchor-mint.start-at-code.test.ts`). The
 *    caller passes, for sightings from a segment that has closed, the
 *    alignment that segment ended with.
 *    KNOWN COST, pending the owner: a code seen mid-recording and then
 *    walked away from inherits all SLAM drift after its sighting - 8.6 m
 *    p50 at 500 m with 1 % and 1 degree per 100 m, against 1.7 m through its
 *    own snapshot (the same file, `left`). The first MATURE alignment after
 *    the last sighting (40 m or more of GPS extent) keeps both at 1.1-1.7 m.
 *
 * 3. **How are they combined?** The position is a recency-weighted median,
 *    the rotation a robust unweighted average. The weighting is what is left
 *    of DEC-3, and its original reason (a later sighting carried a later,
 *    better alignment) went with the per-sighting alignment: with one
 *    alignment it only prefers the later viewpoints, which also carry more
 *    drift. On the start-at-code sweep it changes nothing measurable (a 1e9 s
 *    half-life gives the same p50 to 0.1 m and 0.1 degrees), so it stays,
 *    unearned, until the field probe; both the weighted and the unweighted
 *    answer are returned, so the difference is visible.
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
import type { LatLong, Matrix4 as AlignmentMatrix } from '../../core/index.js';

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
  'no-sightings' | 'frame-changed' | 'moved' | 'no-alignment';

export interface QrAnchorQuality {
  /** Sightings the position was actually combined from. */
  sightingCount: number;
  /**
   * Sightings the fixedness gate looked at.
   *
   * @deprecated Equal to `sightingCount` since 2026-10-02 (every sighting is
   * placed through one alignment, so none is set aside). It is in no level
   * schema and nothing in this workspace reads it; it stays populated only
   * because `QrAnchorQuality` is exported, and goes in the next breaking
   * release. Read `sightingCount`.
   */
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

/** The one alignment every sighting of a code is placed through, narrowed
 *  by construction - a filter would not tell the compiler the fields are
 *  non-null, and casting one away is how a null reaches the composition. */
interface MintFrame {
  alignmentMatrix: AlignmentMatrix;
  zero: LatLong;
  /** What the level stamps about it (sample count, accuracy). */
  info: MintAlignmentInfo;
}

/**
 * The session's alignment as it stands when the mint runs, and the odometry
 * segment it belongs to (`QrSightingAccumulator.currentSegment()`).
 */
export interface QrMintAlignmentNow {
  readonly alignmentMatrix: AlignmentMatrix | null;
  readonly zero: LatLong | null;
  readonly alignmentSampleCount: number;
  readonly gpsAccuracyM?: number;
  /** The accumulator's segment at mint time: the alignment describes THIS
   *  odometry frame, and sightings from another one must not be placed
   *  through it. */
  readonly segment: number;
}

export interface MintQrAnchorInput {
  /**
   * **MUST be in ascending `lastTimestamp` order.** The recency weighting
   * takes "the latest sighting" as the last one, and without a usable
   * `currentAlignment` so do the alignment, the GPS `zero` and the stamped
   * `alignmentSampleCount` - so an unordered array does not merely weight
   * oddly, it mints through the wrong alignment.
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
  /**
   * The session's alignment at mint time. Every sighting is placed through
   * it (position and rotation) when its matrix and zero exist and it belongs
   * to the sightings' odometry segment; otherwise through the newest
   * sighting's own snapshot. Optional so a caller with no live session (a
   * replay, a test) still mints, with the newest snapshot it has.
   */
  currentAlignment?: QrMintAlignmentNow;
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
  sightings: readonly QrSighting[],
  halfLifeS: number
): number[] {
  const lastAt = sightings.at(-1)?.lastTimestamp ?? 0;
  return sightings.map((s) => {
    const ageS = Math.max(0, (lastAt - s.lastTimestamp) / 1000);
    return 1 / (1 + ageS / halfLifeS);
  });
}

/**
 * The ONE alignment every sighting is placed through: the most informed one
 * that still describes the sightings' odometry frame, or `null` when there
 * is none at all.
 *
 * Not each sighting's own (DEC-3, superseded by the owner on 2026-10-02): an
 * alignment's yaw is unobservable until the walk has a baseline, so a
 * sighting taken as the recording starts carries an arbitrary yaw. Measured
 * on the start-at-code sweep (40 recordings per cell, walks 15-120 m, 1-3
 * looks, yaw noise 1-5 degrees): per-sighting composition gave 72 degrees
 * heading p50 and, for a code seen only at the start, 2.9 m; through the
 * alignment at mint time 1.0-4.9 degrees from 30 m walks up (7-10 at 15 m)
 * and 1.3 m. The cost: with three looks the old rotation average was up to
 * 0.6 degrees better at p50 (2.7 at 15 m), while its p90 reached 146.
 *
 * The session's alignment is used only when it is in the sightings' segment:
 * after a tracking restart or loop closure it describes another frame, and
 * the newest snapshot taken in their own frame is then the best available.
 */
function mintFrame(
  sightings: readonly QrSighting[],
  current: QrMintAlignmentNow | undefined
): MintFrame | null {
  if (
    current?.alignmentMatrix != null &&
    current.zero !== null &&
    sightings.every((s) => s.segment === current.segment)
  ) {
    return {
      alignmentMatrix: current.alignmentMatrix,
      zero: current.zero,
      info: alignmentInfo(current.alignmentSampleCount, current.gpsAccuracyM),
    };
  }
  for (let i = sightings.length - 1; i >= 0; i -= 1) {
    const s = sightings[i];
    if (s?.alignmentMatrix == null || s.zero === null) continue;
    return {
      alignmentMatrix: s.alignmentMatrix,
      zero: s.zero,
      info: alignmentInfo(s.alignmentSampleCount, s.gpsAccuracyM),
    };
  }
  return null;
}

/** The alignment facts the level assembly needs. */
function alignmentInfo(
  sampleCount: number,
  gpsAccuracyM: number | undefined
): MintAlignmentInfo {
  return {
    hasMatrix: true,
    sampleCount,
    ...(gpsAccuracyM !== undefined ? { gpsAccuracyM } : {}),
  };
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

/**
 * Place every sighting through the one alignment and combine them - or the
 * reason that was not possible. Both refusals live here so the entry point stays one
 * straight line, which is also what keeps it under the complexity budget.
 */
function placeOrRefuse(
  sightings: readonly QrSighting[],
  halfLifeS: number,
  current: QrMintAlignmentNow | undefined
):
  | { refusal: QrAnchorMintResult }
  | {
      frame: MintFrame;
      combined: ReturnType<typeof combinePlacements>;
      rotation: Quaternion;
    } {
  const frame = mintFrame(sightings, current);
  if (frame === null) {
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
  const worlds = sightings.map((s) =>
    qrWorldPoseFromOdom(s.odomPose, frame.alignmentMatrix)
  );
  const combined = combinePlacements(
    worlds,
    recencyWeights(sightings, halfLifeS)
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
  return { frame, combined, rotation: combined.rotation };
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

  const placed = placeOrRefuse(
    sightings,
    recencyHalfLifeS,
    input.currentAlignment
  );
  if ('refusal' in placed) return placed.refusal;
  const { frame, combined, rotation } = placed;

  const sortedSizes = sightings.map((s) => s.sizeM).sort((a, b) => a - b);
  // Every sighting is placed through the one alignment, so the sightings
  // used and the sightings seen are the same set (they were not while each
  // needed its own snapshot).
  const quality = buildQuality(
    sightings,
    sortedSizes,
    rotationSpreadDeg,
    translationSpreadM
  );
  const shared = {
    zero: frame.zero,
    alignment: frame.info,
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
