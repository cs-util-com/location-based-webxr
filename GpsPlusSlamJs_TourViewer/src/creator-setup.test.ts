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
import { META_KEY, objectKey } from "./draft-persistence.js";
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

/** A store whose `clear` only settles when this test says so. That is what
 *  turns "a creator placed something during the await" from a race into an
 *  ordinary sequence. */
function deferredStore(seed: Record<string, string> = {}): {
  store: DraftFileStore;
  files: Map<string, unknown>;
  releaseClear: () => void;
  clearCalled: () => boolean;
} {
  const files = new Map<string, unknown>(Object.entries(seed));
  let release: (() => void) | null = null;
  let called = false;
  const store: DraftFileStore = {
    put: (key: string, data: unknown) => {
      files.set(key, data);
      return Promise.resolve(true);
    },
    getText: (key: string) => {
      const value = files.get(key);
      return Promise.resolve(typeof value === "string" ? value : undefined);
    },
    getBlob: () => Promise.resolve(undefined),
    keys: () => Promise.resolve([...files.keys()]),
    clear: (firstKey?: string) => {
      called = true;
      return new Promise<void>((resolve) => {
        release = () => {
          // Emulates the real store: the whole namespace goes, and the
          // named key goes first.
          if (firstKey !== undefined) files.delete(firstKey);
          files.clear();
          resolve();
        };
      });
    },
  };
  return {
    store,
    files,
    releaseClear: () => release?.(),
    clearCalled: () => called,
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

function wire(store: DraftFileStore) {
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
    openDraftStore: () => Promise.resolve(store),
  });
  return { dom, ctx, setup };
}

/** Let every already-resolved microtask in the chain run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

const TOUR = "https://example.test/tour.zip";

describe("the spent-draft path re-writes what this session placed", () => {
  it("keeps a placement made while the draft open was still in flight", async () => {
    // The claim a previous round got wrong, and got wrong in a comment
    // that justified DELETING this re-write: "nothing can have been placed
    // here, because this runs at tour open". `draftStore` is assigned
    // BEFORE the reads that precede the clear, and neither the mint nor
    // the placement is gated on those settling - so a creator with AR
    // already up and the poster already framed can place inside the
    // window. This test IS that window, made deterministic.
    //
    // A meta-only draft with no level is spent by definition (no unhosted
    // objects, no unhosted level), which is the cheapest way into the
    // branch.
    const { store, files, releaseClear, clearCalled } = deferredStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
    });
    const { ctx, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();
    expect(clearCalled(), "the spent branch should have been taken").toBe(true);

    // The creator places while the clear is still in flight.
    ctx.placedObjects = [{ object: pin("late-pin") }];
    releaseClear();
    await settle();

    expect(
      files.has(objectKey("late-pin")),
      "the placement made during the open must survive the clear",
    ).toBe(true);
    expect(files.has(META_KEY), "the gate file must be rewritten too").toBe(
      true,
    );
  });

  it("writes nothing extra when nothing was placed", async () => {
    // The ordinary case, and the reason the loop is cheap: an empty list
    // costs one iteration of nothing. Pinned so a future "optimisation"
    // that skips the rewrite entirely is visible as a behaviour change.
    const { store, files, releaseClear, clearCalled } = deferredStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
    });
    // no placements at all
    const { setup } = wire(store);
    setup.presentDraftForTour(TOUR);
    await settle();
    // BEFORE the release, which is the whole point and where the first
    // attempt at this guard got it wrong (PR #451 review). `releaseClear`
    // is a no-op while `clear` has not been called, so a guard placed
    // AFTER it passes in exactly the scenario it was added to rule out:
    // the release does nothing, `clear` is then called during the next
    // settle, `clearCalled()` is true, `recordMeta` never runs, and the
    // seed is what we read back. Asserting here proves the deferred was
    // already armed, so releasing it is effective.
    //
    // The drift this catches: `settle` is a fixed microtask count while
    // `readDraft` awaits once per key, so a bigger seed or one more
    // `await` ahead of the clear moves the chain past it.
    expect(clearCalled(), "the spent branch should have been taken").toBe(true);
    releaseClear();
    await settle();

    expect([...files.keys()]).toEqual([META_KEY]);
  });
});

describe("the discard re-writes what this session placed", () => {
  it("keeps a pin placed before the tap, and drops the rejected draft", async () => {
    // The e2e covers this end to end, but only through what the NEXT open
    // shows. Here the assertion is on the files themselves, and the clear
    // settles when this test says so rather than whenever OPFS gets to it -
    // so it also pins the ORDER: the re-write lands after the clear, which
    // is what makes it survive.
    //
    // The draft on disk holds `old-pin`, which is what "Delete it" is
    // rejecting. `late-pin` was placed in THIS session while the offer sat
    // on screen - the offer is not modal - and must not be collateral.
    const { store, files, releaseClear } = deferredStore({
      [META_KEY]: JSON.stringify({ tourUrl: TOUR, sizeM: 0.16, level: null }),
      [objectKey("old-pin")]: JSON.stringify(pin("old-pin")),
    });
    const { dom, ctx, setup } = wire(store);

    setup.presentDraftForTour(TOUR);
    await settle();

    ctx.placedObjects = [{ object: pin("late-pin") }];
    dom.draftDiscard.click();
    await settle();
    releaseClear();
    await settle();

    expect(
      files.has(objectKey("late-pin")),
      "the pin placed before the tap must survive the discard",
    ).toBe(true);
    expect(
      files.has(objectKey("old-pin")),
      "the draft that was rejected must be gone",
    ).toBe(false);
  });
});
