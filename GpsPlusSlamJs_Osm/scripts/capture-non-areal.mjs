#!/usr/bin/env node
/**
 * Captures the relations `areal-only` would DROP, for one site.
 *
 *   node scripts/capture-non-areal.mjs cologne-cathedral
 *
 * WHY THIS EXISTS, and it is the only way F32 can be answered. §0.3 of the
 * round-6 plan requires a DIFFERENTIAL test — score the corpus under the current
 * query's data and under the candidate form's, and enumerate every disagreement.
 * **That cannot be run against the existing fixtures, because they are already
 * in the candidate form**: `capture-fixtures.mjs` drops non-areal relations
 * client-side (84 at Cologne, 34 Berlin, 20 Tokyo, 7 Manhattan, 2 Heidelberg),
 * which is exactly what the server-side `areal-only` form does.
 *
 * So the missing half is the dropped relations themselves. Captured here, they
 * reconstruct the `plain` answer as `fixture + these`, and the differential
 * becomes an ordinary offline unit test.
 *
 * WHY ONLY THE DROPPED HALF IS STORED. The full `plain` payload at res 9 is
 * ~37 MB and cannot be committed. Storing the difference rather than both sides
 * keeps the corpus small AND makes the thing under test explicit — this file IS
 * the hazard.
 *
 * WHY THE MEMBER LISTS ARE EMPTIED. This header used to estimate the dropped
 * relations at "a few hundred kB". It wrote 24.9 MB, and prettier committed
 * 41.4 MB across 1 128 493 lines — two thirds of PR #249's entire diff. The
 * bulk is `out geom` printing 590 061 member positions for international route
 * relations passing Köln Hbf, and NOTHING downstream reads one of them:
 * `relationToGeometry` checks `isArealRelation` before it ever calls
 * `memberGeometries`, so all 85 are rejected as `unsupported-relation-type`
 * first. The member ARRAYS stay present but empty, because `parseRelation`
 * skips a relation whose `members` is not an array while explicitly keeping one
 * whose members are unusable — dropping the key would take `elementCount` to
 * zero and make the differential's assertions pass vacuously.
 *
 * A capture script's own size estimate is a guess until a file exists. See
 * `GpsPlusSlamJs_Docs/docs/2026-08-04-0709-pr-249-diff-weight-audit.md`.
 *
 * ONE REQUEST, ON DEMAND. It hits donated public infrastructure, so it is a
 * script and never a gate — the same rule `capture-fixtures.mjs` and
 * `benchmark-endpoints.mjs` live under.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITES_DIR = join(__dirname, "..", "src", "testdata", "sites");

/** Mirrors `capture-fixtures.mjs` — a relation a site extract KEEPS. */
const AREAL_RELATION_TYPES = ["multipolygon", "boundary"];

/**
 * Empties a relation's member list, keeping the key. See the header for why the
 * key must survive. Everything else — id, tags, bounds — is preserved, because
 * the tags are what decide the relation's fate and the diagnostics quote the id.
 */
const withoutMembers = (relation) => ({ ...relation, members: [] });

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/**
 * The identifying headers are NOT optional, and omitting them is not a subtle
 * failure. Without `Accept: application/json` the FOSSGIS instances answer
 * **406 Not Acceptable** immediately — which looks exactly like a rate limit or
 * an IP block, and was briefly misread as one here. `capture-fixtures.mjs` has
 * always sent them; this script did not, and paid for it.
 */
const USER_AGENT = "gps-plus-slam-osm fixture capture (code@csutil.com)";

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
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return { payload: JSON.parse(text), bytes: text.length };
}

const slug = process.argv[2] ?? "cologne-cathedral";
const fixture = JSON.parse(
  readFileSync(join(SITES_DIR, `${slug}.json`), "utf8"),
);

// THE FIXTURE'S OWN QUERY, replayed verbatim. Rebuilding it here would be a
// second source of truth for what production asks for, and a differential
// between two different questions measures nothing.
const query = fixture.query;
console.log(`${slug}: replaying the fixture's own query`);
console.log(
  `  expecting ~${fixture.droppedNonArealRelations} non-areal relations`,
);

let lastError;
for (const endpoint of ENDPOINTS) {
  try {
    process.stdout.write(`  ${endpoint} ... `);
    const { payload, bytes } = await post(endpoint, query);
    const received = payload.elements ?? [];
    const nonAreal = received.filter(
      (element) =>
        element.type === "relation" &&
        !AREAL_RELATION_TYPES.includes((element.tags ?? {})["type"]),
    );
    console.log(
      `${received.length} elements, ${(bytes / 1024 / 1024).toFixed(2)} MB, ` +
        `${nonAreal.length} non-areal relations`,
    );

    const out = {
      name: `${slug}.non-areal`,
      of: slug,
      capturedAt: Date.now(),
      capturedFrom: endpoint,
      rawBytes: bytes,
      totalElements: received.length,
      // What the site fixture recorded dropping when IT was captured. A
      // mismatch means OSM changed under us and the differential is comparing
      // two different worlds — worth seeing rather than absorbing.
      expectedCount: fixture.droppedNonArealRelations,
      elementCount: nonAreal.length,
      // Recorded rather than silently discarded: a reader must not conclude
      // these relations genuinely have no members. It is also the number that
      // makes the size of what was thrown away visible.
      membersOmitted: nonAreal.reduce(
        (total, relation) => total + (relation.members ?? []).length,
        0,
      ),
      regenerateWith: `node scripts/capture-non-areal.mjs ${slug}`,
      elements: nonAreal.map(withoutMembers),
    };
    writeFileSync(
      join(SITES_DIR, `${slug}.non-areal.json`),
      `${JSON.stringify(out)}\n`,
    );
    console.log(`  wrote ${slug}.non-areal.json`);
    process.exit(0);
  } catch (error) {
    console.log(`failed: ${String(error)}`);
    lastError = error;
  }
}
console.error(`every endpoint failed: ${String(lastError)}`);
process.exit(1);
