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
import {
  createEmptyTourManifest,
  type TourManifest,
  type TourObject,
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
  writeDraftLiveRecord,
  writeDraftMeta,
  discardOlderFormatDraft,
  isOlderVersionDraft,
  writeDraftVisit,
  type DraftCodes,
} from "./draft-persistence.js";
import type { CreatorCodes } from "./creator-codes.js";
import {
  DRAFT_BEING_READ,
  DRAFT_DELETING,
  DRAFT_EDIT_NOT_APPLIED,
  DRAFT_EDIT_WAITS as EDIT_WAITS,
  DRAFT_EDIT_WAITS_IN_AR as EDIT_WAITS_IN_AR,
  draftEditsMakeAgain,
} from "./draft-edit-gate.js";
import { createKeyedChain } from "gps-plus-slam-app-framework/utils/keyed-chain";
import { isTourContentKey } from "./tour-file-key.js";
import {
  DRAFT_PART_UNREAD,
  parseSettingsRecord,
  settingsRecordText,
  SETTINGS_KEY,
  type TourCodesRecord,
  type TourSettingsRecord,
} from "./tour-document-draft.js";
import {
  addsStations,
  changesSettings,
  heldAgainst,
  joinedParts,
  movedIds,
  restoreWithSettings,
  settingsChangeCount,
  settingsChanges,
  settingsOf,
  settingsParts,
} from "./settings-record-offer.js";
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
  /** The start of AR, answered at once (WebXR starts only inside the
   *  tap's own user activation, so the start never waits): true once the
   *  open tour's draft is decided or there is none. False, with a note,
   *  while its read runs (`DRAFT_BEING_READ`), while "Delete it" runs
   *  (`DRAFT_DELETE_RUNS`) or while it is undecided (the offer shows again
   *  with `DRAFT_DECIDE_BEFORE_AR`): in AR the offer is out of sight, and
   *  an edit there would wait for it. */
  readyForAr(): boolean;
  /** Rewrite the open tour's meta (tour, printed size, rejections). True
   *  with no tour open: nothing to write. */
  saveMeta(): Promise<boolean>;
  /** Write the draft's codes record (`tour-document-draft.ts`, plan M3b:
   *  the code in hand and the codes the hosted zip does not hold yet), in
   *  its own queue, the waiting draft's codes re-stated after it. True
   *  with no tour's draft open yet (`present` writes them then). */
  saveCodes(codes: TourCodesRecord): Promise<boolean>;
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
   *  True with no tour's draft open yet (nothing of the document can have
   *  changed before it: every edit waits from `present` on). */
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
  /**
   * `tourUrl` was refused as an older format: its draft has nothing left
   * to be restored into, so its namespace is emptied, the meta first (a
   * reload midway finds no draft). After any write queued for its meta.
   * True when a draft was there (its meta); false for none, or for a
   * device that keeps no drafts. Never rejects. Never the open tour's: a
   * refused tour never opens its draft.
   */
  forgetRefused(tourUrl: string): Promise<boolean>;
  /** Say, once, that this device keeps no backup copy. */
  warnNoBackup(): void;
  /** The work this page holds is backed up on this device: a tour's draft
   *  has opened and taken the work made before it (`present` ran to its
   *  end for the open tour), and no backup write failed. False with no
   *  tour open, before its manifest settled (no draft is presented), while
   *  its draft is still opening, and once the creator was told no backup
   *  is kept - in each, unstored work may be waiting in memory. */
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

/** One open's codes holder (`undecided` in `wireCreatorDraft`). The codes
 *  are not edits of the tour document, so the draft question's gate does
 *  not hold them (`draft-edit-gate.ts`). */
interface CodesHolder {
  /** The stored draft's codes while nobody decided on them (plan M3b, the
   *  M6 E2c review #3 before it): from the open's read until Restore
   *  brings them in or a rejection of the draft lands. A write of the
   *  codes meanwhile - a measurement, a settle - re-states them after the
   *  page's own, or the draft's measured code would be gone from disk at
   *  the next read. */
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

/** Said when AR is asked for while the draft is undecided. */
export const DRAFT_DECIDE_BEFORE_AR =
  "Choose Restore or Delete it for the unsaved work first - AR starts after that.";

/** Said when AR is asked for while "Delete it" runs. */
export const DRAFT_DELETE_RUNS =
  "The unsaved work is being deleted - AR can start once that is done.";

/** The note in AR while a draft is offered and nothing waits. */
const OFFER_IN_AR =
  "Unsaved work for this tour is on this device - restore it after leaving AR.";

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
  /** The open's codes holder, made by `present` and dropped by `reset`:
   *  each codes write names the holder of the open it writes for and reads
   *  its codes when it runs, so a write still queued when the tour closes
   *  (or another opens) carries its own tour's codes - never the next
   *  tour's. */
  let undecided: CodesHolder | null = null;
  /** What a draft is offering, until the creator answers: kept while the
   *  question is put off ("Not now"), so an edit can ask it again. */
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
    /** The settings record offered beside the objects (the tour's
     *  details, its stations - poses, frames, order, created and deleted
     *  ones - and its characters), or none: put back by the same rule as
     *  the desktop's (`settings-record-offer.ts`), the frames before the
     *  objects so each item's record lands in its own station. */
    settings: TourSettingsRecord | undefined;
    /** The offer's words. */
    text: string;
  } | null = null;
  /** The draft question's gate (`draft-edit-gate.ts`): every edit of the
   *  tour document waits from `present` until the draft is decided. */
  const gate = ctx.store.draftGate;
  /** An edit waits for the answer: the offer says so when it shows. */
  let editWaits = false;
  /** A "Delete it" in progress: the offer's buttons are disabled. */
  let discarding = false;
  /** "Delete it"'s own label, put back when it is no longer in progress. */
  const discardLabel = dom.draftDiscard.textContent;
  /** The open tour's draft read (`present`) runs: AR does not start. */
  let readRunning = false;
  /** Said once, not per placement: a creator mid-walk cannot act on it. */
  let warnedAboutPersistence = false;
  /** The open tour's draft took the page's earlier work: its `present`
   *  continuation ran to its end. Until then that work waits in memory. */
  let caughtUp = false;
  /** Moves on every `reset` (a tour's teardown). A teardown that runs
   *  inside the same open (a late integrity failure removes the tour
   *  without a new open) leaves `ctx.openGeneration` where it was, so a
   *  `present` continuation compares this too. */
  let presentEpoch = 0;

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

  /** The tour as it was OPENED (M6 E2p review #2): a Finish advances the
   *  tour document to what this page wrote, which is not what is hosted
   *  until the creator uploads it. Every hosted comparison of `present`
   *  uses it (re-review #3). The document keeps it (`opened()`), so the
   *  draft holds no copy of its own (the r880 milestone review LOW-5). */
  const openedTour = (): TourManifest | null => ctx.tourDocument.opened();
  /** The line saying the draft gave way to newer edits, for the open. */
  let supersededNote: string | null = null;
  /** The line saying part of the draft did not read, for the open. */
  let unreadNote: string | null = null;
  /** The objects this load's Finishes wrote (F19): what a yes to "did you
   *  upload it?" can be about. */
  const finishedIds = new Set<string>();
  /** The versions this load's Finishes wrote and its uploads noted, per
   *  id: a forget removes the record WITH its base, so a record written
   *  again afterwards gets them back - without them a reopen would call
   *  this device's own saved work "replaced by a newer one". */
  const knownKeys = new Map<
    string,
    { seen: Set<string>; written: Set<string> }
  >();
  /** Ids forgotten in this load whose base was removed with them. */
  const forgottenIds = new Set<string>();

  function rememberKey(id: string, list: "seen" | "written", key: string) {
    let known = knownKeys.get(id);
    if (known === undefined) {
      known = { seen: new Set(), written: new Set() };
      knownKeys.set(id, known);
    }
    known[list].add(key);
  }

  /** Write a live record; for an id forgotten earlier in this load, put
   *  back the base keys the forget removed (in the id's queue, after the
   *  record, as any base write). */
  async function liveWrite(
    s: DraftFileStore,
    object: TourObject,
    blob: Blob | undefined,
    seen: string | undefined,
  ): Promise<boolean> {
    const wrote = await writeDraftLiveRecord(s, object, blob, seen);
    if (!wrote || !forgottenIds.has(object.id)) return wrote;
    forgottenIds.delete(object.id);
    const known = knownKeys.get(object.id);
    if (known === undefined) return wrote;
    for (const list of ["seen", "written"] as const) {
      for (const key of known[list]) {
        await addDraftBaseKey(s, object.id, list, key);
      }
    }
    return wrote;
  }

  /** The opened tour's version of an object, recorded as seen with each
   *  draft write of it (M6 E2p); none for an object it does not carry.
   *  Taken when the write is QUEUED: a queued write can run after another
   *  open (`reset`, `present`), whose tour is not the one edited (third
   *  review #1). */
  function seenKey(id: string): string | undefined {
    return hostedObjects(openedTour()).key(id);
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
   *  removal (`null`). Every edit of the document waits while a draft is
   *  undecided, so a record written is always decided work. */
  function writeSettings(
    store: DraftFileStore,
    tourUrl: string,
    record: TourSettingsRecord | null,
  ): Promise<boolean> {
    return draftWrites
      .run(settingsChainKey(tourUrl), () =>
        record === null
          ? store.remove(SETTINGS_KEY).then(() => true)
          : store.put(SETTINGS_KEY, settingsRecordText(record)),
      )
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
    held: CodesHolder | null,
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

  /** `ids` minus this page's visits (M3b: a read racing their first write
   *  may list them): a sweep must not take them. No object of this page's
   *  can be among `ids`: every edit waits while a draft is undecided. */
  function notLive(ids: readonly string[]): string[] {
    const visits = new Set(deps.visitLog.ids());
    return ids.filter((id) => !visits.has(id));
  }

  /**
   * One draft write for the object list's actions (authoring plan
   * 2026-09-28-0953 §3.4, M4), AWAITED: the row shows its in-progress state
   * until this settles and then says whether the change reached the draft.
   * Before the tour's draft namespace exists there is nothing to write yet
   * and nothing failed, so that reads as landed: placing waits for the
   * tour's settle, which presents its draft in the same step
   * (`archive-open.ts`), and an edit made while the draft is read waits
   * for it (`draft-edit-gate.ts`).
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
      // read. (NOT on each placement - a placement's write is the object
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

  function forgetRefused(tourUrl: string): Promise<boolean> {
    // A content key may be another tour's on the same recording.
    if (isTourContentKey(tourUrl)) return Promise.resolve(false);
    return draftWrites
      .run(metaChainKey(tourUrl), async () => {
        const store = await deps.openDraftStore(draftKeyForTour(tourUrl));
        if (store === undefined) return false;
        const keys = await store.keys();
        if (keys.length === 0) return false;
        // Only a draft proved to be an older version's: the same tour's
        // current copy shares this key.
        if (!(await isOlderVersionDraft(store))) return false;
        await store.clear(META_KEY);
        return keys.includes(META_KEY);
      })
      .catch(() => false);
  }

  /** Put a restored draft's objects and deletions back into the tour
   *  document, as one step (see the restore below). Every edit waited for
   *  this answer (`draft-edit-gate.ts`), so the document holds nothing of
   *  this open's yet and the whole draft comes back. What it put back: what
   *  the restore's note may claim. */
  function restoreWork(waiting: NonNullable<typeof offered>): {
    placed: number;
    changed: number;
    deleted: number;
  } {
    const { objects, deleted } = waiting;
    // The deletions come back as the tombstones they are; the record's
    // frames come before the objects, whose records stand in them.
    const { work } = restoreWithSettings(
      ctx.tourDocument.state(),
      { objects, deleted },
      waiting.settings,
    );
    ctx.tourDocument.restore(
      {
        ...work,
        pictures: new Map(
          objects.flatMap((o) => {
            const blob = waiting.photos.get(o.id);
            return blob === undefined ? [] : [[o.id, blob] as const];
          }),
        ),
      },
      "the restored draft",
    );
    return {
      placed: waiting.counts.placed,
      changed: waiting.counts.changed,
      deleted: deleted.length,
    };
  }

  /** The offer as it shows: its own words, and when an edit waits for the
   *  answer, that it does. */
  function showOffer(waiting: NonNullable<typeof offered>): void {
    dom.draftOfferText.textContent = editWaits
      ? `${waiting.text} ${EDIT_WAITS}`
      : waiting.text;
    dom.draftOffer.hidden = false;
    // The offer is outside the AR overlay, so a creator whose scan opened
    // the tour mid-session would not see it and would place the same
    // content again - or would not know why a tap placed nothing.
    if (deps.sessionLive()) {
      // With the superseded line, which this note must not hide.
      ctx.placementNote = [
        editWaits ? EDIT_WAITS_IN_AR : OFFER_IN_AR,
        ...(supersededNote === null ? [] : [supersededNote]),
        ...(unreadNote === null ? [] : [unreadNote]),
      ].join(" ");
      deps.render();
    }
    // The offer lives inside step 4, which is usually COLLAPSED when a
    // tour opens (the wizard lands on the remembered step, or step 2).
    // Un-hiding an element inside a closed disclosure is zero pixels and
    // no signal, so the step is revealed - without collapsing whatever the
    // creator was reading.
    deps.wizard.revealStep("measure");
  }

  /** The gate's question (`DraftEditGate.hold`): an edit waits. Before the
   *  offer is ready (the draft still reading) a note says so, and the
   *  offer's words say it once it shows. */
  function askAboutEdit(): void {
    editWaits = true;
    if (offered !== null) {
      showOffer(offered);
      return;
    }
    ctx.placementNote = DRAFT_BEING_READ;
    deps.render();
  }

  /** The draft is decided (Restore, or a landed "Delete it"): the offer
   *  goes and the edits still waiting land, in the order they were made
   *  (none after a Restore, which dropped them first). */
  function decided(): void {
    dom.draftOffer.hidden = true;
    offered = null;
    editWaits = false;
    gate.release();
  }

  /** "Delete it" in progress (async-ui-feedback): no second answer
   *  meanwhile, and its label says it runs. */
  function setDiscarding(on: boolean): void {
    discarding = on;
    dom.draftDiscard.textContent = on ? DRAFT_DELETING : discardLabel;
    dom.draftRestore.disabled = on;
    dom.draftDismiss.disabled = on;
    dom.draftDiscard.disabled = on;
  }

  dom.draftRestore.addEventListener("click", () => {
    const waiting = offered;
    if (waiting === null || discarding) return;
    // Decided: the codes become this page's below (`restoreLevels`).
    if (undecided !== null) undecided.codes = null;
    // An edit that waited was built from the document before the draft
    // came back: replayed after it, it would write its old values over the
    // draft's. Dropped before anything is put back, and the note says so.
    const dropped = gate.drop();
    // Into the SAME document a live placement changes, so the finish needs
    // no second path: it writes these into the manifest exactly as it
    // writes anything else (an edit of a hosted object replaces it by id),
    // and the photo bytes as content entries. The document's listener
    // writes them to the draft again (the same records: harmless).
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
    // The draft is the document's now; new edits land on it.
    decided();
    // Render them, or the readout says "5 objects placed" over an empty
    // scene and the creator places them again - new ids, real duplicates
    // at the same spot in the published zip. The sync guards against a
    // dead scene, so this is safe outside a session too.
    deps.syncPreviews();
    // What was put back, not what was offered: a code measured here kept
    // its place, and a visit already held stayed.
    const back = restoredText(restored.placed, levelBack, {
      changed: restored.changed,
      deleted: restored.deleted,
      visits: visitsBack,
    });
    ctx.placementNote =
      dropped > 0 ? `${back} ${draftEditsMakeAgain(dropped)}` : back;
    deps.render();
  });

  dom.draftDismiss.addEventListener("click", () => {
    if (discarding) return;
    // Declining is NOT deleting: a mis-tap must not become the loss this
    // whole feature exists to prevent. The draft stays undecided: it is
    // offered again next time, and the next edit asks again. An edit that
    // waited is dropped - it was made over a draft nobody decided on - and
    // the creator is told.
    dom.draftOffer.hidden = true;
    editWaits = false;
    if (gate.drop() > 0) {
      ctx.placementNote = DRAFT_EDIT_NOT_APPLIED;
      deps.render();
    }
  });

  dom.draftDiscard.addEventListener("click", () => {
    const waiting = offered;
    const store = draftStore;
    // Assigned together with `draftStore` and cleared with it, so the url
    // is never missing while a store is there. Returning rather than
    // deleting is still the right branch: with no meta write there is no
    // commit point, and deleting without one is the shape that lost work
    // four times.
    const tourUrl = draftTourUrl;
    if (waiting === null || discarding) return;
    if (store === undefined || tourUrl === null) return;
    // The one way a creator can throw a draft away deliberately - and the
    // escape hatch for a draft that would otherwise be offered forever.
    //
    // DELETE WHAT WAS REJECTED, and nothing else: the ids come from the
    // offer, which is what `readDraft` returned (minus this page's visits,
    // `notLive`), so nothing this session wrote is ever a candidate for
    // deletion and nothing has to be put back. (Emptying the namespace and
    // writing back what should stay produced FOUR silent data-loss defects
    // here: each left a window in which the survivors existed only in
    // memory.)
    //
    // The meta is REWRITTEN rather than deleted, which also drops the
    // rejected level: `recordMeta` writes the code in hand, so a creator
    // who measured before tapping keeps THIS session's measurement.
    //
    // THAT WRITE IS THE COMMIT POINT. It carries the rejected ids, so the
    // next read refuses them whether or not their files are still there,
    // and the deletes after it are housekeeping. Nothing is removed BEFORE
    // the write lands, so a reload during it sees the draft as it was.
    const rejectedIds = notLive(waiting.storedIds);
    // In progress (async-ui-feedback): the offer stays, its buttons off,
    // until the commit says how it went. Edits keep waiting meanwhile.
    setDiscarding(true);
    // Assigned BEFORE the call, not after: a mint or finish issued in the
    // same tick must carry the rejection too, or its write would drop it.
    const wasRejected = draftRejected;
    draftRejected = rejectedIds;
    // ENQUEUED synchronously, with the values captured at the tap. The
    // chain guarantees ordering, not immediacy: the `put` itself is issued
    // from a `then`, so it is a microtask away at best (PR #457 review).
    const committed = recordMeta(tourUrl);
    // The draft's codes go with it once the commit LANDED: this page's
    // only, as they stood at the tap. Queued NOW, so a write of the codes
    // issued after the tap - live work, newer - lands after it, without
    // the rejected ones. A commit that did not land writes nothing: the
    // draft is still there, its codes with it.
    const held = undecided;
    const codesAtTap = pageCodes();
    void draftWrites
      .run(codesChainKey(tourUrl), async () => {
        if (!(await committed)) return false;
        if (held !== null) held.codes = null;
        return writeDraftCodes(store, codesAtTap);
      })
      .catch(() => false);
    void (async () => {
      const landed = await committed;
      const stillOpen = draftStore === store && draftTourUrl === tourUrl;
      if (stillOpen) setDiscarding(false);
      if (!landed) {
        // The rejection is not on disk, so it must not stay in memory: a
        // later mint or finish would write it and commit a discard this
        // branch reports as failed. Guarded on the tour still being open,
        // since a tour change has already reset the list from its own read.
        // The second write covers a payload ALREADY
        // queued behind this one: queued last, it lands last and puts the
        // old list back. Best-effort by nature, which is why the note below
        // is not conditional on it.
        if (stillOpen) {
          draftRejected = wasRejected;
          void recordMeta(tourUrl);
        }
        // ITS OWN NOTE, AND UNGATED: a tap the creator made deserves an
        // answer about that tap, every time it fails. The
        // question stays on screen and the waiting edits keep waiting: the
        // draft is still undecided.
        ctx.placementNote =
          "Could not delete the saved draft - it is still there, and will be offered again next time.";
        deps.render();
        return;
      }
      for (const id of rejectedIds) sweepRejected(store, tourUrl, id);
      // The record goes with the draft: every edit waited, so nothing of
      // this page's is in it. Queued before the waiting edits land, whose
      // own record lands after it.
      // Closed since the tap and opened again: that open read the record
      // and owns it now.
      const reopened =
        !stillOpen &&
        draftTourUrl !== null &&
        draftKeyForTour(draftTourUrl) === draftKeyForTour(tourUrl);
      if (!reopened) void writeSettings(store, tourUrl, null);
      if (stillOpen) decided();
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
    const epoch = presentEpoch;
    const stale = (): boolean =>
      generation !== ctx.openGeneration || epoch !== presentEpoch;
    // The tour as opened (M6 E2p): every hosted comparison below uses it,
    // never a manifest a Finish advanced meanwhile (the continuation is
    // this open's: `stale`).
    const opened = openedTour();
    supersededNote = null;
    unreadNote = null;
    // This open's holder (L2): its writes read its codes, whatever opens
    // after it.
    const held: CodesHolder = { codes: null };
    undecided = held;
    caughtUp = false;
    // Every edit of the tour document waits from here until this open's
    // draft is decided (`draft-edit-gate.ts`): no edit lands on a draft
    // nobody chose between. With nothing to offer the gate lets them
    // through at the end below.
    editWaits = false;
    gate.hold(askAboutEdit);
    readRunning = true;
    void (async (): Promise<boolean> => {
      const store = await deps.openDraftStore(draftKeyForTour(tourUrl));
      if (stale()) return false;
      // Before this page can write to it: no write of this open goes with
      // the draft.
      if (store !== undefined) await discardOlderFormatDraft(store);
      if (stale()) return false;
      draftStore = store;
      draftTourUrl = tourUrl;
      if (store === undefined) {
        // No persistence at all - a browser without OPFS, blocked site
        // data, a quota wall. The creator must hear it ONCE, here: this
        // is the path where they are least protected and least likely to
        // notice, because no write ever fails to tell them so.
        noteNoPersistence();
        return false;
      }
      // The stored codes FIRST, in their own queue and synchronously
      // queued: a write of the codes issued from here on runs after this
      // read, re-stating them (`writeCodes`).
      const codesRead = draftWrites.run(codesChainKey(tourUrl), async () => {
        const read = await readDraftCodes(store);
        held.codes =
          read.level === null && read.levels.length === 0 ? null : read;
      });
      // The settings record, in its own queue.
      let frameLost = false;
      let lost = false;
      const storedSettings = await draftWrites.run(
        settingsChainKey(tourUrl),
        async () => {
          const read = parseSettingsRecord(
            await store.getText(SETTINGS_KEY),
            opened ?? undefined,
            (what) => {
              lost = true;
              if (what === "frame") frameLost = true;
            },
          );
          return read;
        },
      );
      if (stale()) return false;
      if (lost) {
        unreadNote = DRAFT_PART_UNREAD;
        ctx.placementNote = unreadNote;
        deps.render();
      }
      await codesRead.catch(() => undefined);
      if (stale()) return false;
      const stored = await readDraft(store);
      if (stale()) return false;
      // A captured photo whose bytes did not read is dropped by the read
      // (its restore would name a content entry the zip lacks); the
      // creator is told, never left to find it gone (PR #876 review).
      if ((stored?.photosUnread ?? 0) > 0 && unreadNote === null) {
        unreadNote = DRAFT_PART_UNREAD;
        ctx.placementNote = unreadNote;
        deps.render();
      }
      // Per-tour state: never carry the previous tour's rejections into
      // this one's meta.
      draftRejected = stored?.rejectedIds ?? [];
      diskRejected = new Set(stored?.rejectedOnDisk ?? []);
      // The meta, stamped by this version (`writeDraftMeta`), once per
      // open: from here on the draft is this version's work, whatever its
      // object records. A deletion writes a tombstone and no meta, and a
      // restore or a code writes none either, so without this a draft of
      // older records plus such work read as an older version's
      // (`isOlderVersionDraft`), and refusing an older copy of the same
      // tour cleared it. With no draft yet it records what is already
      // known, so a crash before the first placement still leaves the tour
      // and the printed size behind.
      void recordMeta(tourUrl);
      // Deletes that did not finish last time. `rejectedIds` is exactly
      // the ids the meta rejects whose files are still on disk, so this
      // is the only thing that reclaims them - and it is safe to repeat,
      // because removing a key that is not there is not a failure.
      for (const id of draftRejected) sweepRejected(store, tourUrl, id);
      // This page's visits (M3b), made before the draft opened: the
      // draft keeps them, and a visit is no edit of the document (the
      // edits made meanwhile waited, and land once the draft is decided).
      for (const entry of deps.visitLog.entries()) {
        writeVisit(store, tourUrl, entry);
      }
      // From here a failing read below, or a slow hosted comparison,
      // leaves this page's work backed up: its edits wait for the gate,
      // which lets them through into this store.
      if (!stale()) caughtUp = true;
      if (stored === undefined) {
        // No draft yet, but there will be (its meta is written above): a
        // code measured before the open is recorded too.
        if (hasPageCodes()) void writeCodes(store, tourUrl, pageCodes(), held);
        return false;
      }
      // A newer edit elsewhere wins (M6 E2p, owner question Q-E2-2's
      // default): those records are not offered back, and the page says
      // so once.
      const superseded = draftObjectsSuperseded(stored.draft, opened);
      supersededNote =
        superseded.length === 0 ? null : supersededLine(superseded.length);
      if (supersededNote !== null) {
        ctx.placementNote = [unreadNote, supersededNote]
          .filter((line) => line !== null)
          .join(" ");
        deps.render();
        // Said once: the replaced records go.
        for (const id of notLive(superseded.map((o) => o.id))) {
          void writeForObject(store, tourUrl, id, (s) =>
            removeDraftObject(s, id).then(() => true),
          );
        }
      }
      const waiting = draftObjectsNotYetHosted(stored.draft, opened);
      const waitingDeletions = draftDeletionsNotYetHosted(stored.draft, opened);
      // The settings record by the desktop's rule: offered when it changes
      // anything the opened tour holds, or holds a station the draft's
      // objects name that the tour lacks - work like any other, so the
      // draft is not spent while it waits. The phone never edits the "no
      // GPS" setting, so a record's copy of it is no change: the tour's
      // own stands (an older copy would undo a change made elsewhere).
      const tour = opened ?? createEmptyTourManifest();
      const file = settingsOf(tour);
      const record =
        storedSettings === undefined
          ? undefined
          : heldAgainst(
              { ...storedSettings, needsNoGps: file.needsNoGps },
              tour,
            );
      const waitingSettings =
        record !== undefined &&
        (changesSettings(record, file) ||
          (waiting.length > 0 && addsStations(record, file)))
          ? record
          : undefined;
      // What the hosted zip stores for each of the draft's codes (M4c-1):
      // the content, read one by one like the one level was.
      const hostedTexts = new Map<string, string | null>();
      for (const level of draftLevels(stored.draft)) {
        hostedTexts.set(level.id, await hostedLevelJson(ctx.session, level.id));
      }
      const hostedLevel = (id: string): string | null =>
        hostedTexts.get(id) ?? null;
      if (stale()) return false;
      if (
        waitingSettings === undefined &&
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
        // Minus this page's visits (`notLive`); the edits made during the
        // awaits above waited, so none of them is in this list.
        const sweep = notLive(stored.storedIds);
        draftRejected = sweep;
        // Same commit point as the discard, for the same reason: an
        // interrupted sweep must not bring a spent draft back - and the
        // same notice when it does not land.
        if (!(await recordMeta(tourUrl))) {
          noteNoPersistence();
          return false;
        }
        if (stale()) return false;
        // Spent: the zip holds its codes, so nothing of them is re-stated;
        // the record keeps this page's own.
        held.codes = null;
        void writeCodes(store, tourUrl, pageCodes(), held);
        for (const id of sweep) sweepRejected(store, tourUrl, id);
        // The record is spent too: the opened tour carries its poses. Not
        // while a station in it did not read: it may read again against a
        // corrected file, and removing the record would take it for good.
        // Queued before the waiting edits land, whose record lands after.
        if (!frameLost) void writeSettings(store, tourUrl, null);
        return false;
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
      // An item a recorded frame moves between a story and the free items
      // is part of that frame's change, counted there (as on the desktop).
      const moved = movedIds(waitingSettings, tour);
      const edits = waiting.filter(
        (o) => hosted.key(o.id) !== undefined && !moved.has(o.id),
      ).length;
      const newOnes = waiting.filter(
        (o) => hosted.key(o.id) === undefined,
      ).length;
      const recordChanges =
        waitingSettings === undefined
          ? undefined
          : settingsChanges(waitingSettings, tour);
      const counts = {
        placed: newOnes,
        changed:
          edits +
          (recordChanges === undefined
            ? 0
            : settingsChangeCount(recordChanges)),
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
        settings: waitingSettings,
        text: "",
      };
      // The record's parts named as the desktop names them.
      const parts =
        recordChanges === undefined ? [] : settingsParts(recordChanges, "");
      offered.text = restoreOfferText(counts.placed, hasLevel, {
        changed: counts.changed,
        deleted: waitingDeletions.filter((id) => !moved.has(id)).length,
        visits: stored.visits.length,
      });
      if (parts.length > 0) {
        offered.text = `${offered.text} Changed: ${joinedParts(parts)}.`;
      }
      showOffer(offered);
      return true;
    })().then(
      (asked) => {
        // A stale open's end says nothing about the open tour: its gate
        // ended with it (`opened`, `closed`, `reset`).
        if (stale()) {
          // A teardown's read: nothing reads now unless a newer open does.
          if (!readRunning) clearBeingRead();
          return;
        }
        readRunning = false;
        caughtUp = true;
        // Nothing to decide: the edits that waited land, into this store,
        // and a note that the page was reading goes.
        if (asked) return;
        clearBeingRead();
        gate.release();
      },
      () => {
        if (stale()) {
          if (!readRunning) clearBeingRead();
          return;
        }
        readRunning = false;
        // A read that threw offers nothing: the waiting edits must not be
        // stranded behind a question nobody can see, nor the note that
        // said it was reading stand.
        clearBeingRead();
        gate.release();
      },
    );
  }

  /** The note that a draft is being read goes (its read ended). */
  function clearBeingRead(): void {
    if (ctx.placementNote !== DRAFT_BEING_READ) return;
    ctx.placementNote = null;
    deps.render();
  }

  function readyForAr(): boolean {
    const note = readRunning
      ? DRAFT_BEING_READ
      : discarding
        ? DRAFT_DELETE_RUNS
        : offered !== null
          ? DRAFT_DECIDE_BEFORE_AR
          : null;
    if (note === null) return true;
    if (note === DRAFT_DECIDE_BEFORE_AR && offered !== null) showOffer(offered);
    ctx.placementNote = note;
    deps.render();
    return false;
  }

  return {
    present,
    forgetRefused,
    readyForAr,
    reset: () => {
      supersededNote = null;
      unreadNote = null;
      // A write still queued for the closing tour keeps its own holder.
      undecided = null;
      caughtUp = false;
      // A continuation of the closing tour's `present` ends here.
      presentEpoch += 1;
      readRunning = false;
      // And its question: what waited for it is dropped with the tour.
      gate.drop();
      gate.release();
      editWaits = false;
      setDiscarding(false);
      finishedIds.clear();
      knownKeys.clear();
      forgottenIds.clear();
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
    recordVisit,
    // The document's writes (`draftObjectWrites`).
    write: draftWrite,
    writeObject: (object, blob) => {
      const seen = seenKey(object.id);
      return draftWrite(object.id, (s) => liveWrite(s, object, blob, seen));
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
        rememberKey(id, "written", key);
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
        rememberKey(id, "seen", key);
        return [draftWrite(id, (s) => addDraftBaseKey(s, id, "seen", key))];
      });
      return (await Promise.all(notes)).every(Boolean);
    },
    forgetObject: (id) => {
      const store = draftStore;
      const tourUrl = draftTourUrl;
      if (store === undefined || tourUrl === null) return Promise.resolve();
      // In the id's queue: a placement's write still in flight lands first,
      // and this removal after it (M4 review #7).
      return draftWrites.run(objectChainKey(tourUrl, id), async () => {
        await removeDraftObject(store, id);
        forgottenIds.add(id);
      });
    },
    follow,
    warnNoBackup: noteNoPersistence,
    persists: () => caughtUp && !warnedAboutPersistence,
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
      return writeSettings(store, tourUrl, settings).then((ok) => {
        if (!ok) noteNoPersistence();
        return ok;
      });
    },
  };
}
