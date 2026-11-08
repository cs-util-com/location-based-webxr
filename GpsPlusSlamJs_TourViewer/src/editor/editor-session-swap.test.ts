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
import { createTourViewerStore } from "../tour-viewer-session.js";
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
    store: createTourViewerStore(),
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
      swapAsset: (asset) => {
        const taken = late.editor?.contentOf(asset.path) !== undefined;
        seen.push(`${asset.path} ${taken ? "taken" : "not yet"}`);
        return Promise.resolve(false);
      },
    };
    const editor = createEditorSession({
      session,
      manifest: MANIFEST,
      levels: new Map(),
      store: createTourViewerStore(),
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
