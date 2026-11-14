/**
 * Why these tests matter: the shelf's runner is what turns "a file came
 * in" into "a smaller file stands in for it" without the author waiting.
 * It must run jobs first in, first out within its slots, judge each result
 * (not 10 % smaller keeps the original; still over the cap fails with
 * words), hand a good one to the swap, keep the original for "use the
 * original", and stop every job when the tour closes. A job that ends
 * after its file was removed must change nothing.
 */
import { configureStore } from "@reduxjs/toolkit";
import type {
  TourAsset,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it, vi } from "vitest";

import { tourOf } from "../../test-support/tour-of.js";
import {
  tourDocumentActions as doc,
  manifestToWrite,
  tourDocumentReducer,
} from "../../tour-document.js";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";

import { ASSET_OPTIMIZERS, type OptimizerHost } from "./asset-optimizers.js";
import {
  CHARACTER_KEPT,
  NOT_SMALLER,
  RESULT_TOO_LARGE,
  NO_OPTIMIZER,
  createAssetShelf,
  type AssetShelfDeps,
} from "./asset-shelf.js";
import { assetShelfReducer, selectShelfRows } from "./asset-shelf-slice.js";
import { fakeOptimizer } from "./test-support/fake-optimizer.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function image(id: string): TourAsset {
  return {
    id,
    path: `content/${id}.png`,
    kind: "image",
    width: 40,
    height: 30,
  };
}

const host: OptimizerHost = {
  run: () => Promise.reject(new Error("unused")),
  close: vi.fn(),
};

function setup(overrides: Partial<AssetShelfDeps> = {}) {
  const store = configureStore({
    reducer: {
      assetShelf: assetShelfReducer,
      tourDocument: tourDocumentReducer,
    },
  });
  store.dispatch(doc.opened({ manifest: tourOf([]) }));
  store.dispatch(doc.assetsAdded({ assets: [image(A), image(B), image(C)] }));
  const bytes = new Map<string, Blob>(
    [A, B, C].map((id) => [id, new Blob([new Uint8Array(1000)])]),
  );
  const fake = fakeOptimizer();
  const swap = vi.fn<AssetShelfDeps["swap"]>((id, file) => {
    bytes.set(id, file.blob);
    store.dispatch(doc.assetOptimized({ id, path: file.path }));
    return Promise.resolve({ kind: "swapped" as const });
  });
  const shelf = createAssetShelf({
    store,
    optimizers: { ...ASSET_OPTIMIZERS, image: fake },
    host,
    slots: 1,
    bytesOf: (id) => Promise.resolve(bytes.get(id)),
    recordOf: (id) =>
      store.getState().tourDocument.addedAssets.find((a) => a.id === id),
    swap,
    ...overrides,
  });
  const rows = () => selectShelfRows(store.getState());
  const row = (id: string) => rows().find((r) => r.id === id);
  /** Lets the runner's awaits run. */
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { store, shelf, fake, swap, rows, row, settle, bytes };
}

const small = new Blob([new Uint8Array(100)], { type: "image/webp" });

describe("the shelf's runner", () => {
  it("runs one job at a time in arrival order and swaps the smaller file in", async () => {
    const { shelf, fake, swap, row, settle } = setup();
    shelf.add(image(A), "a.png", 1000, "added");
    shelf.add(image(B), "b.png", 1000, "added");
    await settle();
    expect(row(A)?.status).toBe("running");
    expect(row(B)).toMatchObject({ status: "queued", queuePosition: 0 });
    expect(fake.calls).toHaveLength(1);
    fake.calls[0]!.ctx.progress(0.5);
    expect(row(A)?.progress).toBe(0.5);
    fake.finish(small, "webp", { width: 16, height: 12 });
    await settle();
    expect(swap).toHaveBeenCalledWith(A, {
      blob: small,
      path: `content/${A}.webp`,
      width: 16,
      height: 12,
    });
    expect(row(A)).toMatchObject({
      status: "optimized",
      optimizedBytes: 100,
      canUseOriginal: true,
      swaps: 1,
    });
    expect(row(B)?.status).toBe("running");
  });

  it("keeps the original of a result not at least 10 % smaller", async () => {
    const { shelf, fake, swap, row, settle } = setup();
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.finish(new Blob([new Uint8Array(950)]), "webp");
    await settle();
    expect(swap).not.toHaveBeenCalled();
    expect(row(A)).toMatchObject({ status: "kept", reason: NOT_SMALLER });
  });

  // Why: the swap re-checks against the document (the asset may have
  // left the tour); a refused swap must say so and allow a retry.
  it("fails with the swap's words when the document refuses it, and retries", async () => {
    const { shelf, fake, row, settle } = setup({
      swap: () => Promise.resolve({ kind: "refused", reason: "it left" }),
    });
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.finish(small, "webp");
    await settle();
    expect(row(A)).toMatchObject({
      status: "failed",
      reason: "it left",
      retryable: true,
    });
    expect(shelf.retry(A)).toBe(true);
    await settle();
    expect(row(A)?.status).toBe("running");
  });

  it("a crash is tried once more by itself, then fails", async () => {
    const { shelf, fake, row, settle } = setup();
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.crash();
    await settle();
    expect(row(A)?.status).toBe("running");
    fake.crash();
    await settle();
    expect(row(A)).toMatchObject({ status: "failed", retryable: true });
    expect(row(A)?.reason).toMatch(/stopped unexpectedly/);
  });

  // Why: a file over the entry cap can come in only to be made smaller;
  // when it cannot be, the author must be told it cannot stay.
  it("fails, not retryable, an over-cap original the optimizer cannot bring under the cap", async () => {
    const { shelf, fake, row, settle } = setup({ maxFileBytes: 500 });
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.keep("cannot read it");
    await settle();
    expect(row(A)).toMatchObject({ status: "failed", retryable: false });
    expect(row(A)?.reason).toMatch(/too large to stay in the tour/);
    shelf.add(image(B), "b.png", 1000, "added");
    await settle();
    fake.finish(new Blob([new Uint8Array(600)]), "webp");
    await settle();
    expect(row(B)).toMatchObject({ status: "failed", retryable: false });
  });

  // Why: a save refuses a file over the entry cap, so a result over it
  // must never land. When the original fits, it is simply kept: the honest
  // end says the result came out too large - never a non-retryable "too
  // large" for the file, and not "would save less than a tenth", which is
  // another reason.
  it("keeps an original that fits when only the result is over the entry cap", async () => {
    const { shelf, fake, swap, row, settle } = setup({ maxFileBytes: 1500 });
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.finish(new Blob([new Uint8Array(1600)]), "webp");
    await settle();
    expect(swap).not.toHaveBeenCalled();
    expect(row(A)).toMatchObject({ status: "kept", reason: RESULT_TOO_LARGE });
  });

  // Why: a save also refuses a picture over the pixel cap
  // (TOUR_MAX_IMAGE_PIXELS), so a small result declaring an oversized width
  // or height would land as "optimized" and then block every save. The
  // cap is probed at its edge: exactly at it lands, one row more does not.
  it("judges a result's declared pixels against the pixel cap", async () => {
    const side = Math.sqrt(TOUR_MAX_IMAGE_PIXELS);
    const { shelf, fake, swap, row, settle } = setup();
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.finish(small, "webp", { width: side, height: side + 1 });
    await settle();
    expect(swap).not.toHaveBeenCalled();
    expect(row(A)).toMatchObject({ status: "kept", reason: RESULT_TOO_LARGE });
    shelf.add(image(B), "b.png", 1000, "added");
    await settle();
    fake.finish(small, "webp", { width: side, height: side });
    await settle();
    expect(row(B)?.status).toBe("optimized");
  });

  // Why: a size with one side known says nothing of the other; read as
  // no pixels at all, a picture of any width passed the cap and then
  // blocked every save. One known side counts (as a square of it); a file
  // with neither side (no picture) still passes. Probed on both sides of
  // the cap's side.
  it("counts one known side of a picture against the pixel cap", async () => {
    const side = Math.sqrt(TOUR_MAX_IMAGE_PIXELS);
    const halfKnown =
      (width: number) =>
      (id: string): TourAsset => {
        const { height: _height, ...rest } = image(id);
        return { ...rest, width };
      };
    const wide = setup({ recordOf: halfKnown(side + 1) });
    wide.shelf.add(halfKnown(side + 1)(A), "a.png", 1000, "added");
    await wide.settle();
    wide.fake.finish(small, "webp");
    await wide.settle();
    expect(wide.swap).not.toHaveBeenCalled();
    expect(wide.row(A)?.status).not.toBe("optimized");
    const narrow = setup({ recordOf: halfKnown(side) });
    narrow.shelf.add(halfKnown(side)(B), "b.png", 1000, "added");
    await narrow.settle();
    narrow.fake.finish(small, "webp");
    await narrow.settle();
    expect(narrow.row(B)?.status).toBe("optimized");
  });

  // Why: an original over the pixel cap can stay only once made smaller.
  // A result that is still over it fails for good; one under it is taken
  // even when it saves little in bytes (it is what lets the tour save).
  it("an original over the pixel cap fails unless the result fits, which is taken", async () => {
    const huge = (id: string): TourAsset => ({
      ...image(id),
      width: 5000,
      height: 5000,
    });
    const { shelf, fake, swap, row, settle } = setup({ recordOf: huge });
    shelf.add(huge(A), "a.png", 1000, "added");
    await settle();
    fake.finish(small, "webp");
    await settle();
    expect(swap).not.toHaveBeenCalled();
    expect(row(A)).toMatchObject({ status: "failed", retryable: false });
    expect(row(A)?.reason).toMatch(/too large to stay in the tour/);
    shelf.add(huge(B), "b.png", 1000, "added");
    await settle();
    fake.finish(new Blob([new Uint8Array(990)]), "webp", {
      width: 4000,
      height: 4000,
    });
    await settle();
    expect(row(B)?.status).toBe("optimized");
  });

  it("a kind without an optimizer comes in kept, with words", () => {
    // Models have no optimizer in this build; an image row taken away
    // stands for any kind without one.
    const { shelf, row } = setup({
      optimizers: { ...ASSET_OPTIMIZERS, image: null },
    });
    shelf.add(image(A), "a.png", 1000, "added");
    expect(row(A)).toMatchObject({ status: "kept", reason: NO_OPTIMIZER });
  });

  it("uses the original again: swaps it back and offers the smaller one again", async () => {
    const { shelf, fake, swap, row, settle, bytes } = setup();
    const original = bytes.get(A);
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.finish(small, "webp");
    await settle();
    await expect(shelf.useOriginal(A)).resolves.toBe(true);
    expect(swap).toHaveBeenLastCalledWith(A, {
      blob: original,
      path: `content/${A}.png`,
      width: 40,
      height: 30,
      originalChosen: true,
    });
    expect(row(A)).toMatchObject({
      status: "kept",
      retryable: true,
      canUseOriginal: false,
    });
    await expect(shelf.useOriginal(A)).resolves.toBe(false);
  });

  // Why: "Optimize this tour" is the only way an opened tour's large
  // files get smaller - never by themselves.
  it("optimizes an opened tour's files only when asked", async () => {
    const { shelf, fake, row, settle } = setup();
    shelf.add(image(A), `content/${A}.png`, 1000, "opened");
    shelf.add(image(B), `content/${B}.png`, 1000, "opened");
    await settle();
    expect(row(A)?.status).toBe("idle");
    expect(fake.calls).toHaveLength(0);
    expect(shelf.optimizeTour()).toBe(2);
    await settle();
    expect(row(A)?.status).toBe("running");
    expect(shelf.optimizeTour()).toBe(0);
  });

  it("removes a file with an undo, and a job that ends after the removal changes nothing", async () => {
    const { shelf, fake, swap, row, rows, settle } = setup();
    shelf.add(image(A), "a.png", 1000, "added");
    shelf.add(image(B), "b.png", 1000, "added");
    await settle();
    const undo = shelf.remove(A);
    expect(undo).not.toBeNull();
    await settle();
    expect(rows().map((r) => r.id)).toEqual([B]);
    expect(row(B)?.status).toBe("running");
    fake.finish(small, "webp");
    await settle();
    undo!();
    await settle();
    expect(row(A)?.status).toBe("running");
    expect(swap).toHaveBeenCalledTimes(1);
    expect(shelf.remove(C)).toBeNull();
  });

  // Why: an original may be large. A file removed from the shelf must not
  // keep its original until the tour closes; only the removal's undo may
  // hold it, and the undo brings "use the original" back with the file.
  it("lets an original go with its entry, and its undo brings it back", async () => {
    const { shelf, fake, row, settle } = setup();
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.finish(small, "webp");
    await settle();
    expect(shelf.holdsOriginal(A)).toBe(true);
    const undo = shelf.remove(A);
    expect(shelf.holdsOriginal(A)).toBe(false);
    undo!();
    expect(shelf.holdsOriginal(A)).toBe(true);
    expect(row(A)?.canUseOriginal).toBe(true);
    await expect(shelf.useOriginal(A)).resolves.toBe(true);
    // A second undo of the same removal changes nothing.
    undo!();
    expect(shelf.holdsOriginal(A)).toBe(false);
  });

  it("close stops every job and the host; nothing runs afterwards", async () => {
    const { shelf, fake, row, settle } = setup();
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    shelf.close();
    expect(host.close).toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
    shelf.add(image(B), "b.png", 1000, "added");
    await settle();
    expect(row(B)).toBeUndefined();
    expect(shelf.retry(A)).toBe(false);
  });

  it("a file whose bytes cannot be read fails with words", async () => {
    const { shelf, row, settle } = setup({
      bytesOf: () => Promise.resolve(undefined),
    });
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    expect(row(A)).toMatchObject({ status: "failed", retryable: true });
  });
});

describe("the keep rule for a character's files", () => {
  // Why: a character's figure and his pose sheet must stay byte for byte
  // as drawn (the sheet's cells are cut by position), so the shelf never
  // makes a file a character declaration names smaller - when it is added,
  // when "Optimize this tour" asks, and when a declaration takes the file
  // on while its job runs. A picture with the same bytes shares the file,
  // so it stays untouched too. A fake optimizer stands in for the image
  // row, which this build does not fill yet.
  function withCharacters(
    store: ReturnType<typeof setup>["store"],
    character: { readonly image: string; readonly frames?: string },
  ): void {
    store.dispatch(
      doc.opened({
        manifest: {
          ...tourOf([]),
          characters: [{ id: "sir", name: "Sir", ...character }],
        },
      }),
    );
    store.dispatch(doc.assetsAdded({ assets: [image(A), image(B), image(C)] }));
  }

  it("keeps the figure and the pose sheet as they are, and runs the rest", async () => {
    const { store, shelf, fake, row, settle } = setup();
    withCharacters(store, { image: A, frames: B });
    shelf.add(image(A), "sir.png", 1000, "added");
    shelf.add(image(B), "sir-poses.png", 1000, "added");
    shelf.add(image(C), "gate.png", 1000, "added");
    await settle();
    // His two files are one row, named after him.
    expect(row(A)).toMatchObject({
      name: "Sir",
      status: "kept",
      reason: CHARACTER_KEPT,
    });
    expect(store.getState().assetShelf.entries[B]).toMatchObject({
      phase: "kept",
      reason: CHARACTER_KEPT,
    });
    expect(fake.calls).toHaveLength(1);
    expect(row(C)?.status).toBe("running");
  });

  // Why: a character's files come in byte for byte as drawn (the
  // session's `asMade`), before the declaration naming them is made, so
  // the keep rule cannot see them yet. They still go on the shelf -
  // inside his entry - but kept at once: never queued, no job ever
  // started on them, and "Optimize this tour" and Retry skip them.
  it("takes a file kept as made: on the shelf, kept, never queued", async () => {
    const { store, shelf, fake, settle } = setup();
    shelf.addAsMade(image(A), "sir.png", 1000, "added");
    shelf.addAsMade(image(B), "sir-poses.png", 1000, "opened");
    expect(shelf.optimizeTour()).toBe(0);
    expect(shelf.retry(A)).toBe(false);
    await settle();
    expect(fake.calls).toHaveLength(0);
    const { entries } = store.getState().assetShelf;
    expect(entries[A]).toMatchObject({
      phase: "kept",
      reason: CHARACTER_KEPT,
      retryable: false,
      origin: "added",
      name: "sir.png",
    });
    expect(entries[B]).toMatchObject({ phase: "kept", origin: "opened" });
  });

  it('keeps a character\'s file that "Optimize this tour" queues', async () => {
    const { store, shelf, fake, row, settle } = setup();
    withCharacters(store, { image: A });
    shelf.add(image(A), "sir.png", 1000, "opened");
    shelf.optimizeTour();
    await settle();
    expect(fake.calls).toHaveLength(0);
    expect(row(A)).toMatchObject({ status: "kept", reason: CHARACTER_KEPT });
  });

  it("does not swap a file a character took on while its job ran", async () => {
    const { store, shelf, fake, swap, row, settle } = setup();
    shelf.add(image(C), "gate.png", 1000, "added");
    await settle();
    expect(fake.calls).toHaveLength(1);
    withCharacters(store, { image: C });
    fake.finish(small, "webp", { width: 16, height: 12 });
    await settle();
    expect(swap).not.toHaveBeenCalled();
    expect(row(C)).toMatchObject({ status: "kept", reason: CHARACTER_KEPT });
  });
});

describe("a removed file whose items come back", () => {
  // Why: the shelf lists every file an item names. Deleting a file in use
  // takes its card off the shelf, and the page's Undo brings the items
  // back through the document alone; without this the file would be in
  // the tour again with no card to optimize, replace or delete it.
  function pictureOf(id: string): TourObject {
    return {
      id: `pic-${id.slice(0, 4)}`,
      kind: "picture",
      view: "plane",
      image: id,
      widthM: 1,
      imageAsset: image(id),
      createdAtIso: "2026-09-09T00:00:00.000Z",
      geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
    };
  }

  it("puts the card back when the document names the file again, and only then", async () => {
    const { store, shelf, row, settle } = setup();
    store.dispatch(doc.opened({ manifest: tourOf([pictureOf(C)]) }));
    store.dispatch(doc.assetsAdded({ assets: [image(A), image(B)] }));
    shelf.add(image(A), "a.png", 1000, "added");
    shelf.add(image(B), "b.png", 1000, "added");
    await settle();
    shelf.remove(A);
    shelf.remove(B);
    expect(row(A)).toBeUndefined();
    store.dispatch(
      doc.edited({
        object: { ...pictureOf(A), station: `st-${pictureOf(C).id}` },
        what: "a picture",
      }),
    );
    await settle();
    expect(row(A)).toMatchObject({ name: "a.png", status: "running" });
    expect(row(B)).toBeUndefined();
  });

  // Why: the page's Undo of a delete brings a removed card back through
  // the document alone, not through the removal's undo. The original the
  // smaller file replaced must come back with it while "use the original"
  // would still be offered, or the author loses it for good.
  it("puts the held original back with a card the document names again", async () => {
    const { store, shelf, fake, row, settle } = setup();
    store.dispatch(doc.opened({ manifest: tourOf([pictureOf(C)]) }));
    store.dispatch(doc.assetsAdded({ assets: [image(A)] }));
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.finish(small, "webp");
    await settle();
    shelf.remove(A);
    expect(shelf.holdsOriginal(A)).toBe(false);
    store.dispatch(
      doc.edited({
        object: { ...pictureOf(A), station: `st-${pictureOf(C).id}` },
        what: "a picture",
      }),
    );
    await settle();
    expect(row(A)).toMatchObject({ status: "optimized", canUseOriginal: true });
    expect(shelf.holdsOriginal(A)).toBe(true);
    await expect(shelf.useOriginal(A)).resolves.toBe(true);
  });

  // Why: a removal nobody takes back must not hold a large original until
  // the tour closes. Nothing uses a removed card's file, so no save writes
  // it and "the smaller file landed" never comes for it: the bound is the
  // next landed save, after which an undo brings the card back without it.
  it("lets a removed card's original go once a save lands", async () => {
    const { store, shelf, fake, row, settle } = setup();
    store.dispatch(doc.opened({ manifest: tourOf([pictureOf(C)]) }));
    store.dispatch(doc.assetsAdded({ assets: [image(A)] }));
    shelf.add(image(A), "a.png", 1000, "added");
    await settle();
    fake.finish(small, "webp");
    await settle();
    const undo = shelf.remove(A);
    const generation = store.getState().tourDocument.generation;
    store.dispatch(doc.saveStarted({ generation }));
    store.dispatch(
      doc.saved({
        generation,
        written: manifestToWrite(store.getState().tourDocument)!,
        appliedDeletions: [],
        stationsAtStart: store.getState().tourDocument.stations,
        // As a real save: the swap counts its bytes were written at.
        swaps: store.getState().tourDocument.assetSwaps,
      }),
    );
    store.dispatch(doc.saveEnded({ generation }));
    await settle();
    undo!();
    expect(shelf.holdsOriginal(A)).toBe(false);
    expect(row(A)?.canUseOriginal).toBe(false);
  });
});
