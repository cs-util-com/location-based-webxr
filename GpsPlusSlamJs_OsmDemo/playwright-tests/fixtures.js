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
    ruleSheet: 0,
    /** Lets the DEM answer, for tests that opted into `holdTerrain`. */
    releaseTerrain: () => {
      releaseTerrain();
    },
  };
  const payload = JSON.stringify(parkPayload());
  /** Resolved by `counts.releaseTerrain()`; see the `holdTerrain` option. */
  let releaseTerrain = () => undefined;
  const terrainHeld = new Promise((resolve) => {
    releaseTerrain = resolve;
  });

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
  // Terrarium DEM tiles. Served as a REAL 2x2 PNG rather than aborted, so the
  // decode + sample path runs for real: an aborted tile would exercise only the
  // "terrain unavailable" branch and the displaced-ground code would never be
  // reached by any test. The four pixels encode distinct heights, so the
  // resulting surface is measurably non-flat.
  //
  // Terrarium decodes as (r * 256 + g + b / 256) - 32768, so r = 128, g = 0
  // is exactly 0 m and larger g values step up one metre each.
  await page.route(isTerrarium, async (route) => {
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
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: terrariumPng(),
    });
  });
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
