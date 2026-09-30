// Fetches the globe's imagery into assets/ (globe plan 2026-09-26-0539
// §7.4; owner decision DEC-PRG-12: about 2 MB of NASA imagery committed;
// round-2 plan 2026-09-26-2055 DEC-FB2-4 added level 4).
// Run by hand, never in CI: `node scripts/fetch-globe-assets.mjs [--force]`.
//
// Round 4 (plan 2026-09-28-2105 DEC-GL4-3/6/9/10): everything is WebP,
// encoded ONCE from a lossless source (GIBS's PNG renders, the cloud map's
// TIFF), never by re-encoding a JPEG. Each imagery tile's ALPHA is the MODIS
// water mask cut to the same tile, kept only where the imagery shows dark
// sea (src/water-alpha.ts; land opaque, water transparent, the colour under
// it kept; the alpha is lossless), so the glint follows the imagery's own
// coastline at the imagery's resolution. GIBS cuts and reprojects every
// tile server-side; every download is checked by its header (type and size)
// and every written file again. The downloads are kept in .fetch-cache/
// (gitignored), so a re-encode needs no network. Idempotent: existing files
// are kept unless --force. Writes assets/PROVENANCE.md with every source,
// its licence and the counts.
//
// @see fetch-globe-assets.mjs.md

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { imageInfo } from "../src/image-header.ts";
import { provenanceFetchedOn } from "../src/provenance-date.ts";
import { pyramidTiles, tileBBox4326, wmsBBox } from "../src/tile-pyramid.ts";
import { WATER_MAX_BRIGHTNESS, waterAlpha } from "../src/water-alpha.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, "..", "assets");
const CACHE = join(here, "..", ".fetch-cache");
const FORCE = process.argv.includes("--force");
const MAX_LEVEL = 4;
const CONCURRENCY = 4;
const RETRIES = 3;
const TILE = 256;
/**
 * The WebP quality of the imagery tiles and the two global maps (round-4
 * plan DEC-GL4-3/10): chosen from a sweep of 55-80 against GIBS's lossless
 * PNG renders, bytes against a difference metric, under the 10 MB budget
 * (DEC-GL4-9); the round-4 results record has the table. The tiles' alpha
 * (the water mask) is always lossless.
 */
const WEBP_QUALITY = 75;
const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

const wms = ({ layer, bbox, width, height, format, time }) =>
  `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}` +
  `&STYLES=&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=${width}&HEIGHT=${height}` +
  `&FORMAT=${encodeURIComponent(format)}${time ? `&TIME=${time}` : ""}`;

/**
 * Every file to write: the Blue Marble pyramid (each tile from two
 * downloads on the same box: the imagery and the water mask) and the two
 * global maps. A `part` is one download, cached under its `cache` name.
 */
const jobs = [
  ...pyramidTiles(MAX_LEVEL).map(({ x, y, z }) => {
    const bbox = wmsBBox(tileBBox4326(x, y, z));
    return {
      file: `blue-marble-4326/${z}/${x}/${y}.webp`,
      source: "blue-marble",
      size: { width: TILE, height: TILE },
      imagery: {
        cache: `blue-marble-4326/${z}/${x}/${y}.png`,
        url: wms({
          layer: "BlueMarble_NextGeneration",
          bbox,
          width: TILE,
          height: TILE,
          format: "image/png",
        }),
        expect: { type: "png", width: TILE, height: TILE },
      },
      water: {
        cache: `water-mask-4326/${z}/${x}/${y}.png`,
        url: wms({
          layer: "MODIS_Water_Mask",
          bbox,
          width: TILE,
          height: TILE,
          format: "image/png",
        }),
        expect: { type: "png", width: TILE, height: TILE },
      },
    };
  }),
  {
    file: "equirect/night-2016-2048.webp",
    source: "black-marble",
    size: { width: 2048, height: 1024 },
    imagery: {
      cache: "equirect/night-2016-2048.png",
      url: wms({
        layer: "VIIRS_Black_Marble",
        bbox: "-90,-180,90,180",
        width: 2048,
        height: 1024,
        format: "image/png",
        time: "2016-01-01",
      }),
      expect: { type: "png", width: 2048, height: 1024 },
    },
  },
  {
    file: "equirect/clouds-2048.webp",
    source: "clouds",
    size: { width: 2048, height: 1024 },
    imagery: {
      cache: "equirect/cloud_combined_2048.tif",
      url: "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.tif",
      // No header reader for TIFF here: checked by decoding (sharp).
      expect: { type: "tiff", width: 2048, height: 1024 },
    },
  },
];

/** The type and size of downloaded bytes: the header, or sharp for TIFF. */
async function infoOf(bytes, expected) {
  if (expected !== "tiff") return imageInfo(bytes);
  try {
    const m = await sharp(bytes).metadata();
    return m.format === "tiff"
      ? { type: "tiff", width: m.width, height: m.height }
      : null;
  } catch {
    return null;
  }
}

async function fetchChecked(part) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(part.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { type, width, height } = part.expect;
      const info = await infoOf(bytes, type);
      if (
        !info ||
        info.type !== type ||
        info.width !== width ||
        info.height !== height
      ) {
        throw new Error(
          `expected ${type} ${width}x${height}, got ${JSON.stringify(info)}`,
        );
      }
      return { bytes, layerTime: response.headers.get("layer-time-actual") };
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error(`${part.cache}: ${lastError?.message ?? lastError}`);
}

/** A download from the cache, or fetched, checked and cached. */
async function cachedPart(part) {
  const path = join(CACHE, ...part.cache.split("/"));
  if (existsSync(path)) {
    const bytes = new Uint8Array(readFileSync(path));
    const info = await infoOf(bytes, part.expect.type);
    if (info?.type === part.expect.type) return { bytes, layerTime: null };
  }
  const got = await fetchChecked(part);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, got.bytes);
  return got;
}

/**
 * A tile's alpha, 255 on land and 0 on water: water where the
 * MODIS_Water_Mask tile says water AND the imagery (`rgb`, raw) shows dark
 * sea (src/water-alpha.ts). A mask colour other than GIBS's water cyan or
 * land fails the run, since a style change would otherwise become a wrong
 * coastline silently.
 */
async function landMask(water, rgb, file) {
  const mask = await sharp(water).ensureAlpha().raw().toBuffer();
  try {
    return Buffer.from(waterAlpha(mask, rgb, TILE * TILE));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

/**
 * One file's WebP, checked by its header. A tile gets the land mask as
 * alpha; `exact` keeps the colour under transparent (water) pixels, which
 * libwebp would otherwise discard. A tile with no water is written without
 * alpha (libwebp drops an opaque alpha), which reads as all land, as it is.
 */
async function encode(job, imagery, rgb, land) {
  // Through raw RGB when there is a mask: sharp applies removeAlpha after
  // joinChannel, which would drop the joined mask again.
  const image = land
    ? sharp(rgb, {
        raw: { width: TILE, height: TILE, channels: 3 },
      }).joinChannel(land, {
        raw: { width: TILE, height: TILE, channels: 1 },
      })
    : sharp(imagery).removeAlpha();
  const bytes = await image
    .webp({ quality: WEBP_QUALITY, alphaQuality: 100, effort: 6, exact: true })
    .toBuffer();
  const info = imageInfo(bytes);
  if (
    info?.type !== "webp" ||
    info.width !== job.size.width ||
    info.height !== job.size.height
  ) {
    throw new Error(`${job.file}: wrote ${JSON.stringify(info)}`);
  }
  const hasWater = land ? land.includes(0) : false;
  if (info.alpha !== hasWater) {
    throw new Error(`${job.file}: alpha ${info.alpha}, water ${hasWater}`);
  }
  return bytes;
}

const layerTimes = {};
let fetched = 0;
let kept = 0;
const queue = [...jobs];
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const path = join(ASSETS, ...job.file.split("/"));
    if (!FORCE && existsSync(path)) {
      kept += 1;
      continue;
    }
    const imagery = await cachedPart(job.imagery);
    if (imagery.layerTime) layerTimes[job.source] = imagery.layerTime;
    const rgb = job.water
      ? await sharp(imagery.bytes)
          .removeAlpha()
          .toColourspace("srgb")
          .raw()
          .toBuffer()
      : null;
    const land = job.water
      ? await landMask((await cachedPart(job.water)).bytes, rgb, job.file)
      : null;
    const bytes = await encode(job, imagery.bytes, rgb, land);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    fetched += 1;
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const bytesOf = (prefix) =>
  jobs
    .filter((j) => j.file.startsWith(prefix))
    .reduce(
      (sum, j) => sum + statSync(join(ASSETS, ...j.file.split("/"))).size,
      0,
    );
const tileCount = jobs.filter((j) => j.source === "blue-marble").length;
const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
const previous = existsSync(join(ASSETS, "PROVENANCE.md"))
  ? readFileSync(join(ASSETS, "PROVENANCE.md"), "utf8")
  : "";
// The first fetch's date, and a later run's that added files (unit-tested).
const fetchedOn = provenanceFetchedOn({
  previous,
  today: new Date().toISOString().slice(0, 10),
  force: FORCE,
  fetched,
});

writeFileSync(
  join(ASSETS, "PROVENANCE.md"),
  `# Globe imagery provenance

Written by \`scripts/fetch-globe-assets.mjs\` (globe plan 2026-09-26-0539
§7.4). Fetched: ${fetchedOn}. All sources are NASA, public domain; the
globe's credits line names each. Every file is WebP at quality
${WEBP_QUALITY}, encoded once from a lossless source (round-4 plan
2026-09-28-2105 DEC-GL4-10).

- \`blue-marble-4326/{z}/{x}/{y}.webp\`: NASA Earth Observatory, Blue Marble:
  Next Generation, via NASA GIBS (WMS \`BlueMarble_NextGeneration\` as PNG,
  EPSG:4326, levels 0-${MAX_LEVEL}, ${tileCount} tiles of 256x256, ${kib(bytesOf("blue-marble-4326/"))}).
  GIBS layer time: ${layerTimes["blue-marble"] ?? "not reported"}. Each tile's
  ALPHA is the MODIS Water Mask (MOD44W), via NASA GIBS (WMS
  \`MODIS_Water_Mask\`, cut to the same tile) where the imagery is also
  darker than ${WATER_MAX_BRIGHTNESS} in every channel, lossless: 255 on land, 0 on
  water, the colour under the water kept; a tile with no water has no alpha.
- \`equirect/night-2016-2048.webp\`: NASA Black Marble (VIIRS), 2016, via
  NASA GIBS (WMS \`VIIRS_Black_Marble\` as PNG, TIME 2016-01-01, 2048x1024,
  ${kib(bytesOf("equirect/night"))}).
- \`equirect/clouds-2048.webp\`: NASA Visible Earth, Blue Marble clouds
  (R. Stöckli), \`cloud_combined_2048.tif\` (2048x1024, ${kib(bytesOf("equirect/clouds"))}).

We acknowledge the use of imagery provided by services from NASA's Global
Imagery Browse Services (GIBS), part of NASA's Earth Science Data and
Information System (ESDIS).
`,
);
console.log(
  `globe assets: ${fetched} written, ${kept} kept, ${jobs.length} total`,
);
