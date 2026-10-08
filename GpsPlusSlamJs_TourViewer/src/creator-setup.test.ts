/**
 * Why these tests matter: this feature has produced FOUR silent
 * data-loss defects in five review rounds, every one caught by a reviewer
 * and none by a gate, and all of them the same shape - the draft folder is
 * emptied and what should not have gone is written back afterwards.
 *
 * Two call sites do that, and until now only one of them could regress
 * noisily: the discard has an end-to-end test, and the spent-draft path
 * had nothing. Its window is not reachable from an e2e - it needs the zip
 * read inside `presentDraftForTour` held open mid-open - but it is
 * trivially reachable one level down, because `wireCreatorSetup` takes
 * `openDraftStore` as an injected dependency. A fake store whose `clear`
 * resolves from a deferred this file controls proves both re-writes with
 * no timing in them at all.
 *
 * These are the tests that fail if either loop is deleted.
 *
 * The module reaches no globals - every element it touches arrives in
 * `dom` - so this stays a pure test, as this package's unit tests are by
 * convention.
 */
import { describe, expect, it } from "vitest";
import { Group, Matrix4, Vector3 } from "three";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import {
  AUTHOR_DEFAULT_SIZE_M,
  MIN_ALIGNMENT_SAMPLES,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { wireCreatorSetup } from "./creator-setup.js";
import type { CreatorSetupDom } from "./creator-setup.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
import {
  deletedKey,
  META_KEY,
  objectKey,
  photoKey,
  readDraft,
} from "./draft-persistence.js";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { ObjectListHandlers } from "./object-list.js";

/** One fake element: the properties this module writes, and a click it can
 *  be told to fire. Not a DOM stand-in - only what `creator-setup` uses. */
interface FakeEl {
  hidden: boolean;
  textContent: string;
  disabled: boolean;
  value: string;
  open: boolean;
  /** The status line's AR clamp flag (`data-clamped`). */
  dataset: Record<string, string>;
  handlers: Map<string, () => void>;
  addEventListener: (type: string, handler: () => void) => void;
  click: () => void;
  bind: (bound: ObjectListHandlers) => void;
  render: () => void;
  /** What the setup bound to the object list (M4), so a test can drive an
   *  edit or a delete the way the list's buttons do. */
  listHandlers: ObjectListHandlers | null;
}

function el(): FakeEl {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    value: "",
    open: false,
    dataset: {},
    handlers,
    addEventListener: (type, handler) => handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
    // The object list's view (authoring plan M4): a stand-in - its model
    // is tested in object-list.test.ts, its DOM by the Playwright suite.
    listHandlers: null,
    bind(bound: ObjectListHandlers) {
      this.listHandlers = bound;
    },
    render: () => undefined,
  };
}

const DOM_KEYS = [
  "panel",
  "controls",
  "finishBlock",
  "replaceHelp",
  "replaceHelpShare",
  "replaceHelpGeneric",
  "replaceHelpDrive",
  "sizeInput",
  "printPanel",
  "status",
  "finishButton",
  "finishStatus",
  "downloadButton",
  "pinButton",
  "pinLabel",
  "pinSave",
  "pinCancel",
  "photoButton",
  "draftOffer",
  "draftOfferText",
  "draftRestore",
  "draftDismiss",
  "draftDiscard",
  "sizeOffer",
  "sizeOfferText",
  "sizeOfferUse",
  "sizeOfferKeep",
  "objectList",
  "keepScanRow",
  "keepScanInput",
] as const;

function fakeDom(): Record<(typeof DOM_KEYS)[number], FakeEl> {
  const out = {} as Record<(typeof DOM_KEYS)[number], FakeEl>;
  for (const key of DOM_KEYS) out[key] = el();
  return out;
}

/** A plain in-memory store. No deferred `clear` any more: the deletes are
 *  targeted, so which id is deleted no longer depends on when anything
 *  settles - which is the property these tests exist to hold. */
function memoryStore(
  seed: Record<string, string> = {},
  options: {
    removeNeverSettles?: boolean;
    putFails?: boolean;
    holdFirstPut?: boolean;
    /** Hold every put whose key this names, until `releaseHeldKeys`. */
    holdKeys?: (key: string) => boolean;
    /** Refuse this many removes (they leave the file), then work. */
    refuseRemoves?: number;
  } = {},
): {
  store: DraftFileStore;
  files: Map<string, unknown>;
  putKeys: string[];
  metaPuts: string[];
  releaseHeldPut: () => void;
  releaseHeldKeys: () => void;
} {
  const files = new Map<string, unknown>(Object.entries(seed));
  const putKeys: string[] = [];
  const metaPuts: string[] = [];
  let held: (() => void) | null = null;
  let released = false;
  const heldByKey: (() => void)[] = [];
  let refusedRemoves = 0;
  const store: DraftFileStore = {
    put: (key: string, data: unknown) => {
      putKeys.push(key);
      if (key === META_KEY && typeof data === "string") metaPuts.push(data);
      // A store that REFUSES, as the real one does on a quota wall or a
      // revoked directory handle: `put` reports false rather than throwing.
      if (options.putFails === true) return Promise.resolve(false);
      if (options.holdKeys?.(key) === true) {
        return new Promise<boolean>((resolve) => {
          heldByKey.push(() => {
            files.set(key, data);
            resolve(true);
          });
        });
      }
      // A store that is SLOW on its first write, so a test can decide when
      // that write lands relative to later ones.
      if (options.holdFirstPut === true && held === null && !released) {
        return new Promise<boolean>((resolve) => {
          held = () => {
            files.set(key, data);
            resolve(true);
          };
        });
      }
      files.set(key, data);
      return Promise.resolve(true);
    },
    getText: (key: string) => {
      const value = files.get(key);
      return Promise.resolve(typeof value === "string" ? value : undefined);
    },
    getBlob: () => Promise.resolve(undefined),
    keys: () => Promise.resolve([...files.keys()]),
    remove: (key: string) => {
      // A delete that never settles models the tab being closed mid-sweep,
      // and a store that refuses the removal outright. Both leave the file
      // on disk, which is what the meta has to outrank.
      if (options.removeNeverSettles === true)
        return new Promise<void>(() => {});
      if (refusedRemoves < (options.refuseRemoves ?? 0)) {
        refusedRemoves += 1;
        return Promise.resolve();
      }
      files.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      // Empties, like the real one. A no-op here would let a test pass
      // against production code that still called `clear` (PR #454 review).
      files.clear();
      return Promise.resolve();
    },
  };
  return {
    store,
    files,
    putKeys,
    metaPuts,
    releaseHeldPut: () => {
      released = true;
      held?.();
      held = null;
    },
    releaseHeldKeys: () => {
      for (const land of heldByKey.splice(0)) land();
    },
  };
}

function pin(id: string): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-09-10T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

/**
 * A store state aligned enough for a placement to be allowed.
 *
 * Only the three selectors `placementAllowed` and `mintPin` reach for -
 * the alignment matrix, this session's GPS fixes, and the zero reference -
 * so this is deliberately the SHAPE those selectors read rather than a
 * real store driven by real actions. A real one would need the whole
 * alignment pipeline to run for a test about a file being written.
 */
function alignedArStore(): unknown {
  const state = {
    gpsData: {
      zero: { lat: 47.5, lon: 8.7 },
      gpsEvents: {
        alignmentMatrix: new Matrix4(),
        // `sampleCount` counts fixes SINCE the session started, and
        // `ctx.gpsSamplesAtSessionStart` is 0 in a fresh session, so the
        // length is the count.
        gpsPositions: Array.from({ length: MIN_ALIGNMENT_SAMPLES }, () => ({
          lat: 47.5,
          lon: 8.7,
        })),
      },
    },
  };
  // `dispatch` records what the setup logs into the troubleshooting
  // recording (`tourAuthoring/*`); nothing reads it back into state.
  const dispatched: unknown[] = [];
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    dispatch: (action: unknown) => dispatched.push(action),
    dispatched,
  };
}

/** A reticle that always has a surface under it, at the origin. */
function fakeReticle(): unknown {
  return {
    isVisible: () => true,
    getWorldPosition: (v: Vector3) => v.set(1, 0, -2),
  };
}

function wire(
  store: DraftFileStore,
  options: {
    firstOpenFails?: boolean;
    placeable?: boolean;
    /** Turn the world group about +Y (up) by this many degrees. */
    worldGroupYawDeg?: number;
  } = {},
) {
  let opens = 0;
  // The AR world group, one metre east of the odometry origin: the pin's
  // world position minus this offset is its position in odometry.
  const worldGroup = new Group();
  worldGroup.position.set(1, 0, 0);
  worldGroup.rotation.y = ((options.worldGroupYawDeg ?? 0) * Math.PI) / 180;
  worldGroup.updateMatrixWorld();
  const dom = fakeDom();
  const ctx = createTourViewerSession();
  // Everything a placement needs beyond the store: a measured level, a
  // live session, a reticle with a surface, and an aligned AR state.
  if (options.placeable === true) {
    ctx.reticle = fakeReticle() as never;
  }
  const arStore = (
    options.placeable === true ? alignedArStore() : createTourViewerStore()
  ) as { dispatched?: unknown[] };
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore: arStore as never,
    arController: {
      getState: () => ({
        status: options.placeable === true ? "running" : "idle",
      }),
      disable: () => undefined,
    } as never,
    // `getScene` yields null, so `previewObject` returns before touching
    // three.js: these tests are about what reaches DISK, and a placement
    // must be provable without a renderer.
    seams: {
      // The object list's outcome hold and Undo window (M4 review #5):
      // never fired here - these tests are about what reaches disk.
      schedule: () => () => undefined,
      canShareZip: () => false,
      getScene: () => null,
      getArWorldGroup: () => worldGroup,
    } as never,
    wizard: { openStep: () => undefined, revealStep: () => undefined } as never,
    dom: dom as unknown as CreatorSetupDom,
    openDraftStore: () => {
      opens += 1;
      // The first open yields NO store - a browser without OPFS, blocked
      // site data, a quota wall - which is the path that fires the shared
      // persistence notice and burns its once-per-wiring flag.
      if (options.firstOpenFails === true && opens === 1) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(store);
    },
  });
  if (options.placeable === true) {
    setup.codes.setInHand({ id: "lvl", json: "{}" }, null);
  }
  return { dom, ctx, setup, dispatched: arStore.dispatched ?? [] };
}

/**
 * Let every already-resolved microtask in the chain run: a macrotask
 * boundary drains the whole microtask queue, however deep the chain of
 * awaits (the per-id write queue added several, M4 review #7). A held
 * write stays held - only `releaseHeld*` lands it.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

const TOUR = "https://example.test/tour.zip";
const OTHER_TOUR = "https://example.test/other-tour.zip";

/** The `rejected` list of a written meta payload. */
function rejectedOf(json: string | undefined): readonly string[] {
  return (
    (JSON.parse(String(json)) as { rejected?: readonly string[] }).rejected ??
    []
  );
}

describe("rejecting a draft deletes what was rejected, and nothing else", () => {
  it("deletes the draft's objects and leaves one placed after it was read", async () => {
    // THE contract, and the reason this whole shape changed. Discarding
    // used to empty the namespace and write back the survivors, so there
    // was always a moment when this session's work existed only in memory.
    // The ids now come from what `readDraft` returned, so a file written
    // after that read is not a candidate for deletion at all - which is
    // what "placed while the offer sat on screen" means, the offer not
    // being modal.
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
    });
    const { dom, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    expect(dom.draftOffer.hidden, "the draft should have been offered").toBe(
      false,
    );

    // This session places, AFTER the draft was read. In the app this is
    // `recordPlacement`; here the file is written the same way it would be.
    await store.put(objectKey("mine"), JSON.stringify(pin("mine")));

    dom.draftDiscard.click();
    await settle();

    expect(
      files.has(objectKey("old-pin")),
      "the rejected draft's object must be gone",
    ).toBe(false);
    expect(
      files.has(objectKey("mine")),
      "a placement made after the read must never be touched",
    ).toBe(true);
    expect(files.has(META_KEY), "the gate file must survive").toBe(true);
  });

  it("reclaims files the read could not parse, which nothing else collects", async () => {
    // `draft.objects` is what PARSED. A record from an older version of the
    // app, or a photo whose bytes never landed - `writeDraftObject` returns
    // false when the photo write hits a quota wall and the record it already
    // wrote stays - are skipped by `readDraft` and leave their files behind.
    // `clear` used to sweep them on both paths; with its last caller gone,
    // deleting only the parsed ids would leak them for the life of the
    // origin, in a namespace keyed by tour url (PR #454 review, found
    // independently by both reviewers).
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("good")]: JSON.stringify(pin("good")),
      // Not JSON the parser accepts.
      [objectKey("older-shape")]: JSON.stringify({ id: "older-shape" }),
      // Bytes with no record at all.
      [photoKey("orphan-bytes")]: "bytes",
    });
    const { dom, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    expect(files.has(objectKey("good"))).toBe(false);
    expect(
      files.has(objectKey("older-shape")),
      "a record the read refused is still a file",
    ).toBe(false);
    expect(
      files.has(photoKey("orphan-bytes")),
      "bytes whose record never landed have no object id to find them by",
    ).toBe(false);
  });

  it("deletes a photo's bytes along with its record", async () => {
    // An object is TWO files. Deleting only the record leaves orphaned
    // bytes in a namespace that lives as long as the tour does, and a
    // caller should not have to know that an object is two things.
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("shot")]: JSON.stringify(pin("shot")),
      [photoKey("shot")]: "bytes",
    });
    const { dom, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    expect(files.has(objectKey("shot"))).toBe(false);
    expect(files.has(photoKey("shot"))).toBe(false);
  });
});

describe("the rejection is committed by the meta write", () => {
  it("holds even when the deletes never run at all", async () => {
    // THE test this change exists for; it fails against the previous
    // shape. A discard used to rewrite the meta and THEN remove the object
    // files without awaiting them, so the moment a rejection became true
    // was spread over several writes. A reload landing between them - or a
    // delete that simply failed - found a valid meta plus the rejected
    // objects still on disk, and offered the creator the draft they had
    // just thrown away. Here the deletes never settle, so the rejection
    // has to hold on the meta alone.
    const { store, files } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
        [photoKey("old-pin")]: "bytes",
      },
      { removeNeverSettles: true },
    );
    const { dom, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    expect(
      files.has(objectKey("old-pin")),
      "the delete deliberately never ran - that is the point",
    ).toBe(true);
    const reread = await readDraft(store);
    expect(
      reread?.draft.objects,
      "the meta write alone has to be enough",
    ).toEqual([]);
  });

  it("re-states the rejection on the next meta write, so a placement cannot un-reject it", async () => {
    // The meta is rewritten on every mint, every finish and every tour
    // open - NOT on a placement, which writes only the object file
    // (PR #456 review corrected this claim). A write that dropped the list
    // would resurrect a draft whose files are still there, which is the
    // same failure one step later. The re-open below is one of those write
    // paths.
    const { store } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
      },
      { removeNeverSettles: true },
    );
    const { dom, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    // A later meta write, as re-opening the tour makes.
    dom.sizeInput.value = "0.25";
    setup.presentDraftForTour(TOUR);
    await settle();

    const reread = await readDraft(store);
    expect(reread?.draft.objects).toEqual([]);
  });

  it("says so when the rejection could not be committed, and deletes nothing", async () => {
    // Why this test matters: the creator tapped "Delete it" and nothing was
    // deleted. Without a word on screen they carry on believing the draft
    // is gone, and meet it again on the next open with no explanation.
    // This module has exactly one channel for a refused write and
    // `recordPlacement` already uses it for the same underlying condition -
    // the store refused a `put`. A discard that fails silently is that
    // condition reported nowhere (PR #455 review, CodeRabbit).
    const { store, files } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
      },
      { putFails: true },
    );
    const { dom, ctx, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    expect(
      ctx.placementNote,
      "nothing has failed yet - the note must be caused by the tap",
    ).toBeNull();

    dom.draftDiscard.click();
    await settle();

    expect(
      files.has(objectKey("old-pin")),
      "an uncommitted rejection must delete nothing - the meta still points at it",
    ).toBe(true);
    expect(ctx.placementNote).toContain("Could not delete the saved draft");
  });

  it("queues a second meta write after a failed one, to overwrite a stale snapshot", async () => {
    // Why this test matters: a mint or finish queued between the discard's
    // dispatch and its failure has ALREADY copied the rejected ids into its
    // own payload, so restoring the in-memory list cannot unbake it - that
    // write would land later and commit a discard the creator was just told
    // had failed. A second write, queued last, lands last and puts the old
    // list back (PR #457 review, CodeRabbit).
    //
    // SCOPE, stated because it matters: this covers the MECHANISM - that a
    // compensating write is issued - not the full scenario. Queuing a real
    // mint mid-discard needs a stable QR pose, an alignment matrix and a
    // zero reference, which is far more scaffolding than the one line it
    // would guard.
    const { store, metaPuts } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
      },
      { putFails: true },
    );
    const { dom, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    // The CONTENT, not the count. Written as a count first, this test passed
    // with the restore itself deleted - two writes still happened, the
    // second one re-committing the very rejection the branch reports as
    // failed. The extra write is only the delivery; the restored list is
    // the fix (PR #458 review).
    expect(rejectedOf(metaPuts.at(-2)), "the attempt that failed").toEqual([
      "old-pin",
    ]);
    expect(
      rejectedOf(metaPuts.at(-1)),
      "and the one behind it, carrying the list back",
    ).toEqual([]);
  });

  it("still speaks when the shared persistence notice has been used up", async () => {
    // Why this test matters: the FIRST version of this branch reused
    // `noteNoPersistence`, which fires ONCE per wiring. A quota wall is
    // rarely a one-off, so an earlier refused write burns that flag and the
    // creator's next tap clears its note from screen - leaving a failed
    // discard completely mute, which is the silence the branch was added to
    // close. Found by review, not by the test written with the branch
    // (PR #456).
    const { store } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
      },
      { putFails: true },
    );
    const { dom, ctx, setup } = wire(store, { firstOpenFails: true });

    // A tour with no persistence at all burns the shared notice...
    setup.presentDraftForTour("https://example.test/other.zip");
    await settle();
    expect(
      ctx.placementNote,
      "the shared notice must actually have fired, or this proves nothing",
    ).not.toBeNull();
    // ...and the creator's next tap clears it from the screen.
    ctx.placementNote = null;

    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    expect(ctx.placementNote).toContain("Could not delete the saved draft");
  });

  it("lets the newer meta write win, even when an older one is still in flight", async () => {
    // Why this test matters: every meta write targets ONE key, and the
    // mint, finish and tour-open writes are never awaited. An older write
    // landing later overwrites a newer one - and when the newer one is the
    // discard, the draft the creator just rejected comes back
    // (PR #456 review, CodeRabbit).
    const { store, files, releaseHeldPut } = memoryStore(
      {},
      { holdFirstPut: true },
    );
    const { dom, setup } = wire(store);

    // Open one: no draft yet, so the open records the meta - and that write
    // is HELD, still in flight, carrying an empty rejection list.
    setup.presentDraftForTour(TOUR);
    await settle();

    // The draft open two finds, as a previous session would have left it.
    files.set(
      META_KEY,
      JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
    );
    files.set(objectKey("old-pin"), JSON.stringify(pin("old-pin")));

    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    // The held write lands LAST. Unqueued, it would overwrite the rejection
    // with the empty list it captured back at open one.
    releaseHeldPut();
    await settle();

    // Asserted on the META, not on what `readDraft` returns. The first
    // version of this test read the draft back and passed with the chain
    // REMOVED: the discard had already deleted the object file, so the
    // resurrected meta had nothing left to point at. What the ordering
    // decides is this list, so this list is what the test reads.
    const written = JSON.parse(String(files.get(META_KEY))) as {
      rejected?: readonly string[];
    };
    expect(
      written.rejected,
      "a stale write must not overwrite the committed rejection",
    ).toEqual(["old-pin"]);
  });

  it("does not let a stalled tour block a DIFFERENT tour's discard", async () => {
    // Why this test matters: the write chain that fixes the ordering also
    // makes every later meta write wait on the earliest. A `put` that never
    // SETTLES is not caught by `catch`, so without a reset at tour close a
    // single stalled write would block every discard for the life of the
    // page - neither deleting nor reporting, which is worse than the race
    // the chain was added to close (PR #457 review).
    const { store, files } = memoryStore({}, { holdFirstPut: true });
    const { dom, setup } = wire(store);

    // Tour one: no draft, so the open records the meta - and that write is
    // held forever. It is never released in this test.
    setup.presentDraftForTour(OTHER_TOUR);
    await settle();
    setup.resetFinishStep();

    // A DIFFERENT tour, with a draft to reject. Different tour, different
    // OPFS namespace, so nothing it writes is ordered against tour one's.
    files.set(
      META_KEY,
      JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
    );
    files.set(objectKey("old-pin"), JSON.stringify(pin("old-pin")));
    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    expect(
      files.has(objectKey("old-pin")),
      "the discard must not be waiting on the previous tour's stalled write",
    ).toBe(false);
  });

  it("keeps the ordering across a close and reopen of the SAME tour", async () => {
    // Why this test matters: the reset that stops a stalled tour blocking
    // the next one must not be applied to the same tour reopened. That is
    // the same OPFS directory, and reopening one link after a finish is a
    // real path - so a slow write from before the close still targets it.
    // On a fresh chain it lands after the reopened tour's writes and
    // clobbers them with the values it captured before (PR #458 review).
    const { store, files, releaseHeldPut } = memoryStore(
      {},
      { holdFirstPut: true },
    );
    const { dom, setup } = wire(store);

    // Open: no draft, so the meta is recorded - and that write is held.
    setup.presentDraftForTour(TOUR);
    await settle();

    // Closed, then the SAME link reopened, now with a draft on disk.
    setup.resetFinishStep();
    files.set(
      META_KEY,
      JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
    );
    files.set(objectKey("old-pin"), JSON.stringify(pin("old-pin")));
    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    releaseHeldPut();
    await settle();

    // Read what is ON DISK, not the order the writes were ISSUED.
    // Written against `metaPuts` first, this passed with the scoping
    // removed: the issue order never changes, only the landing order does,
    // and the held write only reaches `files` when released.
    expect(
      rejectedOf(String(files.get(META_KEY))),
      "the write from before the close must not land last",
    ).toEqual(["old-pin"]);
  });

  it("keeps a tour's ordering across ANOTHER tour opened in between", async () => {
    // Why this test matters: keying the chain to "the last tour seen" held
    // for A -> close -> A but not for A -> B -> A. Opening B reset the
    // chain, and reopening A reset it again, so A's stalled first write was
    // left off every chain and landed after A's reopened writes - the same
    // clobber, one intermediate tour later. A chain PER TOUR holds for any
    // interleaving (PR #459 review, found by both reviewers).
    //
    // The fake hands the same store to every tour, where production gives
    // each its own directory. That does not weaken the test: what is under
    // test is which CHAIN a write joins, and the seeding below puts A's
    // draft in place before A is reopened.
    const { store, files, releaseHeldPut } = memoryStore(
      {},
      { holdFirstPut: true },
    );
    const { dom, setup } = wire(store);

    // A: no draft, so the open records the meta - and that write is held.
    setup.presentDraftForTour(TOUR);
    await settle();
    setup.resetFinishStep();

    // B, opened and closed in between.
    setup.presentDraftForTour(OTHER_TOUR);
    await settle();
    setup.resetFinishStep();

    // A again, now with a draft to reject.
    files.set(
      META_KEY,
      JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
    );
    files.set(objectKey("old-pin"), JSON.stringify(pin("old-pin")));
    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    releaseHeldPut();
    await settle();

    expect(
      rejectedOf(String(files.get(META_KEY))),
      "A's stalled first write must still land BEFORE A's reopened ones",
    ).toEqual(["old-pin"]);
  });

  it("treats two urls that differ only in whitespace as ONE namespace", async () => {
    // Why this test matters: the OPFS directory and the meta key come from
    // `draftKeyForTour`, which trims. Keying the write chain on the RAW url
    // gave those two urls independent chains over one directory - the same
    // clobber as an unordered write, through another door. Reachable: the
    // paste paths trim before opening, but the `?qr=` boot passes the
    // decoded payload through untouched, and that payload is external data
    // (PR #460 review).
    const { store, files, releaseHeldPut } = memoryStore(
      {},
      { holdFirstPut: true },
    );
    const { dom, setup } = wire(store);

    // Launched from a QR payload carrying stray whitespace: no draft yet, so
    // the open records the meta - and that write is held.
    setup.presentDraftForTour(` ${TOUR} `);
    await settle();
    setup.resetFinishStep();

    // The same tour, pasted this time, so already trimmed.
    files.set(
      META_KEY,
      JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
    );
    files.set(objectKey("old-pin"), JSON.stringify(pin("old-pin")));
    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftDiscard.click();
    await settle();

    releaseHeldPut();
    await settle();

    expect(
      rejectedOf(String(files.get(META_KEY))),
      "one directory must mean one chain, however the url was spelled",
    ).toEqual(["old-pin"]);
  });

  it("sweeps a rejection whose deletes never finished, on the next open", async () => {
    // The files of an interrupted sweep have no other collector: the offer
    // never shows them again, and `clear` lost its last caller. Without
    // this they would sit in the tour's namespace for the life of the
    // origin.
    //
    // The LIVE object is what makes this test about the sweep. Written
    // without it, the draft's only object was the rejected one, so the
    // read came back empty, the draft counted as SPENT, and the spent
    // path's own deletes cleaned up - the test passed with the sweep loop
    // deleted. Verified by deleting it.
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({
        tourUrl: TOUR,
        sizeM: 0.16,
        level: null,
        rejected: ["left-behind"],
      }),
      [objectKey("left-behind")]: JSON.stringify(pin("left-behind")),
      [photoKey("left-behind")]: "bytes",
      [objectKey("alive")]: JSON.stringify(pin("alive")),
    });
    const { dom, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();

    expect(
      dom.draftOffer.hidden,
      "the draft must still be OFFERED - a spent draft would delete these anyway",
    ).toBe(false);
    expect(files.has(objectKey("left-behind"))).toBe(false);
    expect(files.has(photoKey("left-behind"))).toBe(false);
    expect(
      files.has(objectKey("alive")),
      "the sweep takes the rejected ids and nothing else",
    ).toBe(true);
  });

  it("does not reject a placement made after the tap", async () => {
    // The list is the READ's snapshot, so work done while the offer sat on
    // screen is not in it. Committing the rejection must not widen it.
    const { store } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
      },
      { removeNeverSettles: true },
    );
    const { dom, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    await store.put(objectKey("mine"), JSON.stringify(pin("mine")));
    dom.draftDiscard.click();
    await settle();

    const reread = await readDraft(store);
    expect(reread?.draft.objects.map((o) => o.id)).toEqual(["mine"]);
  });
});

describe("the spent-draft path", () => {
  it("deletes the draft the hosted zip already carries, and keeps the gate file", async () => {
    // Spent means the hosted zip has everything, so the files are safe to
    // drop - and this used to be a `clear`, which could not tell them from
    // anything placed during the reads that decide "spent". The list comes
    // from the read now, so it cannot include a later placement.
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(pin("hosted")),
    });
    const { ctx, dom, setup } = wire(store);
    // The hosted manifest already carries it, and the draft holds no
    // measurement, so `draftIsSpent` is true.
    ctx.tourManifest = { objects: [pin("hosted")] } as never;

    // Set explicitly first: the fake element starts visible, so "still
    // hidden" would otherwise be true for the wrong reason.
    dom.draftOffer.hidden = true;
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(
      files.has(objectKey("hosted")),
      "a spent draft's files should be deleted",
    ).toBe(false);
    expect(files.has(META_KEY), "the gate file is rewritten, not deleted").toBe(
      true,
    );
    expect(dom.draftOffer.hidden, "a spent draft is never offered").toBe(true);
  });

  it("marks it rejected BEFORE deleting, so an interrupted sweep cannot undo it", async () => {
    // Why this test matters: the discard has had this commit point tested
    // since PR #456, and the spent path - which empties the same folder -
    // had nothing. A mutation sweep over every write path found it: the
    // whole `draftRejected = stored.storedIds` line could be deleted and
    // the entire unit suite stayed green.
    //
    // `removeNeverSettles` is the interrupted sweep: the deletes are
    // issued and never land, exactly as a tab closed mid-sweep leaves
    // them. What must survive is the META, because that is the only
    // record that says these files no longer count.
    const { store, files } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("hosted")]: JSON.stringify(pin("hosted")),
      },
      { removeNeverSettles: true },
    );
    const { ctx, setup } = wire(store);
    ctx.tourManifest = { objects: [pin("hosted")] } as never;

    setup.presentDraftForTour(TOUR);
    await settle();

    expect(
      rejectedOf(files.get(META_KEY) as string),
      "the meta must reject the ids whose deletes are still in flight",
    ).toContain("hosted");
  });

  it("deletes nothing when the rejection could not be committed", async () => {
    // The other half of the same commit point, and the direction that
    // loses data rather than merely leaking it: if the meta write fails
    // and the deletes run anyway, the files are gone while the only record
    // of that decision never reached disk. The next open then re-offers a
    // draft whose objects no longer exist.
    const { store, files } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("hosted")]: JSON.stringify(pin("hosted")),
      },
      { putFails: true },
    );
    const { ctx, setup } = wire(store);
    ctx.tourManifest = { objects: [pin("hosted")] } as never;

    setup.presentDraftForTour(TOUR);
    await settle();

    expect(
      files.has(objectKey("hosted")),
      "a refused commit must leave the files alone",
    ).toBe(true);
    expect(
      ctx.placementNote,
      "and the creator has to hear that nothing is being saved",
    ).toContain("not saving a backup copy");
  });
});

describe("a placement reaches the draft", () => {
  it("writes the object file, not just the in-memory list", async () => {
    // Why this test matters: this is THE write the whole feature exists
    // for - the one that survives the OS killing the tab mid-walk - and
    // until the mutation sweep of 2026-09-11 the entire body of
    // `recordPlacement` could be deleted with every unit test still
    // green. Sixteen tests covered what happens to a draft AFTERWARDS and
    // none covered it being made.
    const { store, files } = memoryStore();
    const { ctx, dom, setup } = wire(store, { placeable: true });
    setup.presentDraftForTour(TOUR);
    await settle();

    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    await settle();

    const placed = ctx.placedObjects[0]?.object;
    expect(placed, "the tap should have placed a pin").toBeDefined();
    expect(
      files.has(objectKey(String(placed?.id))),
      "the placed pin must be on disk, not only in ctx.placedObjects",
    ).toBe(true);
  });

  it("tells the creator when the store refuses the write", async () => {
    // The failure half. A refused write is silent by design - the tap
    // already worked in memory and must not fail - so the ONLY signal a
    // creator gets that their walk is not being backed up is this note.
    // It too was uncovered: the whole `if (!ok)` branch could go.
    const { store } = memoryStore({}, { putFails: true });
    const { ctx, dom, setup } = wire(store, { placeable: true });
    setup.presentDraftForTour(TOUR);
    await settle();

    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    await settle();

    expect(ctx.placedObjects.length, "the tap still places the pin").toBe(1);
    expect(
      ctx.placementNote,
      "and the creator is told the walk is not being saved",
    ).toContain("not saving a backup copy");
  });

  // Why this test matters (code book plan M5d-2): the code in hand belongs
  // to the tour, and the close reaches the creator only through
  // `resetFinishStep` - this is what keeps one tour's code out of the next
  // tour's draft and zip (M5 review #9).
  it("empties the code in hand when the tour closes", () => {
    const { store } = memoryStore();
    const { setup } = wire(store, { placeable: true });
    expect(setup.codes.inHand()).not.toBeNull();
    setup.resetFinishStep();
    expect(setup.codes.inHand()).toBeNull();
    expect(setup.codes.measurement()).toBeNull();
  });

  it("cannot land in the namespace of a tour that has closed", async () => {
    // Why this test matters: closing a tour drops the store handle, and
    // that one line is the only thing standing between "the creator placed
    // a pin with no tour open" and that pin being written into the PREVIOUS
    // tour's folder - where the next open would offer it as that tour's
    // draft. It is the cross-tour shape that has already produced three
    // separate defects here, and the sweep found the line untested.
    const { store, files } = memoryStore();
    const { ctx, dom, setup } = wire(store, { placeable: true });
    setup.presentDraftForTour(TOUR);
    await settle();
    const before = files.size;

    // The tour closes. Everything about it is dropped, including the
    // handle its writes were going through.
    setup.resetFinishStep();
    // The close empties the hand too (the code belongs to the tour); a
    // code taken again keeps the placement gate open, which this test is
    // not about.
    setup.codes.setInHand({ id: "lvl", json: "{}" }, null);

    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    await settle();

    expect(ctx.placedObjects.length, "the tap still places in memory").toBe(1);
    expect(
      files.size,
      "but nothing may be written to the closed tour's folder",
    ).toBe(before);
    // Deliberately NOT asserted: that the creator is warned. In this branch
    // `recordPlacement` sets the note synchronously and the pin handler's
    // own "Pin placed" note overwrites it two lines later, so the warning
    // never reaches the screen - and the once-per-session flag is burnt on
    // the way past. It is not reachable in the app today (the same close
    // that drops the store also clears the measured level, and placement
    // needs one), which is why this test does not demand a fix; the
    // asserted half is the one that matters, and the rest is written up in
    // the sweep's findings.
  });
});

describe("a draft offered while the AR session runs", () => {
  it("says so inside the overlay, where the creator can read it", async () => {
    // Why this matters (milestone review #4): a scan opens the tour
    // mid-session, and the restore offer sits outside the AR overlay - the
    // creator would not see it and would place the same content again.
    const { store } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
    });
    const { ctx, dom, setup } = wire(store, { placeable: true });
    setup.presentDraftForTour(TOUR);
    await settle();
    expect(dom.draftOffer.hidden).toBe(false);
    expect(String(ctx.placementNote)).toMatch(/restore it after leaving AR/);
  });
});

describe("work made before the tour's draft opened reaches it", () => {
  // Why these tests matter (TourViewer scan-to-open plan §9 #5): a creator
  // can measure and place before any tour is open - scan-to-open makes
  // that the normal order - and between an open and its manifest settling
  // there is no draft store yet either. Such a placement used to say "not
  // saving a backup copy" (spending the one warning a real storage failure
  // needs) and was never written, so a crash lost it even on a phone that
  // saves drafts.
  it("does not spend the backup warning on a placement with no tour yet", async () => {
    // The warning is said ONCE per page. Spent on "no tour yet" - which is
    // not a storage failure - it was gone when the tour opened on a phone
    // that really cannot save (the first open yields no store here).
    const { store } = memoryStore();
    const { ctx, dom, setup } = wire(store, {
      placeable: true,
      firstOpenFails: true,
    });
    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    await settle();
    expect(ctx.placedObjects).toHaveLength(1);
    ctx.placementNote = null; // the creator's next tap

    setup.presentDraftForTour(TOUR);
    await settle();
    expect(String(ctx.placementNote)).toContain("not saving a backup");
  });

  it("writes the placements into the draft once it opens", async () => {
    const { store, files } = memoryStore();
    const { ctx, dom, setup } = wire(store, { placeable: true });
    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    await settle();
    const id = String(ctx.placedObjects[0]?.object.id);
    expect(files.has(objectKey(id)), "nothing to write to yet").toBe(false);

    setup.presentDraftForTour(TOUR);
    await settle();
    expect(files.has(objectKey(id))).toBe(true);
  });

  it("records a level measured before the open, even beside an older draft", async () => {
    // The offer branch wrote no meta: an older draft waiting to be restored
    // left this session's measurement only in memory.
    const { store, metaPuts } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
    });
    const { dom, setup } = wire(store, { placeable: true });
    setup.codes.setInHand({ id: "fresh", json: "{}" }, null);
    setup.presentDraftForTour(TOUR);
    await settle();
    expect(dom.draftOffer.hidden, "the older draft is offered").toBe(false);
    const last = JSON.parse(String(metaPuts.at(-1))) as {
      level: { id: string } | null;
    };
    expect(last.level?.id).toBe("fresh");
  });
});

describe("a closed tour's replace steps", () => {
  it("go back to the generic text, so the next tour's host decides", () => {
    // Why this matters (Drive replace plan §5 #13): the Drive steps belong
    // to the Drive tour they were written for; after a switch to a Dropbox
    // tour they would tell its creator to use drive.google.com.
    const { store } = memoryStore();
    const { dom, setup } = wire(store);
    dom.replaceHelpDrive.hidden = false;
    dom.replaceHelpGeneric.hidden = true;
    setup.resetFinishStep();
    expect(dom.replaceHelpDrive.hidden).toBe(true);
    expect(dom.replaceHelpGeneric.hidden).toBe(false);
  });
});

describe("the troubleshooting recording's log of a placement", () => {
  it("records a placed pin with the reticle in odometry, the alignment and the matrix it was read through", async () => {
    // Why this test matters (authoring recording plan 2026-09-28-0953, M1a):
    // the pin's record carries only geo, so a recording that logged just
    // the record could never say WHY a note landed where it did - the
    // drift hypotheses (plan §2.1) are told apart by the reticle's
    // odometry position and the two matrices, target and rendered.
    const { store } = memoryStore();
    const { dom, dispatched } = wire(store, { placeable: true });

    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    await settle();

    const logged = dispatched.filter(
      (a) => (a as { type: string }).type === "tourAuthoring/objectPlaced",
    ) as {
      payload: {
        object: TourObject;
        reticleOdomNue: number[];
        alignmentMatrix: unknown;
        arWorldGroupMatrix: number[];
        cameraOdomPose: unknown;
        arVisitIndex: number;
        codeSizeM: number;
      };
    }[];
    expect(logged).toHaveLength(1);
    const payload = logged[0]!.payload;
    expect(payload.object.kind).toBe("pin");
    // The fake reticle sits at world (1, 0, -2); the group is shifted 1 m.
    expect(payload.reticleOdomNue).toEqual([0, 0, -2]);
    expect(payload.arWorldGroupMatrix[12]).toBe(1);
    expect(payload.alignmentMatrix).not.toBeNull();
    expect(payload.cameraOdomPose).toBeNull();
    expect(payload.arVisitIndex).toBe(0);
    // The anchor code's printed size (M1a review finding 8): a code's
    // solved pose scales with it, so a placement read against a code
    // cannot be re-derived without it.
    expect(payload.codeSizeM).toBe(AUTHOR_DEFAULT_SIZE_M);
    // JSON-safe: it is written to a file as it is.
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it("with the world group yawed 90 degrees, records the reticle in the group's frame, not the world's", async () => {
    // Why this test matters (M1a review finding 6): the test above uses a
    // translation only, and the e2e fake's `worldToLocal` is the identity,
    // so a rotated frame was never exercised - and a 90-degree frame mix-up
    // is a class of bug this code base has had. With the group turned
    // +90 degrees about up and shifted 1 m east, the reticle at world
    // (1, 0, -2) is group-local (2, 0, 0): the world position would read
    // (1, 0, -2), and the opposite rotation (-2, 0, 0).
    const { store } = memoryStore();
    const { dom, dispatched } = wire(store, {
      placeable: true,
      worldGroupYawDeg: 90,
    });

    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    await settle();

    const logged = dispatched.filter(
      (a) => (a as { type: string }).type === "tourAuthoring/objectPlaced",
    ) as {
      payload: { reticleOdomNue: number[]; arWorldGroupMatrix: number[] };
    }[];
    expect(logged).toHaveLength(1);
    const { reticleOdomNue, arWorldGroupMatrix } = logged[0]!.payload;
    const [x, y, z] = reticleOdomNue;
    expect(x).toBeCloseTo(2, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
    // The two logged fields agree: the logged matrix takes the logged
    // local position back onto the reticle, so a replay can rebuild either
    // from the other.
    const world = new Vector3(x, y, z).applyMatrix4(
      new Matrix4().fromArray(arWorldGroupMatrix),
    );
    expect(world.x).toBeCloseTo(1, 9);
    expect(world.y).toBeCloseTo(0, 9);
    expect(world.z).toBeCloseTo(-2, 9);
  });
});

describe("a draft holding edits and deletions (authoring plan 2026-09-28-0953 §3.4, M4)", () => {
  // Why these tests matter: before M4 the draft compared IDS with the
  // hosted zip, so an edit of a hosted object (same id, new content) was
  // "already in the zip": never offered, and deleted as spent - the edit
  // lost across a crash with nothing on screen saying so. A deletion had
  // no representation at all, so a crash brought the object back.
  const HOSTED = pin("hosted");
  const EDITED: TourObject = { ...pin("hosted"), label: "the new text" };

  it("offers an edit of a hosted object as a change, and restores it in place of the hosted one", async () => {
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(EDITED),
    });
    const { ctx, dom, setup } = wire(store);
    ctx.tourManifest = { version: 1, objects: [HOSTED] } as never;
    dom.draftOffer.hidden = true;
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(dom.draftOffer.hidden, "an edit is unsaved work").toBe(false);
    expect(dom.draftOfferText.textContent).toContain("1 change");
    expect(files.has(objectKey("hosted")), "and it is not swept").toBe(true);
    dom.draftRestore.click();
    expect(ctx.placedObjects.map((p) => p.object)).toEqual([EDITED]);
  });

  it("offers a deletion the hosted zip has not seen, and restores it as a tombstone", async () => {
    const { store } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [deletedKey("hosted")]: "1",
    });
    const { ctx, dom, setup } = wire(store);
    ctx.tourManifest = { version: 1, objects: [HOSTED] } as never;
    dom.draftOffer.hidden = true;
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(dom.draftOfferText.textContent).toContain("1 deletion");
    dom.draftRestore.click();
    expect(ctx.deletedObjectIds).toEqual(["hosted"]);
    expect(ctx.placedObjects).toEqual([]);
    expect(ctx.placementNote).toContain("1 deletion restored");
  });

  it("treats a deletion the hosted zip no longer carries as spent", async () => {
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [deletedKey("gone")]: "1",
    });
    const { ctx, dom, setup } = wire(store);
    ctx.tourManifest = { version: 1, objects: [HOSTED] } as never;
    dom.draftOffer.hidden = true;
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(dom.draftOffer.hidden).toBe(true);
    expect(files.has(deletedKey("gone"))).toBe(false);
  });

  it("does not sweep a hosted object's file the creator edited while the draft was being read", async () => {
    // A spent draft deletes what the read returned. A new placement can
    // never be in that list (its id is fresh) - but an edit keeps its id,
    // so the sweep would take the live edit's file with it.
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(HOSTED),
    });
    const { ctx, setup } = wire(store);
    ctx.tourManifest = { version: 1, objects: [HOSTED] } as never;
    ctx.placedObjects = [{ object: EDITED }];
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(files.has(objectKey("hosted"))).toBe(true);
    // The live edit's content, not the spent draft's (M4 review #2).
    expect(JSON.parse(String(files.get(objectKey("hosted"))))).toEqual(EDITED);
    const meta = JSON.parse(String(files.get(META_KEY))) as {
      rejected?: string[];
    };
    expect(meta.rejected ?? []).not.toContain("hosted");
  });
});

describe("the order of the draft's writes (M4 review #1, #2 and #7)", () => {
  // Why these tests matter: each is a way the draft could hold something
  // OLDER than what the creator last did, and a crash then brings the old
  // state back with nothing on screen saying so - the failure the draft
  // exists to prevent.
  // - #1: the meta's rejected list outranks an object's file. An id the
  //   meta rejects (a published tour reopened, its draft swept as spent; or
  //   "Delete it") that the creator then edits or deletes kept its rejection,
  //   so the next read hid the change and the next open swept it.
  // - #2: work done while the draft was opening was written only when the
  //   draft held NO file for its id, so an older edit on disk won.
  // - #7: nothing ordered the writes to one id, so a placement's slow write
  //   could land after a quick delete of it.
  const HOSTED = pin("hosted");
  const NEW_TEXT = "the new text";
  const EDITED: TourObject = { ...HOSTED, label: NEW_TEXT };
  const OLDER: TourObject = { ...HOSTED, label: "an older edit" };
  const PUBLISHED = { version: 1, objects: [HOSTED] };

  /** Open the tour on `store` in a fresh page (a reopen after the tab
   *  died), with the hosted zip carrying `HOSTED`. */
  async function reopen(store: DraftFileStore) {
    const page = wire(store);
    page.ctx.tourManifest = PUBLISHED as never;
    page.dom.draftOffer.hidden = true;
    page.setup.presentDraftForTour(TOUR);
    await settle();
    return page;
  }

  /** The text of the object file the draft holds for `id`. */
  function onDisk(files: Map<string, unknown>, id: string): unknown {
    const text = files.get(objectKey(id));
    return typeof text === "string" ? JSON.parse(text) : undefined;
  }

  it("keeps an edit of an object a spent draft had rejected, across a crash", async () => {
    // A published tour reopened: the draft equals the zip, so it is spent
    // and its ids are rejected. Then the creator edits the hosted pin.
    const { store } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(HOSTED),
    });
    const first = await reopen(store);
    first.dom.objectList.listHandlers!.editText("hosted", NEW_TEXT);
    await settle();

    const later = await reopen(store);
    expect(later.dom.draftOffer.hidden, "the edit is offered").toBe(false);
    later.dom.draftRestore.click();
    expect(later.ctx.placedObjects.map((p) => p.object)).toEqual([EDITED]);
  });

  it("keeps a deletion of an object a spent draft had rejected, across a crash", async () => {
    const { store } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(HOSTED),
    });
    const first = await reopen(store);
    first.dom.objectList.listHandlers!.remove("hosted");
    await settle();

    const later = await reopen(store);
    expect(later.dom.draftOfferText.textContent).toContain("1 deletion");
    later.dom.draftRestore.click();
    expect(later.ctx.deletedObjectIds).toEqual(["hosted"]);
  });

  it("keeps an edit made after 'Delete it' rejected the same object", async () => {
    const { store } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(OLDER),
    });
    const first = await reopen(store);
    expect(first.dom.draftOffer.hidden, "the older edit is offered").toBe(
      false,
    );
    first.dom.draftDiscard.click();
    await settle();
    first.dom.objectList.listHandlers!.editText("hosted", NEW_TEXT);
    await settle();

    const later = await reopen(store);
    later.dom.draftRestore.click();
    expect(later.ctx.placedObjects.map((p) => p.object)).toEqual([EDITED]);
  });

  it("keeps an edit made in the same moment as 'Delete it', before its sweep ran", async () => {
    // The sweep is queued behind the meta write the discard commits, so an
    // edit tapped right after it claims the id FIRST. The sweep must then
    // see the id is no longer rejected, or it deletes the new edit.
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(OLDER),
    });
    const first = await reopen(store);
    first.dom.draftDiscard.click();
    first.dom.objectList.listHandlers!.editText("hosted", NEW_TEXT);
    await settle();

    expect(onDisk(files, "hosted")).toEqual(EDITED);
    expect(rejectedOf(String(files.get(META_KEY)))).not.toContain("hosted");
  });

  it("does not bring back a rejected file the sweep could not remove, when a crash follows the claim", async () => {
    // The claim's FIRST step. "Delete it" rejected an older edit, and the
    // sweep's removes were refused, so its file is still on disk. The
    // creator edits the pin; the meta stops rejecting the id; the tab dies
    // before the new record lands. Had the claim not removed the stale
    // file first, the rejected older edit would be offered again.
    const { store } = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [objectKey("hosted")]: JSON.stringify(OLDER),
      },
      {
        // The sweep's three removes (record, bytes, tombstone).
        refuseRemoves: 3,
        holdKeys: (key) => key === objectKey("hosted"),
      },
    );
    const first = await reopen(store);
    first.dom.draftDiscard.click();
    await settle();
    first.dom.objectList.listHandlers!.editText("hosted", NEW_TEXT);
    await settle();

    const later = await reopen(store);
    expect(
      later.dom.draftOffer.hidden,
      "the rejected older edit must not be offered",
    ).toBe(true);
  });

  it("still refuses an object rejected after it was written", async () => {
    // The other direction of the same rule: the claim takes an id out of
    // the rejected list only for a change made AFTER the rejection. "Delete
    // it" on a draft holding an edit rejects that edit for good.
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(OLDER),
    });
    const first = await reopen(store);
    first.dom.draftDiscard.click();
    await settle();
    expect(rejectedOf(String(files.get(META_KEY)))).toContain("hosted");
    const later = await reopen(store);
    expect(later.dom.draftOffer.hidden).toBe(true);
  });

  it("writes an edit made while the draft opened over the older edit the draft held", async () => {
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(OLDER),
    });
    const { ctx, setup } = wire(store);
    ctx.tourManifest = PUBLISHED as never;
    // Made before the draft namespace opened: nothing to write it to yet.
    ctx.placedObjects = [{ object: EDITED }];
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(onDisk(files, "hosted")).toEqual(EDITED);
  });

  it("writes a deletion made while the draft opened over the older edit the draft held", async () => {
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(OLDER),
    });
    const { ctx, setup } = wire(store);
    ctx.tourManifest = PUBLISHED as never;
    ctx.deletedObjectIds = ["hosted"];
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(files.has(deletedKey("hosted"))).toBe(true);
    expect(files.has(objectKey("hosted"))).toBe(false);
  });

  it("lands a quick delete after the slow write of the placement it deletes", async () => {
    const { store, files, releaseHeldKeys } = memoryStore(
      {},
      { holdKeys: (key) => key.startsWith("object:") },
    );
    const { ctx, dom, setup } = wire(store, { placeable: true });
    setup.presentDraftForTour(TOUR);
    await settle();
    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    const id = String(ctx.placedObjects[0]?.object.id);
    // Deleted before its write has landed.
    dom.objectList.listHandlers!.remove(id);
    await settle();
    releaseHeldKeys();
    await settle();

    expect(
      files.has(objectKey(id)),
      "the delete must land after the write it follows",
    ).toBe(false);
  });
});

describe("a draft with several codes (code book plan M4c-1)", () => {
  // Why this test matters: a draft kept ONE level, the code in hand, so a
  // crash after measuring a second code lost the first one's measurement.
  // A restored draft's codes all go back into the code book, and the next
  // meta write keeps them all.
  it("restores every code a draft kept, and the next meta write keeps them", async () => {
    const a = { id: "aaaaaaaaaaa1", json: '{"a":1}' };
    const b = { id: "bbbbbbbbbbb2", json: '{"b":1}' };
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({
        tourUrl: TOUR,
        sizeM: 0.16,
        level: b,
        levels: [a, b],
      }),
    });
    const { dom, setup } = wire(store);
    setup.presentDraftForTour(TOUR);
    await settle();
    expect(dom.draftOffer.hidden).toBe(false);
    dom.draftRestore.click();
    await settle();
    expect(setup.codes.inHand()).toEqual(b);
    // The tour opened again: with a code in hand its meta is re-stated.
    setup.presentDraftForTour(TOUR);
    await settle();
    const meta = JSON.parse(String(files.get(META_KEY))) as {
      level: unknown;
      levels: unknown;
    };
    expect(meta.level).toEqual(b);
    expect(meta.levels).toEqual([a, b]);
  });
});
