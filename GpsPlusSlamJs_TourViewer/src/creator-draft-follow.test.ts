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
import type {
  TourObject,
  TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { TOUR_OBJECT_RECORD_FORMAT } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { draftKeyForTour } from "./authoring-draft.js";
import { wireCreatorDraft } from "./creator-draft.js";
import {
  CODES_KEY,
  CODES_REJECTED,
  META_KEY,
  objectKey,
  photoKey,
  SETTINGS_REJECTED,
} from "./draft-persistence.js";
import {
  DRAFT_PART_UNREAD,
  parseSettingsRecord,
  SETTINGS_KEY,
} from "./tour-document-draft.js";
import {
  memoryDraftOps,
  memoryDraftStores,
} from "./test-support/memory-draft-stores.js";
import { settle } from "./test-support/settle.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
import { createVisitLog } from "./visit-log.js";
import { stationContent, storyOf } from "./test-support/station-content.js";

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

/** One browser's namespaces; `unreadable` reads back as missing. */
function namespaces(options: { unreadable?: string } = {}) {
  const ns = memoryDraftStores();
  if (options.unreadable !== undefined) ns.unreadable.add(options.unreadable);
  return Object.assign(ns, {
    files: (url: string) =>
      ns.spaces.get(draftKeyForTour(url)) ?? new Map<string, Blob | string>(),
  });
}

function element() {
  const clicks: (() => void)[] = [];
  return {
    hidden: true,
    disabled: false,
    textContent: "",
    value: "0.2",
    addEventListener: (_type: string, listener: () => void) => {
      clicks.push(listener);
    },
    /** A tap on it: its listeners, in order. */
    click: () => {
      for (const listener of clicks) listener();
    },
  };
}

/** Until the draft's writes have stopped. */
function flush(): Promise<void> {
  return settle(() => [memoryDraftOps()]);
}

/** A code this page measured: what its codes facade holds. */
type PageCode = { id: string; json: string };

async function wired(
  ns: ReturnType<typeof namespaces>,
  tour = tourOf([pin("a")]),
  url = OLD,
  pageCode: PageCode | null = null,
) {
  const store = createTourViewerStore();
  const ctx = createTourViewerSession(store);
  ctx.tourDocument.open(tour);
  const dom = {
    sizeInput: element(),
    draftOffer: element(),
    draftOfferText: element(),
    draftRestore: element(),
    draftDismiss: element(),
    draftDiscard: element(),
  };
  const draft = wireCreatorDraft({
    ctx,
    dom: dom as never,
    openDraftStore: ns.open,
    visitLog: createVisitLog(),
    codes: {
      inHand: () => pageCode,
      restoreInHand: () => undefined,
      restoreLevels: () => undefined,
      notHosted: () => (pageCode === null ? [] : [pageCode]),
    } as never,
    wizard: { revealStep: () => undefined },
    sessionLive: () => false,
    syncPreviews: () => undefined,
    render: () => undefined,
  });
  draft.present(url);
  await flush();
  return { ctx, draft, dom };
}

describe("the phone's draft of an older format", () => {
  // Why: the sample's key is stable and its rebuilt file is never refused,
  // so a draft an older build left there is met only by this open. Its
  // frames no longer read, so kept it would restore half a tour.
  it("is gone when its tour opens, and the open starts a new one", async () => {
    const ns = namespaces();
    const files = new Map<string, Blob | string>([
      [META_KEY, JSON.stringify({ format: 4, tourUrl: OLD })],
      [objectKey("old"), JSON.stringify({ id: "old" })],
      [SETTINGS_KEY, JSON.stringify({ stations: [] })],
    ]);
    ns.spaces.set(draftKeyForTour(OLD), files);
    await wired(ns);
    expect(files.has(objectKey("old"))).toBe(false);
    expect(files.has(SETTINGS_KEY)).toBe(false);
    expect(JSON.parse(files.get(META_KEY) as string)).toMatchObject({
      format: TOUR_OBJECT_RECORD_FORMAT,
    });
  });
});

describe("the phone's draft says what it could not read", () => {
  // Why these tests matter: a stored station naming a picture the tour no
  // longer holds was dropped and, with nothing left to offer, its record
  // removed: work gone with nothing on screen, though the station reads
  // again once a file with that picture opens.
  const unreadable = {
    id: "s-new",
    geo: { lat: 48.5205, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    children: [
      {
        id: "tale",
        kind: "folder",
        role: "story",
        title: "The tale",
        children: [
          {
            id: "look",
            kind: "picture",
            view: "card",
            image: "img1",
            widthM: 1,
            pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            advance: { mode: "tap" },
          },
        ],
      },
    ],
  };

  async function space(settings: string) {
    const ns = namespaces();
    const files = await ns.open(draftKeyForTour(OLD));
    await files.put(
      META_KEY,
      JSON.stringify({ format: TOUR_OBJECT_RECORD_FORMAT, tourUrl: OLD }),
    );
    await files.put(SETTINGS_KEY, settings);
    return ns;
  }

  it("tells of a station that no longer reads, and keeps its record", async () => {
    const ns = await space(
      JSON.stringify({ needsNoGps: false, createdStations: [unreadable] }),
    );
    const { ctx } = await wired(ns);
    expect(ctx.placementNote).toBe(DRAFT_PART_UNREAD);
    expect(ns.files(OLD).has(SETTINGS_KEY)).toBe(true);
  });

  it("tells of a record that does not read", async () => {
    const ns = await space("{not json");
    const { ctx } = await wired(ns);
    expect(ctx.placementNote).toBe(DRAFT_PART_UNREAD);
  });

  // Why: a "Delete it" that lands between the open's settings read and its
  // draft read makes that read refuse the record it read (it is rejected
  // now). The read's "a station did not read" went with it, but the flag
  // that keeps a record with a lost station was kept, so the spent open
  // treated a deleted record as one that may still read again and left
  // its removal to the sweep alone. Refused, the record is no record at
  // all: the spent open removes it as it removes any other.
  it("forgets a lost station of a record the read refused once it was rejected", async () => {
    const ns = await space(
      JSON.stringify({ needsNoGps: false, createdStations: [unreadable] }),
    );
    const open = ns.open;
    const rejectMidRead = async (key: string) => {
      const store = await open(key);
      return {
        ...store,
        getText: async (k: string) => {
          const text = await store.getText(k);
          if (k === SETTINGS_KEY) {
            await store.put(
              META_KEY,
              JSON.stringify({
                format: TOUR_OBJECT_RECORD_FORMAT,
                tourUrl: OLD,
                sizeM: 0.16,
                rejected: [SETTINGS_REJECTED],
              }),
            );
          }
          return text;
        },
      };
    };
    const { ctx } = await wired(Object.assign(ns, { open: rejectMidRead }));
    expect(ctx.placementNote, "nothing is said lost").toBeNull();
    const removals = ns.log.filter((e) => e === `remove ${SETTINGS_KEY}`);
    expect(removals, "the sweep and the spent open's own removal").toHaveLength(
      2,
    );
    expect(ns.files(OLD).has(SETTINGS_KEY)).toBe(false);
  });

  it("says nothing of a record that reads", async () => {
    const ns = await space(JSON.stringify({ needsNoGps: false }));
    const { ctx } = await wired(ns);
    expect(ctx.placementNote).toBeNull();
  });

  it("tells of a captured photo whose bytes do not read", async () => {
    // Why (PR #876 review, note 8): the read drops such a record - a
    // restore of it would name a content entry the zip lacks - and the
    // phone said nothing at all, so a photo vanished without a word.
    const ns = namespaces({ unreadable: photoKey("ph") });
    const first = await wired(ns);
    const photo: TourObject = {
      id: "ph",
      kind: "picture",
      view: "plane",
      image: "ph",
      widthM: 1,
      imageAsset: {
        id: "ph",
        path: "content/ph.jpg",
        kind: "image",
        width: 4,
        height: 3,
      },
      createdAtIso: "2026-10-20T00:00:00.000Z",
      geo: { lat: 48.5201, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
    };
    expect(
      await first.draft.writeObject(
        photo,
        new Blob(["JPEG"], { type: "image/jpeg" }),
      ),
    ).toBe(true);
    await flush();
    expect(ns.files(OLD).has(photoKey("ph"))).toBe(true);
    const { ctx } = await wired(ns);
    expect(ctx.placementNote).toBe(DRAFT_PART_UNREAD);
  });
});

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
      (JSON.parse(copied.get(META_KEY) as string) as { tourUrl: string })
        .tourUrl,
    ).toBe(NEW);
    // The opened file's namespace keeps what it held.
    expect([...ns.files(OLD).keys()].sort()).toEqual([...before.keys()].sort());

    expect(await draft.writeObject(pin("a", "after"))).toBe(true);
    expect(ns.files(NEW).get(objectKey("a")) as string).toContain("after");
    expect(ns.files(OLD).get(objectKey("a")) as string).not.toContain("after");
  });

  it("never overwrites a write made while the copy ran with the old copy", async () => {
    const ns = namespaces();
    const { draft } = await wired(ns);
    expect(await draft.writeObject(pin("a", "before"))).toBe(true);
    await flush();
    const during: Promise<boolean>[] = [];
    ns.beforePut = (key) => {
      if (during.length === 0 && key === objectKey("a")) {
        // The copy's put of the old record is under way: a live edit is
        // issued now, and must land after it.
        ns.beforePut = null;
        during.push(draft.writeObject(pin("a", "during")));
      }
      return new Promise((resolve) => setTimeout(resolve, 0));
    };
    expect(await draft.follow(NEW)).toBe(true);
    expect(await Promise.all(during)).toEqual([true]);
    expect(ns.files(NEW).get(objectKey("a")) as string).toContain("during");
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
    expect(ns.files(NEW).get(objectKey("a")) as string).toContain("after");
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
      ...stationContent([
        storyOf("s-new-story", [
          {
            id: "hello-text",
            kind: "shortText" as const,
            view: "card" as const,
            caption: "Hello there.",
            pose: {
              position: [0, 0, 0] as [number, number, number],
              rotation: [0, 0, 0, 1] as [number, number, number, number],
            },
            advance: { mode: "tap" as const },
          },
        ]),
      ]),
    };
    expect(
      await draft.saveSettings({ needsNoGps: false, frames: [frame] }),
    ).toBe(true);
    await flush();
    const stored = ns.files(OLD).get(SETTINGS_KEY);
    expect(typeof stored).toBe("string");
    expect(parseSettingsRecord(stored as string)?.frames).toEqual([frame]);
  });

  // Why: a station's story may name the opened tour's assets; read without
  // that tour, such a frame did not read and the draft said part of it
  // was lost. (The phone restores no frame from the record alone: the
  // shared suite's `settingsGap` rows.)
  it("reads the stored frames against the opened tour, so a frame naming its asset reads", async () => {
    const frame = {
      id: "s-new",
      geo: { lat: 48.5205, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow",
      children: [
        {
          id: "tale",
          kind: "folder",
          role: "story",
          title: "The tale",
          children: [
            {
              id: "look",
              kind: "picture",
              view: "card",
              image: "img1",
              widthM: 1,
              pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              advance: { mode: "tap" },
            },
          ],
        },
      ],
    };
    const ns = namespaces();
    const space = await ns.open(draftKeyForTour(OLD));
    await space.put(
      SETTINGS_KEY,
      JSON.stringify({ needsNoGps: false, createdStations: [frame] }),
    );
    const { ctx } = await wired(
      ns,
      tourOf([pin("a")], {
        assets: [
          {
            id: "img1",
            path: "content/img1.png",
            kind: "image",
            width: 1,
            height: 1,
          },
        ],
      }),
    );
    expect(ctx.placementNote).toBeNull();
  });
});

describe("the phone draft keeps the versions a running save wrote", () => {
  // Why: an undo back to what a running Finish writes makes the record
  // match the written file, so the draft forgets it - and its stored
  // base, which named that written version. A redo writes the record
  // again; if it names only the opened version, a reopen after that save
  // landed takes the hosted version for someone else's newer edit and
  // drops the redone work. The editor's draft lost work this way before
  // its fix; this pins whether the phone's does.
  it("offers a record written again after a forget, once the save it outlived landed", async () => {
    const ns = namespaces();
    const { draft } = await wired(ns, tourOf([pin("a")]));
    const saved = tourOf([pin("a", "two")]);
    await draft.writeObject(pin("a", "two"));
    draft.finished(["a"], saved);
    await draft.writeObject(pin("a", "three"));
    await flush();
    // The undo back to the saved version: nothing differs, so forgotten.
    await draft.forgetObject("a");
    // The redo.
    await draft.writeObject(pin("a", "three"));
    await flush();
    expect(ns.files(OLD).has(objectKey("a"))).toBe(true);
    // The save landed; the saved file opens again.
    const { ctx } = await wired(ns, saved);
    expect(ctx.placementNote ?? "").not.toContain("newer");
    expect(ns.files(OLD).has(objectKey("a"))).toBe(true);
  });
});

describe("Delete it's commit point holds the settings and codes records", () => {
  const RENAMED = { needsNoGps: false, details: { title: "The castle walk" } };
  const LEVEL = { id: "old", json: "{}" };

  /** OLD's namespace with a stamped meta and `files`. */
  async function seeded(files: Record<string, string>) {
    const ns = namespaces();
    const space = await ns.open(draftKeyForTour(OLD));
    await space.put(
      META_KEY,
      JSON.stringify({
        format: TOUR_OBJECT_RECORD_FORMAT,
        tourUrl: OLD,
        sizeM: 0.16,
      }),
    );
    for (const [key, text] of Object.entries(files)) await space.put(key, text);
    return ns;
  }

  /** A page with OLD's draft offered, "Delete it" tapped and landed, and
   *  the record's removal held: a settings write issued now waits behind
   *  it, as a rename that waited for the answer does. */
  async function deletedWithRemovalHeld() {
    const ns = await seeded({
      [SETTINGS_KEY]: JSON.stringify({
        needsNoGps: false,
        details: { title: "An older name" },
      }),
    });
    const page = await wired(ns);
    expect(page.dom.draftOffer.hidden, "the record is offered").toBe(false);
    ns.holdRemovesOf = new RegExp(`^${SETTINGS_KEY}$`);
    page.dom.draftDiscard.click();
    await flush();
    expect(page.dom.draftOffer.hidden, "Delete it landed").toBe(true);
    const saved = page.draft.saveSettings(RENAMED);
    return { ns, page, saved };
  }

  // Why: a settings write issued after a landed "Delete it" is newer than
  // the rejection and must claim it. Run once the tour had closed, the
  // claim was skipped (it read the closed tour's lists): the record landed
  // under a meta that still rejected it, nothing was said, and the next
  // open swept it - the rename lost without a word.
  it("a settings write that runs after the tour closed claims the rejection, and the next open offers it", async () => {
    const { ns, page, saved } = await deletedWithRemovalHeld();
    page.draft.reset();
    ns.releasePuts();
    expect(await saved).toBe(true);
    await flush();
    const next = await wired(ns);
    expect(next.dom.draftOffer.hidden, "the rename is offered").toBe(false);
  });

  // Why: the same write, run once a Finish moved the draft to the saved
  // file's key: the claim read the new namespace's lists, the record
  // landed in the old one under its rejection, the copy carried both, and
  // the new namespace's meta rejected the record again.
  it("a settings write that runs after the draft followed a Finish claims the rejection there too", async () => {
    const { ns, page, saved } = await deletedWithRemovalHeld();
    const moved = page.draft.follow(NEW);
    await flush();
    ns.releasePuts();
    expect(await saved).toBe(true);
    expect(await moved).toBe(true);
    await flush();
    const next = await wired(ns, tourOf([pin("a")]), NEW);
    expect(next.dom.draftOffer.hidden, "the rename is offered").toBe(false);
  });

  // Why: a close and a reopen in the same tab while "Delete it"'s commit
  // was on its way: the reopen read the record before the commit landed
  // and the rest after it, and offered the record alone - a record the
  // creator had just deleted, back as the draft.
  it("a reopen whose read the commit lands in the middle of offers nothing", async () => {
    const ns = await seeded({ [SETTINGS_KEY]: JSON.stringify(RENAMED) });
    const page = await wired(ns);
    expect(page.dom.draftOffer.hidden, "the record is offered").toBe(false);
    ns.holdPutsOf = new RegExp(`^${META_KEY}$`);
    page.dom.draftDiscard.click();
    page.draft.reset();
    page.draft.present(OLD);
    await flush();
    ns.releasePuts();
    await flush();
    expect(page.dom.draftOffer.hidden, "nothing is offered").toBe(true);
    const next = await wired(ns);
    expect(next.dom.draftOffer.hidden, "nor at the next open").toBe(true);
  });

  // Why: the codes record goes with the draft, so the commit names it as
  // it names the settings record. Replaced only after the commit, a tab
  // closed right after it left the deleted code on disk, and the next
  // open offered it again.
  it("a tab closed right after the commit landed leaves the codes record inert", async () => {
    const ns = await seeded({
      [CODES_KEY]: JSON.stringify({ level: LEVEL, levels: [LEVEL] }),
    });
    const page = await wired(ns);
    expect(page.dom.draftOffer.hidden, "the code is offered").toBe(false);
    ns.crashAfter = 1;
    page.dom.draftDiscard.click();
    await flush();
    ns.crashAfter = null;
    const meta = JSON.parse(ns.files(OLD).get(META_KEY) as string) as {
      rejected?: string[];
    };
    expect(meta.rejected).toContain(CODES_REJECTED);
    expect(meta.rejected).toContain(SETTINGS_REJECTED);
    const next = await wired(ns);
    expect(next.dom.draftOffer.hidden, "nothing is offered").toBe(true);
    await flush();
    expect(
      (ns.files(OLD).get(CODES_KEY) as string | undefined) ?? "",
      "the next open dropped the deleted code",
    ).not.toContain('"old"');
  });

  // Why: the codes record holds the page's own codes beside the waiting
  // draft's. Named in the commit while the page held a code, a tab closed
  // between the commit and the record's rewrite left the page's code
  // inert, and the next open dropped it: a code measured while the offer
  // waited, lost without a word. With page codes the record is rewritten
  // after the commit instead; a crash then offers the deleted draft's
  // codes again, beside the page's, which is visible and recoverable.
  it("a tab closed right after the commit keeps a code the page measured", async () => {
    const ns = await seeded({
      [CODES_KEY]: JSON.stringify({ level: LEVEL, levels: [LEVEL] }),
    });
    const mine = { id: "mine", json: "{}" };
    const page = await wired(ns, tourOf([pin("a")]), OLD, mine);
    expect(page.dom.draftOffer.hidden, "the code is offered").toBe(false);
    expect(ns.files(OLD).get(CODES_KEY) as string).toContain('"mine"');
    ns.crashAfter = 1;
    page.dom.draftDiscard.click();
    await flush();
    ns.crashAfter = null;
    const next = await wired(ns);
    await flush();
    expect(
      (ns.files(OLD).get(CODES_KEY) as string | undefined) ?? "",
      "the page's code is still on disk",
    ).toContain('"mine"');
    expect(next.dom.draftOffer.hidden, "and offered").toBe(false);
  });

  // Why: a code measured after "Delete it" is newer than the rejection:
  // its write claims the codes record, or the next open would hide it.
  it("a code measured after Delete it claims the codes record, and the next open offers it", async () => {
    const ns = await seeded({
      [CODES_KEY]: JSON.stringify({ level: LEVEL, levels: [LEVEL] }),
    });
    const page = await wired(ns);
    page.dom.draftDiscard.click();
    await flush();
    const fresh = { id: "fresh", json: "{}" };
    expect(await page.draft.saveCodes({ level: fresh, levels: [fresh] })).toBe(
      true,
    );
    await flush();
    const meta = JSON.parse(ns.files(OLD).get(META_KEY) as string) as {
      rejected?: string[];
    };
    expect(meta.rejected ?? []).not.toContain(CODES_REJECTED);
    const next = await wired(ns);
    expect(next.dom.draftOffer.hidden, "the new code is offered").toBe(false);
  });

  // Why: the same claim once the tour closed before the code's write ran:
  // it claims the rejection by the namespace's own meta.
  it("a code write that runs after the tour closed claims the rejection, and the next open offers it", async () => {
    const ns = await seeded({
      [CODES_KEY]: JSON.stringify({ level: LEVEL, levels: [LEVEL] }),
    });
    const page = await wired(ns);
    ns.holdRemovesOf = new RegExp(`^${CODES_KEY}$`);
    page.dom.draftDiscard.click();
    await flush();
    const fresh = { id: "fresh", json: "{}" };
    const saved = page.draft.saveCodes({ level: fresh, levels: [fresh] });
    page.draft.reset();
    ns.releasePuts();
    expect(await saved).toBe(true);
    await flush();
    const next = await wired(ns);
    expect(next.dom.draftOffer.hidden, "the new code is offered").toBe(false);
  });
});

describe("an object edited after Delete it claims its id wherever its write runs", () => {
  /** OLD with a draft of pin "a" offered, "Delete it" tapped and landed. */
  async function deleted(holdSweep: boolean) {
    const ns = namespaces();
    const first = await wired(ns);
    expect(await first.draft.writeObject(pin("a", "draft"))).toBe(true);
    await flush();
    const page = await wired(ns);
    expect(page.dom.draftOffer.hidden, "the draft is offered").toBe(false);
    if (holdSweep) ns.holdRemovesOf = new RegExp(`^${objectKey("a")}$`);
    page.dom.draftDiscard.click();
    await flush();
    expect(page.dom.draftOffer.hidden, "Delete it landed").toBe(true);
    return { ns, page };
  }

  // Why: the edit is newer than the rejection. Run once the tour had
  // closed (queued behind the id's sweep), its claim was skipped: it
  // landed under a meta still rejecting the id, and the next open hid it
  // and swept it.
  it("an edit that runs after the tour closed is offered at the next open", async () => {
    const { ns, page } = await deleted(true);
    const wrote = page.draft.writeObject(pin("a", "edited"));
    page.draft.reset();
    ns.releasePuts();
    expect(await wrote).toBe(true);
    await flush();
    const next = await wired(ns);
    expect(next.dom.draftOffer.hidden, "the edit is offered").toBe(false);
    expect(ns.files(OLD).has(objectKey("a"))).toBe(true);
  });

  // Why: the same edit, run once a Finish moved the draft to the saved
  // file's key: it landed in the old namespace under the rejection, the
  // copy carried it, and the new meta rejected the id again.
  it("an edit that runs after the draft followed a Finish is offered there", async () => {
    const { ns, page } = await deleted(true);
    const wrote = page.draft.writeObject(pin("a", "edited"));
    const moved = page.draft.follow(NEW);
    await flush();
    ns.releasePuts();
    expect(await wrote).toBe(true);
    expect(await moved).toBe(true);
    await flush();
    const next = await wired(ns, tourOf([pin("a")]), NEW);
    expect(next.dom.draftOffer.hidden, "the edit is offered").toBe(false);
  });

  // Why: a claim that started while the draft was the open tour's, and
  // whose removal was still running when a Finish moved it, wrote the
  // meta through the meta's queue - which waited for the move, while the
  // move waited for this claim: neither ever ended, and every later write
  // of the draft waited behind them.
  it("a claim the draft moves away from in the middle still ends, and the edit is offered there", async () => {
    const { ns, page } = await deleted(false);
    await flush();
    ns.holdRemovesOf = new RegExp(`^${objectKey("a")}$`);
    let wroteDone = false;
    let movedDone = false;
    const wrote = page.draft.writeObject(pin("a", "edited")).then((ok) => {
      wroteDone = true;
      return ok;
    });
    await flush();
    const moved = page.draft.follow(NEW).then((ok) => {
      movedDone = true;
      return ok;
    });
    await flush();
    ns.releasePuts();
    await flush();
    expect(wroteDone, "the edit's write ended").toBe(true);
    expect(movedDone, "the move ended").toBe(true);
    expect(await wrote).toBe(true);
    expect(await moved).toBe(true);
    const next = await wired(ns, tourOf([pin("a")]), NEW);
    expect(next.dom.draftOffer.hidden, "the edit is offered").toBe(false);
  });

  // Why: two objects edited after "Delete it", both writes running once
  // the tour closed, claim their ids by the same namespace's meta from
  // their own queues. Each read the meta and rewrote it without its own
  // id, at the same time, so the later rewrite put the other id back:
  // that write reported true, its record stayed on disk, and the next
  // open hid it and swept it.
  it("two edits that run after the tour closed both claim their ids, and both are offered", async () => {
    const ns = namespaces();
    const first = await wired(ns);
    expect(await first.draft.writeObject(pin("a", "draft"))).toBe(true);
    expect(await first.draft.writeObject(pin("b", "draft"))).toBe(true);
    await flush();
    const page = await wired(ns);
    expect(page.dom.draftOffer.hidden, "the draft is offered").toBe(false);
    ns.holdRemovesOf = new RegExp(`^(${objectKey("a")}|${objectKey("b")})$`);
    page.dom.draftDiscard.click();
    await flush();
    expect(page.dom.draftOffer.hidden, "Delete it landed").toBe(true);
    const wrote = [
      page.draft.writeObject(pin("a", "edited a")),
      page.draft.writeObject(pin("b", "edited b")),
    ];
    page.draft.reset();
    ns.releasePuts();
    expect(await Promise.all(wrote)).toEqual([true, true]);
    await flush();
    const meta = JSON.parse(ns.files(OLD).get(META_KEY) as string) as {
      rejected?: string[];
    };
    expect(meta.rejected ?? []).not.toContain("a");
    expect(meta.rejected ?? []).not.toContain("b");
    const next = await wired(ns);
    expect(next.dom.draftOffer.hidden, "the edits are offered").toBe(false);
    expect(ns.files(OLD).get(objectKey("a")) as string).toContain("edited a");
    expect(ns.files(OLD).get(objectKey("b")) as string).toContain("edited b");
  });
});
