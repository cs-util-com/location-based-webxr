/**
 * Why this test matters: the registry is the only way imagery reaches the
 * globe, so every source must carry a credit (NASA's terms ask for the
 * acknowledgement; a source without one would load uncredited), and the
 * paths must match what the fetch script wrote, or the page asks for files
 * that do not exist. The committed pyramid is checked for completeness here
 * too: 2 x 4^z tiles per level, each a 256x256 WebP (round-4 plan
 * 2026-09-28-2105 DEC-GL4-3/10) whose alpha is the water mask where the tile
 * has water (DEC-GL4-6), and the global maps as 2048x1024 WebPs, read by
 * their headers. And the committed total stays inside
 * its budget: nothing else guards it (the repo checks single files only),
 * and each level of the pyramid quadruples the tile count.
 */

import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
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
  // Why the shape of this test (2026-10-01): with level 5 the pyramid is
  // 2,730 files, and reading each whole file with three assertions apiece
  // took 30-35 s under load, at its timeout. Every file is still checked,
  // but by its first 64 bytes (the WebP header: type, size, alpha) and its
  // RIFF length against its size on disk (a truncated file fails), with
  // one assertion per level; the pixels are decoded for a deterministic
  // sample per level in the next test.
  it("has the complete Blue Marble pyramid, every tile a 256x256 WebP, the water in its alpha", () => {
    const tiles = globeSource("blue-marble");
    const levels = tiles.levels ?? 0;
    // The water mask rides in the same files.
    expect(globeSource("water-mask").path).toBe(tiles.path);
    expect(globeSource("water-mask").kind).toBe("alpha");
    for (let z = 0; z < levels; z++) {
      const files = levelFiles(z);
      expect(files, `level ${z}`).toHaveLength(2 * 4 ** z);
      const bad: string[] = [];
      let withWater = 0;
      for (const file of files) {
        const tile = checkTile(file);
        if (tile.problem) bad.push(tile.problem);
        if (tile.alpha) withWater += 1;
      }
      expect(bad, `level ${z}`).toEqual([]);
      // Most of the Earth is sea: most tiles at every level have water
      // (measured: every tile at levels 0-2, 85 % at level 4).
      expect(withWater / files.length, `level ${z}`).toBeGreaterThan(0.5);
    }
    // Open Pacific (level 4, 0-11°S, 169-158°W): water, so alpha.
    const pacific = imageInfo(
      readFileSync(onDisk(tiles.path.replace("{z}/{x}/{y}", "4/1/8"))),
    );
    expect(pacific).toMatchObject({ type: "webp", alpha: true });
  });

  // Why: the header check above cannot see a broken image body. Every
  // level's files, sorted, are decoded at a fixed stride (about eight a
  // level, the first and the last included), so a file the encoder or a
  // copy damaged in the sample fails, and the sample never changes
  // between runs.
  it("decodes a fixed sample of every level to 256x256 pixels", async () => {
    const levels = globeSource("blue-marble").levels ?? 0;
    const bad: string[] = [];
    let decoded = 0;
    for (let z = 0; z < levels; z++) {
      const files = levelFiles(z);
      const stride = Math.max(1, Math.floor(files.length / 8));
      const sample = files.filter(
        (_, i) => i % stride === 0 || i === files.length - 1,
      );
      for (const file of sample) {
        try {
          const { info } = await sharp(file)
            .raw()
            .toBuffer({ resolveWithObject: true });
          if (info.width !== 256 || info.height !== 256) {
            bad.push(`${file}: ${info.width}x${info.height}`);
          }
          decoded += 1;
        } catch (error) {
          bad.push(`${file}: ${String(error)}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(decoded).toBeGreaterThan(40);
  }, 60_000);

  // Why (review B7): the water mask is a HARD mask, lossless in the alpha
  // plane (0 water, 255 land), and the colour under the water is kept
  // (libwebp's `exact`), because the glint and the shading read the sea's
  // own colour there. A lossy or blended alpha would put a glint fringe on
  // every coast; a zeroed colour would turn the sea black. Decoded, not
  // read from headers.
  // Level 5 too (review 2026-10-01, m6): its 2,048 tiles came from the
  // same encoder run, but nothing decoded any of them. Every 8th tile with
  // water at level 4, every 32nd at level 5 (about 55 and 50 tiles).
  it.each([
    [4, 8],
    [5, 32],
  ])(
    "keeps the level-%i tiles' alpha at 0 or 255 and the sea's colour under it",
    async (level, every) => {
      const tiles = globeSource("blue-marble");
      const levelDir = onDisk(tiles.path.split("{z}")[0] + String(level));
      const withWater = readdirSync(levelDir)
        .flatMap((x) =>
          readdirSync(join(levelDir, x)).map((y) => join(levelDir, x, y)),
        )
        .filter((file) => {
          const info = imageInfo(readFileSync(file));
          return info?.type === "webp" && info.alpha;
        })
        .filter((_, i) => i % every === 0);
      expect(withWater.length).toBeGreaterThan(20);
      let waterPixels = 0;
      let waterRgbSum = 0;
      for (const file of withWater) {
        const water = await decodeWater(file);
        waterPixels += water.pixels;
        waterRgbSum += water.rgbSum;
      }
      expect(waterPixels).toBeGreaterThan(0);
      // Blue Marble's open sea is dark navy (brightest channel about 20),
      // not black: a mean channel sum under 3 would mean the colour was
      // dropped.
      expect(waterRgbSum / waterPixels).toBeGreaterThan(10);
    },
    120_000,
  );

  it("has every global map as a 2048x1024 WebP, under the repo's 2 MiB file ceiling", () => {
    for (const s of GLOBE_SOURCES.filter((u) => u.kind === "equirect")) {
      const file = onDisk(s.path);
      const info = imageInfo(readFileSync(file));
      expect(info?.type, s.id).toBe("webp");
      expect(info?.width, s.id).toBe(2048);
      expect(info?.height, s.id).toBe(1024);
      expect(statSync(file).size, s.id).toBeLessThan(2 * 1024 * 1024);
    }
  });
});

/** A level's tile files, sorted (x then y, as written by the fetch script). */
function levelFiles(z: number): string[] {
  const tiles = globeSource("blue-marble");
  const levelDir = onDisk(tiles.path.split("{z}")[0] + String(z));
  const byNumber = (a: string, b: string) => parseInt(a, 10) - parseInt(b, 10);
  return readdirSync(levelDir)
    .sort(byNumber)
    .flatMap((x) =>
      readdirSync(join(levelDir, x))
        .sort(byNumber)
        .map((y) => join(levelDir, x, y)),
    );
}

/**
 * One tile's header check: a `.webp` file holding a 256x256 WebP whose
 * RIFF length matches its size on disk (a truncated file fails), and
 * whether it has alpha.
 */
function checkTile(file: string): { problem: string | null; alpha: boolean } {
  const head = headOf(file);
  const info = imageInfo(head);
  const riffBytes = riffLength(head);
  const webp = info?.type === "webp" ? info : null;
  const ok =
    file.endsWith(".webp") &&
    webp !== null &&
    webp.width === 256 &&
    webp.height === 256 &&
    riffBytes === statSync(file).size;
  return {
    problem: ok ? null : `${file}: ${JSON.stringify(info)}, RIFF ${riffBytes}`,
    alpha: webp?.alpha === true,
  };
}

/** A RIFF file's length from its header (the size field plus its 8 bytes). */
const riffLength = (head: Uint8Array): number =>
  head.length < 8
    ? 0
    : new DataView(head.buffer, head.byteOffset, 8).getUint32(4, true) + 8;

/** A file's first 64 bytes (a WebP header fits in 30). */
function headOf(file: string): Uint8Array {
  const fd = openSync(file, "r");
  try {
    const bytes = new Uint8Array(64);
    const n = readSync(fd, bytes, 0, 64, 0);
    return bytes.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/**
 * A tile's water pixels (alpha 0) and the sum of their R, G and B, after
 * checking every alpha is 0 or 255 (throws naming the first that is not).
 */
async function decodeWater(
  file: string,
): Promise<{ pixels: number; rgbSum: number }> {
  const { data, info } = await sharp(file)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4)
    throw new Error(`${file}: ${info.channels} channels`);
  let pixels = 0;
  let rgbSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? -1;
    if (a !== 0 && a !== 255) {
      throw new Error(`${file}: alpha ${a} at pixel ${i / 4}`);
    }
    if (a === 0) {
      pixels += 1;
      rgbSum += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
    }
  }
  return { pixels, rgbSum };
}

/** Every file under `dir`, recursively, with its size in bytes. */
function filesUnder(dir: string): { path: string; bytes: number }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? filesUnder(path)
      : [{ path, bytes: statSync(path).size }];
  });
}

/**
 * The committed assets' budget: 10 MB, decimal, as the owner stated it
 * (round-4 plan 2026-09-28-2105 DEC-GL4-9, 2026-09-28: level 5 of the
 * imagery committed as WebP; 8,847,906 bytes with levels 0-5 at WebP
 * quality 75, DEC-GL4-3/10). It was 4.5 MB (round-2 plan 2026-09-26-2055
 * M3c, DEC-FB2-4: the z4 level). Every page load of the globe may fetch
 * from here and the deploy copies it whole, so growth past it is a decision, not a
 * side effect of a re-fetch. It measures the WORKING TREE's assets folder,
 * not what is committed: an untracked file there counts, which errs on the
 * side of the budget.
 */
const ASSETS_BUDGET_BYTES = 10_000_000;

describe("the committed assets' total size", () => {
  it("includes the level-5 pyramid (DEC-GL4-3) and stays within 10 MB (DEC-GL4-9)", () => {
    expect(globeSource("blue-marble").levels).toBe(6);
    const files = filesUnder(ASSETS);
    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(ASSETS_BUDGET_BYTES);
  });
});
