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
 * @see editor-draft.ts.md
 */

import { AUTHOR_DEFAULT_SIZE_M } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import {
  draftDeletionsNotYetHosted,
  draftObjectsNotYetHosted,
  draftObjectsSuperseded,
  manifestAsRead,
  objectContentKey,
  restoreOfferText,
  supersededLine,
  withBaseKey,
  type DraftBase,
} from "../authoring-draft.js";
import type { DraftObjectWrites } from "../draft-actions.js";
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
  /** The offer's words: changes and deletions named apart
   *  (`restoreOfferText`). */
  readonly text: string;
}

export interface EditorDraftOpened {
  /** Null when there is nothing to offer. */
  readonly offer: EditorDraftOffer | null;
  /** Said once, when records gave way to newer edits in the file. */
  readonly superseded: string | null;
  /** This tab backs the edits up (it holds the draft, storage answered). */
  readonly backedUp: boolean;
}

export interface EditorDraft extends DraftObjectWrites {
  /** The writes for the tour open NOW (E2c review #6): once another tour
   *  opens they are dropped, so an old editor's late write never lands in
   *  the new tour's namespace. The session is given these. */
  writes(): DraftObjectWrites;
  /** A tour opened: hold its draft, read it, clear what the file carries,
   *  and say what to offer. Awaited before the tour shows. */
  open(fileKey: string, manifest: TourManifest): Promise<EditorDraftOpened>;
  /** The offer was restored (the session wrote what it applied). */
  restored(): void;
  /** "Delete it": the offer's records go, minus ids edited since the
   *  open; false when the rejection did not land (offered again). */
  discard(): Promise<boolean>;
  /** A save was built: its versions are this browser's own work. */
  built(written: TourManifest): void;
  /** An in-place write of `written` landed, whose bytes have `fileKey`:
   *  what it carries clears, and the draft follows the key. */
  landed(written: TourManifest, fileKey: string): void;
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
  } | null = null;
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

  /** The meta `readDraft` reads: the editor has no code to measure, so a
   *  default size and no level. Values captured now, written in order. */
  function writeMeta(s: Space): Promise<boolean> {
    const meta = {
      tourUrl: s.fileKey,
      sizeM: AUTHOR_DEFAULT_SIZE_M,
      level: null,
      rejected: s.rejected,
    };
    return track(
      chain.run(metaChain(s), async () => {
        const store = await s.store;
        return store !== undefined && (await writeDraftMeta(store, meta));
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
        if (s.rejected.includes(id)) {
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
    await inSpace(
      old,
      chain.run(metaChain(old), async () => {
        const store = await old.store;
        if (store !== undefined) await store.remove(META_KEY);
      }),
    );
  }

  function seenKey(id: string): string | undefined {
    const hosted = opened?.objects.find((o) => o.id === id);
    return hosted === undefined ? undefined : objectContentKey(hosted);
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
    if (s === null) return;
    // After its queued writes (E2c review #6): until they land, another
    // tab taking the draft would read it half written.
    letGo = s.store
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

  const api: EditorDraft = {
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
      // A photo note's bytes are in the opened file, never in the draft
      // (E2c review #1): its record is kept without them.
      const stored = await readDraft(store, { photoBytesRequired: false });
      if (mine !== generation) return none;
      if (stored === undefined) {
        void writeMeta(s);
        return { offer: null, superseded: null, backedUp: true };
      }
      for (const id of stored.storedIds) s.ids.add(id);
      // The pruned list, written back at once: a rejected id whose files
      // are gone must not stay in the meta, or a later edit of it - not
      // claimed, since the list no longer names it - would be hidden by
      // the next read.
      s.rejected = stored.rejectedIds;
      void writeMeta(s);
      const hostedIds = new Set(manifest.objects.map((o) => o.id));
      const notHosted = draftObjectsNotYetHosted(stored.draft, manifest);
      // The editor places nothing new: a record of an id the file no
      // longer carries is a note deleted elsewhere, given way to like a
      // replaced one.
      const waiting = notHosted.filter((o) => hostedIds.has(o.id));
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
      offer = kept.size === 0 ? null : { objects: waiting, deleted };
      return {
        offer:
          offer === null
            ? null
            : {
                ...offer,
                text: restoreOfferText(0, false, {
                  changed: waiting.length,
                  deleted: deleted.length,
                }),
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
      if (!(await writeMeta(s))) {
        s.rejected = before;
        void writeMeta(s);
        return false;
      }
      for (const id of ids) {
        void track(
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
      for (const [id, change] of pending) {
        if (change === null) continue;
        const object = read.objects.find((o) => o.id === id);
        if (object === undefined) continue;
        const key = objectContentKey(object);
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
      const hosted = new Map(
        read.objects.map((o) => [o.id, objectContentKey(o)]),
      );
      // What the file carries now is no longer pending; an edit made
      // while the save ran is.
      const spent = [...pending].flatMap(([id, change]) =>
        (
          change === null
            ? !hosted.has(id)
            : hosted.get(id) === objectContentKey(change)
        )
          ? [id]
          : [],
      );
      for (const id of spent) {
        pending.delete(id);
        bases.delete(id);
      }
      opened = read;
      if (editorDraftKey(fileKey) === s.key) {
        for (const id of spent) removeIn(s, id);
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
      }
      // The old namespace goes only once the new one holds everything
      // (E2c review #2): a tab closed right after "Saved to" - nothing
      // asks, no change is pending - must not find both half written.
      // When anything did not land the old one stays (its key is the
      // overwritten file's, so it is reached only by a copy of that file).
      void track(
        Promise.all(carried)
          .then(async (oks) => {
            if (oks.every(Boolean)) await empty(s);
          })
          .catch(() => undefined)
          .finally(() => {
            s.lock?.release();
          }),
      );
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
