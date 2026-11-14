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

describe("optimizeModel", () => {
  it("answers a smaller .glb the tour accepts, drawing the same model", async () => {
    const before = realModel("rock");
    const run = control();
    const answer = await optimizeModel(
      blobOf(before),
      OPTIMIZER_SETTINGS,
      run,
      fakePictureDevice().device,
    );
    if (answer.type !== "done") throw new Error(answer.type);
    expect(answer.extension).toBe("glb");
    expect(answer.blob.type).toBe("model/gltf-binary");
    const out = new Uint8Array(await answer.blob.arrayBuffer());
    expect(checkGlbInert(out).ok).toBe(true);
    expect(out.length).toBeLessThan(before.length * 0.9);
    const { shift, diagonal } = largestShift(
      await worldPositions(before),
      await worldPositions(out),
    );
    expect(shift / diagonal).toBeLessThanOrEqual(
      OPTIMIZER_SETTINGS.model.maxPositionError,
    );
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
