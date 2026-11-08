/**
 * Why these tests matter: a voice brought in is made smaller in the
 * background while the author keeps editing and saving. A save never
 * waits, so it may write the original first; the smaller file then lands
 * (`swapAsset`) under the same asset id. The next save must write the new
 * entry and REMOVE the old one - the written file already lists the id, so
 * the old rule ("listed means written") would keep the original forever -
 * and a save already running when the swap lands must not lose it. Real
 * zips, read back with the viewer's opener.
 */
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { openTourFile, type TourSession } from "../tour-session.js";
import { tourDocumentActions } from "../tour-document.js";
import { editorStore } from "../test-support/editor-store.js";
import { tourOf } from "../test-support/tour-of.js";
import { zipBlobEntryNames } from "../zip-blob.js";
import {
  createEditorSession,
  type EditorSession,
  type EditorSessionDraft,
} from "./editor-session.js";

const ESSAY: TourObject = {
  id: "t1",
  kind: "longText",
  view: "reading",
  title: "Essay",
  body: "The mill turned all day.",
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
};

const MANIFEST = parseTourManifest(
  JSON.parse(serializeTourManifest(tourOf([ESSAY]))),
);

async function openedTour(): Promise<TourSession> {
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(MANIFEST) },
  ]);
  return openTourFile(new File([zip], "tour.zip", { type: "application/zip" }));
}

function editorOf(session: TourSession): EditorSession {
  return createEditorSession({
    session,
    manifest: MANIFEST,
    levels: new Map(),
    store: editorStore(),
  });
}

/** The narrated essay, its voice's id, and its original path. */
async function narrated(
  editor: EditorSession,
): Promise<{ id: string; wav: string; opus: string }> {
  await editor.editNarration("t1", {
    kind: "voice",
    file: new Blob(["RIFF-original-voice"]),
    fileName: "voice.wav",
  });
  const facts = await editor.narration("t1");
  if (facts.kind !== "narration" || facts.audioId === null) {
    throw new Error("no voice");
  }
  const id = facts.audioId;
  return { id, wav: `content/${id}.wav`, opus: `content/${id}.opus` };
}

async function saved(blob: Blob): Promise<{
  tour: TourManifest;
  names: string[];
  bytes: Uint8Array;
}> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder().decode(
    readStoredEntryBytes(bytes, "tour.json"),
  );
  return {
    tour: parseTourManifest(JSON.parse(text)),
    names: await zipBlobEntryNames(blob),
    bytes,
  };
}

function entryText(bytes: Uint8Array, path: string): string {
  return new TextDecoder().decode(readStoredEntryBytes(bytes, path));
}

describe("swapAsset: the smaller file replaces the original", () => {
  it("a save before the swap writes the original; the save after it writes the new entry and the old one is gone", async () => {
    const session = await openedTour();
    const editor = editorOf(session);
    const { id, wav, opus } = await narrated(editor);
    const first = await saved((await editor.save({ keepScan: false })).blob);
    expect(first.names).toContain(wav);

    expect(
      await editor.swapAsset(id, {
        blob: new Blob(["OggS-small"]),
        path: opus,
      }),
    ).toEqual({ kind: "swapped", backedUp: true });
    expect(await editor.contentOf(opus)?.text()).toBe("OggS-small");

    const second = await saved((await editor.save({ keepScan: false })).blob);
    expect(second.names).toContain(opus);
    expect(second.names).not.toContain(wav);
    expect(entryText(second.bytes, opus)).toBe("OggS-small");
    expect(second.tour.assets.filter((a) => a.id === id)).toEqual([
      { id, path: opus, kind: "audio" },
    ]);
    // The narration still names the same id: no item changed.
    expect(await editor.narration("t1")).toMatchObject({ audioId: id });
    // And a third save keeps it, not writing it again from the table.
    const third = await saved((await editor.save({ keepScan: false })).blob);
    expect(third.names.filter((n) => n.startsWith("content/"))).toEqual([opus]);
    await session.close();
  });

  it("a swap before the first save writes only the new entry", async () => {
    const session = await openedTour();
    const editor = editorOf(session);
    const { id, wav, opus } = await narrated(editor);
    await editor.swapAsset(id, { blob: new Blob(["OggS-small"]), path: opus });
    const { names } = await saved(
      (await editor.save({ keepScan: false })).blob,
    );
    expect(names).toContain(opus);
    expect(names).not.toContain(wav);
    await session.close();
  });

  // Why: a save snapshots the document when it starts. The swap landing
  // while it runs must not be lost: that save writes the original, and the
  // next one writes the new file (derived from the paths, never a flag a
  // landing could clear).
  it("a save already running when the swap lands writes the original, and the next save the new file", async () => {
    const session = await openedTour();
    const editor = editorOf(session);
    const { id, wav, opus } = await narrated(editor);
    const running = editor.save({ keepScan: false });
    const swap = editor.swapAsset(id, {
      blob: new Blob(["OggS-small"]),
      path: opus,
    });
    const first = await saved((await running).blob);
    expect(await swap).toMatchObject({ kind: "swapped" });
    expect(first.names).toContain(wav);
    expect(first.names).not.toContain(opus);
    const next = await saved((await editor.save({ keepScan: false })).blob);
    expect(next.names).toContain(opus);
    expect(next.names).not.toContain(wav);
    await session.close();
  });

  it("refuses in words an id the tour does not hold or a path of another kind, changing nothing", async () => {
    const session = await openedTour();
    const editor = editorOf(session);
    const { id, wav } = await narrated(editor);
    const ghost = "f".repeat(64);
    expect(
      await editor.swapAsset(ghost, {
        blob: new Blob(["x"]),
        path: `content/${ghost}.opus`,
      }),
    ).toMatchObject({ kind: "refused" });
    expect(
      await editor.swapAsset(id, {
        blob: new Blob(["x"]),
        path: `content/${id}.webp`,
      }),
    ).toMatchObject({ kind: "refused" });
    expect(await editor.contentOf(wav)?.text()).toBe("RIFF-original-voice");
    await session.close();
  });
});

/** A captured photo `f` whose picture is `content/f.jpg`. */
const PHOTO: TourObject = {
  id: "f",
  kind: "picture",
  view: "plane",
  image: "f",
  widthM: 1,
  imageAsset: {
    id: "f",
    path: "content/f.jpg",
    kind: "image",
    width: 4000,
    height: 3000,
  },
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
};

describe("the size a swap leaves", () => {
  // Why: the autosave writes the tour in place only below a cap, judged by
  // what the next save rewrites (`nextSaveBytes`). After a swap that save
  // removes the old entry, so a count that only adds the new file judges
  // the tour by the original and the smaller one together - a tour the
  // swap brought under the cap would still be refused. The slack covers
  // the manifest and the zip headers (about a kilobyte), against a
  // 200 kB difference, so the verdict holds for any slack from 0.5 to
  // 100 kB.
  it("nextSaveBytes and tourBytes count the new file in place of the old entry", async () => {
    const session = await openedTour();
    const editor = editorOf(session);
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["RIFF", "x".repeat(200_000)]),
      fileName: "voice.wav",
    });
    const facts = await editor.narration("t1");
    if (facts.kind !== "narration" || facts.audioId === null) {
      throw new Error("no voice");
    }
    const id = facts.audioId;
    await editor.save({ keepScan: false });
    await editor.swapAsset(id, {
      blob: new Blob(["OggS-small"]),
      path: `content/${id}.opus`,
    });
    const predicted = editor.nextSaveBytes();
    const weighed = editor.tourBytes();
    const actual = (await editor.save({ keepScan: false })).blob.size;
    expect(Math.abs(predicted - actual)).toBeLessThan(2_000);
    expect(Math.abs(weighed - actual)).toBeLessThan(2_000);
    await session.close();
  });
});

describe("swapAsset of a placed picture", () => {
  // Why: a placed picture carries its image asset inline, and that inline
  // record still names the old path after a swap (the id stays, so no item
  // changes). Every reader in the session asks for the file by the path
  // the picture names: it must get the smaller file, and a copy of the
  // photo must take the new file's type, or the copy's entry would hold
  // WebP bytes under a .jpg name.
  it("the old path reads the smaller file, and a copy takes its type", async () => {
    const manifest = parseTourManifest(
      JSON.parse(serializeTourManifest(tourOf([PHOTO]))),
    );
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(manifest) },
      { path: "content/f.jpg", data: "JPEG-original" },
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
    expect(
      await editor.swapAsset("f", {
        blob: new Blob(["RIFF-webp-small"]),
        path: "content/f.webp",
        width: 1600,
        height: 1200,
      }),
    ).toEqual({ kind: "swapped", backedUp: true });
    expect(await editor.contentOf("content/f.jpg")?.text()).toBe(
      "RIFF-webp-small",
    );

    const copy = await editor.duplicateObject("f");
    if (copy.kind !== "duplicated") throw new Error(copy.kind);
    const { tour, names, bytes } = await saved(
      (await editor.save({ keepScan: false })).blob,
    );
    expect(tour.assets.find((a) => a.id === copy.id)).toEqual({
      id: copy.id,
      path: `content/${copy.id}.webp`,
      kind: "image",
      width: 1600,
      height: 1200,
    });
    expect(entryText(bytes, `content/${copy.id}.webp`)).toBe("RIFF-webp-small");
    expect(names).not.toContain("content/f.jpg");
    expect(names).not.toContain(`content/${copy.id}.jpg`);
    await session.close();
  });
});

describe("swapAsset with a draft, and a restore of a swap", () => {
  // Why: the draft is what brings a swap back after a crash, so it is
  // written first; the table and the document take the swap only once the
  // draft answered, together, and the page is told when it was not kept.
  it("writes the draft first, then the table and the document take it", async () => {
    const session = await openedTour();
    const seen: string[] = [];
    const late: { editor?: EditorSession } = {};
    const draft: EditorSessionDraft = {
      saveObject: () => Promise.resolve(true),
      saveDeletion: () => Promise.resolve(true),
      forgetDeletion: () => Promise.resolve(true),
      forgetObject: () => Promise.resolve(),
      saveSettings: () => Promise.resolve(true),
      saveAsset: () => Promise.resolve(true),
      swapAsset: (asset, blob) => {
        // The old path reads the asset too (by id): the bytes say which.
        const taken = late.editor?.contentOf(asset.path) === blob;
        seen.push(`${asset.path} ${taken ? "taken" : "not yet"}`);
        return Promise.resolve(false);
      },
    };
    const editor = createEditorSession({
      session,
      manifest: MANIFEST,
      levels: new Map(),
      store: editorStore(),
      draft,
    });
    late.editor = editor;
    const { id, opus } = await narrated(editor);
    expect(
      await editor.swapAsset(id, {
        blob: new Blob(["OggS-small"]),
        path: opus,
      }),
    ).toEqual({ kind: "swapped", backedUp: false });
    expect(seen).toEqual([`${opus} not yet`]);
    expect(await editor.contentOf(opus)?.text()).toBe("OggS-small");
    await session.close();
  });

  // Why: the draft is written before the second check, so a swap the
  // second check refuses (another open replaced this one while the draft
  // wrote) would stay in the draft and come back on the next open as a
  // file nobody chose for that tour. It is taken back out: the draft is
  // given the record that stood before.
  it("a swap refused after the draft wrote it is taken back out of the draft", async () => {
    const session = await openedTour();
    const store = editorStore();
    const calls: string[] = [];
    const draft: EditorSessionDraft = {
      saveObject: () => Promise.resolve(true),
      saveDeletion: () => Promise.resolve(true),
      forgetDeletion: () => Promise.resolve(true),
      forgetObject: () => Promise.resolve(),
      saveSettings: () => Promise.resolve(true),
      saveAsset: () => Promise.resolve(true),
      swapAsset: (asset) => {
        calls.push(asset.path);
        if (calls.length === 1) {
          store.dispatch(
            tourDocumentActions.opened({ manifest: MANIFEST, newTourId: "x" }),
          );
        }
        return Promise.resolve(true);
      },
    };
    const editor = createEditorSession({
      session,
      manifest: MANIFEST,
      levels: new Map(),
      store,
      draft,
    });
    const { id, wav, opus } = await narrated(editor);
    expect(
      await editor.swapAsset(id, { blob: new Blob(["OggS"]), path: opus }),
    ).toMatchObject({ kind: "refused" });
    expect(calls).toEqual([opus, wav]);
    await session.close();
  });

  // Why: after a reload the draft offers a smaller file for an asset the
  // written tour already lists. Put back as an ordinary file it would be
  // skipped (the id is listed), and the next save would write the original
  // again; put back as a swap, it counts as a change and is written.
  it("a restore puts a smaller file for a written asset back as a swap", async () => {
    const session = await openedTour();
    const editor = editorOf(session);
    const { id, wav, opus } = await narrated(editor);
    await editor.save({ keepScan: false });
    expect(
      editor.restore({
        objects: [],
        deleted: [],
        files: [
          {
            asset: { id, path: opus, kind: "audio" },
            blob: new Blob(["OggS-small"]),
          },
        ],
      }),
    ).toEqual({ changed: 1, deleted: 0 });
    const next = await saved((await editor.save({ keepScan: false })).blob);
    expect(next.names).toContain(opus);
    expect(next.names).not.toContain(wav);
    expect(entryText(next.bytes, opus)).toBe("OggS-small");
    await session.close();
  });
});
