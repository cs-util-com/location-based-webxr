/**
 * The authoring settle (authoring plan 2026-09-28-0953 §3.2, M2c; owner
 * decisions D2 and D10b): at the end of an AR visit - and at Finish for the
 * visit still running - the geo of the code measured in that visit and of
 * every object placed in it is recomputed through ONE alignment.
 *
 * WHY. Each tap minted its geo through the alignment of that moment: the
 * code at "Save the measured position", each note at its own Save. Those
 * alignments differ, so the stored notes disagreed with the stored code by
 * however much GPS moved in between, and no later relocalization could undo
 * it (plan §2.2, B2). Settled through one alignment, code and notes share
 * the same GPS error and keep exactly the relation the phone's tracking saw.
 *
 * WHICH ALIGNMENT ({@link settleAlignment}):
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
export const CORRECTION_FLOOR_M = 5;
/** The multiple of the two visits' combined GPS accuracy admitted. */
export const CORRECTION_ACCURACY_FACTOR = 3;
/** The accuracy assumed for a visit, or a stored level, that reports none. */
export const CORRECTION_DEFAULT_ACCURACY_M = 5;
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
 */
export function correctionBoundM(
  visitAccuracyM: number | null | undefined,
  storedAccuracyM: number | null | undefined,
): number {
  const usable = (v: number | null | undefined): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0
      ? v
      : CORRECTION_DEFAULT_ACCURACY_M;
  return (
    CORRECTION_FLOOR_M +
    CORRECTION_ACCURACY_FACTOR *
      Math.hypot(usable(visitAccuracyM), usable(storedAccuracyM))
  );
}

/** 16 finite numbers, or null. */
function readAlignment(alignment: ArrayLike<number> | null): number[] | null {
  if (alignment === null || alignment.length !== 16) return null;
  const values = Array.from(alignment);
  return values.every((v) => typeof v === "number" && Number.isFinite(v))
    ? values
    : null;
}

/** A level's stored geo, or null when the JSON is not a level or carries
 *  no geo (external data: a zip, a draft). */
function storedGeo(json: string): QrGeoPose | null {
  try {
    return parseQrLevel(JSON.parse(json) as unknown).qr.geo ?? null;
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
export function settleAlignment(input: SettleAlignmentInput): {
  basis: SettleBasis;
  alignment: number[];
  /** A code correction this visit had, refused by the plausibility bound;
   *  null otherwise. */
  refused: CorrectionRefusal | null;
} | null {
  const alignment = readAlignment(input.alignment);
  if (alignment === null || input.zero === null) return null;
  if (measuredHere(input)) {
    return { basis: "measured-here", alignment, refused: null };
  }
  const correction = codeCorrectionOf(input, alignment, input.zero);
  if (correction === null) {
    return { basis: "visit-alignment", alignment, refused: null };
  }
  if ("refused" in correction) {
    return { basis: "visit-alignment", alignment, refused: correction.refused };
  }
  return {
    basis: "code-corrected",
    alignment: correction.alignment,
    refused: null,
  };
}

/** The visit's alignment corrected through its sighting of the stored
 *  code, the refusal when the correction breaks the bound, or null when
 *  there is no correction to make. */
function codeCorrectionOf(
  input: SettleAlignmentInput,
  alignment: readonly number[],
  zero: LatLong,
): { alignment: number[] } | { refused: CorrectionRefusal } | null {
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
  if (size === null) return null;
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

export interface VisitSettleInput extends SettleAlignmentInput {
  readonly placed: readonly {
    readonly object: TourObject;
    readonly placement?: { readonly visit: number; readonly local: NuePose };
  }[];
  /** The mint gate's view of the alignment at the visit's end, for the
   *  re-minted level's quality block. */
  readonly alignmentInfo: MintAlignmentInfo;
  readonly nowIso: string;
}

export interface VisitSettle {
  readonly basis: SettleBasis;
  /** The alignment the geo was recomputed through. */
  readonly alignment: number[];
  /** The settled records, by their index in `placed`. */
  readonly objects: { index: number; object: TourObject }[];
  /** The code re-minted through the visit's alignment, when this visit
   *  measured it; null otherwise (or when the re-mint was refused). */
  readonly level: { id: string; json: string } | null;
  /** A code correction refused by the plausibility bound; null otherwise. */
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
  const measured = measuredHere(input);
  if (targets.length === 0 && !measured) return null;
  const choice = settleAlignment(input);
  const zero = input.zero;
  if (choice === null || zero === null) return null;
  const objects = targets.flatMap(({ index, object, local }) => {
    const settled = settledObject(object, local, choice.alignment, zero);
    return settled === null ? [] : [{ index, object: settled }];
  });
  const level = measured ? remintedLevel(input, choice.alignment, zero) : null;
  return {
    basis: choice.basis,
    alignment: choice.alignment,
    objects,
    level,
    refused: choice.refused,
  };
}

/** The level in hand re-minted from its measurement through `alignment`,
 *  or null when there is none to re-mint or the mint refuses. */
function remintedLevel(
  input: VisitSettleInput,
  alignment: readonly number[],
  zero: LatLong,
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
    alignment: input.alignmentInfo,
    sizeM: measurement.sizeM,
    nowIso: input.nowIso,
  });
  return result.ok ? { id: mintedLevel.id, json: result.json } : null;
}
