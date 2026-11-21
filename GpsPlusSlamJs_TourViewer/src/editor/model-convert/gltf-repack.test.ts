/**
 * Why these tests matter: the repack is how a `.gltf` and its loose files
 * become the one `.glb` a tour may carry. It must be lossless (every
 * buffer view kept with its index, so an extension that names a view
 * still names the same bytes; every accessor reads the same values; every
 * picture keeps its bytes), it must never fetch or reach outside the
 * files given, and every refusal must reach the creator in words that say
 * what to do. Fixtures are written by glTF-Transform and judged by the
 * Khronos validator, so the repack never judges its own output.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

import {
  type GlbParts,
  type GltfObject,
  readAccessor,
  readGlb,
} from "../asset-shelf/glb-file.js";
import {
  boxSpec,
  buildModel,
  jpegHeader,
  pngHeader,
  validatorErrors,
} from "../asset-shelf/test-support/glb-fixtures.js";
import { repackGltf } from "./gltf-repack.js";
import { note, refusal } from "./model-import-words.js";
import {
  looseGlbParts,
  misalignedAccessors,
  splitGlb,
} from "./test-support/gltf-split.js";

const GLTF = "model/model.gltf";

function partsOf(bytes: Uint8Array): GlbParts {
  const read = readGlb(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.parts;
}

function repacked(files: Map<string, Uint8Array>, path = GLTF) {
  const result = repackGltf(path, files);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

/** Every accessor's values and every image's bytes, by index. */
function contentOf(parts: GlbParts) {
  const accessors = ((parts.json["accessors"] ?? []) as unknown[]).map((_, i) =>
    readAccessor(parts, i),
  );
  const images = ((parts.json["images"] ?? []) as { bufferView: number }[]).map(
    (image) => parts.views[image.bufferView],
  );
  return { accessors, images };
}

/** The validator errors `after` has that `before` has not: the fixtures'
 *  fake pictures are headers only, which the validator reports on both. */
async function newErrors(before: Uint8Array, after: Uint8Array) {
  const old = new Set(await validatorErrors(before));
  return (await validatorErrors(after)).filter((e) => !old.has(e));
}

interface EditableUri {
  uri?: string;
  mimeType?: string;
}

/** The parts of a split bundle's gltf JSON the tests change; the bundles
 *  they edit always hold at least one buffer and one image. */
interface EditableGltf {
  [key: string]: unknown;
  buffers: [EditableUri, ...EditableUri[]];
  images: [EditableUri, ...EditableUri[]];
}

/** A gltf's JSON from a split bundle, changed by `edit`. */
function editGltf(
  files: Map<string, Uint8Array>,
  edit: (json: EditableGltf) => void,
): Map<string, Uint8Array> {
  const json = JSON.parse(
    new TextDecoder().decode(files.get(GLTF)),
  ) as EditableGltf;
  edit(json);
  files.set(GLTF, new TextEncoder().encode(JSON.stringify(json)));
  return files;
}

const encode = (text: string) => new TextEncoder().encode(text);

const textured = () =>
  buildModel({
    meshes: [boxSpec("a"), boxSpec("b", [3, 0, 0], 2)],
    baseColor: "jpeg",
    normalMap: "png",
  });

describe("repackGltf", () => {
  it("merges several buffers into one and keeps every accessor and picture", async () => {
    const original = await textured();
    const source = partsOf(original);
    const views = source.views.length;
    const files = splitGlb(source, {
      viewBuffer: source.views.map((_, i) => i % 3),
      images: ["file", "file"],
    });
    const result = repacked(files);
    const out = partsOf(result.glb);
    expect(out.json["buffers"]).toHaveLength(1);
    expect(contentOf(out)).toEqual(contentOf(source));
    // Every original view kept by index; the two pictures added after them.
    expect(out.views.slice(0, views)).toEqual(source.views);
    expect(checkGlbInert(result.glb)).toEqual({ ok: true });
    expect(await newErrors(original, result.glb)).toEqual([]);
    expect(result.notes).toEqual([]);
    expect([...result.used].sort()).toEqual(
      [...files.keys()].filter((p) => p !== GLTF).sort(),
    );
  });

  it("moves data: URI buffers and pictures into the binary chunk", async () => {
    const original = await textured();
    const source = partsOf(original);
    const files = splitGlb(source, {
      viewBuffer: source.views.map((_, i) => i % 2),
      buffers: ["data", "data"],
      images: ["data", "view"],
    });
    expect([...files.keys()]).toEqual([GLTF]);
    const result = repacked(files);
    const out = partsOf(result.glb);
    expect(contentOf(out)).toEqual(contentOf(source));
    expect(JSON.stringify(out.json)).not.toContain("data:");
    expect(await newErrors(original, result.glb)).toEqual([]);
  });

  it("finds a percent-encoded name (Box%20With%20Spaces.bin)", async () => {
    const source = partsOf(await textured());
    const files = splitGlb(source, { bufferNames: ["Box With Spaces.bin"] });
    expect(new TextDecoder().decode(files.get(GLTF))).toContain(
      '"Box%20With%20Spaces.bin"',
    );
    expect(contentOf(partsOf(repacked(files).glb))).toEqual(contentOf(source));
  });

  it("types a picture by its bytes, not by its file name or claimed type", async () => {
    const source = partsOf(await textured());
    const files = editGltf(
      splitGlb(source, { images: ["file", "view"] }),
      (json) => {
        json.images[0].uri = "textures/looks-like.png";
        json.images[0].mimeType = "image/png";
      },
    );
    files.set("model/textures/looks-like.png", jpegHeader());
    const out = partsOf(repacked(files).glb);
    const [image] = out.json["images"] as [EditableUri];
    expect(image.mimeType).toBe("image/jpeg");
    expect(image).not.toHaveProperty("uri");
  });

  it("refuses a missing .bin in words that name both files", async () => {
    const files = splitGlb(partsOf(await textured()));
    files.delete("model/part0.bin");
    expect(repackGltf(GLTF, files)).toEqual({
      ok: false,
      reason: refusal.missingFile("model.gltf", "part0.bin"),
    });
  });

  it("refuses a buffer outside the files given, and never fetches one from the internet", async () => {
    const fetched: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (...args: unknown[]) => {
      fetched.push(args);
      return Promise.reject(new Error("no fetch"));
    };
    try {
      const base = () => splitGlb(partsOf(textureless));
      const textureless = await buildModel({ meshes: [boxSpec("a")] });
      const remote = editGltf(base(), (json) => {
        json.buffers[0].uri = "https://example.invalid/part0.bin";
      });
      expect(repackGltf(GLTF, remote)).toEqual({
        ok: false,
        reason: refusal.remotePart("model.gltf"),
      });
      const escape = editGltf(base(), (json) => {
        json.buffers[0].uri = "../../part0.bin";
      });
      escape.set("part0.bin", escape.get("model/part0.bin")!);
      expect(repackGltf(GLTF, escape)).toEqual({
        ok: false,
        reason: refusal.outsideFolder("model.gltf", "part0.bin"),
      });
    } finally {
      globalThis.fetch = original;
    }
    expect(fetched).toEqual([]);
  });

  it("leaves out a picture that is missing, remote, outside the folder, unreadable or of a kind a tour does not show, with a note, and the material stops naming it", async () => {
    // Each case has its own words: a note must say what the creator can
    // fix (a picture outside the folder is not "missing", and bytes that
    // are no known picture may be broken, so no format is claimed).
    const tiff = Uint8Array.of(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0);
    const pngSignatureOnly = pngHeader(4, 4).subarray(0, 8);
    const cases: [string, Uint8Array | null, string][] = [
      ["textures/gone.jpg", null, note.missingPicture("gone.jpg")],
      ["https://example.invalid/x.png", null, note.remotePicture("x.png")],
      [
        "textures/wood.tif",
        tiff,
        note.unsupportedPicture("wood.tif", "PNG, JPEG, WebP and AVIF"),
      ],
      ["data:image/png;base64,iVBO*", null, note.brokenPicture("picture 1")],
      // The scheme is case-insensitive: still embedded data, never a name.
      ["DATA:image/png;base64,iVBO*", null, note.brokenPicture("picture 1")],
      ["../../outside.png", null, note.outsidePicture("outside.png")],
      [
        "textures/noise.png",
        Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
        note.unreadablePicture("noise.png"),
      ],
      ["textures/cut.png", pngSignatureOnly, note.unreadablePicture("cut.png")],
    ];
    for (const [uri, bytes, words] of cases) {
      const original = await textured();
      const source = partsOf(original);
      const files = editGltf(
        splitGlb(source, { images: ["file", "view"] }),
        (json) => {
          json.images[0].uri = uri;
        },
      );
      if (bytes !== null) files.set(`model/${uri}`, bytes);
      const result = repacked(files);
      expect(result.notes, uri).toEqual([words]);
      const out = partsOf(result.glb);
      expect(out.json["images"], uri).toHaveLength(2);
      const material = JSON.stringify(out.json["materials"]);
      expect(material, uri).not.toContain("baseColorTexture");
      expect(material, uri).toContain("normalTexture");
      expect(checkGlbInert(result.glb), uri).toEqual({ ok: true });
      expect(await newErrors(original, result.glb), uri).toEqual([]);
    }
  });

  it("refuses a picture above the pixel cap in words naming it", async () => {
    const files = editGltf(
      splitGlb(partsOf(await textured()), { images: ["file", "view"] }),
      (json) => {
        json.images[0].uri = "huge.png";
      },
    );
    files.set("model/huge.png", pngHeader(8192, 8192));
    const result = repackGltf(GLTF, files);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(
      /^The picture "huge.png" of "model.gltf" cannot go into a tour: it is 8192 x 8192 pixels/,
    );
  });

  it("refuses Draco, meshopt and KTX2 compression in words", async () => {
    const cases: [string, string][] = [
      ["KHR_draco_mesh_compression", "Draco"],
      ["EXT_meshopt_compression", "meshopt"],
      ["KHR_meshopt_compression", "meshopt"],
      ["KHR_texture_basisu", "KTX2 pictures"],
    ];
    for (const [extension, kind] of cases) {
      for (const key of ["extensionsUsed", "extensionsRequired"]) {
        const files = editGltf(
          splitGlb(partsOf(await buildModel({ meshes: [boxSpec("a")] }))),
          (json) => {
            json[key] = [extension];
          },
        );
        expect(repackGltf(GLTF, files), extension).toEqual({
          ok: false,
          reason: refusal.compressed(kind),
        });
      }
    }
  });

  it("refuses text that is no glTF 2.0 model", () => {
    const one = (text: string) =>
      repackGltf(
        "a.gltf",
        new Map([["a.gltf", new TextEncoder().encode(text)]]),
      );
    expect(one("not json")).toEqual({
      ok: false,
      reason: refusal.unreadable("a.gltf"),
    });
    expect(one("[1]")).toEqual({
      ok: false,
      reason: refusal.unreadable("a.gltf"),
    });
    expect(one('{"asset":{"version":"1.0"}}')).toEqual({
      ok: false,
      reason: refusal.notVersion2("a.gltf"),
    });
    expect(
      one('{"asset":{"version":"2.0"},"buffers":[{"byteLength":4}]}'),
    ).toEqual({
      ok: false,
      reason: refusal.unreadable("a.gltf"),
    });
    expect(
      one(
        '{"asset":{"version":"2.0"},"buffers":[{"byteLength":4,"uri":"data:;base64,AAAAAA=="}],"bufferViews":[{"buffer":1,"byteLength":4}]}',
      ),
    ).toEqual({ ok: false, reason: refusal.unreadable("a.gltf") });
    expect(repackGltf("gone.gltf", new Map())).toEqual({
      ok: false,
      reason: refusal.unreadable("gone.gltf"),
    });
  });

  it("refuses a buffer shorter than it says, and a broken data: buffer", () => {
    const one = (buffer: object) =>
      repackGltf(
        "a.gltf",
        new Map<string, Uint8Array>([
          [
            "a.gltf",
            new TextEncoder().encode(
              JSON.stringify({ asset: { version: "2.0" }, buffers: [buffer] }),
            ),
          ],
          ["a.bin", new Uint8Array(4)],
        ]),
      );
    expect(one({ byteLength: 8, uri: "a.bin" })).toEqual({
      ok: false,
      reason: refusal.partTooShort("a.gltf", "a.bin"),
    });
    // A short buffer inside the text has no file name to quote: the words
    // must not show a piece of its base64 as one.
    expect(one({ byteLength: 8, uri: "data:;base64,AAAAAA==" })).toEqual({
      ok: false,
      reason: refusal.embeddedPartTooShort("a.gltf"),
    });
    expect(one({ byteLength: 2, uri: "data:;base64,AA*=" })).toEqual({
      ok: false,
      reason: refusal.brokenPart("a.gltf"),
    });
    expect(one({ byteLength: 4, uri: "a.bin" }).ok).toBe(true);
  });

  it("caps the text without its data: URIs, and the whole file and its data at the size ceiling", async () => {
    const files = splitGlb(partsOf(await textured()), {
      buffers: ["data"],
      images: ["data", "data"],
    });
    const text = files.get(GLTF)!.length;
    // The text is mostly data URIs, so a cap well under its length passes.
    const passing = repackGltf(GLTF, files, { maxTextBytes: 4096 });
    expect(passing.ok).toBe(true);
    expect(repackGltf(GLTF, files, { maxTextBytes: 100 })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^"model.gltf" holds .* MB of text/),
    });
    expect(repackGltf(GLTF, files, { maxBytes: text - 1 })).toEqual({
      ok: false,
      reason: refusal.tooLarge("model.gltf", text, text - 1),
    });
    const split = splitGlb(partsOf(await textured()));
    const bin = split.get("model/part0.bin")!.length;
    expect(repackGltf(GLTF, split, { maxBytes: bin - 1 })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(
        /^"model.gltf" is too large to convert here/,
      ),
    });
  });

  it("keeps an extension that names a buffer view pointing at the same bytes", async () => {
    const source = partsOf(await textured());
    const files = editGltf(
      splitGlb(source, {
        viewBuffer: source.views.map((_, i) => (i + 1) % 2),
        images: ["file", "file"],
      }),
      (json) => {
        json.extensionsUsed = ["EXT_example_view_user"];
        json.extensions = { EXT_example_view_user: { bufferView: 2 } };
      },
    );
    const out = looseGlbParts(repacked(files).glb);
    const extensions = out.json["extensions"] as Record<string, GltfObject>;
    expect(extensions["EXT_example_view_user"]).toEqual({ bufferView: 2 });
    expect(out.views[2]).toEqual(source.views[2]);
  });

  it("refuses a text above the text cap before decoding or parsing it", () => {
    // A structure-heavy text could exhaust the memory of the parse before
    // any check after it ran, so the cap must run on the bytes first.
    const filler = new Array<string>(600).fill("0").join(",");
    const text = `{"asset":{"version":"2.0"},"extras":[${filler}]}`;
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(
        repackGltf("a.gltf", new Map([["a.gltf", encode(text)]]), {
          maxTextBytes: 1000,
        }),
      ).toEqual({
        ok: false,
        reason: refusal.textTooLarge("a.gltf", text.length, 1000),
      });
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("still counts only the buffers' and pictures' data: URIs as data once the text is parsed", () => {
    // The check on the bytes counts every literal starting with data:, so
    // it can only let more through; the exact count after the parse is
    // what holds a data: string anywhere else to the text cap.
    const text = JSON.stringify({
      asset: { version: "2.0" },
      extras: { note: `data:${"A".repeat(2000)}` },
    });
    expect(
      repackGltf("a.gltf", new Map([["a.gltf", encode(text)]]), {
        maxTextBytes: 1000,
      }),
    ).toEqual({
      ok: false,
      reason: refusal.textTooLarge("a.gltf", text.length, 1000),
    });
  });

  it("names the real size when the data inside the text goes over the ceiling", () => {
    // The sizes are large enough that a wrong number shows in the words
    // (MB with one decimal). A text holds 4/3 of its data: URIs' bytes, so
    // only a file buffer before them lets the data, not the file, go over.
    const MiB = 1024 * 1024;
    const data = Buffer.from(new Uint8Array(MiB / 2)).toString("base64");
    const text = JSON.stringify({
      asset: { version: "2.0" },
      buffers: [
        { byteLength: MiB, uri: "a.bin" },
        { byteLength: MiB / 2, uri: `data:;base64,${data}` },
      ],
    });
    const cap = Math.round(1.2 * MiB);
    const files = new Map<string, Uint8Array>([
      ["a.gltf", encode(text)],
      ["a.bin", new Uint8Array(MiB)],
    ]);
    expect(repackGltf("a.gltf", files, { maxBytes: cap })).toEqual({
      ok: false,
      reason: refusal.tooLarge("a.gltf", 1.5 * MiB, cap),
    });
  });

  it("keeps every accessor aligned when a buffer's length is no multiple of 4", async () => {
    // glTF requires each accessor's data to start on a multiple of its
    // component size; a buffer laid after an odd-length one must be padded.
    const original = await textured();
    const source = partsOf(original);
    const files = splitGlb(source, {
      viewBuffer: source.views.map((_, i) => i % 3),
      bufferTails: [1, 3, 2],
    });
    const glb = repacked(files).glb;
    const out = partsOf(glb);
    expect(misalignedAccessors(out.json)).toEqual([]);
    expect(contentOf(out)).toEqual(contentOf(source));
    expect(await newErrors(original, glb)).toEqual([]);
  });

  it("says which file stood in for a name that matched only in another letter case or by its file name alone", async () => {
    const source = partsOf(await textured());
    let picture = "";
    const files = editGltf(
      splitGlb(source, { images: ["file", "view"] }),
      (json) => {
        json.buffers[0].uri = "PART0.BIN";
        picture = decodeURI(json.images[0].uri!).split("/").pop()!;
        json.images[0].uri = `C:\\Users\\artist\\maps\\${picture}`;
      },
    );
    const result = repacked(files);
    expect(result.notes).toEqual([
      note.stoodIn("PART0.BIN", "model/part0.bin"),
      note.stoodIn(
        `C:\\Users\\artist\\maps\\${picture}`,
        `model/textures/${picture}`,
      ),
    ]);
    expect(contentOf(partsOf(result.glb))).toEqual(contentOf(source));
  });

  it("never finds a buffer by its file name alone, and says when it points to another computer", async () => {
    // A wrong .bin found by name would make a broken-looking model with
    // nothing to tell the creator why, so a buffer must be where it says.
    const textureless = await buildModel({ meshes: [boxSpec("a")] });
    const withBuffer = (uri: string) =>
      repackGltf(
        GLTF,
        editGltf(splitGlb(partsOf(textureless)), (json) => {
          json.buffers[0].uri = uri;
        }),
      );
    expect(withBuffer("maps/part0.bin")).toEqual({
      ok: false,
      reason: refusal.missingFile("model.gltf", "part0.bin"),
    });
    for (const uri of ["C:\\data\\part0.bin", "file:///C:/data/part0.bin"]) {
      expect(withBuffer(uri), uri).toEqual({
        ok: false,
        reason: refusal.otherComputer("model.gltf", "part0.bin"),
      });
    }
  });

  it("leaves out a picture on another computer that no given file stands in for, in words that say so", async () => {
    const files = editGltf(
      splitGlb(partsOf(await textured()), { images: ["file", "view"] }),
      (json) => {
        json.images[0].uri = "D:\\renders\\gone.png";
      },
    );
    expect(repacked(files).notes).toEqual([
      note.otherComputerPicture("gone.png"),
    ]);
  });

  it("keeps a texture that still has another picture to show, and says so", async () => {
    // A texture may name a fallback picture and an extension's picture;
    // losing one of them must not take the texture off the material.
    for (const lost of ["source", "extension"] as const) {
      const source = partsOf(await textured());
      const gone = `gone-${lost}.jpg`;
      const files = editGltf(
        splitGlb(source, { images: ["file", "file"] }),
        (json) => {
          const materials = json["materials"] as {
            pbrMetallicRoughness: { baseColorTexture: { index: number } };
          }[];
          const textures = json["textures"] as {
            source: number;
            extensions?: Record<string, { source: number }>;
          }[];
          const index =
            materials[0]!.pbrMetallicRoughness.baseColorTexture.index;
          const texture = textures[index]!;
          const other = texture.source === 0 ? 1 : 0;
          texture.extensions = { EXT_texture_webp: { source: other } };
          json["extensionsUsed"] = [
            ...((json["extensionsUsed"] as string[] | undefined) ?? []),
            "EXT_texture_webp",
          ];
          const image = lost === "source" ? texture.source : other;
          (json.images as EditableUri[])[image]!.uri = `textures/${gone}`;
        },
      );
      const result = repacked(files);
      expect(result.notes, lost).toEqual([
        note.missingPicture(gone),
        note.otherPictureShown(gone),
      ]);
      const out = partsOf(result.glb);
      expect(JSON.stringify(out.json["materials"]), lost).toContain(
        "baseColorTexture",
      );
      // The extension stays only while the picture it names is kept.
      expect(
        JSON.stringify(out.json["textures"]).includes("EXT_texture_webp"),
        lost,
      ).toBe(lost === "source");
      expect(checkGlbInert(result.glb), lost).toEqual({ ok: true });
    }
  });

  it("writes the same bytes on a second run", async () => {
    const files = splitGlb(partsOf(await textured()), {
      viewBuffer: [0, 1, 0, 1, 0, 1, 0, 1],
      images: ["file", "data"],
    });
    expect(repacked(files).glb).toEqual(repacked(files).glb);
  });
});

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../playwright-tests/fixtures/asset-optimizer/${name}`,
          import.meta.url,
        ),
      ),
    ),
  );

describe("repackGltf on the real fixtures", () => {
  for (const name of ["model-utility-box.glb", "model-marble-bust.glb"]) {
    it(`splits and repacks ${name} to the same accessors and pictures, with no new validator errors`, async () => {
      const original = fixture(name);
      const source = partsOf(original);
      const images = ((source.json["images"] ?? []) as unknown[]).map(
        () => "file" as const,
      );
      const files = splitGlb(source, {
        viewBuffer: source.views.map((_, i) => i % 2),
        images,
      });
      const result = repacked(files);
      const out = partsOf(result.glb);
      expect(contentOf(out)).toEqual(contentOf(source));
      expect(result.notes).toEqual([]);
      expect(await newErrors(original, result.glb)).toEqual([]);
    }, 60_000);
  }
});
