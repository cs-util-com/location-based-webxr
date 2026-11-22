/**
 * Why these tests matter: the import list decides which files the editor
 * converts, which it holds back as a model's parts and which go down the
 * tour's own path. It must never claim a file the tour takes as it is (a
 * `.glb`, a sound), must read extensions in any letter case as a picker
 * does, and must stay out of the tour's media allowlist: a tour never
 * carries a `.gltf`.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  TOUR_MEDIA_EXTENSIONS,
  tourMediaTypeOf,
} from "gps-plus-slam-app-framework/ar/tour-media";

import { IMPORT_ACCEPT, importRoleOf } from "./import-formats.js";

describe("importRoleOf", () => {
  it("names the model files, the containers and the parts, in any letter case", () => {
    expect(importRoleOf("bust.gltf")).toBe("primary");
    expect(importRoleOf("Bust.GLTF")).toBe("primary");
    expect(importRoleOf("bust.zip")).toBe("container");
    for (const part of ["a.bin", "a.mtl", "a.tga", "a.BMP"]) {
      expect(importRoleOf(part), part).toBe("companion");
    }
  });

  it("calls a tour picture a picture, and every other tour file plain", () => {
    for (const name of [
      "a.png",
      "a.JPG",
      "a.jpeg",
      "a.webp",
      "a.gif",
      "a.avif",
    ]) {
      expect(importRoleOf(name), name).toBe("picture");
    }
    for (const name of ["a.glb", "a.mp3", "a.wav", "a.mp4"]) {
      expect(importRoleOf(name), name).toBe("plain");
    }
  });

  it("knows nothing else: no extension, a dot file, an unknown kind", () => {
    for (const name of ["readme", "a.txt", ".gltf", "a.", "a.gltf.txt", ""]) {
      expect(importRoleOf(name), name).toBeNull();
    }
  });

  it("never names a file the tour takes as a model part or a model file", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOUR_MEDIA_EXTENSIONS),
        fc.string({ maxLength: 8 }),
        (ext, stem) => {
          const role = importRoleOf(`${stem}x.${ext}`);
          const picture = tourMediaTypeOf(ext)?.kind === "image";
          expect(role).toBe(picture ? "picture" : "plain");
        },
      ),
    );
  });
});

describe("IMPORT_ACCEPT", () => {
  it("lists every import extension once, with its dot, and no tour type", () => {
    const listed = IMPORT_ACCEPT.split(",");
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual(
      expect.arrayContaining([".gltf", ".zip", ".bin", ".mtl", ".tga", ".bmp"]),
    );
    for (const ext of listed) {
      expect(ext.startsWith(".")).toBe(true);
      expect(tourMediaTypeOf(ext.slice(1))).toBeNull();
    }
  });
});
