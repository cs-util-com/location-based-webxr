import { describe, expect, it } from "vitest";

import { assetFilename } from "../../packaging/core/asset-filename.js";
import {
  buildAssetEntry,
  isAllowedAssetFile,
  ALLOWED_EXTENSIONS,
} from "./asset-attachment.js";

/**
 * Why this matters: component 5 (packaging) owns the `assets/<id>.<ext>`
 * filename convention and its edge cases. This module must produce filenames
 * packaging agrees with — not a second, drifting implementation — so a tour
 * authored here always packs cleanly.
 */

describe("buildAssetEntry", () => {
  it("maps each slot to its AssetType", () => {
    const file = new File([], "knight.glb");
    expect(buildAssetEntry("a1", "model", file).type).toBe("model");
    expect(buildAssetEntry("a1", "sprite", file).type).toBe("sprite");
    expect(buildAssetEntry("a1", "audio", file).type).toBe("audio");
  });

  it("carries the given id through unchanged", () => {
    const file = new File([], "story.mp3");
    expect(buildAssetEntry("asset-7", "audio", file).id).toBe("asset-7");
  });

  it("delegates filename to packaging's assetFilename — no drift", () => {
    const file = new File([], "MODEL.GLB");
    expect(buildAssetEntry("knight", "model", file).filename).toBe(
      assetFilename("knight", file),
    );
  });
});

describe("isAllowedAssetFile", () => {
  it("accepts a model file by its GLTF/GLB extension (contract: model is GLTF/GLB)", () => {
    expect(isAllowedAssetFile("model", new File([], "knight.glb"))).toBe(true);
    expect(isAllowedAssetFile("model", new File([], "knight.gltf"))).toBe(true);
  });

  it("rejects a model file with an unrelated extension", () => {
    expect(isAllowedAssetFile("model", new File([], "knight.mp3"))).toBe(false);
  });

  it("accepts common image extensions for sprite (contract: sprite is an image)", () => {
    for (const ext of [".jpg", ".jpeg", ".png", ".webp", ".gif"]) {
      expect(isAllowedAssetFile("sprite", new File([], `facade${ext}`))).toBe(
        true,
      );
    }
  });

  it("rejects a sprite file that isn't an image", () => {
    expect(isAllowedAssetFile("sprite", new File([], "facade.glb"))).toBe(
      false,
    );
  });

  it("accepts MP3/OGG for audio (contract: audio is MP3/OGG)", () => {
    expect(isAllowedAssetFile("audio", new File([], "story.mp3"))).toBe(true);
    expect(isAllowedAssetFile("audio", new File([], "story.ogg"))).toBe(true);
  });

  it("rejects an audio file with an unrelated extension", () => {
    expect(isAllowedAssetFile("audio", new File([], "story.txt"))).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isAllowedAssetFile("model", new File([], "KNIGHT.GLB"))).toBe(true);
  });

  it("rejects a file with no extension", () => {
    expect(isAllowedAssetFile("audio", new File([], "story"))).toBe(false);
  });

  it("every slot's allowed list matches ALLOWED_EXTENSIONS exactly", () => {
    for (const slot of ["model", "sprite", "audio"] as const) {
      for (const ext of ALLOWED_EXTENSIONS[slot]) {
        expect(isAllowedAssetFile(slot, new File([], `x${ext}`))).toBe(true);
      }
    }
  });
});
