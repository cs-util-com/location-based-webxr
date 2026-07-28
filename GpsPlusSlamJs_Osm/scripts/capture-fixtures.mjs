#!/usr/bin/env node
/**
 * Captures real Overpass responses as checked-in test fixtures.
 *
 * Run on demand only — it hits donated public infrastructure:
 *
 *   pnpm run capture:fixtures            # all fixtures
 *   pnpm run capture:fixtures beach      # one, by slug
 *
 * Each capture writes `src/testdata/<slug>.json`, containing the raw payload
 * plus the provenance the plan requires (bbox, query, capture date, the exact
 * command to regenerate) and the S3DB census that gates the plan's §8.
 *
 * Deliberately a plain `.mjs` script rather than a test: fixtures are captured
 * a handful of times in the package's life, and a test that touches the network
 * is a test that fails when a public server is down.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latLngToCell, cellToBoundary } from "h3-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "testdata");

/**
 * Fixtures are captured at res 10, NOT at the `FETCH_RES` (res-7) fetch
 * resolution — and the original reason for that is WITHDRAWN.
 *
 * The 2026-07-28 morning session concluded that public instances were saturated
 * and full-size tiles uncapturable. That was an artefact of the key REGEX this
 * script used to build; a union of exact-key statements over the same 32 keys
 * returns a whole res-7 tile (21,847 elements, 28.31 MB) in 18.2 s. See
 * `GpsPlusSlamJs_Docs/docs/2026-07-28-1040-overpass-remeasurement-findings.md`.
 *
 * So a full-size capture is possible. What stops it now is repo weight: a res-7
 * tile is ~28 MB and the merge tests want a second overlapping one, against a
 * corpus that is 4.8 MB today. That decision is open (plan §10).
 *
 * These four stay the everyday corpus regardless: small, fast in CI, and REAL
 * OSM data with real tag distributions and real multipolygons, which is what
 * fixtures are for.
 */
const FETCH_RES = 10;
const USER_AGENT =
  "gps-plus-slam-osm-fixture-capture/0.1 (+https://github.com/cs-util-com/location-based-webxr)";

/**
 * Independently operated instance first. During development the main
 * overpass-api.de returned 504 while this one answered — which is the whole
 * argument for a pool, and the reason the capture script does not depend on a
 * single host.
 */
const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

/** The four locations the plan asks for, each chosen for what it exercises. */
const FIXTURES = [
  {
    slug: "park",
    label: "Cologne Volksgarten — a park with mixed landuse",
    lat: 50.9231,
    lng: 6.9445,
  },
  {
    slug: "street-corner",
    label: "Cologne Neumarkt — urban corner: roads, footways, crossings",
    lat: 50.9355,
    lng: 6.9459,
  },
  {
    slug: "beach",
    label: "Sylt Westerland beach — the surface=sand + natural=beach oracle",
    lat: 54.9079,
    lng: 8.2946,
  },
  {
    slug: "building-block",
    label: "Cologne Altstadt — dense block, multipolygons, building:part",
    lat: 50.9384,
    lng: 6.9598,
  },
];

function bboxOf(cell) {
  const boundary = cellToBoundary(cell);
  let south = Infinity,
    north = -Infinity,
    west = Infinity,
    east = -Infinity;
  for (const [lat, lng] of boundary) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return { south, west, north, east };
}

/**
 * Keys that select an element.
 *
 * MUST equal `OVERPASS_SELECT_KEYS` in `src/source/overpass-query.ts`. This is
 * a plain `.mjs` script and cannot import the TypeScript source, so the list is
 * duplicated — and `src/source/capture-script-query.test.ts` reads this file as
 * text and fails if the two ever disagree. A capture taken with a different
 * filter than production ships is a fixture that proves nothing about
 * production.
 *
 * Filtering by key is a **server-side cost reduction only**: `out geom` still
 * returns ALL tags of every matched element, so the long tail the scoring model
 * needs (`wheelchair=yes` on a matched building, `smoothness=good` on a matched
 * highway) arrives intact. What a key filter loses is only elements carrying
 * NONE of these keys — measured across all four fixtures, zero of those would
 * have scored anything but the multiplicative identity.
 */
const SELECT_KEYS = [
  "highway",
  "surface",
  "landuse",
  "natural",
  "leisure",
  "amenity",
  "barrier",
  "access",
  "wheelchair",
  "water",
  "waterway",
  "man_made",
  "tourism",
  "sport",
  "playground",
  "building",
  "building:part",
  "building:levels",
  "height",
  "min_height",
  "roof:shape",
  "roof:levels",
  "layer",
  "historic",
  "place",
  "power",
  "entrance",
  "railway",
  "service",
  "foot",
  "crossing",
  "sidewalk",
];

/**
 * The shipped query form: a UNION OF EXACT-KEY STATEMENTS, never a key regex.
 *
 * `nwr[~"^(k1|k2|…)$"~"."]` makes Overpass evaluate a regex against every key of
 * every element in the bbox, and the cost grows with the alternation count — 3
 * keys fine, 32 keys a 504. Exact-key statements use the key index instead.
 * Measured 2026-07-28 on the same res-7 tile: union 200 OK in 18.2 s, regex 504
 * in 8 s. This one query form cost the project a day of believing public
 * instances were saturated.
 *
 * ONE union block with ONE trailing `out`, so each element is returned exactly
 * once — a union is a set. The belief that a union duplicates elements comes
 * from running the statements as separate queries.
 *
 * Mirrors `buildTileQuery` in `src/source/overpass-query.ts`; the key list is
 * pinned to production's by `src/source/capture-script-query.test.ts`.
 */
function buildQuery(bbox) {
  return [
    `[out:json][timeout:180][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];`,
    `(${SELECT_KEYS.map((key) => `nwr["${key}"];`).join("")});`,
    "out geom;",
  ].join("\n");
}

/**
 * The S3DB census the plan makes a gate on §8: if `roof:shape` and `height` are
 * near zero in the areas we actually target, the entire roof-geometry pipeline
 * is dead weight and flat extrusions are indistinguishable at walking distance.
 */
function s3dbCensus(elements) {
  let buildings = 0,
    parts = 0,
    pitchedRoofs = 0,
    withHeight = 0;
  for (const el of elements) {
    const tags = el.tags ?? {};
    if (tags["building"] !== undefined) buildings++;
    if (tags["building:part"] !== undefined) parts++;
    const roof = tags["roof:shape"];
    if (roof !== undefined && roof !== "flat") pitchedRoofs++;
    if (tags["height"] !== undefined) withHeight++;
  }
  return { buildings, parts, pitchedRoofs, withHeight };
}

async function post(endpoint, query) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      Referer: USER_AGENT,
    },
    body: new URLSearchParams({ data: query }).toString(),
  });
  if (!response.ok) {
    throw new Error(`${endpoint} -> ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return { payload: JSON.parse(text), bytes: text.length };
}

async function capture(spec) {
  const tile = latLngToCell(spec.lat, spec.lng, FETCH_RES);
  const bbox = bboxOf(tile);
  const query = buildQuery(bbox);

  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      process.stdout.write(`  ${spec.slug}: ${endpoint} ... `);
      const { payload, bytes } = await post(endpoint, query);
      const elements = payload.elements ?? [];
      const census = s3dbCensus(elements);
      console.log(
        `${elements.length} elements, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
      );

      const fixture = {
        name: spec.slug,
        label: spec.label,
        tile,
        centre: { lat: spec.lat, lng: spec.lng },
        bbox,
        query,
        capturedAt: Date.now(),
        capturedFrom: endpoint,
        rawBytes: bytes,
        elementCount: elements.length,
        s3dbCensus: census,
        regenerateWith: `pnpm run capture:fixtures ${spec.slug}`,
        payload,
      };
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(
        join(OUT_DIR, `${spec.slug}.json`),
        JSON.stringify(fixture, null, 1),
      );
      return { ...census, slug: spec.slug, bytes, elements: elements.length };
    } catch (error) {
      console.log(`FAILED (${error.message})`);
      lastError = error;
    }
  }
  throw lastError;
}

const wanted = process.argv.slice(2);
const selected =
  wanted.length > 0
    ? FIXTURES.filter((f) => wanted.includes(f.slug))
    : FIXTURES;

if (selected.length === 0) {
  console.error(
    `No fixture matched ${wanted.join(", ")}. Known: ${FIXTURES.map((f) => f.slug).join(", ")}`,
  );
  process.exit(1);
}

console.log(`Capturing ${selected.length} fixture(s) from Overpass...`);
const summary = [];
const failed = [];
for (const spec of selected) {
  // Sequential, with a pause between captures: these are heavy whole-tile
  // queries against donated infrastructure, and the informal courtesy limit is
  // one at a time.
  //
  // A failure does NOT abort the run. Public instances 504 unpredictably under
  // load (measured 2026-07-28), so an early exit would throw away fixtures that
  // were already captured successfully and force the whole set to be re-fetched
  // — the opposite of being a good citizen.
  try {
    summary.push(await capture(spec));
  } catch (error) {
    failed.push({ slug: spec.slug, message: error.message });
  }
  await new Promise((r) => setTimeout(r, 5000));
}

if (failed.length > 0) {
  console.log(
    "\nFAILED (re-run just these later; public instances 504 under load):",
  );
  for (const f of failed) {
    console.log(`  ${f.slug.padEnd(16)} ${f.message}`);
  }
  console.log(
    `  retry with: pnpm run capture:fixtures ${failed.map((f) => f.slug).join(" ")}`,
  );
}

console.log("\nPayload sizes (plan §5.1 expects low single-digit MB):");
for (const s of summary) {
  console.log(
    `  ${s.slug.padEnd(16)} ${(s.bytes / 1024 / 1024).toFixed(2)} MB  ${String(s.elements).padStart(6)} elements`,
  );
}
console.log("\nS3DB census (plan Iteration 2 — gates §8):");
console.log("  slug             buildings  parts  pitchedRoofs  withHeight");
for (const s of summary) {
  console.log(
    `  ${s.slug.padEnd(16)} ${String(s.buildings).padStart(9)} ${String(s.parts).padStart(6)} ${String(s.pitchedRoofs).padStart(13)} ${String(s.withHeight).padStart(11)}`,
  );
}
