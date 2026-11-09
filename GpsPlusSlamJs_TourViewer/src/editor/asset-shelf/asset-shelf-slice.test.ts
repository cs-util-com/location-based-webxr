/**
 * Why these tests matter: the shelf's panel reads only this plain data
 * (Blobs are never state), so what a row says - its phase, its place in
 * the queue, how many items use the file, how often a preview must reload
 * it, whether "use the original" can be offered - must be derivable from
 * the store alone. "Use the original" in particular is derived, not a
 * flag the runner forgets to clear: once a save that wrote the smaller
 * file landed, the draft no longer keeps the original, and the shelf must
 * stop offering it.
 */
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import { tourOf } from "../../test-support/tour-of.js";
import {
  initialTourDocumentState,
  tourDocumentActions as doc,
  tourDocumentReducer,
  type TourDocumentState,
} from "../../tour-document.js";
import {
  assetShelfActions as act,
  assetShelfReducer,
  initialAssetShelfState,
  selectShelfRows,
  type AssetShelfState,
} from "./asset-shelf-slice.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const A = "a".repeat(64);
const B = "b".repeat(64);
const ASSET: TourAsset = {
  id: A,
  path: `content/${A}.png`,
  kind: "image",
  width: 4000,
  height: 3000,
};

function shelf(...actions: Parameters<typeof assetShelfReducer>[1][]) {
  return actions.reduce(assetShelfReducer, initialAssetShelfState);
}

function documentWith(...assets: TourAsset[]): TourDocumentState {
  const opened = tourDocumentReducer(
    initialTourDocumentState,
    doc.opened({ manifest: tourOf([]) }),
  );
  return tourDocumentReducer(opened, doc.assetsAdded({ assets }));
}

function rows(s: AssetShelfState, d = documentWith(ASSET)) {
  return selectShelfRows({ assetShelf: s, tourDocument: d });
}

const added = (id: string, queued = true) =>
  act.entryAdded({
    id,
    kind: "image",
    name: `${id.slice(0, 1)}.png`,
    origin: "added",
    originalBytes: 1000,
    queued,
  });

describe("the shelf's plain data", () => {
  it("gives each row its phase, queue position and sizes", () => {
    const s = shelf(added(A), added(B), act.jobStarted({ id: A }));
    const [a, b] = rows(s);
    expect(a).toMatchObject({
      id: A,
      kind: "image",
      name: "a.png",
      status: "running",
      queuePosition: null,
      originalBytes: 1000,
      estimatedBytes: 1000,
    });
    expect(b).toMatchObject({ status: "queued", queuePosition: 0 });
    const done = shelf(
      added(A),
      act.jobStarted({ id: A }),
      act.jobOptimized({ id: A, optimizedBytes: 200, originalHeld: true }),
    );
    expect(rows(done)[0]).toMatchObject({
      status: "optimized",
      optimizedBytes: 200,
      estimatedBytes: 200,
    });
  });

  it("an opened tour's file waits idle until asked, and a second add of an id is no change", () => {
    const s = shelf(
      act.entryAdded({
        id: A,
        kind: "image",
        name: "a.png",
        origin: "opened",
        originalBytes: 5,
        queued: false,
      }),
    );
    expect(rows(s)[0]).toMatchObject({ status: "idle", origin: "opened" });
    expect(assetShelfReducer(s, added(A))).toBe(s);
    expect(
      rows(assetShelfReducer(s, act.jobQueued({ id: A })))[0]?.status,
    ).toBe("queued");
  });

  it("a kind without an optimizer comes in kept, with the reason", () => {
    const s = shelf(
      act.entryAdded({
        id: A,
        kind: "video",
        name: "v.mp4",
        origin: "added",
        originalBytes: 5,
        queued: false,
        keptReason: "no optimizer",
      }),
    );
    expect(rows(s)[0]).toMatchObject({
      status: "kept",
      reason: "no optimizer",
    });
  });

  // Why: the shelf names how many items use a file before a delete, and a
  // preview reloads its object URL once per swap.
  it("counts the places a file is used and the swaps a preview must follow", () => {
    const picture = {
      id: "p",
      kind: "picture" as const,
      view: "plane" as const,
      image: A,
      widthM: 1,
      imageAsset: ASSET,
      createdAtIso: "2026-11-08T00:00:00.000Z",
      geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] as const },
    };
    let d = documentWith(ASSET);
    d = tourDocumentReducer(d, doc.placed({ object: picture, what: "it" }));
    d = tourDocumentReducer(
      d,
      doc.assetOptimized({ id: A, path: `content/${A}.webp` }),
    );
    expect(rows(shelf(added(A)), d)[0]).toMatchObject({
      placesInUse: 1,
      swaps: 1,
    });
  });

  it("offers the original while it is held and no save wrote the smaller file", () => {
    const s = shelf(
      added(A),
      act.jobStarted({ id: A }),
      act.jobOptimized({ id: A, optimizedBytes: 200, originalHeld: true }),
    );
    const swapped = tourDocumentReducer(
      documentWith(ASSET),
      doc.assetOptimized({ id: A, path: `content/${A}.webp` }),
    );
    expect(rows(s, swapped)[0]?.canUseOriginal).toBe(true);
    // A save that wrote the smaller file landed: the written file lists it
    // and holds that swap's bytes.
    const listedOnly: TourDocumentState = {
      ...swapped,
      written: {
        ...swapped.written!,
        assets: [{ ...ASSET, path: `content/${A}.webp` }],
      },
    };
    // Listed at the new path, but no save wrote this swap's bytes yet.
    expect(rows(s, listedOnly)[0]?.canUseOriginal).toBe(true);
    const landed: TourDocumentState = {
      ...listedOnly,
      swapsWritten: swapped.assetSwaps,
    };
    expect(rows(s, landed)[0]?.canUseOriginal).toBe(false);
    const notHeld = shelf(
      added(A),
      act.jobStarted({ id: A }),
      act.jobOptimized({ id: A, optimizedBytes: 200, originalHeld: false }),
    );
    expect(rows(notHeld, swapped)[0]?.canUseOriginal).toBe(false);
    const back = assetShelfReducer(s, act.originalUsed({ id: A, reason: "r" }));
    expect(rows(back, swapped)[0]).toMatchObject({
      status: "kept",
      canUseOriginal: false,
      retryable: true,
    });
  });

  it("removes an entry, restores it for an undo, and clears for a new open", () => {
    const s = shelf(added(A), added(B));
    const entry = s.entries[A]!;
    const removed = assetShelfReducer(s, act.entryRemoved({ id: A }));
    expect(rows(removed).map((r) => r.id)).toEqual([B]);
    const restored = assetShelfReducer(removed, act.entryRestored({ entry }));
    expect(rows(restored).map((r) => r.id)).toEqual([A, B]);
    expect(assetShelfReducer(restored, act.entryRestored({ entry }))).toBe(
      restored,
    );
    expect(rows(assetShelfReducer(s, act.cleared()))).toEqual([]);
  });

  it("ignores a job message for an id it does not hold", () => {
    const s = shelf(added(A));
    for (const action of [
      act.jobStarted({ id: B }),
      act.jobProgress({ id: B, fraction: 0.5 }),
      act.jobKept({ id: B, reason: "r" }),
      act.jobRetried({ id: B }),
    ]) {
      expect(assetShelfReducer(s, action)).toBe(s);
    }
  });
});
