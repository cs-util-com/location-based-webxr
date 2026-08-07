// @ts-check
/**
 * What goes over the wire and what does not: the OPFS tile cache, the rule
 * table cache, the background ring prefetch, and the two request paths that
 * must not block or corrupt each other.
 *
 * Split out of the single 4 486-line `osm-demo.spec.js` so the suite's shape
 * and its growth are visible; `fixtures.js` carries the shared setup and the
 * reasoning for why the whole suite is offline.
 */

import { test, expect } from "@playwright/test";

import {
  AT_FIXTURE,
  recordStatus,
  stubNetwork,
  waitForRefresh,
  enableCellLayer,
  REPAINT,
} from "./fixtures.js";

test.describe("caching and failure", () => {
  test("a reload is served from OPFS without refetching", async ({ page }) => {
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // WAIT FOR THE BACKGROUND PREFETCH TO GO QUIET FIRST, or the baseline is a
    // moving target. `prefetch.replace(...)` queues tile fetches AFTER the
    // visible work (W8), so queries keep arriving once `waitForRefresh` has
    // returned -- and any that land after this capture are counted against the
    // RELOAD, failing the test with "the cache missed" when the cache was fine.
    //
    // Seen under full-suite load; it passes 3/3 standalone, because the window
    // only opens when the machine is busy. Moving the capture later does NOT
    // fix it -- it was already immediately before the reload -- so the fix has
    // to be waiting for quiescence rather than picking a better moment.
    // THREE consecutive equal samples, not one. Two readings 500 ms apart are
    // equal whenever the prefetch merely PAUSES for longer than the interval,
    // which under full-suite load it does — so the first version of this
    // quiescence check declared victory mid-prefetch and the flake it was
    // written to remove came back and failed a gate. Same rule and same count as
    // `stashStableFrame` in `fixtures.js`, which settled this for frames first.
    let previousCount = -1;
    let stable = 0;
    await expect
      .poll(
        () => {
          stable = counts.overpassQuery === previousCount ? stable + 1 : 0;
          previousCount = counts.overpassQuery;
          return stable;
        },
        { timeout: 30000, intervals: [500] },
      )
      .toBeGreaterThanOrEqual(3);

    const queriesAfterFirst = counts.overpassQuery;
    expect(queriesAfterFirst).toBeGreaterThan(0);

    await page.reload();
    await waitForRefresh(page);

    // A res-7 tile is tens of megabytes; refetching it on every reload would
    // abuse donated infrastructure. The OPFS store is what stops that, and a
    // request count is the ONLY way to see it working — the map looks identical
    // either way.
    //
    // EXACTLY zero new queries, not 'at most one'. The earlier version counted
    // status probes and queries together and allowed a slack of 1, which also
    // passed when the cache was completely broken and the reload issued one
    // fresh query with no probe — the precise failure this test exists to catch.
    expect(counts.overpassQuery).toBe(queriesAfterFirst);
  });

  test("a failed fetch is reported, not silently blank", async ({ page }) => {
    await stubNetwork(page, { overpassStatus: 400 });
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // CELLS ON: they start OFF since DEC-R7b-6, and this test is about the
    // grid. Switching them on here rather than changing the default keeps the
    // default itself asserted in one place (the layer-toggle test).
    await page.locator("#layer-cells").check();
    // NOT `enableCellLayer` HERE, deliberately: every tile is refused, so the
    // grid must stay EMPTY and a helper that waits for cells would hang.

    // A blank map with no message looks exactly like "there is no data at this
    // location" — the one reading that would send someone debugging the wrong
    // layer entirely.
    await expect(page.locator("#status")).toContainText(/unavailable|Failed/);

    // And the converse, which is the defect round-1 feedback reported: a map
    // still drawing cells while the status line says the refresh failed. With
    // every tile refused there is nothing to draw, so the grid must be empty.
    //
    // NOTE ON WHAT THIS DOES *NOT* COVER, deliberately. An HTTP failure never
    // reaches the error path that clears a PREVIOUS snapshot: `DemoPipeline`
    // collects refused tiles into `missingTiles` rather than throwing, so this
    // stub produces a successful refresh that happens to be empty. The
    // stale-snapshot case is unreachable from any network stub and is pinned
    // where it can be reached — `refresh-cycle.test.ts` and the framework's
    // `osm-view-slice` tests, which assert `fetchFailed` clears the snapshot
    // while `nonFatalError` leaves it alone.
    await expect(page.locator("#map path.affordance-cell")).toHaveCount(0);
  });
});

/**
 * W2 / finding R3-5 — "the 3D scene sometimes resets".
 *
 * It never was a reset. A newer click or category change aborts the run in
 * flight, the RPC rejects, and the cycle reported that as a DATA failure —
 * which clears the snapshot and the selection by design, blanking both views
 * and closing the details panel. With three progressive rings over a 2.8 km
 * mesh build, the window in which to be superseded is most of every click.
 */
test.describe("a superseded refresh", () => {
  /**
   * A category value that is not the current one.
   *
   * BY VALUE, never by index: the picker is populated from the rule table and
   * the demo then selects its default explicitly. A test that switched to
   * index 1 and "back" to index 0 silently ended on a third category — which is
   * exactly how the camera assertion below first failed, at 43 % of pixels
   * changed, for a reason that had nothing to do with the camera.
   *
   * The default happens to be option 0 today (`battleArea` is the sheet's first
   * column, DEC-G3) — which is precisely why by-index would now look correct
   * and break again the next time the sheet is reordered.
   */
  const otherCategory = async (page, current) => {
    const values = await page
      .locator("#category option")
      .evaluateAll((nodes) =>
        nodes.map((node) => /** @type {HTMLOptionElement} */ (node).value),
      );
    const other = values.find((value) => value !== current);
    if (other === undefined) throw new Error("only one category in the picker");
    return other;
  };

  test("reports no failure, blanks nothing, and keeps the panel and camera", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // CELLS ON: they start OFF since DEC-R7b-6, and the grid is what this test
    // watches for blanking. With the layer off it would compare zero against
    // zero and pass for the wrong reason once the assertion below was relaxed.
    //
    // Through the helper because the cells now ARRIVE ASYNCHRONOUSLY (round 10,
    // stage B): the array is not sent while the layer is off, so switching it on
    // is a refresh rather than a redraw.
    await enableCellLayer(page);

    await test.step("never reports a failure, and never blanks what is drawn", async () => {
      const cells = page.locator("#map path.affordance-cell");
      expect(await cells.count()).toBeGreaterThan(0);

      const statusHistory = await recordStatus(page);

      // TWO CHANGES IN QUICK SUCCESSION, with no wait between them: the second
      // supersedes the first while it is still in flight, which is the whole
      // input. A test that waited between them would exercise nothing.
      const picker = page.locator("#category");
      const started = await picker.inputValue();
      await picker.selectOption(await otherCategory(page, started));
      await picker.selectOption(started);
      await waitForRefresh(page);

      // The status line is where `fetchFailed` becomes visible, and the message it
      // would carry is the RPC's own. Neither may ever have appeared.
      const history = await statusHistory();
      expect(history.join(" | ")).not.toMatch(/Failed|superseded/);

      // And the picture survived: the grid is still there, drawn for the category
      // the picker ended on.
      expect(await cells.count()).toBeGreaterThan(0);
    });

    await test.step("keeps the details panel open, and does not move the camera", async () => {
      // TWO INVARIANTS IN ONE STEP because they share an expensive setup and both
      // are about what a supersede must NOT touch. The selection half is
      // `fetchFailed` clearing `selectedCell` — the panel dismissing itself while
      // it is being read. The camera half is DEC-R3-1: the owner could not confirm
      // whether the camera reset too, so nothing was fixed for it and this asserts
      // it cannot start happening unnoticed.
      //
      // Move the camera off its default pose first, or "the camera did not move"
      // is satisfied by a camera that was reset TO the pose it was already in.
      const canvas = page.locator("#scene canvas");
      const box = await canvas.boundingBox();
      if (box === null) throw new Error("no canvas box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2);
      await page.mouse.up();

      await page.locator("#map path.affordance-cell").first().click();
      await expect(page.locator("#details")).toBeVisible();

      /**
       * The drawing buffer stands in for the camera matrix, which is not exposed.
       *
       * BOTH THE CAPTURE AND THE COMPARISON HAPPEN IN THE PAGE. The first version
       * returned the pixels — a ~4 million element array per call — and marshalling
       * that over CDP took seconds under a loaded three-worker run, so two
       * "consecutive" reads spanned a progressive ring landing and the stability
       * poll could never converge. It was green standalone and timed out in the
       * full suite, which is the signature of a test measuring the machine.
       */
      const capture = () =>
        page.evaluate(() => {
          const el = document.querySelector("#scene canvas");
          if (!(el instanceof HTMLCanvasElement)) return false;
          const probe = document.createElement("canvas");
          probe.width = el.width;
          probe.height = el.height;
          const ctx = probe.getContext("2d");
          if (ctx === null) return false;
          ctx.drawImage(el, 0, 0);
          /** @type {Record<string, unknown>} */ (window).__frame =
            ctx.getImageData(0, 0, probe.width, probe.height).data;
          return true;
        });

      /** Fraction of RGB samples differing from the captured frame by > 2 levels. */
      const diffFromCapture = () =>
        page.evaluate(() => {
          const el = document.querySelector("#scene canvas");
          const previous = /** @type {Record<string, unknown>} */ (window)
            .__frame;
          if (
            !(el instanceof HTMLCanvasElement) ||
            !(previous instanceof Uint8ClampedArray)
          ) {
            return 1;
          }
          const probe = document.createElement("canvas");
          probe.width = el.width;
          probe.height = el.height;
          const ctx = probe.getContext("2d");
          if (ctx === null) return 1;
          ctx.drawImage(el, 0, 0);
          const now = ctx.getImageData(0, 0, probe.width, probe.height).data;
          if (now.length !== previous.length) return 1;
          let changed = 0;
          for (let i = 0; i < now.length; i += 4) {
            if (
              Math.abs((now[i] ?? 0) - (previous[i] ?? 0)) > 2 ||
              Math.abs((now[i + 1] ?? 0) - (previous[i + 1] ?? 0)) > 2 ||
              Math.abs((now[i + 2] ?? 0) - (previous[i + 2] ?? 0)) > 2
            ) {
              changed++;
            }
          }
          return changed / (now.length / 4);
        });

      // SWITCH OFF EVERYTHING THAT CAN CHANGE ON ITS OWN, so that what remains in
      // the canvas is the ground plane and the sky — neither of which a scoring
      // pass touches. What is left of any difference is then the VIEWPOINT, which
      // is the only thing this test is about.
      //
      // This is the second attempt at making it robust and the first one that
      // addresses the real cause. Comparing the full scene meant comparing the
      // affordance grid, and `waitForRefresh` used to return on three stable status
      // reads 250 ms apart — on a loaded machine running three browsers a
      // progressive ring can take longer than that, so the reference frame could be
      // captured mid-widening and the comparison then failed at ~13 % PERSISTENTLY.
      // Waiting harder is a race against the machine; removing the moving parts is
      // not.
      //
      // That helper no longer guesses (F42): the app says `widening…` until the
      // last ring lands and `waitForRefresh` waits for it to clear. The layers stay
      // switched off anyway — this step's assertion is EXACTLY zero changed pixels,
      // and fewer moving parts is still the reason it can be.
      await page.locator("#layer-cells").uncheck();
      await page.locator("#layer-buildings").uncheck();
      await page.locator("#layer-trees").uncheck();
      // `areas` JOINS THE LIST BECAUSE THE SLABS BECAME SHINY. Region slabs went to
      // roughness 0.25 with emissive, and a tight specular lobe turns sub-pixel
      // camera drift — damping is on, and the sun's azimuth follows the camera —
      // into visibly different pixels. Measured: 0.08 % of the frame differed
      // between two captures of a scene nobody had touched, against an assertion
      // that demands EXACTLY zero.
      //
      // Loosening the threshold was the alternative and is worse: this test's
      // whole point is that a superseded refresh moves the camera by nothing at
      // all, and a real move differs by tens of percent (the comment above records
      // ~13 % for a mid-widening mismatch). Removing one more moving part keeps
      // the assertion exact.
      await page.locator("#layer-areas").uncheck();
      // AND THE GROUND GOES PLAIN (§2). The slope treatment adds a rim light,
      // and a rim term is view-dependent by definition — it is `1 − dot(V, N)` —
      // so sub-pixel camera drift moves it and the frame stops being stable.
      // This is the "remove one more moving part" lever the comment below says
      // is exhausted, applied once more: the ground can lose its APPEARANCE
      // without disappearing, which is different from switching it off.
      await page.locator("#ground-mode").selectOption("cpu");

      // NO LONGER EXACTLY ZERO (§1, DEC-R6-2), and this IS the loosening the
      // comment above argued against — so the reason is on the record.
      //
      // That argument was "remove one more moving part rather than raise the
      // threshold", and it worked while the shiny surfaces were switchable
      // layers. §1 gave the scene an environment map, so the GROUND PLANE is now
      // specular too, and its reflection depends on the view direction:
      // sub-pixel camera drift from damping changes pixels. The ground cannot be
      // switched off the way a layer can without gutting what this test is
      // about, so the "remove a moving part" lever is exhausted.
      //
      // Measured across §1 and §2 as the scene gained view-dependent shading:
      // 0.06 % with the environment map alone, 0.23 % once the ground was also
      // specular under it. A real superseded-refresh mismatch is ~13 %
      // (recorded above), so the bound below sits about 4x above the observed
      // noise and 13x below a genuine failure.
      //
      // THE GENERAL FACT, which is worth stating once rather than rediscovering
      // each stage: **a frame containing a specular surface lit by an
      // environment map cannot be byte-stable under damping drift**, because
      // the reflection is a function of view direction and the camera never
      // exactly stops. Exactly-zero is not available again for any scene with
      // the ground switched on.
      await capture();
      await expect
        .poll(async () => {
          const moved = await diffFromCapture();
          await capture();
          return moved;
        }, REPAINT)
        .toBeLessThan(0.01);

      // Supersede: two category changes with no wait, then back to where it
      // started so the scene is comparable again.
      const picker = page.locator("#category");
      const started = await picker.inputValue();
      await picker.selectOption(await otherCategory(page, started));
      await picker.selectOption(started);
      await waitForRefresh(page);

      // A category change KEEPS the selection by design (`categoryChanged` in the
      // slice) — "what does this same cell score for the other category?" is the
      // obvious next question. Only `fetchFailed` cleared it.
      await expect(page.locator("#details")).toBeVisible();

      // A FRACTION of changed pixels against the parked frame, not equality. Same
      // position, same category and the same scored chunks, so the scene is the
      // same scene — but the two frames are not bit-identical, and chasing that
      // would be chasing the wrong thing: what this asserts is that the VIEWPOINT
      // did not change, and a camera reset to the default pose moves essentially
      // every pixel of a city. The scale is known from having got this wrong:
      // selecting the wrong category for the return leg changed 43 % of pixels,
      // which is the order a genuine viewpoint change lands at. 5 % is far below
      // that and far above frame-to-frame noise.
      await expect.poll(diffFromCapture, REPAINT).toBeLessThan(0.05);
    });
  });
});

/**
 * W3 / finding R3-3 — the refresh no longer waits for the DEM grid.
 *
 * ORDERING, NOT A WALL CLOCK. An e2e that asserts a duration measures the
 * machine, and this suite has a scar from exactly that. What is behavioural is
 * that the cells arrive while the terrain is still loading — which is only
 * possible if the two run concurrently.
 */
test.describe("the terrain load and the refresh", () => {
  test("run concurrently — Overpass is queried while the DEM is still out", async ({
    page,
  }) => {
    // WHAT THIS DOES *NOT* ASSERT, and why. The cells still cannot appear before
    // the terrain: the mesh build genuinely needs the field, so the worker holds
    // it at the gate. What W3 changed is everything BEFORE the mesh — the fetch
    // and the scoring — which used to be queued behind the whole DEM round trip
    // by `loadTerrain(p).finally(() => refresh())`.
    //
    // So the observable is the Overpass request: it is issued while the DEM is
    // still outstanding. Held rather than delayed, so this is an ordering
    // assertion with no timer in it.
    const counts = await stubNetwork(page, { holdTerrain: true });
    await page.goto(AT_FIXTURE);

    // The DEM cannot have answered — nothing has released it — so a query here
    // proves the two are in flight together.
    //
    // GIVEN THE REPAINT BUDGET RATHER THAN Playwright's default 5 s (§2). The
    // ordering claim is unchanged; what changed is how long the page takes to
    // GET to its first Overpass call. §2 added a shader to the default ground,
    // and headless Chromium compiles and rasterises on the CPU — so under
    // three-worker contention the boot no longer fits in five seconds. It
    // passes standalone in 22 s. Raising a *timeout* is safe here in a way that
    // raising a *threshold* would not be: the assertion is "greater than zero",
    // so a longer wait cannot make a wrong answer look right.
    await expect.poll(() => counts.overpassQuery, REPAINT).toBeGreaterThan(0);

    counts.releaseTerrain();
    await waitForRefresh(page);
    await expect(page.locator("#status")).toContainText(/terrain ±/);
  });
});

/**
 * W8 / DEC-R2-6 — the ring is pulled in the background, one tile at a time.
 *
 * THE COST IS ACCEPTED WITH THE NUMBER STATED: 170–400 MB per move against
 * donated Overpass infrastructure. Throttling spreads that total over time; it
 * does not reduce it. So what these tests actually guard is the discipline —
 * that the user's own fetch is never queued behind a background one, and that a
 * prefetched tile is genuinely reused rather than fetched twice.
 */
test.describe("the background ring prefetch", () => {
  test("warms the neighbours, and reuses them instead of refetching", async ({
    page,
  }) => {
    // ONE BOOT, and here the sharing is more than a saving: both steps assert on
    // the SAME request counter, and the second one's claim — that moving does not
    // refetch what the ring already pulled — is only meaningful against a ring
    // the first step has just established. Two boots asserted that twice from
    // scratch.
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("warms the neighbours, and never more than one at a time", async () => {
      // The user's own tile, plus the ring arriving behind it. The count is what
      // proves the ring is being pulled at all — the map looks identical either
      // way, which is the same reason the OPFS cache test counts requests.
      await expect
        .poll(() => counts.overpassQuery, { timeout: 30000 })
        .toBeGreaterThan(1);

      // AT MOST SEVEN: the tile the user is in plus its six neighbours
      // (`fetchWorkingSet`). More than that would mean the queue is following the
      // ring of a ring, which is how a background loader becomes a crawler.
      expect(counts.overpassQuery).toBeLessThanOrEqual(7);
    });

    await test.step("a prefetched neighbour is reused, not fetched again", async () => {
      // The payoff, and the only way to see it is a request count. Without the
      // prefetch this click is an 18–110 s fetch; with it, the tile is already in
      // OPFS and the click costs nothing on the wire.
      // Let the ring settle, then remember what has been spent.
      let previous = -1;
      await expect
        .poll(
          () => {
            const settled = counts.overpassQuery === previous;
            previous = counts.overpassQuery;
            return settled;
          },
          { timeout: 30000, intervals: [500] },
        )
        .toBe(true);
      const spent = counts.overpassQuery;

      // Move far enough to need a different fetch tile — the fixture answers every
      // tile, so what is being asserted is the COUNT, not the content.
      await page.goto(`/?lat=${50.9231 + 0.02}&lng=${6.9445 + 0.02}`);
      await waitForRefresh(page);

      // Some of the new ring will be fetched; what must NOT happen is a refetch of
      // a tile already in the store. Bounded by one fresh working set plus its
      // ring rather than by everything all over again.
      expect(counts.overpassQuery - spent).toBeLessThanOrEqual(7);
    });
  });
});

/**
 * The rule table's cache tier, raised in review on PR #233.
 *
 * `loadRuleTable({})` was called with no store, so `readCache` returned
 * `undefined` before doing anything: the TTL short-circuit never fired — every
 * boot went to the network — and `checkDrift`, which the loader's own header
 * calls "not optional", had no baseline to compare against and was therefore
 * never evaluated. The guard existed and was inert in its only consumer.
 */
test.describe("the rule table cache", () => {
  /** A minimal but real table: one rule, one category. */
  const CSV = ["id,Key,Value,walkable", "leisure_park,leisure,park,3"].join(
    "\n",
  );

  test("is written on the first load and served on the next", async ({
    page,
  }) => {
    const counts = await stubNetwork(page, { ruleSheetCsv: CSV });
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // First load: the live sheet, and the status line names the tier it used.
    await expect(page.locator("#status")).toContainText(/rules: live/);
    const fetchedOnce = counts.ruleSheet;
    expect(fetchedOnce).toBeGreaterThan(0);

    await page.reload();
    await waitForRefresh(page);

    // Second load: served from OPFS inside the TTL, with NO new request. Before
    // the fix this said `rules: live` again and the count went up — the cache was
    // never written, so there was nothing to serve.
    await expect(page.locator("#status")).toContainText(/rules: cache/);
    expect(counts.ruleSheet).toBe(fetchedOnce);
  });
});
