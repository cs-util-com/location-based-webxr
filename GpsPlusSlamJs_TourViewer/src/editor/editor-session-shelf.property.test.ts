/**
 * Why this test matters: the shelf's jobs end whenever they end - before
 * a save, while one runs, between an undo and a redo, after "use the
 * original", across a reload or a crash - and neither the saved file nor
 * the draft may lose or garble a file through any order of those. Each run
 * drives a real session over a real draft (in memory) and a real file on
 * disk (the last in-place save that landed), with two kinds of files: a
 * voice brought in (made smaller as Opus, or as a smaller WAV at the same
 * path) and a picture of the opened tour (made smaller at the same path,
 * with a new size). Checked in every run, not across runs:
 * - every save writes each listed asset at its path, with bytes of that
 *   path's type and, for a picture, of the size the manifest names; nothing
 *   in `content/` is unlisted; the narration's file is listed;
 * - a reload after a clean close brings the tour back as it stood: the
 *   same records and the same bytes for every listed asset;
 * - after a crash (the draft as its last landed write left it) the tour
 *   still saves whole by the rules above;
 * - every file the document brought in or replaced is on the shelf.
 * Bugs it caught before they were fixed: through the fixed examples below
 * rather than a random run, a reload that left the restored files off the
 * shelf, a draft that dropped the original handed
 * back while a save writing the smaller file ran, and a swap at the same
 * path whose bytes no save wrote; through a random run once the steps
 * were weighted, a reload that dropped the original the creator chose for
 * a smaller WAV at the same path, because the draft trusted the path the
 * file on disk listed rather than its bytes. The steps are drawn alone or
 * as short fragments (a job and its end, a save started and something done while
 * it runs, a save or a use of the original and a reload), so random runs
 * reach such orders too: the five-step order behind the running-save bug
 * comes up in about 3 % of runs, against about 0.005 % with every step
 * drawn alone (measured on 20 000 sampled runs).
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

import { editorStore } from "../test-support/editor-store.js";
import {
  freeDraftLocks,
  memoryDraftStores,
  type MemoryDraftStores,
} from "../test-support/memory-draft-stores.js";
import { tourOf, withWorldObjects } from "../test-support/tour-of.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { zipBlobEntryNames } from "../zip-blob.js";
import {
  ASSET_OPTIMIZERS,
  type OptimizerHost,
} from "./asset-shelf/asset-optimizers.js";
import { selectShelfRows } from "./asset-shelf/asset-shelf-slice.js";
import {
  fakeOptimizer,
  type FakeOptimizer,
} from "./asset-shelf/test-support/fake-optimizer.js";
import { createEditorDraft, type EditorDraft } from "./editor-draft.js";
import {
  createEditorSession,
  type EditorSave,
  type EditorSession,
} from "./editor-session.js";

const K = "local-file:00000000000000000000000000000005";

const ESSAY: TourObject = {
  id: "t1",
  kind: "longText",
  view: "reading",
  title: "Essay",
  body: "The mill turned all day.",
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
};

const PICTURE = "b".repeat(64);
const PICTURE_PATH = `content/${PICTURE}.png`;

/** A picture's bytes name their size, so a manifest naming another size
 *  over them is caught. */
const pictureBytes = (w: number, h: number, tag: string): Blob =>
  new Blob([`PNG-|${String(w)}x${String(h)}|${tag}`]);

/** A placed picture of the opened tour: what keeps its file listed. */
const PHOTO: TourObject = {
  id: "p1",
  kind: "picture",
  view: "plane",
  image: PICTURE,
  widthM: 1,
  imageAsset: {
    id: PICTURE,
    path: PICTURE_PATH,
    kind: "image",
    width: 40,
    height: 30,
  },
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
};

const MANIFEST: TourManifest = parseTourManifest(
  JSON.parse(serializeTourManifest(tourOf([ESSAY, PHOTO]))),
);

/** What a step of the run does. */
type Op =
  | "voice"
  | "finishOpus"
  | "finishWav"
  | "finishPicture"
  | "keep"
  | "crash"
  | "optimizeTour"
  | "useVoiceOriginal"
  | "usePictureOriginal"
  | "retry"
  | "save"
  | "startSave"
  | "finishSave"
  | "undo"
  | "redo"
  | "reload"
  | "crashReload";

const OPS: readonly Op[] = [
  "voice",
  "finishOpus",
  "finishWav",
  "finishPicture",
  "keep",
  "crash",
  "optimizeTour",
  "useVoiceOriginal",
  "usePictureOriginal",
  "retry",
  "save",
  "startSave",
  "finishSave",
  "undo",
  "redo",
  "reload",
  "crashReload",
];

/** Short orders the bugs above lived in, drawn whole beside single steps:
 *  a job and its end, a save started and something done while it runs, a
 *  save or a use of the original and then a reload. */
const FRAGMENTS: readonly (readonly Op[])[] = [
  ["optimizeTour", "finishPicture"],
  ["voice", "finishOpus"],
  ["voice", "finishWav"],
  ["startSave", "usePictureOriginal"],
  ["startSave", "useVoiceOriginal"],
  ["save", "reload"],
  ["startSave", "reload"],
];

const ops = fc
  .array(
    fc.oneof(
      fc.constantFrom(...OPS).map((op): readonly Op[] => [op]),
      fc.constantFrom(...FRAGMENTS),
    ),
    { minLength: 1, maxLength: 12 },
  )
  .map((parts) => parts.flat());

/** The type a written entry's bytes must have, by its path's ending. */
const MAGIC: Record<string, string> = {
  wav: "RIFF",
  opus: "OggS",
  png: "PNG-",
};

const settle = () => new Promise((r) => setTimeout(r, 0));

const host: OptimizerHost = {
  run: () => Promise.reject(new Error("unused")),
  close: () => undefined,
};

/** One open of the tour: the file on disk, its draft and its editor. */
interface World {
  readonly session: TourSession;
  readonly draft: EditorDraft;
  readonly editor: EditorSession;
  readonly store: ReturnType<typeof editorStore>;
  readonly voices: FakeOptimizer;
  readonly pictures: FakeOptimizer;
}

function draftOf(stores: MemoryDraftStores): EditorDraft {
  return createEditorDraft({
    openStore: stores.open,
    holdLock: freeDraftLocks,
    noBackup: () => undefined,
  });
}

/** Open `disk` as the page does: the session's file, then the draft,
 *  then what the draft offers put back. */
async function openWorld(
  disk: Blob,
  stores: MemoryDraftStores,
): Promise<World> {
  const session = await openTourFile(
    new File([disk], "tour.zip", { type: "application/zip" }),
  );
  const manifest = manifestOf(new Uint8Array(await disk.arrayBuffer()));
  const draft = draftOf(stores);
  // As the page opens it: with the file's entry sizes, which tell a
  // draft's file from the bytes the file on disk holds at the same path.
  const sizes = new Map(session.entries.map((e) => [e.filename, e.size]));
  const { offer } = await draft.open(K, manifest, (path) =>
    sizes.get(`${session.manifestWrap}${path}`),
  );
  const store = editorStore();
  const voices = fakeOptimizer();
  const pictures = fakeOptimizer();
  const editor = createEditorSession({
    session,
    manifest,
    levels: new Map(),
    store,
    draft: draft.writes(),
    optimizers: { ...ASSET_OPTIMIZERS, audio: voices, image: pictures },
    optimizerHost: host,
  });
  if (offer !== null) editor.restore(offer);
  await settle();
  return { session, draft, editor, store, voices, pictures };
}

function manifestOf(bytes: Uint8Array): TourManifest {
  return parseTourManifest(
    JSON.parse(
      new TextDecoder().decode(readStoredEntryBytes(bytes, "tour.json")),
    ),
  );
}

/** The ids of the assets the blocks of `tour` name (a voice, a picture). */
function namedIds(tour: TourManifest): Set<string> {
  return new Set(
    withWorldObjects(tour).objects.flatMap((object) => {
      const audio = (object as { narration?: { audio?: string } }).narration
        ?.audio;
      const image = object.kind === "picture" ? object.image : undefined;
      return [audio, image].filter((id): id is string => id !== undefined);
    }),
  );
}

/** The assets a saved zip's blocks name, with their bytes as text: what a
 *  reload must bring back (one kept only for an undo step leaves with the
 *  undo history). */
async function assetsOf(blob: Blob): Promise<unknown[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tour = manifestOf(bytes);
  const named = namedIds(tour);
  return tour.assets
    .filter((a) => named.has(a.id))
    .map((a) => ({
      ...a,
      text: new TextDecoder().decode(readStoredEntryBytes(bytes, a.path)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function checkSaved(blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tour = manifestOf(bytes);
  const names = await zipBlobEntryNames(blob);
  const listed = tour.assets.map((a) => a.path);
  expect(names.filter((n) => n.startsWith("content/")).sort()).toEqual(
    [...listed].sort(),
  );
  for (const asset of tour.assets) {
    const ext = asset.path.slice(asset.path.lastIndexOf(".") + 1);
    const text = new TextDecoder().decode(
      readStoredEntryBytes(bytes, asset.path),
    );
    expect(text.slice(0, 4), asset.path).toBe(MAGIC[ext]);
    if (asset.kind === "image") {
      expect(text, asset.path).toContain(
        `|${String(asset.width)}x${String(asset.height)}|`,
      );
    }
  }
  const ids = new Set(tour.assets.map((a) => a.id));
  for (const id of namedIds(tour)) expect(ids.has(id), id).toBe(true);
}

/** Every file the document brought in or replaced is on the shelf. */
function checkShelf(world: World): void {
  const state = world.store.getState();
  const rows = new Set(selectShelfRows(state).map((r) => r.id));
  for (const asset of state.tourDocument.addedAssets) {
    expect(rows.has(asset.id), `${asset.id} on the shelf`).toBe(true);
  }
}

async function voiceIdOf(editor: EditorSession): Promise<string | null> {
  const facts = await editor.narration("t1");
  return facts.kind === "narration" ? facts.audioId : null;
}

describe("the shelf, the save and the draft, in any order", () => {
  it("every save is whole, a reload loses nothing, a crash breaks nothing", async () => {
    const opened = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(MANIFEST) },
      { path: PICTURE_PATH, data: pictureBytes(40, 30, "original") },
    ]);
    await fc.assert(
      fc.asyncProperty(ops, async (steps) => {
        let disk = opened;
        let stores = memoryDraftStores();
        let world = await openWorld(disk, stores);
        let pending: Promise<EditorSave> | null = null;
        let n = 0;
        /** Each reload: the tour before it and as it came back. */
        const reloads: { before: unknown[]; after: unknown[] }[] = [];
        /** The in-place save `save` lands: the file on disk, the draft. */
        const land = async (save: EditorSave): Promise<void> => {
          await checkSaved(save.blob);
          disk = save.blob;
          world.draft.writes().landed(save.written, K, save.wrote);
        };
        /** A save in place, as the page makes it: once built, its versions
         *  are this browser's own work (`built`), landed or not. */
        const startSave = (): Promise<EditorSave> => {
          const { editor, draft } = world;
          return editor
            .save({ keepScan: false, inPlace: true })
            .then((save) => {
              draft.writes().built(save.written);
              return save;
            });
        };
        const finishPending = async (): Promise<void> => {
          if (pending === null) return;
          const save = await pending;
          pending = null;
          await land(save);
        };
        const leave = async (w: World): Promise<void> => {
          w.editor.shelf.close();
          w.draft.close();
          await w.session.close();
        };
        try {
          for (const step of steps) {
            n++;
            const { editor, voices, pictures } = world;
            switch (step) {
              case "voice":
                await editor.editNarration("t1", {
                  kind: "voice",
                  file: new Blob([`RIFF-voice-${String(n)}-${"x".repeat(40)}`]),
                  fileName: `voice-${String(n)}.wav`,
                });
                break;
              case "finishOpus":
                if (voices.calls.length > 0) {
                  voices.finish(new Blob([`OggS-${String(n)}`]), "opus");
                }
                break;
              case "finishWav":
                if (voices.calls.length > 0) {
                  voices.finish(new Blob([`RIFF-${String(n)}`]), "wav");
                }
                break;
              case "finishPicture":
                if (pictures.calls.length > 0) {
                  pictures.finish(pictureBytes(4, 3, String(n)), "png", {
                    width: 4,
                    height: 3,
                  });
                }
                break;
              case "keep":
                if (voices.calls.length > 0) voices.keep("kept");
                break;
              case "crash":
                if (voices.calls.length > 0) voices.crash();
                break;
              case "optimizeTour":
                editor.shelf.optimizeTour();
                break;
              case "useVoiceOriginal": {
                const id = await voiceIdOf(editor);
                if (id !== null) await editor.shelf.useOriginal(id);
                break;
              }
              case "usePictureOriginal":
                await editor.shelf.useOriginal(PICTURE);
                break;
              case "retry": {
                const id = await voiceIdOf(editor);
                if (id !== null) editor.shelf.retry(id);
                break;
              }
              case "save":
                await finishPending();
                await land(await startSave());
                break;
              case "startSave":
                pending ??= startSave();
                break;
              case "finishSave":
                await finishPending();
                break;
              case "undo":
                editor.undo();
                break;
              case "redo":
                editor.redo();
                break;
              case "reload": {
                await finishPending();
                const before = await assetsOf(
                  (await editor.saveCopy({ keepScan: false })).blob,
                );
                await world.draft.idle();
                await leave(world);
                world = await openWorld(disk, stores);
                const after = await assetsOf(
                  (await world.editor.saveCopy({ keepScan: false })).blob,
                );
                reloads.push({ before, after });
                break;
              }
              case "crashReload": {
                // The tab dies: a save still running never lands, and the
                // draft holds what its writes so far left.
                const dropped = pending;
                pending = null;
                void dropped?.catch(() => undefined);
                const left = memoryDraftStores();
                for (const [key, files] of stores.spaces) {
                  left.spaces.set(key, new Map(files));
                }
                const dead = world;
                stores = left;
                world = await openWorld(disk, stores);
                await dropped?.catch(() => undefined);
                await leave(dead);
                await checkSaved(
                  (await world.editor.saveCopy({ keepScan: false })).blob,
                );
                break;
              }
            }
            await settle();
            checkShelf(world);
          }
          await finishPending();
          await land(await startSave());
          for (const { before, after } of reloads)
            expect(after).toEqual(before);
        } finally {
          await leave(world);
        }
      }),
      {
        numRuns: 40,
        // Orders once found broken, run every time: a second voice taken
        // while a save of the first ran, then a reload (the draft must know
        // that save's versions as its own, `built`, or it gives the
        // narration up to the file); "use the original" on
        // a smaller WAV at the voice's own path while a save writing that
        // smaller file runs, then a reload (the draft dropped the original
        // because the file on disk listed its path, though with the smaller
        // bytes); a reload with a large file still on the shelf; "use the
        // original" while a save writing the smaller file runs, then a
        // reload; a picture made smaller at its own path, saved, reloaded.
        examples: [
          [
            [
              "voice",
              "finishWav",
              "startSave",
              "useVoiceOriginal",
              "voice",
              "finishWav",
              "reload",
            ],
          ],
          [
            [
              "voice",
              "finishWav",
              "startSave",
              "useVoiceOriginal",
              "voice",
              "finishWav",
              "reload",
            ],
          ],
          [
            [
              "voice",
              "finishWav",
              "startSave",
              "useVoiceOriginal",
              "startSave",
              "reload",
              "optimizeTour",
              "finishPicture",
            ],
          ],
          [["voice", "reload", "finishOpus", "save", "reload"]],
          [
            [
              "optimizeTour",
              "finishPicture",
              "startSave",
              "usePictureOriginal",
              "reload",
            ],
          ],
          [["optimizeTour", "finishPicture", "save", "reload", "save"]],
          // A second voice while a save of the first runs, undone (back to
          // what that save writes, so the draft forgets the record) and
          // redone, then a reload: the record written again must still know
          // the version the save wrote, or the reload drops the redone voice.
          [["voice", "startSave", "voice", "undo", "redo", "reload"]],
        ],
      },
    );
  }, 120_000);
});
