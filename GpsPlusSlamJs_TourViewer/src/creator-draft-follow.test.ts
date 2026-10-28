/**
 * The phone draft's `follow` (debug-captures plan, Q-I) in isolation: the
 * file a Finish saved of a tour opened from a file opens under the tour's
 * own id once its save wrote one, so the draft is copied to that key and
 * written there from then on. The composed walk - two Finishes, the
 * reopen of the saved file - is in `tour-document-parity.test.ts`.
 *
 * Why these tests matter: a copy that drops a photo's bytes, overwrites a
 * write made while it ran, or claims success over a file it could not
 * read loses a creator's work on the next open of the saved file - and
 * nothing on screen would say so.
 */
import { describe, expect, it } from "vitest";
import type { TourPin } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";

import { draftKeyForTour } from "./authoring-draft.js";
import { wireCreatorDraft } from "./creator-draft.js";
import { META_KEY, objectKey, photoKey } from "./draft-persistence.js";
import { parseSettingsRecord, SETTINGS_KEY } from "./tour-document-draft.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
import { createVisitLog } from "./visit-log.js";

const OLD = "local-file:00000000000000000000000000000001";
const NEW = "local-file:tour:0123456789abcdef0123456789abcdef";

function pin(id: string, label = id): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: label,
    createdAtIso: "2026-10-20T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

/** One browser's namespaces: strings and blobs, as the real store holds. */
function namespaces(options: { unreadable?: string } = {}) {
  const spaces = new Map<string, Map<string, Blob | string>>();
  const opened: string[] = [];
  /** Called once per put, before it lands: a test may write meanwhile. */
  let beforePut: ((key: string) => Promise<void>) | null = null;
  const open = (key: string): Promise<DraftFileStore> => {
    opened.push(key);
    const files = spaces.get(key) ?? new Map<string, Blob | string>();
    spaces.set(key, files);
    return Promise.resolve({
      put: async (k, data) => {
        if (beforePut !== null) await beforePut(k);
        files.set(k, data as Blob | string);
        return true;
      },
      remove: (k) => {
        files.delete(k);
        return Promise.resolve();
      },
      getText: (k) => {
        const v = files.get(k);
        if (k === options.unreadable) return Promise.resolve(undefined);
        return Promise.resolve(typeof v === "string" ? v : undefined);
      },
      getBlob: (k) => {
        const v = files.get(k);
        if (k === options.unreadable) return Promise.resolve(undefined);
        return Promise.resolve(v instanceof Blob ? v : undefined);
      },
      keys: () => Promise.resolve([...files.keys()]),
      clear: () => {
        files.clear();
        return Promise.resolve();
      },
    });
  };
  return {
    spaces,
    opened,
    open,
    setBeforePut: (fn: ((key: string) => Promise<void>) | null) => {
      beforePut = fn;
    },
    files: (url: string) => spaces.get(draftKeyForTour(url)) ?? new Map(),
  };
}

function element() {
  return {
    hidden: true,
    disabled: false,
    textContent: "",
    value: "0.2",
    addEventListener: () => undefined,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
}

async function wired(ns: ReturnType<typeof namespaces>) {
  const store = createTourViewerStore();
  const ctx = createTourViewerSession(store);
  ctx.tourDocument.open(tourOf([pin("a")]));
  const draft = wireCreatorDraft({
    ctx,
    dom: {
      sizeInput: element(),
      draftOffer: element(),
      draftOfferText: element(),
      draftRestore: element(),
      draftDismiss: element(),
      draftDiscard: element(),
    } as never,
    openDraftStore: ns.open,
    visitLog: createVisitLog(),
    codes: {
      inHand: () => null,
      restoreInHand: () => undefined,
      restoreLevels: () => undefined,
      notHosted: () => [],
    } as never,
    wizard: { revealStep: () => undefined },
    sessionLive: () => false,
    syncPreviews: () => undefined,
    render: () => undefined,
  });
  draft.present(OLD);
  await flush();
  return { ctx, draft };
}

describe("the phone draft follows the saved file's key", () => {
  it("copies every file there, a photo's bytes among them, re-states the meta, and writes there from then on", async () => {
    const ns = namespaces();
    const { draft } = await wired(ns);
    const picture = new Blob(["JPEG"], { type: "image/jpeg" });
    expect(await draft.writeObject(pin("p", "with a photo"), picture)).toBe(
      true,
    );
    expect(await draft.writeObject(pin("a", "edited"))).toBe(true);
    await flush();
    const before = new Map(ns.files(OLD));

    expect(await draft.follow(NEW)).toBe(true);
    const copied = ns.files(NEW);
    expect(await (copied.get(photoKey("p")) as Blob).text()).toBe("JPEG");
    expect(copied.get(objectKey("a"))).toBe(before.get(objectKey("a")));
    expect(
      (JSON.parse(String(copied.get(META_KEY))) as { tourUrl: string }).tourUrl,
    ).toBe(NEW);
    // The opened file's namespace keeps what it held.
    expect([...ns.files(OLD).keys()].sort()).toEqual([...before.keys()].sort());

    expect(await draft.writeObject(pin("a", "after"))).toBe(true);
    expect(String(ns.files(NEW).get(objectKey("a")))).toContain("after");
    expect(String(ns.files(OLD).get(objectKey("a")))).not.toContain("after");
  });

  it("never overwrites a write made while the copy ran with the old copy", async () => {
    const ns = namespaces();
    const { draft } = await wired(ns);
    expect(await draft.writeObject(pin("a", "before"))).toBe(true);
    await flush();
    const during: Promise<boolean>[] = [];
    ns.setBeforePut((key) => {
      if (during.length === 0 && key === objectKey("a")) {
        // The copy's put of the old record is under way: a live edit is
        // issued now, and must land after it.
        ns.setBeforePut(null);
        during.push(draft.writeObject(pin("a", "during")));
      }
      return new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await draft.follow(NEW)).toBe(true);
    expect(await Promise.all(during)).toEqual([true]);
    expect(String(ns.files(NEW).get(objectKey("a")))).toContain("during");
  });

  it("says a copy that could not read a file did not land", async () => {
    const ns = namespaces({ unreadable: objectKey("a") });
    const { draft } = await wired(ns);
    expect(await draft.writeObject(pin("a", "edited"))).toBe(true);
    await flush();
    expect(await draft.follow(NEW)).toBe(false);
    expect(ns.files(OLD).has(objectKey("a"))).toBe(true);
  });

  it("opens nothing for the key it already has", async () => {
    const ns = namespaces();
    const { draft } = await wired(ns);
    const opens = ns.opened.length;
    expect(await draft.follow(OLD)).toBe(true);
    expect(ns.opened.length).toBe(opens);
  });

  // Why this test matters (r902 review #6): two quick Finishes of the same
  // file each follow it to the same key. The first moves the draft while
  // the second still waits for its open; the second then found the draft
  // moved and reported failure, and the page warned that no backup copy
  // is kept - for a draft that sits exactly where it should.
  it("reports success to a second follow whose draft the first already moved to the same key", async () => {
    const ns = namespaces();
    const { draft } = await wired(ns);
    expect(await draft.writeObject(pin("a", "edited"))).toBe(true);
    await flush();
    const [first, second] = await Promise.all([
      draft.follow(NEW),
      draft.follow(NEW),
    ]);
    expect([first, second]).toEqual([true, true]);
    expect(await draft.writeObject(pin("a", "after"))).toBe(true);
    expect(String(ns.files(NEW).get(objectKey("a")))).toContain("after");
  });

  it("still reports failure when the draft moved meanwhile to ANOTHER key", async () => {
    const ns = namespaces();
    const { draft } = await wired(ns);
    const elsewhere = "local-file:tour:fedcba9876543210fedcba9876543210";
    const [first, second] = await Promise.all([
      draft.follow(elsewhere),
      draft.follow(NEW),
    ]);
    expect([first, second]).toEqual([true, false]);
  });
});

describe("the phone draft's settings record", () => {
  // Why: the settings writer is the page's own (`settingsRecordText`); a
  // writer that stored a frame as the page holds it would store a record
  // the reader drops without a word, and the station's story would be gone
  // on the next open.
  it("stores a frame with a story step in the file's shape: the stored record reads back with its step", async () => {
    const ns = namespaces();
    const { draft } = await wired(ns);
    const frame = {
      id: "s-new",
      geo: {
        lat: 48.5205,
        lon: 9.05,
        alt: 340,
        rotation: [0, 0, 0, 1] as const,
      },
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow" as const,
      blocks: [
        {
          id: "hello-text",
          kind: "shortText" as const,
          view: "card" as const,
          caption: "Hello there.",
          pose: {
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
          },
        },
      ],
      steps: [
        {
          id: "hello",
          action: { kind: "show" as const, block: "hello-text" },
          advance: { mode: "tap" as const },
        },
      ],
    };
    expect(
      await draft.saveSettings({ needsNoGps: false, frames: [frame] }),
    ).toBe(true);
    await flush();
    const stored = ns.files(OLD).get(SETTINGS_KEY);
    expect(typeof stored).toBe("string");
    expect(parseSettingsRecord(stored as string)?.frames).toEqual([frame]);
  });
});
