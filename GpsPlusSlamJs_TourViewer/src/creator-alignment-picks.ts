/**
 * The running AR visit's per-moment alignments for the creator (code book
 * refactor plan M2, split out of `creator-setup.ts` unchanged; owner
 * decision D33): the picks tracker fed with the store's alignment whenever
 * it changed, with each placed object, the code's sightings and its
 * measurement noted at their own moment, plus the session's GPS extent and
 * walked distance that stamp them.
 *
 * @see creator-alignment-picks.ts.md
 */

import type { MintAlignmentInfo } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { createGpsExtentTracker } from "gps-plus-slam-app-framework/state/gps-extent-tracker";
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import type { TourViewerStore } from "./tour-viewer-session.js";
import type { CreatorCodes } from "./creator-codes.js";
import { createVisitAlignmentTracker } from "./visit-alignment-picks.js";
import type { CodeSighting } from "./visit-settle.js";
import { createWalkedDistanceTracker } from "./walked-distance-tracker.js";

type VisitAlignmentTracker = ReturnType<typeof createVisitAlignmentTracker>;

export interface CreatorAlignmentPicks {
  /** Hand the picks the alignment as it stands now, when it changed. */
  sync(): void;
  /** An object placed or moved in the running visit, now. */
  notePlaced(id: string): void;
  /** The visit's sighting of the code in hand changed (also kept by
   *  `creator-codes.ts`). */
  setSighting(sighting: CodeSighting): void;
  /** The code measured in this visit, at the tap's moment. */
  noteMeasurement(atMs: number): void;
  /** The picks so far (`visit-alignment-picks.ts`). */
  picks(): ReturnType<VisitAlignmentTracker["picks"]>;
  /** The session's GPS extent over these fixes (the D31 marker). */
  gpsExtent(
    positions: Parameters<
      ReturnType<typeof createGpsExtentTracker>["update"]
    >[0],
  ): number;
  /** A new visit's picks start empty. */
  reset(): void;
}

export function wireCreatorAlignmentPicks(deps: {
  arStore: Pick<TourViewerStore, "getState">;
  /** Where the visit's sighting of the code in hand is kept. */
  codes: Pick<CreatorCodes, "setSighting">;
  /** The mint gate's view of the alignment (`authorAlignmentInfo`). */
  alignmentInfo: () => MintAlignmentInfo;
}): CreatorAlignmentPicks {
  const { arStore } = deps;
  /**
   * The running visit's per-moment alignments (owner decision D33): each
   * object placed or moved, the code measured and each sighting of the code
   * in hand is settled through the first mature alignment after its own
   * moment (`visit-alignment-picks.ts`), not the drifted end one. Fed on
   * every store change and before every noted moment; emptied per visit.
   * Nothing visible depends on it: the previews stay rigid as placed.
   */
  const alignmentPicks = createVisitAlignmentTracker();
  /** The session's GPS extent, the picks' maturity (40 m, D34). */
  const gpsExtent = createGpsExtentTracker();
  /** How far the author has walked, each event's stamp (R1, R3 of D33). */
  const walkedDistance = createWalkedDistanceTracker();
  /** What the picks last saw: the alignment and zero references and the
   *  fix count. */
  let pickedFrom: readonly [unknown, unknown, number] | null = null;

  /** Hand the picks the alignment as it stands now, when it changed. */
  function syncAlignmentPicks(): void {
    const state = arStore.getState();
    const alignmentMatrix = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    const positions = selectGpsPositions(state);
    if (
      pickedFrom !== null &&
      pickedFrom[0] === alignmentMatrix &&
      pickedFrom[1] === zero &&
      pickedFrom[2] === positions.length
    ) {
      return;
    }
    pickedFrom = [alignmentMatrix, zero, positions.length];
    alignmentPicks.noteAlignment({
      alignmentMatrix,
      zero,
      gpsExtentM: gpsExtent.update(positions),
      walkedM: walkedDistance.update({
        gpsPositions: positions,
        odometryPositions: selectOdometryPositions(state),
      }),
      alignmentInfo: deps.alignmentInfo(),
    });
  }

  /** An object placed or moved in the running visit, now. */
  function notePlaced(id: string): void {
    syncAlignmentPicks();
    alignmentPicks.notePlacement(id, Date.now());
  }

  /** The visit's sighting of the code in hand changed. */
  function setVisitSighting(sighting: CodeSighting): void {
    deps.codes.setSighting(sighting);
    syncAlignmentPicks();
    alignmentPicks.noteSighting(sighting, Date.now());
  }

  /** A new visit's picks start empty. */
  function resetAlignmentPicks(): void {
    alignmentPicks.reset();
    pickedFrom = null;
  }

  return {
    sync: syncAlignmentPicks,
    notePlaced,
    setSighting: setVisitSighting,
    noteMeasurement: (atMs) => {
      alignmentPicks.noteMeasurement(atMs);
    },
    picks: () => alignmentPicks.picks(),
    gpsExtent: (positions) => gpsExtent.update(positions),
    reset: resetAlignmentPicks,
  };
}
