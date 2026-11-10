/**
 * Why these tests matter: the editor's Characters list declares a
 * character from the device's library through the session, which must
 * bring both pictures in and declare in one step, refuse in words before
 * it brings a file in when the declaration would be refused anyway (a
 * second add of the same character), refuse a file that is no picture,
 * and give the character's picture back for the list's thumbnail.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { TOUR_ID_PATTERN } from "gps-plus-slam-app-framework/ar/tour-archive";
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";
import { describe, expect, it, vi } from "vitest";

import { manifestToWrite } from "../tour-document.js";
import {
  ASSET_OPTIMIZERS,
  type OptimizerHost,
} from "./asset-shelf/asset-optimizers.js";
import { selectShelfRows } from "./asset-shelf/asset-shelf-slice.js";
import { fakeOptimizer } from "./asset-shelf/test-support/fake-optimizer.js";
import { freePinSpot } from "./new-pin.js";
import { openTourFile } from "../tour-session.js";
import { editorStore } from "../test-support/editor-store.js";
import { pngBlob } from "../test-support/png-blob.js";
import { tourOf } from "../test-support/tour-of.js";
import { createEditorSession } from "./editor-session.js";

const pin: TourObject = {
  id: "p1",
  kind: "shortText",
  view: "pin",
  caption: "the gate",
  createdAtIso: "2026-11-10T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
};

const MANIFEST = parseTourManifest(
  JSON.parse(serializeTourManifest(tourOf([pin]))),
);

/** An editor on `manifest` (its files `files`), with a picture optimizer
 *  set on the shelf, as the shelf's image line will set one. */
async function editor(
  manifest = MANIFEST,
  files: readonly { path: string; data: Blob }[] = [],
) {
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
    ...(await Promise.all(
      files.map(async (f) => ({
        path: f.path,
        data: new Uint8Array(await f.data.arrayBuffer()),
      })),
    )),
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  const store = editorStore();
  const pictures = fakeOptimizer();
  const host: OptimizerHost = {
    run: () => Promise.reject(new Error("unused")),
    close: vi.fn(),
  };
  const e = createEditorSession({
    session,
    manifest,
    levels: new Map(),
    store,
    optimizers: { ...ASSET_OPTIMIZERS, image: pictures },
    optimizerHost: host,
  });
  return {
    e,
    pictures,
    rows: () => selectShelfRows(store.getState()),
    written: () => manifestToWrite(store.getState().tourDocument),
  };
}

const rita = (image = pngBlob(8, 4), frames = pngBlob(16, 4)) => ({
  name: "Ranger Rita",
  image,
  frames,
});

/** `declareCharacter`'s character, or a failed test. */
async function declared(
  e: Awaited<ReturnType<typeof editor>>["e"],
  input = rita(),
): Promise<TourCharacter> {
  const out = await e.declareCharacter(input);
  if (out.kind !== "declared") throw new Error(`refused: ${out.reason}`);
  return out.character;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("declareCharacter", () => {
  it("brings both pictures in and declares the character as one step", async () => {
    const { e, written } = await editor();
    const made = await declared(e);
    const [c] = written()?.characters ?? [];
    expect(c).toEqual(made);
    expect(c?.name).toBe("Ranger Rita");
    const ids = written()?.assets.map((a) => a.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining([c!.image, c!.frames!]));
    expect(e.characters()).toHaveLength(1);
    expect((await e.characterImage(made.id))?.size).toBeGreaterThan(0);
  });

  // Why: the device's library names an entry by its creation time; that
  // id must never reach a tour file. The tour mints its own, a fresh one
  // per character.
  it("mints the tour's own id for each character", async () => {
    const { e } = await editor();
    const one = await declared(e);
    const two = await declared(e, {
      name: "Max",
      image: pngBlob(9, 4),
      frames: pngBlob(17, 4),
    });
    expect(one.id).toMatch(TOUR_ID_PATTERN);
    expect(two.id).toMatch(TOUR_ID_PATTERN);
    expect(one.id).not.toBe(two.id);
  });

  // Why: with a minted id the same character added again from the
  // library comes with a new id; the same four poses tell it is him, and
  // their file is the one the tour holds already, so nothing is added.
  it("refuses the same character twice, bringing no file in", async () => {
    const { e, written } = await editor();
    await declared(e);
    const assets = written()?.assets.length;
    const again = await e.declareCharacter(rita());
    expect(again).toMatchObject({
      kind: "refused",
      reason: expect.stringMatching(/already/),
    });
    expect(written()?.assets.length).toBe(assets);
    expect(e.characters()).toHaveLength(1);
  });

  it("refuses a file that is no picture, and declares nothing", async () => {
    const { e, written } = await editor();
    const text = new Blob(["not a picture"], { type: "text/plain" });
    const out = await e.declareCharacter(rita(text));
    expect(out.kind).toBe("refused");
    expect(written()?.characters).toBeUndefined();
  });

  it("refuses one picture standing for both", async () => {
    const { e } = await editor();
    const same = pngBlob(8, 4);
    await expect(e.declareCharacter(rita(same, same))).resolves.toMatchObject({
      kind: "refused",
      reason: expect.stringMatching(/of their own/),
    });
  });
});

describe("removeCharacter", () => {
  it("removes a declared character, and refuses one the tour lacks", async () => {
    const { e, written } = await editor();
    const { id } = await declared(e);
    expect(e.removeCharacter(id)).toEqual({ kind: "removed" });
    expect(written()?.characters).toBeUndefined();
    expect(e.removeCharacter(id)).toMatchObject({ kind: "refused" });
  });

  // Why: a story entry naming a removed character is a reference the
  // format refuses, so the saved tour would no longer open.
  it("refuses while a story entry names him, and removes him once it is gone", async () => {
    const { e, written } = await editor();
    const { id } = await declared(e);
    const station = written()?.stations[0]?.id ?? "";
    const story = e.addStory(station);
    if (story.kind !== "added") throw new Error("no story");
    const entry = e.addCharacterToStory(story.id, id);
    if (entry.kind !== "added") throw new Error("no entry");
    expect(e.removeCharacter(id)).toEqual({
      kind: "refused",
      reason: "Ranger Rita still speaks in one item. Remove that item first.",
    });
    expect(e.characters()).toHaveLength(1);
    expect(e.deleteStoryChild(entry.id).kind).not.toBe("refused");
    expect(e.removeCharacter(id)).toEqual({ kind: "removed" });
  });
});

// The Characters list's Undo after a Remove declares the same character
// again; it must not bring the pictures in twice or lose them.
describe("restoreCharacter", () => {
  it("declares a removed character again, and refuses a second one", async () => {
    const { e, written } = await editor();
    const made = await declared(e);
    e.removeCharacter(made.id);
    expect(e.restoreCharacter(made)).toEqual({ kind: "declared" });
    expect(written()?.characters).toEqual([made]);
    expect(e.restoreCharacter(made)).toMatchObject({ kind: "refused" });
  });
});

// The add menu's Character inside a story adds an entry naming the
// declared character; a character or story gone meanwhile is refused in
// words.
describe("addCharacterToStory", () => {
  // Why: a character in a story is a 3D character like a free one: he
  // stands at a place of his own in the view a free character starts in,
  // never at the station's anchor point in a card.
  it("adds the declared character at the story's end, standing at the station's free spot", async () => {
    const { e, written } = await editor();
    const { id } = await declared(e);
    const station = written()?.stations[0];
    const story = e.addStory(station?.id ?? "");
    if (story.kind !== "added" || station === undefined) {
      throw new Error("no story");
    }
    const out = e.addCharacterToStory(story.id, id);
    expect(out.kind).toBe("added");
    const stories = (written()?.stations ?? []).flatMap((s) => tourStories(s));
    const child = stories.flatMap((s) => s.children).at(-1);
    expect(child).toMatchObject({
      kind: "character",
      view: "speak",
      character: id,
      name: "Ranger Rita",
      advance: { mode: "tap" },
    });
    const spot = freePinSpot(station);
    const position = (child as { pose?: { position: number[] } }).pose
      ?.position;
    expect(position?.[0]).toBeCloseTo(spot.northM, 6);
    expect(position?.[2]).toBeCloseTo(spot.eastM, 6);
    expect(Math.hypot(position?.[0] ?? 0, position?.[2] ?? 0)).toBeGreaterThan(
      1,
    );
  });

  it("refuses a character the tour does not declare, and a gone story", async () => {
    const { e, written } = await editor();
    const station = written()?.stations[0]?.id ?? "";
    const story = e.addStory(station);
    if (story.kind !== "added") throw new Error("no story");
    expect(e.addCharacterToStory(story.id, "nobody")).toMatchObject({
      kind: "refused",
      reason: expect.stringMatching(/no longer/),
    });
    expect(e.addCharacterToStory("gone", "c1abc")).toMatchObject({
      kind: "refused",
    });
  });
});

// Why: the asset shelf shrinks pictures it is given to lossy WebP; a pose
// sheet must stay byte-identical (its cells are cut by position, and a
// re-encoded copy no longer matches the exchange file). These hold with a
// picture optimizer set, as the shelf's image line will set one.
describe("a character's pictures and the asset shelf", () => {
  it("brings a declared character's pictures in untouched: never queued, not on the shelf", async () => {
    const { e, pictures, rows } = await editor();
    const made = await declared(e);
    await settle();
    const ids = rows().map((r) => r.id);
    expect(ids).not.toContain(made.image);
    expect(ids).not.toContain(made.frames);
    expect(pictures.calls).toHaveLength(0);
    // The control: an ordinary picture brought in is queued.
    const other = await e.addFile(pngBlob(30, 20), "photo.png", ["image"]);
    if (other.kind !== "added") throw new Error("not added");
    await settle();
    expect(rows().map((r) => r.id)).toContain(other.asset.id);
    expect(pictures.calls).toHaveLength(1);
  });

  it("keeps an opened tour's character pictures off the shelf, so Optimize this tour cannot reach them", async () => {
    const picture = pngBlob(8, 4);
    const sheet = pngBlob(16, 4);
    const idOf = async (b: Blob) =>
      sha256Hex(new Uint8Array(await b.arrayBuffer()));
    const [imageId, framesId] = [await idOf(picture), await idOf(sheet)];
    const asset = (id: string) => ({
      id,
      path: `content/${id}.png`,
      kind: "image" as const,
      width: 8,
      height: 4,
    });
    const manifest = parseTourManifest(
      JSON.parse(
        serializeTourManifest({
          ...MANIFEST,
          assets: [...MANIFEST.assets, asset(imageId), asset(framesId)],
          characters: [
            { id: "k1", name: "Rita", image: imageId, frames: framesId },
          ],
        }),
      ),
    );
    const { e, rows, pictures } = await editor(manifest, [
      { path: `content/${imageId}.png`, data: picture },
      { path: `content/${framesId}.png`, data: sheet },
    ]);
    expect(e.characters()).toHaveLength(1);
    e.shelf.optimizeTour();
    await settle();
    expect(rows().map((r) => r.id)).not.toContain(imageId);
    expect(rows().map((r) => r.id)).not.toContain(framesId);
    expect(pictures.calls).toHaveLength(0);
  });
});
