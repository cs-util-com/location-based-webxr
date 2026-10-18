/**
 * Why these tests matter (M6 E2c): the desktop editor's draft is what
 * keeps a creator's edits when the tab closes, the browser crashes, or the
 * opened file stops reading. Its failure modes are quiet, and the cold
 * review of its plan found each of these in the plan as first written:
 *
 * - ONE base per object loses work (an in-place save then an edit; a save
 *   built but never put in place) - the two-list base (#1);
 * - clearing on a download loses work: "delivered" only means the browser
 *   started it (#2);
 * - sharing the phone's namespace lets each page's sweeps take the other's
 *   records (#3);
 * - a key that moves at the wrong time, or a move racing queued writes,
 *   strands the draft under a key no file opens as (#5);
 * - a second tab writing the same draft (#6);
 * - an offer that loses records the creator never answered (#7).
 *
 * In-memory stores with the OPFS store's contract, one per namespace, so
 * two drafts made in turn behave like two page loads of one browser.
 */
import { describe, expect, it } from "vitest";
import {
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { recordUndoDelete } from "../draft-actions.js";
import { META_KEY, objectKey, readDraft } from "../draft-persistence.js";
import {
  createEditorDraft,
  editorDraftKey,
  restoredLine,
  type EditorDraft,
  type NoBackupReason,
} from "./editor-draft.js";
import type { EditorLock } from "./save-target.js";
import { tourOf } from "../test-support/v3-tour.js";
import { hostedObjects } from "../authoring-draft.js";

/** One browser's draft directories: namespace -> files. `failIn` makes
 *  one namespace's writes refuse; `holdPuts` holds every write until
 *  `releasePuts`; `holdOpenOf` holds a namespace's open until
 *  `releaseOpens` - the order a key move's writes land in; `failMetaPuts`
 *  refuses that many of the next meta writes; `failRemoveOf` makes a
 *  removal of those keys throw (a store breaking its never-throws
 *  contract: the one way a removal can be seen not to land). */
function browser(): {
  spaces: Map<string, Map<string, Blob | string>>;
  open: (key: string) => Promise<DraftFileStore | undefined>;
  failWrites: boolean;
  failIn: Set<string>;
  holdPuts: boolean;
  releasePuts: (ok?: boolean) => void;
  holdOpenOf: Set<string>;
  releaseOpens: () => void;
  failMetaPuts: number;
  failRemoveOf: Set<string>;
} {
  const spaces = new Map<string, Map<string, Blob | string>>();
  const heldPuts: ((ok: boolean) => void)[] = [];
  const heldOpens: (() => void)[] = [];
  const state = {
    spaces,
    failWrites: false,
    failIn: new Set<string>(),
    holdPuts: false,
    releasePuts: (ok = true) => {
      state.holdPuts = false;
      for (const land of heldPuts.splice(0)) land(ok);
    },
    failMetaPuts: 0,
    failRemoveOf: new Set<string>(),
    holdOpenOf: new Set<string>(),
    releaseOpens: () => {
      state.holdOpenOf.clear();
      for (const land of heldOpens.splice(0)) land();
    },
    open: (key: string): Promise<DraftFileStore | undefined> => {
      const files = spaces.get(key) ?? new Map<string, Blob | string>();
      spaces.set(key, files);
      const store: DraftFileStore = {
        put: (k, data) => {
          if (state.failWrites || state.failIn.has(key)) {
            return Promise.resolve(false);
          }
          if (k === META_KEY && state.failMetaPuts > 0) {
            state.failMetaPuts -= 1;
            return Promise.resolve(false);
          }
          if (state.holdPuts) {
            return new Promise((resolve) => {
              heldPuts.push((ok) => {
                if (ok) files.set(k, data as Blob | string);
                resolve(ok);
              });
            });
          }
          files.set(k, data as Blob | string);
          return Promise.resolve(true);
        },
        remove: (k) => {
          if (state.failRemoveOf.has(k)) {
            return Promise.reject(new Error("the removal failed"));
          }
          files.delete(k);
          return Promise.resolve();
        },
        getText: async (k) => {
          const v = files.get(k);
          return v === undefined
            ? undefined
            : typeof v === "string"
              ? v
              : v.text();
        },
        getBlob: (k) => {
          const v = files.get(k);
          return Promise.resolve(
            v === undefined
              ? undefined
              : typeof v === "string"
                ? new Blob([v])
                : v,
          );
        },
        keys: () => Promise.resolve([...files.keys()]),
        clear: () => {
          files.clear();
          return Promise.resolve();
        },
      };
      if (state.holdOpenOf.has(key)) {
        return new Promise((resolve) => {
          heldOpens.push(() => {
            resolve(store);
          });
        });
      }
      return Promise.resolve(store);
    },
  };
  return state;
}

/** A lock manager for one browser: one holder per key. */
function locks(): (key: string) => Promise<EditorLock> {
  const held = new Set<string>();
  return (key) => {
    if (held.has(key)) {
      return Promise.resolve({
        granted: false,
        release: () => undefined,
        released: Promise.resolve(),
      });
    }
    held.add(key);
    return Promise.resolve({
      granted: true,
      release: () => {
        held.delete(key);
      },
      released: Promise.resolve(),
    });
  };
}

function draftIn(
  b: ReturnType<typeof browser>,
  holdLock = locks(),
): EditorDraft & { said: NoBackupReason[] } {
  const said: NoBackupReason[] = [];
  const draft = createEditorDraft({
    openStore: b.open,
    holdLock,
    noBackup: (reason) => {
      said.push(reason);
    },
  });
  return Object.assign(draft, { said });
}

function pin(id: string, label = id): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-14T00:00:00.000Z",
    geo: { lat: 48.5, lon: 9.0, alt: 340, headingDeg: 0 },
  };
}

function photo(id: string, lat = 48.5): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-14T00:00:00.000Z",
    geo: { lat, lon: 9.0, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

function tour(...objects: TourObject[]): TourManifest {
  return tourOf(objects);
}

const K1 = "local-file:00000000000000000000000000000001";
const K2 = "local-file:00000000000000000000000000000002";

describe("createEditorDraft", () => {
  it("backs an edit up under the editor's own namespace, with the opened version as seen", async () => {
    // Why (review #3): the phone keys a file-opened tour by the same file
    // key; the editor's records must never land in that namespace.
    const b = browser();
    const draft = draftIn(b);
    const opened = tour(pin("a"), pin("b"));
    expect((await draft.open(K1, opened)).backedUp).toBe(true);
    expect(await draft.saveObject(pin("a", "edited"))).toBe(true);
    await draft.idle();
    expect(b.spaces.has(K1)).toBe(false);
    const stored = await readDraft((await b.open(editorDraftKey(K1)))!);
    expect(stored?.draft.objects.map((o) => o.id)).toEqual(["a"]);
    expect(stored?.draft.bases?.get("a")).toEqual({
      // The opened version as the file holds it (in its station).
      seen: [hostedObjects(opened).key("a")],
      written: [],
    });
  });

  it("a later open offers the changes and the deletions, named apart, and nothing else", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = tour(pin("a"), pin("b"), pin("c"));
    await first.open(K1, opened);
    void first.saveObject(pin("a", "edited"));
    void first.saveDeletion("b");
    await first.idle();
    first.close();
    const second = draftIn(b);
    const { offer } = await second.open(K1, opened);
    expect(offer?.objects.map((o) => o.id)).toEqual(["a"]);
    expect(offer?.deleted).toEqual(["b"]);
    expect(offer?.text).toContain("1 change and 1 deletion");
  });

  it("a deletion has no base", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    await draft.saveDeletion("a");
    const stored = await readDraft((await b.open(editorDraftKey(K1)))!);
    expect(stored?.draft.deleted).toEqual(["a"]);
    expect(stored?.draft.bases?.get("a")).toBeUndefined();
  });

  it("a download clears nothing: the original reopened still offers, the downloaded copy put in place does not", async () => {
    // Why (review #2): a download only STARTED; the draft is cleared by a
    // file that is seen to carry the content, never by a download.
    const b = browser();
    const draft = draftIn(b);
    const original = tour(pin("a"));
    await draft.open(K1, original);
    void draft.saveObject(pin("a", "edited"));
    const downloaded = tour(pin("a", "edited"));
    draft.writes().built(downloaded);
    await draft.idle();
    draft.close();
    expect(
      (await draftIn(b).open(K1, original)).offer?.objects.map((o) => o.label),
    ).toEqual(["edited"]);
    // The copy put in place (a recording tour keeps its key): spent, and
    // its record goes.
    const again = draftIn(b);
    expect((await again.open(K1, downloaded)).offer).toBeNull();
    await again.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(objectKey("a"))).toBe(false);
  });

  it("an in-place save and then an edit: the next open offers the edit, not 'replaced'", async () => {
    // Why (review #1, E2p re-review #1): with one base per object, the
    // base still named the version before the save, so the file's own
    // saved version read as "edited elsewhere" and the edit was dropped.
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    void draft.saveObject(pin("a", "first"));
    const written = tour(pin("a", "first"));
    draft.writes().built(written);
    draft.writes().landed(written, K1);
    void draft.saveObject(pin("a", "second"));
    await draft.idle();
    draft.close();
    const opened = await draftIn(b).open(K1, written);
    expect(opened.superseded).toBeNull();
    expect(opened.offer?.objects.map((o) => o.label)).toEqual(["second"]);
  });

  it("a save built but never put in place: both the original and the built copy offer the later edit", async () => {
    const b = browser();
    const draft = draftIn(b);
    const original = tour(pin("a"));
    await draft.open(K1, original);
    void draft.saveObject(pin("a", "first"));
    const built = tour(pin("a", "first"));
    draft.writes().built(built);
    void draft.saveObject(pin("a", "second"));
    await draft.idle();
    draft.close();
    for (const file of [original, built]) {
      const opened = await draftIn(b).open(K1, file);
      expect(opened.superseded).toBeNull();
      expect(opened.offer?.objects.map((o) => o.label)).toEqual(["second"]);
    }
  });

  it("an object changed elsewhere since is not offered back, is said once, and its record goes", async () => {
    const b = browser();
    const first = draftIn(b);
    await first.open(K1, tour(pin("a"), pin("b")));
    void first.saveObject(pin("a", "mine"));
    void first.saveObject(pin("b", "mine too"));
    await first.idle();
    first.close();
    // Another save (the phone, another computer) changed "a" and removed
    // "b" since.
    const elsewhere = tour(pin("a", "theirs"));
    const second = draftIn(b);
    const opened = await second.open(K1, elsewhere);
    expect(opened.offer).toBeNull();
    expect(opened.superseded).toBe(
      "2 changes in this browser were replaced by newer ones in the tour file.",
    );
    await second.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(objectKey("a"))).toBe(false);
  });

  it("an in-place write that landed clears what it wrote and keeps an edit made while it ran", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a"), pin("b")));
    void draft.saveObject(pin("a", "saved"));
    const written = tour(pin("a", "saved"), pin("b"));
    draft.writes().built(written);
    // Made while the save ran: not in the written file.
    void draft.saveObject(pin("b", "during"));
    draft.writes().landed(written, K1);
    await draft.idle();
    const files = b.spaces.get(editorDraftKey(K1));
    expect(files?.has(objectKey("a"))).toBe(false);
    expect(files?.has(objectKey("b"))).toBe(true);
  });

  it("the key moves after an in-place write of a tour of notes alone: the later edit is offered under the new key, the old namespace is emptied", async () => {
    // Why (review #5): a hand-built tour's key changes with every save;
    // a draft left under the old key is one no file opens as again.
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a"), pin("b")));
    void draft.saveObject(pin("a", "saved"));
    void draft.saveDeletion("b");
    const written = tour(pin("a", "saved"));
    draft.writes().built(written);
    draft.writes().landed(written, K2);
    void draft.saveObject(pin("a", "after"));
    await draft.idle();
    draft.close();
    const old = b.spaces.get(editorDraftKey(K1));
    expect(old?.size ?? 0).toBe(0);
    expect(old?.has(META_KEY) ?? false).toBe(false);
    const opened = await draftIn(b).open(K2, written);
    expect(opened.offer?.objects.map((o) => o.label)).toEqual(["after"]);
    expect(opened.offer?.deleted).toEqual([]);
  });

  it("a key move carries an edit made while the save ran, and an offer not yet answered", async () => {
    // Why (review #5, #7): the edit's write was queued in the OLD
    // namespace; the offer's records were never this page's - both must
    // reach the new key.
    const b = browser();
    const earlier = draftIn(b);
    const original = tour(pin("a"), pin("b"), pin("c"));
    await earlier.open(K1, original);
    void earlier.saveObject(pin("c", "from an earlier visit"));
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    const { offer } = await draft.open(K1, original);
    expect(offer?.objects.map((o) => o.id)).toEqual(["c"]);
    void draft.saveObject(pin("a", "saved"));
    const written = tour(pin("a", "saved"), pin("b"), pin("c"));
    draft.writes().built(written);
    void draft.saveObject(pin("b", "during"));
    draft.writes().landed(written, K2);
    await draft.idle();
    draft.close();
    const reopened = await draftIn(b).open(K2, written);
    expect(reopened.offer?.objects.map((o) => o.label).sort()).toEqual([
      "during",
      "from an earlier visit",
    ]);
  });

  it("Delete it takes the offer's records, never one edited since the open, and a later edit of a deleted one is kept", async () => {
    // Why (review #7): live edits win over an unanswered offer, and a
    // rejection must not hide a change made after it.
    const b = browser();
    const earlier = draftIn(b);
    const original = tour(pin("a"), pin("b"), pin("c"));
    await earlier.open(K1, original);
    void earlier.saveObject(pin("a", "old a"));
    void earlier.saveObject(pin("b", "old b"));
    void earlier.saveDeletion("c");
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    expect((await draft.open(K1, original)).offer?.objects).toHaveLength(2);
    // Landed well before the tap: only the discard's own rule keeps it.
    expect(await draft.saveObject(pin("a", "live a"))).toBe(true);
    expect(await draft.discard()).toBe(true);
    void draft.saveDeletion("c");
    await draft.idle();
    draft.close();
    const reopened = await draftIn(b).open(K1, original);
    expect(reopened.offer?.objects.map((o) => o.label)).toEqual(["live a"]);
    expect(reopened.offer?.deleted).toEqual(["c"]);
  });

  it("a rejected id whose files are gone is dropped from the meta at the next open, so a later edit of it is not hidden", async () => {
    const b = browser();
    const original = tour(pin("a"));
    const earlier = draftIn(b);
    await earlier.open(K1, original);
    void earlier.saveObject(pin("a", "old"));
    await earlier.idle();
    earlier.close();
    const discarding = draftIn(b);
    await discarding.open(K1, original);
    await discarding.discard();
    await discarding.idle();
    discarding.close();
    // Next visit: the rejection's files are gone; this visit edits "a".
    const later = draftIn(b);
    expect((await later.open(K1, original)).offer).toBeNull();
    void later.saveObject(pin("a", "new"));
    await later.idle();
    later.close();
    expect(
      (await draftIn(b).open(K1, original)).offer?.objects.map((o) => o.label),
    ).toEqual(["new"]);
  });

  // Why (PR #622 bot finding A): the open prunes the meta's rejected list
  // to the ids that still have files, and claims an edit against that
  // PRUNED list. When the pruning write did not land, the meta on disk
  // still rejected the id, the edit was not claimed, and the next read hid
  // it. The phone claims against the meta on disk too (`rejectedOnDisk`).
  it("an edit of a rejected id is claimed against the meta on disk when the pruning write did not land", async () => {
    const b = browser();
    const original = tour(pin("a"));
    const earlier = draftIn(b);
    await earlier.open(K1, original);
    void earlier.saveObject(pin("a", "old"));
    await earlier.idle();
    earlier.close();
    const discarding = draftIn(b);
    await discarding.open(K1, original);
    await discarding.discard();
    await discarding.idle();
    discarding.close();
    // The meta rejects "a", whose files are gone; this open's pruning
    // write is refused.
    b.failMetaPuts = 1;
    const later = draftIn(b);
    expect((await later.open(K1, original)).offer).toBeNull();
    await later.idle();
    expect(later.said, "the refused write is said").toEqual(["storage"]);
    void later.saveObject(pin("a", "new"));
    await later.idle();
    later.close();
    expect(
      (await draftIn(b).open(K1, original)).offer?.objects.map((o) => o.label),
    ).toEqual(["new"]);
  });

  // Why (PR #622 bot finding B): "Delete it"'s meta write - the commit
  // point - was not counted among the namespace's writes, so a close right
  // after it let the hold go while it was still being written, and another
  // tab could read the draft before the rejection.
  it("a close right after Delete it lets the hold go only after the meta write landed", async () => {
    const b = browser();
    const hold = locks();
    const original = tour(pin("a"));
    const earlier = draftIn(b, hold);
    await earlier.open(K1, original);
    void earlier.saveObject(pin("a", "old"));
    await earlier.idle();
    earlier.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const draft = draftIn(b, hold);
    expect((await draft.open(K1, original)).offer).not.toBeNull();
    await draft.idle();
    b.holdPuts = true;
    const discarded = draft.discard();
    draft.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      (await draftIn(b, hold).open(K1, original)).backedUp,
      "still held while the rejection is written",
    ).toBe(false);
    b.releasePuts();
    expect(await discarded).toBe(true);
    await draft.idle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const next = await draftIn(b, hold).open(K1, original);
    expect(next.backedUp).toBe(true);
    expect(next.offer).toBeNull();
  });

  it("an undo of a delete of an edited note writes the record again", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    void draft.saveObject(pin("a", "edited"));
    void draft.saveDeletion("a");
    await recordUndoDelete(draft, {
      object: pin("a"),
      placed: { object: pin("a", "edited") },
      hosted: true,
    });
    draft.close();
    const { offer } = await draftIn(b).open(K1, tour(pin("a")));
    expect(offer?.objects.map((o) => o.label)).toEqual(["edited"]);
    expect(offer?.deleted).toEqual([]);
  });

  it("another tab holding the draft: this tab writes nothing and says so once", async () => {
    // Why (review #6): two tabs writing one draft would each sweep the
    // other's records.
    const b = browser();
    const hold = locks();
    const first = draftIn(b, hold);
    await first.open(K1, tour(pin("a")));
    const second = draftIn(b, hold);
    const opened = await second.open(K1, tour(pin("a")));
    expect(opened.backedUp).toBe(false);
    expect(second.backsUp()).toBe(false);
    expect(await second.saveObject(pin("a", "not kept"))).toBe(false);
    expect(await second.saveObject(pin("a", "still not"))).toBe(false);
    expect(second.said).toEqual(["other-tab"]);
    expect(b.spaces.get(editorDraftKey(K1))?.has(objectKey("a")) ?? false).toBe(
      false,
    );
    // Once the first lets go - after its queued writes (review #6), so
    // a moment after the close - the next open holds it.
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const third = draftIn(b, hold);
    expect((await third.open(K1, tour(pin("a")))).backedUp).toBe(true);
  });

  it("no storage, or a write that does not land: said once", async () => {
    const said: NoBackupReason[] = [];
    const none = createEditorDraft({
      openStore: () => Promise.resolve(undefined),
      holdLock: locks(),
      noBackup: (reason) => {
        said.push(reason);
      },
    });
    expect((await none.open(K1, tour(pin("a")))).backedUp).toBe(false);
    expect(await none.saveObject(pin("a", "x"))).toBe(false);
    expect(said).toEqual(["storage"]);
    const b = browser();
    const failing = draftIn(b);
    await failing.open(K1, tour(pin("a")));
    b.failWrites = true;
    expect(await failing.saveObject(pin("a", "x"))).toBe(false);
    expect(await failing.saveDeletion("a")).toBe(false);
    expect(failing.said).toEqual(["storage"]);
    expect(failing.backsUp()).toBe(false);
  });

  it("the same tour opened again in the same tab is not another tab", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    expect((await draft.open(K1, tour(pin("a")))).backedUp).toBe(true);
    expect(draft.said).toEqual([]);
  });

  // Why (E2c milestone review #1, confirmed data loss): a photo note's
  // edit carries no bytes - they are in the file the editor opened, and
  // the rebuild keeps that entry - but the phone's read drops a photo
  // record without its bytes, so a moved photo note was neither offered
  // nor counted as replaced, and the open then removed it.
  it("keeps a moved photo note, and the undo of a delete of one, without its bytes", async () => {
    const b = browser();
    const opened = tour(photo("p"), photo("q"));
    const first = draftIn(b);
    await first.open(K1, opened);
    void first.saveObject(photo("p", 48.6));
    void first.saveObject(photo("q", 48.7));
    void first.saveDeletion("q");
    await recordUndoDelete(first, {
      object: photo("q"),
      placed: { object: photo("q", 48.7) },
      hosted: true,
    });
    await first.idle();
    first.close();
    const { offer, superseded } = await draftIn(b).open(K1, opened);
    expect(superseded).toBeNull();
    expect(offer?.objects.map((o) => o.id)).toEqual(["p", "q"]);
  });

  // Why (review #2): a key move's records were written on the NEW
  // namespace's queue, which waits for its lock and store, while the OLD
  // one was emptied on its own queue - so the old records usually went
  // first, and a tab closed right after "Saved to" (nothing asks: no
  // change is pending) lost an offered or mid-save record. The old
  // namespace now goes only after every carried record and the new meta
  // landed.
  it("empties the old namespace only once the carried records have landed", async () => {
    const b = browser();
    const original = tour(pin("a"), pin("c"));
    const earlier = draftIn(b);
    await earlier.open(K1, original);
    void earlier.saveObject(pin("c", "offered"));
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    await draft.open(K1, original);
    void draft.saveObject(pin("a", "saved"));
    const written = tour(pin("a", "saved"), pin("c"));
    draft.writes().built(written);
    b.holdOpenOf.add(editorDraftKey(K2));
    draft.writes().landed(written, K2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The new namespace has not opened yet: the old still holds the record.
    expect(b.spaces.get(editorDraftKey(K1))?.has(objectKey("c"))).toBe(true);
    b.releaseOpens();
    await draft.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(objectKey("c"))).toBe(false);
    expect(b.spaces.get(editorDraftKey(K2))?.has(objectKey("c"))).toBe(true);
  });

  it("keeps the old namespace when the carried records do not land", async () => {
    const b = browser();
    const original = tour(pin("a"), pin("c"));
    const earlier = draftIn(b);
    await earlier.open(K1, original);
    void earlier.saveObject(pin("c", "offered"));
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    await draft.open(K1, original);
    const written = tour(pin("a"), pin("c"));
    b.failIn.add(editorDraftKey(K2));
    draft.writes().landed(written, K2);
    await draft.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(objectKey("c"))).toBe(true);
    expect(b.spaces.get(editorDraftKey(K1))?.has(META_KEY)).toBe(true);
    expect(draft.said).toEqual(["storage"]);
  });

  // Why (review #5): a carried record queued behind the move would CLAIM
  // an id "Delete it" had just rejected, and bring the deleted record back.
  it("Delete it right after a key move does not bring the offer back", async () => {
    const b = browser();
    const original = tour(pin("a"), pin("c"));
    const earlier = draftIn(b);
    await earlier.open(K1, original);
    void earlier.saveObject(pin("c", "offered"));
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    await draft.open(K1, original);
    const written = tour(pin("a"), pin("c"));
    draft.writes().landed(written, K2);
    expect(await draft.discard()).toBe(true);
    await draft.idle();
    draft.close();
    expect((await draftIn(b).open(K2, written)).offer).toBeNull();
  });

  // Why (review #6): the draft switched to the new tour while the old
  // editor was still live, so a late write of the old tour landed in the
  // new tour's namespace with the new tour's seen version.
  it("drops a write of a tour that is no longer open", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    const old = draft.writes();
    await draft.open(K2, tour(pin("a")));
    expect(await old.saveObject(pin("a", "from the old tour"))).toBe(true);
    await draft.idle();
    expect(b.spaces.get(editorDraftKey(K2))?.has(objectKey("a"))).toBe(false);
    expect(b.spaces.get(editorDraftKey(K1))?.has(objectKey("a"))).toBe(false);
    // The current tour's writes go through.
    expect(await draft.writes().saveObject(pin("a", "new"))).toBe(true);
    expect(b.spaces.get(editorDraftKey(K2))?.has(objectKey("a"))).toBe(true);
  });

  // Why (E2b-2 milestone review #1): an autosave of the old tour can land
  // while "Open another tour" is still reading the new tour's draft - the
  // page makes the new tour current only after that read. Its `landed`
  // then moved the NEW tour's draft to the old file's key, emptied it, and
  // made the old file the source of the new tour's seen versions.
  it("a save of the old tour that lands while the next tour opens changes nothing of it", async () => {
    const b = browser();
    const K3 = "local-file:00000000000000000000000000000003";
    const second = tour(pin("b"));
    const earlier = draftIn(b);
    await earlier.open(K2, second);
    void earlier.saveObject(pin("b", "from an earlier visit"));
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    const old = draft.writes();
    void old.saveObject(pin("a", "saved"));
    await draft.idle();
    const written = tour(pin("a", "saved"));
    old.built(written);
    b.holdOpenOf.add(editorDraftKey(K2));
    const opening = draft.open(K2, second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    old.built(written);
    old.landed(written, K3);
    b.releaseOpens();
    const opened = await opening;
    expect(opened.offer?.objects.map((o) => o.label)).toEqual([
      "from an earlier visit",
    ]);
    expect(await draft.writes().saveObject(pin("b", "new"))).toBe(true);
    await draft.idle();
    expect(b.spaces.has(editorDraftKey(K3))).toBe(false);
    const files = b.spaces.get(editorDraftKey(K2));
    expect(files?.has(objectKey("b"))).toBe(true);
    expect(files?.has(META_KEY)).toBe(true);
    draft.close();
    // The new edit's seen version is the second tour's, never the old
    // file's: it is offered, not called replaced.
    const again = await draftIn(b).open(K2, second);
    expect(again.superseded).toBeNull();
    expect(again.offer?.objects.map((o) => o.label)).toEqual(["new"]);
  });

  // Why (review #6): the hold was released before the closed tour's
  // queued writes landed, so another tab could take the draft while they
  // were still being written.
  it("lets the hold go only after the closed tour's queued writes landed", async () => {
    const b = browser();
    const hold = locks();
    const first = draftIn(b, hold);
    await first.open(K1, tour(pin("a")));
    b.holdPuts = true;
    void first.saveObject(pin("a", "slow"));
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await draftIn(b, hold).open(K1, tour(pin("a")))).backedUp).toBe(
      false,
    );
    b.releasePuts();
    await first.idle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await draftIn(b, hold).open(K1, tour(pin("a")))).backedUp).toBe(
      true,
    );
  });

  // Why (review #6): a closed tour's write that failed late used up the
  // once-per-tour line, so the NEXT tour's real storage failure was never
  // said.
  it("a closed tour's late failure does not use up the next tour's no-backup line", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    b.holdPuts = true;
    void draft.saveObject(pin("a", "late"));
    const opening = draft.open(K2, tour(pin("a")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    b.releasePuts(false);
    await opening;
    expect(draft.said).toEqual([]);
    b.failIn.add(editorDraftKey(K2));
    expect(await draft.saveObject(pin("a", "refused"))).toBe(false);
    expect(draft.said).toEqual(["storage"]);
  });
});

/**
 * Why (QR-first M1b-2, the draft gap): the draft held objects only, so a
 * changed tour-level setting - "needs no GPS" - was lost with a closed tab
 * while every note edit beside it survived. The setting is ONE record
 * (`settings`) in the editor's namespace with the objects' rules: offered
 * by a later open while the file does not carry it, cleared by a file
 * that does (an in-place write that landed, or a copy put in place),
 * carried along by a key move, thrown away by "Delete it" unless changed
 * since the open. A boolean has no versions beyond its two values, so the
 * objects' bases reduce to "the file's value differs from the record's"
 * (`editor-draft.ts`, THE SETTINGS).
 */
describe("createEditorDraft, the tour's settings (QR-first M1b-2)", () => {
  const SETTINGS = "settings";
  const flagged = (...objects: TourObject[]): TourManifest => ({
    ...tour(...objects),
    needsNoGps: true,
  });

  it("a changed setting survives a closed tab and is offered as a change", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = tour(pin("a"));
    await first.open(K1, opened);
    expect(await first.saveSettings({ needsNoGps: true })).toBe(true);
    await first.idle();
    first.close();
    const { offer } = await draftIn(b).open(K1, opened);
    expect(offer?.settings).toEqual({ needsNoGps: true });
    expect(offer?.objects).toEqual([]);
    expect(offer?.text).toContain("1 change");
  });

  it("is counted with the notes' changes in the offer's words", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = tour(pin("a"));
    await first.open(K1, opened);
    void first.saveObject(pin("a", "edited"));
    void first.saveSettings({ needsNoGps: true });
    await first.idle();
    first.close();
    const { offer } = await draftIn(b).open(K1, opened);
    expect(offer?.text).toContain("2 changes");
  });

  it("a setting put back to the file's own value leaves nothing to offer", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = flagged(pin("a"));
    await first.open(K1, opened);
    void first.saveSettings({ needsNoGps: false });
    void first.saveSettings({ needsNoGps: true });
    await first.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(SETTINGS)).toBe(false);
    first.close();
    expect((await draftIn(b).open(K1, opened)).offer).toBeNull();
  });

  it("turning a flagged tour's setting off is kept too", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = flagged(pin("a"));
    await first.open(K1, opened);
    void first.saveSettings({ needsNoGps: false });
    await first.idle();
    first.close();
    expect((await draftIn(b).open(K1, opened)).offer?.settings).toEqual({
      needsNoGps: false,
    });
  });

  it("a file that carries the setting spends the record: a downloaded copy put in place", async () => {
    // Why (review #2's rule): a download clears nothing - the original
    // reopened still offers - but a file seen to carry the value does.
    const b = browser();
    const draft = draftIn(b);
    const original = tour(pin("a"));
    await draft.open(K1, original);
    void draft.saveSettings({ needsNoGps: true });
    draft.writes().built(flagged(pin("a")));
    await draft.idle();
    draft.close();
    expect((await draftIn(b).open(K1, original)).offer?.settings).toEqual({
      needsNoGps: true,
    });
    const again = draftIn(b);
    expect((await again.open(K1, flagged(pin("a")))).offer).toBeNull();
    await again.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(SETTINGS)).toBe(false);
  });

  it("a save built but never put in place: a setting changed back is still offered by the built copy", async () => {
    // Why (review #1's second walk, for the setting): turned on, built
    // as a download, turned off again - back at the opened file's value,
    // but the built copy carries "on", and putting it in place must not
    // lose the creator's last choice.
    const b = browser();
    const draft = draftIn(b);
    const original = tour(pin("a"));
    await draft.open(K1, original);
    void draft.saveSettings({ needsNoGps: true });
    const built = flagged(pin("a"));
    draft.writes().built(built);
    void draft.saveSettings({ needsNoGps: false });
    await draft.idle();
    draft.close();
    const copy = draftIn(b);
    expect((await copy.open(K1, built)).offer?.settings).toEqual({
      needsNoGps: false,
    });
    copy.close();
    // The original carries "off": spent there.
    expect((await draftIn(b).open(K1, original)).offer).toBeNull();
  });

  it("an in-place write that landed clears it, and a change after it is pending against the written file", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    void draft.saveSettings({ needsNoGps: true });
    const written = flagged(pin("a"));
    draft.writes().built(written);
    draft.writes().landed(written, K1);
    await draft.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(SETTINGS)).toBe(false);
    // Off again after the landed save: pending against the file on disk
    // NOW (flagged), not against the file first opened.
    void draft.saveSettings({ needsNoGps: false });
    await draft.idle();
    draft.close();
    expect((await draftIn(b).open(K1, written)).offer?.settings).toEqual({
      needsNoGps: false,
    });
  });

  it("an in-place write keeps a setting changed while it ran", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    void draft.saveObject(pin("a", "saved"));
    const written = tour(pin("a", "saved"));
    draft.writes().built(written);
    void draft.saveSettings({ needsNoGps: true });
    draft.writes().landed(written, K1);
    await draft.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(SETTINGS)).toBe(true);
  });

  it("a key move carries the setting, and empties the old namespace", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    void draft.saveObject(pin("a", "saved"));
    const written = tour(pin("a", "saved"));
    draft.writes().built(written);
    // Changed while the save ran: not in the written file.
    void draft.saveSettings({ needsNoGps: true });
    draft.writes().landed(written, K2);
    await draft.idle();
    draft.close();
    expect(b.spaces.get(editorDraftKey(K1))?.size ?? 0).toBe(0);
    expect((await draftIn(b).open(K2, written)).offer?.settings).toEqual({
      needsNoGps: true,
    });
  });

  it("a key move carries an offered setting not yet answered", async () => {
    const b = browser();
    const earlier = draftIn(b);
    const original = tour(pin("a"));
    await earlier.open(K1, original);
    void earlier.saveSettings({ needsNoGps: true });
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    expect((await draft.open(K1, original)).offer?.settings).toEqual({
      needsNoGps: true,
    });
    void draft.saveObject(pin("a", "saved"));
    const written = tour(pin("a", "saved"));
    draft.writes().built(written);
    draft.writes().landed(written, K2);
    await draft.idle();
    draft.close();
    expect((await draftIn(b).open(K2, written)).offer?.settings).toEqual({
      needsNoGps: true,
    });
  });

  it("Delete it throws an offered setting away, never one changed since the open", async () => {
    const b = browser();
    const original = tour(pin("a"));
    for (const changedSince of [false, true]) {
      const earlier = draftIn(b);
      await earlier.open(K1, original);
      void earlier.saveSettings({ needsNoGps: true });
      await earlier.idle();
      earlier.close();
      const draft = draftIn(b);
      expect((await draft.open(K1, original)).offer?.settings).toEqual({
        needsNoGps: true,
      });
      // The creator turned it on here as well: live work.
      if (changedSince) await draft.saveSettings({ needsNoGps: true });
      expect(await draft.discard()).toBe(true);
      await draft.idle();
      draft.close();
      const later = draftIn(b);
      const reopened = await later.open(K1, original);
      expect(reopened.offer?.settings).toEqual(
        changedSince ? { needsNoGps: true } : undefined,
      );
      await later.idle();
      later.close();
    }
  });

  it("drops a settings write of a tour that is no longer open", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    const old = draft.writes();
    await draft.open(K2, tour(pin("a")));
    expect(await old.saveSettings({ needsNoGps: true })).toBe(true);
    await draft.idle();
    expect(b.spaces.get(editorDraftKey(K2))?.has(SETTINGS)).toBe(false);
    expect(b.spaces.get(editorDraftKey(K1))?.has(SETTINGS) ?? false).toBe(
      false,
    );
  });

  it("an unreadable settings record is no offer, and goes", async () => {
    // Why: a record that does not read costs itself (the draft's rule).
    const b = browser();
    const first = draftIn(b);
    await first.open(K1, tour(pin("a")));
    await first.idle();
    first.close();
    b.spaces.get(editorDraftKey(K1))?.set(SETTINGS, "{not json");
    const again = draftIn(b);
    expect((await again.open(K1, tour(pin("a")))).offer).toBeNull();
    await again.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(SETTINGS)).toBe(false);
  });

  it("a record whose station poses do not read is no offer, and goes", async () => {
    // Why (the r875 milestone review #1): the poses are parsed as the
    // format parses a pose; one that does not read costs the record, as
    // any unreadable record does.
    const b = browser();
    const first = draftIn(b);
    await first.open(K1, tour(pin("a")));
    await first.idle();
    first.close();
    b.spaces.get(editorDraftKey(K1))?.set(
      SETTINGS,
      JSON.stringify({
        // A real change: only the pose that does not read keeps it from
        // being offered.
        needsNoGps: true,
        stations: [{ id: "s", geo: { lat: 200, lon: 9, alt: 0 } }],
      }),
    );
    const again = draftIn(b);
    expect((await again.open(K1, tour(pin("a")))).offer).toBeNull();
    await again.idle();
    expect(b.spaces.get(editorDraftKey(K1))?.has(SETTINGS)).toBe(false);
  });

  it("a settings write that does not land is said once", async () => {
    const b = browser();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    b.failIn.add(editorDraftKey(K1));
    expect(await draft.saveSettings({ needsNoGps: true })).toBe(false);
    expect(draft.said).toEqual(["storage"]);
  });
});

/**
 * Why (QR-first M1b-2 milestone review #1, #3, #4, #6): the settings
 * record's walks the first build of it lost or mis-said - a setting turned
 * back while a save builds, an offer that did not say it was about the
 * setting (so Restore could undo a newer value unknowingly), "Delete it"
 * removing the record outside its commit point, and a "nothing restored"
 * line that spoke of notes for an offer of the setting.
 */
describe("createEditorDraft, the settings record's edge walks (M1b-2 milestone review)", () => {
  const SETTINGS = "settings";
  const flagged = (...objects: TourObject[]): TourManifest => ({
    ...tour(...objects),
    needsNoGps: true,
  });

  it("a setting turned back while a save builds keeps its record: in place, on a key move, and as a download", async () => {
    // Why (#1): on, a save starts (its snapshot carries "on"), off before
    // the build is told. "Off" equals the opened file and no build was
    // known yet, so the record went - and the build's "on" never
    // re-decided it: the file said on, the session off, and a closed tab
    // lost "off".
    for (const path of ["in place", "key move", "download"] as const) {
      const b = browser();
      const draft = draftIn(b);
      const original = tour(pin("a"));
      await draft.open(K1, original);
      void draft.saveSettings({ needsNoGps: true });
      void draft.saveSettings({ needsNoGps: false });
      const written = flagged(pin("a"));
      draft.writes().built(written);
      if (path !== "download") {
        draft.writes().landed(written, path === "key move" ? K2 : K1);
      }
      await draft.idle();
      draft.close();
      const reopened = draftIn(b);
      const { offer } = await reopened.open(
        path === "key move" ? K2 : K1,
        written,
      );
      expect(offer?.settings, path).toEqual({ needsNoGps: false });
      await reopened.idle();
      reopened.close();
    }
  });

  it("the download's original, reopened, carries the value turned back to: spent there", async () => {
    const b = browser();
    const draft = draftIn(b);
    const original = tour(pin("a"));
    await draft.open(K1, original);
    void draft.saveSettings({ needsNoGps: true });
    void draft.saveSettings({ needsNoGps: false });
    draft.writes().built(flagged(pin("a")));
    await draft.idle();
    draft.close();
    expect((await draftIn(b).open(K1, original)).offer).toBeNull();
  });

  it("the offer names the setting and its value, alone and beside notes", async () => {
    // Why (#3): "1 change" alone did not say the change is the setting, so
    // Restore could put back a value a colleague changed since, unknowingly.
    const b = browser();
    const first = draftIn(b);
    await first.open(K1, tour(pin("a")));
    void first.saveSettings({ needsNoGps: true });
    await first.idle();
    first.close();
    const alone = draftIn(b);
    expect((await alone.open(K1, tour(pin("a")))).offer?.text).toBe(
      'Unsaved work from this tour is still on this device: 1 change. Add it back? It is "This tour needs no GPS" turned on.',
    );
    await alone.idle();
    alone.close();

    const c = browser();
    const second = draftIn(c);
    await second.open(K1, flagged(pin("a")));
    void second.saveObject(pin("a", "edited"));
    void second.saveSettings({ needsNoGps: false });
    await second.idle();
    second.close();
    expect((await draftIn(c).open(K1, flagged(pin("a")))).offer?.text).toBe(
      'Unsaved work from this tour is still on this device: 2 changes. Add them back? One of the changes is "This tour needs no GPS" turned off.',
    );
  });

  it("Delete it has removed an offered setting by the time it says it is done", async () => {
    // Why (#4): the removal ran outside the commit point, fire-and-forget,
    // so "deleted" was said before the record went.
    const b = browser();
    const earlier = draftIn(b);
    await earlier.open(K1, tour(pin("a")));
    void earlier.saveSettings({ needsNoGps: true });
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    expect(await draft.discard()).toBe(true);
    expect(b.spaces.get(editorDraftKey(K1))?.has(SETTINGS)).toBe(false);
  });

  it("a removal of the offered setting that does not land fails Delete it, and everything is offered again", async () => {
    // Why (#4): a failed removal was ignored, so the page said the earlier
    // changes were deleted while the setting stayed - and the notes went.
    const b = browser();
    const original = tour(pin("a"));
    const earlier = draftIn(b);
    await earlier.open(K1, original);
    void earlier.saveObject(pin("a", "edited"));
    void earlier.saveSettings({ needsNoGps: true });
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    await draft.open(K1, original);
    b.failRemoveOf.add(SETTINGS);
    expect(await draft.discard()).toBe(false);
    await draft.idle();
    draft.close();
    b.failRemoveOf.clear();
    const { offer } = await draftIn(b).open(K1, original);
    expect(offer?.objects.map((o) => o.id)).toEqual(["a"]);
    expect(offer?.settings).toEqual({ needsNoGps: true });
  });

  it("a Delete it that did not land re-arms the offer: a key move still carries it", async () => {
    // Why (#4, "re-arm the offer"): "offered again next time" must hold
    // even when an in-place save moves the key before that next time.
    const b = browser();
    const original = tour(pin("a"), pin("b"));
    const earlier = draftIn(b);
    await earlier.open(K1, original);
    void earlier.saveObject(pin("a", "edited"));
    void earlier.saveSettings({ needsNoGps: true });
    await earlier.idle();
    earlier.close();
    const draft = draftIn(b);
    await draft.open(K1, original);
    // The open's own meta write lands first: the refusal is the discard's.
    await draft.idle();
    b.failMetaPuts = 1;
    expect(await draft.discard()).toBe(false);
    void draft.saveObject(pin("b", "saved"));
    const written = tour(pin("a"), pin("b", "saved"));
    draft.writes().built(written);
    draft.writes().landed(written, K2);
    await draft.idle();
    draft.close();
    const { offer } = await draftIn(b).open(K2, written);
    expect(offer?.objects.map((o) => o.id)).toEqual(["a"]);
    expect(offer?.settings).toEqual({ needsNoGps: true });
  });
});

describe("restoredLine (M1b-2 milestone review #6)", () => {
  // Why: Restore's "nothing restored" line spoke of notes even when the
  // offer was the setting alone.
  const notes = { objects: [pin("a")], deleted: [] };
  const setting = {
    objects: [],
    deleted: [],
    settings: { needsNoGps: true },
  };

  it("counts what came back", () => {
    expect(restoredLine(1, notes)).toBe(
      "1 earlier change is back - not saved yet.",
    );
    expect(restoredLine(2, { ...setting, objects: [pin("a")] })).toBe(
      "2 earlier changes are back - not saved yet.",
    );
  });

  it("says why nothing came back in the offer's own terms", () => {
    expect(restoredLine(0, notes)).toBe(
      "Nothing was restored: the notes those changes were for are edited here already.",
    );
    expect(restoredLine(0, { objects: [], deleted: ["a"] })).toBe(
      "Nothing was restored: the notes those changes were for are edited here already.",
    );
    expect(restoredLine(0, setting)).toBe(
      'Nothing was restored: this tour\'s "needs no GPS" setting is changed here already.',
    );
    expect(restoredLine(0, { ...setting, objects: [pin("a")] })).toBe(
      "Nothing was restored: the notes and the setting those changes were for are changed here already.",
    );
  });
});

/**
 * Why (PR #626 bot findings 1 and 2): two ways the editor's draft claimed
 * a backup it did not have, or refused one it did - a first meta write
 * that did not land (the phone's `readDraft` reads nothing without a
 * meta, so the whole namespace is unreadable), and a key move whose old
 * hold went without the next open waiting for it.
 */
describe("createEditorDraft, the PR #626 bot findings", () => {
  it("a first meta write that does not land is said, and the backup is no longer claimed", async () => {
    const b = browser();
    b.failMetaPuts = 1;
    const draft = draftIn(b);
    await draft.open(K1, tour(pin("a")));
    await draft.idle();
    expect(draft.said).toEqual(["storage"]);
    expect(draft.backsUp()).toBe(false);
  });

  it("after a key move, the pre-save file reopened in this tab waits for the old hold, never 'another tab'", async () => {
    const b = browser();
    const draft = draftIn(b);
    const original = tour(pin("a"));
    await draft.open(K1, original);
    void draft.saveObject(pin("a", "saved"));
    await draft.idle();
    const written = tour(pin("a", "saved"));
    draft.writes().built(written);
    // The carried records are still being written when the reopen starts.
    b.holdPuts = true;
    draft.writes().landed(written, K2);
    const reopening = draft.open(K1, original);
    b.releasePuts();
    const { backedUp } = await reopening;
    expect(draft.said).toEqual([]);
    expect(backedUp).toBe(true);
    expect(draft.backsUp()).toBe(true);
  });
});

/**
 * Why (tour editor plan 2026-10-17-1816, W2): the tour's details join
 * "needs no GPS" in the ONE settings record, by the same rules - kept
 * while the file does not carry them, offered by a later open, spent by a
 * file that does. A record written before the details existed carries no
 * opinion about them, so it never offers to change (or blank) them.
 */
describe("createEditorDraft, the tour's details (W2)", () => {
  const named = (title: string, ...objects: TourObject[]): TourManifest => ({
    ...tour(...objects),
    title,
  });

  it("changed details survive a closed tab, and the offer names them", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = named("Old", pin("a"));
    await first.open(K1, opened);
    await first.saveSettings({
      needsNoGps: false,
      details: { title: "New", contact: "guide@example.org" },
    });
    await first.idle();
    first.close();
    const { offer } = await draftIn(b).open(K1, opened);
    expect(offer?.settings).toEqual({
      needsNoGps: false,
      details: { title: "New", contact: "guide@example.org" },
    });
    expect(offer?.text).toContain("the tour's details (name, contact)");
    expect(offer?.settingsWhat).toBe("this tour's details");
  });

  it("details put back to the file's own leave nothing to offer", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = named("Old", pin("a"));
    await first.open(K1, opened);
    void first.saveSettings({ needsNoGps: false, details: { title: "New" } });
    void first.saveSettings({ needsNoGps: false, details: { title: "Old" } });
    await first.idle();
    first.close();
    expect((await draftIn(b).open(K1, opened)).offer).toBeNull();
  });

  it("a file that carries the details spends the record", async () => {
    const b = browser();
    const first = draftIn(b);
    await first.open(K1, named("Old", pin("a")));
    void first.saveSettings({ needsNoGps: false, details: { title: "New" } });
    await first.idle();
    first.close();
    expect(
      (await draftIn(b).open(K1, named("New", pin("a")))).offer,
    ).toBeNull();
  });

  it("a record from before the details offers only its setting, whatever the file's name", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = named("Old", pin("a"));
    await first.open(K1, opened);
    void first.saveSettings({ needsNoGps: true });
    await first.idle();
    first.close();
    const { offer } = await draftIn(b).open(K1, opened);
    expect(offer?.settings).toEqual({ needsNoGps: true });
    expect(offer?.text).toContain('"This tour needs no GPS" turned on');
    expect(offer?.text).not.toContain("details");
  });

  it("both at once are named together", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = named("Old", pin("a"));
    await first.open(K1, opened);
    void first.saveSettings({ needsNoGps: true, details: { title: "New" } });
    await first.idle();
    first.close();
    const { offer } = await draftIn(b).open(K1, opened);
    expect(offer?.text).toContain(
      `"This tour needs no GPS" turned on, and the tour's details (name)`,
    );
    expect(offer?.settingsWhat).toBe("this tour's settings");
  });

  it("a record's cover naming a photo the file no longer has is no opinion: spent by that file, and never offered", async () => {
    // Why (M4a review #1): the record kept the cover of a deleted photo,
    // so the file written without it never spent the record, and every
    // later open offered "the tour's details (cover)" - a change no save
    // can make, whose Restore then said nothing was restored.
    const b = browser();
    const first = draftIn(b);
    const withPhoto: TourManifest = {
      ...named("Old", photo("f"), photo("g")),
      description: "Up.",
      cover: "f",
    };
    await first.open(K1, withPhoto);
    void first.saveSettings({
      needsNoGps: false,
      details: { title: "Old", description: "Up.", cover: "f" },
    });
    const without: TourManifest = {
      ...named("Old", photo("g")),
      description: "Up.",
    };
    first.writes().built(without);
    first.writes().landed(without, K1);
    await first.idle();
    first.close();
    expect((await draftIn(b).open(K1, without)).offer).toBeNull();
    // A record whose other details still differ is offered for them alone.
    const second = draftIn(b);
    await second.open(K1, without);
    void second.saveSettings({
      needsNoGps: false,
      details: { title: "New", description: "Up.", cover: "f" },
    });
    await second.idle();
    second.close();
    const { offer } = await draftIn(b).open(K1, without);
    expect(offer?.text).toContain("the tour's details (name)");
    expect(offer?.settings?.details).toEqual({
      title: "New",
      description: "Up.",
    });
  });

  it("an unreadable details part makes the record unreadable: no offer", async () => {
    const b = browser();
    const first = draftIn(b);
    const opened = named("Old", pin("a"));
    await first.open(K1, opened);
    await first.idle();
    first.close();
    b.spaces
      .get(editorDraftKey(K1))
      ?.set(
        "settings",
        JSON.stringify({ needsNoGps: false, details: { title: 7 } }),
      );
    expect((await draftIn(b).open(K1, opened)).offer).toBeNull();
  });
});
