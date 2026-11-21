/**
 * Why these tests matter: the repack must be lossless for ANY layout an
 * exporter may choose, not only the ones the unit tests spell out. Random
 * documents spread their buffer views over 1-4 buffers (each a `.bin`
 * file or a `data:` URI), carry pictures as files, data URIs or buffer
 * views, and name a random view from an extension the repack does not
 * know; accessors start at an offset inside their view, some with a
 * stride, one may be sparse, and a buffer's length need not be a multiple
 * of 4. Whatever the layout, the result must have one buffer, keep every
 * view's bytes at its index (so the extension still names the same
 * bytes), read every accessor to the same values and every picture to the
 * same bytes, keep every accessor on glTF's alignment, pass the tour's
 * check, and be the same bytes on a second run (the editor names files by
 * their content hash).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

import {
  type GlbParts,
  type GltfObject,
  readAccessor,
} from "../asset-shelf/glb-file.js";
import { pngHeader } from "../asset-shelf/test-support/glb-fixtures.js";
import { repackGltf } from "./gltf-repack.js";
import {
  looseGlbParts,
  misalignedAccessors,
  splitGlb,
} from "./test-support/gltf-split.js";

const COMPONENT = [5121, 5123, 5126] as const;
const SIZE: Record<number, number> = { 5121: 1, 5123: 2, 5126: 4 };

const documentArb = fc
  .record({
    data: fc.array(fc.uint8Array({ minLength: 4, maxLength: 48 }), {
      minLength: 1,
      maxLength: 8,
    }),
    components: fc.array(fc.constantFrom(...COMPONENT), {
      minLength: 8,
      maxLength: 8,
    }),
    pictures: fc.array(
      fc.record({
        width: fc.integer({ min: 1, max: 4096 }),
        height: fc.integer({ min: 1, max: 4096 }),
        placement: fc.constantFrom("file", "data", "view"),
      }),
      { maxLength: 3 },
    ),
    named: fc.nat(),
    /** Per data view: its accessor's offset (in components) and stride. */
    layout: fc.array(
      fc.record({ offset: fc.nat(), stride: fc.constantFrom(0, 4, 8) }),
      { minLength: 8, maxLength: 8 },
    ),
    sparse: fc.option(
      fc.record({
        indices: fc.nat(),
        values: fc.nat(),
        indexType: fc.constantFrom(5121, 5123, 5125),
      }),
      { nil: null },
    ),
  })
  .chain((doc) => {
    const views = doc.data.length + doc.pictures.length;
    return fc.record({
      doc: fc.constant(doc),
      viewBuffer: fc.array(fc.integer({ min: 0, max: 3 }), {
        minLength: views,
        maxLength: views,
      }),
      buffers: fc.array(fc.constantFrom("file", "data"), {
        minLength: 4,
        maxLength: 4,
      }),
      bufferTails: fc.array(fc.integer({ min: 0, max: 3 }), {
        minLength: 4,
        maxLength: 4,
      }),
    });
  });

function partsOf(doc: {
  data: Uint8Array[];
  components: number[];
  pictures: { width: number; height: number }[];
  named: number;
  layout: { offset: number; stride: number }[];
  sparse: { indices: number; values: number; indexType: number } | null;
}): GlbParts {
  const views = [
    ...doc.data,
    ...doc.pictures.map((p) => pngHeader(p.width, p.height)),
  ];
  const json: GltfObject = {
    asset: { version: "2.0" },
    bufferViews: views.map((v, i) => {
      const stride = doc.layout[i]?.stride ?? 0;
      return i < doc.data.length && stride > 0
        ? { buffer: 0, byteLength: v.length, byteStride: stride }
        : { buffer: 0, byteLength: v.length };
    }),
    accessors: doc.data.map((v, i) => {
      const componentType = doc.components[i]!;
      const size = SIZE[componentType]!;
      const { offset, stride } = doc.layout[i]!;
      const byteOffset = size * (offset % Math.floor(v.length / size));
      const room = v.length - byteOffset;
      return {
        bufferView: i,
        ...(byteOffset > 0 ? { byteOffset } : {}),
        componentType,
        type: "SCALAR",
        count:
          stride === 0
            ? Math.floor(room / size)
            : Math.floor((room - size) / stride) + 1,
      };
    }),
    extensionsUsed: ["EXT_example_view_user"],
    extensions: {
      EXT_example_view_user: { bufferView: doc.named % views.length },
    },
  };
  if (doc.sparse !== null) {
    const accessors = json["accessors"] as GltfObject[];
    const values = doc.sparse.values % doc.data.length;
    accessors.push({
      componentType: doc.components[values]!,
      type: "SCALAR",
      count: 1,
      sparse: {
        count: 1,
        indices: {
          bufferView: doc.sparse.indices % doc.data.length,
          componentType: doc.sparse.indexType,
        },
        values: { bufferView: values },
      },
    });
  }
  if (doc.pictures.length > 0) {
    json["images"] = doc.pictures.map((_, k) => ({
      bufferView: doc.data.length + k,
      mimeType: "image/png",
    }));
  }
  return { json, views };
}

describe("repackGltf, properties", () => {
  it("keeps every view, accessor, picture and extension reference for any buffer layout", () => {
    fc.assert(
      fc.property(documentArb, ({ doc, viewBuffer, buffers, bufferTails }) => {
        const source = partsOf(doc);
        const files = splitGlb(source, {
          viewBuffer,
          buffers,
          bufferTails,
          images: doc.pictures.map((p) => p.placement),
        });
        const first = repackGltf("model/model.gltf", files);
        if (!first.ok) throw new Error(first.reason);
        const out = looseGlbParts(first.glb);
        expect(out.json["buffers"]).toHaveLength(1);
        expect(out.views.slice(0, source.views.length)).toEqual(source.views);
        (source.json["accessors"] as unknown[]).forEach((_, i) =>
          expect(readAccessor(out, i)).toEqual(readAccessor(source, i)),
        );
        expect(misalignedAccessors(out.json)).toEqual([]);
        ((out.json["images"] ?? []) as { bufferView: number }[]).forEach(
          (image, k) =>
            expect(out.views[image.bufferView]).toEqual(
              source.views[doc.data.length + k],
            ),
        );
        const ext = (out.json["extensions"] as Record<string, GltfObject>)[
          "EXT_example_view_user"
        ]!;
        const named = doc.named % source.views.length;
        expect(ext["bufferView"]).toBe(named);
        expect(out.views[named]).toEqual(source.views[named]);
        expect(checkGlbInert(first.glb)).toEqual({ ok: true });
        const second = repackGltf("model/model.gltf", files);
        expect(second.ok && second.glb).toEqual(first.glb);
      }),
    );
  });

  it("never throws on a garbled .gltf: it refuses in words or repacks", () => {
    const garble = fc.oneof(
      fc.json(),
      fc.string(),
      fc
        .record({
          asset: fc.oneof(fc.constant({ version: "2.0" }), fc.anything()),
          buffers: fc.anything(),
          bufferViews: fc.anything(),
          images: fc.anything(),
          textures: fc.anything(),
          materials: fc.anything(),
          extensionsUsed: fc.anything(),
        })
        .map((r) => JSON.stringify(r)),
    );
    fc.assert(
      fc.property(garble, (text) => {
        const result = repackGltf(
          "a.gltf",
          new Map([
            ["a.gltf", new TextEncoder().encode(text)],
            ["a.bin", new Uint8Array(16)],
          ]),
        );
        // A repack must be inert; a refusal must carry words.
        const verdict = result.ok
          ? checkGlbInert(result.glb)
          : { ok: result.reason.length > 0 };
        expect(verdict).toEqual({ ok: true });
      }),
    );
  });
});
