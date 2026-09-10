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
import { META_KEY, objectKey, photoKey } from "./draft-persistence.js";
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
function memoryStore(seed: Record<string, string> = {}): {
  store: DraftFileStore;
  files: Map<string, unknown>;
} {
  const files = new Map<string, unknown>(Object.entries(seed));
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
    remove: (key: string) => {
      files.delete(key);
      return Promise.resolve();
    },
    clear: () => Promise.resolve(),
  };
  return { store, files };
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
