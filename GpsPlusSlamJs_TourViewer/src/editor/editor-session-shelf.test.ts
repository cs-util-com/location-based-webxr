/**
 * Why these tests matter: the shelf is only useful when the session feeds
 * it. An opened tour's files must appear on it idle (made smaller only on
 * "Optimize this tour"), a file brought in must be queued at once, a
 * finished job must reach the saved file through the session's swap, and
 * "use the original" must stop being offered once a save that wrote the
 * smaller file landed. A new open on the same store starts an empty shelf.
 * Real zips, read back with the viewer's opener.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it, vi } from "vitest";

import { tourOf } from "../test-support/tour-of.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { zipBlobEntryNames } from "../zip-blob.js";
import {
  ASSET_OPTIMIZERS,
  type OptimizerHost,
} from "./asset-shelf/asset-optimizers.js";
import { selectShelfRows } from "../asset-shelf-slice.js";
import { fakeOptimizer } from "./asset-shelf/test-support/fake-optimizer.js";
import { createEditorSession } from "./editor-session.js";

const ESSAY: TourObject = {
  id: "t1",
  kind: "longText",
  view: "reading",
  title: "Essay",
  body: "The mill turned all day.",
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
};

const PICTURE = "a".repeat(64);
const PICTURE_BYTES = "P".repeat(50);

const MANIFEST: TourManifest = parseTourManifest(
  JSON.parse(
    serializeTourManifest(
      tourOf([ESSAY], {
        assets: [
          {
            id: PICTURE,
            path: `content/${PICTURE}.png`,
            kind: "image",
            width: 4,
            height: 3,
          },
        ],
      }),
    ),
  ),
);

async function openedTour(): Promise<TourSession> {
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(MANIFEST) },
    { path: `content/${PICTURE}.png`, data: PICTURE_BYTES },
  ]);
  return openTourFile(new File([zip], "tour.zip", { type: "application/zip" }));
}

function setup(session: TourSession, store = createTourViewerStore()) {
  const fake = fakeOptimizer();
  const pictures = fakeOptimizer();
  const host: OptimizerHost = {
    run: () => Promise.reject(new Error("unused")),
    close: vi.fn(),
  };
  const editor = createEditorSession({
    session,
    manifest: MANIFEST,
    levels: new Map(),
    store,
    optimizers: { ...ASSET_OPTIMIZERS, audio: fake, image: pictures },
    optimizerHost: host,
  });
  const rows = () => selectShelfRows(store.getState());
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { editor, fake, pictures, host, rows, settle, store };
}

describe("the editor session's asset shelf", () => {
  it("lists an opened tour's files idle, sized from the archive, and never starts them by itself", async () => {
    const session = await openedTour();
    const { rows, pictures, settle } = setup(session);
    await settle();
    expect(rows()).toEqual([
      expect.objectContaining({
        id: PICTURE,
        origin: "opened",
        status: "idle",
        originalBytes: PICTURE_BYTES.length,
      }),
    ]);
    expect(pictures.calls).toHaveLength(0);
    await session.close();
  });

  // Why: the whole chain - drop, job, swap, save - with the derived
  // "use the original" switching off once the smaller file is written.
  it("a file brought in is queued, its smaller file is saved, and the original stops being offered after that save", async () => {
    const session = await openedTour();
    const { editor, fake, rows, settle } = setup(session);
    // Brought in as an essay's narration, so the save writes it.
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["RIFF-original-voice-long-enough"]),
      fileName: "voice.wav",
    });
    const facts = await editor.narration("t1");
    if (facts.kind !== "narration" || facts.audioId === null) {
      throw new Error("no voice");
    }
    const id = facts.audioId;
    await settle();
    expect(rows().find((r) => r.id === id)).toMatchObject({
      origin: "added",
      status: "running",
    });
    fake.finish(new Blob(["OggS"]), "opus");
    await settle();
    expect(rows().find((r) => r.id === id)).toMatchObject({
      status: "optimized",
      canUseOriginal: true,
      swaps: 1,
    });
    const names = await zipBlobEntryNames(
      (await editor.save({ keepScan: false })).blob,
    );
    expect(names).toContain(`content/${id}.opus`);
    expect(names).not.toContain(`content/${id}.wav`);
    await settle();
    expect(rows().find((r) => r.id === id)?.canUseOriginal).toBe(false);
    await session.close();
  });

  it("closing the shelf closes its host; a new open on the same store starts empty", async () => {
    const session = await openedTour();
    const first = setup(session);
    await first.editor.addFile(new Blob(["RIFF-voice"]), "voice.wav");
    expect(first.rows()).toHaveLength(2);
    first.editor.shelf.close();
    expect(first.host.close).toHaveBeenCalled();
    const second = setup(session, first.store);
    expect(second.rows().map((r) => r.id)).toEqual([PICTURE]);
    await session.close();
  });
});
