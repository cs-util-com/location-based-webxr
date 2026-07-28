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
 * Fixtures are captured at res 10, NOT at the res-8 fetch resolution.
 *
 * Measured 2026-07-28 against public instances (see the summary doc): a res-8
 * unfiltered query 504s, and even a curated-key res-8 query takes ~96 s when it
 * succeeds at all. Response time turned out to be dominated by SERVER QUEUEING
 * rather than by our query — a res-10 tile returning 60 KB still took 75 s — so
 * shrinking the capture is the only way to get real data reliably.
 *
 * A res-10 tile (0.015 km2) is small, but it is REAL OSM data with real tag
 * distributions and real multipolygons, which is what the fixtures are for.
 * Capturing full res-8 tiles needs a self-hosted instance; that is a follow-up.
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
 * Keys that select an element. Matches the package's default query filter.
 *
 * NOT the plan's `nwr[~"."~"."]`. That regex-matches every key AND every value
 * of every element in the bbox, and measured on 2026-07-28 it 504s at every
 * tile size tried. Filtering by key is a **server-side cost reduction only**:
 * `out geom` still returns ALL tags of every matched element, so the long tail
 * the scoring model needs (`wheelchair=yes` on a matched building,
 * `smoothness=good` on a matched highway) arrives intact. What a key filter
 * loses is only elements carrying NONE of these keys.
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

function buildQuery(bbox) {
  return [
    `[out:json][timeout:180][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];`,
    `nwr[~"^(${SELECT_KEYS.join("|")})$"~"."];`,
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
