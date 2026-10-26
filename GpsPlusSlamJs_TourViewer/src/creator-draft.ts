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
import { readSideM, writeSideM } from "./printed-side.js";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import {
  draftDeletionsNotYetHosted,
  draftHasUnhostedLevel,
  draftLevels,
  draftIsSpent,
  draftKeyForTour,
  draftObjectsNotYetHosted,
  draftObjectsPublished,
  draftObjectsSuperseded,
  hostedObjects,
  manifestAsRead,
  restoredText,
  supersededLine,
  restoreOfferText,
} from "./authoring-draft.js";
import {
  META_KEY,
  photoKey,
  readDraft,
  readDraftCodes,
  removeDraftObject,
  addDraftBaseKey,
  writeDraftCodes,
  writeDraftDeletion,
  writeDraftLiveRecord,
  writeDraftMeta,
  writeDraftVisit,
  type DraftCodes,
} from "./draft-persistence.js";
import type { CreatorCodes } from "./creator-codes.js";
import { createKeyedChain } from "./keyed-chain.js";
import {
  createdStationFrames,
  type StationFrame,
  type StationPose,
} from "./tour-document.js";
import {
  changedStations,
  parseSettingsRecord,
  settingsRecord,
  settingsRecordText,
  SETTINGS_KEY,
  type TourCodesRecord,
  type TourSettingsRecord,
} from "./tour-document-draft.js";
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
  /** Rewrite the open tour's meta (tour, printed size, rejections). True
   *  with no tour open: nothing to write. */
  saveMeta(): Promise<boolean>;
  /** Write the draft's codes record (`tour-document-draft.ts`, plan M3b:
   *  the code in hand and the codes the hosted zip does not hold yet), in
   *  its own queue, the waiting draft's codes re-stated after it. True
   *  with no tour's draft open yet (`present` writes them then). */
  saveCodes(codes: TourCodesRecord): Promise<boolean>;
  /** Record something placed, fire-and-forget. */
  recordPlacement(object: TourObject, blob?: Blob): void;
  /** Record one AR visit's log entry, in memory and in the draft. */
  recordVisit(entry: VisitLogEntry): void;
  /** One awaited write of an object's record, with its base (M6 E2p):
   *  the object list's edits, moves and undos. */
  writeObject(object: TourObject, blob?: Blob): Promise<boolean>;
  /** A Finish wrote these objects into `written` (M6 E2p re-review #1):
   *  their versions there are this device's own work, whether or not the
   *  creator uploads the file. */
  finished(ids: readonly string[], written: TourManifest): void;
  /**
   * The creator said a Finish's file was uploaded (follow-up F19):
   * `written` is the tour.json of THAT file, captured when the question
   * was asked (F19 review #2) - never a later Finish's that was not
   * saved. Every object a Finish of this load wrote gets its version in
   * `written` as SEEN hosted, so a delete made elsewhere afterwards is
   * honoured rather than offered back. Whether every note landed; true
   * with nothing to note.
   */
  uploaded(written: TourManifest): Promise<boolean>;
  /** One awaited write for object `id` (the object list's actions). */
  write(
    id: string,
    write: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean>;
  /** Remove object `id`'s draft files, after any write queued for it. */
  forgetObject(id: string): Promise<void>;
  /** Write the tour document's settings record (`tour-document-draft.ts`:
   *  the moved stations' poses, the details once set), in its own queue.
   *  True with no tour's draft open yet (`present` writes it then). */
  saveSettings(settings: TourSettingsRecord): Promise<boolean>;
  /**
   * The draft follows `tourUrl` (debug-captures plan, Q-I): the file a
   * Finish saved of a tour opened from a file opens under another key once
   * its save wrote the tour's own id. Every file of the namespace is copied
   * there and the meta re-stated under it; the writes go there from now
   * on. The old namespace keeps what it holds - a saved file is not known
   * to be put anywhere ("NOT cleared here" in `creator-finish.ts`), so the
   * opened file opened again still offers what it did. True once the
   * draft is under `tourUrl` (or none is open); false when a copy did not
   * land.
   */
  follow(tourUrl: string): Promise<boolean>;
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

/** What one open read of the stored settings record that no decision took
 *  yet (`undecided` in `wireCreatorDraft`). `created` holds the stored
 *  record's created stations (those its objects were placed in that the
 *  opened tour lacks): a live record names only the page's own, so
 *  without them a write before the restore - a placement that starts a
 *  station, the open's own live write - would take the draft's stations
 *  off disk, and a later restore would seat its objects by the rule under
 *  new ids. */
interface SettingsHolder {
  poses: readonly StationPose[] | null;
  created: readonly StationFrame[] | null;
  /** The stored draft's codes while nobody decided on them (plan M3b, the
   *  M6 E2c review #3 before it): from the open's read until Restore
   *  brings them in or a rejection of the draft lands. A write of the
   *  codes meanwhile - a measurement, a settle, "Not now" then a Finish -
   *  re-states them after the page's own, or the draft's measured code
   *  would be gone from disk at the next read. */
  codes: DraftCodes | null;
}

/** `record` with the waiting draft's codes `stored` after its own: the
 *  record's hand first, else the stored one; a code the record holds
 *  under the same id is newer and wins. */
function withStoredCodes(
  record: DraftCodes,
  stored: DraftCodes | null,
): DraftCodes {
  if (stored === null) return record;
  const ids = new Set(record.levels.map((l) => l.id));
  return {
    level: record.level ?? stored.level,
    levels: [...record.levels, ...stored.levels.filter((l) => !ids.has(l.id))],
  };
}

/** `record` with the stored created stations whose ids it lacks: the
 *  record's own frame of an id wins (this page's, newer). */
function withCreated(
  record: TourSettingsRecord,
  stored: readonly StationFrame[] | null,
): TourSettingsRecord {
  const own = record.createdStations ?? [];
  const have = new Set(own.map((f) => f.id));
  const extra = (stored ?? []).filter((f) => !have.has(f.id));
  return extra.length === 0
    ? record
    : { ...record, createdStations: [...own, ...extra] };
}

export function wireCreatorDraft(deps: {
  ctx: TourViewerSession;
  dom: CreatorDraftDom;
  /** Opens a tour's draft namespace, or resolves undefined where there is
   *  no persistence (no OPFS, blocked site data, a quota wall). */
  openDraftStore: (key: string) => Promise<DraftFileStore | undefined>;
  /** The page-side visit log (`creator-setup.ts` owns it). */
  visitLog: VisitLog;
  /** The codes: written to the codes record, restored from it. */
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
   * The ids the meta ON DISK rejects (M6 E2c review #3): the read's raw
   * list, then each landed meta write's. `draftRejected` is pruned to ids
   * with files, but until a meta write lands the disk still rejects the
   * rest - and a change of one of those, not claimed, would be hidden by
   * the next read and swept by the next open.
   */
  let diskRejected: ReadonlySet<string> = new Set();
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
  /** The settings record's queue: one file, written whole each time, so a
   *  later write must land after an earlier one. */
  function settingsChainKey(tourUrl: string): string {
    return JSON.stringify(["settings", draftKeyForTour(tourUrl)]);
  }
  /** The codes record's queue, for the same reason. */
  function codesChainKey(tourUrl: string): string {
    return JSON.stringify(["codes", draftKeyForTour(tourUrl)]);
  }

  /** The creator-facing url of the open tour, for later draft writes. */
  let draftTourUrl: string | null = null;
  /** The stored settings record's station poses while nobody decided on
   *  them (offered, or declined for now): a record this page writes
   *  without poses carries them, or a rename - the kept name re-applied
   *  at every open among them - would cost a moved station (D17; the r880
   *  milestone review HIGH-2). `poses` is null once restored, discarded,
   *  or when the stored record moves none.
   *
   *  One holder PER OPEN, made by `present` and dropped by `reset`: each
   *  settings write names the holder of the open it writes for and reads
   *  its poses when it runs, so a write still queued when the tour closes
   *  (or another opens) carries its own tour's poses - never none, never
   *  the next tour's (the r880 fix re-review, L2). */
  let undecided: SettingsHolder | null = null;
  /** The settings records (not removals) issued per tour since the page
   *  loaded, by the namespace key (as the queues above): a "Delete it" that
   *  commits after its tour closed compares it with its tap's count, to
   *  tell whether live work wrote the file since. */
  const settingsPuts = new Map<string, number>();
  function settingsPutsFor(tourUrl: string): number {
    return settingsPuts.get(draftKeyForTour(tourUrl)) ?? 0;
  }
  /** Every object id this page changed since the tour opened (an edit, a
   *  move, a placement, a delete, an undo, a restore): live work, which
   *  wins over the offer and is never rejected with it. Unlike the
   *  document's lists, a Finish does not clear it (the desktop editor's
   *  `touched`; the r880 fix re-review, P1). */
  const touchedIds = new Set<string>();
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
    /** The station poses the settings record holds that differ from the
     *  opened tour's (D17): a restore moves those frames first, so their
     *  items' records land inside them. */
    stations: readonly StationPose[];
    /** The stations this draft's objects were placed in that the opened
     *  tour lacks, whole (the settings record's `createdStations`): put
     *  back before the objects, so each comes back in its own station. */
    createdStations: readonly StationFrame[];
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
  /** The tour as it was OPENED (M6 E2p review #2): a Finish advances the
   *  tour document to what this page wrote, which is not what is hosted
   *  until the creator uploads it. Every hosted comparison of `present`
   *  uses it (re-review #3). The document keeps it (`opened()`), so the
   *  draft holds no copy of its own (the r880 milestone review LOW-5). */
  const openedTour = (): TourManifest | null => ctx.tourDocument.opened();
  /** The line saying the draft gave way to newer edits, for the open. */
  let supersededNote: string | null = null;
  /** The objects this load's Finishes wrote (F19): what a yes to "did you
   *  upload it?" can be about. */
  const finishedIds = new Set<string>();

  /** The opened tour's version of an object, recorded as seen with each
   *  draft write of it (M6 E2p); none for an object it does not carry.
   *  Taken when the write is QUEUED: a queued write can run after another
   *  open (`reset`, `present`), whose tour is not the one edited (third
   *  review #1). */
  function seenKey(id: string): string | undefined {
    return hostedObjects(openedTour()).key(id);
  }

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
    const seen = seenKey(object.id);
    void writeForObject(store, tourUrl, object.id, (s) =>
      writeDraftLiveRecord(s, object, blob, seen),
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

  /** The settings record's write in its queue: the whole record, or its
   *  removal (`null`). `held` is the holder of the open the write is FOR
   *  (L2): the caller names it, because a write issued after an await may
   *  run once another tour is open, whose holder `undecided` is then. */
  function writeSettings(
    store: DraftFileStore,
    tourUrl: string,
    record: TourSettingsRecord | null,
    held: SettingsHolder | null,
  ): Promise<boolean> {
    if (record !== null) {
      settingsPuts.set(draftKeyForTour(tourUrl), settingsPutsFor(tourUrl) + 1);
    }
    return draftWrites
      .run(settingsChainKey(tourUrl), () => {
        if (record === null) {
          return store.remove(SETTINGS_KEY).then(() => true);
        }
        // Its undecided poses and created stations as they stand when the
        // write RUNS: the open's read of the record sets them in this same
        // queue.
        const poses = held?.poses ?? null;
        const posed =
          record.stations === undefined && poses !== null
            ? { ...record, stations: poses }
            : record;
        return store.put(
          SETTINGS_KEY,
          settingsRecordText(withCreated(posed, held?.created ?? null)),
        );
      })
      .catch(() => false);
  }

  /** The codes record's write in its queue: `codes`, with the waiting
   *  draft's codes of `held` (the open the write is FOR, as for the
   *  settings) re-stated as they stand when the write RUNS - the open's
   *  read of the record sets them in this same queue. */
  function writeCodes(
    store: DraftFileStore,
    tourUrl: string,
    codes: DraftCodes,
    held: SettingsHolder | null,
  ): Promise<boolean> {
    return draftWrites
      .run(codesChainKey(tourUrl), () =>
        writeDraftCodes(store, withStoredCodes(codes, held?.codes ?? null)),
      )
      .catch(() => false);
  }

  /** This page's codes as they stand (`codesRecord`'s, read through the
   *  codes facade). */
  function pageCodes(): DraftCodes {
    return { level: deps.codes.inHand(), levels: deps.codes.notHosted() };
  }

  /** This page holds a code the draft keeps. */
  function hasPageCodes(): boolean {
    const codes = pageCodes();
    return codes.level !== null || codes.levels.length > 0;
  }

  /** This page changed the tour's settings since the open (a station
   *  moved, the details set): its record is live work, newer than any
   *  draft's. */
  function settingsLive(): boolean {
    const state = ctx.tourDocument.state();
    const { touched } = state;
    return (
      touched.stations ||
      touched.details ||
      touched.needsNoGps ||
      createdStationFrames(state).length > 0
    );
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
      if (
        draftStore === store &&
        (draftRejected.includes(id) || diskRejected.has(id))
      ) {
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

  /** The object ids of this page's live work: the document's edits and
   *  deletions, and every id changed since the open (`touchedIds`: a
   *  Finish empties the lists, not this). What Restore leaves out. */
  function liveObjectIds(): Set<string> {
    return new Set([
      ...ctx.tourDocument.entries().map((p) => p.object.id),
      ...ctx.tourDocument.deleted(),
      ...touchedIds,
    ]);
  }

  /**
   * `ids` minus those the creator changed or deleted in this page (M4):
   * an edit of a hosted object keeps its id, so its file on disk is the
   * live change's now, and a sweep of an older draft must not take it.
   * Minus this page's visits too (M3b: a read racing their first write may
   * list them) - for the sweep only: a visit id says nothing about an
   * object's, so Restore filters by `liveObjectIds` alone.
   */
  function notLive(ids: readonly string[]): string[] {
    const live = liveObjectIds();
    const visits = new Set(deps.visitLog.ids());
    return ids.filter((id) => !live.has(id) && !visits.has(id));
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
   * Record the tour, the printed size and the rejections (the codes have a
   * record of their own, `writeCodes`).
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
    const sizeM = readSideM(dom.sizeInput);
    const meta = {
      tourUrl,
      sizeM:
        Number.isFinite(sizeM) && sizeM > 0 ? sizeM : AUTHOR_DEFAULT_SIZE_M,
      // Re-stated on every write, not only on the discard's: this file is
      // rewritten on each mint, each finish and each tour open, and one
      // that omitted the list would hand a rejected draft back on the next
      // read. (NOT on each placement - `recordPlacement` writes the object
      // file only and never reaches here; PR #456 review.)
      rejected: draftRejected,
    };
    // Values captured NOW, write ordered by call within this tour. The
    // chain keeps one refused write from breaking the queue behind it.
    return draftWrites
      .run(metaChainKey(tourUrl), () => writeDraftMeta(store, meta))
      .then((wrote) => {
        // In call order (one chain per meta), so the last landed is the
        // disk's list.
        if (wrote && draftStore === store)
          diskRejected = new Set(meta.rejected);
        return wrote;
      });
  }

  async function follow(tourUrl: string): Promise<boolean> {
    const from = draftStore;
    const fromUrl = draftTourUrl;
    if (from === undefined || fromUrl === null) return true;
    if (draftKeyForTour(tourUrl) === draftKeyForTour(fromUrl)) return true;
    const generation = ctx.openGeneration;
    const opened = await deps.openDraftStore(draftKeyForTour(tourUrl));
    if (opened === undefined) return false;
    // Another tour opened, or the draft moved meanwhile: not this move's -
    // unless it moved where this one was going (a second quick Finish of
    // the same file), which is the draft where it belongs.
    if (
      generation !== ctx.openGeneration ||
      draftStore !== from ||
      draftTourUrl !== fromUrl
    ) {
      return (
        draftTourUrl !== null &&
        draftKeyForTour(draftTourUrl) === draftKeyForTour(tourUrl)
      );
    }
    // Synchronously: every write issued from here on lands in the new one.
    draftStore = opened;
    draftTourUrl = tourUrl;
    // Alone in the queue: the writes queued for the old namespace land
    // there first, so the copy holds them, and a write issued from here on
    // waits for the copy - the old copy of a file never lands over it.
    const copied = await draftWrites
      .exclusive(async () => {
        let ok = true;
        for (const key of await from.keys()) {
          if (key === META_KEY) continue;
          const data = key.startsWith(photoKey(""))
            ? await from.getBlob(key)
            : await from.getText(key);
          // Listed but unreadable: not copied (the old namespace has it).
          ok = data !== undefined && (await opened.put(key, data)) && ok;
        }
        return ok;
      })
      .catch(() => false);
    return (await recordMeta(tourUrl)) && copied;
  }

  /** Put a restored draft's objects and deletions back into the tour
   *  document, as one step (see the restore below). Returns what it put
   *  back, live work left out: what the restore's note may claim. */
  function restoreWork(waiting: NonNullable<typeof offered>): {
    placed: number;
    changed: number;
    deleted: number;
  } {
    // Live work on the same id is newer than the draft's, and wins - also
    // after a Finish wrote it (P1). Object ids only: a visit's id is not
    // an object's.
    const live = liveObjectIds();
    const objects = waiting.objects.filter((o) => !live.has(o.id));
    // The frames before the objects, whose records stand in them - unless
    // a frame was moved here meanwhile: live work wins (as on the desktop).
    const stations = ctx.tourDocument.state().touched.stations
      ? []
      : waiting.stations;
    // The deletions come back as the tombstones they are (plan §3.4).
    const deleted = waiting.deleted.filter((id) => !live.has(id));
    ctx.tourDocument.restore(
      {
        ...(stations.length === 0 ? {} : { stations }),
        ...(waiting.createdStations.length === 0
          ? {}
          : { createdStations: waiting.createdStations }),
        objects,
        deleted,
        pictures: new Map(
          objects.flatMap((o) => {
            const blob = waiting.photos.get(o.id);
            return blob === undefined ? [] : [[o.id, blob] as const];
          }),
        ),
      },
      "the restored draft",
    );
    // Split as the offer splits it (`present`): changes of objects the
    // opened tour carries, and a moved station as one change.
    const hosted = hostedObjects(openedTour());
    const edits = objects.filter((o) => hosted.key(o.id) !== undefined).length;
    return {
      placed: objects.length - edits,
      changed: edits + stations.length,
      deleted: deleted.length,
    };
  }

  dom.draftRestore.addEventListener("click", () => {
    const waiting = offered;
    dom.draftOffer.hidden = true;
    offered = null;
    if (waiting === null) return;
    // Decided: the restored frames are the document's now, and its record
    // carries them.
    if (undecided !== null) {
      undecided.poses = null;
      undecided.created = null;
      // The codes become this page's below (`restoreLevels`).
      undecided.codes = null;
    }
    // Into the SAME document a live placement changes, so the finish needs
    // no second path: it writes these into the manifest exactly as it
    // writes anything else (an edit of a hosted object replaces it by id),
    // and the photo bytes as content entries. Live work on the same id is
    // newer than the draft's, and wins. The document's listener writes
    // them to the draft again (the same records: harmless).
    const restored = restoreWork(waiting);
    // And the visits it measured (M3b): the summary after Finish combines
    // them with this page's. Counted before: one the log already holds
    // (this page's own) does not come back.
    const known = new Set(deps.visitLog.ids());
    const visitsBack = waiting.visits.filter(
      (v) => !known.has(v.visitId),
    ).length;
    deps.visitLog.restore(waiting.visits);
    // The measured level comes back too, and it is what unlocks Finish
    // without walking to the poster again. Only when the session has not
    // already measured one: a live measurement is newer than a draft.
    // Every code it kept (M4c-1), in the draft's order: saved, so the next
    // Finish writes them; live work on a code is newer and wins.
    deps.codes.restoreLevels(waiting.levels);
    const levelBack =
      waiting.level !== null && deps.codes.restoreInHand(waiting.level);
    // And the printed size, which the page rewrites from the framework
    // default on every load - so without this a re-entry would solve
    // against 16 cm for a poster printed at 20.
    if (Number.isFinite(waiting.sizeM) && waiting.sizeM > 0) {
      writeSideM(dom.sizeInput, waiting.sizeM);
      ctx.activeSizeM = waiting.sizeM;
    }
    // Render them, or the readout says "5 objects placed" over an empty
    // scene and the creator places them again - new ids, real duplicates
    // at the same spot in the published zip. The sync guards against a
    // dead scene, so this is safe outside a session too.
    deps.syncPreviews();
    // What was put back, not what was offered: live work left some out,
    // a code measured here kept its place, and a visit already held stayed.
    ctx.placementNote = restoredText(restored.placed, levelBack, {
      changed: restored.changed,
      deleted: restored.deleted,
      visits: visitsBack,
    });
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
    // The undecided poses and codes go with the draft once its rejection
    // LANDED (below): until then the draft is still there, and a rename
    // or a measurement must still carry them (the r880 fix re-review, L3).
    const held = undecided;
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
    // rejected level: `recordMeta` writes the code in hand, so a creator
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
    // What the settings file held at the tap, for a commit that lands
    // after the tour closed (below).
    const liveAtTap = settingsLive();
    const putsAtTap = settingsPutsFor(tourUrl);
    // ENQUEUED synchronously, with the values captured at the tap. The
    // chain guarantees ordering, not immediacy: the `put` itself is issued
    // from a `then`, so it is a microtask away at best (PR #457 review).
    const committed = recordMeta(tourUrl);
    // The draft's codes go with it once the commit LANDED: this page's
    // only, as they stood at the tap. Queued NOW, so a write of the codes
    // issued after the tap - live work, newer - lands after it, without
    // the rejected ones. A commit that did not land writes nothing: the
    // draft is still there, its codes with it. Between the commit and
    // this write a reload finds the rejected draft's codes without its
    // objects, and offers them again - the safe direction (a prompt with
    // "Delete it" on it, never lost work), and the window of one write.
    const codesAtTap = pageCodes();
    void draftWrites
      .run(codesChainKey(tourUrl), async () => {
        if (!(await committed)) return false;
        if (held !== null) held.codes = null;
        return writeDraftCodes(store, codesAtTap);
      })
      .catch(() => false);
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
      // Committed: the undecided poses are rejected with the draft, so no
      // later record carries them.
      if (held !== null) {
        held.poses = null;
        held.created = null;
      }
      // The record goes with the draft - unless this page changed the
      // settings since the open: then the file is that live work's, and
      // is written again without the rejected poses it carried. Only
      // while this tour is still the open one: the document and its
      // settings are another tour's after a close (as in the failure
      // branch above).
      if (draftStore === store && draftTourUrl === tourUrl) {
        void writeSettings(
          store,
          tourUrl,
          settingsLive() ? settingsRecord(ctx.tourDocument.state()) : null,
          held,
        );
        return;
      }
      // Closed since the tap. Reopened: that open read the record and owns
      // it now. Live work at the tap, or a record written for this tour
      // since (a rename before the close, the reopen's own): the file is
      // that work's, and with no document left to rewrite it from it is
      // kept, rejected poses and all, as before. Otherwise nothing but the
      // rejected draft's record is there, and it goes now - or the next
      // open would offer the rejected poses again.
      if (
        draftTourUrl !== null &&
        draftKeyForTour(draftTourUrl) === draftKeyForTour(tourUrl)
      ) {
        return;
      }
      if (liveAtTap || settingsPutsFor(tourUrl) !== putsAtTap) return;
      void writeSettings(store, tourUrl, null, held);
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
    // The tour as opened (M6 E2p): every hosted comparison below uses it,
    // never a manifest a Finish advanced meanwhile (the continuation is
    // this open's: `stale`).
    const opened = openedTour();
    supersededNote = null;
    // This open's holder (L2): its writes read its poses and codes,
    // whatever opens after it.
    const held: SettingsHolder = { poses: null, created: null, codes: null };
    undecided = held;
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
      // The stored codes FIRST, in their own queue and synchronously
      // queued: a write of the codes issued from here on runs after this
      // read, re-stating them (`writeCodes`).
      const codesRead = draftWrites.run(codesChainKey(tourUrl), async () => {
        const read = await readDraftCodes(store);
        held.codes =
          read.level === null && read.levels.length === 0 ? null : read;
      });
      // The settings record FIRST, in its own queue: a write this page
      // issues from here on (the live record below, a rename) runs after
      // this read, carrying the poses it found undecided.
      const storedSettings = await draftWrites.run(
        settingsChainKey(tourUrl),
        async () => {
          const read = parseSettingsRecord(await store.getText(SETTINGS_KEY));
          // Into this open's own holder: only its writes read it.
          const openedPoses = (opened?.stations ?? []).map(({ id, geo }) => ({
            id,
            geo,
          }));
          held.poses =
            read?.stations !== undefined &&
            changedStations(read.stations, openedPoses).length > 0
              ? read.stations
              : null;
          const openedIds = new Set(openedPoses.map((p) => p.id));
          const created = (read?.createdStations ?? []).filter(
            (f) => !openedIds.has(f.id),
          );
          held.created = created.length === 0 ? null : created;
          return read;
        },
      );
      if (stale()) return;
      await codesRead.catch(() => undefined);
      if (stale()) return;
      const stored = await readDraft(store);
      if (stale()) return;
      // Per-tour state: never carry the previous tour's rejections into
      // this one's meta.
      draftRejected = stored?.rejectedIds ?? [];
      diskRejected = new Set(stored?.rejectedOnDisk ?? []);
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
      for (const entry of ctx.tourDocument.entries()) {
        recordPlacement(entry.object, entry.blob);
      }
      // And this page's visits (M3b), for the same reason.
      for (const entry of deps.visitLog.entries()) {
        writeVisit(store, tourUrl, entry);
      }
      for (const id of ctx.tourDocument.deleted()) {
        void writeForObject(store, tourUrl, id, (s) =>
          writeDraftDeletion(s, id),
        ).then((ok) => {
          if (!ok) noteNoPersistence();
        });
      }
      // And the settings this page changed (a station moved before the
      // draft opened), for the same reason.
      const live = settingsLive();
      if (live) {
        void writeSettings(
          store,
          tourUrl,
          settingsRecord(ctx.tourDocument.state()),
          held,
        ).then((ok) => {
          if (!ok) noteNoPersistence();
        });
      }
      if (stored === undefined) {
        // No draft yet, but there will be: record what is already known,
        // so a crash before the first placement still leaves the tour and
        // the printed size behind - and a code measured before the open.
        void recordMeta(tourUrl);
        if (hasPageCodes()) void writeCodes(store, tourUrl, pageCodes(), held);
        return;
      }
      // A newer edit elsewhere wins (M6 E2p, owner question Q-E2-2's
      // default): those records are not offered back, and the page says
      // so once.
      const superseded = draftObjectsSuperseded(stored.draft, opened);
      supersededNote =
        superseded.length === 0 ? null : supersededLine(superseded.length);
      if (supersededNote !== null) {
        ctx.placementNote = supersededNote;
        deps.render();
        // Said once (review #4): the replaced records go - unless this
        // page changed them again before the draft opened.
        for (const id of notLive(superseded.map((o) => o.id))) {
          void writeForObject(store, tourUrl, id, (s) =>
            removeDraftObject(s, id).then(() => true),
          );
        }
      }
      const waiting = draftObjectsNotYetHosted(stored.draft, opened);
      const waitingDeletions = draftDeletionsNotYetHosted(stored.draft, opened);
      // The station poses the record holds that the opened tour does not
      // (D17): work like any other, so the draft is not spent while one
      // is waiting. Read whatever else this page changed (a name is a
      // settings change too); only a station moved here outranks them.
      const settings = ctx.tourDocument.state().touched.stations
        ? undefined
        : storedSettings;
      const openedStations = (opened?.stations ?? []).map(({ id, geo }) => ({
        id,
        geo,
      }));
      const moved = new Set(
        changedStations(settings?.stations, openedStations),
      );
      const waitingStations = (settings?.stations ?? []).filter((p) =>
        moved.has(p.id),
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
        waitingStations.length === 0 &&
        draftIsSpent(stored.draft, opened, hostedLevel, stored.visits.length)
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
        // Spent: the zip holds its codes, so nothing of them is re-stated;
        // the record keeps this page's own.
        held.codes = null;
        void writeCodes(store, tourUrl, pageCodes(), held);
        for (const id of sweep) sweepRejected(store, tourUrl, id);
        // Its created stations went with its objects: no later record
        // carries them.
        held.created = null;
        // The record is spent too: the opened tour carries its poses. Not
        // when this page wrote its own (live) - and `settingsLive` asked
        // again, a station may have moved during the awaits.
        if (!live && !settingsLive()) {
          void writeSettings(store, tourUrl, null, held);
        }
        return;
      }
      // The draft stays: records the hosted zip already carries get their
      // base now (M6 E2p), so a later delete elsewhere is not undone. Not
      // on the spent path above, which must leave the files alone when its
      // commit is refused.
      // The hosted key, which a stored copy reads back as.
      const published = hostedObjects(opened);
      for (const o of draftObjectsPublished(stored.draft, opened)) {
        const key = published.key(o.id);
        if (key === undefined) continue;
        void writeForObject(store, tourUrl, o.id, (s) =>
          addDraftBaseKey(s, o.id, "seen", key),
        );
      }
      const hasLevel = draftHasUnhostedLevel(stored.draft, hostedLevel);
      // New placements, and changes of objects the hosted zip carries.
      const hosted = hostedObjects(opened);
      const edits = waiting.filter(
        (o) => hosted.key(o.id) !== undefined,
      ).length;
      // A moved station is one change, as on the desktop.
      const counts = {
        placed: waiting.length - edits,
        changed: edits + waitingStations.length,
      };
      // A code measured before this open is newer than the offered
      // draft's and would otherwise live only in memory; a measurement
      // after the open is written the same way, by the document's
      // listener.
      if (hasPageCodes()) void writeCodes(store, tourUrl, pageCodes(), held);
      offered = {
        objects: waiting,
        storedIds: stored.storedIds,
        photos: stored.photos,
        // ALWAYS handed back when the draft has one, even if the hosted
        // zip already stores the same measurement: the finish refuses to
        // run without a code in hand, so withholding it would leave a
        // creator with restorable objects and no way to publish them.
        // `hasLevel` only decides the WORDS and whether the draft counts
        // as spent.
        level: stored.draft.level,
        levels: draftLevels(stored.draft),
        sizeM: stored.draft.sizeM,
        deleted: waitingDeletions,
        counts,
        visits: stored.visits,
        stations: waitingStations,
        // Whatever this page did meanwhile: a frame of an id the document
        // carries is left as it is (`restored`).
        createdStations: storedSettings?.createdStations ?? [],
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
        // With the superseded line, which this note must not hide.
        ctx.placementNote = [
          "Unsaved work for this tour is on this device - restore it after leaving AR.",
          ...(supersededNote === null ? [] : [supersededNote]),
        ].join(" ");
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
      supersededNote = null;
      // A write still queued for the closing tour keeps its own holder.
      undecided = null;
      touchedIds.clear();
      finishedIds.clear();
      dom.draftOffer.hidden = true;
      offered = null;
      draftStore = undefined;
      draftTourUrl = null;
      draftRejected = [];
      diskRejected = new Set();
    },
    saveMeta: () =>
      draftTourUrl === null ? Promise.resolve(true) : recordMeta(draftTourUrl),
    saveCodes: (codes) => {
      const store = draftStore;
      const tourUrl = draftTourUrl;
      // No draft namespace yet: `present` writes them when it opens.
      if (tourUrl === null) return Promise.resolve(true);
      if (store === undefined) {
        noteNoPersistence();
        return Promise.resolve(false);
      }
      // Issued now, for the open tour: its holder is this open's.
      return writeCodes(store, tourUrl, codes, undecided).then((ok) => {
        if (!ok) noteNoPersistence();
        return ok;
      });
    },
    recordPlacement,
    recordVisit,
    // The document's writes (`draftObjectWrites`): each id they name is
    // live work from here on (`touchedIds`).
    write: (id, task) => {
      touchedIds.add(id);
      return draftWrite(id, task);
    },
    writeObject: (object, blob) => {
      touchedIds.add(object.id);
      const seen = seenKey(object.id);
      return draftWrite(object.id, (s) =>
        writeDraftLiveRecord(s, object, blob, seen),
      );
    },
    finished: (ids, written) => {
      for (const id of ids) finishedIds.add(id);
      const store = draftStore;
      const tourUrl = draftTourUrl;
      if (store === undefined || tourUrl === null) return;
      // As a reader of the written file sees it (third review #5).
      const read = hostedObjects(manifestAsRead(written));
      for (const id of ids) {
        const key = read.key(id);
        if (key === undefined) continue;
        void writeForObject(store, tourUrl, id, (s) =>
          addDraftBaseKey(s, id, "written", key),
        );
      }
    },
    uploaded: async (written) => {
      // No draft here (no persistence, or no tour's namespace yet): there
      // is nothing a later open could offer back, so nothing to note and
      // nothing failed - never "could not note it", asked again on every
      // Save again (PR #626 bot finding 3).
      if (draftStore === undefined || draftTourUrl === null) return true;
      // The file asked about: an earlier Finish's objects are in it too, in
      // the version the creator just said is hosted (a later Finish carries
      // them on); an object absent from it is not noted. As a reader of
      // that file sees them (third review #5).
      const read = hostedObjects(manifestAsRead(written));
      const notes = [...finishedIds].flatMap((id) => {
        const key = read.key(id);
        if (key === undefined) return [];
        return [draftWrite(id, (s) => addDraftBaseKey(s, id, "seen", key))];
      });
      return (await Promise.all(notes)).every(Boolean);
    },
    forgetObject: (id) => {
      touchedIds.add(id);
      const store = draftStore;
      const tourUrl = draftTourUrl;
      if (store === undefined || tourUrl === null) return Promise.resolve();
      // In the id's queue: a placement's write still in flight lands first,
      // and this removal after it (M4 review #7).
      return draftWrites.run(objectChainKey(tourUrl, id), () =>
        removeDraftObject(store, id),
      );
    },
    follow,
    warnNoBackup: noteNoPersistence,
    persists: () => !warnedAboutPersistence,
    saveSettings: (settings) => {
      const store = draftStore;
      const tourUrl = draftTourUrl;
      // No draft namespace yet: `present` writes the record when it
      // opens, as it does the objects - nothing failed.
      if (tourUrl === null) return Promise.resolve(true);
      if (store === undefined) {
        noteNoPersistence();
        return Promise.resolve(false);
      }
      // Issued now, for the open tour: its holder is this open's.
      return writeSettings(store, tourUrl, settings, undecided).then((ok) => {
        if (!ok) noteNoPersistence();
        return ok;
      });
    },
  };
}
