/**
 * The creator's on-device draft (code book refactor plan M2, split out of
 * `creator-setup.ts` unchanged): the crash-safe copy of a tour's authoring
 * work - its namespace, the ordered writes, the rejections, the offer and
 * its three answers, and the move prompt's remembered answers that every
 * meta write re-states.
 *
 * @see creator-draft.ts.md
 */

import { qrLevelIdFromEntryName } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import { AUTHOR_DEFAULT_SIZE_M } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import {
  draftDeletionsNotYetHosted,
  draftHasUnhostedLevel,
  draftLevels,
  draftIsSpent,
  draftKeyForTour,
  draftObjectsNotYetHosted,
  restoredText,
  restoreOfferText,
} from "./authoring-draft.js";
import {
  readDraft,
  removeDraftObject,
  writeDraftDeletion,
  writeDraftMeta,
  writeDraftObject,
  writeDraftVisit,
} from "./draft-persistence.js";
import type { CreatorCodes } from "./creator-codes.js";
import { createKeyedChain } from "./keyed-chain.js";
import { upsertPlaced } from "./object-editing.js";
import type { TourSession } from "./tour-session.js";
import type { TourViewerSession } from "./tour-viewer-session.js";
import type { VisitLog, VisitLogEntry } from "./visit-log.js";
import type { Wizard } from "./wizard.js";

/** The elements the draft reads and owns: the printed-size field (written
 *  to the meta, restored from it) and the offer in step 4. */
export interface CreatorDraftDom {
  sizeInput: HTMLInputElement;
  draftOffer: HTMLElement;
  draftOfferText: HTMLElement;
  draftRestore: HTMLButtonElement;
  draftDismiss: HTMLButtonElement;
  draftDiscard: HTMLButtonElement;
}

export interface CreatorDraft {
  /** A tour opened and its manifest settled: open its draft namespace,
   *  then offer what is not hosted yet, sweep a spent draft, or start one. */
  present(tourUrl: string): void;
  /** A tour closed: its offer, namespace, rejections and answers go. */
  reset(): void;
  /** Rewrite the open tour's meta (tour, printed size, measured level,
   *  rejections, move answers). True with no tour open: nothing to write. */
  saveMeta(): Promise<boolean>;
  /** Record something placed, fire-and-forget. */
  recordPlacement(object: TourObject, blob?: Blob): void;
  /** Record one AR visit's log entry, in memory and in the draft. */
  recordVisit(entry: VisitLogEntry): void;
  /** One awaited write for object `id` (the object list's actions). */
  write(
    id: string,
    write: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean>;
  /** Remove object `id`'s draft files, after any write queued for it. */
  forgetObject(id: string): Promise<void>;
  /** Say, once, that this device keeps no backup copy. */
  warnNoBackup(): void;
  /** False once the creator was told no backup is kept. */
  persists(): boolean;
}

/**
 * What the HOSTED zip currently stores for `levelId`, or null.
 *
 * The CONTENT, not just the presence of the id: a level's id is a hash of
 * the printed TEXT, so re-measuring the same poster writes a new
 * measurement under the same id. "The zip has a level with this id" is
 * therefore not evidence that it has THIS measurement, and deleting a
 * draft on that basis would throw away a re-measure - the most expensive
 * thing a creator does.
 */
export async function hostedLevelJson(
  session: TourSession | null,
  levelId: string,
): Promise<string | null> {
  if (session === null) return null;
  const entry = session.entries.find(
    (e) => qrLevelIdFromEntryName(e.filename) === levelId,
  );
  if (entry === undefined) return null;
  try {
    // Under the text cap, like every JSON the session reads (K0
    // milestone review R10): a level file is text on the JS heap.
    return await session.loadEntryText(entry.filename);
  } catch {
    // Unreadable is not proof of anything, and the safe direction is to
    // KEEP the draft.
    return null;
  }
}

export function wireCreatorDraft(deps: {
  ctx: TourViewerSession;
  dom: CreatorDraftDom;
  /** Opens a tour's draft namespace, or resolves undefined where there is
   *  no persistence (no OPFS, blocked site data, a quota wall). */
  openDraftStore: (key: string) => Promise<DraftFileStore | undefined>;
  /** The page-side visit log (`creator-setup.ts` owns it). */
  visitLog: VisitLog;
  /** The code in hand: written to the meta, restored from it. */
  codes: Pick<
    CreatorCodes,
    "inHand" | "restoreInHand" | "restoreLevels" | "notHosted"
  >;
  wizard: Pick<Wizard, "revealStep">;
  sessionLive: () => boolean;
  /** Render the placed objects (a restore brings some back). */
  syncPreviews: () => void;
  /** Re-render the creator readout (a note changed). */
  render: () => void;
}): CreatorDraft {
  const { ctx, dom } = deps;
  /** This tour's draft store, once a tour is open. */
  let draftStore: DraftFileStore | undefined;
  /**
   * The ids this tour's meta records as rejected, carried so that EVERY
   * meta write re-states them.
   *
   * A write that dropped the list would un-reject a draft whose files are
   * still on disk, which is the resurrection this design exists to
   * prevent. Set from the read (already pruned to ids that still have
   * files), reset when the tour closes, and never shared between tours.
   */
  let draftRejected: readonly string[] = [];
  /**
   * The draft's writes, queued so that each lands after the ones issued
   * before it: one queue per tour's META, one per OBJECT ID within a tour
   * (an id's record, photo and tombstone move together). Keys from
   * {@link metaChainKey} and {@link objectChainKey}.
   *
   * The meta: every write for a tour targets one key in one directory, and
   * the mint and finish ones are unawaited - so an earlier write landing
   * later would overwrite a newer one, including a rejection or a measured
   * level (PR #456 review).
   *
   * An object: a placement's write is unawaited too, so without the queue a
   * quick delete of it could land first and the placement come back on the
   * next open (M4 review #7; the M2c review's filed #7). Queued per id, an
   * operation that takes several steps - a claim of a rejected id, then
   * the write (see `writeForObject`) - is also never interleaved with
   * another operation on the same id.
   *
   * KEYED BY THE NAMESPACE KEY, not by the raw url - `draftKeyForTour`
   * trims, so two urls differing only in surrounding whitespace share one
   * directory and one meta key. Keyed by the raw url they would get two
   * independent chains, which is the same clobber through another door,
   * and it is reachable: the paste paths trim before opening, but the
   * `?qr=` boot passes the decoded payload through untouched, and that is
   * external data (PR #460 review). That makes
   * both properties structural rather than remembered: a tour that stalls
   * blocks only itself, and the ordering survives any interleaving of
   * opens. Two earlier shapes each held only half of that - one chain per
   * session blocked every tour behind a stall, and one chain plus "the
   * last tour seen" lost the ordering for A after B was opened in between
   * (PR #457 and #459 reviews).
   *
   * A key is dropped once its queue drains, so this holds only work in
   * flight.
   */
  const draftWrites = createKeyedChain();

  function metaChainKey(tourUrl: string): string {
    return JSON.stringify(["meta", draftKeyForTour(tourUrl)]);
  }
  function objectChainKey(tourUrl: string, id: string): string {
    return JSON.stringify(["object", draftKeyForTour(tourUrl), id]);
  }

  /** The creator-facing url of the open tour, for later draft writes. */
  let draftTourUrl: string | null = null;
  /** What a draft is offering, until the creator answers. */
  let offered: {
    objects: readonly TourObject[];
    /** EVERY id the READ saw on disk - not just the unhosted ones the
     *  offer shows, and not just the ones that parsed. Rejecting a draft
     *  deletes what was there: objects the hosted zip already carries
     *  (filtered out of the offer but still files), and records `readDraft`
     *  refused - an older version's shape, or a photo whose bytes never
     *  landed. `clear` used to sweep those and nothing else does now. */
    storedIds: readonly string[];
    photos: ReadonlyMap<string, Blob>;
    /** The measured level and the size it was measured at - the other
     *  half of a lost walk, and what makes Finish reachable again. */
    level: { id: string; json: string } | null;
    /** Every code of the draft (M4c-1), `level` among them. */
    levels: readonly { id: string; json: string }[];
    sizeM: number;
    /** The deletions the hosted zip still carries (tombstones, plan
     *  §3.4, M4). */
    deleted: readonly string[];
    /** How `objects` splits into new placements and changes of objects
     *  the hosted zip carries - the offer's and the restore's words. */
    counts: { placed: number; changed: number };
    /** The draft's AR visits (M3b), for the summary after Finish. */
    visits: readonly VisitLogEntry[];
  } | null = null;
  /** Said once, not per placement: a creator mid-walk cannot act on it. */
  let warnedAboutPersistence = false;

  /** Say once that the walk is not being backed up. A creator mid-session
   *  cannot act on it more often than that, and repeating it would push
   *  the measuring readout off the line. */
  function noteNoPersistence(): void {
    if (warnedAboutPersistence) return;
    warnedAboutPersistence = true;
    ctx.placementNote =
      "This device is not saving a backup copy - finish and download before closing the page.";
    deps.render();
  }

  /**
   * Record something placed. Fire-and-forget on purpose: the placement
   * already happened in memory, and the draft is a safety net - a storage
   * problem must never fail the tap that made it.
   */
  function recordPlacement(object: TourObject, blob?: Blob): void {
    const store = draftStore;
    const tourUrl = draftTourUrl;
    if (store === undefined || tourUrl === null) {
      // No draft namespace YET - no tour open, or its draft still opening -
      // is not a storage failure: the draft writes these when it opens
      // (scan-to-open plan §9 #5). Only an opened namespace without a store
      // is one.
      if (draftTourUrl !== null) noteNoPersistence();
      return;
    }
    void writeForObject(store, tourUrl, object.id, (s) =>
      writeDraftObject(s, object, blob),
    ).then((ok) => {
      if (!ok) noteNoPersistence();
    });
  }

  /**
   * Record one AR visit's log (M3b) in memory and in the draft, the way a
   * placement is recorded: fire-and-forget, in the id's queue, and before
   * the tour's draft is open it is written when it opens.
   */
  function recordVisit(entry: VisitLogEntry): void {
    deps.visitLog.record(entry);
    const store = draftStore;
    const tourUrl = draftTourUrl;
    if (store === undefined || tourUrl === null) {
      if (draftTourUrl !== null) noteNoPersistence();
      return;
    }
    writeVisit(store, tourUrl, entry);
  }

  function writeVisit(
    store: DraftFileStore,
    tourUrl: string,
    entry: VisitLogEntry,
  ): void {
    void writeForObject(store, tourUrl, entry.visitId, (s) =>
      writeDraftVisit(s, entry),
    ).then((ok) => {
      if (!ok) noteNoPersistence();
    });
  }

  /**
   * Write something FOR object `id` - its record and bytes, or its
   * tombstone - in that id's queue, and only once the meta no longer
   * rejects the id (M4 review #1).
   *
   * THE META OUTRANKS AN OBJECT'S FILES (`readDraft`), so a change to an
   * id the meta rejects - a published tour reopened and its spent draft
   * swept, or "Delete it" - was hidden by the next read and swept by the
   * next open: the edit lost, or the deleted object back at the next
   * Finish. A change made now is newer than that rejection, so the id is
   * CLAIMED first, in this order, each step awaited:
   *   1. the rejected files are removed - once the meta stops rejecting
   *      the id, a stale file of the rejected draft must not be there to
   *      come back if the tab dies before step 3;
   *   2. the meta is rewritten without the id;
   *   3. the change is written.
   * A crash between any two steps leaves either the rejection or nothing
   * for the id, never the rejected draft's version. A refused meta write
   * still lets the change be written - it is newer than anything on disk -
   * and reports false, so the creator hears it is not backed up.
   *
   * Only while `store` is still the open tour's: `draftRejected` is that
   * tour's list.
   */
  function writeForObject(
    store: DraftFileStore,
    tourUrl: string,
    id: string,
    write: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    return draftWrites.run(objectChainKey(tourUrl, id), async () => {
      let claimed = true;
      if (draftStore === store && draftRejected.includes(id)) {
        await removeDraftObject(store, id);
        draftRejected = draftRejected.filter((rejected) => rejected !== id);
        claimed = await recordMeta(tourUrl);
      }
      const wrote = await write(store);
      return claimed && wrote;
    });
  }

  /**
   * Remove a rejected id's files (a discard, a spent draft, an unfinished
   * earlier sweep) in that id's queue - and only if it is STILL rejected
   * when its turn comes: a change made since claimed it, and the file on
   * disk is that change now (`writeForObject`). Skipped too once another
   * tour is open: the next open of this one sweeps what the meta rejects.
   */
  function sweepRejected(
    store: DraftFileStore,
    tourUrl: string,
    id: string,
  ): void {
    void draftWrites.run(objectChainKey(tourUrl, id), async () => {
      if (draftStore === store && draftRejected.includes(id)) {
        await removeDraftObject(store, id);
      }
    });
  }

  /**
   * `ids` minus those the creator changed or deleted in this page (M4):
   * an edit of a hosted object keeps its id, so its file on disk is the
   * live change's now, and a sweep of an older draft must not take it.
   */
  function notLive(ids: readonly string[]): string[] {
    const live = new Set([
      ...ctx.placedObjects.map((p) => p.object.id),
      ...ctx.deletedObjectIds,
      // This page's visits (M3b): a read racing their first write may list
      // them, and they are this page's work, never the old draft's.
      ...deps.visitLog.ids(),
    ]);
    return ids.filter((id) => !live.has(id));
  }

  /**
   * One draft write for the object list's actions (authoring plan
   * 2026-09-28-0953 §3.4, M4), AWAITED: the row shows its in-progress state
   * until this settles and then says whether the change reached the draft.
   * Before the tour's draft namespace exists there is nothing to write yet
   * and nothing failed - `presentDraftForTour` writes what was made
   * meanwhile - so that reads as landed.
   */
  function draftWrite(
    id: string,
    write: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    const store = draftStore;
    const tourUrl = draftTourUrl;
    if (tourUrl === null) return Promise.resolve(true);
    if (store === undefined) {
      noteNoPersistence();
      return Promise.resolve(false);
    }
    return writeForObject(store, tourUrl, id, write).catch(() => false);
  }

  /**
   * Record the tour, the printed size and the measured level.
   *
   * @param tourUrl the CREATOR-FACING url, which is what the store is keyed
   *   by. `ctx.session.archive.url` is normalised - for a Drive tour it is
   *   the proxy route - so writing that here would make the field disagree
   *   with the key and with its own documentation.
   */
  function recordMeta(tourUrl: string): Promise<boolean> {
    const store = draftStore;
    if (store === undefined) return Promise.resolve(false);
    // The size comes from the FIELD, not from `ctx.activeSizeM`: that is
    // only assigned at AR entry, so before the first session it still holds
    // the previous tour's value.
    const sizeM = Number(dom.sizeInput.value);
    const meta = {
      tourUrl,
      sizeM:
        Number.isFinite(sizeM) && sizeM > 0 ? sizeM : AUTHOR_DEFAULT_SIZE_M,
      level: deps.codes.inHand(),
      // Every code the hosted zip does not hold yet (M4c-1), the code in
      // hand among them; `level` stays for an older build reading this.
      levels: deps.codes.notHosted(),
      // Re-stated on every write, not only on the discard's: this file is
      // rewritten on each mint, each finish and each tour open, and one
      // that omitted the list would hand a rejected draft back on the next
      // read. (NOT on each placement - `recordPlacement` writes the object
      // file only and never reaches here; PR #456 review.)
      rejected: draftRejected,
    };
    // Values captured NOW, write ordered by call within this tour. The
    // chain keeps one refused write from breaking the queue behind it.
    return draftWrites.run(metaChainKey(tourUrl), () =>
      writeDraftMeta(store, meta),
    );
  }

  /** Put a restored draft's objects and deletions back into the lists
   *  a live placement fills (see the restore below). */
  function restoreWork(waiting: NonNullable<typeof offered>): void {
    // Live work on the same id is newer than the draft's, and wins.
    const live = new Set([
      ...ctx.placedObjects.map((p) => p.object.id),
      ...ctx.deletedObjectIds,
    ]);
    for (const object of waiting.objects) {
      if (live.has(object.id)) continue;
      const blob = waiting.photos.get(object.id);
      ctx.placedObjects = upsertPlaced(
        ctx.placedObjects,
        blob === undefined ? { object } : { object, blob },
      );
    }
    // The deletions come back as the tombstones they are (plan §3.4).
    for (const id of waiting.deleted) {
      if (!live.has(id)) ctx.deletedObjectIds = [...ctx.deletedObjectIds, id];
    }
  }

  dom.draftRestore.addEventListener("click", () => {
    const waiting = offered;
    dom.draftOffer.hidden = true;
    offered = null;
    if (waiting === null) return;
    // Into the SAME list a live placement fills, so the finish needs no
    // second path: it writes these into the manifest exactly as it writes
    // anything else (an edit of a hosted object replaces it by id), and
    // the photo bytes as content entries. Live work on the same id is
    // newer than the draft's, and wins.
    restoreWork(waiting);
    // And the visits it measured (M3b): the summary after Finish combines
    // them with this page's.
    deps.visitLog.restore(waiting.visits);
    // The measured level comes back too, and it is what unlocks Finish
    // without walking to the poster again. Only when the session has not
    // already measured one: a live measurement is newer than a draft.
    // Every code it kept (M4c-1), in the draft's order: saved, so the next
    // Finish writes them; live work on a code is newer and wins.
    deps.codes.restoreLevels(waiting.levels);
    if (waiting.level !== null) deps.codes.restoreInHand(waiting.level);
    // And the printed size, which the page rewrites from the framework
    // default on every load - so without this a re-entry would solve
    // against 16 cm for a poster printed at 20.
    if (Number.isFinite(waiting.sizeM) && waiting.sizeM > 0) {
      dom.sizeInput.value = String(waiting.sizeM);
      ctx.activeSizeM = waiting.sizeM;
    }
    // Render them, or the readout says "5 objects placed" over an empty
    // scene and the creator places them again - new ids, real duplicates
    // at the same spot in the published zip. The sync guards against a
    // dead scene, so this is safe outside a session too.
    deps.syncPreviews();
    ctx.placementNote = restoredText(
      waiting.counts.placed,
      waiting.level !== null,
      {
        changed: waiting.counts.changed,
        deleted: waiting.deleted.length,
        visits: waiting.visits.length,
      },
    );
    deps.render();
  });

  dom.draftDismiss.addEventListener("click", () => {
    // Declining is NOT deleting: a mis-tap must not become the loss this
    // whole feature exists to prevent. It is offered again next time.
    dom.draftOffer.hidden = true;
    offered = null;
  });

  dom.draftDiscard.addEventListener("click", () => {
    dom.draftOffer.hidden = true;
    // Captured BEFORE the offer is dropped: this is the list of what the
    // creator is rejecting, and it is the only thing that gets deleted.
    // Minus the ids changed live since (`notLive`, M4).
    const rejectedIds = notLive(offered?.storedIds ?? []);
    offered = null;
    const store = draftStore;
    if (store === undefined) return;
    // The one way a creator can throw a draft away deliberately - and the
    // escape hatch for a draft that would otherwise be offered forever.
    //
    // DELETE WHAT WAS REJECTED, and nothing else.
    //
    // This used to empty the whole namespace and then write back the meta
    // and every placement still live. That shape - delete everything, then
    // restore what should have stayed - is what produced FOUR silent
    // data-loss defects in this feature, because `clear` cannot tell the
    // rejected draft's files from ones written seconds earlier by a
    // creator who left the offer on screen and carried on working. Each
    // fix restored a little more, and each left a window in which the
    // survivors existed only in memory: a reload there lost them.
    //
    // There is no window now. The ids come from the offer, which is what
    // `readDraft` returned, so nothing this session wrote is ever a
    // candidate for deletion and nothing has to be put back.
    //
    // The meta is REWRITTEN rather than deleted, which also drops the
    // rejected level: `recordMeta` writes `ctx.mintedLevel`, so a creator
    // who measured before tapping keeps THIS session's measurement. That
    // is deliberate - "Delete it" rejects the OLD draft, not work done
    // afterwards - and it converges, because a later discard runs with no
    // minted level and writes a spent meta.
    //
    // THAT WRITE IS THE COMMIT POINT. It now carries the rejected ids, so
    // the next read refuses them whether or not their files are still
    // there, and the deletes below are housekeeping: they may fail, be
    // interrupted by the tab closing, or never run, and the draft stays
    // gone. Nothing is removed BEFORE the write lands, so the wait costs
    // nothing in the other direction either - a reload during it sees the
    // draft exactly as it was.
    const tourUrl = draftTourUrl;
    // Assigned together with `draftStore` and cleared with it, so this is
    // unreachable in practice. Returning rather than deleting is still the
    // right branch: with no meta write there is no commit point, and
    // deleting without one is the shape that lost work four times.
    if (tourUrl === null) return;
    // Assigned BEFORE the call, not after: a mint or finish issued in the
    // same tick must carry the rejection too, or its write would drop it.
    const wasRejected = draftRejected;
    draftRejected = rejectedIds;
    // ENQUEUED synchronously, with the values captured at the tap. The
    // chain guarantees ordering, not immediacy: the `put` itself is issued
    // from a `then`, so it is a microtask away at best (PR #457 review).
    const committed = recordMeta(tourUrl);
    void (async () => {
      if (!(await committed)) {
        // The rejection is not on disk, so it must not stay in memory: a
        // later mint or finish would write it and commit a discard this
        // branch is about to report as failed. Guarded on the tour still
        // being open, since a tour change has already reset the list from
        // its own read (PR #456 review).
        //
        // The second write is what covers a payload ALREADY queued behind
        // this one: that copied the list at its own call, so restoring the
        // variable cannot unbake it. Queued last, it lands last and puts
        // the old list back. Best-effort by nature - the store that just
        // refused may refuse this too - which is why the note below is not
        // conditional on it (PR #457 review).
        if (draftStore === store && draftTourUrl === tourUrl) {
          draftRejected = wasRejected;
          void recordMeta(tourUrl);
        }
        // ITS OWN NOTE, AND UNGATED. The first version of this branch
        // called `noteNoPersistence`, which is wrong twice over
        // (PR #456 review):
        //
        // - it fires ONCE per wiring. A quota wall is rarely a one-off, so
        //   an earlier failed placement burns the flag, the next pin tap
        //   clears the note from screen, and this branch then says
        //   NOTHING - which is exactly the silence it was added to close.
        // - its wording is about backups, not about the thing the creator
        //   just asked for. "Not saving a backup copy" does not tell them
        //   the draft they tapped Delete on is still there.
        //
        // A tap the creator made deserves an answer about that tap, every
        // time it fails.
        ctx.placementNote =
          "Could not delete the saved draft - it is still there, and will be offered again next time.";
        deps.render();
        return;
      }
      for (const id of rejectedIds) sweepRejected(store, tourUrl, id);
    })();
  });

  function present(tourUrl: string): void {
    // EVERY continuation below re-checks this. Without it, tour A's draft
    // resumes after the creator has opened tour B and then: writes B's
    // placements into A's namespace, offers A's objects for B's zip, and
    // deletes whichever namespace `draftStore` happens to point at. All
    // three are the data loss this milestone exists to prevent, and the
    // open path already guards every other continuation this way.
    const generation = ctx.openGeneration;
    const stale = (): boolean => generation !== ctx.openGeneration;
    void (async () => {
      const store = await deps.openDraftStore(draftKeyForTour(tourUrl));
      if (stale()) return;
      draftStore = store;
      draftTourUrl = tourUrl;
      if (store === undefined) {
        // No persistence at all - a browser without OPFS, blocked site
        // data, a quota wall. The creator must hear it ONCE, here: this
        // is the path where they are least protected and least likely to
        // notice, because no write ever fails to tell them so.
        noteNoPersistence();
        return;
      }
      const stored = await readDraft(store);
      if (stale()) return;
      // Per-tour state: never carry the previous tour's rejections into
      // this one's meta.
      draftRejected = stored?.rejectedIds ?? [];
      // Deletes that did not finish last time. `rejectedIds` is exactly
      // the ids the meta rejects whose files are still on disk, so this
      // is the only thing that reclaims them - and it is safe to repeat,
      // because removing a key that is not there is not a failure.
      for (const id of draftRejected) sweepRejected(store, tourUrl, id);
      // Work made before this draft opened - with no tour open, or while
      // the manifest settled - was never written (scan-to-open plan §9
      // #5). AFTER the read on purpose: every branch below deletes only
      // what the read returned, so these cannot be swept as a spent or
      // rejected draft's.
      //
      // ALL of it, not only ids the draft has no file for: an edit or a
      // deletion of a hosted object keeps its id, so the draft may hold an
      // OLDER change of it, and skipping the id left that older change on
      // disk for a crash to bring back (M4 review #2). The live change is
      // newer than anything the read saw, and each write is queued behind
      // the sweep above for its id and claims it from the rejected list
      // first (`writeForObject`).
      for (const entry of ctx.placedObjects) {
        recordPlacement(entry.object, entry.blob);
      }
      // And this page's visits (M3b), for the same reason.
      for (const entry of deps.visitLog.entries()) {
        writeVisit(store, tourUrl, entry);
      }
      for (const id of ctx.deletedObjectIds) {
        void writeForObject(store, tourUrl, id, (s) =>
          writeDraftDeletion(s, id),
        ).then((ok) => {
          if (!ok) noteNoPersistence();
        });
      }
      if (stored === undefined) {
        // No draft yet, but there will be: record what is already known,
        // so a crash before the first placement still leaves the tour and
        // the printed size behind.
        void recordMeta(tourUrl);
        return;
      }
      const waiting = draftObjectsNotYetHosted(stored.draft, ctx.tourManifest);
      const waitingDeletions = draftDeletionsNotYetHosted(
        stored.draft,
        ctx.tourManifest,
      );
      // What the hosted zip stores for each of the draft's codes (M4c-1):
      // the content, read one by one like the one level was.
      const hostedTexts = new Map<string, string | null>();
      for (const level of draftLevels(stored.draft)) {
        hostedTexts.set(level.id, await hostedLevelJson(ctx.session, level.id));
      }
      const hostedLevel = (id: string): string | null =>
        hostedTexts.get(id) ?? null;
      if (stale()) return;
      if (
        draftIsSpent(
          stored.draft,
          ctx.tourManifest,
          hostedLevel,
          stored.visits.length,
        )
      ) {
        // SPENT: the hosted zip carries every object AND the measurement,
        // and the draft holds no AR visit (the zip never carries those,
        // M3a/M3b review #5). That is the only proof the content reached
        // the file the world sees, and the only thing that deletes a
        // draft.
        // No re-open. It existed only because `clear` used to remove the
        // namespace directory and invalidate this handle; the store now
        // empties in place and stays usable. Re-opening would carry the
        // same failure forward: `openDraftStore` returns undefined on any
        // transient refusal, and assigning that over a WORKING store turns
        // persistence off for the rest of the tour, silently (PR #443
        // review).
        // Same rule as the discard: delete exactly what `readDraft`
        // returned. A spent draft is one the hosted zip already carries
        // in full, so every id here is safe to drop - and anything this
        // session placed during the awaits above is not in that list and
        // is therefore never touched. That reachability is not
        // hypothetical: `draftStore` is assigned BEFORE those awaits and
        // `hostedLevelJson` reads a zip entry, which is a network round
        // trip for a remote archive, while neither the mint button nor
        // `placementAllowed()` waits for the chain to settle.
        // `storedIds`, not `draft.objects`: the latter is what parsed,
        // and a record this read refused still has files. Nothing
        // reclaims those since `clear` lost its last caller.
        // Minus what the creator changed or deleted during the awaits
        // above (M4): an edit of a hosted object keeps its id, so unlike a
        // new placement it CAN be in this list, and its file is now the
        // live change's.
        const sweep = notLive(stored.storedIds);
        draftRejected = sweep;
        // Same commit point as the discard, for the same reason: an
        // interrupted sweep must not bring a spent draft back - and the
        // same notice when it does not land.
        if (!(await recordMeta(tourUrl))) {
          noteNoPersistence();
          return;
        }
        if (stale()) return;
        for (const id of sweep) sweepRejected(store, tourUrl, id);
        return;
      }
      const hasLevel = draftHasUnhostedLevel(stored.draft, hostedLevel);
      // New placements, and changes of objects the hosted zip carries.
      const hostedIds = new Set(
        (ctx.tourManifest?.objects ?? []).map((o) => o.id),
      );
      const changed = waiting.filter((o) => hostedIds.has(o.id)).length;
      const counts = { placed: waiting.length - changed, changed };
      // A level measured before this open is newer than the offered
      // draft's and would otherwise live only in memory; a mint after the
      // open would write it the same way.
      if (deps.codes.inHand() !== null) void recordMeta(tourUrl);
      offered = {
        objects: waiting,
        storedIds: stored.storedIds,
        photos: stored.photos,
        // ALWAYS handed back when the draft has one, even if the hosted
        // zip already stores the same measurement: the finish refuses to
        // run without `mintedLevel`, so withholding it would leave a
        // creator with restorable objects and no way to publish them.
        // `hasLevel` only decides the WORDS and whether the draft counts
        // as spent.
        level: stored.draft.level,
        levels: draftLevels(stored.draft),
        sizeM: stored.draft.sizeM,
        deleted: waitingDeletions,
        counts,
        visits: stored.visits,
      };
      dom.draftOfferText.textContent = restoreOfferText(
        counts.placed,
        hasLevel,
        {
          changed: counts.changed,
          deleted: waitingDeletions.length,
          visits: stored.visits.length,
        },
      );
      dom.draftOffer.hidden = false;
      // The offer is outside the AR overlay, so a creator whose scan
      // opened the tour mid-session would not see it and would place the
      // same content again (milestone review #4).
      if (deps.sessionLive()) {
        ctx.placementNote =
          "Unsaved work for this tour is on this device - restore it after leaving AR.";
        deps.render();
      }
      // The offer lives inside step 4, which is usually COLLAPSED when a
      // tour opens (the wizard lands on the remembered step, or step 2).
      // Un-hiding an element inside a closed disclosure is zero pixels
      // and no signal, so the step is revealed - without collapsing
      // whatever the creator was reading.
      deps.wizard.revealStep("measure");
    })();
  }

  return {
    present,
    reset: () => {
      dom.draftOffer.hidden = true;
      offered = null;
      draftStore = undefined;
      draftTourUrl = null;
      draftRejected = [];
    },
    saveMeta: () =>
      draftTourUrl === null ? Promise.resolve(true) : recordMeta(draftTourUrl),
    recordPlacement,
    recordVisit,
    write: draftWrite,
    forgetObject: (id) => {
      const store = draftStore;
      const tourUrl = draftTourUrl;
      if (store === undefined || tourUrl === null) return Promise.resolve();
      // In the id's queue: a placement's write still in flight lands first,
      // and this removal after it (M4 review #7).
      return draftWrites.run(objectChainKey(tourUrl, id), () =>
        removeDraftObject(store, id),
      );
    },
    warnNoBackup: noteNoPersistence,
    persists: () => !warnedAboutPersistence,
  };
}
