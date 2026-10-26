/**
 * The keep-or-replace decision for a STORED code, at its visit's settle
 * (UI round 1, U3; second plan review #3; owner decisions 2026-10-06). The
 * settle is where the visit's alignment, its picks and the code's
 * sightings still exist; this plans what `code-position-rule.ts` decides
 * there and hands the settle a measurement when the code's saved position
 * changes, so the existing re-mint path (`planVisitSettle`, measured here)
 * does the rest. Pure.
 *
 * THE CANDIDATE. The latest kept sighting of the code in hand, through ONE
 * source that the rule judges and the re-mint then takes (R7 of D33): the
 * sighting's own pick when it carries its quality block and its walk is
 * reliable (least drift since the sighting), else the visit's end
 * alignment. A pick stops advancing once its alignment matures (40 m of
 * GPS spread), so judging the pick alone could never reach the walk a
 * phone at more than about 8 m accuracy needs (U3 milestone review #1);
 * the end alignment keeps growing with the walk.
 *
 * @see code-position-settle.ts.md
 */

import type { MintAlignmentInfo } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { LatLong } from "gps-plus-slam-app-framework/core";

import {
  decideCodePosition,
  isReliable,
  qualityOfLevel,
  type CodePositionDecision,
  REPLACE_CAP_M,
  type PositionQuality,
} from "./code-position-rule.js";
import {
  CORRECTION_MAX_YAW_DEG,
  correctionBoundM,
  readAlignment,
  sightedCodeOffset,
  type CodeMeasurement,
  type CodeSighting,
  type TimedAlignment,
  turnLimitDeg,
  type VisitAlignmentPicks,
} from "./visit-settle.js";

export interface CodePositionSettleInput {
  /** The visit being settled (`arSessionGeneration`). */
  readonly visit: number;
  /** The level in hand: the code's saved position. */
  readonly mintedLevel: { readonly id: string; readonly json: string } | null;
  readonly measurement: CodeMeasurement | null;
  /** The visit's latest stable sighting of the code in hand. */
  readonly sighting: CodeSighting | null;
  readonly picks: VisitAlignmentPicks | null | undefined;
  /** The store's alignment at the visit's end. */
  readonly alignment: ArrayLike<number> | null;
  readonly zero: LatLong | null;
  /** The end alignment's walk and accuracy. */
  readonly endQuality: PositionQuality;
  /** The printed size the visit's poses were solved at (m): what a
   *  re-mint from the sighting is minted with, as a tap's mint was. */
  readonly sizeM: number;
  /** The automatic code-spot rule moved the code (`code-spots.ts`, code
   *  book plan M6): re-minted here, through this plan's candidate. */
  readonly automaticMove?: boolean;
  /** The visit's own device-only view of the code (`code-device-fit.ts`),
   *  for a visit a stored code's votes lined up, whose pick and end
   *  alignment those votes hold. When given, it is the ONE source: the
   *  code is judged through `alignment` at `codeOdomPose`, with
   *  `quality` (the fit's own walk - the shorter of its GPS spread and the
   *  phone's tracking - and its accuracy) as the candidate's quality, and a
   *  change is re-minted there through it, stamped with `alignmentInfo`
   *  and that walk. A code it sees within its own error of the saved spot
   *  is not replaced (`FIT_REPLACE_MIN_OFFSET_PER_ACCURACY`). */
  readonly deviceFit?: {
    readonly alignment: readonly number[];
    readonly codeOdomPose: Pose;
    readonly alignmentInfo: MintAlignmentInfo;
    readonly quality: PositionQuality;
  };
}

export interface CodePositionPlan {
  readonly levelId: string;
  readonly decision: CodePositionDecision;
  /** How far this visit sees the code from its saved spot (m). */
  readonly offsetM: number;
  /** The same offset north and east (m): where a move would mint the code,
   *  relative to its saved spot (code book plan M6). */
  readonly offsetNorthM: number;
  readonly offsetEastM: number;
  readonly candidate: PositionQuality;
  readonly stored: PositionQuality;
  /** What the settle re-mints the code from - only for `replace` and
   *  `move`; null otherwise. */
  readonly measurement: CodeMeasurement | null;
  /** The pick the re-mint and the code event go through: the sighting's
   *  own, or one with no alignment (the end alignment then), keeping the
   *  sighting's moment and walked distance. */
  readonly pick: TimedAlignment | null;
}

/**
 * @returns null when there is nothing to decide: no stored code in hand, a
 *   code measured in THIS visit (its own settle re-mints it), no sighting
 *   of it, no readable alignment or zero, or a print the creator called a
 *   second copy.
 */
export function planCodePosition(
  input: CodePositionSettleInput,
): CodePositionPlan | null {
  const level = input.mintedLevel;
  const end = readAlignment(input.alignment);
  if (level === null || end === null || input.zero === null) return null;
  const m = input.measurement;
  if (m !== null && m.levelId === level.id && m.visit === input.visit) {
    return null;
  }
  const kept = (input.picks?.sightings ?? []).filter(
    (s) => s.sighting.levelId === level.id,
  );
  const latest = kept.at(-1);
  const sighting =
    latest?.sighting ??
    (input.sighting?.levelId === level.id ? input.sighting : null);
  if (sighting === null) return null;
  // The ONE source the rule judges and the re-mint then takes.
  const source =
    input.deviceFit !== undefined
      ? fitSource(input.deviceFit, sighting, latest)
      : pickSource(end, input.endQuality, sighting, latest);
  const { alignment, candidate } = source;
  const offset = sightedCodeOffset({
    visit: input.visit,
    alignment,
    zero: input.zero,
    mintedLevel: level,
    measurement: null,
    sighting: source.sighting,
  });
  if (offset === null) return null;
  const stored: PositionQuality = qualityOfLevel(level.json);
  // A silent replace only within what two visits' GPS plausibly disagree
  // by (the code correction's own bound, D10b) and below the move
  // question's 15 m (U3 milestone review #11).
  const farOff =
    offset.horizontalM >=
    Math.min(
      REPLACE_CAP_M,
      correctionBoundM(candidate.accuracyM, stored.accuracyM),
    );
  // At its spot but turned beyond what this visit's GPS heading can be
  // off by: the stored heading is the wrong one (field test 3, D-F6a) -
  // also past the correction's yaw bound, which otherwise reads a turn
  // that large as a second print.
  const limit = turnLimitDeg(candidate);
  // Through a device fit, a turn alone never replaces a code stamped by a
  // better walk than the fit's: the turn is then the fit's error as likely
  // as the code's. (Through the votes a visit's heading was always the
  // stored code's, so this branch is new for such a visit.)
  const turnTrusted =
    input.deviceFit === undefined ||
    !isReliable(stored) ||
    noWeaker(candidate, stored);
  const turned =
    !farOff && limit !== null && offset.yawDeg > limit && turnTrusted;
  const far = farOff || (!turned && offset.yawDeg > CORRECTION_MAX_YAW_DEG);
  const decided = decideCodePosition({
    stored,
    candidate,
    offsetM: offset.horizontalM,
    automaticMove: input.automaticMove === true,
    far,
    ...(turned ? { turnedDeg: offset.yawDeg } : {}),
  });
  const decision: CodePositionDecision =
    input.deviceFit !== undefined &&
    decided.kind === "replace" &&
    decided.turnedDeg === undefined &&
    withinFitError(offset.horizontalM, candidate)
      ? { kind: "keep", reason: "stored-good" }
      : decided;
  const changes = decision.kind === "replace" || decision.kind === "move";
  const base = {
    levelId: level.id,
    decision,
    offsetM: offset.horizontalM,
    offsetNorthM: offset.northM,
    offsetEastM: offset.eastM,
    candidate,
    stored,
  };
  if (!changes) return { ...base, measurement: null, pick: null };
  return {
    ...base,
    measurement: {
      levelId: level.id,
      text: sighting.text,
      odomPose: source.sighting.odomPose,
      sizeM: input.sizeM,
      visit: input.visit,
    },
    pick: source.pick,
  };
}

/**
 * Through a device fit, a code is replaced for its position only when the
 * fit sees it at least this many times the fit's accuracy from its saved
 * spot. Nearer, the offset is mostly the fit's own GPS error: a replace
 * would move a correct code by that error and stamp it there, and later
 * visits would then keep the wrong spot. The guard also gives up some
 * small real improvements (a code stored 5 m off), but a code it keeps
 * stays unstamped, so a later visit through a fit can still correct it,
 * while a replaced one is stamped for good. Measured on the indoor sweep
 * (`creator-code-votes.test.ts`; the numbers in the sidecar): at 0.75
 * nearly every 10-15 m correction stays; at 1 about half of those at 8 m
 * accuracy are lost.
 */
const FIT_REPLACE_MIN_OFFSET_PER_ACCURACY = 0.75;

/** The fit sees the code nearer its saved spot than its own error: below
 *  `FIT_REPLACE_MIN_OFFSET_PER_ACCURACY` times its accuracy. An unknown
 *  accuracy guards nothing (such a fit is never reliable anyway). */
function withinFitError(offsetM: number, fit: PositionQuality): boolean {
  return (
    fit.accuracyM !== null &&
    offsetM < FIT_REPLACE_MIN_OFFSET_PER_ACCURACY * fit.accuracyM
  );
}

/** `a` rests on at least the walk of `b`, at no worse an accuracy. */
function noWeaker(a: PositionQuality, b: PositionQuality): boolean {
  return (
    a.extentM !== null &&
    a.accuracyM !== null &&
    b.extentM !== null &&
    b.accuracyM !== null &&
    a.extentM >= b.extentM &&
    a.accuracyM <= b.accuracyM
  );
}

/** One kept sighting of the code, at its moment. */
type KeptSighting = VisitAlignmentPicks["sightings"][number];

/** Where a plan reads the code and re-mints it from. */
interface PlanSource {
  readonly alignment: readonly number[];
  readonly candidate: PositionQuality;
  /** The sighting at the pose the code is read (and re-minted) at. */
  readonly sighting: CodeSighting;
  /** The pick a change is re-minted through. */
  readonly pick: TimedAlignment | null;
}

/** The latest sighting through its own pick when the pick carries its
 *  quality block and its walk is reliable (least drift since the
 *  sighting), else through the end alignment - the pick then keeps the
 *  sighting's moment and walked distance but no alignment. */
function pickSource(
  end: number[],
  endQuality: PositionQuality,
  sighting: CodeSighting,
  latest: KeptSighting | undefined,
): PlanSource {
  const picked = readAlignment(latest?.alignment ?? null);
  const pickQuality: PositionQuality | null =
    picked !== null && latest?.alignmentInfo !== undefined
      ? {
          extentM: latest.gpsExtentM ?? null,
          accuracyM: latest.alignmentInfo.gpsAccuracyM ?? null,
        }
      : null;
  if (picked !== null && pickQuality !== null && isReliable(pickQuality)) {
    return {
      alignment: picked,
      candidate: pickQuality,
      sighting,
      pick: latest ?? null,
    };
  }
  return {
    alignment: end,
    candidate: endQuality,
    sighting,
    pick:
      latest === undefined
        ? null
        : {
            atMs: latest.atMs,
            alignment: null,
            ...(latest.walkedM === undefined
              ? {}
              : { walkedM: latest.walkedM }),
          },
  };
}

/** The visit's device-only fit, read at the fit's pose: a change is
 *  re-minted through the fit with its device-only quality block and the
 *  fit's own walk, so the geo and its stamp come from the same fit. The
 *  pick keeps the latest sighting's moment and walked distance - the code
 *  event the visit's notes tie to - and has neither without a kept
 *  sighting. */
function fitSource(
  fit: NonNullable<CodePositionSettleInput["deviceFit"]>,
  sighting: CodeSighting,
  latest: KeptSighting | undefined,
): PlanSource {
  return {
    alignment: fit.alignment,
    candidate: fit.quality,
    sighting: { ...sighting, odomPose: fit.codeOdomPose },
    pick: {
      atMs: latest?.atMs ?? Number.NaN,
      alignment: [...fit.alignment],
      alignmentInfo: fit.alignmentInfo,
      ...(fit.quality.extentM === null
        ? {}
        : { gpsExtentM: fit.quality.extentM }),
      ...(latest?.walkedM === undefined ? {} : { walkedM: latest.walkedM }),
    },
  };
}
