/**
 * Why these tests matter: a file brought into the tour (here a voice, the
 * first page that brings one in) lives in ONE files table of the session,
 * named by its content hash, until a save writes it. The same bytes must
 * be one file however often they come; the draft must hold the bytes
 * before the record naming them, so a reload brings both back and the
 * save after it writes the same bytes; a file the draft could not keep
 * must be said; and a type the tour cannot carry is refused in words.
 * Real zips, read back with the viewer's opener.
 */
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourBlockAssetIds } from "gps-plus-slam-app-framework/ar/tour-kinds";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { manifestToWrite } from "../tour-document.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { editorStore } from "../test-support/editor-store.js";
import { tourOf, withWorldObjects } from "../test-support/tour-of.js";
import {
  freeDraftLocks,
  memoryDraftStores,
  type MemoryDraftStores,
} from "../test-support/memory-draft-stores.js";
import { createEditorDraft, type EditorDraft } from "./editor-draft.js";
import { createEditorSession, type EditorSession } from "./editor-session.js";
import { stationContent, storyOf } from "../test-support/station-content.js";

const K = "local-file:00000000000000000000000000000009";

function essay(id: string, lat: number): TourObject {
  return {
    id,
    kind: "longText",
    view: "reading",
    title: `Essay ${id}`,
    body: "The mill turned all day.",
    createdAtIso: "2026-11-07T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

const MANIFEST = parseTourManifest(
  JSON.parse(
    serializeTourManifest(tourOf([essay("t1", 48.52), essay("t2", 48.5204)])),
  ),
);

async function openedTour(): Promise<TourSession> {
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(MANIFEST) },
  ]);
  return openTourFile(new File([zip], "tour.zip", { type: "application/zip" }));
}

function draftOf(stores: MemoryDraftStores, unread?: () => void): EditorDraft {
  return createEditorDraft({
    openStore: stores.open,
    holdLock: freeDraftLocks,
    noBackup: () => undefined,
    ...(unread === undefined ? {} : { unreadDraft: unread }),
  });
}

function editorOf(
  session: TourSession,
  draft?: EditorDraft,
): { editor: EditorSession; state: () => TourManifest | null } {
  const store = editorStore();
  const editor = createEditorSession({
    session,
    manifest: MANIFEST,
    levels: new Map(),
    store,
    ...(draft === undefined ? {} : { draft: draft.writes() }),
  });
  return {
    editor,
    state: () => manifestToWrite(store.getState().tourDocument),
  };
}

async function savedTour(blob: Blob): Promise<{
  tour: ReturnType<typeof withWorldObjects>;
  bytes: Uint8Array;
}> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder().decode(
    readStoredEntryBytes(bytes, "tour.json"),
  );
  return { tour: withWorldObjects(parseTourManifest(JSON.parse(text))), bytes };
}

function entryText(bytes: Uint8Array, path: string): string {
  return new TextDecoder().decode(readStoredEntryBytes(bytes, path));
}

describe("addFile: the files table", () => {
  it("names a file by its bytes, keeps it once however often it comes, and reads it back by its entry", async () => {
    const session = await openedTour();
    const { editor } = editorOf(session);
    const before = editor.tourBytes();
    const first = await editor.addFile(new Blob(["voice-1"]), "Take 1.MP3");
    if (first.kind !== "added") throw new Error(first.reason);
    expect(first.asset.id).toMatch(/^[0-9a-f]{64}$/);
    expect(first.asset).toMatchObject({
      path: `content/${first.asset.id}.mp3`,
      kind: "audio",
    });
    expect(first.backedUp).toBe(true);
    const again = await editor.addFile(new Blob(["voice-1"]), "copy.mp3");
    expect(again).toMatchObject({ kind: "added", asset: first.asset });
    expect(editor.addedBytes()).toBe(7);
    expect(editor.tourBytes()).toBe(before + 7);
    expect(await editor.contentOf(first.asset.path)?.text()).toBe("voice-1");
    expect(editor.contentOf("content/ghost.mp3")).toBeUndefined();
    await session.close();
  });

  // Why: a file brought in that no edit came to name (a narration that did
  // not apply, an add given up) is listed but left out of the next save.
  // Whether a large tour may still save by itself is judged by what that
  // save writes, so such a file must not count there.
  it("counts a file nothing names only among the added bytes, not among those a save keeps", async () => {
    const session = await openedTour();
    const { editor } = editorOf(session);
    const orphan = await editor.addFile(new Blob(["voice-1"]), "Take 1.mp3");
    expect(orphan.kind).toBe("added");
    expect(editor.addedBytes()).toBe(7);
    expect(editor.nextSaveBytes()).toBe(editor.tourBytes() - 7);
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["voice-1"]),
      fileName: "again.mp3",
    });
    expect(editor.nextSaveBytes()).toBe(editor.tourBytes());
    await session.close();
  });

  it("refuses in words a type the tour cannot take, or not here, changing nothing", async () => {
    const session = await openedTour();
    const { editor } = editorOf(session);
    const notes = await editor.addFile(new Blob(["x"]), "notes.txt");
    expect(notes).toMatchObject({ kind: "refused" });
    expect("reason" in notes && notes.reason).toMatch(/mp3/);
    const picture = await editor.addFile(new Blob(["x"]), "a.png", ["audio"]);
    expect(picture).toMatchObject({ kind: "refused" });
    expect("reason" in picture && picture.reason).not.toMatch(/png/);
    expect(editor.addedBytes()).toBe(0);
    await session.close();
  });

  it("one recording narrating two texts is one file in the save", async () => {
    const session = await openedTour();
    const { editor } = editorOf(session);
    for (const id of ["t1", "t2"]) {
      await editor.editNarration(id, {
        kind: "voice",
        file: new Blob(["the-voice"]),
        fileName: "voice.wav",
      });
    }
    const { tour, bytes } = await savedTour(
      (await editor.save({ keepScan: false })).blob,
    );
    const audios = tour.objects.map((o) =>
      o.kind === "longText" ? (o.narration?.audio ?? null) : null,
    );
    expect(audios.every((a) => a !== null)).toBe(true);
    expect(new Set(audios).size).toBe(1);
    const voices = tour.assets.filter((a) => a.kind === "audio");
    expect(voices).toHaveLength(1);
    expect(entryText(bytes, voices[0]?.path ?? "")).toBe("the-voice");
    await session.close();
  });
});

describe("the files across a reload", () => {
  it("says a voice whose file the draft could not keep", async () => {
    const session = await openedTour();
    const stores = memoryDraftStores();
    const draft = draftOf(stores);
    await draft.open(K, MANIFEST);
    const { editor } = editorOf(session, draft);
    stores.failPutsOf = /^asset:/;
    expect(
      await editor.editNarration("t1", {
        kind: "voice",
        file: new Blob(["v"]),
        fileName: "v.mp3",
      }),
    ).toEqual({ kind: "edited", notBackedUp: true });
    draft.close();
    await session.close();
  });

  it("brings a voice back with its file, and the save after it writes the same bytes", async () => {
    const session = await openedTour();
    const stores = memoryDraftStores();
    const draft = draftOf(stores);
    await draft.open(K, MANIFEST);
    const { editor } = editorOf(session, draft);
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["RIFF-kept"]),
      fileName: "kept.wav",
    });
    await draft.idle();
    draft.close();

    const again = draftOf(stores);
    const { offer } = await again.open(K, MANIFEST);
    expect(offer?.files).toHaveLength(1);
    const { editor: reloaded } = editorOf(session, again);
    reloaded.restore(offer!);
    expect(await reloaded.narration("t1")).toMatchObject({ hasVoice: true });
    const { tour, bytes } = await savedTour(
      (await reloaded.save({ keepScan: false })).blob,
    );
    const path = tour.assets.find((a) => a.kind === "audio")?.path ?? "";
    expect(entryText(bytes, path)).toBe("RIFF-kept");
    again.close();
    await session.close();
  });
});

/** Why this test matters: a full disk refuses the voice's bytes, and the
 *  visitor keeps writing in that long text; a closed tab must bring the
 *  text back. The draft must not keep a narration naming a file it does
 *  not hold, or the reopen leaves the whole record out. */
describe("a voice the draft could not keep", () => {
  it("leaves the text edits of its long text in the draft", async () => {
    const session = await openedTour();
    const stores = memoryDraftStores();
    const draft = draftOf(stores);
    await draft.open(K, MANIFEST);
    const { editor } = editorOf(session, draft);
    stores.failPutsOf = /^asset:/;
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["lost-voice"]),
      fileName: "v.mp3",
    });
    expect(editor.editBlockField("t1", "body", "Typed after.")).toEqual({
      kind: "edited",
    });
    await draft.idle();
    draft.close();
    stores.failPutsOf = null;

    let unread = 0;
    const again = draftOf(stores, () => {
      unread += 1;
    });
    const { offer } = await again.open(K, MANIFEST);
    const t1 = offer?.objects.find((o) => o.id === "t1");
    expect(t1).toMatchObject({ kind: "longText", body: "Typed after." });
    expect(t1 !== undefined && "narration" in t1).toBe(false);
    expect(unread).toBe(0);
    again.close();
    await session.close();
  });
});

/** Why this test matters: the draft hands its files back as the browser
 *  stores them, a snapshot of an entry that a landed save then removes
 *  (the written file holds the bytes now). The session must not depend on
 *  that entry afterwards: a preview of the restored voice, and a later save
 *  that needs it again (an undo bringing it back), must still have its
 *  bytes. */
describe("a restored file after the draft let it go", () => {
  it("still reads, and is still saved, after a landed save removed its entry", async () => {
    const session = await openedTour();
    const stores = memoryDraftStores();
    stores.snapshotBlobs = true;
    const draft = draftOf(stores);
    await draft.open(K, MANIFEST);
    const { editor } = editorOf(session, draft);
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["RIFF-kept"]),
      fileName: "kept.wav",
    });
    await draft.idle();
    draft.close();

    const again = draftOf(stores);
    const { offer } = await again.open(K, MANIFEST);
    const { editor: reloaded } = editorOf(session, again);
    reloaded.restore(offer!);
    const first = await reloaded.save({ keepScan: false });
    again.writes().landed(first.written, K);
    await again.idle();
    const path = (await savedTour(first.blob)).tour.assets.find(
      (a) => a.kind === "audio",
    )?.path;
    expect(path).toBeDefined();
    expect(await reloaded.contentOf(path ?? "")?.text()).toBe("RIFF-kept");

    await reloaded.editNarration("t1", { kind: "removeVoice" });
    again
      .writes()
      .landed((await reloaded.save({ keepScan: false })).written, K);
    reloaded.undo();
    const { tour, bytes } = await savedTour(
      (await reloaded.save({ keepScan: false })).blob,
    );
    const voice = tour.assets.find((a) => a.kind === "audio")?.path ?? "";
    expect(entryText(bytes, voice)).toBe("RIFF-kept");
    again.close();
    await session.close();
  });
});

/** Why this test matters: a copied photo's picture lives only in the
 *  draft until a save writes it. The draft hands it back as the browser
 *  stores it, a snapshot of its entry, and the restore writes the copy's
 *  record and picture into that same entry again. A snapshot still held
 *  then stops reading, and every save after the restore fails while the
 *  zip is built - a reload and a second restore loop back to it. */
describe("a restored copy of a photo", () => {
  function photo(id: string): TourObject {
    return {
      id,
      kind: "picture",
      view: "plane",
      image: id,
      widthM: 1,
      imageAsset: {
        id,
        path: `content/${id}.jpg`,
        kind: "image",
        width: 4,
        height: 3,
      },
      createdAtIso: "2026-11-07T00:00:00.000Z",
      geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
    };
  }

  it("is saved with its picture after a closed tab and a restore", async () => {
    const manifest = parseTourManifest(
      JSON.parse(serializeTourManifest(tourOf([photo("f")]))),
    );
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(manifest) },
      { path: "content/f.jpg", data: "the picture of f" },
    ]);
    const session = await openTourFile(
      new File([zip], "tour.zip", { type: "application/zip" }),
    );
    const stores = memoryDraftStores();
    stores.snapshotBlobs = true;
    const editorOver = (draft: EditorDraft): EditorSession =>
      createEditorSession({
        session,
        manifest,
        levels: new Map(),
        store: editorStore(),
        draft: draft.writes(),
      });
    const draft = draftOf(stores);
    await draft.open(K, manifest);
    const copy = await editorOver(draft).duplicateObject("f");
    if (copy.kind !== "duplicated") throw new Error(copy.kind);
    await draft.idle();
    draft.close();

    const again = draftOf(stores);
    const { offer } = await again.open(K, manifest);
    expect(offer?.made).toEqual([copy.id]);
    const reloaded = editorOver(again);
    reloaded.restore(offer!);
    await again.idle();
    const { tour, bytes } = await savedTour(
      (await reloaded.save({ keepScan: false })).blob,
    );
    const copied = tour.objects.find((o) => o.id === copy.id);
    const path =
      copied?.kind === "picture" ? (copied.imageAsset?.path ?? "") : "";
    expect(path).not.toBe("");
    expect(entryText(bytes, path)).toBe("the picture of f");
    again.close();
    await session.close();
  });
});

/** Why this property matters: whatever mix of voices brought in, taken off
 *  and undone, the draft must hold a document that reloads as the one the
 *  page showed, and every file a record names must come back with it - a
 *  named file missing would fail every later save. */
describe("property: a reload after any voices, removals and undos", () => {
  type Step =
    | { kind: "voice"; id: "t1" | "t2"; take: number }
    | { kind: "remove"; id: "t1" | "t2" }
    | { kind: "undo" };
  const essayId = fc.constantFrom("t1" as const, "t2" as const);
  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.record({
      kind: fc.constant("voice" as const),
      id: essayId,
      take: fc.integer({ min: 0, max: 2 }),
    }),
    fc.record({ kind: fc.constant("remove" as const), id: essayId }),
    fc.record({ kind: fc.constant("undo" as const) }),
  );

  it("equals the document, every named file present", async () => {
    const session = await openedTour();
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 8 }), async (steps) => {
        const stores = memoryDraftStores();
        const draft = draftOf(stores);
        await draft.open(K, MANIFEST);
        const { editor, state } = editorOf(session, draft);
        for (const s of steps) {
          if (s.kind === "undo") editor.undo();
          else if (s.kind === "remove") {
            await editor.editNarration(s.id, { kind: "removeVoice" });
          } else {
            await editor.editNarration(s.id, {
              kind: "voice",
              file: new Blob([`take-${String(s.take)}`]),
              fileName: `take-${String(s.take)}.mp3`,
            });
          }
        }
        const shown = state();
        await draft.idle();
        draft.close();

        let unread = 0;
        const again = draftOf(stores, () => {
          unread += 1;
        });
        const { offer } = await again.open(K, MANIFEST);
        const { editor: reloaded, state: reloadedState } = editorOf(
          session,
          again,
        );
        if (offer !== null) reloaded.restore(offer);
        expect(unread).toBe(0);
        expect(withWorldObjects(reloadedState()!).objects).toEqual(
          withWorldObjects(shown!).objects,
        );
        const { tour, bytes } = await savedTour(
          (await reloaded.save({ keepScan: false })).blob,
        );
        for (const object of tour.objects) {
          for (const id of tourBlockAssetIds(object)) {
            const path = tour.assets.find((a) => a.id === id)?.path;
            expect(path).toBeDefined();
            expect(readStoredEntryBytes(bytes, path ?? "")).toBeDefined();
          }
        }
        again.close();
      }),
      { numRuns: 40 },
    );
    await session.close();
  });
});

describe("a duplicated story's pictures", () => {
  // Why: a story's copy names the same image files as the original (only
  // the story and its children get new ids), on purpose: the bytes are
  // identical, and a save keeps every file any block still names. This
  // pins that the sharing is safe: deleting the original must not take
  // the copy's picture with it, or the copy would save naming a file the
  // tour no longer carries.
  it("keeps the picture's file after the original is deleted and the tour saved", async () => {
    const pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
    const manifest = parseTourManifest(
      JSON.parse(
        serializeTourManifest(
          tourOf([], {
            assets: [
              {
                id: "art",
                path: "content/art.jpg",
                kind: "image",
                width: 4,
                height: 3,
              },
            ],
            stations: [
              {
                id: "mill",
                title: "The mill",
                geo: {
                  lat: 48.52,
                  lon: 9.05,
                  alt: 340,
                  rotation: [0, 0, 0, 1],
                },
                activateRadiusM: 50,
                foundRadiusM: 25,
                hint: "arrow",
                ...stationContent([
                  storyOf("tale", [
                    {
                      id: "pic",
                      kind: "picture",
                      view: "plane",
                      image: "art",
                      widthM: 1,
                      pose,
                    },
                  ]),
                ]),
              },
            ],
          }),
        ),
      ),
    );
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(manifest) },
      { path: "content/art.jpg", data: "the miller's portrait" },
    ]);
    const session = await openTourFile(
      new File([zip], "tour.zip", { type: "application/zip" }),
    );
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store: editorStore(),
    });
    const copy = editor.duplicateStory("tale");
    if (copy.kind !== "duplicated") throw new Error(copy.kind);
    expect(editor.deleteStory("tale").kind).toBe("deleted");

    const blob = (await editor.save({ keepScan: false })).blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const saved = parseTourManifest(JSON.parse(entryText(bytes, "tour.json")));
    const story = saved.stations[0]?.children[0];
    expect(story?.id).toBe(copy.id);
    expect(saved.assets.map((a) => a.id)).toEqual(["art"]);
    expect(entryText(bytes, "content/art.jpg")).toBe("the miller's portrait");
    await session.close();

    // The saved file opened in a fresh session, whose undo history holds
    // nothing that still names "art", and saved again: only the copy's own
    // picture can keep the file now, so a save that ignored which files
    // the copy names would drop it here.
    const reopened = await openTourFile(
      new File([blob], "tour.zip", { type: "application/zip" }),
    );
    const fresh = createEditorSession({
      session: reopened,
      manifest: saved,
      levels: new Map(),
      store: editorStore(),
    });
    const again = new Uint8Array(
      await (await fresh.save({ keepScan: false })).blob.arrayBuffer(),
    );
    const resaved = parseTourManifest(
      JSON.parse(entryText(again, "tour.json")),
    );
    const copyStory = resaved.stations[0]?.children[0];
    expect(copyStory?.id).toBe(copy.id);
    expect(
      copyStory?.kind === "folder"
        ? copyStory.children.flatMap((c) => tourBlockAssetIds(c))
        : [],
    ).toEqual(["art"]);
    expect(resaved.assets.map((a) => a.id)).toEqual(["art"]);
    expect(entryText(again, "content/art.jpg")).toBe("the miller's portrait");
    await reopened.close();
  });
});
