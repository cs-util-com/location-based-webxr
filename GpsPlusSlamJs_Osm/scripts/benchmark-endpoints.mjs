#!/usr/bin/env node
/**
 * Times the public Overpass instances on one identical res-7 tile.
 *
 * Run on demand only — it hits donated public infrastructure:
 *
 *   node scripts/benchmark-endpoints.mjs
 *   node scripts/benchmark-endpoints.mjs --lat 50.9413 --lng 6.9583
 *   node scripts/benchmark-endpoints.mjs --res 8 --host lz4   # one host, one res
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST, same rule as `capture-fixtures.mjs`: a
 * test that touches the network is a test that fails when a public server is
 * down, and this one additionally puts ~28 MB and ~18 s of server CPU on a
 * volunteer-run instance. It must never run in a gate.
 *
 * ONE QUERY PER HOST, SERIALISED, ONE PASS. That is an ethical constraint, not
 * a technical one — these instances' usage policies explicitly ask callers not
 * to generate this load. The statistical consequence is real and must survive
 * into the results doc: **a single sample cannot support "host A is faster than
 * host B"**. It supports weaker claims that are still worth having — reachable
 * or not, answers this query form or 504s on it, same order of magnitude or an
 * order out.
 *
 * FIRST BYTE IS REPORTED SEPARATELY FROM LAST BYTE on purpose. Overpass spends
 * most of a large query executing server-side before it streams anything, so
 * the two numbers separate a slow query planner from a slow pipe — different
 * problems with different remedies.
 *
 * The narrative plan and results live in the docs repo
 * (`GpsPlusSlamJs_Docs/docs/2026-07-28-2336-overpass-endpoint-benchmark-plan.md`
 * and its `-results.md` sibling). Only the machine-readable JSON stays here,
 * next to the script that writes it.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latLngToCell, cellToBoundary } from "h3-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Matches `FETCH_RES` in `src/spatial/resolutions.ts`.
 *
 * Overridable with `--res`. **And the answer that override produced is the
 * opposite of the obvious one**, so it is recorded here: shrinking the bbox
 * barely shrinks the payload. Measured on `lz4`, 2026-07-29, same centre:
 *
 * - res 7 (4.55 km² hexagon) — 68.0 MB
 * - res 8 (0.65 km²) — 42.7 MB
 * - res 9 (0.093 km²) — 38.7 MB
 *
 * **49x less ground for 1.8x less data.** The cause is `out geom`, which prints
 * the FULL geometry of every element that INTERSECTS the bbox — the OSM wiki is
 * explicit that "constituent ways or relations may extend beyond these bounds".
 * A handful of city-scale ways (rivers, landuse multipolygons, boundaries,
 * power lines) dominate the bytes, and every bbox in Cologne intersects them
 * whatever its size.
 *
 * So `FETCH_RES` is NOT the lever on payload it looks like. The lever the wiki
 * points at is `out geom(south,west,north,east)`, which emits only coordinates
 * inside the box — see the results doc for why that is not a drop-in change.
 */
const FETCH_RES = 7;

/** Cologne — the demo's default area, and where the corpus was captured. */
const DEFAULT_CENTRE = { lat: 50.9413, lng: 6.9583 };

/**
 * Global-coverage, free, no-API-key instances, from the OSM wiki's Overpass API
 * page (checked 2026-07-28).
 *
 * Regional instances (Switzerland, Britain and Ireland, Virginia, Ethiopia) are
 * excluded deliberately: they hold regional extracts, so a Cologne tile would
 * measure "does not have this data" rather than speed — the kind of comparison
 * that produces a confident wrong conclusion. Geofabrik (payment) and
 * FairwayMapper (API key) are excluded as unusable for an unattended default.
 */
const ENDPOINTS = [
  {
    url: "https://overpass-api.de/api/interpreter",
    note: "FOSSGIS main",
  },
  {
    url: "https://lz4.overpass-api.de/api/interpreter",
    note: "FOSSGIS backend — included to CONFIRM it shares the main quota, not as a competitor",
  },
  {
    url: "https://z.overpass-api.de/api/interpreter",
    note: "FOSSGIS backend — likewise",
  },
  {
    url: "https://overpass.private.coffee/api/interpreter",
    note: "Private.coffee — the canonical name the wiki now lists",
  },
  {
    url: "https://overpass.kumi.systems/api/interpreter",
    note: "legacy alias this package hardcodes; the wiki says it became private.coffee",
  },
  {
    url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    note: "VK Maps",
  },
];

/** Seconds to wait between hosts. Politeness, not correctness. */
const GAP_SECONDS = 5;

/**
 * The key list and query form, kept identical to `capture-fixtures.mjs`.
 *
 * Read from that file rather than duplicated a third time: the package has
 * already paid once for a divergent copy of this list, and
 * `capture-script-query.test.ts` pins the capture script's copy to
 * `OVERPASS_SELECT_KEYS`. Reading it here inherits that guarantee instead of
 * creating a new thing to keep in sync.
 */
function selectKeysFromCaptureScript() {
  const source = readFileSync(join(__dirname, "capture-fixtures.mjs"), "utf8");
  const block = /const SELECT_KEYS = \[([\s\S]*?)\];/.exec(source);
  if (block?.[1] === undefined) {
    throw new Error(
      "Could not read SELECT_KEYS from capture-fixtures.mjs — has it been restructured?",
    );
  }
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function buildQuery(bbox, keys) {
  return [
    `[out:json][timeout:180][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];`,
    `(${keys.map((key) => `nwr["${key}"];`).join("")});`,
    "out geom;",
  ].join("\n");
}

function bboxOfCell(cell) {
  const boundary = cellToBoundary(cell);
  const lats = boundary.map(([lat]) => lat);
  const lngs = boundary.map(([, lng]) => lng);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  };
}

/**
 * Drains the body, recording first-byte time and size into `progress`.
 *
 * Streamed rather than `.text()` because first-byte is not observable
 * otherwise. `progress` is mutated rather than returned so a failure PART WAY
 * through a 68 MB body still reports how far it got — "died after 40 MB" and
 * "never connected" are different diagnoses.
 */
async function readBody(response, started, progress) {
  const reader = response.body?.getReader();
  if (reader === undefined) return;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (progress.firstByteMs === null) {
      progress.firstByteMs = performance.now() - started;
    }
    progress.bytes += value.byteLength;
  }
}

/** Times one endpoint. Never throws — a dead host is a RESULT, not an error. */
async function timeEndpoint(endpoint, query) {
  const started = performance.now();
  const progress = { firstByteMs: null, bytes: 0 };
  const base = { url: endpoint.url, note: endpoint.note };
  const finish = (extra) => ({
    ...base,
    ...extra,
    firstByteMs:
      progress.firstByteMs === null ? null : Math.round(progress.firstByteMs),
    totalMs: Math.round(performance.now() - started),
    bytes: progress.bytes,
  });

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      headers: {
        // Every instance asks for an identifying User-Agent; the FOSSGIS policy
        // makes it a requirement rather than a courtesy.
        "User-Agent":
          "gps-plus-slam-osm endpoint benchmark (github.com/cs-util-com)",
      },
    });
    const retryAfter = response.headers.get("retry-after");
    await readBody(response, started, progress);
    return finish({
      ok: response.ok,
      status: `${response.status} ${response.statusText}`,
      ...(retryAfter === null ? {} : { retryAfter }),
    });
  } catch (error) {
    return finish({
      ok: false,
      status: `network error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : fallback;
}

async function main() {
  const centre = {
    lat: arg("lat", DEFAULT_CENTRE.lat),
    lng: arg("lng", DEFAULT_CENTRE.lng),
  };
  const res = arg("res", FETCH_RES);
  // `--host <substring>` narrows the sweep to one instance. Measuring a
  // RESOLUTION question across six donated servers would be six times the load
  // for an answer that only needs one of them held constant.
  const hostFilter = process.argv.includes("--host")
    ? process.argv[process.argv.indexOf("--host") + 1]
    : undefined;
  const hosts =
    hostFilter === undefined
      ? ENDPOINTS
      : ENDPOINTS.filter((e) => e.url.includes(hostFilter));
  const cell = latLngToCell(centre.lat, centre.lng, res);
  const bbox = bboxOfCell(cell);
  const keys = selectKeysFromCaptureScript();
  const query = buildQuery(bbox, keys);

  console.log(
    `res-${res} tile ${cell} around ${centre.lat}, ${centre.lng}`,
  );
  console.log(
    `${keys.length} keys, union form, one query per host, serialised`,
  );
  console.log(`${ENDPOINTS.length} hosts, ${GAP_SECONDS}s gap between them\n`);

  const results = [];
  for (const [index, endpoint] of hosts.entries()) {
    process.stdout.write(`${endpoint.url} … `);
    const result = await timeEndpoint(endpoint, query);
    results.push(result);
    const mb = (result.bytes / 1_000_000).toFixed(2);
    console.log(
      `${result.status} · first byte ${result.firstByteMs ?? "—"} ms · total ${result.totalMs} ms · ${mb} MB`,
    );
    if (index < hosts.length - 1) {
      await new Promise((r) => setTimeout(r, GAP_SECONDS * 1000));
    }
  }

  const out = {
    measuredAt: new Date().toISOString(),
    cell,
    res,
    centre,
    bbox,
    keyCount: keys.length,
    // Recorded so a reader of the JSON can tell WHAT was asked, not just how
    // long it took — a timing without its query is not reproducible.
    query,
    results,
  };
  const outDir = join(__dirname, "..", "docs");
  mkdirSync(outDir, { recursive: true });
  // Per-resolution filename, so a resolution sweep does not overwrite the host
  // sweep it is meant to be compared against.
  const outPath = join(outDir, `overpass-endpoint-benchmark-res${res}.json`);
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${outPath}`);
}

await main();
