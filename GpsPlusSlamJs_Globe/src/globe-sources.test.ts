/**
 * Why this test matters: the registry is the only way imagery reaches the
 * globe, so every source must carry a credit (NASA's terms ask for the
 * acknowledgement; a source without one would load uncredited), and the
 * paths must match what the fetch script wrote, or the page asks for files
 * that do not exist. The committed pyramid is checked for completeness here
 * too: 2 x 4^z tiles per level, each a 256x256 WebP (round-4 plan
 * 2026-09-28-2105 DEC-GL4-3/10) whose alpha is the water mask where the tile
 * has water (DEC-GL4-6), and the global maps as WebPs of their stated size,
 * read by their headers: the clouds as a 1,024 x 512 preview and NASA's
 * full 8,192 x 4,096 map in four pieces (round-3 plan 2026-10-08-2345
 * §18), whose date-line seam the fetch script blended (§16). And the
 * committed total stays inside its budget: nothing else guards it (the
 * repo checks single files only), and each level of the pyramid
 * quadruples the tile count.
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

import { columnJump, typicalColumnJump } from "./cloud-seam.js";
import { imageInfo } from "./image-header.js";
import {
  GIBS_ACKNOWLEDGEMENT,
  GLOBE_SOURCES,
  globeMapPieces,
  globeSource,
  type GlobeSource,
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

  // Why (round-3 plan §18): the globe joins the pieces into one texture by
  // these placements, so a piece placed in the wrong quadrant would draw
  // every cloud in the wrong place; row 0 is the north, as in the image.
  it("places a cut map's pieces row by row from the north, and refuses an uneven grid", () => {
    const clouds = globeSource("clouds");
    const piece = (column: number, row: number) => ({
      path: `/globe-assets/equirect/clouds-8192-${column}-${row}.webp`,
      column,
      row,
      left: column * 4096,
      top: row * 2048,
      width: 4096,
      height: 2048,
    });
    expect(globeMapPieces(clouds)).toEqual([
      piece(0, 0),
      piece(1, 0),
      piece(0, 1),
      piece(1, 1),
    ]);
    expect(globeMapPieces(globeSource("black-marble"))).toEqual([]);
    const uneven: GlobeSource = {
      ...clouds,
      pieces: { ...clouds.pieces!, columns: 3 },
    };
    expect(() => globeMapPieces(uneven)).toThrow(RangeError);
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

  // The owner saw the 2048 clouds as pixels at 3,000 km (round-3 plan
  // 2026-10-08-2345 M1, §18): the clouds' own path is now their preview
  // (the full map is in pieces, below); the night stays.
  const MAP_SIZE: Record<string, readonly [number, number]> = {
    "black-marble": [2048, 1024],
    clouds: [1024, 512],
  };
  it("has every global map as a WebP of its size, under the repo's 2 MiB file ceiling", () => {
    const maps = GLOBE_SOURCES.filter((u) => u.kind === "equirect");
    expect(maps.map((m) => m.id).sort()).toEqual(Object.keys(MAP_SIZE).sort());
    for (const s of maps) {
      const file = onDisk(s.path);
      const info = imageInfo(readFileSync(file));
      expect(info?.type, s.id).toBe("webp");
      expect([info?.width, info?.height], s.id).toEqual(MAP_SIZE[s.id]);
      expect(statSync(file).size, s.id).toBeLessThan(2 * 1024 * 1024);
    }
  });

  // Why (DEC-R3-13/14): the sharp map the owner chose is NASA's own
  // 8,192 x 4,096, at WebP quality 75, cut into four pieces so each stays
  // under the repo's 2 MiB file ceiling (measured about 1 MB each). A
  // piece of the wrong size would leave a hole or an overlap in the
  // joined texture; and the old 4,096 map must be gone, not shipped
  // beside it (it would count against the budget for nothing).
  it("has the clouds' full map as four 4096 x 2048 WebP pieces, each under the ceiling, and no 4096 map", () => {
    const pieces = globeMapPieces(globeSource("clouds"));
    expect(pieces).toHaveLength(4);
    for (const piece of pieces) {
      const bytes = readFileSync(onDisk(piece.path));
      expect(imageInfo(bytes), piece.path).toMatchObject({
        type: "webp",
        width: 4096,
        height: 2048,
        alpha: false,
      });
      expect(riffLength(bytes), piece.path).toBe(bytes.length);
      expect(bytes.length, piece.path).toBeLessThan(2 * 1024 * 1024);
    }
    const clouds = readdirSync(join(ASSETS, "equirect"))
      .filter((f) => f.startsWith("clouds"))
      .sort();
    expect(clouds).toEqual([
      "clouds-1024.webp",
      "clouds-8192-0-0.webp",
      "clouds-8192-0-1.webp",
      "clouds-8192-1-0.webp",
      "clouds-8192-1-1.webp",
    ]);
  });

  // Why (round-3 plan §16): NASA's map does not wrap, and the globe drew a
  // line down the date line. The fetch script eases both edges to their
  // per-row average (`cloud-seam.ts`); here the COMMITTED pieces, decoded
  // and joined, must wrap no worse than a typical neighbouring pair of
  // columns: the wrap pair's mean and largest jump at most the median
  // pair's. Measured 2026-10-09: the source's wrap 11.0 mean and 197
  // largest against 6.4 and 100 typical (so this fails on the raw map);
  // the decoded pieces about 4.2 and 28 against 5.9 and 100.
  // The joins between the pieces (0 degrees, the equator) must sit inside
  // the map's own range of pairs (its 99th percentile): a piece in the
  // wrong place reads like the raw seam (11 and more) and fails. Each
  // piece is encoded alone, so a join has an encoder edge on both sides:
  // the 0-degree join reads 7.2 (the source 5.8 there; WebP's own 16-pixel
  // block edges read 6.7 on average against 5.8 elsewhere), under the
  // 99th percentile's 8.7.
  // The preview, 8 source columns to a pixel, is held to the median's
  // largest jump and the 90th percentile's mean (measured 12.2 and 77
  // against 12.9 and 91; the raw map's preview 15.7 and 155).
  it("wraps at the date line, and joins its pieces, no worse than a typical pair of columns", async () => {
    const clouds = globeSource("clouds");
    const cut = clouds.pieces!;
    const { width, height } = cut;
    const full = new Uint8Array(width * height);
    for (const piece of globeMapPieces(clouds)) {
      const { data, info } = await sharp(onDisk(piece.path))
        .extractChannel(0)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([info.width, info.height, info.channels]).toEqual([
        piece.width,
        piece.height,
        1,
      ]);
      for (let y = 0; y < piece.height; y++) {
        full.set(
          data.subarray(y * piece.width, (y + 1) * piece.width),
          (piece.top + y) * width + piece.left,
        );
      }
    }
    const typical = typicalColumnJump(full, width, height, 64);
    const wrap = columnJump(full, width, height, width - 1);
    expect(wrap.mean).toBeLessThanOrEqual(typical.mean);
    expect(wrap.max).toBeLessThanOrEqual(typical.max);
    const range = typicalColumnJump(full, width, height, 64, 0.99);
    // No pair within 40 columns of the date line outside the map's range
    // either (the blend shifts its band; a wrong sign would steepen it).
    for (let k = -40; k < 40; k++) {
      const left = (k + width) % width;
      expect(
        columnJump(full, width, height, left).mean,
        `column ${left}`,
      ).toBeLessThanOrEqual(range.mean);
    }
    const meridian = columnJump(full, width, height, width / 2 - 1);
    expect(meridian.mean).toBeLessThanOrEqual(range.mean);
    expect(meridian.max).toBeLessThanOrEqual(range.max);
    // The equator by rows: the mean jump of each pair of rows.
    const rowMeans: number[] = [];
    for (let y = 0; y < height - 1; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        sum += Math.abs(full[y * width + x]! - full[(y + 1) * width + x]!);
      }
      rowMeans.push(sum / width);
    }
    const equator = rowMeans[height / 2 - 1]!;
    const rowRange = [...rowMeans.slice(64, -64)].sort((a, b) => a - b)[
      Math.floor(0.99 * (rowMeans.length - 128))
    ]!;
    expect(equator).toBeLessThanOrEqual(rowRange);
    // The blend's band, row to row (M1b review, item 6d): each row of the
    // band moves by its own offset, so a streaky blend shows as larger
    // jumps between neighbouring ROWS inside the band (16 columns from
    // each edge, the script's SEAM_COLUMNS) than beside it. Measured
    // 2026-10-11: the band 9.99 against the next 32 columns each side 9.65
    // (x1.036; the source x1.024, its band 10.60, so the committed band is
    // no rougher than the source's); the whole offset over the band with
    // no ease (a one-time control) x1.088.
    const rowJumps = (columns: number[]) => {
      let sum = 0;
      for (const x of columns) {
        for (let y = 0; y < height - 1; y++) {
          sum += Math.abs(full[(y + 1) * width + x]! - full[y * width + x]!);
        }
      }
      return sum / (columns.length * (height - 1));
    };
    const span = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => from + i);
    const band = rowJumps([...span(0, 16), ...span(width - 16, 16)]);
    const beside = rowJumps([...span(16, 32), ...span(width - 48, 32)]);
    expect(band / beside).toBeLessThanOrEqual(1.06);

    const { data: preview, info } = await sharp(onDisk(clouds.path))
      .extractChannel(0)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const p90 = typicalColumnJump(preview, info.width, info.height, 16, 0.9);
    const median = typicalColumnJump(preview, info.width, info.height, 16);
    const previewWrap = columnJump(
      preview,
      info.width,
      info.height,
      info.width - 1,
    );
    expect(previewWrap.mean).toBeLessThanOrEqual(p90.mean);
    expect(previewWrap.max).toBeLessThanOrEqual(median.max);
  }, 60_000);
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
 * The committed assets' budget: 13 MB, decimal, as the owner stated it
 * (round-3 plan 2026-10-08-2345 DEC-R3-13, 2026-10-09: NASA's 8,192 x 4,096
 * cloud map in four pieces at WebP quality 75 plus its 1,024 preview, about
 * 12.6 MB in all, the pieces measured 3.98 MB). It was 10 MB
 * (round-4 plan 2026-09-28-2105 DEC-GL4-9, 2026-09-28: level 5 of the
 * imagery committed as WebP; 8,847,906 bytes with levels 0-5 at WebP
 * quality 75, DEC-GL4-3/10). It was 4.5 MB (round-2 plan 2026-09-26-2055
 * M3c, DEC-FB2-4: the z4 level). Every page load of the globe may fetch
 * from here and the deploy copies it whole, so growth past it is a decision, not a
 * side effect of a re-fetch. It measures the WORKING TREE's assets folder,
 * not what is committed: an untracked file there counts, which errs on the
 * side of the budget.
 */
const ASSETS_BUDGET_BYTES = 13_000_000;

describe("the committed assets' total size", () => {
  it("includes the level-5 pyramid (DEC-GL4-3) and stays within 13 MB (DEC-R3-13)", () => {
    expect(globeSource("blue-marble").levels).toBe(6);
    const files = filesUnder(ASSETS);
    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(ASSETS_BUDGET_BYTES);
  });
});
