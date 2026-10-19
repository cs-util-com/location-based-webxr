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
  visitKey,
} from "./draft-persistence.js";
import { serializeVisitLogEntry, type VisitLogEntry } from "./visit-log.js";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { ObjectListHandlers } from "./object-list.js";
import { asHosted, stationIdOf, tourOf } from "./test-support/v3-tour.js";
import { SETTINGS_KEY } from "./tour-document-draft.js";
import { manifestToWrite } from "./tour-document.js";

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
  /** Attributes set (`aria-pressed` on "New station here"). */
  attributes: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  focus: () => void;
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
    attributes: {},
    focus: () => undefined,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
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
  "replaceHelpGeneric",
  "replaceHelpDrive",
  "replaceDriveCopy",
  "uploadAsk",
  "uploadAskText",
  "uploadYes",
  "uploadNo",
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
  "newStationButton",
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
    /** Refuse every put whose key this names (the others land). */
    failKeys?: (key: string) => boolean;
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
  const refuses =
    options.failKeys ?? ((): boolean => options.putFails === true);
  const store: DraftFileStore = {
    put: (key: string, data: unknown) => {
      putKeys.push(key);
      if (key === META_KEY && typeof data === "string") metaPuts.push(data);
      // A store that REFUSES, as the real one does on a quota wall or a
      // revoked directory handle: `put` reports false rather than throwing.
      if (refuses(key)) return Promise.resolve(false);
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
    /** The page hears the set of codes changed (follow-up F16). */
    onCodesChanged?: () => void;
    /** A store per draft namespace (by its key); `store` otherwise. */
    storeFor?: (key: string) => DraftFileStore;
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
    ...(options.onCodesChanged === undefined
      ? {}
      : { onCodesChanged: options.onCodesChanged }),
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
    openDraftStore: (key: string) => {
      opens += 1;
      // The first open yields NO store - a browser without OPFS, blocked
      // site data, a quota wall - which is the path that fires the shared
      // persistence notice and burns its once-per-wiring flag.
      if (options.firstOpenFails === true && opens === 1) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(options.storeFor?.(key) ?? store);
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
    dom.sizeInput.value = "25"; // cm, as the field reads (printed-side.ts)
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
    ctx.tourDocument.open(tourOf([pin("hosted")]));

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
    ctx.tourDocument.open(tourOf([pin("hosted")]));

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
    ctx.tourDocument.open(tourOf([pin("hosted")]));

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

    const placed = ctx.tourDocument.entries()[0]?.object;
    expect(placed, "the tap should have placed a pin").toBeDefined();
    expect(
      files.has(objectKey(String(placed?.id))),
      "the placed pin must be on disk, not only in the page's document",
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

    expect(
      ctx.tourDocument.entries().length,
      "the tap still places the pin",
    ).toBe(1);
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

    expect(
      ctx.tourDocument.entries().length,
      "the tap still places in memory",
    ).toBe(1);
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
    expect(ctx.tourDocument.entries()).toHaveLength(1);
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
    const id = String(ctx.tourDocument.entries()[0]?.object.id);
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

  // Why: Restore keeps a code measured live (it is newer than the draft's),
  // but its note said the draft's measured position came back - a claim
  // about a code the creator did not get back.
  it("Restore beside a code measured here does not claim the draft's position came back", async () => {
    const { store } = memoryStore({
      [META_KEY]: JSON.stringify({
        tourUrl: TOUR,
        sizeM: 0.16,
        level: { id: "old", json: "{}" },
      }),
    });
    const { ctx, dom, setup } = wire(store);
    setup.codes.setInHand({ id: "fresh", json: "{}" }, null);
    setup.presentDraftForTour(TOUR);
    await settle();
    expect(dom.draftOffer.hidden, "the draft's code is offered").toBe(false);
    dom.draftRestore.click();
    expect(setup.codes.inHand()?.id, "the live code stays").toBe("fresh");
    expect(ctx.placementNote).not.toContain("measured position");
  });

  // Why: the visit log adds only visits it does not hold, but the note
  // counted every visit the draft offered - so a draft offered again after
  // its visits were already brought back said they "came back" a second
  // time. The note counts what joined the log.
  it("Restore counts only the visits that joined the log, never one it already held", async () => {
    const visit = (visitId: string): VisitLogEntry => ({
      visitId,
      atMs: 5,
      gpsAccuracyM: 4,
      baselineM: 30,
      gps: [{ lat: 47.5, lng: 8.7, accuracy: 4 }],
      fused: [{ lat: 47.5001, lng: 8.7 }],
      codes: [],
    });
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [visitKey("page1-0")]: serializeVisitLogEntry(visit("page1-0")),
    });
    const { ctx, dom, setup } = wire(store);
    setup.presentDraftForTour(TOUR);
    await settle();
    expect(dom.draftOffer.hidden, "the visit is offered").toBe(false);
    dom.draftRestore.click();
    expect(ctx.placementNote).toMatch(/^1 AR visit restored/);
    await settle();
    // A second visit reaches the draft; the offer comes again, the first
    // visit already in the log.
    files.set(visitKey("page2-0"), serializeVisitLogEntry(visit("page2-0")));
    dom.draftOffer.hidden = true;
    setup.presentDraftForTour(TOUR);
    await settle();
    expect(dom.draftOffer.hidden, "offered again").toBe(false);
    dom.draftRestore.click();
    expect(ctx.placementNote).toMatch(/^1 AR visit restored/);
  });

  // Why: the live ids that keep a sweep off this page's visits were also
  // the filter of what Restore puts back, so a draft OBJECT whose id
  // equals a visit id in the log was skipped as "live work". Visit ids and
  // object ids are apart: Restore filters by live object work only.
  it("Restore puts back a draft object whose id equals a visit id in the log", async () => {
    const SHARED = "page1-0";
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [visitKey(SHARED)]: serializeVisitLogEntry({
        visitId: SHARED,
        atMs: 5,
        gpsAccuracyM: 4,
        baselineM: 30,
        gps: [{ lat: 47.5, lng: 8.7, accuracy: 4 }],
        fused: [{ lat: 47.5001, lng: 8.7 }],
        codes: [],
      }),
    });
    const { ctx, dom, setup } = wire(store);
    setup.presentDraftForTour(TOUR);
    await settle();
    dom.draftRestore.click();
    await settle();
    // The visit is in the log now; an object of the same id reaches the
    // draft and is offered.
    files.set(objectKey(SHARED), JSON.stringify(pin(SHARED)));
    dom.draftOffer.hidden = true;
    setup.presentDraftForTour(TOUR);
    await settle();
    expect(dom.draftOffer.hidden, "the object is offered").toBe(false);
    dom.draftRestore.click();
    expect(
      ctx.tourDocument.entries().map((e) => e.object.id),
      "the object came back",
    ).toContain(SHARED);
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
  /** `object` as the document holds it: in the station it stands in
   *  (every object names its station). */
  const inItsStation = (object: TourObject): TourObject => ({
    ...object,
    station: stationIdOf("hosted"),
  });

  it("offers an edit of a hosted object as a change, and restores it in place of the hosted one", async () => {
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(EDITED),
    });
    const { ctx, dom, setup } = wire(store);
    ctx.tourDocument.open(tourOf([HOSTED]));
    dom.draftOffer.hidden = true;
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(dom.draftOffer.hidden, "an edit is unsaved work").toBe(false);
    expect(dom.draftOfferText.textContent).toContain("1 change");
    expect(files.has(objectKey("hosted")), "and it is not swept").toBe(true);
    dom.draftRestore.click();
    expect(ctx.tourDocument.entries().map((p) => p.object)).toEqual([
      inItsStation(EDITED),
    ]);
  });

  it("offers a deletion the hosted zip has not seen, and restores it as a tombstone", async () => {
    const { store } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [deletedKey("hosted")]: "1",
    });
    const { ctx, dom, setup } = wire(store);
    ctx.tourDocument.open(tourOf([HOSTED]));
    dom.draftOffer.hidden = true;
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(dom.draftOfferText.textContent).toContain("1 deletion");
    dom.draftRestore.click();
    expect(ctx.tourDocument.deleted()).toEqual(["hosted"]);
    expect(ctx.tourDocument.entries()).toEqual([]);
    expect(ctx.placementNote).toContain("1 deletion restored");
  });

  // Why the next three matter (the r880 fix re-review, P1): the offer stays
  // on screen through a Finish, and a Finish's write takes the live edits
  // and deletions off the document's lists. The draft judged "live work"
  // by those lists alone, so Restore after a Finish brought back an older
  // version of a note the creator had changed or deleted here, and "Delete
  // it" rejected the live record of a changed one.
  const LIVE: TourObject = { ...pin("hosted"), label: "typed here" };

  /** The tour's draft offered, an edit of the hosted note on disk. */
  async function offeredEdit() {
    const disk = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(EDITED),
    });
    const page = wire(disk.store);
    page.ctx.tourDocument.open(tourOf([HOSTED]));
    page.dom.draftOffer.hidden = true;
    page.setup.presentDraftForTour(TOUR);
    await settle();
    expect(page.dom.draftOffer.hidden, "the draft is offered").toBe(false);
    return { ...disk, ...page };
  }

  /** A Finish's write landing in the document, as `creator-finish.ts`
   *  lands it: what it wrote leaves the lists. */
  function finishLanded(ctx: ReturnType<typeof wire>["ctx"]): void {
    const doc = ctx.tourDocument;
    const now = doc.state();
    const generation = doc.saveStarted();
    doc.saved({
      generation,
      written: manifestToWrite(now)!,
      appliedDeletions: [...now.deleted],
      stationsAtStart: now.stations,
    });
    doc.saveEnded(generation);
  }

  it("Restore after a Finish leaves a note deleted here deleted", async () => {
    const { ctx, dom } = await offeredEdit();
    ctx.tourDocument.remove("hosted", "the live delete");
    await settle();
    finishLanded(ctx);
    expect(ctx.tourDocument.deleted(), "the Finish wrote it").toEqual([]);

    dom.draftRestore.click();
    expect(
      ctx.tourDocument.objects().map((o) => o.object.id),
      "the delete is live work, newer than the draft",
    ).not.toContain("hosted");
  });

  it("Restore after a Finish keeps a note changed here as it was changed", async () => {
    const { ctx, dom } = await offeredEdit();
    ctx.tourDocument.edit(LIVE, "the live edit");
    await settle();
    finishLanded(ctx);
    expect(ctx.tourDocument.entries(), "the Finish wrote it").toEqual([]);

    dom.draftRestore.click();
    // (As written: the stored copy names its station.)
    expect(
      ctx.tourDocument.objects().find((o) => o.object.id === "hosted")?.object,
    ).toMatchObject({ label: LIVE.label });
  });

  // Why: Restore leaves out what live work outranks, but its note counted
  // the whole offer - "1 change restored" for an edit it had skipped.
  it("Restore's note counts what it put back, not what was offered", async () => {
    const OTHER_PIN = pin("other");
    const disk = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("hosted")]: JSON.stringify(EDITED),
      [deletedKey("other")]: "1",
    });
    const page = wire(disk.store);
    page.ctx.tourDocument.open(tourOf([HOSTED, OTHER_PIN]));
    page.dom.draftOffer.hidden = true;
    page.setup.presentDraftForTour(TOUR);
    await settle();
    expect(page.dom.draftOfferText.textContent).toContain("1 change");
    expect(page.dom.draftOfferText.textContent).toContain("1 deletion");
    page.ctx.tourDocument.edit(LIVE, "the live edit");
    await settle();

    page.dom.draftRestore.click();
    expect(page.ctx.placementNote).toContain("1 deletion restored");
    expect(page.ctx.placementNote).not.toContain("change");

    // Everything outranked: nothing is claimed, the code least of all.
    const all = await offeredEdit();
    all.ctx.tourDocument.edit(LIVE, "the live edit");
    await settle();
    all.dom.draftRestore.click();
    expect(all.ctx.placementNote).toContain("Nothing was restored");
    expect(all.ctx.placementNote).not.toContain("measured position");
  });

  it("Delete it after a Finish keeps the record of a note changed here", async () => {
    const { ctx, dom, files } = await offeredEdit();
    ctx.tourDocument.edit(LIVE, "the live edit");
    await settle();
    finishLanded(ctx);

    dom.draftDiscard.click();
    await settle();
    expect(JSON.parse(String(files.get(objectKey("hosted"))))).toEqual(
      inItsStation(LIVE),
    );
    expect(rejectedOf(files.get(META_KEY) as string)).not.toContain("hosted");
  });

  // Why: a live edit's record does not outrank a tombstone an older draft
  // left for the same id (`readDraft` lets the tombstone win), and the
  // edited id is live work, so "Delete it" does not sweep it either. The
  // reload then offered to delete the note the creator had just edited,
  // and a crash after the edit brought it back as deleted. A live record
  // takes its id's tombstone away after it, as an undo of a delete does.
  it("a note edited here over an offered deletion is not offered as deleted again", async () => {
    const disk = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [deletedKey("hosted")]: "1",
    });
    const page = wire(disk.store);
    page.ctx.tourDocument.open(tourOf([HOSTED]));
    page.dom.draftOffer.hidden = true;
    page.setup.presentDraftForTour(TOUR);
    await settle();
    expect(page.dom.draftOfferText.textContent).toContain("1 deletion");
    page.ctx.tourDocument.edit(LIVE, "the live edit");
    await settle();
    expect(
      disk.files.has(deletedKey("hosted")),
      "the live record took the tombstone away",
    ).toBe(false);
    finishLanded(page.ctx);
    page.dom.draftDiscard.click();
    await settle();
    expect(disk.files.has(deletedKey("hosted"))).toBe(false);
    expect(JSON.parse(String(disk.files.get(objectKey("hosted"))))).toEqual(
      inItsStation(LIVE),
    );

    // The reload: the edit is offered as the change it is, never a delete.
    const again = wire(disk.store);
    again.ctx.tourDocument.open(tourOf([HOSTED]));
    again.dom.draftOffer.hidden = true;
    again.setup.presentDraftForTour(TOUR);
    await settle();
    expect(again.dom.draftOfferText.textContent).not.toContain("deletion");
  });

  // Why: the tombstone goes only once the live record landed. Taken away
  // after a record the store refused, the draft would hold neither, and
  // a crash would lose the deletion with nothing in its place.
  it("an edit whose record does not land leaves the offered deletion's tombstone", async () => {
    const disk = memoryStore(
      {
        [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
        [deletedKey("hosted")]: "1",
      },
      { failKeys: (key) => key === objectKey("hosted") },
    );
    const page = wire(disk.store);
    page.ctx.tourDocument.open(tourOf([HOSTED]));
    page.dom.draftOffer.hidden = true;
    page.setup.presentDraftForTour(TOUR);
    await settle();
    page.ctx.tourDocument.edit(LIVE, "the live edit");
    await settle();
    expect(disk.files.has(deletedKey("hosted"))).toBe(true);
  });

  it("treats a deletion the hosted zip no longer carries as spent", async () => {
    const { store, files } = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [deletedKey("gone")]: "1",
    });
    const { ctx, dom, setup } = wire(store);
    ctx.tourDocument.open(tourOf([HOSTED]));
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
    ctx.tourDocument.open(tourOf([HOSTED]));
    ctx.tourDocument.edit(EDITED, "the live edit");
    setup.presentDraftForTour(TOUR);
    await settle();

    expect(files.has(objectKey("hosted"))).toBe(true);
    // The live edit's content, not the spent draft's (M4 review #2).
    expect(JSON.parse(String(files.get(objectKey("hosted"))))).toEqual(
      inItsStation(EDITED),
    );
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
  // An edit starts from the hosted pin as its station reads it back
  // (version 3).
  const EDITED: TourObject = { ...asHosted(HOSTED), label: NEW_TEXT };
  const OLDER: TourObject = { ...HOSTED, label: "an older edit" };
  const PUBLISHED = tourOf([HOSTED]);

  /** Open the tour on `store` in a fresh page (a reopen after the tab
   *  died), with the hosted zip carrying `HOSTED`. */
  async function reopen(store: DraftFileStore) {
    const page = wire(store);
    page.ctx.tourDocument.open(PUBLISHED);
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
    expect(later.ctx.tourDocument.entries().map((p) => p.object)).toEqual([
      EDITED,
    ]);
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
    expect(later.ctx.tourDocument.deleted()).toEqual(["hosted"]);
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
    expect(later.ctx.tourDocument.entries().map((p) => p.object)).toEqual([
      EDITED,
    ]);
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

  // Why (found building M6 E2c, confirmed by its milestone review #3):
  // `readDraft` prunes the rejected list to ids that still have files,
  // but the meta ON DISK keeps the longer list until the next meta write.
  // After "Delete it" and a reload, with a draft left that is not spent
  // (here a placement not hosted yet), an edit of a discarded id was not
  // claimed - the pruned list no longer named it - so the next read hid
  // it, listed it as rejected because its file existed, and swept it: the
  // edit deleted for good. A deletion went the same way, and the deleted
  // object came back at the next Finish.
  const DISCARDED_ON_DISK = {
    [META_KEY]: JSON.stringify({
      tourUrl: TOUR,
      sizeM: 0.16,
      level: null,
      rejected: ["hosted"],
    }),
    [objectKey("placed")]: JSON.stringify(pin("placed")),
  };

  it("keeps an edit of an id a discard rejected, made after a reload", async () => {
    const { store } = memoryStore(DISCARDED_ON_DISK);
    const second = await reopen(store);
    second.dom.objectList.listHandlers!.editText("hosted", NEW_TEXT);
    await settle();

    const third = await reopen(store);
    third.dom.draftRestore.click();
    expect(
      third.ctx.tourDocument.entries().map((p) => p.object),
    ).toContainEqual(EDITED);
  });

  it("keeps a deletion of an id a discard rejected, made after a reload", async () => {
    const { store } = memoryStore(DISCARDED_ON_DISK);
    const second = await reopen(store);
    second.dom.objectList.listHandlers!.remove("hosted");
    await settle();

    const third = await reopen(store);
    third.dom.draftRestore.click();
    expect(third.ctx.tourDocument.deleted()).toEqual(["hosted"]);
  });

  // Why (the same review #3): that claim rewrites the meta, and a meta
  // write before the offer is answered wrote only this page's codes - so
  // the offered draft's measured code was gone from disk, and a reload
  // offered the objects without it (Finish refused until the creator
  // walked back to the poster).
  it("keeps the offered draft's code in a meta written before the offer is answered", async () => {
    const level = { id: "aaaaaaaaaaa1", json: '{"a":1}' };
    const { store, files } = memoryStore({
      ...DISCARDED_ON_DISK,
      [META_KEY]: JSON.stringify({
        tourUrl: TOUR,
        sizeM: 0.16,
        level,
        levels: [level],
        rejected: ["hosted"],
      }),
    });
    const second = await reopen(store);
    second.dom.objectList.listHandlers!.editText("hosted", NEW_TEXT);
    await settle();
    const meta = JSON.parse(String(files.get(META_KEY))) as {
      level: unknown;
      levels: unknown;
    };
    expect(meta.level).toEqual(level);
    expect(meta.levels).toEqual([level]);
    const third = await reopen(store);
    third.dom.draftRestore.click();
    expect(third.setup.codes.inHand()).toEqual(level);
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
    ctx.tourDocument.open(PUBLISHED);
    // Made before the draft namespace opened: nothing to write it to yet.
    ctx.tourDocument.edit(EDITED, "the live edit");
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
    ctx.tourDocument.open(PUBLISHED);
    ctx.tourDocument.remove("hosted", "the hosted pin");
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
    const id = String(ctx.tourDocument.entries()[0]?.object.id);
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

describe("the print step hears codes a draft restores (follow-up F16)", () => {
  // Why this test matters: the print panel continues the numbering after
  // the tour's codes, but read them once per open; a draft's codes restored
  // afterwards left the next poster's number behind, so it could repeat one.
  it("tells the page when a restored draft brings codes back", async () => {
    const a = { id: "aaaaaaaaaaa1", json: '{"a":1}' };
    const { store } = memoryStore({
      [META_KEY]: JSON.stringify({
        tourUrl: TOUR,
        sizeM: 0.16,
        level: a,
        levels: [a],
      }),
    });
    let heard = 0;
    const { dom, setup } = wire(store, {
      onCodesChanged: () => {
        heard += 1;
      },
    });
    setup.presentDraftForTour(TOUR);
    await settle();
    expect(heard).toBe(0);
    dom.draftRestore.click();
    await settle();
    expect(heard).toBeGreaterThan(0);
    expect(setup.measuredCodeIds()).toContain(a.id);
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

describe("the draft keeps a moved station's pose (tour editor plan §19 #1)", () => {
  // Why these tests matter: a station moved with its re-measured code
  // moves rigidly with its items (D17). The draft used to keep only the
  // items' records, so a reload put them back at their moved spots inside
  // the UNMOVED station - a tour that no longer matched what the creator
  // saw. The pose now lives in the draft's settings record, as on the
  // desktop, and a restore moves the frame before its items land in it.
  const HOSTED = pin("hosted");
  const STATION = stationIdOf("hosted");
  const MOVED = {
    lat: 47.5001,
    lon: 8.7001,
    alt: 401,
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  };
  const PUBLISHED = tourOf([HOSTED]);
  const openedPoses = PUBLISHED.stations.map(({ id, geo }) => ({ id, geo }));
  const record = (stations: readonly { id: string; geo: unknown }[]) =>
    JSON.stringify({ needsNoGps: false, stations });
  const metaOnly = () => ({
    [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
  });

  /** The tour opened on `store` in a fresh page, its draft read. */
  async function opened(store: DraftFileStore) {
    const page = wire(store);
    page.ctx.tourDocument.open(PUBLISHED);
    page.dom.draftOffer.hidden = true;
    page.setup.presentDraftForTour(TOUR);
    await settle();
    return page;
  }

  const stationGeo = (page: ReturnType<typeof wire>) =>
    page.ctx.tourDocument.state().stations.find((s) => s.id === STATION)?.geo;

  it("writes the moved station's pose into the draft's settings record", async () => {
    const { store, files } = memoryStore(metaOnly());
    const page = await opened(store);
    page.ctx.tourDocument.moveStation(STATION, MOVED, "a station");
    await settle();

    const stored = JSON.parse(String(files.get(SETTINGS_KEY))) as {
      stations?: { id: string; geo: unknown }[];
    };
    expect(stored.stations?.find((s) => s.id === STATION)?.geo).toEqual(MOVED);
  });

  it("puts the moved station back on a reload, its item inside it", async () => {
    const { store } = memoryStore(metaOnly());
    const first = await opened(store);
    first.ctx.tourDocument.moveStation(STATION, MOVED, "a station");
    await settle();
    const movedItem = first.ctx.tourDocument
      .objects()
      .find((o) => o.object.id === "hosted")?.object;

    const later = await opened(store);
    expect(later.dom.draftOffer.hidden, "the move is offered").toBe(false);
    later.dom.draftRestore.click();

    expect(stationGeo(later), "the frame moved back").toEqual(MOVED);
    expect(
      later.ctx.tourDocument.objects().find((o) => o.object.id === "hosted")
        ?.object.geo,
      "the item stands where the moved station put it",
    ).toEqual(movedItem?.geo);
  });

  it("offers a record whose only change is a station's pose, and keeps it", async () => {
    const { store, files } = memoryStore({
      ...metaOnly(),
      [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]),
    });
    const page = await opened(store);

    expect(page.dom.draftOffer.hidden, "a moved station is work").toBe(false);
    expect(page.dom.draftOfferText.textContent).toContain("1 change");
    expect(files.has(SETTINGS_KEY), "and it is not swept").toBe(true);
    page.dom.draftRestore.click();
    expect(stationGeo(page)).toEqual(MOVED);
  });

  it("removes a record the opened tour already carries, as spent", async () => {
    const { store, files } = memoryStore({
      ...metaOnly(),
      [SETTINGS_KEY]: record(openedPoses),
    });
    const page = await opened(store);

    expect(page.dom.draftOffer.hidden).toBe(true);
    expect(files.has(SETTINGS_KEY)).toBe(false);
  });

  it("removes the record with the draft on Delete it", async () => {
    const { store, files } = memoryStore({
      ...metaOnly(),
      [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]),
    });
    const page = await opened(store);
    page.dom.draftDiscard.click();
    await settle();

    expect(files.has(SETTINGS_KEY)).toBe(false);
    expect(stationGeo(page), "nothing moved").toEqual(
      PUBLISHED.stations[0]?.geo,
    );
  });

  it("keeps a station this page moved over the draft's older pose", async () => {
    // Live work is newer than any draft (as for objects, M4 review #2):
    // a station moved before the draft opened is written over the stored
    // record, and a restore does not move it back.
    const OLDER = { ...MOVED, lat: 47.5002 };
    const { store, files } = memoryStore({
      ...metaOnly(),
      [SETTINGS_KEY]: record([{ id: STATION, geo: OLDER }]),
    });
    const page = wire(store);
    page.ctx.tourDocument.open(PUBLISHED);
    page.ctx.tourDocument.moveStation(STATION, MOVED, "a station");
    page.setup.presentDraftForTour(TOUR);
    await settle();

    const stored = JSON.parse(String(files.get(SETTINGS_KEY))) as {
      stations?: { id: string; geo: unknown }[];
    };
    expect(stored.stations?.find((s) => s.id === STATION)?.geo).toEqual(MOVED);
    expect(stationGeo(page)).toEqual(MOVED);
  });

  // Why the next two matter (the r880 milestone review, HIGH-2): a name
  // is a settings change too. The kept name re-applied at every open, or
  // any rename while the pose is still offered, wrote the whole record
  // WITHOUT the station poses - and the moved station was lost again.
  const storedPose = (files: Map<string, unknown>) =>
    (
      JSON.parse(String(files.get(SETTINGS_KEY))) as {
        stations?: { id: string; geo: unknown }[];
      }
    ).stations?.find((s) => s.id === STATION)?.geo;

  it("keeps the stored pose when a kept name renames the tour at the open", async () => {
    const { store, files } = memoryStore({
      ...metaOnly(),
      [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]),
    });
    const page = wire(store);
    page.ctx.tourDocument.open(PUBLISHED);
    // What the name field does on an open: the kept name, re-applied.
    expect(page.setup.renameTour("Castle walk")).toBeNull();
    page.setup.presentDraftForTour(TOUR);
    await settle();

    expect(page.dom.draftOffer.hidden, "the pose is still offered").toBe(false);
    expect(storedPose(files), "and still stored").toEqual(MOVED);
    page.dom.draftRestore.click();
    expect(stationGeo(page)).toEqual(MOVED);
    expect(page.ctx.tourDocument.manifest()?.title).toBe("Castle walk");
  });

  it("keeps an offered pose through a rename, for a reload", async () => {
    const { store, files } = memoryStore({
      ...metaOnly(),
      [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]),
    });
    const first = await opened(store);
    expect(first.dom.draftOffer.hidden).toBe(false);
    expect(first.setup.renameTour("Castle walk")).toBeNull();
    await settle();
    expect(storedPose(files), "the rename kept the pose").toEqual(MOVED);

    const later = await opened(store);
    expect(later.dom.draftOffer.hidden, "offered again").toBe(false);
    later.dom.draftRestore.click();
    expect(stationGeo(later)).toEqual(MOVED);
  });

  it("drops the carried pose on Delete it, keeping the live name", async () => {
    const { store, files } = memoryStore({
      ...metaOnly(),
      [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]),
    });
    const page = await opened(store);
    expect(page.setup.renameTour("Castle walk")).toBeNull();
    page.dom.draftDiscard.click();
    await settle();

    expect(storedPose(files), "the rejected pose is gone").toBeUndefined();
    expect(
      (JSON.parse(String(files.get(SETTINGS_KEY))) as { details?: unknown })
        .details,
      "the name, live work, stays",
    ).toMatchObject({ title: "Castle walk" });
  });

  it("a settings write queued for a tour that then closed keeps that tour's poses", async () => {
    // Why (the r880 fix re-review, L2): the undecided poses were one
    // variable for the page, read when the write RUNS - so a rename still
    // queued when the tour closed read the closed state (no poses), and
    // the draft lost the moved station.
    const { store, files, releaseHeldKeys } = memoryStore(
      { ...metaOnly(), [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]) },
      { holdKeys: (key) => key === SETTINGS_KEY },
    );
    const page = await opened(store);
    expect(page.dom.draftOffer.hidden).toBe(false);
    expect(page.setup.renameTour("Castle walk")).toBeNull();
    expect(page.setup.renameTour("Castle walk two")).toBeNull();
    await settle();
    // The tour closes while the second write waits behind the first.
    page.setup.resetFinishStep();
    releaseHeldKeys();
    await settle();
    releaseHeldKeys();
    await settle();

    expect(storedPose(files), "the closed tour's pose kept").toEqual(MOVED);
    expect(
      (JSON.parse(String(files.get(SETTINGS_KEY))) as { details?: unknown })
        .details,
    ).toMatchObject({ title: "Castle walk two" });
  });

  it("a Delete it that lands after another tour opened writes nothing of that tour into its own", async () => {
    // Why: the settings rewrite after "Delete it" ran once its commit had
    // landed, reading the page's CURRENT document and holder - so when the
    // creator had closed tour A and opened B meanwhile, B's record and B's
    // undecided poses went into A's namespace. The rewrite now reads the
    // tap's holder and waits on A still being the open tour, as the
    // failure branch already did.
    const OTHER = "https://example.test/other.zip";
    const MOVED_B = { ...MOVED, lat: 47.5009 };
    const a = memoryStore(
      { ...metaOnly(), [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]) },
      { holdKeys: (key) => key === META_KEY },
    );
    const b = memoryStore({
      [META_KEY]: JSON.stringify({ tourUrl: OTHER, sizeM: 0.16, level: null }),
      [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED_B }]),
    });
    const page = wire(a.store, {
      storeFor: (key) => (key.includes("other.zip") ? b.store : a.store),
    });
    page.ctx.tourDocument.open(PUBLISHED);
    page.dom.draftOffer.hidden = true;
    page.setup.presentDraftForTour(TOUR);
    await settle();
    expect(page.setup.renameTour("Tour A")).toBeNull();
    await settle();
    // "Delete it" on A: its commit (the meta write) is held.
    page.dom.draftDiscard.click();
    await settle();
    // A closes and B opens, with its own undecided pose and a new name.
    page.setup.resetFinishStep();
    page.ctx.tourDocument.close();
    page.ctx.tourDocument.open(PUBLISHED);
    page.setup.presentDraftForTour(OTHER);
    await settle();
    expect(page.setup.renameTour("Tour B")).toBeNull();
    await settle();
    // A's commit lands now.
    a.releaseHeldKeys();
    await settle();

    const stored = JSON.parse(String(a.files.get(SETTINGS_KEY))) as {
      details?: { title?: string };
      stations?: { id: string; geo: unknown }[];
    };
    expect(stored.details?.title, "never B's record").not.toBe("Tour B");
    expect(
      stored.stations?.find((s) => s.id === STATION)?.geo,
      "never B's pose",
    ).not.toEqual(MOVED_B);
  });

  it("a Delete it that lands after the tour closed still removes the rejected poses", async () => {
    // Why: the guard above (never write another tour's record) also dropped
    // the plain removal when the creator tapped "Delete it" and closed the
    // tour at once - so the record outlived its draft and the next open
    // offered the rejected pose again. With no settings work since the tap
    // and the tour not reopened, the removal is issued at once.
    const { store, files, releaseHeldKeys } = memoryStore(
      { ...metaOnly(), [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]) },
      { holdKeys: (key) => key === META_KEY },
    );
    const page = wire(store);
    page.ctx.tourDocument.open(PUBLISHED);
    page.setup.presentDraftForTour(TOUR);
    await settle();
    expect(page.dom.draftOffer.hidden, "the pose is offered").toBe(false);
    page.dom.draftDiscard.click();
    await settle();
    page.setup.resetFinishStep();
    page.ctx.tourDocument.close();
    releaseHeldKeys();
    await settle();

    expect(files.has(SETTINGS_KEY), "the record went with the draft").toBe(
      false,
    );
    page.ctx.tourDocument.open(PUBLISHED);
    page.setup.presentDraftForTour(TOUR);
    await settle();
    expect(page.dom.draftOffer.hidden, "nothing rejected is offered").toBe(
      true,
    );
  });

  it("a Delete it that lands after the tour closed keeps a rename made after the tap", async () => {
    // Why: the other side of the test above. A rename between the tap and
    // the close is live work written into the record; after the close
    // there is no document left to tell, so the removal is skipped rather
    // than taking the name with it.
    const { store, files, releaseHeldKeys } = memoryStore(
      { ...metaOnly(), [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]) },
      { holdKeys: (key) => key === META_KEY },
    );
    const page = wire(store);
    page.ctx.tourDocument.open(PUBLISHED);
    page.setup.presentDraftForTour(TOUR);
    await settle();
    page.dom.draftDiscard.click();
    await settle();
    expect(page.setup.renameTour("Castle walk")).toBeNull();
    await settle();
    page.setup.resetFinishStep();
    page.ctx.tourDocument.close();
    releaseHeldKeys();
    await settle();

    expect(
      (JSON.parse(String(files.get(SETTINGS_KEY))) as { details?: unknown })
        .details,
      "the name, live work, stays",
    ).toMatchObject({ title: "Castle walk" });
  });

  it("a Delete it that lands after the tour was reopened by the same url, padded, leaves the record to that open", async () => {
    // Why: the draft's namespace is keyed by the trimmed url
    // (`draftKeyForTour`), and a `?qr=` boot passes its payload untouched.
    // Compared raw, a reopen through such a url read as another tour, and
    // the late removal deleted the record the reopen had already read.
    const { store, files, releaseHeldKeys } = memoryStore(
      { ...metaOnly(), [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]) },
      { holdKeys: (key) => key === META_KEY },
    );
    const page = wire(store);
    page.ctx.tourDocument.open(PUBLISHED);
    page.setup.presentDraftForTour(TOUR);
    await settle();
    page.dom.draftDiscard.click();
    await settle();
    page.setup.resetFinishStep();
    page.ctx.tourDocument.close();
    page.ctx.tourDocument.open(PUBLISHED);
    page.setup.presentDraftForTour(` ${TOUR} `);
    await settle();
    releaseHeldKeys();
    await settle();

    expect(files.has(SETTINGS_KEY), "the reopen's record stays").toBe(true);
  });

  it("a Delete it that lands after the tour closed keeps a rename made before the tap", async () => {
    // Why: the record was live work AT the tap (the rename was written
    // before it, so no write follows the tap to count). After the close
    // there is no document to rewrite it from, so the removal is skipped
    // rather than taking the name with it.
    const { store, files, releaseHeldKeys } = memoryStore(
      { ...metaOnly(), [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]) },
      { holdKeys: (key) => key === META_KEY },
    );
    const page = wire(store);
    page.ctx.tourDocument.open(PUBLISHED);
    page.setup.presentDraftForTour(TOUR);
    await settle();
    expect(page.setup.renameTour("Castle walk")).toBeNull();
    await settle();
    page.dom.draftDiscard.click();
    await settle();
    page.setup.resetFinishStep();
    page.ctx.tourDocument.close();
    releaseHeldKeys();
    await settle();

    expect(
      (JSON.parse(String(files.get(SETTINGS_KEY))) as { details?: unknown })
        .details,
      "the name, live work, stays",
    ).toMatchObject({ title: "Castle walk" });
  });

  it("keeps the offered pose when Delete it does not land, for a rename after it", async () => {
    // Why (the r880 fix re-review, L3): "Delete it" dropped the undecided
    // poses at the tap, before its commit point - so a rejection that did
    // not land (the draft "is still there, and will be offered again")
    // left a later rename to write the record without the moved station.
    const { store, files } = memoryStore(
      { ...metaOnly(), [SETTINGS_KEY]: record([{ id: STATION, geo: MOVED }]) },
      { failKeys: (key) => key === META_KEY },
    );
    const page = await opened(store);
    page.dom.draftDiscard.click();
    await settle();
    expect(page.ctx.placementNote).toContain("Could not delete");
    expect(page.setup.renameTour("Castle walk")).toBeNull();
    await settle();

    expect(storedPose(files), "the pose is still the draft's").toEqual(MOVED);
  });
});

// Why (owner decision D8 of the editor round-2 plan, 2026-10-18): places
// closer than about 40 m cannot be separated by any automatic radius, so a
// chip in the phone's AR authoring makes the NEXT placed item start its own
// station. These drive the chip and the pin's Save as the page does: the
// armed state on the chip (aria-pressed), the one-shot, the arm surviving a
// placement that did not happen, the note naming the result, and the arm
// gone at the end of the AR visit.
describe("'New station here' (D8)", () => {
  /** A tour whose one station is anchored where the reticle's pin lands
   *  (the fake reticle and zero put it at about 47.5, 8.7): any pin placed
   *  here is within R of it. */
  async function placeable() {
    const { store } = memoryStore();
    const wired = wire(store, { placeable: true });
    wired.ctx.tourDocument.open(tourOf([pin("hosted")]));
    wired.setup.presentDraftForTour(TOUR);
    await settle();
    wired.setup.renderAuthorReadout();
    return wired;
  }

  function stationsOf(ctx: ReturnType<typeof createTourViewerSession>) {
    return (
      manifestToWrite(ctx.tourDocument.state())?.stations.map((s) =>
        s.items.map((i) => (i.kind === "pin" ? i.label : i.id)),
      ) ?? []
    );
  }

  it("shows its armed state, and a second tap disarms it", async () => {
    const { ctx, dom } = await placeable();
    const chip = dom.newStationButton;
    expect(chip.hidden).toBe(false);
    expect(chip.disabled).toBe(false);
    expect(chip.attributes["aria-pressed"]).toBe("false");
    chip.click();
    expect(chip.attributes["aria-pressed"]).toBe("true");
    expect(ctx.tourDocument.newStationArmed()).toBe(true);
    expect(ctx.placementNote).toBe(
      "The next pin or photo starts a new station here.",
    );
    chip.click();
    expect(chip.attributes["aria-pressed"]).toBe("false");
    expect(ctx.tourDocument.newStationArmed()).toBe(false);
    expect(ctx.placementNote).toBeNull();
  });

  it("makes the next pin start its own station within the radius, says so, and disarms", async () => {
    const { ctx, dom } = await placeable();
    // Unarmed, a pin here joins the hosted station.
    dom.pinLabel.value = "Joins";
    dom.pinSave.click();
    await settle();
    expect(stationsOf(ctx)).toEqual([["pin hosted", "Joins"]]);

    dom.newStationButton.click();
    dom.pinLabel.value = "Own";
    dom.pinSave.click();
    await settle();
    expect(stationsOf(ctx)).toEqual([["pin hosted", "Joins"], ["Own"]]);
    expect(ctx.placementNote).toMatch(
      /^Pin "Own" placed - New station started: Station 2 · /,
    );
    expect(ctx.tourDocument.newStationArmed()).toBe(false);
    expect(dom.newStationButton.attributes["aria-pressed"]).toBe("false");

    // One-shot: the next pin follows the rule (the nearer, newer station).
    dom.pinLabel.value = "After";
    dom.pinSave.click();
    await settle();
    expect(stationsOf(ctx)).toEqual([
      ["pin hosted", "Joins"],
      ["Own", "After"],
    ]);
  });

  // Why: the troubleshooting recording logs a placement "exactly as the
  // manifest will carry it"; a log without the station the arm gave it
  // could not explain afterwards why the pin started a station of its own.
  it("logs the placement into the recording with the station it starts", async () => {
    const { ctx, dom, dispatched } = await placeable();
    dom.newStationButton.click();
    dom.pinLabel.value = "Own";
    dom.pinSave.click();
    await settle();
    const entry = ctx.tourDocument.entries()[0]!.object;
    expect(entry.station).toBeDefined();
    const logged = dispatched.filter(
      (a) => (a as { type: string }).type === "tourAuthoring/objectPlaced",
    ) as { payload: { object: TourObject } }[];
    expect(logged.map((a) => a.payload.object)).toEqual([entry]);
  });

  it("stays armed when the placement does not happen, so the creator can try again", async () => {
    const { ctx, dom } = await placeable();
    dom.newStationButton.click();
    // No text typed: nothing placed.
    dom.pinLabel.value = "";
    dom.pinSave.click();
    await settle();
    expect(ctx.placementNote).toBe("Type the pin's text first.");
    expect(ctx.tourDocument.newStationArmed()).toBe(true);
    // The label input cancelled: nothing placed.
    dom.pinButton.click();
    dom.pinCancel.click();
    expect(ctx.tourDocument.newStationArmed()).toBe(true);
    // No surface under the ring: nothing placed.
    ctx.reticle = {
      isVisible: () => false,
      getWorldPosition: (v: Vector3) => v,
    } as never;
    dom.pinLabel.value = "Gate";
    dom.pinSave.click();
    await settle();
    expect(ctx.tourDocument.newStationArmed()).toBe(true);
    expect(dom.newStationButton.attributes["aria-pressed"]).toBe("true");
    expect(stationsOf(ctx)).toEqual([["pin hosted"]]);
  });

  it("an undo of that placement takes the new station away", async () => {
    const { ctx, dom } = await placeable();
    dom.newStationButton.click();
    dom.pinLabel.value = "Own";
    dom.pinSave.click();
    await settle();
    expect(stationsOf(ctx)).toHaveLength(2);
    expect(ctx.tourDocument.undo()).toMatchObject({ kind: "undone" });
    expect(stationsOf(ctx)).toEqual([["pin hosted"]]);
  });

  it("is disarmed when the AR visit ends: the chip is the session's", async () => {
    const { ctx, dom, setup } = await placeable();
    dom.newStationButton.click();
    setup.endAuthorVisit();
    expect(ctx.tourDocument.newStationArmed()).toBe(false);
  });
});
