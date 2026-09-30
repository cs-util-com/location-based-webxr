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
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { LatLong } from "gps-plus-slam-app-framework/core";

import { objectPoseNue } from "./content-placement.js";
import {
  correctedAlignment,
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
}

/** 16 finite numbers, or null. */
function readAlignment(alignment: ArrayLike<number> | null): number[] | null {
  if (alignment === null || alignment.length !== 16) return null;
  const values = Array.from(alignment);
  return values.every((v) => typeof v === "number" && Number.isFinite(v))
    ? values
    : null;
}

/** The stored code's pose in GPS-world NUE, or null when the level carries
 *  none that reads. */
function storedCodePose(json: string, zero: LatLong): NuePose | null {
  try {
    const geo = parseQrLevel(JSON.parse(json) as unknown).qr.geo;
    if (geo === undefined) return null;
    const pose = objectPoseNue(geo, zero);
    return { position: pose.positionNue, rotation: pose.rotationNue };
  } catch {
    return null;
  }
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
): { basis: SettleBasis; alignment: number[] } | null {
  const alignment = readAlignment(input.alignment);
  if (alignment === null || input.zero === null) return null;
  if (measuredHere(input)) return { basis: "measured-here", alignment };
  const { mintedLevel, sighting } = input;
  if (
    mintedLevel !== null &&
    sighting !== null &&
    sighting.levelId === mintedLevel.id
  ) {
    const stored = storedCodePose(mintedLevel.json, input.zero);
    const corrected =
      stored === null
        ? null
        : correctedAlignment(
            alignment,
            odomNueFromWebXr(sighting.odomPose),
            stored,
          );
    if (corrected !== null) {
      return { basis: "code-corrected", alignment: corrected };
    }
  }
  return { basis: "visit-alignment", alignment };
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
  return { basis: choice.basis, alignment: choice.alignment, objects, level };
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
