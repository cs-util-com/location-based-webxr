// Fetches the globe's phase-1 imagery into assets/ (globe plan 2026-09-26-0539
// §7.4; owner decision DEC-PRG-12: about 2 MB of NASA imagery committed;
// round-2 plan 2026-09-26-2055 DEC-FB2-4 added level 4, 4.45 MB in all).
// Run by hand, never in CI: `node scripts/fetch-globe-assets.mjs [--force]`.
//
// Pure Node fetch, no image decoding: GIBS cuts and reprojects the tiles
// server-side, and every file is checked by its header (type and size)
// before it is written. Idempotent: existing files are kept unless --force.
// Writes assets/PROVENANCE.md with every source, its licence and the counts.
//
// @see fetch-globe-assets.mjs.md

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { imageInfo } from "../src/image-header.ts";
import { pyramidTiles, tileBBox4326, wmsBBox } from "../src/tile-pyramid.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, "..", "assets");
const FORCE = process.argv.includes("--force");
const MAX_LEVEL = 4;
const CONCURRENCY = 4;
const RETRIES = 3;
const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

const wms = ({ layer, bbox, width, height, format, time }) =>
  `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}` +
  `&STYLES=&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=${width}&HEIGHT=${height}` +
  `&FORMAT=${encodeURIComponent(format)}${time ? `&TIME=${time}` : ""}`;

/** Every file to fetch: the Blue Marble pyramid and the three global maps. */
const jobs = [
  ...pyramidTiles(MAX_LEVEL).map(({ x, y, z }) => ({
    file: `blue-marble-4326/${z}/${x}/${y}.jpg`,
    url: wms({
      layer: "BlueMarble_NextGeneration",
      bbox: wmsBBox(tileBBox4326(x, y, z)),
      width: 256,
      height: 256,
      format: "image/jpeg",
    }),
    expect: { type: "jpeg", width: 256, height: 256 },
    source: "blue-marble",
  })),
  {
    file: "equirect/night-2016-2048.jpg",
    url: wms({
      layer: "VIIRS_Black_Marble",
      bbox: "-90,-180,90,180",
      width: 2048,
      height: 1024,
      format: "image/jpeg",
      time: "2016-01-01",
    }),
    expect: { type: "jpeg", width: 2048, height: 1024 },
    source: "black-marble",
  },
  {
    file: "equirect/water-2048.png",
    url: wms({
      layer: "MODIS_Water_Mask",
      bbox: "-90,-180,90,180",
      width: 2048,
      height: 1024,
      format: "image/png",
    }),
    expect: { type: "png", width: 2048, height: 1024 },
    source: "water-mask",
  },
  {
    file: "equirect/clouds-2048.jpg",
    url: "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg",
    expect: { type: "jpeg", width: 2048, height: 1024 },
    source: "clouds",
  },
];

async function fetchChecked(job) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(job.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const info = imageInfo(bytes);
      const { type, width, height } = job.expect;
      if (!info || info.type !== type || info.width !== width || info.height !== height) {
        throw new Error(`expected ${type} ${width}x${height}, got ${JSON.stringify(info)}`);
      }
      return { bytes, layerTime: response.headers.get("layer-time-actual") };
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error(`${job.file}: ${lastError?.message ?? lastError}`);
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
    const { bytes, layerTime } = await fetchChecked(job);
    if (layerTime) layerTimes[job.source] = layerTime;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    fetched += 1;
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const bytesOf = (prefix) =>
  jobs
    .filter((j) => j.file.startsWith(prefix))
    .reduce((sum, j) => sum + statSync(join(ASSETS, ...j.file.split("/"))).size, 0);
const tileCount = jobs.filter((j) => j.source === "blue-marble").length;
const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
const previous = existsSync(join(ASSETS, "PROVENANCE.md"))
  ? readFileSync(join(ASSETS, "PROVENANCE.md"), "utf8")
  : "";
// The first fetch's date survives a run that only adds files (a new level),
// and that run's date is recorded beside it. The dates are matched as
// dates: the sentence's own full stop once leaked into the capture.
const today = new Date().toISOString().slice(0, 10);
const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const firstFetched =
  FORCE || !previous
    ? today
    : (previous.match(new RegExp(`Fetched: ${DATE}`))?.[1] ?? today);
const lastAdded =
  fetched > 0 && firstFetched !== today
    ? today
    : previous.match(new RegExp(`files added: ${DATE}`))?.[1];
const fetchedOn = lastAdded
  ? `${firstFetched}; files added: ${lastAdded}`
  : firstFetched;

writeFileSync(
  join(ASSETS, "PROVENANCE.md"),
  `# Globe imagery provenance

Written by \`scripts/fetch-globe-assets.mjs\` (globe plan 2026-09-26-0539
§7.4). Fetched: ${fetchedOn}. All sources are NASA, public domain; the
globe's credits line names each.

- \`blue-marble-4326/{z}/{x}/{y}.jpg\`: NASA Earth Observatory, Blue Marble:
  Next Generation, via NASA GIBS (WMS \`BlueMarble_NextGeneration\`,
  EPSG:4326, levels 0-${MAX_LEVEL}, ${tileCount} tiles of 256x256, ${kib(bytesOf("blue-marble-4326/"))}).
  GIBS layer time: ${layerTimes["blue-marble"] ?? "not reported"}.
- \`equirect/night-2016-2048.jpg\`: NASA Black Marble (VIIRS), 2016, via
  NASA GIBS (WMS \`VIIRS_Black_Marble\`, TIME 2016-01-01, 2048x1024,
  ${kib(bytesOf("equirect/night"))}).
- \`equirect/water-2048.png\`: MODIS Water Mask (MOD44W), via NASA GIBS
  (WMS \`MODIS_Water_Mask\`, 2048x1024, ${kib(bytesOf("equirect/water"))}; water is cyan,
  land black: the shader reads the green channel).
- \`equirect/clouds-2048.jpg\`: NASA Visible Earth, Blue Marble clouds
  (R. Stöckli), \`cloud_combined_2048.jpg\` (2048x1024, ${kib(bytesOf("equirect/clouds"))}).

We acknowledge the use of imagery provided by services from NASA's Global
Imagery Browse Services (GIBS), part of NASA's Earth Science Data and
Information System (ESDIS).
`,
);
console.log(`globe assets: ${fetched} fetched, ${kept} kept, ${jobs.length} total`);
