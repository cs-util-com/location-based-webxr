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
  const picked = readAlignment(latest?.alignment ?? null);
  const pickQuality: PositionQuality | null =
    picked !== null && latest?.alignmentInfo !== undefined
      ? {
          extentM: latest.gpsExtentM ?? null,
          accuracyM: latest.alignmentInfo.gpsAccuracyM ?? null,
        }
      : null;
  const throughPick =
    picked !== null && pickQuality !== null && isReliable(pickQuality);
  const alignment = throughPick ? picked : end;
  const candidate = throughPick ? pickQuality : input.endQuality;
  const offset = sightedCodeOffset({
    visit: input.visit,
    alignment,
    zero: input.zero,
    mintedLevel: level,
    measurement: null,
    sighting,
  });
  if (offset === null) return null;
  const stored = qualityOfLevel(level.json);
  // A silent replace only within what two visits' GPS plausibly disagree
  // by (the code correction's own bound, D10b) and below the move
  // question's 15 m (U3 milestone review #11).
  const far =
    offset.horizontalM >=
      Math.min(
        REPLACE_CAP_M,
        correctionBoundM(candidate.accuracyM, stored.accuracyM),
      ) || offset.yawDeg > CORRECTION_MAX_YAW_DEG;
  const decision = decideCodePosition({
    stored,
    candidate,
    offsetM: offset.horizontalM,
    automaticMove: input.automaticMove === true,
    far,
  });
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
      odomPose: sighting.odomPose,
      sizeM: input.sizeM,
      visit: input.visit,
    },
    pick:
      latest === undefined
        ? null
        : throughPick
          ? latest
          : {
              atMs: latest.atMs,
              alignment: null,
              ...(latest.walkedM === undefined
                ? {}
                : { walkedM: latest.walkedM }),
            },
  };
}
