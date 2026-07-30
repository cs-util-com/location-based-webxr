// @ts-check
/**
 * Network interception for the e2e suite.
 *
 * WHY EVERY EXTERNAL CALL IS INTERCEPTED, and the first reason is not
 * determinism:
 *
 * 1. **The public Overpass instances are donated infrastructure** with a
 *    measured allocation of two slots per client IP, recovering in ~30 s. A CI
 *    suite that hit them on every push would be an abuse of a shared resource,
 *    and the retry-with-backoff path would make every run minutes long.
 * 2. **The rule table is a live Google Sheet** that anyone with access can edit.
 *    A suite depending on it asserts today's spreadsheet, not today's code.
 * 3. Only then: a test that fails because a third party is slow teaches nothing.
 *
 * WHAT IS DELIBERATELY *NOT* FAKED. The interception happens at the HTTP layer,
 * so `OverpassSource`, the parser, `CachingSource`, the OPFS store, the index,
 * the scorer, the region builder and the mesh extruder all run for real. A
 * seam inside the app would have been easier and would have tested the seam.
 */

import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The app URL that puts the simulated user ON the fixture.
 *
 * The park capture is centred ~2 km from the demo default, and at that distance
 * the working set overlaps none of it — the app renders "0 cells" and every
 * assertion about the grid is vacuously about an empty map. The `?lat=&lng=`
 * override exists so the test can say exactly where it stands.
 */
export const AT_FIXTURE = `/?lat=${50.9231}&lng=${6.9445}`;

/**
 * A real captured Overpass response from the OSM package's fixture corpus.
 *
 * `park` is Cologne Volksgarten — ~2 km from `main.ts`'s default start, which
 * is the whole reason `AT_FIXTURE` exists: served from the default position the
 * features overlap none of the working set and the app renders 0 cells. Read
 * from the sibling package rather than copied, so a re-capture cannot leave this
 * suite asserting stale data.
 */
export function parkPayload() {
  const path = join(
    here,
    "..",
    "..",
    "GpsPlusSlamJs_Osm",
    "src",
    "testdata",
    "park.json",
  );
  return JSON.parse(readFileSync(path, "utf8")).payload;
}

/**
 * Hosts the app talks to that must never be reached from a test.
 *
 * Matched on HOSTNAME, never as a substring of the whole URL. A pattern like
 * `/overpass/` looks obviously right and is a trap: the app's own module graph
 * contains `overpass-source.js`, `overpass-query.js` and `overpass-status.js`,
 * so a substring route intercepts Vite's own JavaScript and answers it with the
 * JSON fixture. The browser then refuses the module for its MIME type and the
 * app never boots — with the only symptom being a status line stuck on
 * "starting…". That cost a debugging round; hence hostnames.
 */
const isOverpass = (url) =>
  /(^|\.)overpass[^.]*\.de$|(^|\.)kumi\.systems$|(^|\.)openstreetmap\.fr$/i.test(
    url.hostname,
  );
const isRuleSheet = (url) => /(^|\.)docs\.google\.com$/i.test(url.hostname);
const isTerrarium = (url) =>
  /(^|\.)s3\.amazonaws\.com$/i.test(url.hostname) &&
  url.pathname.includes("/terrarium/");
const isBasemap = (url) =>
  /(^|\.)tile\.openstreetmap\.org$/i.test(url.hostname);

/**
 * Routes the app's outside world to checked-in data.
 *
 * Returns a counter so a test can assert how many Overpass requests were made —
 * which is how the cache is proved to work, and the only way to notice the app
 * quietly refetching on every redraw.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ overpassStatus?: number }} [options]
 */
export async function stubNetwork(page, options = {}) {
  const counts = {
    overpassStatus: 0,
    overpassQuery: 0,
    basemap: 0,
    terrain: 0,
  };
  const payload = JSON.stringify(parkPayload());

  await page.route(isOverpass, async (route) => {
    // Counted SEPARATELY from queries. A single combined counter cannot express
    // the cache assertion: "at most one more request" also passes when the cache
    // is completely broken and the reload issues exactly one fresh QUERY with no
    // status probe - which is the precise failure that test exists to catch.
    // `/api/status` is the slot-budget probe, not a query, and it costs no slot.
    if (route.request().url().includes("/api/status")) {
      counts.overpassStatus++;
      // Must answer in the plain-text OSM3S format or the client cannot parse
      // its own budget.
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: [
          "Connected as: 1354464119",
          `Current time: ${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`,
          "Rate limit: 2",
          "2 slots available now.",
          "Currently running queries (pid, space limit, time limit, start time):",
        ].join("\n"),
      });
      return;
    }

    counts.overpassQuery++;

    const status = options.overpassStatus ?? 200;
    if (status !== 200) {
      // 400 rather than 503 on purpose: a non-retryable status escapes the
      // retry loop immediately, so the failure path is exercised in a second
      // instead of through several seconds of exponential backoff. (That
      // "permanent errors must escape the loop" behaviour is itself a fix this
      // package shipped, so the choice is not arbitrary.)
      await route.fulfill({ status, contentType: "text/plain", body: "nope" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: payload,
    });
  });

  // The rule table's three-tier loader degrades live -> cache -> snapshot. An
  // aborted fetch lands it on the checked-in snapshot instantly, which is both
  // deterministic AND the tier the status bar reports, so the test can assert
  // which table it is judging.
  await page.route(isRuleSheet, (route) => route.abort());

  // Basemap tiles are decoration here and cost a third party bandwidth.
  await page.route(isBasemap, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      // 1x1 transparent PNG.
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );
  // Terrarium DEM tiles. Served as a REAL 2x2 PNG rather than aborted, so the
  // decode + sample path runs for real: an aborted tile would exercise only the
  // "terrain unavailable" branch and the displaced-ground code would never be
  // reached by any test. The four pixels encode distinct heights, so the
  // resulting surface is measurably non-flat.
  //
  // Terrarium decodes as (r * 256 + g + b / 256) - 32768, so r = 128, g = 0
  // is exactly 0 m and larger g values step up one metre each.
  await page.route(isTerrarium, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: terrariumPng(),
    }),
  );
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (isBasemap(url)) counts.basemap++;
    if (isTerrarium(url)) counts.terrain++;
  });

  return counts;
}

/**
 * Waits for the app to finish a refresh.
 *
 * The status line ends every successful pass with a cell count, so waiting for
 * that is waiting for the real end of the pipeline — no `waitForTimeout`, which
 * this repo forbids because it turns a slow machine into a flaky suite.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function waitForRefresh(page) {
  await page
    .locator("#status")
    .filter({ hasText: /\d+ cells|Failed|unavailable/ })
    .first()
    .waitFor({ state: "visible", timeout: 60000 });

  // AND THEN WAIT FOR THE WIDENING TO SETTLE (W16). Scoring is progressive: the
  // first emission is the ring-2 working set and rings 3 and 4 follow, each
  // republishing a larger snapshot. So the status line appearing no longer means
  // the refresh has FINISHED — only that it has started delivering.
  //
  // Without this, every test capturing state after this helper races the
  // widening, and three did, in three unrelated ways: a cell clicked in ring 2
  // was re-rendered before the click landed, a selection was dropped by a later
  // republish, and a pixel comparison caught two different rings. None of them
  // was about scoring, which is why the helper is the right place to fix it
  // rather than each call site.
  //
  // QUIESCENCE rather than a ring counter: it needs no new instrumentation and
  // stays correct if the number of rings ever changes.
  // THREE consecutive identical reads, not two, and the interval is pinned.
  // Two reads 100 ms apart can both land in the gap between rings and report a
  // settled scene that is still growing — which showed up as a Leaflet popup
  // being closed by `clearLayers()` on the next republish, and as a frame
  // captured mid-widening. Three reads at 250 ms span 500 ms, comfortably wider
  // than the gap.
  let previous = "";
  let stableReads = 0;
  await expect
    .poll(
      async () => {
        const current = (await page.locator("#status").textContent()) ?? "";
        stableReads =
          current !== "" && current === previous ? stableReads + 1 : 0;
        previous = current;
        return stableReads;
      },
      { timeout: 30000, intervals: [250] },
    )
    .toBeGreaterThanOrEqual(3);
}

/**
 * Records every distinct `#status` text from now on (W2, finding R3-5).
 *
 * WHY AN OBSERVER RATHER THAN POLLING. The thing being asserted is that a
 * message NEVER appeared, and the message it is about — `Failed: The request was
 * superseded` — is on screen only for the moment between one run being aborted
 * and the next one publishing. A poll interval wide enough to be cheap is wide
 * enough to miss it entirely, so the test would pass on the bug.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<() => Promise<string[]>>} reads the history so far
 */
export async function recordStatus(page) {
  await page.evaluate(() => {
    const seen = [];
    const node = document.getElementById("status");
    if (node === null) return;
    seen.push(node.textContent ?? "");
    new MutationObserver(() => {
      const text = node.textContent ?? "";
      if (text !== seen[seen.length - 1]) seen.push(text);
    }).observe(node, { childList: true, characterData: true, subtree: true });
    /** @type {Record<string, unknown>} */ (window).__statusHistory = seen;
  });
  return () =>
    page.evaluate(
      () =>
        /** @type {string[]} */ (
          /** @type {Record<string, unknown>} */ (window).__statusHistory ?? []
        ),
    );
}

/**
 * Asserts the 3D canvas is laid out at its CONTAINER's size (finding R3-2, W1).
 *
 * WHY THIS IS A SHARED HELPER AND NOT TWO COPIES. The same assertion has to run
 * at two device pixel ratios and `test.use` is per-describe, so the two callers
 * are two `describe` blocks. The interesting part is the comparison, and it
 * belongs in one place.
 *
 * WHAT IT CATCHES. `WebGLRenderer.setSize(w, h, false)` sets the canvas
 * width/height ATTRIBUTES to `size x devicePixelRatio` and deliberately does not
 * write `canvas.style`. With no CSS rule for the canvas, the element then lays
 * out at its attribute size in CSS pixels — 2-3x its container on a phone, and
 * 1.25-1.5x on a Windows desktop at 125-150 % scaling. Everything still renders
 * correctly into the drawing buffer, so every pixel assertion in this suite
 * stays green; what breaks is that most of the picture is outside the visible
 * box, taking the projection centre — and with it every orbit pivot — off screen.
 *
 * The bounding box is in CSS pixels, which is exactly the comparison that
 * matters: the drawing buffer is SUPPOSED to be larger than the box.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function expectCanvasFillsContainer(page) {
  const container = await page.locator("#scene").boundingBox();
  const canvas = await page.locator("#scene canvas").boundingBox();
  if (container === null || canvas === null) {
    throw new Error("no bounding box for #scene or its canvas");
  }
  // A pixel of tolerance, not exactness: a fractional container size rounds.
  expect(Math.abs(canvas.width - container.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(canvas.height - container.height)).toBeLessThanOrEqual(1);
}

/**
 * A 2x2 Terrarium DEM tile with four distinct heights.
 *
 * ENCODED HERE rather than checked in as a binary, because the interesting part
 * is the ENCODING and a base64 blob hides it. Terrarium stores height as
 * `(r * 256 + g + b / 256) - 32768`, so `r = 128, g = 0` is exactly 0 m and each
 * step of `g` is one metre. The four pixels below are 0 / 20 / 40 / 10 m, which
 * is enough relief for a test to tell a displaced plane from a flat one.
 *
 * Written as a real PNG rather than a stub so the whole path runs for real:
 * fetch, decode, sample, displace. An aborted tile would exercise only the
 * "terrain unavailable" branch, and the displaced-ground code would never be
 * reached by any test in the suite.
 */
function terrariumPng() {
  const heights = [
    [128, 0, 0],
    [128, 20, 0],
    [128, 40, 0],
    [128, 10, 0],
  ];
  // Raw scanlines: one filter byte (0 = none) then RGB triples.
  const raw = Buffer.concat([
    Buffer.from([0, ...heights[0], ...heights[1]]),
    Buffer.from([0, ...heights[2], ...heights[3]]),
  ]);

  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); // width
  ihdr.writeUInt32BE(2, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** CRC-32, as PNG specifies it. */
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc;
}
