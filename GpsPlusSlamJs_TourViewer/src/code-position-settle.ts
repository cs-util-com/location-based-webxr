/**
 * The keep-or-replace decision for a STORED code, at its visit's settle
 * (UI round 1, U3; second plan review #3; owner decisions 2026-10-06). The
 * settle is where the visit's alignment, its picks and the code's
 * sightings still exist; this plans what `code-position-rule.ts` decides
 * there and hands the settle a measurement when the code's saved position
 * changes, so the existing re-mint path (`planVisitSettle`, measured here)
 * does the rest. Pure.
 *
 * THE CANDIDATE. The latest kept sighting of the code in hand, through its
 * own pick (D33) when the pick carries its quality block, else through the
 * visit's end alignment - the SAME source the re-mint takes (R7 of D33),
 * so the walk the rule judges is the walk the saved quality block then
 * records.
 *
 * @see code-position-settle.ts.md
 */

import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { LatLong } from "gps-plus-slam-app-framework/core";

import {
  decideCodePosition,
  qualityOfLevel,
  type CodePositionDecision,
  type PositionQuality,
} from "./code-position-rule.js";
import {
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
  /** The creator's remembered answer for the code seen at this spot
   *  (north and east of its saved position, m); null for none. */
  readonly answerAt: (spot: {
    northM: number;
    eastM: number;
  }) => "moved" | "second-copy" | null;
}

export interface CodePositionPlan {
  readonly levelId: string;
  readonly decision: CodePositionDecision;
  /** How far this visit sees the code from its saved spot (m). */
  readonly offsetM: number;
  readonly candidate: PositionQuality;
  readonly stored: PositionQuality;
  /** What the settle re-mints the code from - only for `replace` and
   *  `move`; null otherwise. */
  readonly measurement: CodeMeasurement | null;
  /** The pick the re-mint and the code event go through: the sighting's
   *  own, or (without its quality block) one with no alignment - the end
   *  alignment then - keeping the sighting's moment and walked distance. */
  readonly pick: TimedAlignment | null;
}

/** 16 finite numbers, or null. */
function readAlignment(alignment: ArrayLike<number> | null): number[] | null {
  if (alignment === null || alignment.length !== 16) return null;
  const values = Array.from(alignment);
  return values.every((v) => Number.isFinite(v)) ? values : null;
}

/** The printed size the saved level records (m), or null. */
function storedSizeM(json: string): number | null {
  try {
    return parseQrLevel(JSON.parse(json) as unknown).qr.physicalSizeM ?? null;
  } catch {
    return null;
  }
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
  const throughPick = picked !== null && latest?.alignmentInfo !== undefined;
  const alignment = throughPick ? picked : end;
  const candidate: PositionQuality = throughPick
    ? {
        extentM: latest.gpsExtentM ?? null,
        accuracyM: latest.alignmentInfo?.gpsAccuracyM ?? null,
      }
    : input.endQuality;
  const offset = sightedCodeOffset({
    visit: input.visit,
    alignment,
    zero: input.zero,
    mintedLevel: level,
    measurement: null,
    sighting,
  });
  if (offset === null) return null;
  const answer = input.answerAt({
    northM: offset.northM,
    eastM: offset.eastM,
  });
  if (answer === "second-copy") return null;
  const stored = qualityOfLevel(level.json);
  const decision = decideCodePosition({
    stored,
    candidate,
    offsetM: offset.horizontalM,
    moved: answer === "moved",
  });
  const changes = decision.kind === "replace" || decision.kind === "move";
  const sizeM = storedSizeM(level.json);
  if (!changes || sizeM === null) {
    return {
      levelId: level.id,
      decision,
      offsetM: offset.horizontalM,
      candidate,
      stored,
      measurement: null,
      pick: null,
    };
  }
  return {
    levelId: level.id,
    decision,
    offsetM: offset.horizontalM,
    candidate,
    stored,
    measurement: {
      levelId: level.id,
      text: sighting.text,
      odomPose: sighting.odomPose,
      sizeM,
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
