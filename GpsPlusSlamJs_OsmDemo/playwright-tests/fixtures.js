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
 * The park capture is in Cologne and the demo default is now Manhattan
 * (DEC-R6b-3), so from the default the working set overlaps none of it — the app
 * renders "0 cells" and every assertion about the grid is vacuously about an
 * empty map. The `?lat=&lng=` override exists so the test can say exactly where
 * it stands.
 *
 * **The distance is not the point and never was**; before round 7 the default
 * was Cologne Cathedral and ~2 km was already enough. What matters is that the
 * default is not ON the fixture, which is now true by a much larger margin.
 */
export const AT_FIXTURE = `/?lat=${50.9231}&lng=${6.9445}`;

/**
 * How long a poll waits for a REPAINT to land.
 *
 * Every use is "wait until the canvas (or the Leaflet layer) has been redrawn",
 * which costs an animation frame plus whatever GPU work the frame implies. It
 * was 5 s, and that is a wall-clock assertion inside a suite of headless
 * software-rasterised WebGL — it measures the machine, not the code. On a loaded
 * developer machine three tests failed per run, each run a different three,
 * while every one of them passed standalone.
 *
 * RAISING THIS WEAKENS NOTHING. A poll returns the instant its condition holds,
 * so a passing test is not slowed by one millisecond; only the time a genuinely
 * broken build takes to report changes. The assertions themselves are untouched.
 *
 * LIVES HERE, not in a spec file, because the spec files are split by subject
 * and every one of them polls for a repaint. One definition, or the next split
 * file quietly gets a different timeout.
 */
export const REPAINT = { timeout: 15000 };

/**
 * A real captured Overpass response from the OSM package's fixture corpus.
 *
 * `park` is Cologne Volksgarten, which is nowhere near `main.ts`'s default start
 * (Manhattan since DEC-R6b-3) — the whole reason `AT_FIXTURE` exists: served
 * from the default position the features overlap none of the working set and the
 * app renders 0 cells. Read from the sibling package rather than copied, so a
 * re-capture cannot leave this suite asserting stale data.
 *
 * **This payload answers every Overpass query regardless of bbox**, so a test
 * that navigates to the default and then locates into Cologne still finds data
 * when it arrives.
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
/**
 * The PRIMARY DEM since the Mapterhorn+AWS composition landed: the app asks
 * this host first and falls back to the AWS tiles above only for tiles it
 * does not have. Both hosts are DEM tiles and share ONE route handler, so
 * `holdTerrain`/`failTerrain` govern the DEM as a whole — failing only the
 * primary would quietly turn every "outage" test into a fallback test.
 */
const isMapterhorn = (url) =>
  /(^|\.)tiles\.mapterhorn\.com$/i.test(url.hostname);
/** Either DEM host — what the `terrain` counter and the DEM routes match. */
const isDemTile = (url) => isTerrarium(url) || isMapterhorn(url);
const isBasemap = (url) =>
  /(^|\.)tile\.openstreetmap\.org$/i.test(url.hostname);
/**
 * The Leaflet stylesheet `index.html` loads from a CDN.
 *
 * **THE SUITE WAS NOT ACTUALLY OFFLINE**, despite `playwright.config.js` saying
 * so. `index.html` links `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` and
 * nothing here intercepted it, so every run fetched it for real. Harmless while
 * the console test swallowed `Failed to load resource` wholesale; the moment
 * that filter was narrowed to genuine aborts, a CDN hiccup — a 429, a DNS
 * failure, a dropped connection — would have failed a test about the app.
 * Raised in review on #279.
 *
 * Served from the local `leaflet` dependency, which is the same file the CDN
 * would return for the pinned version.
 */
const isCdnStylesheet = (url) => /(^|\.)unpkg\.com$/i.test(url.hostname);

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
    ruleSheet: 0,
    /** Lets the DEM answer, for tests that opted into `holdTerrain`. */
    releaseTerrain: () => {
      releaseTerrain();
    },
    /**
     * Makes every LATER Overpass query hang until {@link releaseOverpass}.
     *
     * ARMED AT CALL TIME rather than through an option, because the tests that
     * need it need the FIRST fetch to succeed: they boot a populated scene and
     * then assert what happens to it while the NEXT fetch is in flight — which
     * is a real ~15–90 s window in the app and would otherwise be a race in the
     * suite. (`holdTerrain` is an option because the DEM is only interesting
     * before it has ever answered.)
     */
    holdOverpass: () => {
      overpassHeld = new Promise((resolve) => {
        releaseOverpass = resolve;
      });
    },
    /** Lets a held query through. Safe to call when nothing is held. */
    releaseOverpass: () => {
      releaseOverpass();
      overpassHeld = undefined;
    },
  };
  const payload = JSON.stringify(parkPayload());
  /** Resolved by `counts.releaseTerrain()`; see the `holdTerrain` option. */
  let releaseTerrain = () => undefined;
  const terrainHeld = new Promise((resolve) => {
    releaseTerrain = resolve;
  });
  /** Pending only between `holdOverpass()` and `releaseOverpass()`. */
  let overpassHeld;
  let releaseOverpass = () => undefined;

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

    // Counted BEFORE the hold, so a test can see the request was issued while
    // still deciding when it may answer.
    if (overpassHeld !== undefined) await overpassHeld;

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
  //
  // `ruleSheetCsv` serves a real table instead, so the LIVE and CACHE tiers can
  // be exercised at all — without it every test runs on the snapshot and the
  // cache path has no coverage, which is how a loader whose cache was disabled in
  // its only consumer went unnoticed (#233).
  await page.route(isRuleSheet, (route) => {
    counts.ruleSheet++;
    if (options.ruleSheetCsv === undefined) return route.abort();
    return route.fulfill({
      status: 200,
      contentType: "text/csv",
      body: options.ruleSheetCsv,
    });
  });

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
  // The Leaflet stylesheet, from the local dependency rather than the CDN. See
  // `isCdnStylesheet`: without this the suite genuinely reached unpkg on every
  // run, and a CDN hiccup would now fail the console test.
  await page.route(isCdnStylesheet, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/css",
      body: readFileSync(
        join(here, "..", "node_modules", "leaflet", "dist", "leaflet.css"),
        "utf8",
      ),
    }),
  );
  // DEM tiles — BOTH hosts (Mapterhorn primary, AWS Terrarium fallback),
  // through one handler. Served as a REAL 2x2 PNG rather than aborted, so the
  // decode + sample path runs for real: an aborted tile would exercise only the
  // "terrain unavailable" branch and the displaced-ground code would never be
  // reached by any test. The four pixels encode distinct heights, so the
  // resulting surface is measurably non-flat.
  //
  // Terrarium decodes as (r * 256 + g + b / 256) - 32768, so r = 128, g = 0
  // is exactly 0 m and larger g values step up one metre each.
  //
  // MAPTERHORN GETS THE SAME 2x2 PNG, deliberately, not a 512-px WebP: the
  // provider's tile arithmetic is size-invariant (its own library tests pin
  // the 512-px rescale) and `createImageBitmap` sniffs bytes rather than
  // trusting the `.webp` URL, so the identical tile keeps the PRIMARY path —
  // the one production takes — exercised for real while staying deterministic.
  // Answering the primary means the AWS fallback is expected to receive no
  // requests in an ordinary run; it stays intercepted so a fallback fetch can
  // never leak to the network.
  /** @param {import('@playwright/test').Route} route */
  const serveDemTile = async (route) => {
    // `holdTerrain` STALLS the DEM indefinitely, until the test releases it (W3).
    //
    // A HOLD RATHER THAN A DELAY, and the difference is the difference between
    // an ordering assertion and a wall-clock one. What W3 changed is that the
    // Overpass fetch is issued WHILE the DEM is outstanding, instead of after
    // it; with a fixed delay a test can only say "the query happened within N
    // seconds", which measures the machine. With a hold, the query provably
    // happens while the DEM cannot possibly have finished, and the test spends
    // no time waiting for a timer.
    if (options.holdTerrain === true) await terrainHeld;
    // `failTerrain` makes every DEM tile fail, which is the outage path — the
    // ground stays FLAT and `field` comes back `undefined`. Distinct from
    // `holdTerrain`: that one delays an answer, this one refuses to give one.
    // Needed because a failed load still has to report WHERE it was asked to
    // look, or the ground plane stops following the user during an outage.
    if (options.failTerrain === true) {
      await route.fulfill({ status: 503, body: "" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: terrariumPng(),
    });
  };
  await page.route(isMapterhorn, serveDemTile);
  await page.route(isTerrarium, serveDemTile);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (isBasemap(url)) counts.basemap++;
    // One counter for the DEM as a whole: which host answered is the app's
    // composition detail, and every existing assertion is about "did the DEM
    // get asked", not about the member that replied.
    if (isDemTile(url)) counts.terrain++;
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

  // AND THEN WAIT FOR THE WIDENING TO FINISH (W16). Scoring is progressive: the
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
  // THE APP NOW SAYS SO, so this asks instead of inferring (F42). This used to
  // watch for QUIESCENCE — three identical reads 250 ms apart — on the argument
  // that it "needs no new instrumentation and stays correct if the number of
  // rings ever changes". Both halves of that argument were true and the
  // conclusion was still wrong: under worker contention the gap between rings
  // exceeds 500 ms, so the helper declared a settled scene during ring 2 and
  // every test in the file could proceed against a half-widened working set.
  // Measured: one run scored `845 cells · 19 chunks scored / 0 reused` where
  // another scored `1692 cells · 37 scored / 19 reused`, from the same fixture.
  //
  // `widening…` is written by `writeStatus` while `snapshot.radius` is below the
  // last ring, and it exists for the USER first — the app was announcing a
  // final-looking answer three times. Waiting for its absence is exact, and it
  // is also faster than waiting out 750 ms of stability the app never needed.
  await expect(page.locator("#status")).not.toContainText("widening", {
    timeout: 30000,
  });
}

/**
 * The same recording, installed BEFORE the page's own scripts run.
 *
 * WHY A SECOND HELPER RATHER THAN A FLAG ON THE FIRST. `recordStatus` answers
 * "what has the status line said SINCE NOW" and its other caller depends on
 * that: `data-and-caching.spec.js` starts recording after its setup and asserts
 * a message never appeared. This one answers "what has it said SINCE BOOT".
 * Both are legitimate; conflating them behind one name is how the next reader
 * picks the wrong one.
 *
 * WHY IT EXISTS. The widening step asserts that a TRANSIENT marker was seen —
 * it is on screen only between the first ring publishing and the last — and it
 * failed twice in five full-suite runs while passing 5/5 alone. `recordStatus`
 * installs its observer with `page.evaluate` AFTER `page.goto`, and `goto`
 * resolves on `load`, by which time the app is already booting; under load that
 * round trip can land after the whole widening phase is over. Installing at
 * document-start removes the window rather than shrinking it.
 *
 * `#status` does not exist that early, so the recorder waits for it: it watches
 * `document` until the node appears (NOT `documentElement`, which can be null
 * at document-start — see the comment at the observer), then observes the node
 * itself and stops watching. Call this BEFORE `page.goto`.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<() => Promise<string[]>>} reads the history so far
 */
export async function recordStatusFromBoot(page) {
  await page.addInitScript(() => {
    /** @type {string[]} */
    const seen = [];
    /** @type {Record<string, unknown>} */ (window).__statusHistory = seen;

    /** @param {Element} node */
    const record = (node) => {
      const text = node.textContent ?? "";
      if (seen.length === 0 || text !== seen[seen.length - 1]) seen.push(text);
    };

    const attach = () => {
      const node = document.getElementById("status");
      if (node === null) return false;
      record(node);
      new MutationObserver(() => {
        record(node);
      }).observe(node, { childList: true, characterData: true, subtree: true });
      return true;
    };

    if (attach()) return;
    // The document is still being parsed. Watch for the node rather than
    // guessing at a ready event — `DOMContentLoaded` would work today and would
    // silently stop working if the shell ever rendered `#status` from script.
    //
    // OBSERVING `document`, NOT `document.documentElement`. An init script runs
    // at document-start, where `documentElement` can still be null — and
    // `observe(null, …)` THROWS, which aborts the rest of this script silently.
    // That is not hypothetical: the first version did exactly that and recorded
    // zero entries, which reads identically to "the marker never appeared".
    // `document` always exists, and childList+subtree on it sees the same
    // mutations.
    const waiting = new MutationObserver(() => {
      if (attach()) waiting.disconnect();
    });
    waiting.observe(document, { childList: true, subtree: true });
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
 * Counts the pixels of the 3D pane that sit on a HARD EDGE, and says where they
 * are — the palette-independent way of asking "is there geometry on screen?".
 *
 * WHAT IT USED TO DO, AND WHY THAT HAD TO CHANGE (§1, DEC-R6-2/R6-4). It matched
 * every pixel against the exact colour ramp of the old painted sky — zenith
 * (16,22,42) to horizon (92,108,140) — and counted the misses. That was exact
 * rather than heuristic, which was the right call while the sky was two
 * hard-coded colours. Round 6 replaced it with a scattering shader whose colours
 * change with the sun, and added ACES tone mapping on top, so NO pixel matches
 * the old ramp any more: the helper reported the entire canvas as non-sky and
 * four tests failed at once.
 *
 * WHY EDGES ARE THE RIGHT INVARIANT. The background — under any sky, at any time
 * of day, before or after tone mapping — is SMOOTH: it is a gradient, so
 * neighbouring pixels differ by a level or two. Geometry is what puts a STEP in
 * it, at every silhouette and every facet boundary. So "how much of this frame
 * is geometry" is answerable without knowing a single colour, which is what
 * makes this survive the next palette change as well as this one.
 *
 * The predicate it replaced a "blue-dominant" heuristic for is still worth
 * remembering: that one classified the building material `0xc8ccd8` as sky and
 * reported zero surface pixels while pointing straight at a row of buildings.
 * An edge count cannot make that mistake, because it never asks what colour
 * anything is.
 *
 * **The count is NOT a pixel area** — it is roughly a perimeter, so callers
 * comparing "with buildings" against "without" should compare orders of
 * magnitude or ratios, not absolute areas.
 *
 * `meanY` is the vertical centre of mass, 0 at the top of the canvas and 1 at the
 * bottom — which is how a test can tell "looking UP at the buildings from
 * underneath" from "looking down at them".
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ count: number, meanY: number }>}
 */
export function countNonSkyPixels(page) {
  return page.evaluate(() => {
    const el = document.querySelector("#scene canvas");
    if (!(el instanceof HTMLCanvasElement)) return { count: -1, meanY: -1 };
    const probe = document.createElement("canvas");
    probe.width = el.width;
    probe.height = el.height;
    const ctx = probe.getContext("2d");
    if (ctx === null) return { count: -1, meanY: -1 };
    ctx.drawImage(el, 0, 0);
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    // A HARD HORIZONTAL EDGE, not a colour. See the doc comment: the sky is a
    // smooth gradient in every direction, and geometry is what puts a step in
    // it. 12 is well above the dithering and antialiasing noise of a gradient
    // and well below the step from sky to any surface.
    const STEP = 12;
    let count = 0;
    let sumY = 0;
    for (let y = 0; y < probe.height; y++) {
      for (let x = 1; x < probe.width; x++) {
        const i = (y * probe.width + x) * 4;
        const j = i - 4;
        const d = Math.max(
          Math.abs((data[i] ?? 0) - (data[j] ?? 0)),
          Math.abs((data[i + 1] ?? 0) - (data[j + 1] ?? 0)),
          Math.abs((data[i + 2] ?? 0) - (data[j + 2] ?? 0)),
        );
        if (d > STEP) {
          count++;
          sumY += y;
        }
      }
    }
    return { count, meanY: count === 0 ? -1 : sumY / count / probe.height };
  });
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
 * A 2x2 Terrarium DEM tile: a low plateau with one 40 m corner.
 *
 * ENCODED HERE rather than checked in as a binary, because the interesting part
 * is the ENCODING and a base64 blob hides it. Terrarium stores height as
 * `(r * 256 + g + b / 256) - 32768`, so `r = 128, g = 0` is exactly 0 m and each
 * step of `g` is one metre.
 *
 * WHY THREE ZEROS AND ONE 40, not four distinct heights. The provider samples a
 * tile at its DECODED size (the library's tile-size fix), so a 2x2 tile is one
 * smooth bilinear surface per z13 tile (~3 km at the fixture's latitude) —
 * `h = 40·x·y` with this layout. The previous four-value tile put the low
 * ground mid-distance from `AT_FIXTURE`, where scene fog washes the ramp's
 * saturated floor colour out and the ramp test's "cool end on screen" count
 * read zero. With the single high corner the user stands ON the low plateau:
 * the ramp floor is close and saturated, the 40 m corner keeps the surface
 * measurably non-flat (~±7 m within the near field, ±40 m in view), and the
 * displacement A/B still runs over real slopes.
 *
 * Written as a real PNG rather than a stub so the whole path runs for real:
 * fetch, decode, sample, displace. An aborted tile would exercise only the
 * "terrain unavailable" branch, and the displaced-ground code would never be
 * reached by any test in the suite.
 *
 * HISTORY WORTH KEEPING: before the library's tile-size fix, the provider
 * sampled this 2x2 tile at 256-px offsets, so clamping pinned every read to
 * one pixel and the whole tile decoded to a constant 10 m — meaning every
 * pre-fix relief assertion in this suite ran against a flat field and proved
 * nothing about displacement.
 */
function terrariumPng() {
  const heights = [
    [128, 0, 0],
    [128, 0, 0],
    [128, 0, 0],
    [128, 40, 0],
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

/**
 * Installs an in-page frame probe on the 3D canvas, and why it has to be
 * in-page.
 *
 * Three tests compared rendered frames by pulling the whole buffer into Node —
 * `[...ctx.getImageData(...).data]` is 1280 x 720 x 4 = 3 686 400 array elements
 * across the CDP bridge. Two of them did it inside an `expect.poll`, so they
 * paid it on every poll iteration. Those were the three slowest tests in the
 * suite: 53 s, 37 s and 31 s.
 *
 * Nothing about what they assert needs the pixels in Node. Stashing a reference
 * frame on `window` and running the comparison in the page ships ONE INTEGER,
 * and the arithmetic is character-for-character the same.
 *
 * Call once per test, after the page is loaded.
 */
export async function installFrameProbe(page) {
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    const read = () => {
      const el = document.querySelector("#scene canvas");
      if (!(el instanceof HTMLCanvasElement)) return undefined;
      const probe = document.createElement("canvas");
      probe.width = el.width;
      probe.height = el.height;
      const ctx = probe.getContext("2d");
      if (ctx === null) return undefined;
      ctx.drawImage(el, 0, 0);
      return ctx.getImageData(0, 0, probe.width, probe.height).data;
    };
    /** Captures the current frame as the reference. Returns its length, or 0. */
    w.__e2eStash = () => {
      const data = read();
      w.__e2eFrame = data;
      return data === undefined ? 0 : data.length;
    };
    /**
     * Pixels differing from the stash by more than `threshold`.
     *
     * `redOnly` picks the metric the caller's assertion was written against:
     * the ground A/B compares the red channel alone, the layer tests sum all
     * three. Returns `-1` when there is no canvas or no stash, so a missing
     * probe FAILS rather than reading as "nothing changed".
     */
    w.__e2eDiff = (threshold, redOnly) => {
      const now = read();
      const previous = w.__e2eFrame;
      if (now === undefined || previous === undefined) {
        return { differing: -1, anyLit: false };
      }
      let differing = 0;
      let lit = 0;
      for (let i = 0; i < now.length; i += 4) {
        const dr = Math.abs(now[i] - previous[i]);
        const delta = redOnly
          ? dr
          : dr +
            Math.abs(now[i + 1] - previous[i + 1]) +
            Math.abs(now[i + 2] - previous[i + 2]);
        if (delta > threshold) differing += 1;
        lit += now[i];
      }
      return { differing, anyLit: lit > 0 };
    };
  });
}

/** Captures the reference frame. Returns its byte length, or 0 if absent. */
export const stashFrame = (page) => page.evaluate(() => window.__e2eStash());

/** `{ differing, anyLit }` against the stashed frame. */
export const diffFromStash = (page, threshold, redOnly = false) =>
  page.evaluate(
    ([t, r]) => window.__e2eDiff(t, r),
    /** @type {[number, boolean]} */ ([threshold, redOnly]),
  );

/**
 * Waits until the scene stops repainting, and leaves that settled frame stashed.
 *
 * WHY A BASELINE HAS TO BE SETTLED. Every layer test here works the same way:
 * stash a frame with the layer off, switch it on, assert a large difference,
 * switch it off, assert the difference goes away. That last assertion is only
 * meaningful if NOTHING ELSE changed the picture in between — and plenty can. The
 * terrain load, a progressive scoring ring and the layer's own repaint all land on
 * their own schedule, so a baseline captured a moment too early is a baseline of a
 * scene that was still arriving, and the difference never returns to zero.
 *
 * Observed exactly that way: the roads step held at 8100 differing pixels against
 * a `< 3000` floor for the full 15 s timeout, in a serial run, with the layer
 * correctly off. Two tests in the demo spec had already grown their own private
 * version of this wait ("wait for the scene to settle, or the startup terrain
 * frame is what gets compared") — this is that pattern, once, where the probe it
 * depends on already lives.
 *
 * Convergence is THREE identical consecutive frames, re-stashing each round: the
 * first round has no stash and reports `-1`, and the loop ends holding the frame
 * that proved itself stable, which is exactly the baseline the caller wants.
 *
 * THREE, NOT TWO, and the difference is a bug this had when it was written. The
 * scene renders ON DEMAND (DEC-R3-9), so a layer switch schedules a frame rather
 * than drawing one — and two reads taken before that frame is presented are
 * identical, so the wait "converged" on the picture from BEFORE the change and
 * stashed it. The caller then switched the layer back on and measured no
 * difference at all: `> 3000` against a received 0, held for the full timeout.
 *
 * This is a settle, not a barrier. It cannot know which change it is waiting
 * for, so a caller that has an app-level signal for the change — the status line
 * dropping a layer's counter, say — should assert THAT first and use this to
 * absorb what follows.
 */
export async function stashStableFrame(page, threshold = 24) {
  let stable = 0;
  await expect
    .poll(
      async () => {
        const { differing } = await diffFromStash(page, threshold);
        await stashFrame(page);
        stable = differing === 0 ? stable + 1 : 0;
        return stable;
      },
      { timeout: 15000, intervals: [250] },
    )
    .toBeGreaterThanOrEqual(3);
}

/**
 * Switches the cell layer on and waits for the cells to actually arrive.
 *
 * WHY THIS EXISTS (round 10, stage B). The snapshot no longer carries the cell
 * array while the layer is off — ~24 000 cells that structured-clone in a
 * measured 27–35 ms to be drawn by nobody. So switching the layer ON now
 * triggers a refresh and the cells arrive ASYNCHRONOUSLY, where they used to be
 * redrawn from data already held.
 *
 * `waitForRefresh` is the wrong tool ON ITS OWN: it waits for the ABSENCE of
 * "widening", which is still true in the moment between the click and the
 * refresh starting, so it returns immediately and the test races anyway. The
 * cells themselves are the direct observable. AFTER the cell wait it is exactly
 * right, which is why the body below does both — do not "fix" the apparent
 * contradiction by deleting the second one (#262).
 *
 * @param {import('@playwright/test').Page} page
 */
export async function enableCellLayer(page) {
  await page.locator("#layer-cells").check();
  await expect(page.locator("#map path.affordance-cell")).not.toHaveCount(0, {
    timeout: 30000,
  });
  // AND THEN WAIT FOR THE WIDENING, for the reason `waitForRefresh` spells out
  // above: the first cells to appear are ring 2's, and rings 3 and 4 each
  // REPUBLISH a larger snapshot, re-rendering every path on the map.
  //
  // Switching this layer on is a REFETCH rather than a redraw WHENEVER THE HELD
  // SNAPSHOT HAS NO CELLS — they are data-gated since round 10 stage B, and
  // `layersNeedingData` refetches only in that case (`held[layer] ?? 0) === 0`).
  // Then the whole progressive cycle runs and a caller that only waited for the
  // first cells was racing it. That is the third appearance of the failure
  // `waitForRefresh` was written for: a cell clicked in ring 2 gets re-rendered
  // before the click lands, the dispatch never happens, and the details panel
  // silently stays hidden.
  //
  // AFTER AN OFF/ON FLICK WITHIN ONE POSITION the cells are already held, no
  // refetch happens, and both waits below pass immediately — so the helper is
  // still correct there, but the unconditional "this is a refetch" that used to
  // stand here was broader than the rule (#262).
  //
  // It surfaced as a CI-only failure of "the cells it reveals are
  // interrogable", deterministic on a slower runner and never reproducible
  // locally.
  await waitForRefresh(page);
}

/**
 * The UI state a shared-page spec file starts every test from.
 *
 * CAPTURED, NOT HARD-CODED. The category the demo opens on is chosen by
 * `main.ts` from the rule table, not by the picker's DOM order — the suite has
 * already been bitten once by assuming option 0 — so the baseline is read off
 * the booted page instead of written down here, where it would be a second
 * source of truth that drifts.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function captureUiBaseline(page) {
  return {
    category: await page.locator("#category").inputValue(),
    cells: await page.locator("#layer-cells").isChecked(),
    showBelow: await page.locator("#show-below").isChecked(),
  };
}

/**
 * Returns a shared page to its baseline, touching only what has MOVED.
 *
 * WHY A SHARED PAGE NEEDS THIS AT ALL (DEC-S5). One boot per subject file
 * instead of one per test is the whole saving, and a reload would hand it
 * straight back — a reload IS the boot. So state has to be undone in place.
 *
 * WHY `beforeEach` AND NOT PER-TEST TEARDOWN (DEC-S6). This runs even when the
 * previous test FAILED, which is exactly when the page is dirtiest and when
 * per-test cleanup is least likely to have run. One failing test must not
 * cascade into unrelated ones.
 *
 * WHY EVERY STEP IS CONDITIONAL (DEC-S8). Two of these controls trigger a
 * refetch: re-checking `cells` goes through `layersNeedingData`, and a category
 * change re-runs the whole pipeline. Resetting unconditionally would cost a
 * scoring cycle per test and give back the exact boot the shared page saves, so
 * the common case — nothing moved — has to be a few cheap reads and no clicks.
 *
 * WHAT THIS DELIBERATELY CANNOT RESET, and why those tests keep their own page
 * rather than being worked around here:
 *
 * - **A different network stub.** `stubNetwork(page, { overpassStatus: 400 })`
 *   is installed at boot; a page stubbed to succeed cannot be talked into
 *   failing afterwards.
 * - **Cells OFF.** The in-progress test exists to watch the cell FETCH happen,
 *   which cannot be observed on a page where the cells are already held.
 *
 * The geo-event marker USED to be on that list — "there is no control that
 * removes it" (#271 review). W6 added one, so it is reset below like anything
 * else. Note what it took: a store action (W2) AND a control, because this
 * helper can only press things.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{category: string}} baseline
 */
export async function resetUi(page, baseline) {
  // The panel first: closing it also DESELECTS. `onClose` dispatches
  // `cellSelected(undefined)`, and that reducer clears the cell, the feature AND
  // the region unconditionally — one dispatch, all three — so a later test's
  // selection assertions start from nothing.
  //
  // GATED ON VISIBILITY, which is a known hole rather than an oversight: if a
  // test ever leaves a selection set while the panel is hidden — `showRegion`
  // drops a selection whose id has vanished from the snapshot, for instance —
  // this skips the deselect and the next test starts with an invisible
  // selection. Raised in review on #271. Asserted rather than assumed below, so
  // the skip is loud instead of silent.
  if (await page.locator("#details").isVisible()) {
    await page.locator("#details .panel-close").click();
    await expect(page.locator("#details")).toBeHidden();
  }
  // The postcondition the branch above cannot guarantee on its own.
  expect(
    await page.evaluate(() => document.querySelectorAll(".panel-stats").length),
  ).toBe(0);

  // THE GEO-EVENT, which this helper could not reset at all until W6. Gated on
  // a marker actually being present, like every step here: the common case is a
  // test that never pressed the button, and that must stay two cheap reads.
  //
  // Two clicks rather than one, and the shape is the feature: with an event
  // held, the button opens the picker instead of re-running the identical
  // search (G1), and the picker is where the clear lives.
  //
  // THE OPEN CHECK IS NOT REDUNDANT, because that button is a TOGGLE and
  // nothing else closes the picker — not a click elsewhere, only Search or
  // Clear. A test that ended with the picker open would have this helper close
  // it, and then wait on a hidden `#geo-event-clear` until it timed out. No
  // test leaves that state today; a reset helper exists to be insensitive to
  // the states that do not exist yet.
  if ((await page.locator("#map .geo-winner").count()) > 0) {
    const picker = page.locator("#geo-event-picker");
    if (!(await picker.isVisible())) await page.locator("#geo-event").click();
    await page.locator("#geo-event-clear").click();
    await expect(page.locator("#map .geo-winner")).toHaveCount(0);
  }

  // Free: a presentation toggle that never refetches.
  const showBelow = page.locator("#show-below");
  if ((await showBelow.isChecked()) !== baseline.showBelow) {
    await showBelow.setChecked(baseline.showBelow);
  }

  // THE BASELINE IS WHATEVER THE BOOT PRODUCED, not a state this helper
  // imposes, and that is the correction the pilot bought. Forcing cells ON made
  // the reset re-check a layer that the previous test had switched off — a
  // refetch — only for the next test to switch it off again. That off/on/off
  // churn is state no per-test boot ever goes through, and it broke a 3D pick
  // that passed in isolation and failed after its predecessor. Restoring to the
  // captured default means the common case is genuinely a no-op.
  const cells = page.locator("#layer-cells");
  if ((await cells.isChecked()) !== baseline.cells) {
    await cells.setChecked(baseline.cells);
    // Only a switch-ON refetches (`layersNeedingData`); switching off is a
    // redraw and needs no wait.
    if (baseline.cells) await waitForRefresh(page);
  }

  // The most expensive reset in the file: a category change re-runs the
  // pipeline. Last, and only when it actually differs.
  const category = page.locator("#category");
  if ((await category.inputValue()) !== baseline.category) {
    await category.selectOption(baseline.category);
    await waitForRefresh(page);
  }
}
