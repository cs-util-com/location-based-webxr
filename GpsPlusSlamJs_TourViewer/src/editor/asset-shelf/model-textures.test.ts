/**
 * Why these tests matter: a model's textures are most of its bytes, and
 * the format each is written in decides whether the model still looks
 * right. A colour map as JPEG is fine; a cut-out leaf as JPEG loses its
 * alpha and turns into a black square; a lossless normal map re-encoded
 * lossily shows banding in the lighting. The device is a fake, so these
 * pin the decisions (which size, which format, which quality, what is
 * kept) and not a browser's encoder; the e2e runs the real one.
 */
import { describe, expect, it } from "vitest";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

import { type GlbParts, readGlb, writeGlb } from "./glb-file.js";
import { imageUses, shrinkTextures, textureFormat } from "./model-textures.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";
import {
  boxSpec,
  buildModel,
  type ModelSpec,
} from "./test-support/glb-fixtures.js";
import { fakePictureDevice } from "./test-support/fake-picture-device.js";

const SETTINGS = OPTIMIZER_SETTINGS.model;

function control(
  progress: number[] = [],
  signal = new AbortController().signal,
) {
  return { signal, progress: (f: number) => progress.push(f) };
}

async function partsOf(spec: Omit<ModelSpec, "meshes">): Promise<GlbParts> {
  const read = readGlb(await buildModel({ meshes: [boxSpec("a")], ...spec }));
  if (!read.ok) throw new Error(read.reason);
  return read.parts;
}

describe("imageUses and textureFormat", () => {
  const json = {
    images: [{}, {}, {}, {}],
    textures: [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        normalTexture: { index: 1 },
      },
      {
        alphaMode: "MASK",
        pbrMetallicRoughness: { baseColorTexture: { index: 2 } },
        extensions: {
          KHR_materials_clearcoat: { clearcoatNormalTexture: { index: 3 } },
        },
      },
    ],
  };

  it("tells colour, data and alpha use apart, extension textures included", () => {
    const uses = imageUses(json);
    expect(uses.get(0)).toEqual({ colour: true, data: false, alpha: false });
    expect(uses.get(1)).toEqual({ colour: false, data: true, alpha: false });
    expect(uses.get(2)).toEqual({ colour: true, data: false, alpha: true });
    expect(uses.get(3)).toEqual({ colour: false, data: true, alpha: false });
  });

  it("writes colour as JPEG, alpha as PNG, and keeps a lossless data map lossless", () => {
    const colour = { colour: true, data: false, alpha: false };
    const data = { colour: false, data: true, alpha: false };
    const alpha = { colour: true, data: false, alpha: true };
    expect(textureFormat(colour, "image/png", SETTINGS)).toEqual({
      type: "image/jpeg",
      quality: SETTINGS.colourQuality,
    });
    expect(textureFormat(data, "image/jpeg", SETTINGS)).toEqual({
      type: "image/jpeg",
      quality: SETTINGS.dataQuality,
    });
    expect(textureFormat(data, "image/png", SETTINGS).type).toBe("image/png");
    expect(textureFormat(alpha, "image/jpeg", SETTINGS).type).toBe("image/png");
  });

  // Why: one image can be both a colour and a data texture (a base colour
  // map reused as an occlusion map). The stricter use wins: a lossless
  // source stays lossless and a lossy one takes the data quality, since
  // banding in the lighting shows more than a slightly larger file.
  it("writes an image used as colour and as data by the data rule", () => {
    const both = { colour: true, data: true, alpha: false };
    expect(textureFormat(both, "image/png", SETTINGS)).toEqual({
      type: "image/png",
      quality: 1,
    });
    expect(textureFormat(both, "image/jpeg", SETTINGS)).toEqual({
      type: "image/jpeg",
      quality: SETTINGS.dataQuality,
    });
  });

  // Why: WebP in place of JPEG is the one texture setting that measured a
  // real saving (14 to 30 % of the texture bytes at the shelf's quality
  // numbers on the check page's samples, about 40 % at the same PSNR). It replaces only the lossy JPEG choices: alpha
  // and a lossless data map stay PNG, whatever the setting.
  it("writes WebP where it would write JPEG when the settings ask for WebP", () => {
    const webp = { ...SETTINGS, textureType: "image/webp" as const };
    const colour = { colour: true, data: false, alpha: false };
    const data = { colour: false, data: true, alpha: false };
    const alpha = { colour: true, data: false, alpha: true };
    expect(textureFormat(colour, "image/png", webp)).toEqual({
      type: "image/webp",
      quality: SETTINGS.colourQuality,
    });
    expect(textureFormat(data, "image/jpeg", webp)).toEqual({
      type: "image/webp",
      quality: SETTINGS.dataQuality,
    });
    expect(textureFormat(data, "image/png", webp).type).toBe("image/png");
    expect(textureFormat(alpha, "image/jpeg", webp).type).toBe("image/png");
  });
});

describe("shrinkTextures", () => {
  it("resizes large textures to the limit, in the format their use asks for", async () => {
    const parts = await partsOf({
      baseColor: "png",
      normalMap: "png",
      textureSize: [2048, 1024],
    });
    const fake = fakePictureDevice();
    const progress: number[] = [];
    const report = await shrinkTextures(
      parts,
      SETTINGS,
      fake.device,
      control(progress),
      { from: 0.1, to: 0.5 },
    );
    expect(fake.encoded).toEqual([
      { w: 1024, h: 512, type: "image/jpeg", quality: SETTINGS.colourQuality },
      { w: 1024, h: 512, type: "image/png", quality: 1 },
    ]);
    // Why "texture": the device must not colour-convert or premultiply a
    // texture, or the renderer's own colour handling sees changed values.
    expect(fake.decoded.map((p) => p.purpose)).toEqual(["texture", "texture"]);
    expect(fake.closed()).toBe(2);
    expect(report).toMatchObject({ changed: 2, kept: 0, largestSide: 1024 });
    expect(progress.at(-1)).toBeCloseTo(0.5);
    expect(progress.every((f) => f > 0.1 && f <= 0.5)).toBe(true);
    const images = parts.json["images"] as { mimeType: string }[];
    expect(images.map((i) => i.mimeType)).toEqual(["image/jpeg", "image/png"]);
    expect(checkGlbInert(writeGlb(parts)).ok).toBe(true);
  });

  // Why: a WebP image is only valid glTF through EXT_texture_webp. The
  // texture must name it there (not as its core source, which a viewer
  // without the extension would try to read as JPEG or PNG) and the file
  // must list the extension as used and required, or three.js and the
  // tour's own check read a model whose textures do not load.
  it("names a WebP texture through EXT_texture_webp and marks the extension required", async () => {
    const parts = await partsOf({
      baseColor: "jpeg",
      normalMap: "png",
      textureSize: [2048, 2048],
    });
    const webp = { ...SETTINGS, textureType: "image/webp" as const };
    const fake = fakePictureDevice();
    const report = await shrinkTextures(parts, webp, fake.device, control());
    expect(fake.encoded.map((e) => e.type)).toEqual([
      "image/webp",
      "image/png",
    ]);
    expect(report).toMatchObject({ changed: 2, largestSide: 1024 });
    const json = parts.json as {
      images: { mimeType: string }[];
      textures: { source?: number; extensions?: Record<string, unknown> }[];
      extensionsUsed?: string[];
      extensionsRequired?: string[];
    };
    expect(json.images.map((i) => i.mimeType)).toEqual([
      "image/webp",
      "image/png",
    ]);
    const colour = json.textures.find(
      (t) => t.extensions?.["EXT_texture_webp"] !== undefined,
    );
    expect(colour?.source).toBeUndefined();
    expect(colour?.extensions).toEqual({ EXT_texture_webp: { source: 0 } });
    expect(json.textures.filter((t) => t.source === 1)).toHaveLength(1);
    expect(json.extensionsUsed).toContain("EXT_texture_webp");
    expect(json.extensionsRequired).toContain("EXT_texture_webp");
    const written = writeGlb(parts);
    expect(checkGlbInert(written).ok).toBe(true);
    expect(readGlb(written).ok).toBe(true);
  });

  it("keeps a cut-out colour texture as PNG so its alpha survives", async () => {
    const parts = await partsOf({
      baseColor: "jpeg",
      alphaMode: "MASK",
      textureSize: [2000, 2000],
    });
    const fake = fakePictureDevice();
    await shrinkTextures(parts, SETTINGS, fake.device, control());
    expect(fake.encoded[0]).toMatchObject({
      w: 1024,
      h: 1024,
      type: "image/png",
    });
  });

  it("never touches a PNG within the limit and keeps a JPEG whose re-encoding is not smaller", async () => {
    const parts = await partsOf({
      baseColor: "jpeg",
      normalMap: "png",
      textureSize: [512, 512],
    });
    // Why: re-encoding a JPEG that needs no resizing only loses quality
    // unless it saves bytes; a fake encoder of 4 bytes a pixel never does.
    const fake = fakePictureDevice(4);
    const before = parts.views.length;
    const report = await shrinkTextures(
      parts,
      SETTINGS,
      fake.device,
      control(),
    );
    expect(fake.encoded.map((e) => e.type)).toEqual(["image/jpeg"]);
    expect(report).toMatchObject({ changed: 0, kept: 2, largestSide: 512 });
    expect(parts.views.length).toBe(before);
  });

  // Why: the largest side is what the shelf reports about a model's
  // textures; an image left as it is still draws at its own size, so a
  // large WebP the pass cannot rewrite must not read as a small model.
  it("leaves an image it cannot decode, and one of another type, as they are, and counts their size", async () => {
    const parts = await partsOf({
      baseColor: "jpeg",
      normalMap: "png",
      textureSize: [3000, 1000],
    });
    const images = parts.json["images"] as { mimeType: string }[];
    images[1]!.mimeType = "image/webp";
    const fake = fakePictureDevice();
    fake.device.decode = () => Promise.reject(new Error("broken picture"));
    const report = await shrinkTextures(
      parts,
      SETTINGS,
      fake.device,
      control(),
    );
    expect(report).toMatchObject({ changed: 0, kept: 2, largestSide: 3000 });
    expect(images.map((i) => i.mimeType)).toEqual(["image/jpeg", "image/webp"]);
  });

  it("stops with an AbortError once its run is stopped", async () => {
    const parts = await partsOf({ baseColor: "jpeg" });
    const stop = new AbortController();
    stop.abort();
    await expect(
      shrinkTextures(
        parts,
        SETTINGS,
        fakePictureDevice().device,
        control([], stop.signal),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses an encoder that writes another type than asked", async () => {
    const parts = await partsOf({ baseColor: "png", textureSize: [2048, 64] });
    const fake = fakePictureDevice();
    fake.device.encode = () =>
      Promise.resolve(new Blob([new Uint8Array(8)], { type: "image/png" }));
    await expect(
      shrinkTextures(parts, SETTINGS, fake.device, control()),
    ).rejects.toThrow(/cannot write image\/jpeg/);
  });
});
