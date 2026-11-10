/**
 * Why these tests matter: the shelf's delete of a file in use and its
 * "Replace everywhere" act on every block naming the file, by HOW each
 * block names it (the format's references, `file-uses.ts`). A block made
 * of the file goes; one that only mentions it (a long text's narration, a
 * video's poster, a character's voice) keeps standing without it; a long
 * text showing a picture inside its words, or a character declaration
 * drawn with the file, refuses the delete. A replace switches every use,
 * the mentions and the inline pictures too, in one step an undo takes
 * back whole. And a free picture made from a file reads that file's
 * record as it stands, never a copy gone stale when the shelf swapped in
 * a smaller file.
 */
import type {
  TourAsset,
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import { tourOf } from "./test-support/tour-of.js";
import {
  documentObjects,
  effectiveDetails,
  fileUseCount,
  fileUsesAll,
  fileUsesOf,
  manifestToWrite,
  tourDocumentActions as doc,
  tourDocumentReducer,
  type TourDocumentState,
} from "./tour-document.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const GEO: TourObject["geo"] = {
  lat: 48.52,
  lon: 9.05,
  alt: 340,
  rotation: [0, 0, 0, 1],
};

const sound = (id: string): TourAsset => ({
  id,
  path: `content/${id}.wav`,
  kind: "audio",
});
const picture = (id: string): TourAsset => ({
  id,
  path: `content/${id}.png`,
  kind: "image",
  width: 40,
  height: 30,
});
const ASSETS: TourAsset[] = [
  sound("snd1"),
  sound("snd2"),
  picture("pic1"),
  picture("pic2"),
  picture("pst1"),
  { id: "vid1", path: "content/vid1.mp4", kind: "video" },
];

const NARRATED: TourObject = {
  id: "told",
  kind: "longText",
  view: "reading",
  title: "The mill",
  body: "The mill turned all day.",
  narration: { audio: "snd1", synthetic: false },
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: GEO,
};
const ILLUSTRATED: TourObject = {
  id: "shown",
  kind: "longText",
  view: "reading",
  title: "The gate",
  body: "The gate in 1890:\n\n![The gate](asset:pic1)\n",
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { ...GEO, lat: 48.53 },
};
const FREE_PICTURE: TourObject = {
  id: "free-pic",
  kind: "picture",
  view: "plane",
  image: "pic1",
  widthM: 1,
  imageAsset: picture("pic1"),
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { ...GEO, lat: 48.54 },
};

/** A station whose story holds a sound made of `snd1`, a video with the
 *  poster `pst1` and a character whose voice is `snd1`. */
const STORIED = {
  id: "s-story",
  geo: { ...GEO, lat: 48.55 },
  activateRadiusM: 50,
  foundRadiusM: 25,
  hint: "arrow",
  children: [
    {
      id: "tale",
      kind: "folder",
      role: "story",
      title: "The tale",
      children: [
        { id: "bells", kind: "audio", audio: "snd1", title: "Bells" },
        {
          id: "flood",
          kind: "video",
          video: "vid1",
          poster: "pst1",
          title: "Flood",
        },
        {
          id: "miller",
          kind: "character",
          image: "pic2",
          voice: "snd1",
          name: "The miller",
        },
      ],
    },
  ],
} as unknown as TourStation;

function opened(
  objects: readonly TourObject[],
  extra: Partial<TourManifest> = {},
): TourDocumentState {
  const manifest = tourOf(objects, {
    assets: ASSETS,
    stations: [STORIED],
    ...extra,
  });
  return tourDocumentReducer(undefined, doc.opened({ manifest }));
}

function blocks(state: TourDocumentState): Record<string, unknown>[] {
  const manifest = manifestToWrite(state);
  if (manifest === null) throw new Error("no tour");
  return manifest.stations.flatMap((s) => [
    ...s.children,
    ...tourStories(s).flatMap((story) => story.children),
  ]) as unknown as Record<string, unknown>[];
}
const block = (state: TourDocumentState, id: string) =>
  blocks(state).find((b) => b["id"] === id);

describe("fileUsesOf", () => {
  it("classes each block by how it names the file", () => {
    const state = opened([NARRATED, ILLUSTRATED, FREE_PICTURE]);
    const snd = fileUsesOf(state, "snd1");
    expect(snd.own.map((b) => b.id)).toEqual(["bells"]);
    expect(snd.mentions.map((b) => b.id).sort()).toEqual(["miller", "told"]);
    expect(snd.inline).toEqual([]);
    const pic = fileUsesOf(state, "pic1");
    expect(pic.own.map((b) => b.id)).toEqual(["free-pic"]);
    expect(pic.inline.map((b) => b.id)).toEqual(["shown"]);
    expect(fileUsesOf(state, "pst1").mentions.map((b) => b.id)).toEqual([
      "flood",
    ]);
  });
});

describe("deleting a file in use (fileUsesDeleted)", () => {
  const del = (state: TourDocumentState, assetId: string) =>
    tourDocumentReducer(
      state,
      doc.fileUsesDeleted({ assetId, what: "the delete" }),
    );

  it("deletes the items made of a sound and drops it from a narration and a character's voice, in one step", () => {
    const before = opened([NARRATED]);
    const after = del(before, "snd1");
    expect(after.revision).toBe(before.revision + 1);
    expect(block(after, "bells")).toBeUndefined();
    expect(block(after, "told")).toBeDefined();
    expect(block(after, "told")?.["narration"]).toBeUndefined();
    expect(block(after, "miller")).toMatchObject({ image: "pic2" });
    expect(block(after, "miller")?.["voice"]).toBeUndefined();
    const undone = tourDocumentReducer(after, doc.undone());
    expect(block(undone, "bells")).toBeDefined();
    expect(block(undone, "told")?.["narration"]).toEqual({
      audio: "snd1",
      synthetic: false,
    });
    expect(block(undone, "miller")?.["voice"]).toBe("snd1");
  });

  it("keeps a video whose poster it is, without the poster", () => {
    const after = del(opened([]), "pst1");
    expect(block(after, "flood")).toMatchObject({ video: "vid1" });
    expect(block(after, "flood")?.["poster"]).toBeUndefined();
  });

  it("refuses while a long text shows the picture inside its words", () => {
    const before = opened([ILLUSTRATED, FREE_PICTURE]);
    expect(del(before, "pic1")).toBe(before);
  });

  it("refuses while a character of the tour is drawn with the file", () => {
    const before = opened([FREE_PICTURE], {
      characters: [{ id: "c", name: "Sir", image: "pic1" }],
    });
    expect(fileUsesOf(before, "pic1").characters).toEqual(["Sir"]);
    expect(del(before, "pic1")).toBe(before);
  });
});

describe("replacing a file everywhere (fileReplaced)", () => {
  const replace = (state: TourDocumentState, from: string, to: string) =>
    tourDocumentReducer(
      state,
      doc.fileReplaced({ from, to, what: "the replace" }),
    );

  it("switches the items made of it and the ones mentioning it, in one step an undo takes back", () => {
    const before = opened([NARRATED]);
    const after = replace(before, "snd1", "snd2");
    expect(after.revision).toBe(before.revision + 1);
    expect(block(after, "bells")).toMatchObject({ audio: "snd2" });
    expect(block(after, "told")?.["narration"]).toMatchObject({
      audio: "snd2",
    });
    expect(block(after, "miller")).toMatchObject({ voice: "snd2" });
    const undone = tourDocumentReducer(after, doc.undone());
    expect(block(undone, "bells")).toMatchObject({ audio: "snd1" });
    expect(block(undone, "told")?.["narration"]).toMatchObject({
      audio: "snd1",
    });
    expect(block(undone, "miller")).toMatchObject({ voice: "snd1" });
  });

  it("switches a picture inside a long text's words and a free picture's record", () => {
    const after = replace(opened([ILLUSTRATED, FREE_PICTURE]), "pic1", "pic2");
    expect(block(after, "shown")?.["body"]).toBe(
      "The gate in 1890:\n\n![The gate](asset:pic2)\n",
    );
    const free = documentObjects(after).find((o) => o.object.id === "free-pic");
    expect(free?.object).toMatchObject({
      image: "pic2",
      imageAsset: picture("pic2"),
    });
  });

  it("changes nothing for a file of another kind, an unlisted file or the same file", () => {
    const before = opened([NARRATED]);
    expect(replace(before, "snd1", "pic2")).toBe(before);
    expect(replace(before, "snd1", "nothing")).toBe(before);
    expect(replace(before, "snd1", "snd1")).toBe(before);
  });

  it("changes nothing for a file a character of the tour is drawn with", () => {
    const before = opened([FREE_PICTURE], {
      characters: [{ id: "c", name: "Sir", image: "pic1" }],
    });
    expect(replace(before, "pic1", "pic2")).toBe(before);
  });
});

describe("a free picture's record", () => {
  // Why: the shelf's swap replaces the file's record, not the copy an
  // edit took into the picture; the 3D view and a save read the copy.
  it("is its file's record as it stands, after the shelf swapped in a smaller file", () => {
    let state = opened([]);
    state = tourDocumentReducer(
      state,
      doc.assetsAdded({ assets: [picture("pic3")] }),
    );
    state = tourDocumentReducer(
      state,
      doc.edited({
        object: {
          ...FREE_PICTURE,
          id: "new-pic",
          image: "pic3",
          imageAsset: picture("pic3"),
          station: "s-story",
        },
        what: "a picture",
      }),
    );
    state = tourDocumentReducer(
      state,
      doc.assetOptimized({ id: "pic3", path: "content/pic3.webp" }),
    );
    const found = documentObjects(state).find((o) => o.object.id === "new-pic");
    expect(found?.object).toMatchObject({
      imageAsset: { id: "pic3", path: "content/pic3.webp" },
    });
  });
});

describe("the tour's cover and a file's count of uses", () => {
  // Why: "which places use a file" is one walk (`fileUsesAll`). The
  // card's "Used in N", the delete's words and Replace's count all read
  // it, so they can never disagree, and the tour's cover is one of the
  // places - a cover-only file is in use, not a file nothing needs.
  const COVER = picture("cov1");
  const covered = (objects: readonly TourObject[], cover: string) =>
    opened(objects, { assets: [...ASSETS, COVER], cover });

  it("counts the cover as a use, and each block, card and character once", () => {
    const state = covered([NARRATED, FREE_PICTURE], "cov1");
    expect(fileUsesOf(state, "cov1").cover).toBe(true);
    expect(fileUseCount(fileUsesOf(state, "cov1"))).toBe(1);
    expect(fileUsesOf(state, "pic1").cover).toBe(false);
    // snd1: the sound "bells", the narration of "told", the miller's voice.
    expect(fileUseCount(fileUsesOf(state, "snd1"))).toBe(3);
    expect(fileUseCount(fileUsesOf(state, "nothing"))).toBe(0);
  });

  // Why: the walk lists every file the tour uses and nothing else, each
  // with the count one can check by hand against the tour above.
  it("lists each file the tour uses, and only those, with its count", () => {
    const state = covered([NARRATED, ILLUSTRATED, FREE_PICTURE], "pic1");
    const counts = Object.fromEntries(
      [...fileUsesAll(state)].map(([id, uses]) => [id, fileUseCount(uses)]),
    );
    // snd1: "bells", the narration of "told", the miller's voice; pic1: the
    // free picture, the long text showing it, the cover; pic2: the miller;
    // vid1: the video "flood"; pst1: its poster. cov1 is listed but unused.
    expect(counts).toEqual({ snd1: 3, pic1: 3, pic2: 1, vid1: 1, pst1: 1 });
  });

  it("a delete of a cover-only file takes the cover off, in one step an undo takes back", () => {
    const before = covered([], "cov1");
    const after = tourDocumentReducer(
      before,
      doc.fileUsesDeleted({ assetId: "cov1", what: "the delete" }),
    );
    expect(after.revision).toBe(before.revision + 1);
    expect(effectiveDetails(after).cover).toBeUndefined();
    const undone = tourDocumentReducer(after, doc.undone());
    expect(effectiveDetails(undone).cover).toBe("cov1");
  });

  it("a delete of a picture's file that is also the cover takes both", () => {
    const after = tourDocumentReducer(
      covered([FREE_PICTURE], "pic1"),
      doc.fileUsesDeleted({ assetId: "pic1", what: "the delete" }),
    );
    expect(documentObjects(after).map((o) => o.object.id)).not.toContain(
      "free-pic",
    );
    expect(after.details.cover).toBeUndefined();
  });

  it("a replace switches the cover with the pictures", () => {
    const after = tourDocumentReducer(
      covered([FREE_PICTURE], "pic1"),
      doc.fileReplaced({ from: "pic1", to: "pic2", what: "the replace" }),
    );
    expect(effectiveDetails(after).cover).toBe("pic2");
  });

  it("a replace of a cover-only file by a file brought in keeps the new cover, and an undo the old", () => {
    let state = covered([], "cov1");
    state = tourDocumentReducer(
      state,
      doc.assetsAdded({ assets: [picture("new1")] }),
    );
    const after = tourDocumentReducer(
      state,
      doc.fileReplaced({ from: "cov1", to: "new1", what: "the replace" }),
    );
    expect(after.revision).toBe(state.revision + 1);
    expect(effectiveDetails(after).cover).toBe("new1");
    expect(manifestToWrite(after)?.cover).toBe("new1");
    const undone = tourDocumentReducer(after, doc.undone());
    expect(effectiveDetails(undone).cover).toBe("cov1");
  });
});

describe("a station's card image on Replace everywhere", () => {
  // Why: a station's card may show a file that no picture of that station
  // shows. Replace switches the card to the new file brought in here; the
  // written tour must keep it, and the shelf's "Used in" must name the
  // same station the save writes - one rule for both.
  const CARDED = {
    id: "s-card",
    geo: { ...GEO, lat: 48.56 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    image: "pic2",
    children: [],
  } as unknown as TourStation;

  it("keeps the card on the new file, and the uses and the save agree", () => {
    let state = opened([FREE_PICTURE], { stations: [STORIED, CARDED] });
    state = tourDocumentReducer(
      state,
      doc.assetsAdded({ assets: [picture("new2")] }),
    );
    const after = tourDocumentReducer(
      state,
      doc.fileReplaced({ from: "pic2", to: "new2", what: "the replace" }),
    );
    const written = manifestToWrite(after);
    expect(written?.stations.find((s) => s.id === "s-card")?.image).toBe(
      "new2",
    );
    expect(written?.assets.map((a) => a.id)).toContain("new2");
    expect(fileUsesOf(after, "new2").cards).toEqual(["s-card"]);
    const undone = tourDocumentReducer(after, doc.undone());
    expect(
      manifestToWrite(undone)?.stations.find((s) => s.id === "s-card")?.image,
    ).toBe("pic2");
  });

  it("counts no card the save would not write", () => {
    // A card naming a file the tour does not list is none when written,
    // so it is no use of that file either.
    const state = opened([], {
      stations: [STORIED, { ...CARDED, image: "gone" }],
    });
    expect(
      manifestToWrite(state)?.stations.find((s) => s.id === "s-card")?.image,
    ).toBeUndefined();
    expect(fileUsesOf(state, "gone").cards).toEqual([]);
  });
});

describe("a replaced video's poster (fileReplaced)", () => {
  // Why: the old poster is a still of the OLD video; kept, every visitor
  // would see a frame of a video that is no longer there. The replace
  // does what one item's file change does (`withBlockFile`): the new
  // video's poster, or none.
  const withVideo = () =>
    tourDocumentReducer(
      opened([]),
      doc.assetsAdded({
        assets: [
          { id: "vid2", path: "content/vid2.mp4", kind: "video" },
          picture("pst2"),
        ],
      }),
    );

  it("takes the poster made for the new video", () => {
    const after = tourDocumentReducer(
      withVideo(),
      doc.fileReplaced({
        from: "vid1",
        to: "vid2",
        poster: "pst2",
        what: "the replace",
      }),
    );
    expect(block(after, "flood")).toMatchObject({
      video: "vid2",
      poster: "pst2",
    });
  });

  it("drops the old video's poster when the new video has none", () => {
    const after = tourDocumentReducer(
      withVideo(),
      doc.fileReplaced({ from: "vid1", to: "vid2", what: "the replace" }),
    );
    expect(block(after, "flood")).toMatchObject({ video: "vid2" });
    expect(block(after, "flood")?.["poster"]).toBeUndefined();
  });

  it("switches a poster that is itself the replaced picture", () => {
    const after = tourDocumentReducer(
      opened([]),
      doc.fileReplaced({ from: "pst1", to: "pic1", what: "the replace" }),
    );
    expect(block(after, "flood")).toMatchObject({
      video: "vid1",
      poster: "pic1",
    });
  });
});
