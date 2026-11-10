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
import { describe, expect, it } from "vitest";

import { manifestToWrite } from "../tour-document.js";
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

async function editor() {
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(MANIFEST) },
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  const store = editorStore();
  const e = createEditorSession({
    session,
    manifest: MANIFEST,
    levels: new Map(),
    store,
  });
  return { e, written: () => manifestToWrite(store.getState().tourDocument) };
}

const rita = (image = pngBlob(8, 4), frames = pngBlob(16, 4)) => ({
  id: "c1abc",
  name: "Ranger Rita",
  image,
  frames,
});

describe("declareCharacter", () => {
  it("brings both pictures in and declares the character as one step", async () => {
    const { e, written } = await editor();
    await expect(e.declareCharacter(rita())).resolves.toMatchObject({
      kind: "declared",
    });
    const [c] = written()?.characters ?? [];
    expect(c?.name).toBe("Ranger Rita");
    const ids = written()?.assets.map((a) => a.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining([c!.image, c!.frames!]));
    expect(e.characters()).toHaveLength(1);
    expect((await e.characterImage("c1abc"))?.size).toBeGreaterThan(0);
  });

  it("refuses the same character twice, before bringing its files in", async () => {
    const { e, written } = await editor();
    await e.declareCharacter(rita());
    const assets = written()?.assets.length;
    const again = await e.declareCharacter(rita(pngBlob(9, 4), pngBlob(17, 4)));
    expect(again).toMatchObject({
      kind: "refused",
      reason: expect.stringMatching(/already/),
    });
    expect(written()?.assets.length).toBe(assets);
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
    await e.declareCharacter(rita());
    expect(e.removeCharacter("c1abc")).toEqual({ kind: "removed" });
    expect(written()?.characters).toBeUndefined();
    expect(e.removeCharacter("c1abc")).toMatchObject({ kind: "refused" });
  });
});

// The Characters list's Undo after a Remove declares the same character
// again; it must not bring the pictures in twice or lose them.
describe("restoreCharacter", () => {
  it("declares a removed character again, and refuses a second one", async () => {
    const { e, written } = await editor();
    await e.declareCharacter(rita());
    const [declared] = e.characters();
    e.removeCharacter("c1abc");
    expect(e.restoreCharacter(declared!)).toEqual({ kind: "declared" });
    expect(written()?.characters).toEqual([declared]);
    expect(e.restoreCharacter(declared!)).toMatchObject({ kind: "refused" });
  });
});

// The add menu's Character inside a story adds a card naming the declared
// character; a character or story gone meanwhile is refused in words.
describe("addCharacterToStory", () => {
  it("adds the declared character as a card at the story's end", async () => {
    const { e, written } = await editor();
    await e.declareCharacter(rita());
    const station = written()?.stations[0]?.id ?? "";
    const story = e.addStory(station);
    if (story.kind !== "added") throw new Error("no story");
    const out = e.addCharacterToStory(story.id, "c1abc");
    expect(out.kind).toBe("added");
    const stories = (written()?.stations ?? []).flatMap((s) => tourStories(s));
    const child = stories.flatMap((s) => s.children).at(-1);
    expect(child).toMatchObject({
      kind: "character",
      view: "card",
      character: "c1abc",
      name: "Ranger Rita",
    });
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
