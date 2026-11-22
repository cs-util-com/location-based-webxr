/**
 * The parity contract (tour editor plan 2026-10-17-1816, D30, D31): the
 * same operations, driven through the phone's page (`wireCreatorSetup`,
 * the creator's object list, draft and Finish) and through the desktop
 * editor's (`createEditorSession` with `createEditorDraft`), must write
 * the same tour file and leave the same draft records.
 *
 * Why this test matters: the two pages kept two working copies of one
 * tour that meant different things (the state audit
 * 2026-10-18-1126-tour-viewer-shared-state-foundation-audit.md), and two
 * real bugs came from that split in one review (plan §19 #1, #2). Every
 * row here is one operation sequence; a row the two pages disagree on is
 * marked `it.fails` and names the step that removes the divergence. When
 * that step lands the marked row turns red, and the marker comes off:
 * the assertion itself is never weakened. Kept in the gate for good (D31).
 *
 * What is compared:
 * - the manifest the save wrote (`tour.json` as serialized), and
 * - the draft's records as a later open reads them (`readDraft`): each
 *   object's content and each deletion's id - not the meta (the phone's
 *   printed size) nor the codes record, which are the phone's alone. A
 *   tour's level files are compared on their own (a save keeps them byte
 *   for byte).
 *
 * What is NOT driven here, on purpose: the phone's AR geometry (where a
 * reticle tap lands, a code's re-measure). Its placement, move and
 * station move run only in an AR session, which `authoring-settle.test.ts`
 * drives with a stood-in device. For those rows the phone side applies
 * the result its AR path leaves in the page's lists (named per row), and
 * the row compares what the document makes of it from there on.
 */
import { editorStore } from "./test-support/editor-store.js";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import { isDeepStrictEqual } from "node:util";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  packFilesAsZip,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";
import { openTourFile, tourFileKeyOfFile } from "./tour-session.js";
import { memoryDraftStores } from "./test-support/memory-draft-stores.js";
import {
  desktopPage,
  flush,
  NoSuchOperation,
  OPENED,
  phonePage,
  PHONE_FINISH_REFUSED,
  pin,
  tourFile,
  withStationsByOrder,
  type Page,
} from "./test-support/parity-pages.js";
import { pngBlob } from "./test-support/png-blob.js";
import { stationIdOf, tourOf } from "./test-support/tour-of.js";
import {
  stationContent,
  stationBlocks,
} from "./test-support/station-content.js";

beforeAll(() => {
  editorStore();
});

// --- the table --------------------------------------------------------------

interface Row {
  readonly name: string;
  /** The operations, from the opened tour; a row that reopens continues on
   *  the page `run` returns. */
  readonly run: (page: Page) => Promise<Page>;
  /** Compare the draft's records too (rows whose phone side is the result
   *  of an AR path write no records here, see the file's comment). */
  readonly records: boolean;
  /** Where the two pages diverge today, and the step that ends it. */
  readonly diverges?: string;
  /** A divergence by design: one page has no such operation (the phone,
   *  or since D8 the desktop), and the row may fail for that reason only
   *  (`NoSuchOperation`) - the phone refusing a Finish, or writing
   *  something else, is a red row (the r880 milestone review LOW-6). */
  readonly byDesign?: true;
  /** What each page must leave, beyond agreeing with the other: two pages
   *  that share a bug agree too (the r880 milestone review, HIGH-1).
   *  It sees each page's records (null for a row that compares none)
   *  and written tour. A by-design row whose DESKTOP lacks the operation
   *  still runs it on the phone against this (the r886 review M2:
   *  otherwise the phone's half never ran). */
  readonly each?: (page: {
    readonly records: { objects: string[]; deleted: string[] } | null;
    readonly written: TourManifest;
  }) => void;
}

const NORTH = 48.5205;

/** Why the station rows run on the desktop alone. */
const STATIONS_DESKTOP_ONLY =
  "by design: the 3D editor's station edits are the desktop's; the phone edits stations only by placing in AR";

/** A station's title, or its id when it has none. */
function titleOrId(station: TourStation): string {
  return station.title ?? station.id;
}

/** An item's kind. */
function kindOf(item: TourBlock): string {
  return item.kind;
}

/** The item ids of a written tour, station by station: the opened tour's
 *  stations, and the stations the write added. */
function itemsByStation(written: TourManifest): {
  opened: string[][];
  added: string[][];
} {
  const opened = new Set(tourOf(OPENED).stations.map((s) => s.id));
  const itemsOf = (stations: readonly TourStation[]) =>
    stations.map((s) =>
      stationBlocks(s)
        .map((i) => i.id)
        .sort(),
    );
  return {
    opened: itemsOf(written.stations.filter((s) => opened.has(s.id))),
    added: itemsOf(written.stations.filter((s) => !opened.has(s.id))),
  };
}

/** The written station holding item `id`. */
function stationHolding(
  written: TourManifest,
  id: string,
): TourStation | undefined {
  return written.stations.find((s) =>
    stationBlocks(s).some((i) => i.id === id),
  );
}

const ROWS: readonly Row[] = [
  {
    name: "edit a pin's text, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      return p;
    },
  },
  {
    // Why (review #2a): a name change rides along with a real edit, so
    // the phone's Finish starts - both pages must write the same name.
    name: "edit a pin and name the tour, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.setDetails({ name: "Castle walk" });
      return p;
    },
  },
  {
    // Why: pin b is its station's only object, and the station has no
    // title, story or route: deleting the pin drops the station with it.
    name: "delete a pin, save",
    records: true,
    run: async (p) => {
      await p.remove("b");
      return p;
    },
    each: ({ written }) => {
      expect(written.stations.map((s) => s.id)).toEqual(["st-a", "st-f"]);
    },
  },
  {
    name: "delete a photo the file carries, save",
    records: true,
    run: async (p) => {
      await p.remove("f");
      return p;
    },
  },
  {
    name: "delete a pin and undo the delete, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.remove("b");
      await p.undoDelete();
      return p;
    },
  },
  {
    name: "edit, save, edit again, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.save();
      await p.edit("b", "The well");
      return p;
    },
  },
  {
    name: "delete, save, undo the delete, save",
    records: true,
    run: async (p) => {
      await p.remove("b");
      await p.save();
      await p.undoDelete();
      return p;
    },
    // Why: the first save wrote the deletion and took "b" out of the
    // document's deletions, but not the draft's tombstone; an undo that
    // left it would delete "b" again on the next restore.
    each: ({ records }) => {
      expect(records?.deleted).not.toContain("b");
    },
  },
  {
    name: "restore a draft's edit and delete on a later open, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.remove("b");
      return p.reopenRestored();
    },
  },
  {
    // Why: a move never starts a station. About 57 m from its station and
    // 36 m from the nearest other one (25 m radii): the note keeps its
    // station, outside the circle, on both pages.
    name: "move a note out of its station's radius, save",
    records: false,
    run: async (p) => {
      await p.move("a", NORTH, 9.0502);
      expect(p.addedStations()).toEqual([]);
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [],
      });
    },
  },
  {
    // Why: inside another station's circle (about 11 m, 25 m radii) the
    // creator was asked. Declined, the note stays where its station was.
    name: "move a note into another station's radius, declined, save",
    records: false,
    run: async (p) => {
      await p.move("a", 48.5203, 9.05);
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [],
      });
    },
  },
  {
    // Why: the same, answered yes: the note changes to that station.
    name: "move a note into another station's radius, agreed, save",
    records: false,
    run: async (p) => {
      await p.move("a", 48.5203, 9.05, stationIdOf("b"));
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a", "b"], ["f"]],
        added: [],
      });
    },
  },
  {
    // Why: a new pin about 33 m from the nearest station is beyond every
    // station's 25 m radius: it starts a station anchored where it stands.
    name: "place a new pin beyond every station's radius, save",
    records: false,
    run: async (p) => {
      await p.place(pin("new", "A new pin", NORTH));
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [["new"]],
      });
      expect(stationHolding(written, "new")?.geo.lat).toBeCloseTo(NORTH, 9);
      expect(stationHolding(written, "new")).toMatchObject({
        foundRadiusM: 25,
        activateRadiusM: 50,
      });
    },
  },
  {
    // Why: a drop's end state has to survive a reload as it was left: the
    // note outside its circle comes back in its own station, on both
    // pages, not in one the rule seats it in again.
    name: "move a note out of its station's radius, reload and restore the draft, save",
    records: false,
    run: async (p) => {
      await p.move("a", NORTH, 9.0502);
      const after = await p.reopenRestored();
      expect(after.addedStations()).toEqual([]);
      return after;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [],
      });
    },
  },
  {
    // Why: as above for a Yes: the station it changed to is written in the
    // object's draft record, so the reload keeps the change.
    name: "move a note to another station, reload and restore the draft, save",
    records: false,
    run: async (p) => {
      await p.move("a", 48.5203, 9.05, stationIdOf("b"));
      return p.reopenRestored();
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a", "b"], ["f"]],
        added: [],
      });
    },
  },
  {
    // Why: a new pin about 11 m from pin b's station, within its radius,
    // joins it rather than starting one of its own.
    name: "place a new pin within a station's radius, save",
    records: false,
    run: async (p) => {
      await p.place(pin("near", "A near pin", 48.5203));
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b", "near"], ["f"]],
        added: [],
      });
    },
  },
  {
    name: "move a station with its items (D17), save",
    records: false,
    run: async (p) => {
      await p.moveStation("st-a", {
        lat: NORTH,
        lon: 9.0503,
        alt: 340,
        rotation: [0, 0, 0, 1],
      });
      return p;
    },
  },
  {
    // Why (the r875 milestone review #1): a moved station must survive a
    // reload with its items (D17), not come back as its items at the
    // moved spots inside the unmoved station.
    name: "move a station, reload and restore the draft, save",
    records: false,
    run: async (p) => {
      await p.moveStation("st-a", {
        lat: NORTH,
        lon: 9.0503,
        alt: 340,
        rotation: [0, 0, 0, 1],
      });
      return p.reopenRestored();
    },
  },
  {
    // Why (plan M3b, Q-D): the phone's settle moves a station and saves
    // its code's new text as ONE step, so one undo takes the move back
    // whole - the station and its items where the opened tour has them,
    // as the desktop's undo of its move leaves them.
    name: "edit a pin, move a station by a code, undo the move, save",
    records: false,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.moveStation("st-a", {
        lat: NORTH,
        lon: 9.0503,
        alt: 340,
        rotation: [0, 0, 0, 1],
      });
      await p.undo();
      return p;
    },
    each: ({ written }) => {
      expect(stationHolding(written, "a")?.geo).toEqual(
        stationHolding(tourOf(OPENED), "a")?.geo,
      );
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [],
      });
    },
  },
  {
    // Why (owner decision D8 of the editor round-2 plan): the phone's
    // "New station here" goes through the document's own path; the
    // desktop's "+" in the tree and "Move to a new station" come with the
    // 3D editor. When they land this row turns red and becomes a parity
    // row.
    name: "place a pin that starts its own station within the radius (D8), save",
    records: false,
    byDesign: true,
    diverges:
      "by design until the 3D editor: D8's desktop half (the tree's '+', the inspector's 'Move to a new station') is not built yet",
    run: async (p) => {
      // About 11 m north of pin b: within R, so only its own station
      // keeps it out of b's.
      await p.placeOwnStation(pin("own", "Its own station", 48.5203));
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [["own"]],
      });
    },
  },
  {
    name: "turn on 'needs no GPS', save",
    records: true,
    byDesign: true,
    diverges:
      "by design: the setting is marked in the editor (Q-QF-1, the QR-first field study plan), the phone offers none - removed only if the owner wants it on the phone",
    run: async (p) => {
      await p.setNeedsNoGps(true);
      return p;
    },
  },
  {
    name: "name the tour, save",
    records: true,
    run: async (p) => {
      await p.setDetails({ name: "Castle walk" });
      return p;
    },
  },
  {
    name: "give the tour a description and a contact, save",
    records: true,
    byDesign: true,
    diverges:
      "by design: the phone has a tour name field only (W2 of the tour editor plan), the full details dialog is the editor's - removed only if the owner wants it on the phone",
    run: async (p) => {
      await p.setDetails({
        description: "A walk around the castle.",
        contact: "https://example.org",
      });
      return p;
    },
  },
  {
    // Why: a station's details are the 3D editor's (desktop only); they
    // must reach the saved tour and survive a reload through the draft.
    name: "rename a station and set its radius, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges: STATIONS_DESKTOP_ONLY,
    run: async (p) => {
      await p.editStations((e) =>
        e.editStation("st-a", { title: "The gate", foundRadiusM: 40 }),
      );
      return p.reopenRestored();
    },
    each: ({ written }) => {
      expect(written.stations.find((s) => s.id === "st-a")).toMatchObject({
        title: "The gate",
        foundRadiusM: 40,
        activateRadiusM: 80,
      });
    },
  },
  {
    // Why: an added, a deleted and a reordered station each change the
    // tour's stations without any object's record naming them: only the
    // draft's whole frames bring them back after a reload.
    name: "add a station, delete another, reverse the order, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges: STATIONS_DESKTOP_ONLY,
    run: async (p) => {
      await p.editStations((e) => {
        e.addStation({ lat: NORTH, lon: 9.0505, alt: 340 });
        e.deleteStation("st-b");
        e.reorderStations(
          e
            .model()
            .items.filter((i) => i.kind === "station")
            .map((i) => i.id.slice("station:".length))
            .reverse(),
        );
      });
      return p.reopenRestored();
    },
    each: ({ written }) => {
      // The added station is untitled: the tree names it by its number.
      const [added, ...rest] = written.stations;
      expect(added?.id.startsWith("st-")).toBe(false);
      expect(added?.title).toBeUndefined();
      expect(rest.map(titleOrId)).toEqual(["st-f", "st-a"]);
      expect(itemsByStation(written).opened).toEqual([["f"], ["a"]]);
    },
  },
  {
    // Why: a copy of a photo names a content file of its own; the copy
    // must save with its picture, and come back from the draft with it.
    name: "copy a photo's station and a pin, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges: STATIONS_DESKTOP_ONLY,
    run: async (p) => {
      await p.editStations(async (e) => {
        await e.duplicateStation("st-f");
        await e.duplicateObject("a");
      });
      return p.reopenRestored();
    },
    each: ({ written }) => {
      const copy = written.stations[3];
      expect(copy?.title).toBe("Station 3 copy");
      expect(stationBlocks(copy!).map(kindOf)).toEqual(["picture"]);
      expect(itemsByStation(written).opened[0]).toHaveLength(2);
    },
  },
  {
    // Why: "Move to a new station" starts a station where the item stands
    // even within its own station's radius, and "put on the ground" sets
    // its height; both must reach the saved tour after a reload.
    name: "move a pin into a station of its own and set its height, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges: STATIONS_DESKTOP_ONLY,
    run: async (p) => {
      await p.editStations((e) => {
        e.pose(
          "a",
          { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
          { newStation: true },
        );
        e.groundItems([{ id: "a", alt: 338.5 }]);
      });
      return p.reopenRestored();
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["b"], ["f"]],
        added: [["a"]],
      });
      const home = stationHolding(written, "a");
      expect(stationBlocks(home!)[0]?.pose.position[1]).toBeCloseTo(-1.5, 6);
    },
  },
  {
    // Why: a character is declared in the editor with its two pictures;
    // the declaration and both files must reach the saved tour, and come
    // back from the draft after a reload.
    name: "add a character, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges:
      "by design: characters are added in the editor; the phone has no Characters list",
    run: async (p) => {
      await p.editStations((e) =>
        e.declareCharacter({
          name: "Ranger Rita",
          image: pngBlob(8, 4),
          frames: pngBlob(16, 4),
        }),
      );
      return p.reopenRestored();
    },
    each: ({ written }) => {
      const [rita, ...more] = written.characters ?? [];
      expect(more).toEqual([]);
      expect(rita?.name).toBe("Ranger Rita");
      expect(written.assets.map((a) => a.id)).toEqual(
        expect.arrayContaining([rita?.image, rita?.frames]),
      );
    },
  },
  {
    name: "a name longer than 80 characters is refused, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.setDetails({ name: "x".repeat(81) });
      return p;
    },
  },
];

/** The pages wrote different tours or drafts: the one divergence a
 *  comparison raises. */
class PagesDisagree extends Error {}

/** What a marked row may fail with: the pages disagreeing, an operation
 *  the phone does not have, or the phone's Finish refusing to start. Not
 *  any assertion (the r875 milestone review #2c): a `vi.waitFor` timeout
 *  or a harness assertion is a broken row, never a divergence. */
function isDivergence(err: unknown): boolean {
  return (
    err instanceof PagesDisagree ||
    err instanceof NoSuchOperation ||
    (err instanceof Error && err.message === PHONE_FINISH_REFUSED)
  );
}

/** What a row leaves on one page: the file written and the draft. */
async function outcome(
  row: Row,
  make: (
    file: File,
    stores: (key: string) => Promise<DraftFileStore>,
  ) => Promise<Page>,
): Promise<{
  written: unknown;
  manifest: TourManifest;
  records: { objects: string[]; deleted: string[] } | null;
}> {
  const file = await tourFile();
  const stores = memoryDraftStores().open;
  const page = await row.run(await make(file, stores));
  const written = await page.save();
  await flush();
  return {
    written: withStationsByOrder(written),
    manifest: written,
    records: row.records ? await page.records() : null,
  };
}

/** What `row` asks of each page's outcome (`each`). */
function expectEach(row: Row, page: Awaited<ReturnType<typeof outcome>>): void {
  row.each?.({ records: page.records, written: page.manifest });
}

/** A marked row broke for a reason that is not a divergence: swallowed,
 *  so the row PASSES and `it.fails` turns it red. An unmarked row fails. */
function broken(row: Row, err: unknown): void {
  if (row.diverges === undefined) throw err;
  console.error(`${row.name}: not a divergence`, err);
}

/** Runs `row` on both pages and asserts they wrote the same. A marked
 *  row must fail for the reason it names - the pages disagree, or the
 *  phone has no such operation - never because the harness broke. The
 *  desktop runs FIRST and outside the divergence net (review #2b): a
 *  desktop that breaks in a row whose phone refuses is a red row, not an
 *  expected failure. */
async function samePages(row: Row): Promise<void> {
  let desktop: Awaited<ReturnType<typeof outcome>>;
  try {
    desktop = await outcome(row, desktopPage);
  } catch (err) {
    // The desktop lacking an operation by design (D8's desktop half): the
    // phone's half still runs and must leave what the row says, or the
    // row is red - only then the desktop's reason ends it.
    if (row.byDesign === true && err instanceof NoSuchOperation) {
      try {
        expectEach(row, await outcome(row, phonePage));
      } catch (phoneErr) {
        broken(row, phoneErr);
        return;
      }
      throw err;
    }
    broken(row, err);
    return;
  }
  let phone: Awaited<ReturnType<typeof outcome>>;
  try {
    phone = await outcome(row, phonePage);
  } catch (err) {
    const named =
      row.byDesign === true
        ? err instanceof NoSuchOperation
        : isDivergence(err);
    // The phone lacking an operation by design: the desktop's half ran and
    // must leave what the row says, or the row is red - only then the
    // phone's reason ends it.
    if (named && row.byDesign === true) {
      try {
        expectEach(row, desktop);
      } catch (desktopErr) {
        broken(row, desktopErr);
        return;
      }
    }
    if (named) throw err;
    broken(row, err);
    return;
  }
  if (row.diverges === undefined) {
    expect(desktop.written).toEqual(phone.written);
    expect(desktop.records).toEqual(phone.records);
    expectEach(row, desktop);
    expectEach(row, phone);
    return;
  }
  if (row.byDesign === true) {
    // Both pages ran an operation one of them is meant to lack.
    broken(row, new Error(`${row.name}: both pages have the operation now`));
    return;
  }
  if (
    !isDeepStrictEqual(desktop.written, phone.written) ||
    !isDeepStrictEqual(desktop.records, phone.records)
  ) {
    throw new PagesDisagree(`${row.name}: the pages wrote different tours`);
  }
}

describe("the parity contract: the phone's and the desktop's paths write the same tour and the same draft (D30)", () => {
  for (const row of ROWS) {
    const test = row.diverges === undefined ? it : it.fails;
    const name =
      row.diverges === undefined
        ? row.name
        : `${row.name} [DIVERGES until: ${row.diverges}]`;
    test(name, () => samePages(row), 60_000);
  }
});

describe("the parity contract: an earlier file carrying debug camera captures", () => {
  // Why this row matters: a file written while the walk's frames were
  // baked into the tour carries them as captureSpots, one frame in a
  // station of the tour and one in an automatic walk-1 station only it
  // kept. The field is gone from the format, so both pages open the same
  // document from it (the field ignored, walk-1 an empty station like any
  // other), an edit and a save on either writes the same tour, and
  // neither writes the field.
  // (Changed expectation: both pages once dropped walk-1 with the frames.
  // Without the field nothing names it, and no tour was published with it,
  // D5/D43.)
  const fileJson = JSON.parse(serializeTourManifest(tourOf(OPENED))) as {
    stations: unknown[];
  };
  const withCaptures: TourManifest = parseTourManifest({
    ...fileJson,
    stations: [
      ...fileJson.stations,
      {
        id: "walk-1",
        geo: { lat: 48.53, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        ...stationContent([]),
      },
    ],
    captureSpots: {
      fixes: 3,
      gpsAccuracyMedianM: 4,
      captures: [
        {
          image: "images/frame-0.jpg",
          station: tourOf(OPENED).stations[0]!.id,
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        },
        {
          image: "images/frame-1.jpg",
          station: "walk-1",
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        },
      ],
    },
  });

  it("both pages write the same tour, walk-1 kept as a station and without the field", async () => {
    const file = await tourFile();
    const written = await Promise.all(
      [desktopPage, phonePage].map(async (page) => {
        const p = await page(
          file,
          memoryDraftStores().open,
          false,
          withCaptures,
        );
        await p.edit("a", "The gate");
        return p.save();
      }),
    );
    const [desktop, phone] = written;
    // (Changed expectation, Q-I: compared with the tour id each page
    // minted named alike, as every other row compares.)
    expect(withStationsByOrder(desktop!)).toEqual(withStationsByOrder(phone!));
    for (const w of written) {
      expect(w !== undefined && "captureSpots" in w).toBe(false);
      expect(w?.stations.map((st) => st.id)).toEqual([
        ...tourOf(OPENED).stations.map((st) => st.id),
        "walk-1",
      ]);
    }
  }, 60_000);
});

describe("the parity contract: a save keeps the tour's level files as they are (plan M3b)", () => {
  // Why this test matters: a level file is a printed code's measured pose.
  // The phone's Finish writes one only when this page changed that code
  // (`codesToWrite`); the desktop measures no code and writes none. A save
  // that wrote one again would change bytes a diff or a later check
  // reads, and one that dropped it would strand the printed code. So after
  // an edit, both pages' saves hand each `qr/*.json` back byte for byte.
  // The text is not in `JSON.stringify`'s own form, so a file written
  // again from the parsed level shows.
  const LEVEL =
    '{ "version": 1,\n  "qr": { "text": "https://example.invalid/?qr=q1",' +
    ' "physicalSizeM": 0.16,\n    "geo": { "lat": 48.52, "lon": 9.05,' +
    ' "alt": 340, "rotation": [0, 0, 0, 1] } } }\n';

  async function fileWithLevel(): Promise<File> {
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(tourOf(OPENED)) },
      { path: "content/f.jpg", data: "f" },
      { path: "qr/q1.json", data: LEVEL },
    ]);
    return new File([zip], "tour.zip", { type: "application/zip" });
  }

  it("the desktop's download and the phone's Finish keep qr/q1.json byte for byte", async () => {
    const file = await fileWithLevel();
    const desktop = await desktopPage(file, memoryDraftStores().open);
    await desktop.edit("a", "The gate");
    const downloaded = (await desktop.download()).file;
    const phone = await phonePage(file, memoryDraftStores().open);
    await phone.edit("a", "The gate");
    await phone.save();
    for (const [page, saved] of [
      ["desktop", downloaded],
      ["phone", phone.lastFinished()],
    ] as const) {
      const reopened = await openTourFile(saved);
      expect(await reopened.loadEntryText("qr/q1.json"), page).toBe(LEVEL);
    }
  }, 60_000);
});

describe("a draft of a file-opened tour across saves", () => {
  // The marker came off (debug-captures plan, Q-I): the tour carries its
  // own id from its first save, a file is keyed by it, and the save that
  // wrote it took the draft to that key once - on the phone at the
  // Finish's delivered save, on the desktop at a download that arrived -
  // leaving the opened file's draft as it was.
  it("a phone draft of a file-opened tour stays reachable across two Finishes", async () => {
    // Why this test matters: a tour opened from a FILE is known by a key
    // taken from its content (`tour-file-key.ts`), and the draft is kept
    // under it. A finished tour without a walk holds only what the tour
    // kit writes, so that key hashes its tour.json - and every Finish
    // writes a new one. The file a creator opens next is the one the last
    // Finish made; an edit made after that Finish must be offered there,
    // or it is lost with the page.
    const stores = memoryDraftStores().open;
    const page = await phonePage(await tourFile(), stores);
    await page.edit("a", "Before the first Finish");
    await page.save();
    await page.edit("b", "Before the second Finish");
    const written = await page.save();
    await page.edit("a", "After the second Finish");
    const next = await phonePage(page.lastFinished(), stores, true, written);
    expect(next.objects().find((o) => o.id === "a")).toMatchObject({
      caption: "After the second Finish",
    });
  }, 60_000);

  it("says the phone keeps no backup when the draft could not follow the saved file", async () => {
    // Why (r901 review #7): the file a Finish saved opens under the tour's
    // own id, so the draft moves to that key. A move that did not land
    // leaves the saved file without the draft it should offer: the page
    // must say it keeps no backup rather than promise one (the opened
    // file's draft stays as it was, so it still offers its edits).
    const stores = memoryDraftStores().open;
    const refusingTheIdKey = (key: string) =>
      key.includes(":tour:") ? Promise.resolve(undefined) : stores(key);
    const page = await phonePage(await tourFile(), refusingTheIdKey);
    await page.edit("a", "Before the Finish");
    expect(page.placementNote() ?? "").not.toContain("backup");
    await page.save();
    await vi.waitFor(() => {
      expect(page.placementNote()).toContain(
        "This device is not saving a backup copy",
      );
    });
  }, 60_000);

  it("how: every Finish's file is known by the tour's own id, the draft followed it there once, and its open offers the edit", async () => {
    // Why (debug-captures M1, then Q-I): the row above says only that the
    // edit is offered; this one pins WHY, plainly, so a change of the
    // mechanism is seen here. (Changed expectation: it pinned the old
    // mechanism - the second Finish's file under another key, nothing
    // offered - which the tour's own id replaced.) The opened file has no
    // id, so it keeps its content key; the files both Finishes made carry
    // the one id its open minted; the draft followed the first of them.
    const stores = memoryDraftStores().open;
    const file = await tourFile();
    const page = await phonePage(file, stores);
    const openedKey = page.draftKey();
    expect(openedKey).toBe(await tourFileKeyOfFile(file));
    await page.edit("a", "Before the first Finish");
    const first = await page.save();
    const firstKey = await tourFileKeyOfFile(page.lastFinished());
    expect(first.tourId).toMatch(/^[0-9a-f]{32}$/);
    expect(firstKey).toBe(`local-file:tour:${first.tourId!}`);
    await page.edit("b", "Before the second Finish");
    const written = await page.save();
    expect(written.tourId).toBe(first.tourId);
    await page.edit("a", "After the second Finish");
    const finished = page.lastFinished();
    expect(await tourFileKeyOfFile(finished)).toBe(firstKey);
    expect(page.draftKey()).toBe(firstKey);
    const next = await phonePage(finished, stores, false, written);
    expect(next.draftKey()).toBe(firstKey);
    expect(next.offer()).not.toBe("");
    // A saved file is not known to be put anywhere, so the opened file's
    // draft keeps what it held: opened again, it still offers its edits.
    const before = await phonePage(file, stores, false);
    expect(before.offer()).not.toBe("");
  }, 60_000);

  it("a desktop draft of a file-opened tour follows its downloads the same way", async () => {
    // Why (Q-I): the desktop saves a tour it cannot write in place as a
    // download. Its first one writes the tour's id, so the file it made
    // opens under the id's key; an edit made after it must be offered
    // there, as on the phone.
    const stores = memoryDraftStores().open;
    const page = await desktopPage(await tourFile(), stores);
    await page.edit("a", "Before the first download");
    await page.download();
    await page.edit("b", "Before the second download");
    const second = await page.download();
    await page.edit("a", "After the second download");
    const next = await desktopPage(second.file, stores, true, second.written);
    expect(next.objects().find((o) => o.id === "a")).toMatchObject({
      caption: "After the second download",
    });
  }, 60_000);
});
