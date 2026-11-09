/**
 * Why these tests matter: a file brought in is made smaller in the
 * background, and the smaller file replaces the original under the SAME
 * asset id (`assetOptimized`), so no item, narration or step ever changes.
 * Only the asset's path (its extension) and an image's size change. The
 * document must list the new path wherever it lists the asset - also for
 * an asset the written file already lists under the old path, or the next
 * save would keep the original - and refuse a path the format would refuse,
 * since every later save would then fail.
 */
import type {
  TourAsset,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import { tourOf } from "./test-support/tour-of.js";
import {
  initialTourDocumentState,
  manifestNow,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ID = "b".repeat(64);
const PHOTO: TourAsset = {
  id: ID,
  path: `content/${ID}.png`,
  kind: "image",
  width: 4000,
  height: 3000,
};

const PICTURE: TourObject = {
  id: "p",
  kind: "picture",
  view: "plane",
  image: ID,
  widthM: 1,
  imageAsset: PHOTO,
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
};

function withPicture(): TourDocumentState {
  const opened = reduce(
    initialTourDocumentState,
    act.opened({ manifest: tourOf([]) }),
  );
  const listed = reduce(opened, act.assetsAdded({ assets: [PHOTO] }));
  return reduce(listed, act.placed({ object: PICTURE, what: "the picture" }));
}

describe("assetOptimized: the same id, a new path", () => {
  it("lists the new path and size, keeps every record naming the id, and counts the swap", () => {
    const before = withPicture();
    const after = reduce(
      before,
      act.assetOptimized({
        id: ID,
        path: `content/${ID}.webp`,
        width: 1600,
        height: 1200,
      }),
    );
    const written = manifestToWrite(after);
    expect(written?.assets).toContainEqual({
      id: ID,
      path: `content/${ID}.webp`,
      kind: "image",
      width: 1600,
      height: 1200,
    });
    expect(written?.assets.filter((a) => a.id === ID)).toHaveLength(1);
    expect(after.placed).toEqual(before.placed);
    expect(after.assetSwaps[ID]).toBe(1);
    // No step of its own: an undo takes back the placement, not the swap.
    expect(after.past).toHaveLength(before.past.length);
  });

  // Why: the written file lists the asset under its old path once a save
  // wrote the original. The document must list the NEW path then, or the
  // manifest would name the old entry the save removes.
  it("replaces the written file's record of the same id", () => {
    const opened = reduce(
      initialTourDocumentState,
      act.opened({
        manifest: { ...tourOf([]), assets: [PHOTO] },
      }),
    );
    const after = reduce(
      opened,
      act.assetOptimized({ id: ID, path: `content/${ID}.webp` }),
    );
    const listed = manifestNow(after)?.assets.filter((a) => a.id === ID);
    // An image re-encoded without a new size keeps the size it had.
    expect(listed).toEqual([{ ...PHOTO, path: `content/${ID}.webp` }]);
  });

  it("refuses a path of another id, another kind, or no allowlisted extension", () => {
    const before = withPicture();
    for (const path of [
      `content/${"c".repeat(64)}.webp`,
      `content/${ID}.opus`,
      `content/${ID}.exe`,
      `${ID}.webp`,
    ]) {
      expect(reduce(before, act.assetOptimized({ id: ID, path }))).toBe(before);
    }
    expect(
      reduce(
        before,
        act.assetOptimized({
          id: "c".repeat(64),
          path: `content/${"c".repeat(64)}.webp`,
        }),
      ),
    ).toBe(before);
  });

  it("refuses a size that is no positive whole number", () => {
    const before = withPicture();
    for (const width of [0, -1, 1.5, Number.NaN]) {
      expect(
        reduce(
          before,
          act.assetOptimized({
            id: ID,
            path: `content/${ID}.webp`,
            width,
            height: 10,
          }),
        ),
      ).toBe(before);
    }
  });

  // Why: a file made smaller in its own format keeps its record (same
  // path, same size); its bytes are new all the same, so the swap counts
  // and the next save writes them.
  it("counts a swap to the record it already lists, and back to the original is a swap too", () => {
    const swapped = reduce(
      withPicture(),
      act.assetOptimized({
        id: ID,
        path: `content/${ID}.webp`,
        width: 1600,
        height: 1200,
      }),
    );
    const again = reduce(
      swapped,
      act.assetOptimized({
        id: ID,
        path: `content/${ID}.webp`,
        width: 1600,
        height: 1200,
      }),
    );
    expect(again).not.toBe(swapped);
    expect(manifestToWrite(again)).toEqual(manifestToWrite(swapped));
    expect(again.assetSwaps[ID]).toBe(2);
    const back = reduce(
      swapped,
      act.assetOptimized({
        id: ID,
        path: PHOTO.path,
        width: 4000,
        height: 3000,
      }),
    );
    expect(manifestToWrite(back)?.assets).toContainEqual(PHOTO);
    expect(back.assetSwaps[ID]).toBe(2);
  });
});
