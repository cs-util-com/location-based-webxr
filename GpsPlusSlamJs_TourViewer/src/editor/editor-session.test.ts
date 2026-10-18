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
  type TourCaptureSpots,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  openTourFile,
  tourFileKeyOfFile,
  type TourSession,
} from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { selectTourDocument } from "../tour-document.js";
import {
  createEditorSession,
  NOT_IN_TOUR,
  TOO_FAR_FROM_STATION,
  WALK_NOTE,
  walkFileName,
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
  inOwnStation,
  stationIdOf,
  tourOf,
  withWorldObjects,
} from "../test-support/v3-tour.js";
import type { EditorModel } from "./editor-model.js";

beforeAll(() => {
  createTourViewerStore();
});

function pin(id: string, label = `pin ${id}`): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
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
      .filter((o) => o.kind === "photo")
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
    expect(tour.objects[0]).toMatchObject({ label: "New" });
    // Re-expressed in its station's frame and read back: float32 geodesy.
    expect(tour.objects[1]?.geo.lat).toBeCloseTo(48.53, 7);
    expect(tour.objects[1]?.geo.lon).toBeCloseTo(9.06, 7);
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
      label: "pin b",
    });
    expect(editor.changeCount()).toBe(1);
    const second = await editor.save({ keepScan: false });
    const tour = await carried(second.blob);
    expect(tour.objects.map((o) => (o as { label: string }).label)).toEqual([
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
    expect((await editor.save({ keepScan: false })).filename).toBe("tour.zip");
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
    expect(tour.objects.map((o) => (o as { label: string }).label)).toEqual([
      "One",
      "Two",
    ]);
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
        `save ${object.id}${object.kind === "pin" ? ` ${object.label}` : ""}`,
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
      "tombstone a",
      "save a New",
      "untombstone a",
    ]);
    // An unchanged text and a refused one write nothing.
    editor.editText("a", "New");
    editor.editText("a", " ");
    expect(draft.calls).toHaveLength(5);
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

  // Why (the M5a milestone review L1): a note stays in its station however
  // far it is moved, and the format refuses an item more than 10 km from
  // its station. A far drag on the 2D map was taken, and from then on
  // every save failed with the parser's technical message. The move is
  // refused in words instead, changing nothing, and saving still works.
  it("refuses a move further from the note's station than a tour can carry, in words", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const draft = loggedDraft();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft,
    });
    // About 22 km north of its station.
    expect(editor.move("a", 48.72, 9.05)).toEqual({
      kind: "refused",
      reason: TOO_FAR_FROM_STATION,
    });
    expect(TOO_FAR_FROM_STATION).toContain("10 km");
    expect(editor.changeCount()).toBe(0);
    expect(editor.undo()).toEqual({ kind: "nothing" });
    expect(draft.calls).toEqual([]);
    // About 5.5 km is far, but a tour can carry it.
    expect(editor.move("b", 48.57, 9.05)).toEqual({ kind: "moved" });
    const saved = await carried((await editor.save({ keepScan: false })).blob);
    expect(saved.objects.find((o) => o.id === "b")?.geo.lat).toBeCloseTo(
      48.57,
      6,
    );
    await session.close();
  });

  // Why (L1, the same bound): a draft written before the move was refused
  // can still offer such a move; restoring it would make every save fail.
  it("skips a draft's object that stands further from its station than a tour can carry", async () => {
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
      changed: 1,
      deleted: 0,
    });
    const saved = await carried((await editor.save({ keepScan: false })).blob);
    expect(
      saved.objects.map((o) => [o.id, "label" in o ? o.label : ""]),
    ).toEqual([
      ["a", "pin a"],
      ["b", "near"],
    ]);
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
      version: 3,
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
    expect(json).toMatchObject({ version: 3, minor: 0 });
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
      version: 3,
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
          items: [],
          activateRadiusM: 30,
          foundRadiusM: 5,
          hint: "arrow",
          steps: [
            {
              id: "hi",
              block: { kind: "text", text: "Hello" },
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
      version: 3,
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
    expect(saved.objects[0]).toMatchObject({ label: "Old" });
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
      (second.stations as { id: string; items: { id: string }[] }[]).map(
        (s) => [s.id, s.items.map((i) => i.id)],
      ),
    ).toEqual([
      [stationIdOf("a"), ["a"]],
      [stationIdOf("b"), ["b"]],
      [stationIdOf("c"), ["c"]],
    ]);
    expect(editor.changeCount()).toBe(0);
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

/** Spots that place the recorded photo without the walk (any valid ones). */
const WALK_SPOTS: TourCaptureSpots = {
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

/** The walk's entries and their bytes, as the phone records them. */
const WALK_ENTRIES: Readonly<Record<string, string>> = {
  "session.json": '{"version":1}',
  "actions/000001.json": '[{"type":"gps"}]',
  "images/frame-000001.jpg": "an unbaked frame",
};

/** A tour with a pin, a baked photo (`images/frame-000002.jpg`) and the
 *  walk; `baked: false` leaves the photos' spots to the walk. */
async function walkTour(baked = true): Promise<{
  session: TourSession;
  manifest: TourManifest;
  bytes: Uint8Array;
}> {
  const manifest: TourManifest = tourOf(
    [pin("a")],
    baked ? { captureSpots: WALK_SPOTS } : {},
  );
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
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

  it("names the walk's file after the tour's", () => {
    expect(walkFileName("castle.zip")).toBe("castle-walk.zip");
    expect(walkFileName("Castle.ZIP")).toBe("Castle-walk.zip");
    expect(walkFileName("castle")).toBe("castle-walk.zip");
  });

  it("puts the whole recording, byte for byte, into the walk's zip, and the tour carries none of the walk, also after the next save", async () => {
    const { session, manifest, bytes } = await walkTour();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect((await editor.walkEntries()).sort()).toEqual(walkNames);
    editor.editText("a", "Moved with the walk");
    const move = await editor.moveWalkOut();
    if (move.kind !== "ready") throw new Error(move.reason);
    expect(move.walk.filename).toBe("tour-walk.zip");
    // The whole recording (the M4b milestone review #8): the frame the
    // baked spot shows too, which the tour keeps for its visitors - and a
    // note naming the tour it came from.
    const recording = [...walkNames, "images/frame-000002.jpg"].sort();
    expect(await namesIn(move.walk.blob)).toEqual(
      [...recording, WALK_NOTE].sort(),
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
    for (const name of walkNames) expect(tourNames).not.toContain(name);
    expect(tourNames).toContain("images/frame-000002.jpg");
    // The pending edit rides along, as in any save.
    expect((await carried(move.save.blob)).objects[0]).toMatchObject({
      label: "Moved with the walk",
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
      label: "After the move",
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
    expect((await editor.walkEntries()).sort()).toEqual(walkNames);
    const saved = await editor.save({ keepScan: true });
    const names = await namesIn(saved.blob);
    for (const name of walkNames) expect(names).toContain(name);
    await session.close();
  });

  it("refuses while the recorded photos still need the walk, and for a tour without one", async () => {
    const unbaked = await walkTour(false);
    const editor = createEditorSession({
      session: unbaked.session,
      manifest: unbaked.manifest,
      levels: new Map(),
    });
    const refused = await editor.moveWalkOut();
    expect(refused.kind).toBe("refused");
    expect(refused.kind === "refused" && refused.reason).toMatch(
      /recorded photos/,
    );
    // Refused: the tour keeps its walk (unbaked, its frames are the
    // visitors' photo ring, not the walk).
    expect(await editor.walkEntries()).toEqual(
      expect.arrayContaining(["session.json", "actions/000001.json"]),
    );
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
    expect((await editor.walkEntries()).sort()).toEqual(walkNames);
    await session.close();
  });

  it("names the tour the walk came from in a note inside the walk's zip", async () => {
    // Why (the M4b milestone review #8): a walk file on its own says
    // nothing of the tour it belongs to; the note does - the tour's file,
    // its name and, for a listed tour, its series.
    const fixture = await buildListedTourFixture(
      {
        "tour.json": serializeTourManifest(
          tourOf([pin("a")], {
            title: "Castle walk",
            captureSpots: WALK_SPOTS,
          }),
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
      WALK_NOTE,
    );
    expect(note).toBeDefined();
    const text = new TextDecoder().decode(note);
    expect(text).toContain("castle.zip");
    expect(text).toContain("Castle walk");
    expect(text).toContain("Fx7qT2mK9pL4sV8bN1rW6a");
    await session.close();
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

  it("moves out a walk that places nothing - one on which no photo of the tour was taken - and a lean save leaves it out too", async () => {
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
    const tour = async (): Promise<EditorSession> => {
      const session = await openTourFile(
        new File([zip], "walked.zip", { type: "application/zip" }),
      );
      return createEditorSession({
        session,
        manifest: (await session.loadTourManifest())!,
        levels: new Map(),
      });
    };
    const original = await namesIn(zip);
    const walk = original.filter((n) => n !== "tour.json");
    expect(walk).toEqual(expect.arrayContaining(["session.json"]));
    const editor = await tour();
    const move = await editor.moveWalkOut();
    if (move.kind !== "ready") throw new Error(move.reason);
    expect(await namesIn(move.walk.blob)).toEqual([...walk, WALK_NOTE].sort());
    expect(await namesIn(move.save.blob)).toEqual(["tour.json"]);
    // The lean save (the editor's download without "keep the walk") leaves
    // it out as well, and says nothing about photos that do not exist.
    const lean = await (await tour()).save({ keepScan: false });
    expect(await namesIn(lean.blob)).toEqual(["tour.json"]);
    expect(lean.notPlaced).toBeUndefined();
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
      { id: "a", label: "pending" },
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
    expect(selectTourDocument(store.getState()).written).toEqual(
      second.manifest,
    );
    expect(now.changeCount()).toBe(0);
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
      json.stations as { id: string; geo: { lat: number }; items: unknown[] }[]
    ).find((s) => s.id === station.id)!;
    expect(written.geo.lat).toBeCloseTo(geo.lat, 12);
    expect(written.items).toEqual(
      JSON.parse(JSON.stringify(station.items)) as unknown[],
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
