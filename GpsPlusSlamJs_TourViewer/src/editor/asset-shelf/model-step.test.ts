/**
 * Why these tests matter: the model step is what the shelf's Worker runs
 * on a dropped `.glb`, and its answer decides whether the tour keeps the
 * original or takes the smaller copy. A copy the tour would refuse, or a
 * model this code does not understand being rewritten anyway, would break
 * a tour at its next load. The three answers (done, kept, failed) are
 * pinned here with a fake picture device; the e2e runs the browser's.
 */
import { describe, expect, it } from "vitest";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

import { readGlb, writeGlb } from "./glb-file.js";
import { optimizeModel } from "./model-step.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";
import { fakePictureDevice } from "./test-support/fake-picture-device.js";
import {
  boxSpec,
  buildModel,
  largestShift,
  realModel,
  worldPositions,
} from "./test-support/glb-fixtures.js";

function control(signal = new AbortController().signal) {
  const progress: number[] = [];
  return { signal, progress: (f: number) => progress.push(f), seen: progress };
}

const blobOf = (bytes: Uint8Array) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" });

// a scanned model's levels of detail take seconds to order and measure
describe("optimizeModel", { timeout: 30_000 }, () => {
  // Why: with every triangle kept (the slider at its top), the stored
  // geometry must draw the same points within the quantize budget; the
  // default level's thinning, and the smaller file it gives, are pinned by
  // the next test (at share 1 the saved chain adds its index lists).
  it("answers a smaller .glb the tour accepts, drawing the same model", async () => {
    const before = realModel("rock");
    const run = control();
    const answer = await optimizeModel(
      blobOf(before),
      {
        ...OPTIMIZER_SETTINGS,
        model: { ...OPTIMIZER_SETTINGS.model, detailShare: 1 },
      },
      run,
      fakePictureDevice().device,
    );
    if (answer.type !== "done") throw new Error(answer.type);
    expect(answer.extension).toBe("glb");
    expect(answer.blob.type).toBe("model/gltf-binary");
    const out = new Uint8Array(await answer.blob.arrayBuffer());
    expect(checkGlbInert(out).ok).toBe(true);
    const { shift, diagonal } = largestShift(
      await worldPositions(before),
      await worldPositions(out),
    );
    expect(shift / diagonal).toBeLessThanOrEqual(
      OPTIMIZER_SETTINGS.model.maxPositionError,
    );
    expect(run.seen.at(-1)).toBe(1);
  });

  // Why: the shelf shows what the optimizer did to a model; the passes'
  // reports were once computed and thrown away, so nothing could show them.
  it("answers what its passes did: the textures and the stored geometry", async () => {
    const answer = await optimizeModel(
      blobOf(
        await buildModel({
          meshes: [boxSpec("a")],
          baseColor: "png",
          textureSize: [2048, 512],
        }),
      ),
      OPTIMIZER_SETTINGS,
      control(),
      fakePictureDevice().device,
    );
    if (answer.type !== "done") throw new Error(answer.type);
    expect(answer.model?.textures).toMatchObject({
      changed: 1,
      kept: 0,
      largestSide: 1024,
    });
    expect(answer.model?.quantize.positions).toBeGreaterThan(0);
    // a box is far under the triangle floor: no levels
    expect(answer.model?.lod.primitives).toBe(0);
    expect(answer.model?.quantize.positionError).toBeLessThanOrEqual(
      OPTIMIZER_SETTINGS.model.maxPositionError,
    );
  });

  // Why: dropped as it is, a scan is thinned to its default level of
  // detail, and the shelf hears how far that level deviates and what the
  // slider's stops would give; the run's progress only moves forward.
  it("thins a scan to its default level within the budget, and reports it", async () => {
    const before = realModel("rock");
    const run = control();
    const answer = await optimizeModel(
      blobOf(before),
      OPTIMIZER_SETTINGS,
      run,
      fakePictureDevice().device,
    );
    if (answer.type !== "done") throw new Error(answer.type);
    const lod = answer.model!.lod;
    expect(lod).toMatchObject({
      skipped: null,
      primitives: 1,
      automatic: true,
    });
    expect(lod.trianglesAfter).toBeLessThan(lod.trianglesBefore);
    expect(lod.deviation).toBeLessThanOrEqual(
      OPTIMIZER_SETTINGS.model.lodBudget,
    );
    expect(lod.choices.length).toBeGreaterThan(1);
    const out = new Uint8Array(await answer.blob.arrayBuffer());
    expect(checkGlbInert(out).ok).toBe(true);
    expect(out.length).toBeLessThan(before.length * 0.9);
    expect(run.seen).toEqual([...run.seen].sort((a, b) => a - b));
    expect(run.seen.at(-1)).toBe(1);
  });

  it("keeps a model with an extension it does not know, and says why", async () => {
    const read = readGlb(await buildModel({ meshes: [boxSpec("a")] }));
    if (!read.ok) throw new Error(read.reason);
    read.parts.json["extensionsUsed"] = ["VENDOR_views"];
    const marked = writeGlb(read.parts);
    const answer = await optimizeModel(
      blobOf(marked),
      OPTIMIZER_SETTINGS,
      control(),
      fakePictureDevice().device,
    );
    expect(answer).toEqual({
      type: "kept",
      reason: expect.stringContaining("VENDOR_views"),
    });
  });

  it("fails on a file that is no model, and on no file at all", async () => {
    await expect(
      optimizeModel(
        blobOf(new Uint8Array([1, 2, 3])),
        OPTIMIZER_SETTINGS,
        control(),
        fakePictureDevice().device,
      ),
    ).rejects.toThrow(/could not be read as a 3D model/);
    await expect(
      optimizeModel(
        "not a blob",
        OPTIMIZER_SETTINGS,
        control(),
        fakePictureDevice().device,
      ),
    ).rejects.toThrow(/no 3D model/);
  });

  it("stops with an AbortError when its run is stopped", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(
      optimizeModel(
        blobOf(await buildModel({ meshes: [boxSpec("a")] })),
        OPTIMIZER_SETTINGS,
        control(stop.signal),
        fakePictureDevice().device,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
