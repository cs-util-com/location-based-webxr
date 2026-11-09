/**
 * Why these tests matter: an item made from a file is placed with no
 * gesture, so its size, reach and name are the code's choice. Each kind
 * must start as a block the format takes (a sound's circle has the radius
 * its view needs, a model the size every world view needs), inside its
 * station's circle, and named after its file within the kind's title cap -
 * or the add would be refused, or the item stand out of reach.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-assets";
import {
  TOUR_BLOCK_TEXT_RULES,
  checkTourBlockText,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import {
  parseTourObject,
  tourObjectRecord,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";

// Activates the licence the station frame's geodesy needs.
import "../test-support/tour-of.js";
import type { FileAddKind } from "../kinds/edit-kinds.js";
import { stationContent } from "../test-support/station-content.js";
import {
  fileItemTitle,
  NEW_MODEL_SIZE_M,
  NEW_PICTURE_WIDTH_M,
  NEW_SOUND_RADIUS_M,
  newFileItem,
  newFileStoryEntry,
} from "./new-file-item.js";

const AT = "2026-11-09T10:00:00Z";
const KINDS: readonly FileAddKind[] = ["picture", "audio", "video", "model"];

const ASSETS: Record<FileAddKind, TourAsset> = {
  picture: {
    id: "img1",
    path: "content/img1.png",
    kind: "image",
    width: 40,
    height: 30,
  },
  audio: { id: "snd1", path: "content/snd1.wav", kind: "audio" },
  video: { id: "vid1", path: "content/vid1.mp4", kind: "video" },
  model: { id: "glb1", path: "content/glb1.glb", kind: "model" },
};
const POSTER: TourAsset = {
  id: "pst1",
  path: "content/pst1.jpg",
  kind: "image",
  width: 16,
  height: 9,
};

function station(foundRadiusM = 25, pins = 0): TourStation {
  return {
    id: "s",
    title: "Gate",
    geo: { lat: 48.1371, lon: 11.5751, alt: 520, headingDeg: 40 },
    activateRadiusM: 2 * foundRadiusM,
    foundRadiusM,
    hint: "arrow",
    ...stationContent(
      Array.from({ length: pins }, (_, i) => ({
        id: `pin-${String(i)}`,
        kind: "shortText",
        view: "pin",
        caption: `Pin ${String(i)}`,
        createdAtIso: AT,
        pose: {
          position: [4 * Math.cos(i), 0, 4 * Math.sin(i)],
          rotation: [0, 0, 0, 1],
        },
      })),
    ),
  } as unknown as TourStation;
}

const source = (kind: FileAddKind, fileName = "Bell tower.wav") => ({
  kind,
  asset: ASSETS[kind],
  fileName,
  ...(kind === "video" ? { poster: POSTER } : {}),
});

describe("fileItemTitle", () => {
  // Why: the item is named after the file the creator chose, so it is
  // found in the tree by the name they know.
  it("is the file's name without its extension, separators made spaces", () => {
    expect(fileItemTitle("church_bells-1890.wav", "audio")).toBe(
      "church bells 1890",
    );
    expect(fileItemTitle("Ferry.glb", "model")).toBe("Ferry");
    expect(fileItemTitle(".hidden", "picture")).toBe(".hidden");
  });

  it("takes the kind's word for a name that leaves nothing", () => {
    expect(fileItemTitle("___.wav", "audio")).toBe("Sound");
    expect(fileItemTitle(".glb", "model")).toBe(".glb");
    expect(fileItemTitle("", "video")).toBe("Video");
  });

  // Why: a title over the kind's cap is refused by the format, and the
  // whole add with it; a cut in the middle of an emoji is not one
  // character either.
  it("always fits the kind's title rule, whatever the name", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...KINDS),
        fc.string({ unit: "grapheme", maxLength: 200 }),
        (kind, name) => {
          const title = fileItemTitle(name, kind);
          expect(
            checkTourBlockText(TOUR_BLOCK_TEXT_RULES[kind].title, title).ok,
          ).toBe(true);
        },
      ),
    );
  });
});

describe("newFileItem", () => {
  const input = (s = station()) => ({
    station: s,
    id: "new",
    nowIso: AT,
    groundAt: () => null,
  });

  it("makes a picture a plane at its starting width, its image inline", () => {
    const item = newFileItem(input(), source("picture", "gate.png"));
    expect(item).toMatchObject({
      kind: "picture",
      view: "plane",
      image: "img1",
      widthM: NEW_PICTURE_WIDTH_M,
      imageAsset: ASSETS.picture,
      title: "gate",
      station: "s",
      createdAtIso: AT,
    });
  });

  it("makes a sound a narration circle, a model a placed model at its size", () => {
    expect(newFileItem(input(), source("audio"))).toMatchObject({
      kind: "audio",
      view: "spot",
      audio: "snd1",
      radiusM: NEW_SOUND_RADIUS_M,
    });
    expect(newFileItem(input(), source("model", "ferry.glb"))).toMatchObject({
      kind: "model",
      view: "placed",
      asset: "glb1",
      sizeM: NEW_MODEL_SIZE_M,
    });
  });

  // Why: no free host draws a video, so it would be an item nobody sees.
  it("makes no free video", () => {
    expect(newFileItem(input(), source("video", "flood.mp4"))).toBeNull();
  });

  // Why: a free item the format would not read back is lost at the next
  // open; each kind's starting fields are what its view requires.
  it("makes every free kind a record the format reads back as it was", () => {
    for (const kind of ["picture", "audio", "model"] as const) {
      const item = newFileItem(input(), source(kind));
      if (item === null) throw new Error(kind);
      expect(
        parseTourObject(JSON.parse(JSON.stringify(tourObjectRecord(item)))),
      ).toEqual(item);
    }
  });

  // Why (the sweep): the item lands at the station's free spot, which
  // must be inside the circle for every plausible radius and fill - a
  // station of 3 m holds it as well as one of 60 m, with up to 12 items
  // there already.
  it("stands inside its station's circle across radii and fills", () => {
    for (const radius of [3, 5, 8, 12, 25, 40, 60]) {
      for (const pins of [0, 1, 4, 8, 12]) {
        const s = station(radius, pins);
        for (const kind of ["picture", "audio", "model"] as const) {
          const item = newFileItem(input(s), source(kind));
          if (item === null) throw new Error(kind);
          const pose = localPoseOf(item.geo, s.geo);
          const off = Math.hypot(pose.position[0], pose.position[2]);
          expect(off).toBeLessThanOrEqual(radius + 1e-6);
        }
      }
    }
  });
});

describe("newFileStoryEntry", () => {
  it("makes each kind a card that moves on by a tap, at the station's middle", () => {
    for (const kind of KINDS) {
      const entry = newFileStoryEntry(source(kind), `e-${kind}`);
      expect(entry).toMatchObject({
        id: `e-${kind}`,
        kind,
        view: "card",
        advance: { mode: "tap" },
        pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        title: "Bell tower",
      });
    }
  });

  it("carries each kind's file, sizes and a video's poster", () => {
    expect(newFileStoryEntry(source("picture"), "p")).toMatchObject({
      image: "img1",
      widthM: NEW_PICTURE_WIDTH_M,
    });
    expect(newFileStoryEntry(source("audio"), "a")).toMatchObject({
      audio: "snd1",
    });
    expect(newFileStoryEntry(source("model"), "m")).toMatchObject({
      asset: "glb1",
      sizeM: NEW_MODEL_SIZE_M,
    });
    expect(newFileStoryEntry(source("video"), "v")).toMatchObject({
      video: "vid1",
      poster: "pst1",
    });
    const { poster: _poster, ...bare } = source("video");
    expect(newFileStoryEntry(bare, "v")).not.toHaveProperty("poster");
  });
});
