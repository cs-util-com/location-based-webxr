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
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { wireCreatorSetup } from "./creator-setup.js";
import type { CreatorSetupDom } from "./creator-setup.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
import {
  META_KEY,
  objectKey,
  photoKey,
  readDraft,
} from "./draft-persistence.js";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

/** One fake element: the properties this module writes, and a click it can
 *  be told to fire. Not a DOM stand-in - only what `creator-setup` uses. */
interface FakeEl {
  hidden: boolean;
  textContent: string;
  disabled: boolean;
  value: string;
  open: boolean;
  handlers: Map<string, () => void>;
  addEventListener: (type: string, handler: () => void) => void;
  click: () => void;
}

function el(): FakeEl {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    value: "",
    open: false,
    handlers,
    addEventListener: (type, handler) => handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

const DOM_KEYS = [
  "panel",
  "controls",
  "finishBlock",
  "replaceHelp",
  "replaceHelpShare",
  "sizeInput",
  "printPanel",
  "status",
  "mintButton",
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
  } = {},
): {
  store: DraftFileStore;
  files: Map<string, unknown>;
  releaseHeldPut: () => void;
} {
  const files = new Map<string, unknown>(Object.entries(seed));
  let held: (() => void) | null = null;
  let released = false;
  const store: DraftFileStore = {
    put: (key: string, data: unknown) => {
      // A store that REFUSES, as the real one does on a quota wall or a
      // revoked directory handle: `put` reports false rather than throwing.
      if (options.putFails === true) return Promise.resolve(false);
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
    releaseHeldPut: () => {
      released = true;
      held?.();
      held = null;
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

function wire(
  store: DraftFileStore,
  options: { firstOpenFails?: boolean } = {},
) {
  let opens = 0;
  const dom = fakeDom();
  const ctx = createTourViewerSession();
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore: createTourViewerStore(),
    arController: {
      getState: () => ({ status: "idle" }),
      disable: () => undefined,
    } as never,
    seams: { canShareZip: () => false } as never,
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
  return { dom, ctx, setup };
}

/** Let every already-resolved microtask in the chain run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

const TOUR = "https://example.test/tour.zip";

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

  it("does not let a stalled tour block the next one's discard", async () => {
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
    setup.presentDraftForTour(TOUR);
    await settle();
    setup.resetFinishStep();

    // Tour two, with a draft to reject.
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
});
