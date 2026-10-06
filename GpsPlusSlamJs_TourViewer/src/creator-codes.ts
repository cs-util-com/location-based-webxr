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
import {
  afterFinish,
  codesToWrite,
  withHosted,
  withMeasurement,
  withoutMeasurement,
  withReference,
  withSaved,
  type CodeBook,
  type LevelText,
} from "./code-book.js";
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
  /** `levelId` is saved in the tour: hosted, or written by a Finish. */
  isSaved(levelId: string): boolean;
  /** The codes a Finish writes now: every code of the book whose saved
   *  text differs from what the zip it rebuilds from holds (the last
   *  Finish's text, else the hosted one), in the order they were taken. */
  toWrite(): LevelText[];
  /** A Finish wrote `written`: each is saved (`isSaved`) and its text is
   *  what the next Finish builds on. */
  finished(written: readonly LevelText[]): void;
  /** A visit ended: its sightings go. */
  endVisit(): void;
  /** A tour closed: the book and the levels its Finishes wrote go. */
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
  /**
   * Every code this page took, with its saved text, measurement and what
   * the last Finish wrote (`code-book.ts`). Until M5 the session field
   * `ctx.mintedLevel` is still written from outside (the composed tests;
   * the tour's close clears it), so the code in hand is taken into the
   * book whenever the book is read ({@link takeInHand}).
   */
  let book: CodeBook = new Map();

  function takeInHand(): void {
    const level = ctx.mintedLevel;
    if (level === null || book.get(level.id)?.saved === level.json) return;
    book = withReference(withSaved(book, level), level.id);
  }

  /** The book with the hosted texts filled in (the Finish's baseline). */
  function withHostedTexts(): CodeBook {
    takeInHand();
    return withHosted(book, ctx.currentLevelTexts ?? new Map());
  }

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
      if (level === null) return;
      book =
        measurement === null
          ? withReference(withSaved(book, level), level.id)
          : withMeasurement(book, level, measurement);
    },
    remint: (level) => {
      ctx.mintedLevel = level;
      book = withSaved(book, level);
    },
    restoreInHand: (level) => {
      if (ctx.mintedLevel !== null) return false;
      ctx.mintedLevel = level;
      book = withReference(withSaved(book, level), level.id);
      return true;
    },
    clearInHand: () => {
      // The code in hand is measured again (a new print size): its new
      // pose no longer counts, and its saved text falls back to the zip's.
      const id = ctx.mintedLevel?.id;
      ctx.mintedLevel = null;
      ctx.codeMeasurement = null;
      if (id !== undefined) book = withoutMeasurement(book, id);
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
    isSaved: (levelId) =>
      (ctx.currentLevels?.has(levelId) ?? false) ||
      finishedLevelIds.has(levelId),
    toWrite: () => codesToWrite(withHostedTexts()),
    finished: (written) => {
      book = afterFinish(withHostedTexts(), written);
      for (const { id } of written) finishedLevelIds.add(id);
    },
    endVisit: () => {
      storedCodeSightings.clear();
      ctx.visitCodeSighting = null;
    },
    reset: () => {
      finishedLevelIds.clear();
      book = new Map();
    },
  };
}
