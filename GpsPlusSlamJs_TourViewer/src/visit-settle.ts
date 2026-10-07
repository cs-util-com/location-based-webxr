/**
 * The authoring settle (authoring plan 2026-09-28-0953 §3.2, M2c; owner
 * decisions D2, D10b and D33): at the end of an AR visit - and at Finish for
 * the visit still running - the geo of the code measured in that visit and
 * of every object placed in it is recomputed from its odometry pose.
 *
 * WHY. Each tap minted its geo through the alignment of that moment: the
 * code at "Save the measured position", each note at its own Save. Those
 * alignments differ, so the stored notes disagreed with the stored code by
 * however much GPS moved in between, and no later relocalization could undo
 * it (plan §2.2, B2). A note and the code it sits by must share ONE
 * alignment, so they keep the relation the phone's tracking saw.
 *
 * EACH OBJECT AT ITS OWN MOMENT (owner decision D33, 2026-10-03): one
 * alignment for the whole visit (its end) folded all the SLAM drift walked
 * after an object into it, so with the visit's picks
 * (`visit-alignment-picks.ts`) each object, the measured code and each
 * sighting is composed through the FIRST MATURE alignment at or after its
 * own moment (40 m of session GPS extent, D34), else the visit's alignment
 * at its end.
 *
 * NEAR A CODE EVENT, THE CODE'S ALIGNMENT (reviews R1 and R3 of D33): a
 * note within {@link CODE_EVENT_REACH_M} WALKED of a code event of its
 * visit shares the code's alignment through the nearest event - drift grows
 * with the distance walked, not with time:
 * - the visit MEASURED the code: the measurement's own pick (the code's), or
 *   a later sighting's pick corrected onto the code as re-minted;
 * - a STORED code: the nearest sighting's correction (D10b), judged through
 *   that sighting's own pick.
 * Farther from every event a note keeps its own pick; picks kept without a
 * walked distance keep the rules before R1 and R3 (own pick; the sighting
 * nearest in time). Without picks everything goes through the end
 * alignment and the latest sighting, as below. Measured in
 * `visit-settle.left-behind.test.ts`.
 *
 * WHICH ALIGNMENT WITHOUT PICKS ({@link settleAlignment}; also the choice
 * for an object at the visit's end):
 * - the visit MEASURED the code: the visit's alignment at its end (the
 *   solver's current, recency-weighted estimate); the code is re-minted
 *   through it too;
 * - the code's stored pose came from EARLIER (another visit, or a restored
 *   draft) and this visit SAW that code: the visit's alignment corrected
 *   through the code (`correctedAlignment`), so this visit's notes land
 *   relative to the stored code as placed (D10b); the code is not re-minted,
 *   it is the reference;
 * - otherwise: the plain visit alignment, which keeps the GPS difference
 *   between visits (the entry hint asks the author to look at the code
 *   first; nothing blocks placing).
 *
 * Pure: the caller (`creator-setup.ts`) reads the store BEFORE the session
 * teardown resets it, applies the result, rewrites the draft and logs a
 * `tourAuthoring/settled` action.
 *
 * @see visit-settle.ts.md
 */

import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { qrMintHeadingMarker } from "gps-plus-slam-app-framework/ar/qr/qr-anchor-mint";
import {
  mintQrLevelFromWorld,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { LatLong } from "gps-plus-slam-app-framework/core";

import { objectPoseNue } from "./content-placement.js";
import {
  correctedAlignment,
  correctionSize,
  odomNueFromWebXr,
  throughAlignment,
  type NuePose,
} from "./visit-anchoring.js";

/** The code measurement a mint made in this page, with its raw input. */
export interface CodeMeasurement {
  readonly levelId: string;
  readonly text: string;
  /** The stable fused pose the level was minted from (raw WebXR). */
  readonly odomPose: Pose;
  readonly sizeM: number;
  /** `arSessionGeneration` at the mint tap. */
  readonly visit: number;
}

/** The anchor code as the RUNNING visit last saw it, stable. */
export interface CodeSighting {
  readonly text: string;
  readonly levelId: string;
  /** The latest stable fused pose (raw WebXR, this visit's odometry). */
  readonly odomPose: Pose;
}

/**
 * When something happened in the visit, and the alignment it is composed
 * through: the first mature alignment at or after it, else the latest usable
 * one (D33; `visit-alignment-picks.ts` folds them).
 */
export interface TimedAlignment {
  readonly atMs: number;
  /** Column-major, 16 numbers; null when no usable alignment was seen
   *  since (the visit's end alignment is used instead). */
  readonly alignment: readonly number[] | null;
  /** The mint gate's view of that alignment, when the caller knew it: the
   *  quality block of a code re-minted through it. */
  readonly alignmentInfo?: MintAlignmentInfo | undefined;
  /** How far the author had walked in the visit at this moment (m,
   *  `walked-distance-tracker.ts`); absent when the caller did not know. */
  readonly walkedM?: number | undefined;
  /** The session GPS extent that alignment rests on (m), when the caller
   *  knew it: the D31 heading marker of a code re-minted through it. */
  readonly gpsExtentM?: number | undefined;
}

/** A stable sighting of the code in hand, at its moment. */
interface TimedSighting extends TimedAlignment {
  readonly sighting: CodeSighting;
}

/** Everything the running visit's picks hold (D33). */
export interface VisitAlignmentPicks {
  /** By object id: when it was placed (or last moved). */
  readonly objects: ReadonlyMap<string, TimedAlignment>;
  /** The code measured in this visit. */
  readonly measurement: TimedAlignment | null;
  /** Each code's measurement in this visit, by level id (M4c-2);
   *  absent from a caller that kept one. */
  readonly measurements?: ReadonlyMap<string, TimedAlignment> | undefined;
  /** The code in hand's sightings, oldest first. */
  readonly sightings: readonly TimedSighting[];
}

export type SettleBasis =
  "measured-here" | "code-corrected" | "visit-alignment";

export interface SettleAlignmentInput {
  /** The visit being settled (`arSessionGeneration`). */
  readonly visit: number;
  /** The store's alignment at the visit's end; null when there is none. */
  readonly alignment: ArrayLike<number> | null;
  readonly zero: LatLong | null;
  /** The level in hand: the code's stored pose. */
  readonly mintedLevel: { readonly id: string; readonly json: string } | null;
  readonly measurement: CodeMeasurement | null;
  readonly sighting: CodeSighting | null;
  /** This visit's median GPS accuracy (m), for the correction's bound;
   *  absent or unusable counts as {@link CORRECTION_DEFAULT_ACCURACY_M}. */
  readonly gpsAccuracyM?: number | null | undefined;
  /**
   * The visit's per-moment alignments (D33). Absent or null: every object
   * through `alignment`, a correction through `sighting` judged through
   * `alignment` (the live views, and a caller that kept no picks).
   */
  readonly picks?: VisitAlignmentPicks | null | undefined;
}

/**
 * THE CODE CORRECTION'S PLAUSIBILITY BOUND (M2c review #2). A level's id is
 * a hash of the printed text, so a second print of the poster, or one
 * re-hung elsewhere, is "the same code" - and its correction would move
 * every note of the visit. A correction is refused when it moves the code
 * further than two visits' GPS can plausibly disagree, or turns the visit
 * further than two visits' GPS headings plausibly do. The derivation, the
 * sweep and the values that would reverse the choice are in the sidecar.
 */
const CORRECTION_FLOOR_M = 5;
/** The multiple of the two visits' combined GPS accuracy admitted. */
const CORRECTION_ACCURACY_FACTOR = 3;
/** The accuracy assumed for a visit, or a stored level, that reports none. */
const CORRECTION_DEFAULT_ACCURACY_M = 5;
/** The largest yaw a correction may turn a visit by, degrees. */
export const CORRECTION_MAX_YAW_DEG = 120;

/** Why a code correction was refused: its size and the bounds it broke. */
export interface CorrectionRefusal {
  readonly horizontalM: number;
  readonly yawDeg: number;
  readonly maxHorizontalM: number;
  readonly maxYawDeg: number;
}

/**
 * The largest horizontal correction admitted, m: {@link CORRECTION_FLOOR_M}
 * plus {@link CORRECTION_ACCURACY_FACTOR} times the combined accuracy of
 * the two visits (`hypot`: the correction is the DIFFERENCE of two
 * independent alignment errors).
 *
 * `options` exist for the moved-code rule (D20, `code-displacement.ts`),
 * which shares this bound and whose M5a sweep varies the factor and the
 * default accuracy; absent or unusable, they are the shipped constants.
 */
export function correctionBoundM(
  visitAccuracyM: number | null | undefined,
  storedAccuracyM: number | null | undefined,
  options: {
    /** Replaces {@link CORRECTION_ACCURACY_FACTOR}; finite and >= 0. */
    readonly accuracyFactor?: number;
    /** Replaces {@link CORRECTION_DEFAULT_ACCURACY_M}; finite and > 0. */
    readonly defaultAccuracyM?: number;
  } = {},
): number {
  const positive = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;
  const defaultAccuracyM = positive(options.defaultAccuracyM)
    ? options.defaultAccuracyM
    : CORRECTION_DEFAULT_ACCURACY_M;
  const factor =
    typeof options.accuracyFactor === "number" &&
    Number.isFinite(options.accuracyFactor) &&
    options.accuracyFactor >= 0
      ? options.accuracyFactor
      : CORRECTION_ACCURACY_FACTOR;
  const usable = (v: number | null | undefined): number =>
    positive(v) ? v : defaultAccuracyM;
  return (
    CORRECTION_FLOOR_M +
    factor * Math.hypot(usable(visitAccuracyM), usable(storedAccuracyM))
  );
}

/** 16 finite numbers, or null. */
export function readAlignment(
  alignment: ArrayLike<number> | null,
): number[] | null {
  if (alignment === null || alignment.length !== 16) return null;
  const values = Array.from(alignment);
  return values.every((v) => typeof v === "number" && Number.isFinite(v))
    ? values
    : null;
}

/** A level's stored geo, or null when the JSON is not a level or carries
 *  no geo (external data: a zip, a draft). */
export function storedGeo(json: string): QrGeoPose | null {
  try {
    return parseQrLevel(JSON.parse(json) as unknown).qr.geo ?? null;
  } catch {
    return null;
  }
}

/** A level's printed size (m), or null when the JSON is not a level or its
 *  size is not a positive number (external data: a zip, a draft). */
export function storedSizeM(json: string): number | null {
  try {
    const size = parseQrLevel(JSON.parse(json) as unknown).qr.physicalSizeM;
    return size !== undefined && Number.isFinite(size) && size > 0
      ? size
      : null;
  } catch {
    return null;
  }
}

/** The stored code's pose in GPS-world NUE and the GPS accuracy its mint
 *  recorded, or null when the level carries no pose that reads. */
function storedCode(
  json: string,
  zero: LatLong,
): { pose: NuePose; accuracyM: number | undefined } | null {
  try {
    const qr = parseQrLevel(JSON.parse(json) as unknown).qr;
    if (qr.geo === undefined) return null;
    const pose = objectPoseNue(qr.geo, zero);
    return {
      pose: { position: pose.positionNue, rotation: pose.rotationNue },
      accuracyM: qr.mintQuality?.gpsAccuracyM,
    };
  } catch {
    return null;
  }
}

/**
 * What a new measurement of a code IS (D10b; M2c review #5): the code's new
 * reference, or a sighting that corrects this visit onto a pose already
 * stored.
 *
 * - `level-in-hand` - the level in hand is this code's and was NOT measured
 *   in this visit (an earlier visit of this page, a restored draft, or the
 *   hosted level a previous measurement kept): it stays the reference.
 * - `hosted-level` - nothing of this code in hand, but the open tour's zip
 *   stores it with a readable pose: that stays the reference.
 * - `measurement` - nothing stored reads, or the level in hand was measured
 *   in THIS visit (same odometry, and the visit's settle re-mints it
 *   anyway): the new measurement is the reference, as before.
 *
 * Replacing a stored pose on purpose is an explicit action (plan §3.4, M4),
 * never a side effect of measuring.
 */
export function measurementRole(input: {
  readonly levelId: string;
  /** The visit the measurement was taken in. */
  readonly visit: number;
  readonly inHand: { readonly id: string; readonly json: string } | null;
  /** The raw inputs behind `inHand`, when this page measured it. */
  readonly inHandMeasurement: CodeMeasurement | null;
  /** The hosted zip's level file for `levelId`, or null. */
  readonly hostedJson: string | null;
}):
  | { kept: "measurement" }
  | {
      kept: "level-in-hand" | "hosted-level";
      reference: { id: string; json: string };
    } {
  const { levelId, inHand, inHandMeasurement } = input;
  if (inHand !== null && inHand.id === levelId) {
    const measuredThisVisit =
      inHandMeasurement !== null &&
      inHandMeasurement.levelId === levelId &&
      inHandMeasurement.visit === input.visit;
    if (measuredThisVisit) return { kept: "measurement" };
    if (storedGeo(inHand.json) !== null) {
      return {
        kept: "level-in-hand",
        reference: { id: inHand.id, json: inHand.json },
      };
    }
  }
  if (input.hostedJson !== null && storedGeo(input.hostedJson) !== null) {
    return {
      kept: "hosted-level",
      reference: { id: levelId, json: input.hostedJson },
    };
  }
  return { kept: "measurement" };
}

function measuredHere(input: SettleAlignmentInput): boolean {
  const { measurement, mintedLevel } = input;
  return (
    measurement !== null &&
    mintedLevel !== null &&
    measurement.visit === input.visit &&
    measurement.levelId === mintedLevel.id
  );
}

/**
 * Which alignment the visit's objects settle through, and why.
 *
 * @returns null when the alignment is not 16 finite numbers or there is no
 *   zero: nothing can be settled, and the tap-time geo stands.
 */
export function settleAlignment(
  input: SettleAlignmentInput,
): SettleChoice | null {
  const alignment = readAlignment(input.alignment);
  if (alignment === null || input.zero === null) return null;
  return choiceFor(input, alignment, input.zero, null, alignment);
}

/** What an object settles through, and why. */
export interface SettleChoice {
  readonly basis: SettleBasis;
  readonly alignment: number[];
  /** A code correction this object had, refused by the plausibility bound;
   *  null otherwise. */
  readonly refused: CorrectionRefusal | null;
}

/**
 * THE CODE EVENT REACH (reviews R1 and R3 of D33): a note within this many
 * metres WALKED of a code event of its visit - the code's measurement or a
 * stable sighting of it - is placed relative to the code through the
 * nearest such event; one farther from every event keeps its own
 * alignment. Within it, the note and the code share one alignment (the
 * relation the phone's tracking saw, up to the drift walked since the
 * event); past it, that drift and the code's heading error times the
 * note's distance from the code outweigh what sharing removes. The sweep
 * and the values that would reverse the choice are in the sidecar.
 */
export const CODE_EVENT_REACH_M = 40;

const finite = (v: number | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** The moment of an object: when it was placed and how far the author had
 *  walked by then; null for "at the visit's end". */
type Moment = Pick<TimedAlignment, "atMs" | "walkedM"> | null;

/** Of `kept`, the one nearest `at` by `metric`; a tie goes to the later. */
function nearestBy<T extends object>(
  kept: readonly T[],
  metric: (s: T) => number,
  at: number,
): { best: T; gap: number } {
  let best = kept[kept.length - 1]!;
  let gap = Number.POSITIVE_INFINITY;
  for (const s of kept) {
    const g = Math.abs(metric(s) - at);
    if (g <= gap) {
      best = s;
      gap = g;
    }
  }
  return { best, gap };
}

/** The walked distance of `at` when it and every one of `events` know
 *  theirs; null otherwise (the rules before R1 and R3 then apply). */
function walkedOf(
  at: Moment,
  events: readonly { readonly walkedM?: number | undefined }[],
): number | null {
  return at !== null &&
    finite(at.walkedM) &&
    events.every((e) => finite(e.walkedM))
    ? at.walkedM
    : null;
}

/**
 * The sighting of the code in hand a correction at `at` uses, with the
 * alignment its correction is judged through - its own pick (D33):
 * - the one NEAREST in WALKED distance (R3: drift grows with the distance
 *   walked, not with time), and none past {@link CODE_EVENT_REACH_M};
 * - when the object's or any sighting's walked distance is unknown (a
 *   caller that kept none), the one nearest in time, uncapped, as before;
 * - `at` null (the visit's end): the latest.
 * Without a kept sighting of that code, the input's `sighting` through
 * `end` (the settle as before D33).
 */
function nearestSighting(
  input: SettleAlignmentInput,
  end: number[],
  at: Moment,
): { sighting: CodeSighting; alignment: number[] } | null {
  const levelId = input.mintedLevel?.id;
  const kept = (input.picks?.sightings ?? []).filter(
    (s) => s.sighting.levelId === levelId && Number.isFinite(s.atMs),
  );
  if (kept.length === 0) {
    return input.sighting === null
      ? null
      : { sighting: input.sighting, alignment: end };
  }
  let best = kept[kept.length - 1]!;
  const walkedAt = walkedOf(at, kept);
  if (walkedAt !== null) {
    const near = nearestBy(kept, (s) => s.walkedM!, walkedAt);
    if (near.gap > CODE_EVENT_REACH_M) return null;
    best = near.best;
  } else if (at !== null && finite(at.atMs)) {
    best = nearestBy(kept, (s) => s.atMs, at.atMs).best;
  }
  return {
    sighting: best.sighting,
    alignment: readAlignment(best.alignment) ?? end,
  };
}

/**
 * The choice for an object of the visit at moment `at` (null: at the end)
 * whose own alignment is `own`: measured here, through `own`; else
 * corrected through the nearest sighting of the stored code when the bound
 * admits it, judged through that sighting's alignment; else `own`.
 */
function choiceFor(
  input: SettleAlignmentInput,
  end: number[],
  zero: LatLong,
  at: Moment,
  own: number[],
): SettleChoice {
  if (measuredHere(input)) {
    return { basis: "measured-here", alignment: own, refused: null };
  }
  const near = nearestSighting(input, end, at);
  const correction =
    near === null
      ? null
      : codeCorrectionOf(
          { ...input, sighting: near.sighting },
          near.alignment,
          zero,
        );
  if (correction === null) {
    return { basis: "visit-alignment", alignment: own, refused: null };
  }
  if ("refused" in correction) {
    return {
      basis: "visit-alignment",
      alignment: own,
      refused: correction.refused,
    };
  }
  return {
    basis: "code-corrected",
    alignment: correction.alignment,
    refused: null,
  };
}

type CodeEvent =
  | { readonly kind: "measurement"; readonly walkedM: number }
  | {
      readonly kind: "sighting";
      readonly walkedM: number;
      readonly sighting: CodeSighting;
      readonly alignment: number[];
    };

/** Of the measurement and the kept sightings of the measured code, the one
 *  nearest `at` in walked distance (a tie goes to the measurement), or null
 *  past {@link CODE_EVENT_REACH_M} or when a walked distance is unknown. */
function nearestCodeEvent(
  input: VisitSettleInput,
  end: number[],
  at: Moment,
  code: { readonly level: { readonly id: string } },
): CodeEvent | null {
  const measuredAt = input.picks?.measurement?.walkedM;
  const sightings = (input.picks?.sightings ?? []).filter(
    (s) => s.sighting.levelId === code.level.id,
  );
  const walkedAt = walkedOf(at, sightings);
  if (walkedAt === null || !finite(measuredAt)) return null;
  const events: CodeEvent[] = [
    ...sightings.map((s) => ({
      kind: "sighting" as const,
      walkedM: s.walkedM!,
      sighting: s.sighting,
      alignment: readAlignment(s.alignment) ?? end,
    })),
    // Last, so a tie goes to the measurement.
    { kind: "measurement" as const, walkedM: measuredAt },
  ];
  const near = nearestBy(events, (e) => e.walkedM, walkedAt);
  return near.gap > CODE_EVENT_REACH_M ? null : near.best;
}

/**
 * The choice for an object of a visit that MEASURED the code (R1 of D33),
 * whose own alignment is `own`: the code event of this visit nearest it in
 * walked distance - the measurement, or a later stable sighting of the
 * code - within {@link CODE_EVENT_REACH_M}, places it relative to the code
 * as re-minted (`level`, through `levelAlignment`):
 * - the measurement: through `levelAlignment` itself, the code's own;
 * - a sighting: through that sighting's pick corrected onto the re-minted
 *   code (the D10b correction within the visit, its bound included).
 * Otherwise, or when a walked distance is unknown (a caller that kept
 * none), through `own`, as before. A tie goes to the measurement.
 */
function measuredChoice(
  input: VisitSettleInput,
  end: number[],
  zero: LatLong,
  at: Moment,
  own: number[],
  code: { level: { id: string; json: string }; alignment: number[] } | null,
): SettleChoice {
  const plain: SettleChoice = {
    basis: "measured-here",
    alignment: own,
    refused: null,
  };
  const event = code === null ? null : nearestCodeEvent(input, end, at, code);
  if (code === null || event === null) return plain;
  if (event.kind === "measurement") {
    return { ...plain, alignment: code.alignment };
  }
  const correction = codeCorrectionOf(
    { ...input, mintedLevel: code.level, sighting: event.sighting },
    event.alignment,
    zero,
  );
  if (correction === null) return plain;
  if ("refused" in correction) return { ...plain, refused: correction.refused };
  return { ...plain, alignment: correction.alignment };
}

/** The stored code in hand and this visit's sighting of it, through
 *  `alignment`, with the size of the correction between the two; null
 *  without a sighting of the level in hand or a readable stored pose. */
function sightedStoredCode(
  input: SettleAlignmentInput,
  alignment: readonly number[],
  zero: LatLong,
): {
  stored: NonNullable<ReturnType<typeof storedCode>>;
  codeLocal: NuePose;
  size: { horizontalM: number; yawDeg: number };
  /** Where this visit sees the code minus its stored position (m). */
  offset: { northM: number; eastM: number };
} | null {
  const { mintedLevel, sighting } = input;
  if (
    mintedLevel === null ||
    sighting === null ||
    sighting.levelId !== mintedLevel.id
  ) {
    return null;
  }
  const stored = storedCode(mintedLevel.json, zero);
  if (stored === null) return null;
  const codeLocal = odomNueFromWebXr(sighting.odomPose);
  const measured = throughAlignment(codeLocal, alignment);
  const size = measured === null ? null : correctionSize(measured, stored.pose);
  if (measured === null || size === null) return null;
  return {
    stored,
    codeLocal,
    size,
    offset: {
      northM: measured.position[0] - stored.pose.position[0],
      eastM: measured.position[2] - stored.pose.position[2],
    },
  };
}

/**
 * How far, and by how much of a turn, the code as this visit sees it lies
 * from its stored pose - with no plausibility bound applied. It is what an
 * explicit replace of the stored pose moves the code by for every visitor,
 * so what its confirm question states (M4 review #3) - and, as `northM`
 * and `eastM` (where this visit sees the code minus its stored position),
 * the spot the move prompt remembers an answer for (D20, M5b).
 *
 * @returns null without a readable alignment, a zero, a sighting of the
 *   level in hand in this visit, or a stored pose.
 */
export function sightedCodeOffset(input: SettleAlignmentInput): {
  horizontalM: number;
  yawDeg: number;
  northM: number;
  eastM: number;
} | null {
  const alignment = readAlignment(input.alignment);
  if (alignment === null || input.zero === null) return null;
  const sighted = sightedStoredCode(input, alignment, input.zero);
  return sighted === null ? null : { ...sighted.size, ...sighted.offset };
}

/** The visit's alignment corrected through its sighting of the stored
 *  code, the refusal when the correction breaks the bound, or null when
 *  there is no correction to make. */
function codeCorrectionOf(
  input: SettleAlignmentInput,
  alignment: readonly number[],
  zero: LatLong,
): { alignment: number[] } | { refused: CorrectionRefusal } | null {
  const sighted = sightedStoredCode(input, alignment, zero);
  if (sighted === null) return null;
  const { stored, codeLocal, size } = sighted;
  const maxHorizontalM = correctionBoundM(input.gpsAccuracyM, stored.accuracyM);
  if (
    size.horizontalM > maxHorizontalM ||
    size.yawDeg > CORRECTION_MAX_YAW_DEG
  ) {
    return {
      refused: { ...size, maxHorizontalM, maxYawDeg: CORRECTION_MAX_YAW_DEG },
    };
  }
  const corrected = correctedAlignment(alignment, codeLocal, stored.pose);
  return corrected === null ? null : { alignment: corrected };
}

/**
 * An object's record with its geo recomputed from its odometry-NUE pose
 * through `alignment`. A pin keeps no facing (the identity, as `mintPin`
 * writes it); a photo's plane turns with the alignment.
 *
 * @returns null when the pose cannot be minted (the caller keeps the old).
 */
function settledObject(
  object: TourObject,
  local: NuePose,
  alignment: readonly number[],
  zero: LatLong,
): TourObject | null {
  const world = throughAlignment(local, alignment);
  if (world === null) return null;
  try {
    const geo = mintQrGeoPose({
      worldNuePosition: {
        x: world.position[0],
        y: world.position[1],
        z: world.position[2],
      },
      worldNueRotation:
        object.kind === "pin" ? [0, 0, 0, 1] : [...world.rotation],
      zero,
    });
    return { ...object, geo };
  } catch {
    return null;
  }
}

/**
 * One code of a visit with several (code book refactor plan M4b): its
 * level - the stored one, or for a code measured here the level in hand
 * (only its id is read; the settle re-mints it) - and this page's
 * measurement of it with that measurement's pick (D33). The code's
 * sightings are the picks' sightings of its level id.
 */
interface VisitCode {
  readonly level: { readonly id: string; readonly json: string };
  /** This page's measurement of the code; null for a stored code. */
  readonly measurement: CodeMeasurement | null;
  /** The measurement's pick; absent or null when none was kept. */
  readonly measurementPick?: TimedAlignment | null | undefined;
}

export interface VisitSettleInput extends SettleAlignmentInput {
  /**
   * The visit's codes (M4b). Each object settles through the code event
   * nearest it in walked distance of ANY of them (D2), then through that
   * code's own rules (the measurement's pick, or the D10b correction
   * onto the stored pose). Absent: the one code of the legacy fields
   * (`mintedLevel`, `measurement`, `picks.measurement`), exactly as before;
   * the first code of a list plays their part where one code is asked for
   * (the legacy `level`, an unknown walked distance).
   */
  readonly codes?: readonly VisitCode[] | undefined;
  readonly placed: readonly {
    readonly object: TourObject;
    readonly placement?: { readonly visit: number; readonly local: NuePose };
  }[];
  /** The mint gate's view of the alignment at the visit's end, for the
   *  re-minted level's quality block when the level goes through the end
   *  alignment (no measurement pick, or one kept without its info). */
  readonly alignmentInfo: MintAlignmentInfo;
  /** The session GPS extent the end alignment rests on (m), for the D31
   *  heading marker of a level re-minted through it; absent: unknown, and
   *  the level then claims nothing either way. */
  readonly alignmentGpsExtentM?: number | undefined;
  readonly nowIso: string;
}

export interface VisitSettle {
  /** The choice for an object placed at the visit's end (the latest
   *  sighting): what a photo that lands after the settle goes through. */
  readonly basis: SettleBasis;
  /** That choice's alignment. */
  readonly alignment: number[];
  /** The settled records, by their index in `placed`, each with its own
   *  choice (D33). */
  readonly objects: ({ index: number; object: TourObject } & SettleChoice)[];
  /** The code re-minted from this visit's measurement, when this visit
   *  measured it; null otherwise (or when the re-mint was refused). */
  readonly level: { id: string; json: string } | null;
  /** The alignment `level` was re-minted through; null without one. */
  readonly levelAlignment: number[] | null;
  /** Every code measured in this visit, re-minted, each through its own
   *  alignment, in the order of the codes (M4b); `level` is the first. */
  readonly levels: { id: string; json: string; alignment: number[] }[];
  /** That end choice's refused correction; null otherwise. */
  readonly refused: CorrectionRefusal | null;
}

/**
 * Settle one visit.
 *
 * @returns null when the visit placed and measured nothing, or when no
 *   alignment or zero can be read (then every record keeps its tap-time
 *   geo, which is also what a killed tab keeps).
 */
export function planVisitSettle(input: VisitSettleInput): VisitSettle | null {
  const targets = input.placed.flatMap((entry, index) =>
    entry.placement !== undefined && entry.placement.visit === input.visit
      ? [{ index, object: entry.object, local: entry.placement.local }]
      : [],
  );
  const views = codeViews(input);
  if (targets.length === 0 && !views.some(measuredHere)) return null;
  const end = readAlignment(input.alignment);
  const zero = input.zero;
  if (end === null || zero === null) return null;
  // Each code's view of the visit, and the code as re-minted when this
  // visit measured it.
  const codes = views.map((view) => ({
    view,
    measured: measuredHere(view),
    reminted: measuredHere(view) ? remintedCode(view, end, zero) : null,
  }));
  // A photo that lands after the settle is at the visit's end: the code
  // seen last (with one code, the code in hand, as before).
  const choice = choiceFor(
    views[latestCode(views)] ?? input,
    end,
    zero,
    null,
    end,
  );
  const objects = targets.flatMap(({ index, object, local }) => {
    const timed = input.picks?.objects.get(object.id) ?? null;
    const own = readAlignment(timed?.alignment ?? null) ?? end;
    const code = codes[nearestCode(views, timed)];
    const mine =
      code === undefined
        ? choiceFor(input, end, zero, timed, own)
        : code.measured
          ? measuredChoice(code.view, end, zero, timed, own, code.reminted)
          : choiceFor(code.view, end, zero, timed, own);
    const settled = settledObject(object, local, mine.alignment, zero);
    return settled === null ? [] : [{ index, object: settled, ...mine }];
  });
  const levels = codes.flatMap((c) =>
    c.reminted === null
      ? []
      : [{ ...c.reminted.level, alignment: c.reminted.alignment }],
  );
  const first = codes[0]?.reminted ?? null;
  return {
    basis: choice.basis,
    alignment: choice.alignment,
    objects,
    level: first?.level ?? null,
    levelAlignment: first?.alignment ?? null,
    levels,
    refused: choice.refused,
  };
}

/**
 * The code measured in `view`'s visit re-minted, with the alignment it went
 * through. Geo, quality block and heading marker travel together (R7 of
 * D33): all three from the measurement's pick when it carries its block,
 * else all three from the end alignment - never the pick's geo with the
 * end's block.
 */
function remintedCode(
  view: VisitSettleInput,
  end: number[],
  zero: LatLong,
): { level: { id: string; json: string }; alignment: number[] } | null {
  const pick = view.picks?.measurement;
  const picked = readAlignment(pick?.alignment ?? null);
  const source =
    picked !== null && pick?.alignmentInfo !== undefined
      ? {
          alignment: picked,
          info: pick.alignmentInfo,
          gpsExtentM: pick.gpsExtentM,
        }
      : {
          alignment: end,
          info: view.alignmentInfo,
          gpsExtentM: view.alignmentGpsExtentM,
        };
  const level = remintedLevel(view, source.alignment, zero, source);
  return level === null ? null : { level, alignment: source.alignment };
}

/**
 * The visit as each of its codes sees it (M4b): the input with that code
 * as the code in hand - its level, its measurement and pick, its latest
 * sighting, and the picks' sightings of it only. Without `codes`, the input
 * itself (one code, or none): the legacy path, unchanged.
 */
function codeViews(input: VisitSettleInput): VisitSettleInput[] {
  if (input.codes === undefined) return [input];
  return input.codes.map((code) => {
    const kept = (input.picks?.sightings ?? []).filter(
      (s) => s.sighting.levelId === code.level.id,
    );
    const sighting =
      input.sighting?.levelId === code.level.id
        ? input.sighting
        : (kept.at(-1)?.sighting ?? null);
    return {
      ...input,
      mintedLevel: code.level,
      measurement: code.measurement,
      sighting,
      ...(input.picks === undefined || input.picks === null
        ? {}
        : {
            picks: {
              ...input.picks,
              measurement: code.measurementPick ?? null,
              sightings: kept,
            },
          }),
    };
  });
}

/** A code's events in its view: its measurement's pick (when measured in
 *  this visit) and its kept sightings. */
function eventsOf(
  view: VisitSettleInput,
): readonly Pick<TimedAlignment, "atMs" | "walkedM">[] {
  const pick = measuredHere(view) ? view.picks?.measurement : null;
  return [
    ...(pick === null || pick === undefined ? [] : [pick]),
    ...(view.picks?.sightings ?? []),
  ];
}

/**
 * Of several codes, the one whose event is nearest `at` in walked distance
 * (D2; a tie goes to the later event); the first code when there is one
 * code, no moment, or a walked distance is unknown (the code in hand, as
 * before M4b).
 */
function nearestCode(views: readonly VisitSettleInput[], at: Moment): number {
  if (views.length <= 1 || at === null || !finite(at.walkedM)) return 0;
  const walkedAt = at.walkedM;
  let best = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const [i, view] of views.entries()) {
    for (const e of eventsOf(view)) {
      if (!finite(e.walkedM)) return 0;
      const gap = Math.abs(e.walkedM - walkedAt);
      if (gap < bestGap || (gap === bestGap && e.atMs > bestAt)) {
        best = i;
        bestGap = gap;
        bestAt = e.atMs;
      }
    }
  }
  return best;
}

/** The code whose latest event is the latest of the visit; the first code
 *  when there is one, or none has an event. */
function latestCode(views: readonly VisitSettleInput[]): number {
  let best = 0;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const [i, view] of views.entries()) {
    for (const e of eventsOf(view)) {
      if (Number.isFinite(e.atMs) && e.atMs > bestAt) {
        best = i;
        bestAt = e.atMs;
      }
    }
  }
  return best;
}

/**
 * Move an object to `local` (the reticle, odometry-NUE) in the running
 * visit (authoring plan 2026-09-28-0953 §3.4, M4): its geo recomputed
 * through the SAME alignment the visit's settle would use
 * ({@link settleAlignment} - the code correction of D10b when this visit
 * saw a stored code), so a pin moved in a later visit lands where the code
 * says, not where this visit's GPS says. The record keeps its id, text and
 * creation time; the caller also keeps the new odometry pose, so the
 * visit's own settle recomputes it once more at the end with the rest.
 *
 * @returns null when no alignment or zero can be read, or the pose cannot
 *   be minted (the caller refuses the move with a reason).
 */
export function planMove(
  input: SettleAlignmentInput & {
    readonly object: TourObject;
    readonly local: NuePose;
  },
): ({ object: TourObject } & SettleChoice) | null {
  const choice = settleAlignment(input);
  if (choice === null || input.zero === null) return null;
  const object = settledObject(
    input.object,
    input.local,
    choice.alignment,
    input.zero,
  );
  return object === null ? null : { object, ...choice };
}

/** The level in hand re-minted from its measurement through `alignment`,
 *  with that alignment's quality block and D31 heading marker (the
 *  framework's `qrMintHeadingMarker`, the Recorder mint's rule), or null
 *  when there is none to re-mint or the mint refuses. */
function remintedLevel(
  input: VisitSettleInput,
  alignment: readonly number[],
  zero: LatLong,
  quality: {
    readonly info: MintAlignmentInfo;
    readonly gpsExtentM: number | undefined;
  },
): { id: string; json: string } | null {
  const { measurement, mintedLevel } = input;
  if (measurement === null || mintedLevel === null) return null;
  const world = throughAlignment(
    odomNueFromWebXr(measurement.odomPose),
    alignment,
  );
  if (world === null) return null;
  const result = mintQrLevelFromWorld({
    world: {
      position: {
        x: world.position[0],
        y: world.position[1],
        z: world.position[2],
      },
      rotation: [...world.rotation],
    },
    zero,
    alignment: quality.info,
    sizeM: measurement.sizeM,
    nowIso: input.nowIso,
    quality: qrMintHeadingMarker(quality.gpsExtentM),
  });
  return result.ok ? { id: mintedLevel.id, json: result.json } : null;
}
