// Sums the real Terrarium (AWS Open Data) sizes of the height tiles one
// descent asked for: the globe-terrain data smoke writes the request lists
// to test-results/globe-terrain/requests-<heights>-et<n>.json; this sends
// one HEAD per distinct tile and adds up content-length per level.
// Run from the design system package: node labs/globe-terrain/terrarium-bytes.mjs
// See terrarium-bytes.mjs.md.
import { readdirSync, readFileSync } from "node:fs";

const DIR = "test-results/globe-terrain";
const url = (tile) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${tile}.png`;

/** content-length of one tile, or -1 when it is missing or unreachable. */
async function sizeOf(tile) {
  try {
    const r = await fetch(url(tile), { method: "HEAD" });
    return r.ok ? Number(r.headers.get("content-length")) : -1;
  } catch {
    return -1;
  }
}

const lists = readdirSync(DIR).filter((f) => /^requests-.*\.json$/.test(f));
console.log(
  `Terrarium sizes fetched ${new Date().toISOString().slice(0, 10)} from ${url("{z}/{x}/{y}")}`,
);
for (const file of lists.sort()) {
  const requests = JSON.parse(readFileSync(`${DIR}/${file}`, "utf8"));
  const tiles = [...new Set(requests)];
  let bytes = 0;
  let missing = 0;
  const byLevel = {};
  for (let i = 0; i < tiles.length; i += 16) {
    const batch = tiles.slice(i, i + 16);
    const sizes = await Promise.all(batch.map(sizeOf));
    sizes.forEach((size, k) => {
      if (size < 0) {
        missing += 1;
        return;
      }
      const z = batch[k].split("/")[0];
      bytes += size;
      byLevel[z] = (byLevel[z] ?? 0) + size;
    });
  }
  const kib = Object.fromEntries(
    Object.entries(byLevel).map(([z, b]) => [z, Math.round(b / 1024)]),
  );
  console.log(
    `${file}: ${tiles.length} tiles (${requests.length} requests), ${(bytes / 2 ** 20).toFixed(1)} MiB, missing ${missing}; KiB per level ${JSON.stringify(kib)}`,
  );
}
