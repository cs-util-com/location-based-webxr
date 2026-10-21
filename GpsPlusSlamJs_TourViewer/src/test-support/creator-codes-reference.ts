/**
 * TEST SUPPORT: the codes module as it was before the codes moved into the
 * store (debug-captures plan M3a), kept verbatim but for its inputs as the
 * reference model of `creator-codes-store.property.test.ts`: the closure
 * state over `code-book.ts` that every rule of the store must reproduce.
 *
 * The one owner of the codes while authoring (code book refactor plan M4a,
 * the M2 milestone review's #1): the code in hand, its measurement, the
 * visit's sighting of it, the visit's latest sighting of every stored code,
 * and the levels a Finish of this page wrote. Every creator module reads
 * and writes them through this module.
 *
 * Its API is per code wherever the callers allow (`hasStoredPose`,
 * `references`); "in hand" is the one-code view today's callers need,
 * over the code book (`code-book.ts`) holding every code. All of it is
 * private here (code book plan M5d-2): the tour's close reaches it through
 * {@link CreatorCodes.reset}.
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  afterFinish,
  codesNotHosted,
  codesToWrite,
  liveText,
  withDraft,
  withHosted,
  withMeasurement,
  withoutMeasurement,
  withReference,
  withSaved,
  type CodeBook,
  type LevelText,
} from "../code-book.js";
import type { CreatorCodes } from "../creator-codes.js";
import type { TourViewerSession } from "../tour-viewer-session.js";
import {
  storedGeo,
  type CodeMeasurement,
  type CodeSighting,
} from "../visit-settle.js";

/** A stored code's latest sighting in a visit (the visit log reads it). */
interface StoredSighting {
  readonly visit: number;
  readonly sighting: CodeSighting;
}

export function wireReferenceCodes(deps: {
  ctx: Pick<TourViewerSession, "currentLevels" | "currentLevelTexts">;
  /** The set of code ids changed (a code measured, a draft restored):
   *  the print panel re-reads them for its numbering (follow-up F16). */
  onIdsChanged?: () => void;
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
  /** The code in hand: the code taken last, ready to be written as
   *  `qr/<id>.json`; null until the mint's async identity hash landed. */
  let hand: LevelText | null = null;
  /** The hand's measurement in this page (the fused pose, the size, the AR
   *  visit), what the settle re-mints it from; null for a code taken as a
   *  stored reference, even when the book still holds an earlier visit's
   *  measurement of it (two readers do not filter by visit). */
  let handMeasurement: CodeMeasurement | null = null;
  /** The running visit's latest stable sighting of the code in hand (or
   *  of a code seen while the hand was empty): what a later visit is
   *  corrected through (D10b) and what hides the entry hint (§3.2a).
   *  Cleared at each visit's end - odometry does not carry over. */
  let visitSighting: CodeSighting | null = null;
  /**
   * Every code this page took, with its saved text, measurement and what
   * the last Finish wrote (`code-book.ts`). Written only through
   * {@link setBook}.
   */
  let book: CodeBook = new Map();

  /**
   * The one write of the book. The code in hand's text wins for its own
   * code: a change that replaced it (a draft restored over a code with no
   * live change, a dropped measurement) is undone, as the hand still
   * holds it (code book plan M5d-2, the review's #1).
   */
  function setBook(next: CodeBook): void {
    const before = book;
    book =
      hand === null || next.get(hand.id)?.saved === hand.json
        ? next
        : withReference(withSaved(next, hand), hand.id);
    if (
      book.size !== before.size ||
      [...book.keys()].some((id) => !before.has(id))
    ) {
      deps.onIdsChanged?.();
    }
  }

  /** The book with the hosted texts filled in (the Finish's baseline). */
  function withHostedTexts(): CodeBook {
    return withHosted(book, ctx.currentLevelTexts ?? new Map());
  }

  function references(): { levelId: string; geo: QrGeoPose | null }[] {
    const inHand = hand;
    const out: { levelId: string; geo: QrGeoPose | null }[] =
      inHand === null
        ? []
        : [{ levelId: inHand.id, geo: storedGeo(inHand.json) }];
    const listed = new Set(out.map((r) => r.levelId));
    // The book's other codes (M4e): measured or kept by this page, at the
    // pose the next Finish writes - which replaces a hosted one.
    for (const code of book.values()) {
      if (code.saved === null || listed.has(code.levelId)) continue;
      listed.add(code.levelId);
      out.push({ levelId: code.levelId, geo: storedGeo(code.saved) });
    }
    for (const [id, level] of ctx.currentLevels ?? []) {
      if (listed.has(id)) continue;
      out.push({ levelId: id, geo: level.qr.geo ?? null });
    }
    return out;
  }

  return {
    inHand: () => hand,
    measurement: () => handMeasurement,
    sighting: () => visitSighting,
    setInHand: (level, measurement) => {
      hand = level;
      handMeasurement = measurement;
      if (level === null) return;
      setBook(
        measurement === null
          ? withReference(withSaved(book, level), level.id)
          : withMeasurement(book, level, measurement),
      );
    },
    restoreInHand: (level) => {
      if (hand !== null) return false;
      // Live work on the code is newer than the draft and wins, as in
      // `restoreLevels` (the M5d-2 review's #9a).
      const live = liveText(book, level.id, ctx.currentLevelTexts ?? undefined);
      hand = { id: level.id, json: live ?? level.json };
      setBook(withReference(withSaved(book, hand), hand.id));
      return true;
    },
    clearInHand: () => {
      // The code in hand is measured again (a new print size): its new
      // pose no longer counts, and its saved text falls back to the zip's.
      const id = hand?.id;
      hand = null;
      handMeasurement = null;
      if (id !== undefined) setBook(withoutMeasurement(book, id));
    },
    setSighting: (sighting) => {
      visitSighting = sighting;
    },
    forgetSightings: (levelId) => {
      storedCodeSightings.delete(levelId);
      if (visitSighting?.levelId === levelId) visitSighting = null;
    },
    hasStoredPose: (levelId) => {
      if (hand?.id === levelId) return true;
      const saved = book.get(levelId)?.saved ?? null;
      if (saved !== null && storedGeo(saved) !== null) return true;
      return ctx.currentLevels?.get(levelId)?.qr.geo !== undefined;
    },
    savedText: (levelId) => book.get(levelId)?.saved ?? null,
    references,
    storedPoses: () =>
      references().flatMap((r) => (r.geo === null ? [] : [r.geo])),
    noteStoredSighting: (levelId, visit, sighting) => {
      storedCodeSightings.set(levelId, { visit, sighting });
    },
    storedSightings: () => storedCodeSightings.values(),
    toWrite: () => codesToWrite(withHostedTexts()),
    notHosted: () => codesNotHosted(withHostedTexts()),
    visitCodes: (visit) => {
      const measured = [...book.values()].flatMap((c) =>
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
      const sighted = [...storedCodeSightings].flatMap(([id, seen]) => {
        if (seen.visit !== visit || taken.has(id)) return [];
        const json = book.get(id)?.saved ?? ctx.currentLevelTexts?.get(id);
        return json === undefined || json === null
          ? []
          : [{ level: { id, json }, measurement: null }];
      });
      return [...measured, ...sighted];
    },
    saveLevel: (level) => {
      if (hand?.id === level.id) hand = level;
      setBook(withSaved(book, level));
    },
    // Added for the settle as one step (plan M3b): its codes as one change
    // of the book - the same rule as `saveLevel` per code, the hand taking
    // a code's new text only if it held that code, heard once. The step,
    // its moves and its undo are the document's, which this model does not
    // hold: the batch is not committed here.
    applySettle: (_batch, levels) => {
      let next = book;
      for (const level of levels) {
        if (hand?.id === level.id) hand = level;
        next = withSaved(next, level);
      }
      setBook(next);
      return null;
    },
    numbering: () => {
      const ids = [...(ctx.currentLevels?.keys() ?? [])];
      const listed = new Set(ids);
      // A code with no saved pose is not among the references the summary
      // numbers (M5b review #6).
      for (const [id, code] of book) {
        if (!listed.has(id) && code.saved !== null) ids.push(id);
      }
      return ids;
    },
    ids: () => [...book.keys()],
    inBook: (levelId) => book.has(levelId),
    dropMeasurement: (levelId) => {
      setBook(withoutMeasurement(book, levelId));
    },
    measuredIn: (levelId, visit) =>
      book.get(levelId)?.measurement?.visit === visit,
    restoreLevels: (levels) => {
      const hosted = ctx.currentLevelTexts ?? undefined;
      // A code in hand this page only KEPT is no live work: the draft's
      // newer text takes the hand too, or `setBook` would put the kept
      // text straight back (PR #568 review).
      const drafted =
        hand === null
          ? undefined
          : levels.filter((l) => l.id === hand?.id).at(-1);
      if (
        drafted !== undefined &&
        liveText(book, drafted.id, hosted) === null
      ) {
        hand = { id: drafted.id, json: drafted.json };
      }
      setBook(withDraft(book, levels, hosted));
    },
    finished: (written) => {
      setBook(afterFinish(withHostedTexts(), written));
    },
    endVisit: () => {
      storedCodeSightings.clear();
      visitSighting = null;
    },
    reset: () => {
      // The visit's sightings are left to the visit's end, as before: a
      // tour cannot close inside a visit (scan-to-open never switches
      // tours, and the open controls sit outside the AR overlay).
      hand = null;
      handMeasurement = null;
      book = new Map();
    },
  };
}
