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
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  openTourFile,
  tourFileKeyOfFile,
  type TourSession,
} from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  createEditorSession,
  NOT_IN_TOUR,
  type EditorSessionDraft,
} from "./editor-session.js";

/** The undo of a delete that was made; a refusal fails the test. */
function undoOf(
  outcome: { kind: "deleted"; undo: () => boolean } | { kind: "refused" },
): () => boolean {
  if (outcome.kind !== "deleted") throw new Error("the delete was refused");
  return outcome.undo;
}

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

async function opened(
  objects: readonly TourObject[],
  extra: Partial<TourManifest> = {},
): Promise<{
  session: TourSession;
  manifest: TourManifest;
}> {
  const manifest = {
    ...createEmptyTourManifest(),
    ...extra,
    objects: [...objects],
  };
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

async function carried(blob: Blob): Promise<TourManifest> {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    "tour.json",
  );
  return parseTourManifest(JSON.parse(new TextDecoder().decode(bytes)));
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
    expect(tour.objects[1]?.geo).toMatchObject({ lat: 48.53, lon: 9.06 });
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
    const undo = undoOf(editor.remove("a"));
    expect(editor.model().items.map((i) => i.id)).toEqual(["b"]);
    undo();
    expect(editor.model().items.map((i) => i.id)).toEqual(["a", "b"]);
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

  it("refuses an undo once a save wrote the delete", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const undo = undoOf(editor.remove("a"));
    await editor.save({ keepScan: false });
    expect(undo()).toBe(false);
    expect(editor.model().items.map((i) => i.id)).toEqual(["b"]);
    await session.close();
  });

  // Why (E2b plan review #2, DEC-A3): a save that was already running when
  // the delete was made did not write it, so its end must not end the
  // undo - it silently did, and the creator's Undo tap did nothing.
  it("keeps the undo of a delete made while a save runs, until a save writes it", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("b", "First");
    const running = editor.save({ keepScan: false });
    const undo = undoOf(editor.remove("a"));
    await running;
    expect(undo()).toBe(true);
    expect(editor.model().items.map((i) => i.id)).toEqual(["a", "b"]);
    const again = undoOf(editor.remove("a"));
    const writes = editor.save({ keepScan: false });
    await writes;
    expect(again()).toBe(false);
    expect(
      (await carried((await writes).blob)).objects.map((o) => o.id),
    ).toEqual(["b"]);
    await session.close();
  });

  // Why (third E2p review #6): a save that snapshotted after the delete
  // writes it, so an undo while it runs would bring back a note the file
  // it is writing no longer carries.
  it("refuses the undo as soon as a save that writes the delete starts", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const undo = undoOf(editor.remove("a"));
    const writing = editor.save({ keepScan: false });
    expect(undo()).toBe(false);
    const tour = await carried((await writing).blob);
    expect(tour.objects.map((o) => o.id)).toEqual(["b"]);
    expect(editor.model().items.map((i) => i.id)).toEqual(["b"]);
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
    const undo = undoOf(editor.remove("a"));
    expect(undo()).toBe(true);
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
    expect(saved.written.objects.map((o) => o.id)).toEqual(["a", "b"]);
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
});

describe("createEditorSession, the tour's needs-no-GPS setting (QR-first M1b-2)", () => {
  // Why (owner Q-QF-1): "needs no GPS" is a tour-level edit like any
  // other - it is a pending change until a save writes it, the saved
  // tour.json carries `needsNoGps: true` at minor 2 (the framework's
  // writer), and turning it off writes the tour exactly as before (no
  // field at all, false is never written).
  it("writes needsNoGps: true at minor 2 when on, and leaves the field out when off", async () => {
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
      minor: 2,
      needsNoGps: true,
    });
    expect(on.written.needsNoGps).toBe(true);
    expect(editor.changeCount()).toBe(0);
    expect(editor.setNeedsNoGps(false)).toEqual({ kind: "changed" });
    expect(editor.changeCount()).toBe(1);
    const off = await editor.save({ keepScan: false });
    const json = await writtenJson(off.blob);
    expect(json).not.toHaveProperty("needsNoGps");
    // The title keeps it at version 2; nothing else needs a newer minor.
    expect(json).toMatchObject({ version: 2, minor: 0 });
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
      minor: 2,
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
          anchor: { geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 } },
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
    expect(editor.noGpsCheck()).toEqual({
      codeless: ["The column"],
      unlockable: [],
      codesPlace: true,
    });
    await session.close();
  });
});
