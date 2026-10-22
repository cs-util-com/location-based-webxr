/**
 * The one owner of the codes while authoring (code book refactor plan M4a,
 * the M2 milestone review's #1): the code in hand, its measurement, the
 * visit's sighting of it, the visit's latest sighting of every stored code,
 * and the levels a Finish of this page wrote. Every creator module reads
 * and writes them through this module.
 *
 * A facade over the page's store (debug-captures plan M3a): the tour's
 * codes are the tour document's (`tourDocument`'s `codes`, whose reducers
 * apply `code-book.ts`'s rules), the hand and the sightings the page's
 * (`creatorCodes`, `creator-codes-slice.ts`). It dispatches their actions
 * and reads their selectors; it holds no state of its own.
 *
 * Its API is per code wherever the callers allow (`hasStoredPose`,
 * `references`); "in hand" is the one-code view today's callers need,
 * over the code book holding every code. The tour's close reaches it
 * through {@link CreatorCodes.reset}.
 *
 * @see creator-codes.ts.md
 */

import { isAnyOf, type UnknownAction } from "@reduxjs/toolkit";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  codeLiveText,
  codeSavedText,
  documentCodes,
  hostedLevels,
  hostedLevelTexts,
  levelsNotHosted,
  levelsToWrite,
  selectTourDocument,
  tourDocumentActions,
  type LevelText,
} from "./tour-document.js";
import {
  creatorCodesActions,
  selectCreatorCodes,
  type StoredSighting,
} from "./creator-codes-slice.js";
import type { DocumentChange, SettleBatch } from "./creator-document.js";
import type { TourViewerSession } from "./tour-viewer-session.js";
import {
  storedGeo,
  type CodeMeasurement,
  type CodeSighting,
} from "./visit-settle.js";

export interface CreatorCodes {
  /** The code in hand, or null. */
  inHand(): LevelText | null;
  /** This page's measurement of the code in hand, or null. */
  measurement(): CodeMeasurement | null;
  /** The running visit's sighting of the code in hand, or null. */
  sighting(): CodeSighting | null;
  /** Take `level` in hand with its measurement (null: a stored reference). */
  setInHand(level: LevelText | null, measurement: CodeMeasurement | null): void;
  /** A restored draft's level, taken only into an empty hand; true when it
   *  was taken (a live measurement is newer than a draft: a code changed
   *  live in this page is taken at its live text). */
  restoreInHand(level: LevelText): boolean;
  /** Nothing in hand (a new print size). */
  clearInHand(): void;
  setSighting(sighting: CodeSighting): void;
  /** A code's sightings of this visit are void (its printed size changed):
   *  its stored-code sighting goes, and the visit's sighting if it is that
   *  code's. */
  forgetSightings(levelId: string): void;
  /** `levelId` has a stored pose: in hand, in the book with a saved pose
   *  (measured or kept by this page - M4 review #1), or in the open tour
   *  with geo. */
  hasStoredPose(levelId: string): boolean;
  /** The book's saved level text for `levelId` (what the next Finish
   *  writes); null when the book does not hold the code. */
  savedText(levelId: string): string | null;
  /** Every code's stored pose: the code in hand first, then the book's
   *  others at the pose the next Finish writes (M4e), then the open tour's
   *  others (geo null for a level that carries none); each code once. */
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
  /** The visit's codes for the settle (M4c-2): every code measured in
   *  `visit` (book order), then every stored code sighted stable in it,
   *  with its stored text. */
  visitCodes(visit: number): {
    level: LevelText;
    measurement: CodeMeasurement | null;
  }[];
  /** A code re-minted by the settle: saved in the book; it takes the hand
   *  only if it already had it. */
  saveLevel(level: LevelText): void;
  /** A settle's changes (`batch`) and the codes it re-minted (`levels`,
   *  saved in order, each taking the hand only if it already had it) as
   *  ONE step of the document (plan M3b, Q-D): its undo takes the codes'
   *  texts back with the moves, and the hand lets go of a code it took
   *  back. What the document took, or null for no step. */
  applySettle(
    batch: Pick<SettleBatch, "commit">,
    levels: readonly LevelText[],
    what: string,
  ): DocumentChange | null;
  /** This page took `levelId` (measured, restored or kept it). */
  inBook(levelId: string): boolean;
  /** Every code this page holds, in the order it took them (M4d: the
   *  print step warns before stranding them). */
  ids(): string[];
  /** The one numbering every label uses ("Code 2", code book plan M5b):
   *  the open tour's codes in the tour's order, then the codes this page
   *  added, in the order it took them - never moved by the hand. */
  numbering(): string[];
  /** `levelId` was measured in `visit`. */
  measuredIn(levelId: string, visit: number): boolean;
  /** A code not in hand is measured again (a new print size): its
   *  measurement is dropped and its saved text falls back to the zip's. */
  dropMeasurement(levelId: string): void;
  /** The codes the draft keeps: every code of the book whose saved text
   *  the HOSTED zip does not hold yet, a Finish's among them (its zip
   *  reaches the world only with the upload). */
  notHosted(): LevelText[];
  /** A restored draft's codes, saved and taken as references; a code
   *  changed live in this page keeps its live text. */
  restoreLevels(levels: readonly LevelText[]): void;
  /** The codes a Finish writes now: every code of the book whose saved
   *  text differs from what the zip it rebuilds from holds (the last
   *  Finish's text, else the hosted one), in the order they were taken. */
  toWrite(): LevelText[];
  /** A Finish wrote `written`: each text is what the next Finish builds
   *  on. */
  finished(written: readonly LevelText[]): void;
  /** A visit ended: its sightings go. */
  endVisit(): void;
  /** A tour closed: the book, the levels its Finishes wrote and the code
   *  in hand go. */
  reset(): void;
}

export function wireCreatorCodes(deps: {
  ctx: TourViewerSession;
  /** The set of code ids changed (a code measured, a draft restored):
   *  the print panel re-reads them for its numbering (follow-up F16). */
  onIdsChanged?: () => void;
}): CreatorCodes {
  const { ctx } = deps;
  const { store } = ctx;
  const doc = () => selectTourDocument(store.getState());
  const mine = () => selectCreatorCodes(store.getState());
  const book = () => documentCodes(doc());
  const hand = (): LevelText | null => mine().hand;

  /**
   * Every change of the book goes through here: the print panel hears it
   * exactly when a code joins, never for a new text of a known code (its
   * listener reruns a spelling search over the codes).
   */
  function noticingIds<T>(run: () => T): T {
    const before = new Set(book().map((c) => c.levelId));
    const result = run();
    const after = book();
    if (
      after.length !== before.size ||
      after.some((c) => !before.has(c.levelId))
    ) {
      deps.onIdsChanged?.();
    }
    return result;
  }

  function changeBook(action: UnknownAction): void {
    noticingIds(() => store.dispatch(action));
  }

  // An undo (or a redo) that took the saved text of the code in hand
  // elsewhere (a settle's step, plan M3b): the hand lets go of it - its
  // text wins at every change of the book (`withHand`), so it would put
  // the text back at the next one.
  store.listenToDocument({
    predicate: isAnyOf(tourDocumentActions.undone, tourDocumentActions.redone),
    effect: (_action, api) => {
      const was = selectTourDocument(api.getOriginalState());
      const now = selectTourDocument(api.getState());
      if (was.codes.book === now.codes.book) return;
      const levelIds = documentCodes(now).flatMap((c) =>
        codeSavedText(was, c.levelId) === c.saved ? [] : [c.levelId],
      );
      if (levelIds.length > 0) {
        api.dispatch(tourDocumentActions.handReleased({ levelIds }));
      }
    },
  });

  function references(): { levelId: string; geo: QrGeoPose | null }[] {
    const inHand = hand();
    const out: { levelId: string; geo: QrGeoPose | null }[] =
      inHand === null
        ? []
        : [{ levelId: inHand.id, geo: storedGeo(inHand.json) }];
    const listed = new Set(out.map((r) => r.levelId));
    // The book's other codes (M4e): measured or kept by this page, at the
    // pose the next Finish writes - which replaces a hosted one.
    for (const code of book()) {
      if (code.saved === null || listed.has(code.levelId)) continue;
      listed.add(code.levelId);
      out.push({ levelId: code.levelId, geo: storedGeo(code.saved) });
    }
    for (const [id, level] of hostedLevels(doc()) ?? []) {
      if (listed.has(id)) continue;
      out.push({ levelId: id, geo: level.qr.geo ?? null });
    }
    return out;
  }

  const codeOf = (levelId: string) => book().find((c) => c.levelId === levelId);

  return {
    inHand: hand,
    measurement: () => mine().handMeasurement,
    sighting: () => mine().visitSighting,
    setInHand: (level, measurement) => {
      changeBook(tourDocumentActions.codeTaken({ level, measurement }));
    },
    restoreInHand: (level) => {
      if (hand() !== null) return false;
      // Live work on the code is newer than the draft and wins, as in
      // `restoreLevels` (the M5d-2 review's #9a).
      const live = codeLiveText(doc(), level.id);
      changeBook(
        tourDocumentActions.codeTakenFromDraft({
          level: { id: level.id, json: live ?? level.json },
        }),
      );
      return true;
    },
    clearInHand: () => {
      // The code in hand is measured again (a new print size): its new
      // pose no longer counts, and its saved text falls back to the zip's.
      changeBook(
        tourDocumentActions.codeLetGo({ levelId: hand()?.id ?? null }),
      );
    },
    setSighting: (sighting) => {
      store.dispatch(creatorCodesActions.sightingSeen(sighting));
    },
    forgetSightings: (levelId) => {
      store.dispatch(creatorCodesActions.sightingsForgotten({ levelId }));
    },
    hasStoredPose: (levelId) => {
      if (hand()?.id === levelId) return true;
      const saved = codeSavedText(doc(), levelId);
      if (saved !== null && storedGeo(saved) !== null) return true;
      return hostedLevels(doc())?.get(levelId)?.qr.geo !== undefined;
    },
    savedText: (levelId) => codeSavedText(doc(), levelId),
    references,
    storedPoses: () =>
      references().flatMap((r) => (r.geo === null ? [] : [r.geo])),
    noteStoredSighting: (levelId, visit, sighting) => {
      store.dispatch(
        creatorCodesActions.storedCodeSighted({ levelId, visit, sighting }),
      );
    },
    storedSightings: () =>
      mine()
        .storedSightings.map((s) => s.seen)
        .values(),
    toWrite: () => levelsToWrite(doc()),
    notHosted: () => levelsNotHosted(doc()),
    visitCodes: (visit) => {
      const measured = book().flatMap((c) =>
        c.measurement?.visit === visit && c.saved !== null
          ? [
              {
                level: { id: c.levelId, json: c.saved },
                measurement: c.measurement,
              },
            ]
          : [],
      );
      const taken = new Set(measured.map((c) => c.level.id));
      const hosted = hostedLevelTexts(doc());
      const sighted = mine().storedSightings.flatMap(({ levelId, seen }) => {
        if (seen.visit !== visit || taken.has(levelId)) return [];
        const json = codeSavedText(doc(), levelId) ?? hosted?.get(levelId);
        return json === undefined
          ? []
          : [{ level: { id: levelId, json }, measurement: null }];
      });
      return [...measured, ...sighted];
    },
    saveLevel: (level) => {
      const held = hand();
      changeBook(
        tourDocumentActions.codeSaved({
          level,
          hand: held?.id === level.id ? level : held,
        }),
      );
    },
    applySettle: (batch, levels, what) => {
      let held = hand();
      for (const level of levels) if (held?.id === level.id) held = level;
      return noticingIds(() => batch.commit({ levels, hand: held }, what));
    },
    numbering: () => {
      const ids = [...(hostedLevels(doc())?.keys() ?? [])];
      const listed = new Set(ids);
      // A code with no saved pose is not among the references the summary
      // numbers (M5b review #6).
      for (const code of book()) {
        if (!listed.has(code.levelId) && code.saved !== null) {
          ids.push(code.levelId);
        }
      }
      return ids;
    },
    ids: () => book().map((c) => c.levelId),
    inBook: (levelId) => codeOf(levelId) !== undefined,
    dropMeasurement: (levelId) => {
      changeBook(
        tourDocumentActions.codeMeasurementDropped({ levelId, hand: hand() }),
      );
    },
    measuredIn: (levelId, visit) =>
      codeOf(levelId)?.measurement?.visit === visit,
    restoreLevels: (levels) => {
      const held = hand();
      // A code in hand this page only KEPT is no live work: the draft's
      // newer text takes the hand too, or the hand's text would win
      // straight back (PR #568 review).
      const drafted =
        held === null
          ? undefined
          : levels.filter((l) => l.id === held.id).at(-1);
      const next =
        drafted !== undefined && codeLiveText(doc(), drafted.id) === null
          ? { id: drafted.id, json: drafted.json }
          : held;
      changeBook(tourDocumentActions.codesRestored({ levels, hand: next }));
    },
    finished: (written) => {
      changeBook(tourDocumentActions.codesFinished({ written, hand: hand() }));
    },
    endVisit: () => {
      store.dispatch(creatorCodesActions.visitEnded());
    },
    reset: () => {
      // Not through `changeBook`: the print panel learns of a closed tour
      // through its own `presentNoTour`, and is not renumbered here.
      store.dispatch(tourDocumentActions.codesForgotten());
    },
  };
}
