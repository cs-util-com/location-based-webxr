/**
 * Why these properties matter: a rewrite renumbers buffer views by the
 * index each accessor, sparse part and image names. Any named index the
 * file does not have (past the end, negative, not whole, not a number)
 * must make the file unreadable before a rewrite can write a model whose
 * geometry silently vanished; any file whose names all exist must read,
 * and its rewrite must still name only views it holds.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { readGlb, writeGlb } from "./glb-file.js";
import { handGlb, pngViews } from "./test-support/hand-glb.js";

/** A model of `views` buffer views (each a PNG's first bytes) whose
 *  accessors and images name the given values, and the first accessor's
 *  sparse indices `sparse` when it is given. */
function model(
  views: number,
  accessors: readonly unknown[],
  images: readonly unknown[],
  sparse: unknown,
): Uint8Array {
  return handGlb(
    {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 36 * views }],
      bufferViews: Array.from({ length: views }, (_, i) => ({
        buffer: 0,
        byteOffset: 36 * i,
        byteLength: 36,
      })),
      accessors: accessors.map((bufferView, i) => ({
        componentType: 5126,
        count: 1,
        type: "SCALAR",
        bufferView,
        ...(i === 0 && sparse !== undefined
          ? {
              sparse: {
                count: 1,
                indices: { bufferView: sparse, componentType: 5121 },
                values: { bufferView: 0 },
              },
            }
          : {}),
      })),
      images: images.map((bufferView) => ({
        bufferView,
        mimeType: "image/png",
      })),
    },
    pngViews(views),
  );
}

const isView = (views: number) => (value: unknown) =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) < views;

/** A named index: one the file has, or one it does not. */
const named = (views: number): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.integer({ min: 0, max: views - 1 }),
    fc.integer({ min: views, max: views + 50 }),
    fc.integer({ min: -50, max: -1 }),
    fc.double({ noNaN: true }).filter((n) => !Number.isInteger(n)),
    fc.constantFrom("0", null, true, Number.NaN),
  );

describe("a model's buffer view names (properties)", () => {
  it("reads a model exactly when every name is a view it has, and its rewrite names only views it holds (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }).chain((views) =>
          fc.record({
            views: fc.constant(views),
            accessors: fc.array(named(views), { minLength: 1, maxLength: 4 }),
            images: fc.array(named(views), { maxLength: 3 }),
            sparse: fc.option(named(views), { nil: undefined }),
          }),
        ),
        ({ views, accessors, images, sparse }) => {
          const all = [...accessors, ...images];
          if (sparse !== undefined) all.push(sparse);
          const read = readGlb(model(views, accessors, images, sparse));
          const valid = all.every(isView(views));
          expect(read.ok ? "read" : read.why).toBe(
            valid ? "read" : "unreadable",
          );
          // A readable model, rewritten, still reads and names only the
          // views it holds.
          const again = read.ok ? readGlb(writeGlb(read.parts)) : null;
          expect(again === null || again.ok).toBe(true);
          const json = (again?.ok === true ? again.parts.json : {}) as {
            accessors?: {
              bufferView: unknown;
              sparse?: { indices: { bufferView: unknown } };
            }[];
            images?: { bufferView: unknown }[];
          };
          const kept = again?.ok === true ? again.parts.views.length : 0;
          const names = [
            ...(json.accessors ?? []).flatMap((a) => [
              a.bufferView,
              ...(a.sparse === undefined ? [] : [a.sparse.indices.bufferView]),
            ]),
            ...(json.images ?? []).map((i) => i.bufferView),
          ];
          expect(names.filter((n) => !isView(kept)(n))).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });
});
