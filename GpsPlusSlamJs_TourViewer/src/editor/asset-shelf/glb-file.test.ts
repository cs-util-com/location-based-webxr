/**
 * Why these tests matter: `glb-file.ts` is the only code between an
 * untrusted tour file and the model optimizer's passes. A wrong range
 * check reads past the binary chunk; a wrong rewrite produces a model the
 * tour refuses or one that silently draws other geometry. The fixtures are
 * written by glTF-Transform and the results judged by the Khronos
 * validator, so this file's own writer is never the judge of its output.
 */
import { describe, expect, it } from "vitest";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

import {
  appendView,
  type GlbParts,
  readAccessor,
  readGlb,
  writeGlb,
} from "./glb-file.js";
import {
  boxSpec,
  buildModel,
  largestShift,
  validatorErrors,
  worldPositions,
} from "./test-support/glb-fixtures.js";
import { handGlb, pngViews } from "./test-support/hand-glb.js";

function partsOf(bytes: Uint8Array): GlbParts {
  const read = readGlb(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.parts;
}

describe("readGlb and writeGlb", () => {
  it("round-trips a model to the same drawn geometry and a clean validator report", async () => {
    const before = await buildModel({
      meshes: [boxSpec("a"), boxSpec("b", [3, 0, 0], 2)],
      baseColor: "jpeg",
    });
    const after = writeGlb(partsOf(before));
    expect(checkGlbInert(after).ok).toBe(true);
    expect(await validatorErrors(after)).toEqual([]);
    const shift = largestShift(
      await worldPositions(before),
      await worldPositions(after),
    );
    expect(shift.shift).toBe(0);
  });

  it("drops buffer views nothing names any more and keeps the rest aligned", async () => {
    const parts = partsOf(await buildModel({ meshes: [boxSpec("a")] }));
    const viewsBefore = parts.views.length;
    // Why: a pass replaces an accessor's data by appending a view; the old
    // view must not stay in the file, or nothing would get smaller.
    const accessor = (parts.json["accessors"] as Record<string, unknown>[])[0]!;
    const packed = Float32Array.from(readAccessor(parts, 0)!.values);
    accessor["bufferView"] = appendView(parts, new Uint8Array(packed.buffer), {
      target: 34962,
    });
    accessor["byteOffset"] = 0;
    appendView(parts, new Uint8Array(3)); // named by nothing
    const out = writeGlb(parts);
    const again = partsOf(out);
    expect(again.views.length).toBeLessThanOrEqual(viewsBefore + 1);
    for (const view of again.json["bufferViews"] as { byteOffset: number }[]) {
      expect(view.byteOffset % 4).toBe(0);
    }
    expect(await validatorErrors(out)).toEqual([]);
  });

  it("writes a model without any buffer when no view is named", () => {
    const out = writeGlb({ json: { asset: { version: "2.0" } }, views: [] });
    expect(checkGlbInert(out).ok).toBe(true);
    const read = readGlb(out);
    expect(read.ok && read.parts.json["buffers"]).toBeUndefined();
  });

  it("keeps a model with an unknown extension or two buffers as it is", () => {
    const unknown = handGlb({
      asset: { version: "2.0" },
      extensionsUsed: ["VENDOR_secret_views"],
    });
    expect(readGlb(unknown)).toMatchObject({ ok: false, why: "unsupported" });
    const twoBuffers = handGlb({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4 }, { byteLength: 4 }],
    });
    expect(readGlb(twoBuffers)).toMatchObject({
      ok: false,
      why: "unsupported",
    });
  });

  it("calls a file the tour refuses, or one whose view leaves the data, unreadable", () => {
    expect(readGlb(new Uint8Array([1, 2, 3]))).toMatchObject({
      ok: false,
      why: "unreadable",
    });
    const draco = handGlb({
      asset: { version: "2.0" },
      extensionsUsed: ["KHR_draco_mesh_compression"],
      extensionsRequired: ["KHR_draco_mesh_compression"],
    });
    expect(readGlb(draco)).toMatchObject({ ok: false, why: "unreadable" });
    const outside = handGlb(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: 8 }],
        bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 8 }],
      },
      new Uint8Array(8),
    );
    expect(readGlb(outside)).toMatchObject({ ok: false, why: "unreadable" });
  });

  // Why: a rewrite renumbers the buffer views by the indices accessors and
  // images name. An index the file does not have was written as nothing
  // (out of range: the key dropped) or left as it was (negative, not whole)
  // while the views moved under it, so the result was a model with no
  // geometry. Such a file is refused here, and the shelf keeps the original.
  it.each([
    ["an accessor", "out of range", "accessor", 1],
    ["an accessor", "negative", "accessor", -1],
    ["an accessor", "not whole", "accessor", 0.5],
    ["an accessor", "no number", "accessor", "0"],
    ["a sparse part", "out of range", "sparse", 7],
    ["an image", "out of range", "image", 3],
    ["an image", "negative", "image", -2],
    ["an image", "not whole", "image", 1e-9],
  ] as const)(
    "calls a file unreadable when %s names a buffer view %s",
    (_who, _how, where, index) => {
      // An image the tour cannot size is refused by the tour's own check
      // first; either way the file is unreadable, never rewritten.
      expect(
        readGlb(handGlb(namingView(where, index), pngViews(1))),
      ).toMatchObject({ ok: false, why: "unreadable" });
    },
  );

  it("reads a file whose accessor, sparse part and image name views it has", () => {
    for (const where of ["accessor", "sparse", "image"] as const) {
      expect(readGlb(handGlb(namingView(where, 0), pngViews(1))).ok).toBe(true);
    }
  });
});

/** A model with one buffer view (a PNG's first bytes), and `index` as the buffer view
 *  that `where` names. */
function namingView(
  where: "accessor" | "sparse" | "image",
  index: unknown,
): object {
  const accessor = {
    componentType: 5126,
    count: 1,
    type: "SCALAR",
    bufferView: where === "accessor" ? index : 0,
    ...(where === "sparse"
      ? {
          sparse: {
            count: 1,
            indices: { bufferView: index, componentType: 5121 },
            values: { bufferView: 0 },
          },
        }
      : {}),
  };
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [accessor],
    ...(where === "image"
      ? { images: [{ bufferView: index, mimeType: "image/png" }] }
      : {}),
  };
}

describe("readAccessor", () => {
  const bin = new Uint8Array(32);
  const data = new DataView(bin.buffer);
  // Two VEC2 SHORT normalized elements in a stride of 8, then floats.
  data.setInt16(0, 32767, true);
  data.setInt16(2, -32767, true);
  data.setInt16(8, 0, true);
  data.setInt16(10, -32768, true);
  data.setFloat32(16, 1.5, true);
  data.setFloat32(20, -2, true);
  const parts = (accessors: object[]): GlbParts => ({
    json: {
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 16, byteStride: 8 },
        { buffer: 0, byteOffset: 16, byteLength: 16 },
      ],
      accessors,
    },
    views: [bin.subarray(0, 16), bin.subarray(16, 32)],
  });

  it("reads strided normalized integers as their values, -32768 clamped to -1", () => {
    const read = readAccessor(
      parts([
        {
          bufferView: 0,
          componentType: 5122,
          normalized: true,
          type: "VEC2",
          count: 2,
        },
      ]),
      0,
    );
    expect(Array.from(read!.values)).toEqual([1, -1, 0, -1]);
  });

  it("reads floats as they are", () => {
    const read = readAccessor(
      parts([{ bufferView: 1, componentType: 5126, type: "VEC2", count: 1 }]),
      0,
    );
    expect(Array.from(read!.values)).toEqual([1.5, -2]);
  });

  it("refuses sparse, matrix and out-of-range accessors rather than guessing", () => {
    const refused = [
      { bufferView: 1, componentType: 5126, type: "VEC2", count: 3 },
      { bufferView: 1, componentType: 5126, type: "MAT2", count: 1 },
      {
        bufferView: 1,
        componentType: 5126,
        type: "SCALAR",
        count: 1,
        sparse: { count: 1 },
      },
      { bufferView: 9, componentType: 5126, type: "SCALAR", count: 1 },
      { bufferView: 1, componentType: 9999, type: "SCALAR", count: 1 },
    ];
    refused.forEach((accessor) => {
      expect(readAccessor(parts([accessor]), 0)).toBeNull();
    });
  });
});
