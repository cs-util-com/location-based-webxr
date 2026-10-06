/**
 * The one owner of the codes while authoring (code book refactor plan M4a,
 * the M2 milestone review's #1): the code in hand, its measurement, the
 * visit's sighting of it, the visit's latest sighting of every stored code,
 * and the levels a Finish of this page wrote. Every creator module reads
 * and writes them through this module.
 *
 * Its API is per code wherever the callers allow (`hasStoredPose`,
 * `isSaved`, `references`); "in hand" is the one-code view today's callers
 * need, and M4c turns the inside into the code book (`code-book.ts`)
 * holding several. Until M5 the session fields `ctx.mintedLevel`,
 * `ctx.codeMeasurement` and `ctx.visitCodeSighting` are the storage: the
 * tour's close (`archive-open.ts`) clears them and `scan-open.ts` reads
 * them, so this module reads them back rather than keeping a copy.
 *
 * @see creator-codes.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { LevelText } from "./code-book.js";
import type { TourViewerSession } from "./tour-viewer-session.js";
import {
  storedGeo,
  type CodeMeasurement,
  type CodeSighting,
} from "./visit-settle.js";

/** A stored code's latest sighting in a visit (the visit log reads it). */
interface StoredSighting {
  readonly visit: number;
  readonly sighting: CodeSighting;
}

export interface CreatorCodes {
  /** The code in hand, or null. */
  inHand(): LevelText | null;
  /** This page's measurement of the code in hand, or null. */
  measurement(): CodeMeasurement | null;
  /** The running visit's sighting of the code in hand, or null. */
  sighting(): CodeSighting | null;
  /** Take `level` in hand with its measurement (null: a stored reference). */
  setInHand(level: LevelText | null, measurement: CodeMeasurement | null): void;
  /** The settle re-minted the code in hand: its measurement stays. */
  remint(level: LevelText): void;
  /** A restored draft's level, taken only into an empty hand; true when it
   *  was taken (a live measurement is newer than a draft). */
  restoreInHand(level: LevelText): boolean;
  /** Nothing in hand (a new print size, a failed identity's empty prior). */
  clearInHand(): void;
  setSighting(sighting: CodeSighting): void;
  clearSighting(): void;
  /** `levelId` has a stored pose: in hand, or in the open tour with geo. */
  hasStoredPose(levelId: string): boolean;
  /** Every code's stored pose: the code in hand first, then the open
   *  tour's others (geo null for a level that carries none). */
  references(): { levelId: string; geo: QrGeoPose | null }[];
  /** The stored poses that read, in the order of {@link references}. */
  storedPoses(): QrGeoPose[];
  /** A stored code seen stable in `visit` (the latest one per code). */
  noteStoredSighting(
    levelId: string,
    visit: number,
    sighting: CodeSighting,
  ): void;
  storedSightings(): IterableIterator<StoredSighting>;
  /** A Finish of this page wrote `levelId` into the tour. */
  noteFinished(levelId: string): void;
  /** `levelId` is saved in the tour: hosted, or written by a Finish. */
  isSaved(levelId: string): boolean;
  /** A visit ended: its sightings go. */
  endVisit(): void;
  /** A tour closed: the levels its Finishes wrote go. */
  reset(): void;
}

export function wireCreatorCodes(deps: {
  ctx: TourViewerSession;
}): CreatorCodes {
  const { ctx } = deps;
  /**
   * The latest stable sighting in the running visit of EVERY code with a
   * stored pose - the level in hand or any level of the open tour - by
   * level id (M3a/M3b review #6). Only the visit log reads it: each becomes
   * that code's visit record, through the visit's plain alignment, so the
   * tour's other codes gather visits too. It never makes a code the one in
   * hand, and never corrects anything. Tagged with its visit, so a visit
   * that ended without a settle cannot leak into the next one's log.
   */
  const storedCodeSightings = new Map<string, StoredSighting>();
  /** The levels a Finish in this page wrote into the tour: saved, so a
   *  new code may take the hand from them (`codeOutcome`). */
  const finishedLevelIds = new Set<string>();

  function references(): { levelId: string; geo: QrGeoPose | null }[] {
    const inHand = ctx.mintedLevel;
    const out: { levelId: string; geo: QrGeoPose | null }[] =
      inHand === null
        ? []
        : [{ levelId: inHand.id, geo: storedGeo(inHand.json) }];
    for (const [id, level] of ctx.currentLevels ?? []) {
      if (id === inHand?.id) continue;
      out.push({ levelId: id, geo: level.qr.geo ?? null });
    }
    return out;
  }

  return {
    inHand: () => ctx.mintedLevel,
    measurement: () => ctx.codeMeasurement,
    sighting: () => ctx.visitCodeSighting,
    setInHand: (level, measurement) => {
      ctx.mintedLevel = level;
      ctx.codeMeasurement = measurement;
    },
    remint: (level) => {
      ctx.mintedLevel = level;
    },
    restoreInHand: (level) => {
      if (ctx.mintedLevel !== null) return false;
      ctx.mintedLevel = level;
      return true;
    },
    clearInHand: () => {
      ctx.mintedLevel = null;
      ctx.codeMeasurement = null;
    },
    setSighting: (sighting) => {
      ctx.visitCodeSighting = sighting;
    },
    clearSighting: () => {
      ctx.visitCodeSighting = null;
    },
    hasStoredPose: (levelId) => {
      if (ctx.mintedLevel?.id === levelId) return true;
      return ctx.currentLevels?.get(levelId)?.qr.geo !== undefined;
    },
    references,
    storedPoses: () =>
      references().flatMap((r) => (r.geo === null ? [] : [r.geo])),
    noteStoredSighting: (levelId, visit, sighting) => {
      storedCodeSightings.set(levelId, { visit, sighting });
    },
    storedSightings: () => storedCodeSightings.values(),
    noteFinished: (levelId) => {
      finishedLevelIds.add(levelId);
    },
    isSaved: (levelId) =>
      (ctx.currentLevels?.has(levelId) ?? false) ||
      finishedLevelIds.has(levelId),
    endVisit: () => {
      storedCodeSightings.clear();
      ctx.visitCodeSighting = null;
    },
    reset: () => {
      finishedLevelIds.clear();
    },
  };
}
