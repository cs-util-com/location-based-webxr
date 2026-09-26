/**
 * Why this test matters: the registry is the only way imagery reaches the
 * globe, so every source must carry a credit (NASA's terms ask for the
 * acknowledgement; a source without one would load uncredited), and the
 * paths must match what the fetch script wrote, or the page asks for files
 * that do not exist. The committed pyramid is checked for completeness here
 * too: 2 x 4^z tiles per level, each a 256x256 JPEG, and the global maps at
 * 2048x1024, read by their headers.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { imageInfo } from "./image-header.js";
import {
  GIBS_ACKNOWLEDGEMENT,
  GLOBE_SOURCES,
  globeSource,
} from "./globe-sources.js";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
/** A registry path served at /globe-assets/ maps to the assets folder. */
const onDisk = (path: string): string =>
  join(ASSETS, ...path.replace(/^\/globe-assets\//, "").split("/"));

describe("GLOBE_SOURCES", () => {
  it("names every source once, each with a full credit", () => {
    const ids = GLOBE_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of GLOBE_SOURCES) {
      expect(s.credit.short.trim(), s.id).not.toBe("");
      expect(s.credit.full.trim(), s.id).not.toBe("");
      expect(s.credit.href, s.id).toMatch(/^https:\/\//);
      expect(s.path, s.id).toMatch(/^\/globe-assets\//);
    }
    expect(GIBS_ACKNOWLEDGEMENT).toMatch(/Global Imagery Browse Services/);
  });

  it("finds a source by id and refuses an unknown one", () => {
    expect(globeSource("blue-marble").kind).toBe("tiles");
    expect(() => globeSource("nope" as never)).toThrow(RangeError);
  });
});

describe("the committed imagery", () => {
  it("has the complete Blue Marble pyramid, every tile a 256x256 JPEG", () => {
    const tiles = globeSource("blue-marble");
    const levels = tiles.levels ?? 0;
    for (let z = 0; z < levels; z++) {
      const files: string[] = [];
      const levelDir = onDisk(tiles.path.split("{z}")[0] + String(z));
      for (const x of readdirSync(levelDir)) {
        for (const y of readdirSync(join(levelDir, x)))
          files.push(join(levelDir, x, y));
      }
      expect(files, `level ${z}`).toHaveLength(2 * 4 ** z);
      for (const file of files) {
        expect(imageInfo(readFileSync(file)), file).toEqual({
          type: "jpeg",
          width: 256,
          height: 256,
        });
      }
    }
  });

  it("has every global map at 2048x1024, under the repo's 2 MiB file ceiling", () => {
    for (const s of GLOBE_SOURCES.filter((u) => u.kind === "equirect")) {
      const file = onDisk(s.path);
      const info = imageInfo(readFileSync(file));
      expect(info?.width, s.id).toBe(2048);
      expect(info?.height, s.id).toBe(1024);
      expect(statSync(file).size, s.id).toBeLessThan(2 * 1024 * 1024);
    }
  });
});
