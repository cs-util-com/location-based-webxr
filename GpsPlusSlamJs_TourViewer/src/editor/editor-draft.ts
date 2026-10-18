/**
 * The desktop editor's draft (M6 E2c): the edits since the opened file,
 * kept in this browser so a closed tab, a crash or a file that can no
 * longer be read does not lose them. The phone's records and rules
 * (`draft-persistence.ts`, `authoring-draft.ts`) under the editor's own
 * namespace, one tab at a time (a Web Lock on the draft key), and the
 * offer the next open of the same tour makes.
 *
 * WHAT THE DRAFT HOLDS, AND WHEN IT CLEARS (the E2c plan review #2). Every
 * edit since the OPENED FILE - not since the last save. Only an in-place
 * write that LANDED clears what it wrote (the file then carries it), or a
 * later open that finds the content in the file. A download clears
 * nothing: "the browser started the download" is all a page can know
 * (Firefox and Safari always say so), and whether the creator ever puts
 * the copy in place is never known. A build adds its versions to each
 * record's `written` list instead, so the copy put in place and reopened
 * still offers what came after it.
 *
 * WHY TWO BASE LISTS, NOT ONE (review #1, the E2p re-review's lesson). A
 * record is offered back only when the file's version of its object is
 * one this browser SAW in a file it opened or WROTE in a save; a version in
 * neither was made elsewhere, and the record is not offered (the file
 * wins, owner question Q-E2-2's default). One base per object loses work
 * in two ordinary walks: an in-place save and then an edit, and a save
 * built but never put in place. A deletion has no base: a restored
 * deletion deletes a newer edit made elsewhere (named, not covered).
 *
 * THE KEY (review #5, #6). The namespace is `editor:<file key>`
 * (`tour-file-key.ts`), never the phone's namespace for the same file. It
 * moves only after an in-place write that landed, to the key of the bytes
 * written (computed in the save path); the switch is synchronous, so every
 * later write goes to the new namespace, and the old one is emptied behind
 * its own queued writes. The draft key is also the Web Lock's: only the
 * tab holding it writes, and any other tab says it keeps no backup.
 *
 * THE SETTINGS (QR-first M1b-2). The tour-level settings the editor changes
 * - "needs no GPS" and, since W2 of the tour editor plan, the tour's
 * details (name, description, cover, contact) - are ONE record (`settings`) beside the
 * objects', by the same rules: kept while the file on disk does not carry
 * it (or a build wrote the other value, the "built but never put in place"
 * walk), offered by a later open whose file does not carry it, spent by one
 * that does, carried along by a key move, and thrown away by "Delete it"
 * unless changed since the open. The value last set here is kept, and the
 * keep is decided again whenever a build or a landed write changes what
 * it is measured against (M1b-2 milestone review #1: a setting turned
 * back while a save builds). No base, deliberately: a file that differs
 * from the record holds the other value, and this browser cannot tell
 * whether it saw or wrote that value or a colleague made it since - so
 * the offer NAMES the setting and its value (milestone review #3), and the
 * creator decides. Not covered, named: Restore of an offered setting can
 * undo a colleague's newer change of it when the creator does not notice
 * the named value; a version base for one boolean was declined as heavier
 * than that risk.
 *
 * @see editor-draft.ts.md
 */

import { AUTHOR_DEFAULT_SIZE_M } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import {
  tourItems,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { tourImageIds } from "gps-plus-slam-app-framework/ar/tour-details";
import {
  draftDeletionsNotYetHosted,
  draftObjectsNotYetHosted,
  draftObjectsSuperseded,
  hostedObjects,
  manifestAsRead,
  restoreOfferText,
  supersededLine,
  withBaseKey,
  type DraftBase,
} from "../authoring-draft.js";
import type { DraftObjectWrites } from "../draft-actions.js";
import {
  DETAIL_FIELDS,
  detailsOf,
  type TourDetailFields,
} from "../tour-details-form.js";
import {
  addDraftBaseKey,
  META_KEY,
  readDraft,
  removeDraftDeletion,
  removeDraftObject,
  writeDraftBase,
  writeDraftDeletion,
  writeDraftEdit,
  writeDraftMeta,
} from "../draft-persistence.js";
import { createKeyedChain } from "../keyed-chain.js";
import type { EditorLock } from "./save-target.js";

/** The tour-level settings the editor changes (QR-first M1b-2): what the
 *  draft's settings record holds. */
export interface EditorTourSettings {
  readonly needsNoGps: boolean;
  /** The tour's details as they stand (W2). Absent in a record written
   *  before the details existed, or before any was changed: no opinion
   *  about them, so it never offers to change (or blank) them. */
  readonly details?: TourDetailFields;
}

/** One of the details' fields (`tour-details-form.ts`), in the order the
 *  offer names them. */
type DetailField = (typeof DETAIL_FIELDS)[number];

/** Each field as the page names it (`edit.html`'s "Tour details"). */
const DETAIL_NAMES: Readonly<Record<DetailField, string>> = {
  title: "name",
  description: "description",
  cover: "cover",
  contact: "contact",
};

/** The fields `wanted` changes against `against`; none for a record
 *  without details (no opinion). */
function changedDetails(
  wanted: TourDetailFields | undefined,
  against: TourDetailFields | undefined,
): DetailField[] {
  if (wanted === undefined) return [];
  return DETAIL_FIELDS.filter((f) => wanted[f] !== against?.[f]);
}

/** Whether `wanted` changes anything `against` holds. */
function differs(
  wanted: EditorTourSettings,
  against: EditorTourSettings,
): boolean {
  return (
    wanted.needsNoGps !== against.needsNoGps ||
    changedDetails(wanted.details, against.details).length > 0
  );
}

/** Two records alike (null is "no record"). */
function sameRecord(
  a: EditorTourSettings | null,
  b: EditorTourSettings | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.needsNoGps !== b.needsNoGps) return false;
  if ((a.details === undefined) !== (b.details === undefined)) return false;
  return changedDetails(a.details, b.details).length === 0;
}

/** The settings record's file in a namespace. Not a prefix the phone's
 *  `readDraft` reads, so the shared reader skips it. */
const SETTINGS_KEY = "settings";

/** The setting's name as the page shows it (`edit.html`). */
const NO_GPS_LABEL = '"This tour needs no GPS"';

/** How the offer names its settings part: the setting, the details, or
 *  both (`restoredLine`). */
const NO_GPS_WHAT = `this tour's "needs no GPS" setting`;
const DETAILS_WHAT = "this tour's details";
const BOTH_WHAT = "this tour's settings";

/** What an offered record changes against the opened file: whether the
 *  setting, and which details. */
function settingsChanges(
  settings: EditorTourSettings,
  manifest: TourManifest,
): { readonly noGps: boolean; readonly details: DetailField[] } {
  const file = settingsOf(manifest);
  return {
    noGps: settings.needsNoGps !== file.needsNoGps,
    details: changedDetails(settings.details, file.details),
  };
}

/**
 * The offer's words (`restoreOfferText`), and - when it holds settings -
 * which and to what (M1b-2 milestone review #3; W2 names the details by
 * field): Restore then never puts a value back the creator did not see
 * named. Each changed detail counts as one change, as the session counts
 * it.
 */
function offerText(
  notes: number,
  deleted: number,
  settings: EditorTourSettings | undefined,
  manifest: TourManifest,
): string {
  const changes =
    settings === undefined ? null : settingsChanges(settings, manifest);
  const counted = restoreOfferText(0, false, {
    changed:
      notes +
      (changes === null ? 0 : (changes.noGps ? 1 : 0) + changes.details.length),
    deleted,
  });
  if (settings === undefined || changes === null) return counted;
  const noGps = `${NO_GPS_LABEL} turned ${settings.needsNoGps ? "on" : "off"}`;
  if (changes.details.length === 0) {
    return notes + deleted === 0
      ? `${counted} It is ${noGps}.`
      : `${counted} One of the changes is ${noGps}.`;
  }
  const details = `the tour's details (${changes.details
    .map((f) => DETAIL_NAMES[f])
    .join(", ")})`;
  return `${counted} Changed: ${changes.noGps ? `${noGps}, and ${details}` : details}.`;
}

/** `settingsWhat` of an offer that holds `settings`. */
function settingsWhatOf(
  settings: EditorTourSettings,
  manifest: TourManifest,
): string {
  const changes = settingsChanges(settings, manifest);
  if (changes.details.length === 0) return NO_GPS_WHAT;
  return changes.noGps ? BOTH_WHAT : DETAILS_WHAT;
}

/**
 * Said once an offer was restored: what came back, or - when nothing did,
 * live work having won - why, in the offer's own terms (M1b-2 milestone
 * review #6).
 */
export function restoredLine(
  count: number,
  offer: Pick<
    EditorDraftOffer,
    "objects" | "deleted" | "settings" | "settingsWhat"
  >,
): string {
  if (count > 0) {
    const back =
      count === 1
        ? "1 earlier change is"
        : `${String(count)} earlier changes are`;
    return `${back} back - not saved yet.`;
  }
  if (offer.settings === undefined) {
    return "Nothing was restored: the notes those changes were for are edited here already.";
  }
  const what = offer.settingsWhat ?? NO_GPS_WHAT;
  if (offer.objects.length + offer.deleted.length === 0) {
    return `Nothing was restored: ${what} ${what === NO_GPS_WHAT ? "is" : "are"} changed here already.`;
  }
  const part =
    what === NO_GPS_WHAT
      ? "the setting"
      : what === DETAILS_WHAT
        ? "the details"
        : "the settings";
  return `Nothing was restored: the notes and ${part} those changes were for are changed here already.`;
}

/**
 * `settings` as measured against `manifest`: a cover naming no image of
 * that file (a deleted photo) is no opinion about the cover - the file's
 * own stands - since no save could write it (M4a review #1: the record
 * kept the deleted photo's cover, and every later open offered a cover
 * change that Restore could not make).
 */
function heldAgainst(
  settings: EditorTourSettings,
  manifest: TourManifest,
): EditorTourSettings {
  const details = settings.details;
  const cover = details?.cover;
  if (details === undefined || cover === undefined) return settings;
  const images = tourImageIds({
    objects: tourItems(manifest),
    assets: manifest.assets,
  });
  if (images.has(cover)) return settings;
  const { cover: _gone, ...rest } = details;
  return {
    ...settings,
    details:
      manifest.cover === undefined ? rest : { ...rest, cover: manifest.cover },
  };
}

function settingsOf(manifest: TourManifest): EditorTourSettings {
  return {
    needsNoGps: manifest.needsNoGps === true,
    details: detailsOf(manifest),
  };
}

/** A stored record's details: undefined when absent, null when they do
 *  not read (a known field that is not a string). */
function parseDetails(value: unknown): TourDetailFields | undefined | null {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const details: Partial<Record<DetailField, string>> = {};
  for (const field of DETAIL_FIELDS) {
    const text = record[field];
    if (text === undefined) continue;
    if (typeof text !== "string") return null;
    details[field] = text;
  }
  return details;
}

/** A stored settings record; undefined for anything that does not read
 *  (a record that does not read costs itself). */
function parseSettings(
  text: string | undefined,
): EditorTourSettings | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const { needsNoGps } = record;
    const details = parseDetails(record["details"]);
    if (typeof needsNoGps !== "boolean" || details === null) return undefined;
    return details === undefined ? { needsNoGps } : { needsNoGps, details };
  } catch {
    return undefined;
  }
}

/** Every editor draft's namespace starts with this; the phone's never do
 *  (a link, or a file key, `tour-file-key.ts`). */
const EDITOR_DRAFT_PREFIX = "editor:";

/** The editor's draft namespace (and Web Lock key) for a file key. */
export function editorDraftKey(fileKey: string): string {
  return `${EDITOR_DRAFT_PREFIX}${fileKey}`;
}

/** Where `supersededLine` says the replaced changes were kept. */
const SUPERSEDED_WHERE = "in this browser";

/** Why this page keeps no backup copy: no storage (or a write that did
 *  not land), or another tab holds this tour's draft. */
export type NoBackupReason = "storage" | "other-tab";

export interface EditorDraftDeps {
  /** Open a draft namespace (`draft-store-root.ts`); undefined without
   *  persistence. */
  readonly openStore: (key: string) => Promise<DraftFileStore | undefined>;
  /** Hold the draft key for this tab (`holdEditorDraftLock`). */
  readonly holdLock: (key: string) => Promise<EditorLock>;
  /** Said once per opened tour: this page keeps no backup copy. */
  readonly noBackup: (reason: NoBackupReason) => void;
  /** Writes started (true) or all settled (false): the page's readiness
   *  mark. */
  readonly onWriting?: (writing: boolean) => void;
}

/** What an earlier visit left, offered back. */
export interface EditorDraftOffer {
  /** Edited or moved objects the opened file carries in another version. */
  readonly objects: readonly TourObject[];
  /** Deleted ids the opened file still carries. */
  readonly deleted: readonly string[];
  /** The tour's settings, when the opened file does not carry the draft's
   *  (QR-first M1b-2). */
  readonly settings?: EditorTourSettings;
  /** How the offer's settings part is named in plain words ("this tour's
   *  details"), present with `settings` (`restoredLine`). */
  readonly settingsWhat?: string;
  /** The offer's words: changes and deletions named apart
   *  (`restoreOfferText`); a changed setting, and each changed detail, is
   *  a change. */
  readonly text: string;
}

interface EditorDraftOpened {
  /** Null when there is nothing to offer. */
  readonly offer: EditorDraftOffer | null;
  /** Said once, when records gave way to newer edits in the file. */
  readonly superseded: string | null;
  /** This tab backs the edits up (it holds the draft, storage answered). */
  readonly backedUp: boolean;
}

/** The writes and a save's two notes for one opened tour (E2c review #6,
 *  the E2b-2 milestone review #1): once that tour closes or another opens,
 *  each is dropped, so a late write or save of the old tour never lands in
 *  the new tour's namespace, its seen versions or its key. */
/** The settings record's write (QR-first M1b-2). */
interface DraftSettingsWrites {
  /** The tour's settings as they stand now: kept while the file does not
   *  carry them, the record removed once it does. */
  saveSettings(settings: EditorTourSettings): Promise<boolean>;
}

export interface EditorTourDraft
  extends DraftObjectWrites, DraftSettingsWrites {
  /** A save was built: its versions are this browser's own work. */
  built(written: TourManifest): void;
  /** An in-place write of `written` landed, whose bytes have `fileKey`:
   *  what it carries clears, and the draft follows the key. */
  landed(written: TourManifest, fileKey: string): void;
}

export interface EditorDraft extends DraftObjectWrites, DraftSettingsWrites {
  /** The writes, and a save's notes, for the tour open NOW: the session is
   *  given the writes, the page's save path the notes. */
  writes(): EditorTourDraft;
  /** A tour opened: hold its draft, read it, clear what the file carries,
   *  and say what to offer. Awaited before the tour shows. */
  open(fileKey: string, manifest: TourManifest): Promise<EditorDraftOpened>;
  /** The offer was restored (the session wrote what it applied). */
  restored(): void;
  /** "Delete it": the offer's records go, minus ids edited since the
   *  open; false when the rejection did not land (offered again). */
  discard(): Promise<boolean>;
  /** Whether this tab backs the open tour's edits up. */
  backsUp(): boolean;
  /** The tour closed: the hold goes. */
  close(): void;
  /** Every queued write settled. */
  idle(): Promise<void>;
}

/** One namespace: its key, its store (after the lock), its rejections. */
interface Space {
  readonly key: string;
  readonly fileKey: string;
  store: Promise<DraftFileStore | undefined>;
  lock: EditorLock | null;
  /** Why `store` is undefined, once known. */
  refused: NoBackupReason | null;
  /** The ids the meta rejects ("Delete it"); a write of one claims it. */
  rejected: readonly string[];
  /** Every id the meta ON DISK rejects, until a meta write lands: the open
   *  prunes `rejected` to the ids that still have files, and a write of an
   *  id only the unpruned meta names is claimed too, or a pruning write
   *  that did not land would hide it (PR #622 bot finding A; the phone's
   *  `rejectedOnDisk`). */
  rejectedOnDisk: ReadonlySet<string>;
  /** Every id with files here: what a key move empties. */
  readonly ids: Set<string>;
  /** Its writes not yet settled: the hold goes only after them. */
  readonly work: Set<Promise<unknown>>;
}

export function createEditorDraft(deps: EditorDraftDeps): EditorDraft {
  const chain = createKeyedChain();
  let space: Space | null = null;
  /** The file as it is on disk now: the opened one, then each in-place
   *  write that landed - what an edit's `seen` version is read from. */
  let opened: TourManifest | null = null;
  /** Per id, this page's latest change since the opened file: the object,
   *  or null for a deletion. */
  const pending = new Map<string, TourObject | null>();
  /** Every id this page wrote since the open: live work, which wins over
   *  the offer and is never rejected with it. */
  const touched = new Set<string>();
  /** The bases as written (a mirror, for a key move). */
  const bases = new Map<string, DraftBase>();
  /** The offer, until restored or deleted ("Not now" keeps it). */
  let offer: {
    readonly objects: readonly TourObject[];
    readonly deleted: readonly string[];
    readonly settings?: EditorTourSettings;
  } | null = null;
  /** The settings record this page keeps (THE SETTINGS), or null. */
  let settingsPending: EditorTourSettings | null = null;
  /** The settings as last set here since the open, or null: live work,
   *  which wins over the offer and is never thrown away with it. Kept
   *  whether or not its record is, so a build or a landed write can decide
   *  the keep again (M1b-2 milestone review #1). */
  let settingsWanted: EditorTourSettings | null = null;
  /** The manifests builds wrote since the open (their settings, and the
   *  images a recorded cover is measured against): a change back to the
   *  file's value still differs from a built copy that may be put in
   *  place, so its record is kept (review #1's walk, for the settings). */
  const built: TourManifest[] = [];

  /** Whether `settings` must be kept: the file on disk differs, or a
   *  build wrote other values (THE SETTINGS). */
  function keepSettings(settings: EditorTourSettings): boolean {
    return (
      opened === null ||
      differs(heldAgainst(settings, opened), settingsOf(opened)) ||
      built.some((b) => differs(heldAgainst(settings, b), settingsOf(b)))
    );
  }

  /** The keep decided again for the value last set here, after a build or
   *  a landed write changed what it is measured against; whether the
   *  record must now be written (`settingsPending`) or removed (null). */
  function redecideSettings(): boolean {
    const wanted = settingsWanted;
    if (wanted === null) return false;
    const next = keepSettings(wanted) ? wanted : null;
    if (sameRecord(next, settingsPending)) return false;
    settingsPending = next;
    return true;
  }
  let told = false;
  let generation = 0;
  /** When the last tour's hold let go: the next open waits for it (the
   *  same file again in the same tab is not "another tab"). */
  let letGo: Promise<void> = Promise.resolve();
  let writing = 0;
  let waiters: (() => void)[] = [];

  /** Said once per opened tour, and only about the space the page writes
   *  now: a late failure of a closed tour's write does not use up the new
   *  tour's line (E2c review #6). */
  function say(s: Space, reason: NoBackupReason): void {
    if (s !== space || told) return;
    told = true;
    deps.noBackup(reason);
  }

  function track<T>(work: Promise<T>): Promise<T> {
    writing += 1;
    if (writing === 1) deps.onWriting?.(true);
    const settled = (): void => {
      writing -= 1;
      if (writing > 0) return;
      deps.onWriting?.(false);
      const done = waiters;
      waiters = [];
      for (const wake of done) wake();
    };
    work.then(settled, settled);
    return work;
  }

  function makeSpace(fileKey: string): Space {
    const key = editorDraftKey(fileKey);
    const made: Space = {
      key,
      fileKey,
      store: Promise.resolve(undefined),
      lock: null,
      refused: null,
      rejected: [],
      rejectedOnDisk: new Set(),
      ids: new Set(),
      work: new Set(),
    };
    made.store = (async () => {
      const lock = await deps.holdLock(key).catch(() => null);
      if (lock === null || !lock.granted) {
        made.refused = lock === null ? "storage" : "other-tab";
        return undefined;
      }
      made.lock = lock;
      const store = await deps.openStore(key).catch(() => undefined);
      if (store === undefined) made.refused = "storage";
      return store;
    })();
    return made;
  }

  function metaChain(s: Space): string {
    return JSON.stringify([s.key, "meta"]);
  }
  function objectChain(s: Space, id: string): string {
    return JSON.stringify([s.key, "object", id]);
  }
  function settingsChain(s: Space): string {
    return JSON.stringify([s.key, "settings"]);
  }

  /** `s`'s settings record written (`value`) or removed (null), in its
   *  own queue; whether it landed. Not said: callers say what they ask. */
  function settingsIn(
    s: Space,
    value: EditorTourSettings | null,
  ): Promise<boolean> {
    return inSpace(
      s,
      chain.run(settingsChain(s), async () => {
        const store = await s.store;
        if (store === undefined) return false;
        if (value === null) {
          await store.remove(SETTINGS_KEY);
          return true;
        }
        return store.put(SETTINGS_KEY, JSON.stringify(value));
      }),
    ).catch(() => false);
  }

  /** `settingsIn`, and a write that did not land said, once. */
  function writeSettingsIn(
    s: Space,
    value: EditorTourSettings | null,
  ): Promise<boolean> {
    return settingsIn(s, value).then((ok) => {
      if (!ok) say(s, s.refused ?? "storage");
      return ok;
    });
  }

  /** The meta `readDraft` reads: the editor has no code to measure, so a
   *  default size and no level. Values captured now, written in order;
   *  counted among `s`'s writes, so a close lets the hold go only after it
   *  landed - "Delete it"'s commit point among them (PR #622 bot finding
   *  B). */
  function writeMeta(s: Space): Promise<boolean> {
    const rejected = s.rejected;
    const meta = {
      tourUrl: s.fileKey,
      sizeM: AUTHOR_DEFAULT_SIZE_M,
      level: null,
      rejected,
    };
    return inSpace(
      s,
      chain.run(metaChain(s), async () => {
        const store = await s.store;
        const ok = store !== undefined && (await writeDraftMeta(store, meta));
        if (ok) s.rejectedOnDisk = new Set(rejected);
        return ok;
      }),
    ).catch(() => false);
  }

  /**
   * Run `task` for object `id` in `s`'s queue. An id the meta rejects is
   * CLAIMED first - its files removed, the meta rewritten without it - so
   * the change is newer than the rejection and the next read sees it (the
   * phone's `creator-draft.ts` rule, M4 review #1).
   */
  /** `work` counted for `idle` and for `s`'s hold. */
  function inSpace<T>(s: Space, work: Promise<T>): Promise<T> {
    s.work.add(work);
    const done = (): void => {
      s.work.delete(work);
    };
    work.then(done, done);
    return track(work);
  }

  /** Every write of `s` settled, those queued meanwhile too. */
  async function drained(s: Space): Promise<void> {
    while (s.work.size > 0) await Promise.allSettled([...s.work]);
  }

  function inQueue(
    s: Space,
    id: string,
    task: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    s.ids.add(id);
    return inSpace(
      s,
      chain.run(objectChain(s, id), async () => {
        const store = await s.store;
        if (store === undefined) return false;
        let claimed = true;
        if (s.rejected.includes(id) || s.rejectedOnDisk.has(id)) {
          await removeDraftObject(store, id);
          s.rejected = s.rejected.filter((r) => r !== id);
          claimed = await writeMeta(s);
        }
        return (await task(store)) && claimed;
      }),
    ).catch(() => false);
  }

  /** `inQueue`, and a write that did not land said, once. */
  function writeIn(
    s: Space,
    id: string,
    task: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    return inQueue(s, id, task).then((ok) => {
      if (!ok) say(s, s.refused ?? "storage");
      return ok;
    });
  }

  /** A write the page asked for, in the open tour's namespace. True with
   *  no tour open: there is nothing to back up. */
  function write(
    id: string,
    task: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    const s = space;
    return s === null ? Promise.resolve(true) : writeIn(s, id, task);
  }

  function removeIn(s: Space, id: string): void {
    void inQueue(s, id, (store) =>
      removeDraftObject(store, id).then(() => true),
    );
  }

  /**
   * `id`'s change written into `s` with its base (a key move); whether it
   * landed. NOT a claim: an id "Delete it" rejected since the move is
   * skipped, never brought back (E2c review #5).
   */
  function carry(
    s: Space,
    id: string,
    change: TourObject | null,
    base: DraftBase | undefined,
  ): Promise<boolean> {
    s.ids.add(id);
    return inSpace(
      s,
      chain.run(objectChain(s, id), async () => {
        if (s.rejected.includes(id)) return true;
        const store = await s.store;
        if (store === undefined) return false;
        const wrote =
          change === null
            ? await writeDraftDeletion(store, id)
            : await writeDraftEdit(store, change, undefined, undefined);
        // After the record: a record without its base is never superseded.
        if (base !== undefined) await writeDraftBase(store, id, base);
        return wrote;
      }),
    )
      .catch(() => false)
      .then((ok) => {
        if (!ok) say(s, s.refused ?? "storage");
        return ok;
      });
  }

  /** The old namespace emptied behind its own queued writes, its meta
   *  last. Run only once everything it held landed in the new one. */
  async function empty(old: Space): Promise<void> {
    await Promise.all(
      [...old.ids].map((id) =>
        inSpace(
          old,
          chain.run(objectChain(old, id), async () => {
            const store = await old.store;
            if (store !== undefined) await removeDraftObject(store, id);
          }),
        ),
      ),
    );
    await settingsIn(old, null);
    await inSpace(
      old,
      chain.run(metaChain(old), async () => {
        const store = await old.store;
        if (store !== undefined) await store.remove(META_KEY);
      }),
    );
  }

  function seenKey(id: string): string | undefined {
    return hostedObjects(opened).key(id);
  }

  function close(): void {
    generation += 1;
    const s = space;
    space = null;
    opened = null;
    offer = null;
    pending.clear();
    touched.clear();
    bases.clear();
    settingsPending = null;
    settingsWanted = null;
    built.length = 0;
    if (s === null) return;
    // After its queued writes (E2c review #6): until they land, another
    // tab taking the draft would read it half written. Chained on the last
    // hold's let-go, which a key move may still be running (PR #626 bot
    // finding 2).
    letGo = letGo
      .then(() => s.store)
      .then(() => drained(s))
      .then(async () => {
        s.lock?.release();
        await s.lock?.released;
      });
  }

  const none: EditorDraftOpened = {
    offer: null,
    superseded: null,
    backedUp: false,
  };

  // `built` and `landed` are reached only through `writes()`, bound to the
  // tour open when it was called.
  const api: EditorDraft & Pick<EditorTourDraft, "built" | "landed"> = {
    async open(fileKey, manifest) {
      close();
      const mine = generation;
      told = false;
      opened = manifest;
      await letGo;
      if (mine !== generation) return none;
      const s = makeSpace(fileKey);
      space = s;
      const store = await s.store;
      if (mine !== generation) return none;
      if (store === undefined) {
        say(s, s.refused ?? "storage");
        return none;
      }
      // The settings record (THE SETTINGS), read whether or not a meta
      // landed: its namespace already names the tour. Offered while the
      // file does not carry it; spent or unreadable, it goes.
      const settingsText = await store.getText(SETTINGS_KEY);
      if (mine !== generation) return none;
      const readSettings = parseSettings(settingsText);
      const storedSettings =
        readSettings === undefined
          ? undefined
          : heldAgainst(readSettings, manifest);
      const settings =
        storedSettings !== undefined &&
        differs(storedSettings, settingsOf(manifest))
          ? storedSettings
          : undefined;
      /** The offer's words, and how its settings part is named. */
      const offerWords = (
        notes: number,
        gone: number,
      ): { text: string; settingsWhat?: string } => ({
        text: offerText(notes, gone, settings, manifest),
        ...(settings === undefined
          ? {}
          : { settingsWhat: settingsWhatOf(settings, manifest) }),
      });
      if (settingsText !== undefined && settings === undefined) {
        void settingsIn(s, null);
      }
      // A photo note's bytes are in the opened file, never in the draft
      // (E2c review #1): its record is kept without them.
      const stored = await readDraft(store, { photoBytesRequired: false });
      if (mine !== generation) return none;
      if (stored === undefined) {
        // Said when it does not land, as the pruning write below is: the
        // shared reader reads nothing without a meta, so the namespace
        // would be unreadable while the page claimed a backup (PR #626 bot
        // finding 1). Tracked with its line, so `idle()` covers the saying.
        void track(
          writeMeta(s).then((ok) => {
            if (!ok) say(s, s.refused ?? "storage");
          }),
        );
        offer =
          settings === undefined
            ? null
            : { objects: [], deleted: [], settings };
        return {
          offer: offer === null ? null : { ...offer, ...offerWords(0, 0) },
          superseded: null,
          backedUp: true,
        };
      }
      for (const id of stored.storedIds) s.ids.add(id);
      // The pruned list, written back at once: a rejected id whose files
      // are gone must not stay in the meta. Until that write lands, a
      // later edit of such an id is claimed against the meta on disk
      // (`rejectedOnDisk`), and a write that did not land is said.
      s.rejected = stored.rejectedIds;
      s.rejectedOnDisk = new Set(stored.rejectedOnDisk);
      // Tracked with its line, so `idle()` covers the saying too.
      void track(
        writeMeta(s).then((ok) => {
          if (!ok) say(s, s.refused ?? "storage");
        }),
      );
      const hosted = hostedObjects(manifest);
      const notHosted = draftObjectsNotYetHosted(stored.draft, manifest);
      // The editor places nothing new: a record of an id the file no
      // longer carries is a note deleted elsewhere, given way to like a
      // replaced one.
      const waiting = notHosted.filter((o) => hosted.key(o.id) !== undefined);
      const replaced =
        draftObjectsSuperseded(stored.draft, manifest).length +
        (notHosted.length - waiting.length);
      const deleted = draftDeletionsNotYetHosted(stored.draft, manifest);
      const kept = new Set([...waiting.map((o) => o.id), ...deleted]);
      // Everything else the read saw is in the file already, replaced, or
      // unreadable: it goes (no commit point needed - each leftover is
      // inert and goes again on the next open).
      for (const id of stored.storedIds) if (!kept.has(id)) removeIn(s, id);
      for (const id of kept) {
        const base = stored.draft.bases?.get(id);
        if (base !== undefined) bases.set(id, base);
      }
      offer =
        kept.size === 0 && settings === undefined
          ? null
          : {
              objects: waiting,
              deleted,
              ...(settings === undefined ? {} : { settings }),
            };
      return {
        offer:
          offer === null
            ? null
            : {
                ...offer,
                ...offerWords(waiting.length, deleted.length),
              },
        superseded:
          replaced === 0 ? null : supersededLine(replaced, SUPERSEDED_WHERE),
        backedUp: true,
      };
    },

    writes() {
      const mine = generation;
      const live = (): boolean => mine === generation;
      return {
        saveObject: (object, blob) =>
          live() ? api.saveObject(object, blob) : Promise.resolve(true),
        saveDeletion: (id) =>
          live() ? api.saveDeletion(id) : Promise.resolve(true),
        forgetDeletion: (id) =>
          live() ? api.forgetDeletion(id) : Promise.resolve(true),
        forgetObject: (id) =>
          live() ? api.forgetObject(id) : Promise.resolve(),
        saveSettings: (settings) =>
          live() ? api.saveSettings(settings) : Promise.resolve(true),
        built: (written) => {
          if (live()) api.built(written);
        },
        landed: (written, fileKey) => {
          if (live()) api.landed(written, fileKey);
        },
      };
    },

    restored() {
      offer = null;
    },

    async discard() {
      const s = space;
      const was = offer;
      offer = null;
      if (s === null || was === null) return true;
      // Minus what was edited since the open: that is live work now.
      const ids = [...was.objects.map((o) => o.id), ...was.deleted].filter(
        (id) => !touched.has(id),
      );
      const before = s.rejected;
      s.rejected = [...new Set([...before, ...ids])];
      // THE COMMIT POINT: once the meta rejects them, the next read
      // refuses them whether or not the removals below ran.
      // A rejection that did not land throws nothing away: the meta is
      // put back and the offer re-armed - a key move before the next open
      // still carries it - and the page says so.
      const fail = (): false => {
        s.rejected = before;
        void writeMeta(s);
        offer = was;
        return false;
      };
      if (!(await writeMeta(s))) return fail();
      // The offered settings record goes too, unless changed since the
      // open (live work): awaited, inside the namespace's work, so "Delete
      // it" is done only once it went, and a removal that did not land
      // fails it like the meta (M1b-2 milestone review #4).
      if (
        was.settings !== undefined &&
        settingsWanted === null &&
        !(await settingsIn(s, null))
      ) {
        return fail();
      }
      for (const id of ids) {
        // Counted among the namespace's writes, like the meta (finding B).
        void inSpace(
          s,
          chain.run(objectChain(s, id), async () => {
            // A change made since claimed the id: its files are the
            // change's now.
            if (!s.rejected.includes(id)) return;
            const store = await s.store;
            if (store !== undefined) await removeDraftObject(store, id);
          }),
        ).catch(() => undefined);
      }
      return true;
    },

    built(written) {
      const s = space;
      if (s === null) return;
      // As a reader of the written file sees it (the E2p third review #5).
      const read = manifestAsRead(written);
      built.push(read);
      const readObjects = hostedObjects(read);
      // A setting turned back while this save built is measured against
      // the build now (M1b-2 milestone review #1).
      if (redecideSettings()) void writeSettingsIn(s, settingsPending);
      for (const [id, change] of pending) {
        if (change === null) continue;
        const key = readObjects.key(id);
        if (key === undefined) continue;
        bases.set(id, withBaseKey(bases.get(id), "written", key));
        // Not said when it fails: a base that did not land is removed,
        // and no base is never superseded.
        void inQueue(s, id, (store) =>
          addDraftBaseKey(store, id, "written", key),
        );
      }
    },

    landed(written, fileKey) {
      const s = space;
      if (s === null) return;
      const read = manifestAsRead(written);
      const hosted = hostedObjects(read);
      // What the file carries now is no longer pending; an edit made
      // while the save ran is.
      const spent = [...pending].flatMap(([id, change]) =>
        (change === null ? hosted.key(id) === undefined : hosted.holds(change))
          ? [id]
          : [],
      );
      for (const id of spent) {
        pending.delete(id);
        bases.delete(id);
      }
      opened = read;
      // The settings decided again against the file on disk now: spent
      // when it carries them, kept when it does not (M1b-2 milestone
      // review #1); a key move below carries what is kept.
      const settingsChanged = redecideSettings();
      if (editorDraftKey(fileKey) === s.key) {
        for (const id of spent) removeIn(s, id);
        if (settingsChanged) void writeSettingsIn(s, settingsPending);
        return;
      }
      // The key moves (a tour of notes alone): synchronously, so every
      // write from here on goes to the new namespace.
      const next = makeSpace(fileKey);
      space = next;
      const carried = [writeMeta(next)];
      for (const [id, change] of pending) {
        carried.push(carry(next, id, change, bases.get(id)));
      }
      if (settingsPending !== null) {
        carried.push(writeSettingsIn(next, settingsPending));
      }
      // An offer not yet answered (or put off with "Not now") moves too.
      if (offer !== null) {
        for (const object of offer.objects) {
          if (!touched.has(object.id)) {
            carried.push(carry(next, object.id, object, bases.get(object.id)));
          }
        }
        for (const id of offer.deleted) {
          if (!touched.has(id)) carried.push(carry(next, id, null, undefined));
        }
        if (offer.settings !== undefined && settingsWanted === null) {
          carried.push(writeSettingsIn(next, offer.settings));
        }
      }
      // The old namespace goes only once the new one holds everything
      // (E2c review #2): a tab closed right after "Saved to" - nothing
      // asks, no change is pending - must not find both half written.
      // When anything did not land the old one stays (its key is the
      // overwritten file's, so it is reached only by a copy of that file).
      const moved = Promise.all(carried)
        .then(async (oks) => {
          if (oks.every(Boolean)) await empty(s);
        })
        .catch(() => undefined)
        .finally(() => {
          s.lock?.release();
        });
      void track(moved);
      // The next open waits for the old key's hold to go, as after
      // `close()`: the pre-save file reopened in this tab must not find
      // this tab's own hold and say "another tab" (PR #626 bot finding 2).
      letGo = letGo
        .then(() => moved)
        .then(async () => {
          await s.lock?.released;
        });
    },

    backsUp() {
      return space !== null && space.refused === null && !told;
    },

    close,

    idle() {
      if (writing === 0) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },

    saveObject(object, blob) {
      const id = object.id;
      pending.set(id, object);
      touched.add(id);
      const seen = seenKey(id);
      if (seen !== undefined) {
        bases.set(id, withBaseKey(bases.get(id), "seen", seen));
      }
      return write(id, (store) => writeDraftEdit(store, object, blob, seen));
    },
    saveDeletion(id) {
      pending.set(id, null);
      touched.add(id);
      return write(id, (store) => writeDraftDeletion(store, id));
    },
    forgetDeletion(id) {
      if (pending.get(id) === null) pending.delete(id);
      touched.add(id);
      return write(id, (store) => removeDraftDeletion(store, id));
    },
    saveSettings(settings) {
      settingsWanted = settings;
      // Kept while the file on disk differs, or a build wrote other
      // values (THE SETTINGS); else the record goes.
      settingsPending = keepSettings(settings) ? settings : null;
      const s = space;
      return s === null
        ? Promise.resolve(true)
        : writeSettingsIn(s, settingsPending);
    },
    forgetObject(id) {
      pending.delete(id);
      touched.add(id);
      return write(id, (store) =>
        removeDraftObject(store, id).then(() => true),
      ).then(() => undefined);
    },
  };
  return api;
}
