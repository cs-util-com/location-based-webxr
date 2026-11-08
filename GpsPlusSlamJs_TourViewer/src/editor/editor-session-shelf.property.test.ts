/**
 * Why this test matters: the shelf's jobs end whenever they end - before
 * a save, between an undo and a redo, after "use the original" - and the
 * saved file must stay whole through any order of those. After every
 * save, each asset the written tour lists has an entry at its path whose
 * bytes are of that path's type (no WebP-named WAV, no orphan left behind),
 * nothing in `content/` is unlisted, and the narration the essay names is
 * listed. Real zips, read back with the viewer's reader.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { tourOf, withWorldObjects } from "../test-support/tour-of.js";
import { openTourFile } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { zipBlobEntryNames } from "../zip-blob.js";
import { ASSET_OPTIMIZERS } from "./asset-shelf/asset-optimizers.js";
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

const MANIFEST: TourManifest = parseTourManifest(
  JSON.parse(serializeTourManifest(tourOf([ESSAY]))),
);

/** What a step of the run does. */
type Op =
  | "voice"
  | "finish"
  | "keep"
  | "crash"
  | "useOriginal"
  | "retry"
  | "save"
  | "undo"
  | "redo";

const ops = fc.array(
  fc.constantFrom<Op>(
    "voice",
    "finish",
    "keep",
    "crash",
    "useOriginal",
    "retry",
    "save",
    "undo",
    "redo",
  ),
  { minLength: 1, maxLength: 12 },
);

/** The type a written entry's bytes must have, by its path's ending. */
const MAGIC: Record<string, string> = { wav: "RIFF", opus: "OggS" };

/** Saves that wrote a smaller file, over all runs: a guard against runs
 *  that never reach a swap and so check nothing about it. */
let savedSwaps = 0;

describe("the shelf and the save, in any order", () => {
  it("every save writes each listed asset at its path, with bytes of its type, and nothing unlisted", async () => {
    await fc.assert(
      fc.asyncProperty(ops, async (steps) => {
        const zip = await packFilesAsZip([
          { path: "tour.json", data: serializeTourManifest(MANIFEST) },
        ]);
        const session = await openTourFile(
          new File([zip], "tour.zip", { type: "application/zip" }),
        );
        const fake = fakeOptimizer();
        const editor = createEditorSession({
          session,
          manifest: MANIFEST,
          levels: new Map(),
          store: createTourViewerStore(),
          optimizers: { ...ASSET_OPTIMIZERS, audio: fake },
        });
        const settle = () => new Promise((r) => setTimeout(r, 0));
        let voices = 0;
        try {
          for (const step of steps) {
            const id = await audioIdOf(editor);
            switch (step) {
              case "voice":
                voices++;
                await editor.editNarration("t1", {
                  kind: "voice",
                  file: new Blob([`RIFF-voice-${voices}-${"x".repeat(40)}`]),
                  fileName: `voice-${voices}.wav`,
                });
                break;
              case "finish":
                if (fake.calls.length > 0) {
                  fake.finish(new Blob([`OggS-${voices}`]), "opus");
                }
                break;
              case "keep":
                if (fake.calls.length > 0) fake.keep("kept");
                break;
              case "crash":
                if (fake.calls.length > 0) fake.crash();
                break;
              case "useOriginal":
                if (id !== null) await editor.shelf.useOriginal(id);
                break;
              case "retry":
                if (id !== null) editor.shelf.retry(id);
                break;
              case "save":
                await checkSaved((await editor.save({ keepScan: false })).blob);
                break;
              case "undo":
                editor.undo();
                break;
              case "redo":
                editor.redo();
                break;
            }
            await settle();
          }
          await checkSaved((await editor.save({ keepScan: false })).blob);
        } finally {
          editor.shelf.close();
          await session.close();
        }
      }),
      { numRuns: 25 },
    );
    expect(savedSwaps).toBeGreaterThan(0);
  }, 60_000);
});

async function audioIdOf(
  editor: ReturnType<typeof createEditorSession>,
): Promise<string | null> {
  const facts = await editor.narration("t1");
  return facts.kind === "narration" ? facts.audioId : null;
}

async function checkSaved(blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tour = parseTourManifest(
    JSON.parse(
      new TextDecoder().decode(readStoredEntryBytes(bytes, "tour.json")),
    ),
  );
  const names = await zipBlobEntryNames(blob);
  const listed = tour.assets.map((a) => a.path);
  expect(names.filter((n) => n.startsWith("content/")).sort()).toEqual(
    [...listed].sort(),
  );
  for (const asset of tour.assets) {
    const ext = asset.path.slice(asset.path.lastIndexOf(".") + 1);
    if (ext === "opus") savedSwaps++;
    const head = new TextDecoder().decode(
      readStoredEntryBytes(bytes, asset.path)?.slice(0, 4),
    );
    expect(head).toBe(MAGIC[ext]);
  }
  const ids = new Set(tour.assets.map((a) => a.id));
  for (const object of withWorldObjects(tour).objects) {
    const audio = (object as { narration?: { audio?: string } }).narration
      ?.audio;
    if (audio !== undefined) expect(ids.has(audio)).toBe(true);
  }
}
