/**
 * Why these tests matter: the add menu's picture, sound, video and 3D
 * model are made from a file, and the item must stand in the tour the
 * moment the file is in - while the shelf is still making it smaller. A
 * real session, real zips: the item is one undo step (the file itself
 * takes none), its file resolves while the shelf job runs and after the
 * smaller file replaced it, a save writes a tour the viewer opens, and a
 * kind that cannot stand free (a video) is refused at a station with
 * words while a story takes it.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import { describe, expect, it, vi } from "vitest";

import { editorStore } from "../test-support/editor-store.js";
import { stationIdOf, tourOf } from "../test-support/tour-of.js";
import { manifestToWrite } from "../tour-document.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { placeFileItem, type FileAddTarget } from "./add-file-item.js";
import {
  ASSET_OPTIMIZERS,
  type OptimizerHost,
} from "./asset-shelf/asset-optimizers.js";
import { selectShelfRows } from "./asset-shelf/asset-shelf-slice.js";
import { fakeOptimizer } from "./asset-shelf/test-support/fake-optimizer.js";
import { createEditorSession } from "./editor-session.js";
import type { FileItemSource } from "./new-file-item.js";
import type { FileAddKind } from "../kinds/edit-kinds.js";

const ESSAY: TourObject = {
  id: "t1",
  kind: "longText",
  view: "reading",
  title: "Essay",
  body: "The mill turned all day.",
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
};
const STATION = stationIdOf("t1");

const MANIFEST: TourManifest = parseTourManifest(
  JSON.parse(serializeTourManifest(tourOf([ESSAY]))),
);

/** A PNG's header bytes (what the picture's size is read from). */
function png(width: number, height: number): Blob {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([out]);
}

async function openedTour(): Promise<TourSession> {
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(MANIFEST) },
  ]);
  return openTourFile(new File([zip], "tour.zip", { type: "application/zip" }));
}

function setup(session: TourSession) {
  const store = editorStore();
  const sounds = fakeOptimizer();
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
    optimizers: { ...ASSET_OPTIMIZERS, audio: sounds, image: pictures },
    optimizerHost: host,
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const manifest = () => {
    const now = manifestToWrite(store.getState().tourDocument);
    if (now === null) throw new Error("no tour");
    return now;
  };
  /** The flow's bring-in and place, as the page wires them. */
  const add = async (
    kind: FileAddKind,
    target: FileAddTarget,
    file: Blob,
    fileName: string,
    id: string,
  ) => {
    const read = await editor.addFile(file, fileName);
    if (read.kind === "refused") return read;
    const source: FileItemSource = {
      kind,
      asset: read.asset,
      fileName,
      ...(read.poster === undefined ? {} : { poster: read.poster }),
    };
    return placeFileItem({
      target,
      source,
      stations: manifest().stations,
      id,
      nowIso: "2026-11-09T10:00:00.000Z",
      groundAt: () => null,
      place: (object) => editor.place(object),
      addEntryToStory: (storyId, child) =>
        editor.addEntryToStory(storyId, child),
    });
  };
  const childIds = () =>
    manifest()
      .stations.flatMap((s) => s.children)
      .map((c) => c.id);
  const rows = () => selectShelfRows(store.getState());
  return {
    editor,
    sounds,
    pictures,
    settle,
    manifest,
    add,
    childIds,
    rows,
    store,
  };
}

describe("adding an item from a file", () => {
  it("puts a sound at its station at once, its file queued on the shelf, as one undo step", async () => {
    const session = await openedTour();
    const { editor, add, childIds, rows, settle } = setup(session);
    const before = editor.revision();
    const added = await add(
      "audio",
      { kind: "station", stationId: STATION },
      new Blob(["RIFF-church-bells"]),
      "church_bells.wav",
      "snd",
    );
    expect(added).toEqual({ kind: "added", id: "snd" });
    expect(childIds()).toContain("snd");
    // The file took no step of its own: the add is the one.
    expect(editor.revision()).toBe(before + 1);
    await settle();
    expect(rows()).toEqual([
      expect.objectContaining({
        name: "church_bells.wav",
        status: "running",
        placesInUse: 1,
      }),
    ]);
    expect(editor.undo().kind).not.toBe("refused");
    expect(childIds()).not.toContain("snd");
    expect(childIds()).toContain("t1");
    await session.close();
  });

  it("puts a picture at the end of a story, its file resolving while the shelf job runs and after it ends", async () => {
    const session = await openedTour();
    const { editor, add, manifest, pictures, settle } = setup(session);
    const story = editor.addStory(STATION);
    if (story.kind !== "added") throw new Error("no story");
    const first = editor.addToStory(story.id, "shortText");
    expect(first.kind).toBe("added");
    const original = png(40, 30);
    const added = await add(
      "picture",
      { kind: "story", storyId: story.id },
      original,
      "gate-1890.png",
      "pic",
    );
    expect(added).toEqual({ kind: "added", id: "pic" });
    const entries = () =>
      tourStories(
        manifest().stations.find((s) => s.id === STATION) ?? {
          children: [],
        },
      )[0]?.children ?? [];
    expect(
      entries()
        .map((c) => c.id)
        .at(-1),
    ).toBe("pic");
    const entry = entries().at(-1) as { image: string; title: string };
    expect(entry.title).toBe("gate 1890");
    const path = `content/${entry.image}.png`;
    // While the job runs: the original.
    await settle();
    expect(pictures.calls).toHaveLength(1);
    const bytes = async (blob: Blob | null | undefined) =>
      blob == null ? null : new Uint8Array(await blob.arrayBuffer());
    expect(await bytes(editor.contentOf(path))).toEqual(await bytes(original));
    // After it: the smaller file, by the same id.
    const small = new Blob(["WEBP-small"]);
    pictures.finish(small, "webp", { width: 40, height: 30 });
    await settle();
    await settle();
    expect(editor.contentOf(path)).toBe(small);
    // A save writes the entry in its story and the smaller file it names.
    const zip = new Uint8Array(
      await (await editor.save({ keepScan: false })).blob.arrayBuffer(),
    );
    const saved = parseTourManifest(
      JSON.parse(
        new TextDecoder().decode(readStoredEntryBytes(zip, "tour.json")),
      ),
    );
    const station = saved.stations.find((s) => s.id === STATION);
    const kept = tourStories(station ?? { children: [] })[0]?.children.at(-1);
    expect(kept).toMatchObject({ id: "pic", image: entry.image });
    const file = saved.assets.find((x) => x.id === entry.image);
    expect(
      new TextDecoder().decode(readStoredEntryBytes(zip, file?.path ?? "")),
    ).toBe("WEBP-small");
    await session.close();
  });

  it("refuses a video at a station with words, and takes it at the end of a story", async () => {
    const session = await openedTour();
    const { editor, add, childIds } = setup(session);
    const video = new Blob(["fake-mp4-bytes"]);
    const refused = await add(
      "video",
      { kind: "station", stationId: STATION },
      video,
      "flood.mp4",
      "vid",
    );
    expect(refused).toEqual({
      kind: "refused",
      reason: "A video plays in a story: add it to one.",
    });
    expect(childIds()).not.toContain("vid");
    const story = editor.addStory(STATION);
    if (story.kind !== "added") throw new Error("no story");
    expect(
      await add(
        "video",
        { kind: "story", storyId: story.id },
        video,
        "flood.mp4",
        "vid",
      ),
    ).toEqual({ kind: "added", id: "vid" });
    await session.close();
  });

  it("places nothing for a station or a story that went meanwhile", async () => {
    const session = await openedTour();
    const { add, childIds, editor } = setup(session);
    const before = editor.revision();
    expect(
      await add(
        "audio",
        { kind: "station", stationId: "gone" },
        new Blob(["RIFF-x"]),
        "x.wav",
        "a",
      ),
    ).toMatchObject({ kind: "refused" });
    expect(
      await add(
        "audio",
        { kind: "story", storyId: "gone" },
        new Blob(["RIFF-y"]),
        "y.wav",
        "b",
      ),
    ).toMatchObject({ kind: "refused" });
    expect(childIds()).toEqual(["t1"]);
    expect(editor.revision()).toBe(before);
    await session.close();
  });
});
