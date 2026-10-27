/**
 * Why these tests matter (M6 E2a): the desktop editor's edits are what a
 * Save writes. Each must reach the saved zip exactly as the phone's Finish
 * would write it - by the shared rules (`object-edits.ts`,
 * `finish-rebuild.ts`) - and an edit made while a save runs must wait for
 * the next one rather than vanish. A second save starts from the first's
 * bytes (a deleted photo's file stays gone, a placed one's stays). Real
 * zips, read back with the viewer's opener.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  packFilesAsZip,
  rebuildZipWithEntries,
} from "gps-plus-slam-app-framework/storage";
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
  type TourPicture,
  type TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  openTourFile,
  tourFileKeyOfFile,
  type TourSession,
} from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { selectTourDocument, tourDocumentActions } from "../tour-document.js";
import {
  copyFileName,
  createEditorSession,
  datedFileName,
  NOT_IN_TOUR,
  TOO_FAR_FROM_STATION,
  type EditorSession,
  type EditorSessionDraft,
} from "./editor-session.js";
import { buildListedTourFixture } from "../test-support/tour-signing-fixture.js";
import {
  SAMPLE_PHOTOS,
  sampleRecordingBytes,
} from "../test-support/sample-recording.js";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import type { DetailsForm } from "../tour-details-form.js";
import { TOUR_TITLE_MAX_CHARS } from "gps-plus-slam-app-framework/ar/tour-details";
import { createEditorDraft, type EditorTourSettings } from "./editor-draft.js";
import type { EditorLock } from "./save-target.js";
import {
  captionOf,
  inOwnStation,
  stationIdOf,
  tourOf,
  withWorldObjects,
} from "../test-support/tour-of.js";
import type { EditorModel } from "./editor-model.js";
import { openTourForEditing } from "./editor-open.js";
import { bundleMatchesTour, readDebugBundle } from "../debug-bundle.js";

beforeAll(() => {
  createTourViewerStore();
});

function pin(id: string, label = `pin ${id}`): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: label,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function photo(id: string): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    imageAsset: {
      id: id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

/** The model's notes and codes: what the rail lists besides the stations
 *  every version 3 note sits in (one each here, `tourOf`). */
function noteIds(model: EditorModel): string[] {
  return model.items.filter((i) => i.kind !== "station").map((i) => i.id);
}

async function opened(
  objects: readonly TourObject[],
  extra: Partial<TourManifest> = {},
): Promise<{
  session: TourSession;
  manifest: TourManifest;
}> {
  const manifest = tourOf(objects, extra);
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
    ...objects
      .filter((o) => o.kind === "picture")
      .map((o) => ({ path: `content/${o.id}.jpg`, data: o.id })),
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  return { session, manifest };
}

async function carried(
  blob: Blob,
): Promise<ReturnType<typeof withWorldObjects>> {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    "tour.json",
  );
  return withWorldObjects(
    parseTourManifest(JSON.parse(new TextDecoder().decode(bytes))),
  );
}

/** The saved `tour.json` as written, before any parse fills defaults. */
async function writtenJson(blob: Blob): Promise<Record<string, unknown>> {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    "tour.json",
  );
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

describe("createEditorSession", () => {
  it("edits a pin's text, moves a note and deletes one, and the save carries all three", async () => {
    const { session, manifest } = await opened([
      pin("a", "Old"),
      pin("b"),
      photo("c"),
    ]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.editText("a", "New")).toEqual({ kind: "edited" });
    editor.move("b", 48.53, 9.06);
    editor.remove("c");
    expect(editor.changeCount()).toBe(3);
    const saved = await editor.save({ keepScan: false });
    const tour = await carried(saved.blob);
    expect(tour.objects.map((o) => o.id)).toEqual(["a", "b"]);
    expect(tour.objects[0]).toMatchObject({ caption: "New" });
    // Re-expressed in its station's frame and read back: float32 geodesy.
    expect(tour.objects[1]?.geo.lat).toBeCloseTo(48.53, 7);
    expect(tour.objects[1]?.geo.lon).toBeCloseTo(9.06, 7);
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  // Why (B2c): a block's other text fields (a short text's description
  // here) are edited through the same tour document as its caption: one
  // undo step each, counted as a change, written by the save; a text
  // over its cap is refused in words and changes nothing.
  it("edits a short text's description as one step, saved, undone, and refuses one over its cap", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.editBlockField("a", "description", "Under the arch")).toEqual(
      { kind: "edited" },
    );
    expect(editor.changeCount()).toBe(1);
    expect(editor.editBlockField("a", "description", "x".repeat(161))).toEqual({
      kind: "refused",
      reason: "A description takes at most 160 characters.",
    });
    expect(editor.editBlockField("nope", "description", "x")).toMatchObject({
      kind: "refused",
    });
    const saved = await editor.save({ keepScan: false });
    expect((await carried(saved.blob)).objects[0]).toMatchObject({
      caption: "Old",
      description: "Under the arch",
    });
    editor.editBlockField("a", "description", "Changed");
    editor.undo();
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("refuses an empty pin with the phone's sentence and changes nothing", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.editText("a", "  ")).toEqual({
      kind: "refused",
      reason: "A pin needs some text - it was left as it was.",
    });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("undoes a delete, back in its place", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.remove("a");
    expect(noteIds(editor.model())).toEqual(["b"]);
    editor.undo();
    expect(noteIds(editor.model())).toEqual(["a", "b"]);
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("keeps an edit made while a save runs for the next save", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "First");
    const running = editor.save({ keepScan: false });
    editor.editText("b", "During the save");
    const first = await running;
    expect((await carried(first.blob)).objects[1]).toMatchObject({
      caption: "pin b",
    });
    expect(editor.changeCount()).toBe(1);
    const second = await editor.save({ keepScan: false });
    const tour = await carried(second.blob);
    expect(tour.objects.map((o) => captionOf(o))).toEqual([
      "First",
      "During the save",
    ]);
    await session.close();
  });

  it("names the saved file after the opened one", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "x");
    // The page names the debug data's file after it before any save ran (the
    // r875 milestone review #6: the page reads the name here, not through
    // the Finish's rule it may not import), so it must be the save's own.
    expect(editor.savedName()).toBe("tour.zip");
    expect((await editor.save({ keepScan: false })).filename).toBe(
      editor.savedName(),
    );
    await session.close();
  });
});

describe("createEditorSession, Save a copy", () => {
  // Why: "Save a copy…" writes the tour as it stands into a file of its
  // own, and the tour's own file stays where it was: the edits are still
  // waiting for the tour's own save, the next save still rebuilds from the
  // last bytes the tour's file got, and an undo still undoes them.
  it("carries every edit, and leaves the edits pending for the tour's own save", async () => {
    const { session, manifest } = await opened([pin("a", "Old"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "New");
    editor.remove("b");
    const copy = await editor.saveCopy({ keepScan: false });
    // Named apart from the tour's own file, so the copy is never taken
    // for it (a download beside it, a save dialog's suggestion).
    expect(editor.savedName()).toBe("tour.zip");
    expect(copy.filename).toBe("tour copy.zip");
    const tour = await carried(copy.blob);
    expect(tour.objects.map((o) => o.id)).toEqual(["a"]);
    expect(tour.objects[0]).toMatchObject({ caption: "New" });
    expect(editor.changeCount()).toBe(2);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    const saved = await editor.save({ keepScan: false });
    expect((await carried(saved.blob)).objects.map((o) => o.id)).toEqual([
      "a",
      "b",
    ]);
    await session.close();
  });

  it("names a copy apart: ' copy' before the .zip, any case", () => {
    expect(copyFileName("tour.zip")).toBe("tour copy.zip");
    expect(copyFileName("Old Town.ZIP")).toBe("Old Town copy.ZIP");
    // A ".zip" that is not the end is part of the name.
    expect(copyFileName("a.zip.bak")).toBe("a.zip.bak copy");
    expect(copyFileName("xzip")).toBe("xzip copy");
    expect(copyFileName("")).toBe(" copy");
  });

  // Why: a tour opened from a link or the sample asks where to save it,
  // and the dialog suggests this name. Were it the same at every open,
  // reopening the same link and pressing Enter, then Replace, would write
  // the original tour over the file holding the edited one.
  it("dates the name a tour opened from a link or the sample suggests, in local time", () => {
    const now = new Date(2026, 9, 7, 9, 5, 59);
    expect(datedFileName("tour-1AbCdEfGhIjK.zip", now)).toBe(
      "tour-1AbCdEfGhIjK-2026-10-07-090559.zip",
    );
    expect(datedFileName("Old Town.ZIP", now)).toBe(
      "Old Town-2026-10-07-090559.ZIP",
    );
    expect(datedFileName("a.zip.bak", now)).toBe("a.zip.bak-2026-10-07-090559");
    expect(datedFileName("sample.zip", new Date(2026, 11, 31, 23, 59, 7))).toBe(
      "sample-2026-12-31-235907.zip",
    );
  });

  it("waits for a save that runs, and copies what it saved too", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "Saved");
    const running = editor.save({ keepScan: false });
    editor.editText("b", "Only in the copy");
    const copy = editor.saveCopy({ keepScan: false });
    await running;
    const labels = (await carried((await copy).blob)).objects.map((o) =>
      captionOf(o),
    );
    expect(labels).toEqual(["Saved", "Only in the copy"]);
    // The save's landing stands; the edit made after it still waits.
    expect(editor.changeCount()).toBe(1);
    await session.close();
  });
});

describe("createEditorSession, the review's cases (E0c + E2a review #9, #10, #12)", () => {
  it("counts a text edited back to the tour's own as no change", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "New");
    expect(editor.changeCount()).toBe(1);
    editor.editText("a", "Old");
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("runs two saves one after the other, the second carrying both edits", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "One");
    const first = editor.save({ keepScan: false });
    editor.editText("b", "Two");
    const second = editor.save({ keepScan: false });
    await first;
    const tour = await carried((await second).blob);
    expect(tour.objects.map((o) => captionOf(o))).toEqual(["One", "Two"]);
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  // Why (W2 of the tour editor plan, replacing E2a review #9's refusal):
  // an undo after the save that wrote the delete used to be refused, so
  // autosave had to wait out the Undo. It now brings the note back as a
  // change of its own, which the next save writes.
  it("brings a delete back after a save wrote it, as a change the next save writes", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.remove("a");
    await editor.save({ keepScan: false });
    expect(editor.undo().kind).toBe("undone");
    expect(noteIds(editor.model()).sort()).toEqual(["a", "b"]);
    expect(editor.changeCount()).toBe(1);
    const tour = await carried((await editor.save({ keepScan: false })).blob);
    expect(tour.objects.map((o) => o.id).sort()).toEqual(["a", "b"]);
    await session.close();
  });

  // Why (E2b plan review #2, DEC-A3; the third E2p review #6): a delete
  // made while a save runs is not that save's, and an undo while a save
  // runs would race the save's end over what the file carries - so it is
  // refused in words, and works once the save has ended, whichever save
  // wrote the delete.
  it("refuses an undo while a save runs, and undoes the delete once it ended", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("b", "First");
    const running = editor.save({ keepScan: false });
    editor.remove("a");
    expect(editor.undo().kind).toBe("refused");
    await running;
    expect(editor.undo().kind).toBe("undone");
    expect(noteIds(editor.model())).toEqual(["a", "b"]);
    editor.remove("a");
    const writing = editor.save({ keepScan: false });
    expect(editor.undo().kind).toBe("refused");
    const tour = await carried((await writing).blob);
    expect(tour.objects.map((o) => o.id)).toEqual(["b"]);
    expect(editor.undo().kind).toBe("undone");
    expect(noteIds(editor.model()).sort()).toEqual(["a", "b"]);
    await session.close();
  });

  it("keeps a deleted photo's file gone across two saves", async () => {
    // Why: the second save rebuilds from the first one's bytes; from the
    // opened zip again, the deleted photo's file would come back.
    const { session, manifest } = await opened([photo("p"), pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.remove("p");
    await editor.save({ keepScan: false });
    editor.editText("a", "later");
    const second = await editor.save({ keepScan: false });
    const names = readStoredCentralDirectory(
      new Uint8Array(await second.blob.arrayBuffer()),
    ).map((e) => e.name);
    expect(names).not.toContain("content/p.jpg");
    await session.close();
  });

  it("names the pending notes, for the page's moved lines", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.move("a", 48.53, 9.06);
    expect(editor.pendingIds()).toEqual(["a"]);
    await editor.save({ keepScan: false });
    expect(editor.pendingIds()).toEqual([]);
    await session.close();
  });
});

/** Draft writes that log their calls (the editor's draft is
 *  `editor-draft.test.ts`'s; here only what the session asks of it). */
function loggedDraft(): EditorSessionDraft & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    saveSettings: (settings) => {
      calls.push(`settings needsNoGps=${String(settings.needsNoGps)}`);
      return Promise.resolve(true);
    },
    saveObject: (object) => {
      calls.push(
        `save ${object.id}${object.kind === "shortText" ? ` ${object.caption}` : ""}`,
      );
      return Promise.resolve(true);
    },
    saveDeletion: (id) => {
      calls.push(`tombstone ${id}`);
      return Promise.resolve(true);
    },
    forgetDeletion: (id) => {
      calls.push(`untombstone ${id}`);
      return Promise.resolve(true);
    },
    forgetObject: (id) => {
      calls.push(`forget ${id}`);
      return Promise.resolve();
    },
  };
}

/** One browser's draft directories, in memory, with the OPFS store's
 *  contract (`editor-draft.test.ts` has the fuller one, with faults). */
function memoryDraftStores(): {
  open: (key: string) => Promise<DraftFileStore | undefined>;
} {
  const spaces = new Map<string, Map<string, Blob | string>>();
  return {
    open: (key) => {
      const files = spaces.get(key) ?? new Map<string, Blob | string>();
      spaces.set(key, files);
      return Promise.resolve({
        put: (k, data) => {
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
      });
    },
  };
}

/** Every lock granted: one tab. */
function freeLocks(): Promise<EditorLock> {
  return Promise.resolve({
    granted: true,
    release: () => undefined,
    released: Promise.resolve(),
  });
}

const K = "local-file:00000000000000000000000000000001";

describe("createEditorSession, the draft (M6 E2c)", () => {
  // Why: the draft is only as good as the session's calls into it - an
  // edit not backed up is lost with the tab, and an undo of a delete of
  // an EDITED note must write its record again, or the edit is gone from
  // the draft while it stays on screen (E2c plan review #11).
  it("backs every edit, move, delete and undo up, the undo of an edited note's delete writing its record again", async () => {
    const { session, manifest } = await opened([pin("a", "Old"), pin("b")]);
    const draft = loggedDraft();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft,
    });
    editor.editText("a", "New");
    editor.move("b", 48.53, 9.06);
    editor.remove("a");
    expect(editor.undo().kind).toBe("undone");
    expect(draft.calls).toEqual([
      "save a New",
      "save b pin b",
      // About 1.3 km away the move starts a station of its own, whose
      // frame the settings record keeps (a reload brings it back).
      "settings needsNoGps=false",
      "tombstone a",
      "save a New",
      "untombstone a",
    ]);
    // An unchanged text and a refused one write nothing.
    editor.editText("a", "New");
    editor.editText("a", " ");
    expect(draft.calls).toHaveLength(6);
    await session.close();
  });

  // Why (E2c plan review #7, #11): Restore puts the draft's work back by
  // the session's own rules; live edits made while the offer stood are
  // newer and win; an id the file no longer carries cannot be edited
  // (the editor places nothing new); and what was applied is written
  // back, so it is backed up as this page's work.
  it("restores a draft's changes and deletions, live work winning, unknown ids skipped", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b"), pin("c")]);
    const draft = loggedDraft();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft,
    });
    editor.editText("b", "live");
    draft.calls.length = 0;
    const applied = editor.restore({
      objects: [pin("a", "restored"), pin("b", "old draft"), pin("x")],
      deleted: ["c", "gone"],
    });
    expect(applied).toEqual({ changed: 1, deleted: 1 });
    expect(draft.calls).toEqual(["save a restored", "tombstone c"]);
    const labels = editor
      .model()
      .items.filter((i) => i.kind === "pin")
      .map((i) => i.title);
    expect(labels).toEqual(["restored", "live"]);
    expect(editor.changeCount()).toBe(3);
    const saved = await editor.save({ keepScan: false });
    expect(withWorldObjects(saved.written).objects.map((o) => o.id)).toEqual([
      "a",
      "b",
    ]);
    await session.close();
  });

  // Why (E2c plan review #5): the draft's key moves with an in-place
  // save to the key of the bytes written, and must be the key a later
  // open of that file gives - computed the open's own way, without a
  // session over the bytes.
  it("keys a saved zip as opening it would", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "Saved");
    const saved = await editor.save({ keepScan: false });
    const file = new File([saved.blob], "tour.zip", {
      type: "application/zip",
    });
    const reopened = await openTourFile(file);
    expect(await tourFileKeyOfFile(file)).toBe(reopened.archive.url);
    // A tour of notes alone: its key changed with the save.
    expect(reopened.archive.url).not.toBe(session.archive.url);
    await reopened.close();
    await session.close();
  });

  // Why (E2c plan review #11, decided here): a card can outlive its
  // object (a restore's deletion, a save), and an edit of an id the tour
  // no longer carries threw. It is refused in words and changes nothing.
  it("refuses an edit, a move and a delete of an id the tour no longer carries", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const draft = loggedDraft();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft,
    });
    expect(editor.editText("zzz", "x")).toEqual({
      kind: "refused",
      reason: NOT_IN_TOUR,
    });
    // Said in the same words as an edit (PR #622 bot finding C): the
    // page must not toast "Deleted" with an Undo, or drop a move silently.
    expect(editor.move("zzz", 48.5, 9.0)).toEqual({
      kind: "refused",
      reason: NOT_IN_TOUR,
    });
    expect(editor.remove("zzz")).toEqual({
      kind: "refused",
      reason: NOT_IN_TOUR,
    });
    expect(editor.changeCount()).toBe(0);
    expect(draft.calls).toEqual([]);
    await session.close();
  });

  // Why: the format refuses an item more than 10 km from its station, and
  // a far drag on the 2D map once made every later save fail with the
  // parser's technical message. A move out of its station's found radius
  // now re-runs the station rule, so the note lands in a station at its
  // new spot - never far from its station, however far it went - and the
  // station it left, now empty, goes with the same step.
  it("seats a note moved far beyond its station in a station at its new spot, and saving works", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    // About 22 km north of its station: beyond the format's 10 km bound.
    expect(editor.move("a", 48.72, 9.05)).toEqual({ kind: "moved" });
    expect(editor.changeCount()).toBe(1);
    const saved = await carried((await editor.save({ keepScan: false })).blob);
    const a = saved.objects.find((o) => o.id === "a");
    expect(a?.geo.lat).toBeCloseTo(48.72, 6);
    expect(a?.station).not.toBe(stationIdOf("a"));
    const stations = saved.stations;
    const home = stations.find((s) => s.id === a?.station);
    expect(home?.geo.lat).toBeCloseTo(48.72, 6);
    expect(stations.map((s) => s.id)).not.toContain(stationIdOf("a"));
    // The undo takes the note back into its old station.
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    await session.close();
  });

  // Why: a station's found radius has no upper bound, and a move inside
  // a huge one but beyond the format's 10 km reach changed nothing while
  // the page was told the note had moved. A move reported as made must be
  // one the document took, and one every later save can write.
  it("a move reported as made is applied: inside a huge radius but beyond the format's reach, the note is re-seated and saving works", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const huge = {
      ...manifest,
      stations: manifest.stations.map((s) => ({
        ...s,
        activateRadiusM: 50_000,
        foundRadiusM: 50_000,
      })),
    };
    const editor = createEditorSession({
      session,
      manifest: huge,
      levels: new Map(),
    });
    expect(editor.move("a", 48.72, 9.05)).toEqual({ kind: "moved" });
    expect(editor.changeCount()).toBe(1);
    const saved = await carried((await editor.save({ keepScan: false })).blob);
    const a = saved.objects.find((o) => o.id === "a");
    expect(a?.geo.lat).toBeCloseTo(48.72, 6);
    expect(a?.station).not.toBe(stationIdOf("a"));
    await session.close();
  });

  // Why: a draft written before far moves re-ran the station rule can
  // still hold a note its station cannot carry; restoring it as it was
  // would make every save fail, and skipping it would lose the work. It is
  // restored, seated by the rule where it stands.
  it("restores a draft's note its station cannot carry into a station of the rule's", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const far = {
      ...inOwnStation(pin("a", "far")),
      geo: { ...pin("a").geo, lat: 48.72 },
    };
    const near = inOwnStation(pin("b", "near"));
    expect(editor.restore({ objects: [far, near], deleted: [] })).toEqual({
      changed: 2,
      deleted: 0,
    });
    const saved = await carried((await editor.save({ keepScan: false })).blob);
    expect(
      saved.objects
        .map((o) => [o.id, "caption" in o ? o.caption : "", o.station])
        .sort(),
    ).toEqual([
      ["a", "far", expect.not.stringMatching(`^${stationIdOf("a")}$`)],
      ["b", "near", stationIdOf("b")],
    ]);
    expect(saved.objects.find((o) => o.id === "a")?.geo.lat).toBeCloseTo(
      48.72,
      6,
    );
    await session.close();
  });
});

describe("createEditorSession, the tour's needs-no-GPS setting (QR-first M1b-2)", () => {
  // Why (owner Q-QF-1): "needs no GPS" is a tour-level edit like any
  // other - it is a pending change until a save writes it, the saved
  // tour.json carries `needsNoGps: true` (version 3, minor 0 since the
  // tour editor plan's W3), and turning it off writes the tour exactly as
  // before (no field at all, false is never written).
  it("writes needsNoGps: true when on, and leaves the field out when off", async () => {
    const { session, manifest } = await opened([pin("a")], { title: "T" });
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.needsNoGps()).toBe(false);
    expect(editor.setNeedsNoGps(true)).toEqual({ kind: "changed" });
    expect(editor.needsNoGps()).toBe(true);
    expect(editor.changeCount()).toBe(1);
    const on = await editor.save({ keepScan: false });
    expect(await writtenJson(on.blob)).toMatchObject({
      version: 4,
      minor: 0,
      needsNoGps: true,
    });
    expect(on.written.needsNoGps).toBe(true);
    expect(editor.changeCount()).toBe(0);
    expect(editor.setNeedsNoGps(false)).toEqual({ kind: "changed" });
    expect(editor.changeCount()).toBe(1);
    const off = await editor.save({ keepScan: false });
    const json = await writtenJson(off.blob);
    expect(json).not.toHaveProperty("needsNoGps");
    expect(json).toMatchObject({ version: 4, minor: 0 });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("a toggle back to the file's own value is no change", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.setNeedsNoGps(false)).toEqual({ kind: "unchanged" });
    editor.setNeedsNoGps(true);
    editor.setNeedsNoGps(false);
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("a flagged tour opens with the setting on and keeps it through a save of another edit", async () => {
    const { session, manifest } = await opened([pin("a")], {
      needsNoGps: true,
    });
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.needsNoGps()).toBe(true);
    editor.editText("a", "edited");
    const saved = await editor.save({ keepScan: false });
    expect(await writtenJson(saved.blob)).toMatchObject({
      version: 4,
      minor: 0,
      needsNoGps: true,
    });
    await session.close();
  });

  it("a toggle made while a save runs waits for the next save", async () => {
    // Why (E2a review #9's rule, for the setting): the save snapshots
    // before its first await; a change after that is the next save's,
    // never lost and never half in this one.
    const { session, manifest } = await opened([pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "first");
    const running = editor.save({ keepScan: false });
    editor.setNeedsNoGps(true);
    const first = await running;
    expect(await writtenJson(first.blob)).not.toHaveProperty("needsNoGps");
    expect(editor.changeCount()).toBe(1);
    const second = await editor.save({ keepScan: false });
    expect(await writtenJson(second.blob)).toMatchObject({ needsNoGps: true });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("backs each change of the setting up, and an unchanged one writes nothing", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const draft = loggedDraft();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft,
    });
    editor.setNeedsNoGps(true);
    editor.setNeedsNoGps(true);
    editor.setNeedsNoGps(false);
    expect(draft.calls).toEqual([
      "settings needsNoGps=true",
      "settings needsNoGps=false",
    ]);
    await session.close();
  });

  it("restores a draft's setting unless it was changed here meanwhile", async () => {
    // Why (E2c's "live work wins"): the offer is older than anything the
    // creator did since the open.
    const restoring = await opened([pin("a")]);
    const draft = loggedDraft();
    const editor = createEditorSession({
      ...restoring,
      levels: new Map(),
      draft,
    });
    expect(
      editor.restore({
        objects: [],
        deleted: [],
        settings: { needsNoGps: true },
      }),
    ).toEqual({ changed: 1, deleted: 0 });
    expect(editor.needsNoGps()).toBe(true);
    expect(editor.changeCount()).toBe(1);
    expect(draft.calls).toEqual(["settings needsNoGps=true"]);
    await restoring.session.close();

    const live = await opened([pin("a")]);
    const mine = createEditorSession({ ...live, levels: new Map() });
    mine.setNeedsNoGps(true);
    mine.setNeedsNoGps(false);
    expect(
      mine.restore({
        objects: [],
        deleted: [],
        settings: { needsNoGps: true },
      }),
    ).toEqual({ changed: 0, deleted: 0 });
    expect(mine.needsNoGps()).toBe(false);
    await live.session.close();
  });

  it("checks the open tour's stations and codes for the setting's warnings", async () => {
    const { session, manifest } = await opened([], {
      stations: [
        {
          id: "s1",
          title: "The column",
          geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
          blocks: [
            {
              id: "hi-text",
              kind: "shortText",
              view: "card",
              caption: "Hello",
              pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            },
          ],
          activateRadiusM: 30,
          foundRadiusM: 5,
          hint: "arrow",
          steps: [
            {
              id: "hi",
              action: { kind: "show", block: "hi-text" },
              advance: { mode: "tap" },
            },
          ],
        },
      ],
    });
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map([
        [
          "c",
          {
            version: 1,
            qr: {
              physicalSizeM: 0.2,
              geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
            },
          },
        ],
      ]),
    });
    // The station stands on the code: near enough (review 2 #3).
    expect(editor.noGpsCheck()).toEqual({
      farFromCodes: [],
      codesPlace: true,
    });
    await session.close();
  });
});

/**
 * Why (tour editor plan 2026-10-17-1816, W2): the tour's name,
 * description, cover and contact are edited in the editor's "Tour
 * details" dialog. Each must be a pending change like a note's (counted,
 * backed up by the draft, saved by itself), reach `tour.json` by the
 * format's rules (minor 3), be refused in plain words when the format
 * would drop it, and an emptied field must REMOVE the detail - never keep
 * the old one silently. A cover follows its photo: deleting the photo
 * takes the cover with it, and undoing that brings it back.
 */
describe("createEditorSession, the tour details (W2)", () => {
  const form = (over: Partial<DetailsForm> = {}): DetailsForm => ({
    name: "",
    description: "",
    cover: null,
    contact: "",
    ...over,
  });

  it("writes the name, description, cover and contact into the saved tour, each a change until then", async () => {
    const { session, manifest } = await opened([pin("a"), photo("f")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.details()).toEqual(form());
    expect(
      editor.setDetails({
        name: "  The castle ",
        description: "Up and back.",
        cover: "f",
        contact: "guide@example.org",
      }),
    ).toEqual({ kind: "changed" });
    expect(editor.changeCount()).toBe(4);
    expect(editor.details()).toEqual({
      name: "The castle",
      description: "Up and back.",
      cover: "f",
      contact: "guide@example.org",
    });
    const saved = await editor.save({ keepScan: false });
    expect(await writtenJson(saved.blob)).toMatchObject({
      version: 4,
      minor: 0,
      title: "The castle",
      description: "Up and back.",
      cover: "f",
      contact: "guide@example.org",
    });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("an emptied field removes the detail; the same values are no change", async () => {
    const { session, manifest } = await opened([photo("f")], {
      title: "Old",
      description: "Old words.",
      cover: "f",
      contact: "https://example.org",
    });
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.setDetails(editor.details())).toEqual({ kind: "unchanged" });
    expect(editor.setDetails(form())).toEqual({ kind: "changed" });
    const saved = await editor.save({ keepScan: false });
    const json = await writtenJson(saved.blob);
    for (const field of ["title", "description", "cover", "contact"]) {
      expect(json, field).not.toHaveProperty(field);
    }
    await session.close();
  });

  it("refuses what the format would drop, in plain words, and changes nothing", async () => {
    const { session, manifest } = await opened([pin("a"), photo("f")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const refusals = [
      form({ contact: "call me" }),
      form({ contact: "javascript:alert(1)" }),
      form({ description: "x".repeat(2001) }),
      form({ name: "x".repeat(TOUR_TITLE_MAX_CHARS + 1) }),
      form({ cover: "a" }),
      form({ cover: "gone" }),
    ];
    for (const bad of refusals) {
      const outcome = editor.setDetails(bad);
      expect(outcome.kind, JSON.stringify(bad).slice(0, 60)).toBe("refused");
      // Plain words, never the format's field names in quotes.
      expect(outcome.kind === "refused" ? outcome.reason : "").not.toMatch(
        /"(contact|description|cover)"/,
      );
    }
    expect(editor.changeCount()).toBe(0);
    expect(editor.details()).toEqual(form());
    await session.close();
  });

  it("offers the placed photos as covers, never a pin or a recorded photo", async () => {
    const { session, manifest } = await opened([
      pin("a"),
      photo("f"),
      photo("g"),
    ]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.coverChoices().map((c) => c.id)).toEqual(["f", "g"]);
    expect(editor.coverChoices()[0]).toMatchObject({
      id: "f",
      image: "content/f.jpg",
    });
    await session.close();
  });

  it("the cover goes with its photo, and no change lingers after the save", async () => {
    const { session, manifest } = await opened([photo("f"), photo("g")], {
      cover: "f",
    });
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.details().cover).toBe("f");
    editor.remove("f");
    expect(editor.details().cover).toBeNull();
    expect(editor.coverChoices().map((c) => c.id)).toEqual(["g"]);
    const saved = await editor.save({ keepScan: false });
    expect(await writtenJson(saved.blob)).not.toHaveProperty("cover");
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("an undo across a save brings back a cover image only the cover named", async () => {
    // Why: a write drops the assets nothing names (`withReferencedAssets`)
    // and the rebuild removes their files. A cover image no step uses is
    // named by the cover alone, so changing the cover and saving dropped
    // it - and an undo after the save found no such image: the old cover
    // was gone for good. An asset a step of the undo history still names
    // is kept until the history no longer does.
    const manifest = tourOf([pin("a")], {
      assets: [
        { id: "art1", path: "content/art1.png", kind: "image" },
        { id: "art2", path: "content/art2.png", kind: "image" },
      ],
      cover: "art1",
    });
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(manifest) },
      { path: "content/art1.png", data: "1" },
      { path: "content/art2.png", data: "2" },
    ]);
    const session = await openTourFile(
      new File([zip], "tour.zip", { type: "application/zip" }),
    );
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.setDetails(form({ cover: "art2" }))).toEqual({
      kind: "changed",
    });
    const first = await editor.save({ keepScan: false });
    expect((await writtenJson(first.blob))["cover"]).toBe("art2");
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    expect(editor.details().cover).toBe("art1");
    const second = await editor.save({ keepScan: false });
    const written = await writtenJson(second.blob);
    expect(written["cover"]).toBe("art1");
    expect((written["assets"] as { id: string }[]).map((a) => a.id)).toContain(
      "art1",
    );
    expect(
      readStoredEntryBytes(
        new Uint8Array(await second.blob.arrayBuffer()),
        "content/art1.png",
      ),
      "and its file",
    ).toBeDefined();
    await session.close();
  });

  it("an undo across a save brings back a deleted model with its model file", async () => {
    // Why: a placed model names its file as an asset. A save after the
    // model's delete no longer names that asset in the written tour, and
    // the write drops assets nothing names - but the undo history still
    // holds the model, so the asset (and its file) must stay until the
    // history no longer names it, or the undo restores a model without a
    // file to draw.
    const statue: TourObject = {
      id: "m1",
      kind: "model",
      view: "placed",
      asset: "statue",
      sizeM: 4,
      createdAtIso: "2026-10-20T00:00:00.000Z",
      geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
    };
    const manifest = tourOf([pin("a"), statue], {
      assets: [{ id: "statue", path: "content/statue.glb", kind: "model" }],
    });
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(manifest) },
      { path: "content/statue.glb", data: "glTF" },
    ]);
    const session = await openTourFile(
      new File([zip], "tour.zip", { type: "application/zip" }),
    );
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.remove("m1")).toEqual({ kind: "deleted" });
    const first = await editor.save({ keepScan: false });
    expect((await carried(first.blob)).objects.map((o) => o.id)).toEqual(["a"]);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    const second = await editor.save({ keepScan: false });
    const written = await carried(second.blob);
    expect(written.objects.map((o) => o.id)).toEqual(["a", "m1"]);
    expect(written.assets.map((a) => a.id)).toEqual(["statue"]);
    expect(
      readStoredEntryBytes(
        new Uint8Array(await second.blob.arrayBuffer()),
        "content/statue.glb",
      ),
      "and its file",
    ).toBeDefined();
    await session.close();
  });

  it("backs each change of the details up with the whole settings record", async () => {
    const { session, manifest } = await opened([pin("a")], { title: "Old" });
    const settings: EditorTourSettings[] = [];
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: {
        ...loggedDraft(),
        saveSettings: (s) => {
          settings.push(s);
          return Promise.resolve(true);
        },
      },
    });
    editor.setDetails(form({ name: "New", contact: "guide@example.org" }));
    editor.setDetails(form({ name: "New", contact: "guide@example.org" }));
    expect(settings).toEqual([
      {
        needsNoGps: false,
        details: { title: "New", contact: "guide@example.org" },
      },
    ]);
    await session.close();
  });

  it("a draft's details naming a photo the tour no longer has restore without that cover, the rest kept", async () => {
    // Why (M4a review #1): such a record was refused WHOLE - the
    // description and the contact were lost, and the page said nothing
    // was restored. A cover is cosmetic, as the format's reader treats it.
    const { session, manifest } = await opened([pin("a"), photo("f")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(
      editor.restore({
        objects: [],
        deleted: [],
        settings: {
          needsNoGps: false,
          details: {
            description: "Up and back.",
            contact: "guide@example.org",
            cover: "gone",
          },
        },
      }),
    ).toEqual({ changed: 2, deleted: 0 });
    expect(editor.details()).toEqual(
      form({ description: "Up and back.", contact: "guide@example.org" }),
    );
    await session.close();
  });

  it("a stored name longer than the field's limit does not block another detail's edit; a new long name is refused", async () => {
    // Why (M4a review #10): a tour named elsewhere with more than 80
    // characters could not have its description or contact changed at
    // all - the unchanged name failed the form's check.
    const long = "x".repeat(TOUR_TITLE_MAX_CHARS + 10);
    const { session, manifest } = await opened([pin("a")], { title: long });
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(
      editor.setDetails({ ...editor.details(), description: "New words." }),
    ).toEqual({ kind: "changed" });
    expect(editor.changeCount()).toBe(1);
    expect(
      editor.setDetails({ ...editor.details(), name: `${long}y` }).kind,
    ).toBe("refused");
    await session.close();
  });

  it("the walk-through: cover chosen, saved, its photo deleted, saved by itself, reopened - nothing false is offered", async () => {
    // Why (M4a review #1): the settings record kept the cover of the
    // deleted photo, so every later open offered "Changed: the tour's
    // details (cover)", and its Restore then said nothing was restored.
    // The real draft over an in-memory store, the session's real saves.
    const { session, manifest } = await opened([photo("f"), photo("g")]);
    const store = memoryDraftStores();
    const draft = createEditorDraft({
      openStore: store.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    await draft.open(K, manifest);
    const writes = draft.writes();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: writes,
    });
    editor.setDetails(
      form({
        description: "Up and back.",
        contact: "guide@example.org",
        cover: "f",
      }),
    );
    const first = await editor.save({ keepScan: false });
    writes.built(first.written);
    writes.landed(first.written, K);
    expect(editor.remove("f").kind).toBe("deleted");
    const second = await editor.save({ keepScan: false });
    writes.built(second.written);
    writes.landed(second.written, K);
    await draft.idle();
    draft.close();
    const again = createEditorDraft({
      openStore: store.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    const { offer } = await again.open(K, await carried(second.blob));
    expect(offer).toBeNull();
    await session.close();
  });

  it("restores a draft's details unless they were changed here meanwhile", async () => {
    const { session, manifest } = await opened([pin("a")], { title: "Old" });
    const offered = {
      needsNoGps: false,
      details: { title: "From the draft" },
    };
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(
      editor.restore({ objects: [], deleted: [], settings: offered }),
    ).toEqual({ changed: 1, deleted: 0 });
    expect(editor.details().name).toBe("From the draft");
    const other = createEditorSession({ session, manifest, levels: new Map() });
    other.setDetails(form({ name: "Typed here" }));
    expect(
      other.restore({ objects: [], deleted: [], settings: offered }),
    ).toEqual({ changed: 0, deleted: 0 });
    expect(other.details().name).toBe("Typed here");
    await session.close();
  });
});

/**
 * Why (tour editor plan 2026-10-17-1816, W2): undo covered only a delete,
 * for 8 s, and was lost to any save. Ctrl+Z / Ctrl+Shift+Z now walk an
 * edit stack in the session, over every edit kind - a text, a move, a
 * delete, the "needs no GPS" setting, the tour details, a restore. An undo
 * is an edit like any other: pending until saved, written to the draft,
 * written by the next save - also when a save already wrote the step it
 * undoes. (A note brought back after a save wrote its delete is not
 * offered by a later open's draft, so the page still holds autosave while
 * a delete's Undo toast shows, M4a review #2.)
 */
describe("createEditorSession, undo and redo (W2)", () => {
  const form = (over: Partial<DetailsForm> = {}): DetailsForm => ({
    name: "",
    description: "",
    cover: null,
    contact: "",
    ...over,
  });

  it("undoes every edit kind, newest first, and redoes them", async () => {
    const { session, manifest } = await opened([pin("a", "Old"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const original = editor.model();
    expect(editor.undo()).toEqual({ kind: "nothing" });
    editor.editText("a", "New");
    editor.move("b", 48.53, 9.06);
    editor.remove("a");
    editor.setNeedsNoGps(true);
    editor.setDetails(form({ name: "Castle walk" }));
    expect(editor.changeCount()).toBe(4);
    const undone = [1, 2, 3, 4, 5].map(() => editor.undo());
    expect(undone.map((u) => u.kind)).toEqual(Array(5).fill("undone"));
    expect(undone.map((u) => (u.kind === "undone" ? u.what : ""))).toEqual([
      "the tour details",
      'the "needs no GPS" setting',
      'the delete of "New"',
      'the move of "pin b"',
      'the text of "New"',
    ]);
    expect(editor.undo()).toEqual({ kind: "nothing" });
    expect(editor.changeCount()).toBe(0);
    expect(editor.model()).toEqual(original);
    for (let i = 0; i < 5; i += 1) expect(editor.redo().kind).toBe("redone");
    expect(editor.redo()).toEqual({ kind: "nothing" });
    expect(editor.changeCount()).toBe(4);
    expect(editor.needsNoGps()).toBe(true);
    expect(editor.details().name).toBe("Castle walk");
    expect(editor.model().items.some((i) => i.id === "a")).toBe(false);
    await session.close();
  });

  it("a new edit drops what could be redone", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "One");
    editor.undo();
    editor.editText("a", "Two");
    expect(editor.redo()).toEqual({ kind: "nothing" });
    await session.close();
  });

  it("counts every edit, undo and redo in its revision", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const r0 = editor.revision();
    editor.editText("a", "One");
    const r1 = editor.revision();
    expect(r1).toBeGreaterThan(r0);
    editor.editText("a", "One"); // unchanged: no edit
    expect(editor.revision()).toBe(r1);
    editor.undo();
    expect(editor.revision()).toBeGreaterThan(r1);
    await session.close();
  });

  it("an undo after a save is a change the next save writes", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "New");
    await editor.save({ keepScan: false });
    expect(editor.changeCount()).toBe(0);
    expect(editor.undo().kind).toBe("undone");
    expect(editor.changeCount()).toBe(1);
    const saved = await carried((await editor.save({ keepScan: false })).blob);
    expect(saved.objects[0]).toMatchObject({ caption: "Old" });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  // Why (the M5a milestone review M2): the save that wrote a delete also
  // dropped the station it emptied; the undo must put the element back
  // into THAT station, under its id, not merge it into a neighbour within
  // R (all three stand on one spot here, so the old rule merged it into
  // the first) or start a station with a new id. And WHERE it stood: the
  // tour document's history holds the station frames (D29-D31), so the
  // undo brings the station back in its place in the order, not after the
  // tour's own stations (the M5a review's recorded deviation, settled).
  it("an undo after a save that dropped the emptied station puts the element back into that station, where it stood", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b"), pin("c")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.remove("b");
    const first = await writtenJson(
      (await editor.save({ keepScan: false })).blob,
    );
    expect((first.stations as { id: string }[]).map((s) => s.id)).toEqual([
      stationIdOf("a"),
      stationIdOf("c"),
    ]);
    expect(editor.undo().kind).toBe("undone");
    const second = await writtenJson(
      (await editor.save({ keepScan: false })).blob,
    );
    expect(
      (second.stations as { id: string; blocks: { id: string }[] }[]).map(
        (s) => [s.id, s.blocks.map((i) => i.id)],
      ),
    ).toEqual([
      [stationIdOf("a"), ["a"]],
      [stationIdOf("b"), ["b"]],
      [stationIdOf("c"), ["c"]],
    ]);
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("delete, save in place, undo: a resave is due, and the file it writes keeps the note through a reload (D33)", async () => {
    // Why (D33): the open drops every draft record of an id the file on
    // disk lacks. A delete written in place and then undone was therefore
    // lost on a reload - the disk lacked the note, the draft's record went
    // with it. The undo now says a resave is due; the page writes in place
    // at once, and the file it writes holds the note again.
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const drafts = memoryDraftStores();
    const draftOf = () =>
      createEditorDraft({
        openStore: drafts.open,
        holdLock: freeLocks,
        noBackup: () => undefined,
      });
    const draft = draftOf();
    await draft.open(K, manifest);
    const writes = draft.writes();
    const store = createTourViewerStore();
    const doc = () => selectTourDocument(store.getState());
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: writes,
      store,
    });
    expect(editor.remove("b").kind).toBe("deleted");
    const first = await editor.save({ keepScan: false, inPlace: true });
    writes.built(first.written);
    writes.landed(first.written, K);
    // The page's delivery: the in-place write arrived.
    store.dispatch(
      tourDocumentActions.saveDelivered({ inPlace: true, name: "t.zip" }),
    );
    expect(editor.undo().kind).toBe("undone");
    expect(doc().save.resave).toBe(true);
    // The loss the resave exists for: a reload of the file as it stands
    // now (without b) neither shows b nor offers it.
    await draft.idle();
    draft.close();
    const lost = draftOf();
    const before = await lost.open(K, await carried(first.blob));
    expect(before.offer?.objects.map((o) => o.id) ?? []).not.toContain("b");
    expect((await carried(first.blob)).objects.map((o) => o.id)).toEqual(["a"]);
    lost.close();
    // The page's resave: the save path, written in place.
    const again = await editor.save({ keepScan: false, inPlace: true });
    store.dispatch(
      tourDocumentActions.saveDelivered({ inPlace: true, name: "t.zip" }),
    );
    expect(doc().save.inPlaceAt).toBe(doc().position);
    const reopened = await carried(again.blob);
    expect(reopened.objects.map((o) => o.id)).toEqual(["a", "b"]);
    await session.close();
  });

  it("delete, download, undo, redo: a reload of the opened file offers the delete again", async () => {
    // Why (the r880 fix re-review, L1): a download clears nothing in the
    // draft, and a reload opens the OPENED file, which still holds the
    // note. The redo forgot the undo's record and left no tombstone, so the
    // reload brought the deleted note back with nothing offered.
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const store = memoryDraftStores();
    const draft = createEditorDraft({
      openStore: store.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    await draft.open(K, manifest);
    const writes = draft.writes();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: writes,
    });
    expect(editor.remove("b").kind).toBe("deleted");
    writes.built((await editor.save({ keepScan: false })).written);
    expect(editor.undo().kind).toBe("undone");
    expect(editor.redo().kind).toBe("redone");
    await draft.idle();
    draft.close();
    const again = createEditorDraft({
      openStore: store.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    const { offer } = await again.open(K, manifest);
    expect(offer?.deleted).toEqual(["b"]);
    await session.close();
  });

  it("a delete a save already wrote comes back, a photo with its picture", async () => {
    const { session, manifest } = await opened([pin("a"), photo("f")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.remove("a");
    editor.remove("f");
    const first = await editor.save({ keepScan: false });
    expect(
      readStoredCentralDirectory(
        new Uint8Array(await first.blob.arrayBuffer()),
      ).map((e) => e.name),
    ).not.toContain("content/f.jpg");
    expect(editor.undo().kind).toBe("undone");
    expect(editor.undo().kind).toBe("undone");
    expect(editor.changeCount()).toBe(2);
    const second = await editor.save({ keepScan: false });
    const tour = await carried(second.blob);
    expect(tour.objects.map((o) => o.id).sort()).toEqual(["a", "f"]);
    const bytes = readStoredEntryBytes(
      new Uint8Array(await second.blob.arrayBuffer()),
      "content/f.jpg",
    );
    expect(new TextDecoder().decode(bytes)).toBe("f");
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("a photo deleted after a save keeps its picture from the session's own last bytes when the page's copy does not read", async () => {
    // Why (M4a review #5): right after the first in-place write the opened
    // file no longer reads, and the page may not have opened its copy of
    // the written bytes yet - the picture was lost, and the delete's undo
    // after the next save refused. The session holds those bytes itself.
    const { session, manifest } = await opened([photo("f"), photo("g")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      loadPhoto: () => Promise.reject(new Error("the file changed on disk")),
    });
    editor.remove("g");
    await editor.save({ keepScan: false });
    editor.remove("f");
    await editor.save({ keepScan: false });
    expect(editor.undo().kind).toBe("undone");
    expect(await editor.pictureOf("f")?.text()).toBe("f");
    await session.close();
  });

  it("refuses, and keeps, the undo of a saved photo delete whose picture could not be read", async () => {
    const { session, manifest } = await opened([photo("f")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      loadPhoto: () => Promise.reject(new Error("gone")),
    });
    editor.remove("f");
    await editor.save({ keepScan: false });
    const outcome = editor.undo();
    expect(outcome.kind).toBe("refused");
    expect(outcome.kind === "refused" ? outcome.reason : "").toMatch(/picture/);
    expect(editor.changeCount()).toBe(0);
    expect(editor.redo()).toEqual({ kind: "nothing" });
    await session.close();
  });

  it("refuses an undo or a redo while a save runs, in words", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "New");
    const running = editor.save({ keepScan: false });
    expect(editor.undo()).toMatchObject({ kind: "refused" });
    await running;
    expect(editor.undo().kind).toBe("undone");
    await session.close();
  });

  it("backs every undo and redo up in the draft", async () => {
    const { session, manifest } = await opened([pin("a", "Old"), pin("b")]);
    const draft = loggedDraft();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft,
    });
    editor.editText("a", "New");
    editor.remove("b");
    draft.calls.length = 0;
    editor.undo();
    editor.undo();
    expect(draft.calls).toEqual(["untombstone b", "forget a"]);
    draft.calls.length = 0;
    editor.redo();
    editor.redo();
    expect(draft.calls).toEqual(["save a New", "tombstone b"]);
    await session.close();
  });

  it("a cover comes back with its photo's undo, and the details' own undo puts the old ones back", async () => {
    const { session, manifest } = await opened([photo("f")], {
      cover: "f",
      title: "Old",
    });
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.remove("f");
    expect(editor.details().cover).toBeNull();
    editor.undo();
    expect(editor.details().cover).toBe("f");
    editor.setDetails(form({ name: "New", cover: "f" }));
    editor.undo();
    expect(editor.details()).toEqual(form({ name: "Old", cover: "f" }));
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("a restore is one step to undo", async () => {
    const { session, manifest } = await opened([pin("a", "Old"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.restore({
      objects: [pin("a", "From the draft")],
      deleted: ["b"],
      settings: { needsNoGps: true },
    });
    expect(editor.changeCount()).toBe(3);
    expect(editor.undo()).toEqual({
      kind: "undone",
      what: "the restored changes",
    });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });
});

/** Capture spots an earlier file written while the walk's frames were
 *  baked into the tour carries: a field gone from the format, which the
 *  reader ignores. */
const WALK_SPOTS = {
  fixes: 3,
  gpsAccuracyMedianM: 4,
  captures: [
    {
      image: "images/frame-000002.jpg",
      // At pin "a"'s spot, in its station (`tourOf`).
      station: stationIdOf("a"),
      pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    },
  ],
};

/** `manifest`'s tour.json, with {@link WALK_SPOTS} as an earlier file
 *  carried them when `spots`. */
function withSpots(manifest: TourManifest, spots: boolean): string {
  const json = serializeTourManifest(manifest);
  return spots
    ? JSON.stringify({ ...JSON.parse(json), captureSpots: WALK_SPOTS })
    : json;
}

/** The walk's entries and their bytes, as the phone records them. */
const WALK_ENTRIES: Readonly<Record<string, string>> = {
  "session.json": '{"version":1}',
  "actions/000001.json": '[{"type":"gps"}]',
  "images/frame-000001.jpg": "an unbaked frame",
};

/** A tour with a pin and the walk, a second frame
 *  (`images/frame-000002.jpg`) among it; `withCaptures`: the file
 *  carries capture spots for that frame, as an earlier one written while
 *  the frames were baked into the tour did. */
async function walkTour(withCaptures = true): Promise<{
  session: TourSession;
  manifest: TourManifest;
  bytes: Uint8Array;
}> {
  const manifest: TourManifest = tourOf([pin("a")]);
  const zip = await packFilesAsZip([
    { path: "tour.json", data: withSpots(manifest, withCaptures) },
    { path: "images/frame-000002.jpg", data: "the baked photo" },
    ...Object.entries(WALK_ENTRIES).map(([path, data]) => ({ path, data })),
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  return { session, manifest, bytes: new Uint8Array(await zip.arrayBuffer()) };
}

/** A zip's entry names, sorted. */
async function namesIn(blob: Blob): Promise<string[]> {
  return readStoredCentralDirectory(new Uint8Array(await blob.arrayBuffer()))
    .map((e) => e.name)
    .sort();
}

describe("moving the walk out (W2, D19)", () => {
  // Why: a hosted tour file is public, and the walk (the GPS track, the
  // depth) is the creator's. Moving it out must keep every byte of it in a
  // file of its own, take it out of the tour for good - also the next
  // autosave, which keeps "the walk" of the file it rebuilds from - and
  // change nothing until the page has delivered both files: a move whose
  // write failed must leave the next save carrying the walk.
  const walkNames = Object.keys(WALK_ENTRIES).sort();
  /** The whole recording: the walk's entries and every frame. A frame
   *  the file's capture spots named was kept for the visitors once; it
   *  is debug data like any other now (the document drops the spots), so
   *  it is the walk too. */
  const recording = [...walkNames, "images/frame-000002.jpg"].sort();
  /** What the debug bundle adds at its root (`debug-bundle.ts`). */
  const BUNDLE_ENTRIES = ["about-this-debug-data.txt", "debug-bundle.json"];

  /** What the moved-out file reads as when it is added back. */
  async function bundleOf(blob: Blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return readDebugBundle(await namesIn(blob), (name) => {
      const entry = readStoredEntryBytes(bytes, name);
      return entry === undefined
        ? Promise.reject(new Error(`no ${name}`))
        : Promise.resolve(new Blob([entry.slice()]));
    });
  }

  // (A test of the walk's own file name stood here: the moved-out file is
  // the debug bundle since M2 of the debug-captures plan, named by
  // `debugBundleFileName`, whose rule `debug-bundle.test.ts` pins.)

  it("puts the whole recording, byte for byte, into the walk's zip, and the tour carries none of the walk, also after the next save", async () => {
    const { session, manifest, bytes } = await walkTour();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    // (Was walkNames: the frame the capture spots named stayed the tour's.)
    expect((await editor.walkEntries()).sort()).toEqual(recording);
    editor.editText("a", "Moved with the walk");
    const move = await editor.moveWalkOut();
    if (move.kind !== "ready") throw new Error(move.reason);
    // Changed expectation (M2 of the debug-captures plan): the walk's own
    // zip (`tour-walk.zip`, with `about-this-walk.txt`) is the debug
    // bundle now, one format for both pages.
    expect(move.walk.filename).toBe("tour-debug.zip");
    // The whole recording (the M4b milestone review #8), every frame
    // included - and the bundle's identity and note.
    expect(await namesIn(move.walk.blob)).toEqual(
      [...recording, ...BUNDLE_ENTRIES].sort(),
    );
    const walkBytes = new Uint8Array(await move.walk.blob.arrayBuffer());
    for (const name of recording) {
      // Read, never undefined on both sides: an equality of two misses
      // would prove nothing.
      expect(readStoredEntryBytes(walkBytes, name)).toBeDefined();
      expect(readStoredEntryBytes(walkBytes, name)).toEqual(
        readStoredEntryBytes(bytes, name),
      );
    }
    const tourNames = await namesIn(move.save.blob);
    // (The second frame stayed in the tour while its capture spot named
    // it; no frame is the tour's now.)
    for (const name of recording) expect(tourNames).not.toContain(name);
    expect("captureSpots" in (await carried(move.save.blob))).toBe(false);
    // The pending edit rides along, as in any save.
    expect((await carried(move.save.blob)).objects[0]).toMatchObject({
      caption: "Moved with the walk",
    });
    move.commit();
    expect(editor.changeCount()).toBe(0);
    expect(await editor.walkEntries()).toEqual([]);
    editor.editText("a", "After the move");
    // An in-place autosave keeps the walk of the bytes it rebuilds from:
    // there is none left to keep.
    const next = await editor.save({ keepScan: true });
    const nextNames = await namesIn(next.blob);
    for (const name of walkNames) expect(nextNames).not.toContain(name);
    expect((await carried(next.blob)).objects[0]).toMatchObject({
      caption: "After the move",
    });
    await session.close();
  });

  it("changes nothing until the move is committed: a move whose files were not written leaves the walk in the next save", async () => {
    const { session, manifest } = await walkTour();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "Pending");
    const move = await editor.moveWalkOut();
    expect(move.kind).toBe("ready");
    // Not committed: the page's write of either file failed.
    expect(editor.changeCount()).toBe(1);
    // (Was walkNames; the named frame is the walk too now.)
    expect((await editor.walkEntries()).sort()).toEqual(recording);
    const saved = await editor.save({ keepScan: true });
    const names = await namesIn(saved.blob);
    for (const name of recording) expect(names).toContain(name);
    await session.close();
  });

  it("moves the walk out of a tour whose file carries no capture spots, and refuses for a tour without one", async () => {
    // Why: the move was refused while a visitor's viewer could still place
    // the recorded photos from the walk; the walk of such a tour is the
    // creator's like any other.
    const unbaked = await walkTour(false);
    const editor = createEditorSession({
      session: unbaked.session,
      manifest: unbaked.manifest,
      levels: new Map(),
    });
    // The whole recording is the walk, its frames included.
    expect((await editor.walkEntries()).sort()).toEqual(recording);
    const move = await editor.moveWalkOut();
    if (move.kind !== "ready") throw new Error(move.reason);
    move.commit();
    expect(await editor.walkEntries()).toEqual([]);
    await unbaked.session.close();
    const plain = await opened([pin("a")]);
    const none = createEditorSession({
      session: plain.session,
      manifest: plain.manifest,
      levels: new Map(),
    });
    const nothing = await none.moveWalkOut();
    expect(nothing.kind === "refused" && nothing.reason).toMatch(/no walk/);
    await plain.session.close();
  });

  it("refuses to commit a move once another save landed after it was built", async () => {
    // Why (the M4b milestone review #7): the move's tour was built from the
    // bytes before that save; taking it as the newest would drop what the
    // save wrote. The page says "move it again".
    const { session, manifest } = await walkTour();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const move = await editor.moveWalkOut();
    if (move.kind !== "ready") throw new Error(move.reason);
    expect(move.current()).toBe(true);
    editor.editText("a", "Saved after the move was built");
    await editor.save({ keepScan: true });
    // Asked before the tour is written, so a stale move writes nothing.
    expect(move.current()).toBe(false);
    expect(() => {
      move.commit();
    }).toThrow(/another save landed/);
    // Nothing of the move was taken: the newest bytes still carry the walk.
    // (Was walkNames; the named frame is the walk too now.)
    expect((await editor.walkEntries()).sort()).toEqual(recording);
    await session.close();
  });

  it("names the tour the debug data came from, in the bundle's identity and its note", async () => {
    // Why (the M4b milestone review #8): a walk file on its own says
    // nothing of the tour it belongs to; the note does - the tour's file,
    // its name and, for a listed tour, its series - and since M2 of the
    // debug-captures plan the bundle's identity says it to the editor too,
    // which compares it when the file is added back.
    const fixture = await buildListedTourFixture(
      {
        "tour.json": withSpots(
          tourOf([pin("a")], { title: "Castle walk" }),
          true,
        ),
        "images/frame-000002.jpg": "the baked photo",
        ...WALK_ENTRIES,
      },
      { seriesId: "Fx7qT2mK9pL4sV8bN1rW6a" },
    );
    const session = await openTourFile(
      new File([fixture.zip], "castle.zip", { type: "application/zip" }),
    );
    const manifest = (await session.loadTourManifest())!;
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const move = await editor.moveWalkOut();
    if (move.kind !== "ready") throw new Error(move.reason);
    const note = readStoredEntryBytes(
      new Uint8Array(await move.walk.blob.arrayBuffer()),
      "about-this-debug-data.txt",
    );
    expect(note).toBeDefined();
    const text = new TextDecoder().decode(note);
    expect(text).toContain("castle.zip");
    expect(text).toContain("Castle walk");
    expect(text).toContain("Fx7qT2mK9pL4sV8bN1rW6a");
    expect(await bundleOf(move.walk.blob)).toMatchObject({
      kind: "bundle",
      identity: {
        seriesId: "Fx7qT2mK9pL4sV8bN1rW6a",
        tour: "Castle walk",
        file: "castle.zip",
      },
    });
    expect(move.walk.filename).toBe("castle-debug.zip");
    await session.close();
  });

  it("builds the debug data from the opened file, also after a save that left the walk out", async () => {
    // Why (M2 of the debug-captures plan): after a walk-free
    // save the newest bytes carry no walk, and the move refuses - but the
    // opened file still does, and "Save the debug data" keeps it apart.
    const { session, manifest, bytes } = await walkTour();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "Lean");
    const lean = await editor.save({ keepScan: false });
    for (const name of recording) {
      expect(await namesIn(lean.blob)).not.toContain(name);
    }
    expect(await editor.walkEntries()).toEqual([]);
    const built = await editor.debugData();
    if (built.kind !== "built") throw new Error(built.reason);
    expect(built.filename).toBe("tour-debug.zip");
    expect(await namesIn(built.blob)).toEqual(
      [...recording, ...BUNDLE_ENTRIES].sort(),
    );
    const bundleBytes = new Uint8Array(await built.blob.arrayBuffer());
    for (const name of recording) {
      expect(readStoredEntryBytes(bundleBytes, name)).toBeDefined();
      expect(readStoredEntryBytes(bundleBytes, name)).toEqual(
        readStoredEntryBytes(bytes, name),
      );
    }
    expect(await bundleOf(built.blob)).toMatchObject({
      kind: "bundle",
      identity: { seriesId: null, file: "tour.zip" },
    });
    // Nothing of the session changed: no save, no pending edit taken.
    expect(editor.changeCount()).toBe(0);
    await session.close();
    // A tour without a walk has none to save.
    const plain = await opened([pin("a")]);
    const none = createEditorSession({
      session: plain.session,
      manifest: plain.manifest,
      levels: new Map(),
    });
    const nothing = await none.debugData();
    expect(nothing.kind).toBe("refused");
    await plain.session.close();
  });

  it("names the tour an added debug data file is compared with, as its own bundle names it", async () => {
    // Why (M2 step 5 of the debug-captures plan, Q-C): "Add debug data…"
    // says whether the file is this tour's by comparing it with this tour;
    // the debug data this session saves must compare as its own, and a
    // title only edited, not saved, is not yet the file's.
    const { session, manifest } = await walkTour();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.debugTour()).toEqual({
      seriesId: null,
      title: manifest.title,
      fileName: "tour.zip",
    });
    const built = await editor.debugData();
    if (built.kind !== "built") throw new Error(built.reason);
    const read = await bundleOf(built.blob);
    if (read.kind === "refused") throw new Error(read.reason);
    expect(bundleMatchesTour(read, editor.debugTour())).toBe("this-tour");
    const edited = editor.setDetails({
      ...editor.details(),
      name: "A new name",
    });
    expect(edited.kind).not.toBe("refused");
    expect(editor.debugTour().title).toBe(manifest.title);
    await editor.save({ keepScan: false });
    expect(editor.debugTour().title).toBe("A new name");
    await session.close();
  });

  it("writes the saved file's own id into the debug data, and compares by the id the opened file carries", async () => {
    // Why (r901 review #2): the id is the one name a tour keeps through a
    // rename and a retitle, so a bundle carries the id of the copy it was
    // saved beside, and an added bundle is matched on it first. The tour
    // side is the id the OPENED file carries: the one its open minted is
    // in no file until a save writes it, and comparing by it would call
    // this session's own bundle "another tour's" once the original file
    // (still without an id) is opened again.
    const { session, manifest } = await walkTour();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(manifest.tourId).toBeUndefined();
    expect(editor.debugTour().tourId).toBeUndefined();
    editor.setDetails({ ...editor.details(), name: "A new name" });
    const saved = await editor.save({ keepScan: false });
    expect(saved.written.tourId).toMatch(/^[0-9a-f]{32}$/);
    const built = await editor.debugData();
    if (built.kind !== "built") throw new Error(built.reason);
    expect(built.identity.tourId).toBe(saved.written.tourId);
    expect(editor.debugTour().tourId).toBeUndefined();
    const read = await bundleOf(built.blob);
    if (read.kind === "refused") throw new Error(read.reason);
    expect(bundleMatchesTour(read, editor.debugTour())).toBe("this-tour");
    await session.close();
    // Opened from a file that carries its id, the tour is compared by it.
    const again = await walkTour();
    const named = createEditorSession({
      session: again.session,
      manifest: { ...again.manifest, tourId: "carried_id" },
      levels: new Map(),
    });
    expect(named.debugTour().tourId).toBe("carried_id");
    await again.session.close();
  });

  it("reads the opened file once for a move made before any save", async () => {
    // Why (the M4b milestone review #11): the walk's zip and the tour are
    // built from the same bytes; a listed tour's whole-file check ran twice.
    const { session, manifest } = await walkTour();
    let reads = 0;
    const counted: TourSession = {
      ...session,
      readWholeArchive: () => {
        reads += 1;
        return session.readWholeArchive();
      },
    };
    const editor = createEditorSession({
      session: counted,
      manifest,
      levels: new Map(),
    });
    const move = await editor.moveWalkOut();
    expect(move.kind).toBe("ready");
    expect(reads).toBe(1);
    await session.close();
  });

  it("moves out a walk none of whose frames the tour carries, and a lean save leaves it out too", async () => {
    // Why (the M4b milestone review #3): such a walk was refused with "the
    // recorded photos are placed by it" - photos the tour does not carry -
    // so it could never leave a tour file a creator hosts.
    const sample = new Blob([sampleRecordingBytes()]);
    const zip = await rebuildZipWithEntries(
      sample,
      [
        {
          path: "tour.json",
          data: serializeTourManifest(tourOf([pin("a")])),
        },
      ],
      { remove: [...SAMPLE_PHOTOS] },
    );
    // Opened as the page opens it.
    const tour = async (): Promise<EditorSession> => {
      const out = await openTourForEditing(
        new File([zip], "walked.zip", { type: "application/zip" }),
      );
      if (out.kind !== "opened") throw new Error(out.reason);
      return createEditorSession({
        session: out.session,
        manifest: out.manifest,
        levels: out.levels,
      });
    };
    const original = await namesIn(zip);
    const walk = original.filter((n) => n !== "tour.json");
    expect(walk).toEqual(expect.arrayContaining(["session.json"]));
    const editor = await tour();
    const move = await editor.moveWalkOut();
    if (move.kind !== "ready") throw new Error(move.reason);
    expect(await namesIn(move.walk.blob)).toEqual(
      [...walk, ...BUNDLE_ENTRIES].sort(),
    );
    expect(await namesIn(move.save.blob)).toEqual(["tour.json"]);
    // The lean save (the editor's download without "keep the walk") leaves
    // it out as well. (It also said nothing about photos that do not
    // exist; a save says nothing about photos at all now.)
    const lean = await (await tour()).save({ keepScan: false });
    expect(await namesIn(lean.blob)).toEqual(["tour.json"]);
    expect([...lean.scanLeftOut].sort()).toEqual(walk);
  });
});

/**
 * Why these tests matter (D29-D31): the session no longer keeps a copy of
 * the tour - it is the page's facade over the store's tour document. The
 * page's views read the SAME state the session edits; a second session on
 * the same store (another tour opened) disowns the first, whose late edits
 * and saves must never reach the new tour; and the two operations the
 * desktop had no gesture for - placing a note, moving a station with its
 * items (D17) - go through the same document rules as the phone's.
 */
describe("createEditorSession, the tour document (D29-D31)", () => {
  it("edits the store's document: the page reads what the session changed", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const store = createTourViewerStore();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store,
    });
    editor.editText("a", "new");
    const doc = selectTourDocument(store.getState());
    expect(doc.placed.map((p) => p.object.id)).toEqual(["a"]);
    expect(doc.past.map((s) => s.what)).toEqual(['the text of "new"']);
    await editor.save({ keepScan: false });
    expect(selectTourDocument(store.getState()).written?.title).toBe(
      manifest.title,
    );
    expect(selectTourDocument(store.getState()).placed).toEqual([]);
    await session.close();
  });

  // Why (the r875 milestone review #4): the session read the STORE's
  // document, so once another open replaced it, the old session's model,
  // counts and details were the new tour's - and a save of it could build
  // the old file's bytes around the new tour's manifest. It reads only its
  // own open now, and a save it was asked for after another open refuses.
  it("a later open on the same store disowns the earlier session: its edits are refused, its save refused, it reads only its own tour", async () => {
    const first = await opened([pin("a")]);
    const second = await opened([pin("z")]);
    const store = createTourViewerStore();
    const old = createEditorSession({
      session: first.session,
      manifest: first.manifest,
      levels: new Map(),
      store,
    });
    old.editText("a", "pending");
    const late = old.save({ keepScan: false });
    const now = createEditorSession({
      session: second.session,
      manifest: second.manifest,
      levels: new Map(),
      store,
    });
    // Started before the other open: its own tour throughout, bytes and
    // manifest alike, and it lands nowhere.
    expect(noteIds(old.model())).toEqual(["a"]);
    expect((await carried((await late).blob)).objects).toMatchObject([
      { id: "a", caption: "pending" },
    ]);
    await expect(old.save({ keepScan: false })).rejects.toThrow(
      /another tour was opened/i,
    );
    expect(old.editText("a", "again")).toEqual({
      kind: "refused",
      reason: NOT_IN_TOUR,
    });
    expect(old.undo()).toEqual({ kind: "refused", reason: NOT_IN_TOUR });
    expect(noteIds(old.model())).toEqual(["a"]);
    expect(old.changeCount()).toBe(1);
    expect(old.pendingIds()).toEqual(["a"]);
    expect(old.details().name).toBe(first.manifest.title ?? "");
    expect(noteIds(now.model())).toEqual(["z"]);
    // (Changed expectation, Q-I: the document's written tour is the
    // second file's plus the id the open minted for it, which carries none.)
    expect(selectTourDocument(store.getState()).written).toEqual({
      ...second.manifest,
      tourId: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(now.changeCount()).toBe(0);
    await first.session.close();
    await second.session.close();
  });

  // Why: "as it stood when replaced" was the state of the session's LAST
  // READ - an edit followed by no read before another open made the
  // replaced session read its tour without that edit. It follows the
  // store now, up to the replacing open.
  it("a replaced session reads its tour as it stood when replaced, an edit no read followed included", async () => {
    const first = await opened([pin("a")]);
    const second = await opened([pin("z")]);
    const store = createTourViewerStore();
    const old = createEditorSession({
      session: first.session,
      manifest: first.manifest,
      levels: new Map(),
      store,
    });
    old.editText("a", "unread");
    createEditorSession({
      session: second.session,
      manifest: second.manifest,
      levels: new Map(),
      store,
    });
    expect(old.changeCount()).toBe(1);
    expect(old.pendingIds()).toEqual(["a"]);
    await first.session.close();
    await second.session.close();
  });

  it("places a new note into the tour by the automatic-station rule, refusing an id the tour carries", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.place(pin("a"))).toMatchObject({ kind: "refused" });
    expect(editor.place(pin("n", "New"))).toEqual({ kind: "placed" });
    expect(editor.changeCount()).toBe(1);
    const saved = await carried((await editor.save({ keepScan: false })).blob);
    expect(saved.objects.map((o) => o.id)).toEqual(["a", "n"]);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    const undone = await carried((await editor.save({ keepScan: false })).blob);
    expect(undone.objects.map((o) => o.id)).toEqual(["a"]);
    await session.close();
  });

  // Why: a note that NAMES its station keeps it, so the format's 10 km
  // bound between an item and its station still applies to it - refused
  // in words rather than taken and failing every later save.
  it("refuses a new note naming a station further away than a tour can carry, in words", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const far: TourObject = {
      ...pin("n"),
      station: stationIdOf("a"),
      geo: { ...pin("n").geo, lat: 48.72 },
    };
    expect(editor.place(far)).toEqual({
      kind: "refused",
      reason: TOO_FAR_FROM_STATION,
    });
    expect(TOO_FAR_FROM_STATION).toContain("10 km");
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  // Why: a station's move comes from a drag of the 3D view, where a ray
  // that misses can make a number that is no number; such a pose must be
  // refused in words and change nothing, as an object's move is, rather
  // than reach the document (or throw inside the view's frame).
  it("refuses a station move to a spot that is no number or off the map, changing nothing", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const station = manifest.stations[0]!;
    const before = editor.revision();
    for (const geo of [
      { ...station.geo, lat: Number.NaN },
      { ...station.geo, lon: Number.POSITIVE_INFINITY },
      { ...station.geo, alt: Number.NaN },
      { ...station.geo, lat: 91 },
      { ...station.geo, lon: -181 },
      { ...station.geo, headingDeg: Number.NaN },
    ]) {
      expect(editor.moveStation(station.id, geo), JSON.stringify(geo)).toEqual({
        kind: "refused",
        reason: "That spot is not on the map.",
      });
    }
    expect(editor.revision()).toBe(before);
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("moves a station with its items (D17): the items keep their local poses, and an undo puts it back", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const station = manifest.stations[0]!;
    const geo = { ...station.geo, lat: station.geo.lat + 0.0002 };
    expect(editor.moveStation("nowhere", geo)).toMatchObject({
      kind: "refused",
    });
    expect(editor.moveStation(station.id, geo)).toEqual({ kind: "moved" });
    const json = await writtenJson(
      (await editor.save({ keepScan: false })).blob,
    );
    const written = (
      json.stations as { id: string; geo: { lat: number }; blocks: unknown[] }[]
    ).find((s) => s.id === station.id)!;
    expect(written.geo.lat).toBeCloseTo(geo.lat, 12);
    expect(written.blocks).toEqual(
      JSON.parse(JSON.stringify(station.blocks)) as unknown[],
    );
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    const back = await writtenJson(
      (await editor.save({ keepScan: false })).blob,
    );
    expect(
      (back.stations as { id: string; geo: { lat: number } }[]).find(
        (s) => s.id === station.id,
      )!.geo.lat,
    ).toBeCloseTo(station.geo.lat, 12);
    await session.close();
  });
});

/**
 * Why (the r875 milestone review #1): the draft kept the objects but not
 * the station frames, so a station moved, the tab closed and the draft
 * restored came back as its items at the moved spots inside an UNMOVED
 * station - and the next save wrote them at new local offsets, breaking
 * D17's rigid move silently. The frames now ride in the settings record.
 */
describe("createEditorSession, a moved station across a reload (review #1)", () => {
  it("a station moved, the tab closed, the draft restored: the save is the one before the reload", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const stores = memoryDraftStores();
    const draft = createEditorDraft({
      openStore: stores.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    await draft.open(K, manifest);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: draft.writes(),
    });
    const station = manifest.stations[0]!;
    const geo = { ...station.geo, lat: station.geo.lat + 0.0003 };
    expect(editor.moveStation(station.id, geo)).toEqual({ kind: "moved" });
    const before = await writtenJson(
      (await editor.save({ keepScan: false })).blob,
    );
    await draft.idle();
    draft.close();

    const again = createEditorDraft({
      openStore: stores.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    const { offer } = await again.open(K, manifest);
    expect(offer?.text).toMatch(/the position of a station/);
    const reloaded = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: again.writes(),
    });
    expect(reloaded.restore(offer!)).toEqual({ changed: 2, deleted: 0 });
    const after = await writtenJson(
      (await reloaded.save({ keepScan: false })).blob,
    );
    expect(after.stations).toEqual(before.stations);
    await session.close();
  });
});
