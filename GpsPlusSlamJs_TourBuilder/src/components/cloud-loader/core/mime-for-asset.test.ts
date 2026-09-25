import { describe, expect, it } from "vitest";

import { mimeForAsset } from "./mime-for-asset.js";

/**
 * Why these tests matter: the MIME on the minted Blob URL is what the scene's
 * audio/image/GLTF consumers see. TASK §2.5 names MP3/OGG and JPG/PNG as
 * first-class formats, so a per-`AssetType` constant would mislabel .ogg as
 * audio/mpeg and .jpg as image/png — the extension must win, with the type
 * default only as a last resort for exotic filenames.
 */

describe("mimeForAsset", () => {
  it("derives the MIME from the filename extension", () => {
    expect(mimeForAsset("assets/story.ogg", "audio")).toBe("audio/ogg");
    expect(mimeForAsset("assets/knight.jpg", "sprite")).toBe("image/jpeg");
    expect(mimeForAsset("assets/knight.glb", "model")).toBe(
      "model/gltf-binary",
    );
  });

  it("is case-insensitive on the extension", () => {
    expect(mimeForAsset("assets/STORY.MP3", "audio")).toBe("audio/mpeg");
  });

  it("falls back to the asset type's default for unknown extensions", () => {
    expect(mimeForAsset("assets/story.weird", "audio")).toBe("audio/mpeg");
    expect(mimeForAsset("assets/knight.bin", "model")).toBe(
      "model/gltf-binary",
    );
  });

  it("falls back when the filename has no extension at all", () => {
    expect(mimeForAsset("assets/knight", "sprite")).toBe("image/png");
  });
});
