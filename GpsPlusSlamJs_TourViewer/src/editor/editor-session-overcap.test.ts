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

import { openTourFile, type TourSession } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
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
    store: createTourViewerStore(),
    fileReaders: { limits: LIMITS, shrinks: (kind) => kind === "audio" },
  });
}

const LARGE = new Blob(["RIFF", "x".repeat(3_000)]);

describe("a file over the caps, until a smaller one replaces it", () => {
  it("refuses every save in words naming the file, then saves once the smaller file landed", async () => {
    const session = await openedTour();
    const editor = editorOf(session);
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

  it("refuses the save the same way after a reload brought the large file back", async () => {
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
      "A sound of this tour is still too large to save - it is being made smaller.",
    );
    await session.close();
  });
});
