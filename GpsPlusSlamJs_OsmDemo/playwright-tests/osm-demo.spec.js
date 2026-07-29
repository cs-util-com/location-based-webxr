// @ts-check
/**
 * End-to-end tests for the OSM affordance demo.
 *
 * WHY THIS SUITE EXISTS. The demo typechecked, its unit tests passed and it
 * production-built — and none of that establishes that anything appears on
 * screen. "It builds" and "it works" are different claims, and every failure
 * mode this app has is a silent one: Leaflet layers in the wrong order hide the
 * grid, a WebGL pane that renders nothing looks exactly like a pane with no
 * buildings nearby, and an OPFS path that never caches looks exactly like one
 * that does until someone watches the network.
 *
 * So these tests assert what is actually DRAWN and what actually went over the
 * wire, not that a function returned. Two of them are deliberately the kind
 * this repo has a scar from skipping: a pixel-level check on the 3D canvas
 * (a status line built from the same objects the presenter mutates is blind to
 * render-wiring bugs), and a request count (the only way to see a cache).
 *
 * The whole suite is offline — see `fixtures.js` for why that is about donated
 * infrastructure before it is about determinism.
 */

import { test, expect } from "@playwright/test";

import { AT_FIXTURE, stubNetwork, waitForRefresh } from "./fixtures.js";

test.describe("the demo boots", () => {
  test("loads the rule table and populates the category picker", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // The categories come from the rule table, not from a hardcoded list, so a
    // populated picker is evidence the table parsed. `walkable` is the C#
    // vocabulary's own category and the demo's default.
    const options = page.locator("#category option");
    await expect(options).not.toHaveCount(0);
    await expect(page.locator("#category")).toHaveValue("walkable");

    // WHICH TIER the table came from is displayed on purpose: a demo silently
    // running on the checked-in snapshot looks identical to one on the live
    // sheet, and they are different claims about what is being judged. The
    // suite blocks the sheet, so `snapshot` is the correct answer here.
    await expect(page.locator("#status")).toContainText("rules: snapshot");
  });

  test("requests basemap tiles, so the grid has something to sit on", async ({
    page,
  }) => {
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // `counts.basemap` was incremented and never read by anything — and unlike
    // an unused TypeScript export, nothing in the gate would say so: knip does
    // not reach into `playwright-tests/`, and this project has no lint stage.
    // Spending it is better than deleting it: a Leaflet tile layer that never
    // requests a tile still renders a perfectly convincing empty map, and
    // "the affordance cells are drawn" would keep passing over a blank canvas.
    expect(counts.basemap).toBeGreaterThan(0);
  });

  test("reports the scale it is drawing with, as a legend", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // Without this the demo answers "does it look plausible?" instead of "is 1
    // really the identity here?" — and only the second is worth a session.
    //
    // The claim moved from a sentence to a swatch strip on 2026-07-29 (DEC-13):
    // the sentence was reported as unreadable, but it is the on-screen answer to
    // iteration 8's second question, so it was replaced pictorially rather than
    // deleted. It survives verbatim as the strip's accessible text, which is
    // what the `title` assertion below pins — a legend that dropped it would
    // pass a "there are swatches" test while losing the answer.
    const legend = page.locator("#legend");
    await expect(legend).toBeVisible();
    await expect(legend.locator(".legend-swatch")).not.toHaveCount(0);
    await expect(legend.locator(".legend-strip")).toHaveAttribute(
      "title",
      /identity is 1.*log scale/s,
    );

    // The ends of the ramp are labelled with real numbers, or the colours are
    // a gradient with no units.
    await expect(legend.locator(".legend-min")).toHaveText("1");
    await expect(legend.locator(".legend-max")).not.toBeEmpty();
  });
});

test.describe("the affordance map", () => {
  test("draws res-13 cells over the basemap", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // The class exists so this assertion cannot be satisfied by the region
    // outlines: Leaflet renders every polygon as an indistinguishable <path>,
    // and a test matching all of them would pass with an empty grid.
    const cells = page.locator("#map path.affordance-cell");
    await expect(cells.first()).toBeVisible();
    expect(await cells.count()).toBeGreaterThan(10);
  });

  test("draws the fetched extent as a box, and says how big it is", async ({
    page,
  }) => {
    // WHY THIS MATTERS. "One res-7 tile" is the unit the whole plan is written
    // in, and it stays an abstraction until it is drawn over a city. The box is
    // also NOT the hexagon — Overpass has no hexagon primitive, so the query
    // covers the tile's bounding box and we pay ~39% over-fetch on every tile.
    // Both shapes are asserted because drawing only the box would confirm the
    // exact misreading the display exists to correct.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await expect(page.locator("#map path.fetch-extent").first()).toBeVisible();
    await expect(
      page.locator("#map path.fetch-tile-hex").first(),
    ).toBeVisible();

    // The picture answers "how big" only roughly; the status line has to carry
    // the number, or the over-fetch stays invisible on a zoomed-out map.
    const status = await page.locator("#status").textContent();
    expect(status).toMatch(/box per tile/);
    expect(status).toMatch(/hexagon/);
    expect(status).not.toMatch(/NaN|Infinity/);
  });

  test("draws region outlines, and draws them OVER the cells", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const outlines = page.locator("#map path.region-outline");
    await expect(outlines.first()).toBeVisible();

    // Paint order is invisible to every unit test and decides whether the
    // boundary is legible: a 2 px dashed stroke under 55 %-opacity fills is
    // washed out exactly where it matters. Leaflet's default renderer puts all
    // vectors in one shared <svg>, so DOCUMENT ORDER is paint order — the
    // outlines must come last.
    //
    // This assertion earned its place immediately: the source comment claimed
    // regions were drawn underneath while the code drew them on top, and
    // nothing else in the suite could have noticed.
    const order = await page.evaluate(() => {
      const paths = [...document.querySelectorAll("#map svg path")];
      return {
        lastCell: paths.findLastIndex((p) =>
          p.classList.contains("affordance-cell"),
        ),
        firstRegion: paths.findIndex((p) =>
          p.classList.contains("region-outline"),
        ),
      };
    });
    expect(order.firstRegion).toBeGreaterThanOrEqual(0);
    expect(order.firstRegion).toBeGreaterThan(order.lastCell);
  });

  test("a cell tooltip names the OSM elements that produced its score", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.locator("#map path.affordance-cell").first().hover();

    // Provenance is the whole reason the C# reference kept a
    // contributing-entries map: it turns "that cell looks wrong" into "that
    // cell is wrong BECAUSE of way/12345" in one click. A tooltip that shows
    // only a number would make every surprising score a dead end.
    const tooltip = page.locator(".leaflet-tooltip").first();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("walkable =");
    await expect(
      tooltip.locator('a[href*="openstreetmap.org/"]').first(),
    ).toHaveCount(1);
  });

  test("switching category redraws the grid", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const other = await page.evaluate(() => {
      const select = document.getElementById("category");
      const values = [...(select?.querySelectorAll("option") ?? [])].map(
        (o) => o.value,
      );
      return values.find((v) => v !== "walkable") ?? "";
    });
    test.skip(other === "", "rule table declares only one category");

    await page.locator("#category").selectOption(other);
    await expect(page.locator("#status")).toContainText(`${other} regions`);

    // A category switch that rescored but never repainted would leave the map
    // showing `walkable` under a `restingArea` label — the exact kind of stale
    // view a status-line-only assertion cannot see.
    //
    // ASSERTED VIA THE TOOLTIP, not the fill. The earlier version read the fill
    // before and after and then only checked both for non-nullness, so a cell
    // that kept its exact `walkable` colour passed — which is precisely the
    // failure the comment claims to catch. Comparing the fills instead would be
    // legitimately flaky, because two categories can land a given cell in the
    // same colour bucket. The tooltip cannot be stale: `map-view.ts` rebuilds it
    // per render with `tooltipFor(cell, category, score)`, so it NAMES the
    // category the paths were drawn for.
    const cell = page.locator("#map path.affordance-cell").first();
    await expect(cell).toBeVisible();
    await cell.hover();
    await expect(page.locator(".leaflet-tooltip").first()).toContainText(
      `${other} =`,
    );

    // W2, added 2026-07-29. Everything above proves the map REDREW; none of it
    // proves a person could tell. Until the legend landed, the only place the
    // app named the current category was inside a tooltip, so the reported
    // symptom — "switching category did not reset the map" — was reachable with
    // this test passing: every category scores nearly every rule, and
    // `heatScale` re-normalises to each category's own maximum, so the same
    // hexagons come back in similar colours. The legend is the fix, and this is
    // the assertion that keeps it honest.
    await expect(page.locator("#legend .legend-category")).toHaveText(other);
  });
});

test.describe("the 3D view", () => {
  test("actually draws pixels, not just a canvas element", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const canvas = page.locator("#scene canvas");
    await expect(canvas).toBeVisible();

    // THE PIXEL PROOF. A present canvas of the right size proves nothing: a
    // scene with the camera inside a wall, a mesh with no geometry, or a render
    // that never ran all produce exactly that. This reads the drawing buffer
    // (which is why the renderer sets `preserveDrawingBuffer`) and counts
    // pixels that are not the background colour.
    const painted = await page.evaluate(() => {
      const el = document.querySelector("#scene canvas");
      if (!(el instanceof HTMLCanvasElement)) return -1;
      const probe = document.createElement("canvas");
      probe.width = el.width;
      probe.height = el.height;
      const ctx = probe.getContext("2d");
      if (ctx === null) return -1;
      ctx.drawImage(el, 0, 0);
      const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
      // Background is #11131a; anything meaningfully lighter is geometry.
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r + g + b > 0x11 + 0x13 + 0x1a + 60) count++;
      }
      return count;
    });

    expect(painted).toBeGreaterThan(500);
  });

  test("reports what it built, including the honesty flags", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // `guessed building heights` is the mesh layer's honesty flag and this is
    // the only place it becomes visible. The census said only ~16 % of buildings
    // carry a `height` tag, so a demo reporting zero guesses over real data
    // would mean the flag stopped being set, not that OSM improved.
    //
    // The word BUILDING is load-bearing and was added on 2026-07-29 (finding
    // M13): read as bare "guessed heights", the counter was taken for terrain
    // relief, and the reasonable conclusion — "it knows the elevation, it just
    // is not drawing it" — is wrong twice over, because the demo wires no
    // elevation provider at all and the 3D ground is a flat plane at y = 0.
    await expect(page.locator("#status")).toContainText("volumes");
    await expect(page.locator("#status")).toContainText(
      "guessed building heights",
    );
    await expect(page.locator("#status")).toContainText("triangles");
  });
});

test.describe("caching and failure", () => {
  test("a reload is served from OPFS without refetching", async ({ page }) => {
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

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
    // while `renderFailed` leaves it alone.
    await expect(page.locator("#map path.affordance-cell")).toHaveCount(0);
  });
});
