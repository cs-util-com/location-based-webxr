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
  createEmptyTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { objectContentKey } from "../authoring-draft.js";
import { recordUndoDelete } from "../draft-actions.js";
import { META_KEY, objectKey, readDraft } from "../draft-persistence.js";
import {
  createEditorDraft,
  editorDraftKey,
  type EditorDraft,
  type NoBackupReason,
} from "./editor-draft.js";
import type { EditorLock } from "./save-target.js";

/** One browser's draft directories: namespace -> files. `failIn` makes
 *  one namespace's writes refuse; `holdPuts` holds every write until
 *  `releasePuts`; `holdOpenOf` holds a namespace's open until
 *  `releaseOpens` - the order a key move's writes land in. */
function browser(): {
  spaces: Map<string, Map<string, Blob | string>>;
  open: (key: string) => Promise<DraftFileStore | undefined>;
  failWrites: boolean;
  failIn: Set<string>;
  holdPuts: boolean;
  releasePuts: (ok?: boolean) => void;
  holdOpenOf: Set<string>;
  releaseOpens: () => void;
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
  return { ...createEmptyTourManifest(), objects };
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
      seen: [objectContentKey(pin("a"))],
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
    draft.built(downloaded);
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
    draft.built(written);
    draft.landed(written, K1);
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
    draft.built(built);
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
    draft.built(written);
    // Made while the save ran: not in the written file.
    void draft.saveObject(pin("b", "during"));
    draft.landed(written, K1);
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
    draft.built(written);
    draft.landed(written, K2);
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
    draft.built(written);
    void draft.saveObject(pin("b", "during"));
    draft.landed(written, K2);
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
    draft.built(written);
    b.holdOpenOf.add(editorDraftKey(K2));
    draft.landed(written, K2);
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
    draft.landed(written, K2);
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
    draft.landed(written, K2);
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
