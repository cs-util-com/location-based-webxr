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

import {
  type GltfObject,
  listOf,
  objectOf,
  readGlb,
  writeGlb,
} from "./glb-file.js";
import { optimizeModel } from "./model-step.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";
import { fakePictureDevice } from "./test-support/fake-picture-device.js";
import {
  boxSpec,
  buildModel,
  bumpyField,
  largestShift,
  worldPositions,
} from "./test-support/glb-fixtures.js";

function control(signal = new AbortController().signal) {
  const progress: number[] = [];
  return { signal, progress: (f: number) => progress.push(f), seen: progress };
}

const blobOf = (bytes: Uint8Array) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" });

/** The saved levels of the file's one primitive, and its index count. */
function levelsOf(bytes: Uint8Array): {
  readonly levels: readonly { start: number; count: number }[] | null;
  readonly indices: number;
} {
  const read = readGlb(bytes);
  if (!read.ok) throw new Error(read.reason);
  const { json } = read.parts;
  const mesh = objectOf((listOf(json, "meshes") ?? [])[0])!;
  const prim = objectOf((listOf(mesh, "primitives") ?? [])[0])!;
  const lod = objectOf(objectOf(prim["extras"])?.["lod"]);
  const accessor = objectOf(
    (listOf(json, "accessors") ?? [])[prim["indices"] as number],
  ) as GltfObject;
  return {
    levels: (lod?.["levels"] as { start: number; count: number }[]) ?? null,
    indices: accessor["count"] as number,
  };
}

async function answerOf(source: Uint8Array, keepAbove: number) {
  const answer = await optimizeModel(
    blobOf(source),
    {
      ...OPTIMIZER_SETTINGS,
      // every triangle kept, so the chain has all its levels
      model: { ...OPTIMIZER_SETTINGS.model, detailShare: 1 },
      keepAbove,
    },
    control(),
    fakePictureDevice().device,
  );
  if (answer.type !== "done") throw new Error(answer.type);
  return new Uint8Array(await answer.blob.arrayBuffer());
}

describe("optimizeModel", { timeout: 30_000 }, () => {
  // Why: with every triangle kept (the slider at its top), the stored
  // geometry must draw the same points within the quantize budget; the
  // default level's thinning, and the smaller file it gives, are pinned by
  // the next test (at share 1 the saved chain adds its index lists).
  it("answers a smaller .glb the tour accepts, drawing the same model", async () => {
    const before = await bumpyField(24);
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

  // Why: dropped as it is, a model is thinned to its default level of
  // detail, and the shelf hears how far that level deviates and what the
  // slider's stops would give; the run's progress only moves forward. A
  // textureless model with a 16-bit index list is where the saved chain
  // weighs most against the file, and the whole file, chain included,
  // must still be under the shelf's line.
  it("thins a model to its default level within the budget, and reports it", async () => {
    const before = await bumpyField(48, true);
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

  // Why: the shelf keeps the original when the made file is above
  // `keepAbove` of it, so a chain that lifts the file over that line would
  // cost the file every other saving; coarser levels are dropped, the
  // coarsest first, down to none, until it is under the line, and the
  // author's level is never touched.
  it("drops coarser levels, then the whole chain, rather than cross the shelf's line", async () => {
    const before = await bumpyField(48, true);
    const full = await answerOf(before, 1);
    const all = levelsOf(full);
    expect(all.levels!.length).toBeGreaterThan(2);
    const line = (full.length - 1) / before.length;
    const trimmed = await answerOf(before, line);
    const some = levelsOf(trimmed);
    expect(trimmed.length).toBeLessThanOrEqual(before.length * line);
    expect(some.levels!.length).toBeLessThan(all.levels!.length);
    expect(some.levels!.length).toBeGreaterThan(1);
    expect(some.levels).toEqual(all.levels!.slice(0, some.levels!.length));
    expect(some.indices).toBe(all.indices);
    expect(checkGlbInert(trimmed).ok).toBe(true);
    const none = levelsOf(await answerOf(before, 0.01));
    expect(none.levels).toBeNull();
    expect(none.indices).toBe(all.indices);
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
