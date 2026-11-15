/**
 * Why these tests matter: the shelf's detail slider re-makes a model at
 * the author's share of triangles from the ORIGINAL bytes (a made file
 * already carries its levels and is not thinned again), so the runner
 * must keep that original while the slider is offered, show the
 * measured level of every made model, refuse a second request while one
 * runs, and leave the tour's file as it was when the new one cannot be
 * used. The slider's state is store state: these tests read it through
 * `selectShelfRows`, as the panel does.
 */
import { configureStore } from "@reduxjs/toolkit";
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it, vi } from "vitest";

import { tourOf } from "../../test-support/tour-of.js";
import {
  tourDocumentActions as doc,
  tourDocumentReducer,
} from "../../tour-document.js";

import {
  ASSET_OPTIMIZERS,
  type OptimizeOutcome,
  type OptimizerHost,
} from "./asset-optimizers.js";
import {
  DETAIL_NOT_SMALLER,
  createAssetShelf,
  type AssetShelfDeps,
} from "./asset-shelf.js";
import {
  assetShelfActions,
  assetShelfReducer,
  selectShelfRows,
} from "./asset-shelf-slice.js";
import type { LodReport } from "./model-lod.js";
import type { ModelReport } from "./model-step.js";
import { fakeOptimizer } from "./test-support/fake-optimizer.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const M = "m".repeat(64);
const APPLIED = { kind: "applied" };
const REFUSED = { kind: "refused", reason: expect.any(String) };
const STOPPED = { kind: "stopped" };

const model: TourAsset = { id: M, path: `content/${M}.glb`, kind: "model" };

const host: OptimizerHost = {
  run: () => Promise.reject(new Error("unused")),
  close: vi.fn(),
};

function lod(over: Partial<LodReport> = {}): LodReport {
  return {
    skipped: null,
    primitives: 1,
    trianglesBefore: 10_000,
    trianglesAfter: 8_000,
    deviation: 0.0016,
    size: 0.2,
    automatic: true,
    choices: [
      { share: 1, triangles: 10_000, deviation: 0 },
      { share: 0.5, triangles: 5_000, deviation: 0.004 },
      { share: 0.25, triangles: 2_500, deviation: 0.009 },
    ],
    ...over,
  };
}

function made(bytes: number, report: LodReport): OptimizeOutcome {
  // Only the level of detail's part is read by the shelf.
  const reportOf = { lod: report } as unknown as ModelReport;
  return {
    kind: "optimized",
    blob: new Blob([new Uint8Array(bytes)]),
    extension: "glb",
    model: reportOf,
  };
}

function setup(overrides: Partial<AssetShelfDeps> = {}) {
  const store = configureStore({
    reducer: {
      assetShelf: assetShelfReducer,
      tourDocument: tourDocumentReducer,
    },
  });
  store.dispatch(doc.opened({ manifest: tourOf([]) }));
  store.dispatch(doc.assetsAdded({ assets: [model] }));
  const original = new Blob([new Uint8Array(1000)]);
  const bytes = new Map<string, Blob>([[M, original]]);
  const fake = fakeOptimizer();
  const swap = vi.fn<AssetShelfDeps["swap"]>((id, file) => {
    bytes.set(id, file.blob);
    store.dispatch(doc.assetOptimized({ id, path: file.path }));
    return Promise.resolve({ kind: "swapped" as const });
  });
  const shelf = createAssetShelf({
    store,
    optimizers: { ...ASSET_OPTIMIZERS, model: fake },
    host,
    slots: 1,
    bytesOf: (id) => Promise.resolve(bytes.get(id)),
    recordOf: (id) =>
      store.getState().tourDocument.addedAssets.find((a) => a.id === id),
    swap,
    ...overrides,
  });
  const row = () => selectShelfRows(store.getState()).find((r) => r.id === M);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { store, shelf, fake, swap, row, settle, original };
}

/** A model brought in and made at its default level. */
async function madeModel(overrides: Partial<AssetShelfDeps> = {}) {
  const t = setup(overrides);
  t.shelf.add(model, "rock.glb", 1000, "added");
  await t.settle();
  t.fake.calls.shift()!.resolve(made(600, lod()));
  await t.settle();
  return t;
}

describe("the shelf's detail slider", () => {
  it("shows a made model's level, adjustable while the original is kept", async () => {
    const { row } = await madeModel();
    expect(row()).toMatchObject({
      status: "optimized",
      optimizedBytes: 600,
      canUseOriginal: true,
      detail: {
        share: null,
        triangles: 8_000,
        trianglesBefore: 10_000,
        deviation: 0.0016,
        size: 0.2,
        adjustable: true,
        busy: false,
      },
    });
    expect(row()?.detail?.choices).toHaveLength(3);
  });

  it("shows no detail for a model no level was made for", async () => {
    const t = setup();
    t.shelf.add(model, "box.glb", 1000, "added");
    await t.settle();
    t.fake.calls
      .shift()!
      .resolve(made(600, lod({ primitives: 0, choices: [] })));
    await t.settle();
    expect(t.row()?.status).toBe("optimized");
    expect(t.row()?.detail).toBeUndefined();
  });

  it("re-makes the model from the original at the author's share, busy until it lands", async () => {
    const { shelf, fake, swap, row, settle, original } = await madeModel();
    const asked = shelf.setDetail(M, 0.25);
    await settle();
    expect(row()?.detail?.busy).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.source).toBe(original);
    expect(fake.calls[0]!.ctx.settings.model.detailShare).toBe(0.25);
    // a second request while one runs is refused
    await expect(shelf.setDetail(M, 0.5)).resolves.toMatchObject(REFUSED);
    fake.calls
      .shift()!
      .resolve(
        made(
          400,
          lod({ automatic: false, trianglesAfter: 2_500, deviation: 0.009 }),
        ),
      );
    await expect(asked).resolves.toEqual(APPLIED);
    expect(swap).toHaveBeenLastCalledWith(M, {
      blob: expect.any(Blob),
      path: `content/${M}.glb`,
    });
    expect(row()).toMatchObject({
      status: "optimized",
      optimizedBytes: 400,
      canUseOriginal: true,
      detail: { share: 0.25, triangles: 2_500, deviation: 0.009, busy: false },
    });
    expect(row()?.swaps).toBe(2);
  });

  it("goes back to the default level when asked for none", async () => {
    const { shelf, fake, row, settle } = await madeModel();
    const asked = shelf.setDetail(M, 0.25);
    await settle();
    fake.calls.shift()!.resolve(made(400, lod({ automatic: false })));
    await asked;
    const back = shelf.setDetail(M, null);
    await settle();
    expect("detailShare" in fake.calls[0]!.ctx.settings.model).toBe(false);
    fake.calls.shift()!.resolve(made(600, lod()));
    await expect(back).resolves.toEqual(APPLIED);
    expect(row()?.detail?.share).toBeNull();
  });

  // Why: every triangle plus the saved chain can come out larger than the
  // original; the tour then keeps the file it has, and the author is told.
  it("keeps the tour's file when the re-made one is not smaller than the original", async () => {
    const { shelf, fake, swap, row, settle } = await madeModel();
    const asked = shelf.setDetail(M, 1);
    await settle();
    fake.calls.shift()!.resolve(made(1000, lod({ automatic: false })));
    await expect(asked).resolves.toEqual({
      kind: "refused",
      reason: DETAIL_NOT_SMALLER,
    });
    expect(swap).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({
      optimizedBytes: 600,
      detail: { share: null, triangles: 8_000, busy: false },
    });
  });

  it.each([
    ["the optimizer fails", "fail"],
    ["the optimizer keeps the file", "keep"],
  ] as const)("keeps the tour's file when %s", async (_name, how) => {
    const { shelf, fake, swap, row, settle } = await madeModel();
    const asked = shelf.setDetail(M, 0.5);
    await settle();
    if (how === "fail") fake.fail("boom");
    else fake.keep("no");
    await expect(asked).resolves.toMatchObject(REFUSED);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({
      optimizedBytes: 600,
      detail: { share: null, busy: false },
    });
  });

  it("keeps the tour's file when the swap is refused", async () => {
    let refuse = false;
    const t = await madeModel();
    const swapped = t.swap.getMockImplementation()!;
    t.swap.mockImplementation((id, file) =>
      refuse
        ? Promise.resolve({ kind: "refused", reason: "it left" })
        : swapped(id, file),
    );
    refuse = true;
    const asked = t.shelf.setDetail(M, 0.5);
    await t.settle();
    t.fake.calls.shift()!.resolve(made(400, lod({ automatic: false })));
    await expect(asked).resolves.toMatchObject(REFUSED);
    expect(t.row()).toMatchObject({
      optimizedBytes: 600,
      detail: { share: null, busy: false },
    });
  });

  it("is not offered once the original is no longer kept, nor for a share out of range", async () => {
    const { shelf, store, row } = await madeModel();
    await expect(shelf.setDetail(M, Number.NaN)).resolves.toMatchObject(
      REFUSED,
    );
    await expect(shelf.setDetail(M, 1.5)).resolves.toMatchObject(REFUSED);
    await expect(shelf.setDetail("nobody", 0.5)).resolves.toMatchObject(
      REFUSED,
    );
    // the original is let go (as after a save that wrote the made file)
    store.dispatch(assetShelfActions.originalFreed({ id: M }));
    expect(row()).toMatchObject({
      canUseOriginal: false,
      detail: { triangles: 8_000, adjustable: false },
    });
    await expect(shelf.setDetail(M, 0.5)).resolves.toMatchObject(REFUSED);
  });

  // Why: "Use the original" is the author's last word on a file. A re-make
  // still running when it is pressed must not land afterwards and swap the
  // thinned file back in while the card says the original is used, in
  // whichever order the two finish, and its end is no news to toast.
  describe("the original used while a re-make runs", () => {
    function expectOriginalUsed(t: Awaited<ReturnType<typeof madeModel>>) {
      expect(t.swap).toHaveBeenLastCalledWith(
        M,
        expect.objectContaining({ blob: t.original, originalChosen: true }),
      );
      expect(t.row()).toMatchObject({ status: "kept", canUseOriginal: false });
      expect(t.row()?.detail).toBeUndefined();
    }

    it("stops the re-make while the optimizer still works on it", async () => {
      const t = await madeModel();
      const asked = t.shelf.setDetail(M, 0.25);
      await t.settle();
      expect(t.fake.calls).toHaveLength(1);
      await expect(t.shelf.useOriginal(M)).resolves.toBe(true);
      await expect(asked).resolves.toEqual(STOPPED);
      expect(t.fake.calls).toHaveLength(0);
      expect(t.swap).toHaveBeenCalledTimes(2);
      expectOriginalUsed(t);
    });

    it("swaps the original in after a re-make whose swap was already under way", async () => {
      const t = await madeModel();
      const swapped = t.swap.getMockImplementation()!;
      let landRemake: () => void = () => {};
      t.swap.mockImplementationOnce(
        (id, file) =>
          new Promise((resolve) => {
            landRemake = () => resolve(swapped(id, file));
          }),
      );
      const asked = t.shelf.setDetail(M, 0.25);
      await t.settle();
      t.fake.calls.shift()!.resolve(made(400, lod({ automatic: false })));
      await t.settle();
      const back = t.shelf.useOriginal(M);
      await t.settle();
      // the original waits for the swap under way instead of racing it
      expect(t.swap).toHaveBeenCalledTimes(2);
      landRemake();
      await expect(back).resolves.toBe(true);
      await expect(asked).resolves.toEqual(STOPPED);
      expect(t.swap).toHaveBeenCalledTimes(3);
      expectOriginalUsed(t);
    });

    it("refuses a re-make asked while the original is going back", async () => {
      const t = await madeModel();
      const back = t.shelf.useOriginal(M);
      await expect(t.shelf.setDetail(M, 0.25)).resolves.toMatchObject(REFUSED);
      await expect(back).resolves.toBe(true);
      expect(t.fake.calls).toHaveLength(0);
      expectOriginalUsed(t);
    });

    it("uses the original after a re-make that landed first", async () => {
      const t = await madeModel();
      const asked = t.shelf.setDetail(M, 0.25);
      await t.settle();
      t.fake.calls.shift()!.resolve(made(400, lod({ automatic: false })));
      await expect(asked).resolves.toEqual(APPLIED);
      await expect(t.shelf.useOriginal(M)).resolves.toBe(true);
      expectOriginalUsed(t);
    });
  });

  // Why: a card deleted during a re-make and put back by Undo must not
  // say "Applying..." until a reload, and the stopped re-make is no news.
  it("is no longer busy after a delete during a re-make is undone", async () => {
    const t = await madeModel();
    const asked = t.shelf.setDetail(M, 0.25);
    await t.settle();
    expect(t.row()?.detail?.busy).toBe(true);
    const undo = t.shelf.remove(M)!;
    await expect(asked).resolves.toEqual(STOPPED);
    undo();
    expect(t.row()?.detail).toMatchObject({ busy: false, adjustable: true });
    expect(t.swap).toHaveBeenCalledTimes(1);
  });

  it("drops the detail when the original is used again", async () => {
    const { shelf, row } = await madeModel();
    await expect(shelf.useOriginal(M)).resolves.toBe(true);
    expect(row()?.status).toBe("kept");
    expect(row()?.detail).toBeUndefined();
  });
});
