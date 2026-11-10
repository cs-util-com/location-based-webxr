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
import { documentObjects, manifestToWrite } from "../tour-document.js";
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

function setup(
  session: TourSession,
  extra: Partial<Parameters<typeof createEditorSession>[0]> = {},
) {
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
    ...extra,
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

describe("replacing an item's file", () => {
  // Why: a file dropped on an item's file field (or chosen with Replace)
  // must become that item's file at once, while the shelf still makes it
  // smaller, as one undo step; for a free item and for a story's entry.
  it("gives a free sound a new file as one undo step, resolving while the shelf job runs and after it ends", async () => {
    const session = await openedTour();
    const { editor, add, manifest, sounds, settle } = setup(session);
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      new Blob(["RIFF-old"]),
      "old.wav",
      "snd",
    );
    await settle();
    sounds.keep("already small");
    await settle();
    const soundOf = () =>
      manifest()
        .stations.flatMap((s) => s.children)
        .find((c) => c.id === "snd") as { audio: string } | undefined;
    const oldAudio = soundOf()?.audio;
    const before = editor.revision();
    const fresh = new Blob(["RIFF-new-bells"]);
    const outcome = await editor.setItemFile("snd", fresh, "new.wav");
    expect(outcome).toEqual({ kind: "edited", backedUp: true });
    expect(editor.revision()).toBe(before + 1);
    const audio = soundOf()?.audio;
    expect(audio).not.toBe(oldAudio);
    const path = `content/${String(audio)}.wav`;
    await settle();
    expect(sounds.calls).toHaveLength(1);
    expect(await editor.contentOf(path)?.text()).toBe("RIFF-new-bells");
    const small = new Blob(["OPUS-small"]);
    sounds.finish(small, "ogg");
    await settle();
    await settle();
    expect(editor.contentOf(path)).toBe(small);
    expect(editor.undo().kind).not.toBe("refused");
    expect(soundOf()?.audio).toBe(oldAudio);
    await session.close();
  });

  it("gives a story's picture a new file as one undo step", async () => {
    const session = await openedTour();
    const { editor, add, manifest } = setup(session);
    const story = editor.addStory(STATION);
    if (story.kind !== "added") throw new Error("no story");
    await add(
      "picture",
      { kind: "story", storyId: story.id },
      png(40, 30),
      "gate.png",
      "pic",
    );
    const entry = () =>
      tourStories(
        manifest().stations.find((s) => s.id === STATION) ?? { children: [] },
      )[0]?.children.find((c) => c.id === "pic") as
        { image: string; title: string } | undefined;
    const old = entry()?.image;
    const before = editor.revision();
    expect(await editor.setItemFile("pic", png(80, 60), "gate-2.png")).toEqual({
      kind: "edited",
      backedUp: true,
    });
    expect(editor.revision()).toBe(before + 1);
    expect(entry()?.image).not.toBe(old);
    expect(entry()?.title).toBe("gate");
    expect(editor.undo().kind).not.toBe("refused");
    expect(entry()?.image).toBe(old);
    await session.close();
  });

  it("refuses a block made of words, a gone id and a file of another kind, changing nothing", async () => {
    const session = await openedTour();
    const { editor, add } = setup(session);
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      new Blob(["RIFF-old"]),
      "old.wav",
      "snd",
    );
    const before = editor.revision();
    expect(
      await editor.setItemFile("t1", new Blob(["RIFF-x"]), "x.wav"),
    ).toEqual({
      kind: "refused",
      reason: "That item is not made from a file.",
    });
    expect(
      await editor.setItemFile("gone", new Blob(["RIFF-x"]), "x.wav"),
    ).toMatchObject({ kind: "refused" });
    expect(
      await editor.setItemFile("snd", png(10, 10), "pic.png"),
    ).toMatchObject({ kind: "refused" });
    expect(editor.revision()).toBe(before);
    await session.close();
  });
});

describe("using a shelf file in an item", () => {
  // Why: "Use in..." on the shelf hands an item a file the tour already
  // lists; it must be one undo step, find the file by its id, and refuse a
  // file of another kind rather than make a sound play a picture.
  it("gives a sound another listed sound as one undo step, and refuses a picture", async () => {
    const session = await openedTour();
    const { editor, add, manifest } = setup(session);
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      new Blob(["RIFF-a"]),
      "a.wav",
      "snd",
    );
    const other = await editor.addFile(new Blob(["RIFF-b"]), "b.wav");
    const pic = await editor.addFile(png(10, 10), "p.png");
    if (other.kind === "refused" || pic.kind === "refused")
      throw new Error("not added");
    expect(editor.assetOf(other.asset.id)).toEqual(other.asset);
    expect(editor.assetOf("nothing")).toBeUndefined();
    const soundOf = () =>
      manifest()
        .stations.flatMap((s) => s.children)
        .find((c) => c.id === "snd") as { audio: string } | undefined;
    const old = soundOf()?.audio;
    const before = editor.revision();
    expect(editor.setItemAsset("snd", pic.asset.id)).toEqual({
      kind: "refused",
      reason: "That file is not of the kind this item is made from.",
    });
    expect(editor.setItemAsset("snd", "nothing")).toMatchObject({
      kind: "refused",
    });
    expect(editor.revision()).toBe(before);
    expect(editor.setItemAsset("snd", other.asset.id)).toEqual({
      kind: "edited",
    });
    expect(soundOf()?.audio).toBe(other.asset.id);
    expect(editor.revision()).toBe(before + 1);
    expect(editor.setItemAsset("snd", other.asset.id)).toEqual({
      kind: "unchanged",
    });
    expect(editor.undo().kind).not.toBe("refused");
    expect(soundOf()?.audio).toBe(old);
    await session.close();
  });
});

describe("a video's poster and length on the shelf", () => {
  // Why: the shelf's card shows a video's poster and warns when it is
  // large for its length, and "Use in..." must give a story's video the
  // poster minted with the file - all from the one read of the video.
  it("keeps the minted poster and the length with the file, and gives the poster to a story video using it", async () => {
    const session = await openedTour();
    const { editor, add, manifest, rows } = setup(session, {
      fileReaders: {
        videoLookOf: (blob) =>
          blob.size > 20
            ? Promise.resolve({ poster: png(32, 18), seconds: 20 })
            : Promise.resolve({ poster: null, seconds: null }),
      },
    });
    const first = await editor.addFile(
      new Blob(["fake-mp4-bytes-of-the-flood"]),
      "flood.mp4",
    );
    if (first.kind !== "added" || first.poster === undefined) {
      throw new Error("no poster");
    }
    const row = rows().find((r) => r.id === first.asset.id);
    expect(row).toMatchObject({ posterId: first.poster.id, seconds: 20 });
    expect(editor.posterOf(first.asset.id)).toEqual(first.poster);
    expect(await editor.addedFileOf(first.poster.id)?.arrayBuffer()).toEqual(
      await png(32, 18).arrayBuffer(),
    );
    const story = editor.addStory(STATION);
    if (story.kind !== "added") throw new Error("no story");
    await add(
      "video",
      { kind: "story", storyId: story.id },
      new Blob(["short"]),
      "short.mp4",
      "vid",
    );
    const shortRow = rows().find((r) => r.name === "short.mp4");
    expect(shortRow?.posterId).toBeUndefined();
    expect(shortRow?.seconds).toBeUndefined();
    expect(editor.setItemAsset("vid", first.asset.id)).toEqual({
      kind: "edited",
    });
    const entry = tourStories(
      manifest().stations.find((s) => s.id === STATION) ?? { children: [] },
    )[0]?.children.find((c) => c.id === "vid") as
      { video: string; poster?: string } | undefined;
    expect(entry).toMatchObject({
      video: first.asset.id,
      poster: first.poster.id,
    });
    await session.close();
  });
});

describe("deleting a file the tour uses", () => {
  // Why: the shelf's delete of a file in use deletes only the items MADE
  // of it (the format has no empty file field); an item that only
  // mentions it (a long text's narration) keeps standing without it, and
  // a long text showing a picture inside its words refuses the delete,
  // naming itself. Everything goes in ONE step of the edit stack, so the
  // page's Undo (and Ctrl+Z) brings every item back - and the file's card
  // with them, since the shelf lists every file an item names.
  const bells = () => new Blob(["RIFF-church-bells"]);

  /** A long text at the station, `extra` its narration or its body. */
  const essay = (id: string, extra: Partial<TourObject>): TourObject =>
    ({ ...ESSAY, id, ...extra }) as TourObject;

  it("deletes the items made of it in one step, and the undo brings them and its card back", async () => {
    const session = await openedTour();
    const { editor, add, childIds, manifest, rows, settle } = setup(session);
    const story = editor.addStory(STATION);
    if (story.kind !== "added") throw new Error("no story");
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      bells(),
      "bells.wav",
      "free",
    );
    await add(
      "audio",
      { kind: "story", storyId: story.id },
      bells(),
      "bells.wav",
      "told",
    );
    await settle();
    const entries = () =>
      tourStories(
        manifest().stations.find((s) => s.id === STATION) ?? { children: [] },
      )[0]?.children.map((c) => c.id) ?? [];
    expect(rows()).toEqual([expect.objectContaining({ placesInUse: 2 })]);
    const assetId = rows()[0]?.id ?? "";
    expect(editor.deletePlan(assetId)).toEqual({
      kind: "plan",
      words: "Deletes 2 items.",
    });
    const before = editor.revision();

    expect(editor.deleteFileAndUses(assetId)).toEqual({
      kind: "deleted",
      what: "the delete of bells.wav",
      words: "Deletes 2 items.",
    });

    expect(childIds()).not.toContain("free");
    expect(childIds()).toContain("t1");
    expect(entries()).toEqual([]);
    expect(rows()).toEqual([]);
    expect(editor.revision()).toBe(before + 1);
    expect(editor.undo()).toEqual({
      kind: "undone",
      what: "the delete of bells.wav",
    });
    expect(childIds()).toContain("free");
    expect(entries()).toEqual(["told"]);
    expect(rows()).toEqual([expect.objectContaining({ id: assetId })]);
    // A redo deletes the items again; the card stays, as for any file
    // the tour holds.
    expect(editor.redo().kind).toBe("redone");
    expect(childIds()).not.toContain("free");
    expect(rows()).toEqual([expect.objectContaining({ id: assetId })]);
    await session.close();
  });

  it("takes a sound out of a long text's narration, keeping the long text", async () => {
    const session = await openedTour();
    const { editor, add, childIds, manifest, rows, settle } = setup(session);
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      bells(),
      "bells.wav",
      "free",
    );
    await settle();
    const assetId = rows()[0]?.id ?? "";
    expect(
      editor.place(
        essay("t2", { narration: { audio: assetId, synthetic: false } }),
      ).kind,
    ).toBe("placed");
    const narration = () =>
      (
        manifest()
          .stations.flatMap((s) => s.children)
          .find((c) => c.id === "t2") as { narration?: unknown } | undefined
      )?.narration;
    expect(editor.deletePlan(assetId)).toEqual({
      kind: "plan",
      words: "Deletes 1 item, removes it from 1 other.",
    });
    expect(editor.deleteFileAndUses(assetId).kind).toBe("deleted");
    expect(childIds()).not.toContain("free");
    expect(childIds()).toContain("t2");
    expect(narration()).toBeUndefined();
    expect(editor.undo().kind).toBe("undone");
    expect(narration()).toEqual({ audio: assetId, synthetic: false });
    await session.close();
  });

  it("refuses the delete of a picture a long text shows inside its words, saying which", async () => {
    const session = await openedTour();
    const { editor, add, childIds, rows, settle } = setup(session);
    await add(
      "picture",
      { kind: "station", stationId: STATION },
      png(40, 30),
      "gate.png",
      "pic",
    );
    await settle();
    const assetId = rows()[0]?.id ?? "";
    editor.place(
      essay("t3", {
        title: "The gate in 1890",
        body: `The gate:\n\n![Gate](asset:${assetId})\n`,
      }),
    );
    const before = editor.revision();
    const refusal = {
      kind: "refused",
      reason:
        '"The gate in 1890" shows this picture inside its text. Take it out of the text first.',
    };
    expect(editor.deletePlan(assetId)).toEqual(refusal);
    expect(editor.deleteFileAndUses(assetId)).toEqual(refusal);
    expect(editor.revision()).toBe(before);
    expect(childIds()).toContain("pic");
    expect(rows()).toEqual([expect.objectContaining({ id: assetId })]);
    await session.close();
  });

  it("clears a station's card image of it in the same step", async () => {
    const session = await openedTour();
    const { editor, add, manifest, rows, settle } = setup(session);
    await add(
      "picture",
      { kind: "station", stationId: STATION },
      png(40, 30),
      "gate.png",
      "pic",
    );
    await settle();
    const assetId = rows()[0]?.id ?? "";
    expect(editor.editStation(STATION, { image: assetId }).kind).toBe("edited");
    const image = () =>
      manifest().stations.find((s) => s.id === STATION)?.image;
    expect(image()).toBe(assetId);
    expect(editor.deletePlan(assetId)).toEqual({
      kind: "plan",
      words: "Deletes 1 item, removes it from 1 other.",
    });
    const before = editor.revision();
    expect(editor.deleteFileAndUses(assetId).kind).toBe("deleted");
    expect(image()).toBeUndefined();
    expect(editor.revision()).toBe(before + 1);
    expect(editor.undo().kind).toBe("undone");
    expect(image()).toBe(assetId);
    await session.close();
  });

  // Why: the delete's Undo is the edit stack's, which waits while a save
  // runs; the refusal must be said (the page toasts it and keeps its
  // Undo), and the undo must work once the save has ended.
  it("refuses an undo while a save runs, in words, and undoes once it ended", async () => {
    const session = await openedTour();
    const { editor, add, childIds, rows, settle } = setup(session);
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      bells(),
      "bells.wav",
      "free",
    );
    await settle();
    const assetId = rows()[0]?.id ?? "";
    expect(editor.deleteFileAndUses(assetId).kind).toBe("deleted");
    const saving = editor.save({ keepScan: false });
    expect(editor.undo()).toEqual({
      kind: "refused",
      reason: expect.stringMatching(/save is running/),
    });
    expect(childIds()).not.toContain("free");
    await saving;
    expect(editor.undo().kind).toBe("undone");
    expect(childIds()).toContain("free");
    expect(rows()).toEqual([expect.objectContaining({ id: assetId })]);
    await session.close();
  });

  // Why: after a newer edit the delete is no longer the newest step; the
  // stack takes back the newer edit first, and the delete's own undo must
  // still bring its items AND the card back (the card is the shelf's,
  // outside the stack, so only the shelf's put-back can return it).
  it("undoes the delete after a newer edit, the newer edit first, its items and card after", async () => {
    const session = await openedTour();
    const { editor, add, childIds, rows, settle } = setup(session);
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      bells(),
      "bells.wav",
      "free",
    );
    await settle();
    const assetId = rows()[0]?.id ?? "";
    expect(editor.deleteFileAndUses(assetId).kind).toBe("deleted");
    expect(editor.place(essay("t4", {})).kind).toBe("placed");
    expect(rows()).toEqual([]);
    expect(editor.undo().kind).toBe("undone");
    expect(childIds()).not.toContain("t4");
    expect(childIds()).not.toContain("free");
    expect(rows()).toEqual([]);
    expect(editor.undo()).toEqual({
      kind: "undone",
      what: "the delete of bells.wav",
    });
    expect(childIds()).toContain("free");
    expect(rows()).toEqual([expect.objectContaining({ id: assetId })]);
    await session.close();
  });

  it("refuses a file the shelf does not hold, in words", async () => {
    const session = await openedTour();
    const { editor, childIds } = setup(session);
    const before = editor.revision();
    expect(editor.deleteFileAndUses("not-here")).toEqual({
      kind: "refused",
      reason: "That file is no longer on the shelf.",
    });
    expect(editor.revision()).toBe(before);
    expect(childIds()).toEqual(["t1"]);
    await session.close();
  });

  // Why: a file the tour holds keeps its card. Adding the same bytes
  // again after its card was deleted must bring the card back, not
  // leave a file on the shelf's blind side.
  it("puts a deleted card back when the same file is added again", async () => {
    const session = await openedTour();
    const { editor, rows } = setup(session);
    const first = await editor.addFile(bells(), "bells.wav");
    if (first.kind === "refused") throw new Error(first.reason);
    expect(editor.shelf.remove(first.asset.id)).not.toBeNull();
    expect(rows()).toEqual([]);
    const again = await editor.addFile(bells(), "bells-again.wav");
    expect(again).toMatchObject({ kind: "added", asset: first.asset });
    expect(rows()).toEqual([expect.objectContaining({ id: first.asset.id })]);
    await session.close();
  });
});

describe("replacing a file everywhere", () => {
  // Why: "Replace everywhere" must switch EVERY use of a file - the items
  // made of it and the ones only mentioning it (a narration) - in one
  // step that one undo takes back whole, and must refuse a file of
  // another kind rather than make a sound play a picture.
  it("switches the items made of it and a narration in one step, and the undo switches all back", async () => {
    const session = await openedTour();
    const { editor, add, manifest, rows, settle } = setup(session);
    const story = editor.addStory(STATION);
    if (story.kind !== "added") throw new Error("no story");
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      new Blob(["RIFF-old"]),
      "old.wav",
      "free",
    );
    await add(
      "audio",
      { kind: "story", storyId: story.id },
      new Blob(["RIFF-old"]),
      "old.wav",
      "told",
    );
    await settle();
    const old = rows()[0]?.id ?? "";
    editor.place({
      ...ESSAY,
      id: "t2",
      narration: { audio: old, synthetic: false },
    });
    const audios = () =>
      manifest()
        .stations.flatMap((s) => [
          ...s.children,
          ...tourStories(s).flatMap((t) => t.children),
        ])
        .map((c) => {
          const block = c as { audio?: string; narration?: { audio: string } };
          return block.audio ?? block.narration?.audio;
        })
        .filter((a) => a !== undefined);
    expect(audios()).toEqual([old, old, old]);
    expect(editor.replaceCount(old)).toBe(3);
    const before = editor.revision();
    const outcome = await editor.replaceFile(
      old,
      new Blob(["RIFF-new-bells"]),
      "new.wav",
    );
    expect(outcome).toMatchObject({
      kind: "replaced",
      what: "the replace of old.wav",
      items: 3,
    });
    expect(editor.revision()).toBe(before + 1);
    const fresh = rows().find((r) => r.name === "new.wav")?.id;
    expect(fresh).toBeDefined();
    expect(audios()).toEqual([fresh, fresh, fresh]);
    expect(editor.undo().kind).toBe("undone");
    expect(audios()).toEqual([old, old, old]);
    await session.close();
  });

  it("refuses a file of another kind, the same file and a file no longer on the shelf, changing nothing", async () => {
    const session = await openedTour();
    const { editor, add, rows, settle } = setup(session);
    await add(
      "audio",
      { kind: "station", stationId: STATION },
      new Blob(["RIFF-old"]),
      "old.wav",
      "free",
    );
    await settle();
    const old = rows()[0]?.id ?? "";
    const before = editor.revision();
    expect(await editor.replaceFile(old, png(10, 10), "pic.png")).toMatchObject(
      { kind: "refused" },
    );
    expect(
      await editor.replaceFile(old, new Blob(["RIFF-old"]), "same.wav"),
    ).toEqual({
      kind: "refused",
      reason: "That is the same file: nothing changes.",
    });
    expect(
      await editor.replaceFile("gone", new Blob(["RIFF-x"]), "x.wav"),
    ).toEqual({
      kind: "refused",
      reason: "That file is no longer on the shelf.",
    });
    expect(editor.revision()).toBe(before);
    await session.close();
  });
});

describe("a free picture made from a file, after the shelf made it smaller", () => {
  // Why: the shelf's swap replaces the file's record (its path, its
  // size); the picture item must read that record, not the copy it took
  // when it was made, or the 3D view and a save name a file gone stale.
  it("reads the smaller file's record", async () => {
    const session = await openedTour();
    const { add, pictures, rows, settle, store } = setup(session);
    await add(
      "picture",
      { kind: "station", stationId: STATION },
      png(40, 30),
      "gate.png",
      "pic",
    );
    await settle();
    const assetId = rows()[0]?.id ?? "";
    pictures.finish(new Blob(["WEBP-small"]), "webp", {
      width: 40,
      height: 30,
    });
    await settle();
    await settle();
    expect(rows()[0]?.status).toBe("optimized");
    const found = documentObjects(store.getState().tourDocument).find(
      (o) => o.object.id === "pic",
    );
    expect(found?.object).toMatchObject({
      imageAsset: { id: assetId, path: `content/${assetId}.webp` },
    });
  });
});

describe("deleting a picture made from a file", () => {
  // Why: the undo of a delete refused when a picture it brings back has no
  // bytes at hand - meant for a captured photo, whose picture is its own.
  // A picture made from a file names an asset the tour keeps, so its
  // delete must undo like any other, saved or not.
  it("undoes the delete of a free picture added from a file", async () => {
    const session = await openedTour();
    const { editor, add, childIds } = setup(session);
    await add(
      "picture",
      { kind: "station", stationId: STATION },
      png(40, 30),
      "gate.png",
      "pic",
    );
    expect(editor.remove("pic").kind).toBe("deleted");
    expect(childIds()).not.toContain("pic");
    expect(editor.undo().kind).toBe("undone");
    expect(childIds()).toContain("pic");
    await session.close();
  });
});
