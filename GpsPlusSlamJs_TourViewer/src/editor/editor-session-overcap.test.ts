/**
 * Why these tests matter: a file over a tour's caps may come into the
 * editor to be made smaller in the background. Until a smaller file
 * replaces it, no zip may carry it - the archive's readers refuse an entry
 * over the cap, and a manifest naming an entry the zip lacks is a broken
 * tour. So every save is refused, in words naming the file and what is
 * happening to it, while the draft keeps everything; once the smaller file
 * landed the same save goes through. A reload that brings the large file
 * back from the draft is refused the same way: the rule is derived from
 * the bytes held, never from a flag a reload could lose.
 */
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { ASSET_OPTIMIZERS } from "./asset-shelf/asset-optimizers.js";
import { selectShelfRows } from "./asset-shelf/asset-shelf-slice.js";
import { fakeOptimizer } from "./asset-shelf/test-support/fake-optimizer.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { editorStore } from "../test-support/editor-store.js";
import { tourOf } from "../test-support/tour-of.js";
import { zipBlobEntryNames } from "../zip-blob.js";
import { createEditorSession, type EditorSession } from "./editor-session.js";

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

/** Caps small enough for a test: a file may be 1000 B, one up to 5000 B
 *  comes in to be made smaller. */
const LIMITS = {
  maxEntryBytes: 1_000,
  maxArchiveBytes: 1_000_000,
  marginBytes: 0,
  ceilingBytes: 5_000,
};

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
    fileReaders: { limits: LIMITS, shrinks: (kind) => kind === "audio" },
    // Nothing makes a sound smaller here: the large file has no job.
    optimizers: { ...ASSET_OPTIMIZERS, audio: null },
  });
}

const LARGE = new Blob(["RIFF", "x".repeat(3_000)]);

/** An editor whose sounds are made smaller by a fake the test finishes. */
function editorWithShelf(session: TourSession) {
  const fake = fakeOptimizer();
  const store = editorStore();
  const editor = createEditorSession({
    session,
    manifest: MANIFEST,
    levels: new Map(),
    store,
    fileReaders: { limits: LIMITS, shrinks: (kind) => kind === "audio" },
    optimizers: { ...ASSET_OPTIMIZERS, audio: fake },
    optimizerHost: {
      run: () => Promise.reject(new Error("unused")),
      close: () => undefined,
    },
  });
  return { editor, fake, rows: () => selectShelfRows(store.getState()) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const VOICE_ID = "a".repeat(64);
const VOICE_WAV = {
  id: VOICE_ID,
  path: `content/${VOICE_ID}.wav`,
  kind: "audio" as const,
};
const VOICED: TourObject = {
  ...ESSAY,
  narration: { audio: VOICE_ID, synthetic: false },
};

describe("a file over the caps, until a smaller one replaces it", () => {
  it("refuses every save in words naming the file, then saves once the smaller file landed", async () => {
    const session = await openedTour();
    // A job really runs for it: the words may say it is being made smaller.
    const { editor } = editorWithShelf(session);
    expect(
      await editor.editNarration("t1", {
        kind: "voice",
        file: LARGE,
        fileName: "long walk.wav",
      }),
    ).toEqual({ kind: "edited" });
    const facts = await editor.narration("t1");
    if (facts.kind !== "narration" || facts.audioId === null) {
      throw new Error("no voice");
    }
    const id = facts.audioId;
    const words =
      '"long walk.wav" is still too large to save - it is being made smaller. Save again once it is ready, or remove it.';
    await expect(
      editor.save({ keepScan: false, inPlace: true }),
    ).rejects.toThrow(words);
    await expect(editor.save({ keepScan: false })).rejects.toThrow(words);
    // The edit stays pending: nothing was lost.
    expect(editor.changeCount()).toBeGreaterThan(0);

    await editor.swapAsset(id, {
      blob: new Blob(["OggS-small"]),
      path: `content/${id}.opus`,
    });
    const names = await zipBlobEntryNames(
      (await editor.save({ keepScan: false, inPlace: true })).blob,
    );
    expect(names).toContain(`content/${id}.opus`);
    expect(names).not.toContain(`content/${id}.wav`);
    await session.close();
  });

  // Why: no job runs for a kind without an optimizer, so the words must
  // not claim the file is being made smaller.
  it("refuses the save after a reload brought the large file back, without claiming a job runs for it", async () => {
    const session = await openedTour();
    const editor = editorOf(session);
    const id = "a".repeat(64);
    const asset = { id, path: `content/${id}.wav`, kind: "audio" as const };
    const voiced: TourObject = {
      ...ESSAY,
      narration: { audio: id, synthetic: false },
    };
    expect(
      editor.restore({
        objects: [voiced],
        deleted: [],
        files: [{ asset, blob: LARGE }],
      }).changed,
    ).toBe(1);
    await expect(editor.save({ keepScan: false })).rejects.toThrow(
      "A sound of this tour is too large to save, and nothing is making it smaller. Use a smaller file, or remove it.",
    );
    await session.close();
  });

  // Why: a reload drops the runner's queue. Unless the large file is
  // queued again, every save stays refused for good.
  it("queues the large file again after a reload, and saves once its smaller file landed", async () => {
    const session = await openedTour();
    const { editor, fake, rows } = editorWithShelf(session);
    editor.restore({
      objects: [VOICED],
      deleted: [],
      files: [{ asset: VOICE_WAV, blob: LARGE }],
    });
    await settle();
    expect(rows().find((r) => r.id === VOICE_ID)).toMatchObject({
      origin: "added",
      status: "running",
    });
    await expect(editor.save({ keepScan: false })).rejects.toThrow(
      "is still too large to save - it is being made smaller.",
    );
    fake.finish(new Blob(["OggS-small"]), "opus");
    await settle();
    const names = await zipBlobEntryNames(
      (await editor.save({ keepScan: false, inPlace: true })).blob,
    );
    expect(names).toContain(`content/${VOICE_ID}.opus`);
    expect(names).not.toContain(`content/${VOICE_ID}.wav`);
    await session.close();
  });

  // Why: the draft keeps a smaller file with its original; after a reload
  // the shelf must show it made smaller, run no job for it again, and
  // still offer the original.
  it("puts a smaller file the draft kept back on the shelf, its original offered", async () => {
    const session = await openedTour();
    const { editor, fake, rows } = editorWithShelf(session);
    const small = { ...VOICE_WAV, path: `content/${VOICE_ID}.opus` };
    editor.restore({
      objects: [VOICED],
      deleted: [],
      files: [
        {
          asset: small,
          blob: new Blob(["OggS-small"]),
          original: { asset: VOICE_WAV, blob: LARGE },
        },
      ],
    });
    await settle();
    expect(rows().find((r) => r.id === VOICE_ID)).toMatchObject({
      status: "optimized",
      originalBytes: LARGE.size,
      optimizedBytes: 10,
      canUseOriginal: true,
    });
    expect(fake.calls).toHaveLength(0);
    expect(await editor.shelf.useOriginal(VOICE_ID)).toBe(true);
    await expect(editor.save({ keepScan: false })).rejects.toThrow(
      "is too large to save, and nothing is making it smaller.",
    );
    await session.close();
  });
});
