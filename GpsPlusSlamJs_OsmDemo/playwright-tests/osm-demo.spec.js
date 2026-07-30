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

/**
 * How long a poll waits for a REPAINT to land.
 *
 * Every use below is "wait until the canvas (or the Leaflet layer) has been
 * redrawn", which costs an animation frame plus whatever GPU work the frame
 * implies. It was 5 s, and that is a wall-clock assertion inside a suite that
 * runs three browsers in parallel — it measures the machine, not the code. On a
 * loaded developer machine three tests failed per run, each run a different
 * three, while every one of them passed standalone.
 *
 * RAISING THIS WEAKENS NOTHING. A poll returns the instant its condition holds,
 * so a passing test is not slowed by one millisecond; only the time a genuinely
 * broken build takes to report changes. The assertions themselves are untouched.
 */
const REPAINT = { timeout: 15000 };

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

test.describe("the browser console", () => {
  test("stays clean — no shader, WebGL or page errors", async ({ page }) => {
    // WHY THIS TEST EXISTS. A three.js material whose shader fails to compile is
    // simply NOT DRAWN. There is no exception, no rejected promise, nothing in the
    // DOM and nothing in any status line — the geometry is handed to the renderer,
    // counted, reported, and silently skipped. The only signal is a `console.error`
    // from `WebGLProgram`.
    //
    // That is not hypothetical: setting `scene.environment` to a raw equirect
    // texture (rather than a PMREM-processed one) made EVERY `MeshStandardMaterial`
    // fail to compile — buildings, trees, ground plane and plates all vanished from
    // the demo — while the suite stayed green and the status line reported
    // "21 volumes". The whole suite asserted on pixels that the surviving
    // `MeshBasicMaterial` grid happened to satisfy.
    //
    // So the console is now part of the contract. Vite's own dev-server noise and
    // the deliberately-stubbed network are filtered; everything else fails.
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const ignorable = (text) =>
      // The suite blocks the live rule sheet on purpose; the app reports the
      // degradation in its status line and the fixture asserts on it.
      /Rule table fetch failed/.test(text) ||
      // Blocked by `stubNetwork`, deliberately.
      /net::ERR_FAILED|Failed to load resource/.test(text);

    const real = errors.filter((text) => !ignorable(text));
    expect(real, `unexpected console errors:\n${real.join("\n---\n")}`).toEqual(
      [],
    );
  });
});

test.describe("the worker", () => {
  test("is really constructed, and the UI thread is not doing the work", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS. Every other test in this suite would pass just as
    // well if the worker were quietly bypassed and everything ran on the main
    // thread — they assert on what is drawn, and the drawing is identical either
    // way. The whole point of the split is WHERE the work happens, and that is
    // invisible to every assertion except this one.
    //
    // Counting `new Worker` rather than timing anything: a timing assertion for
    // "the UI thread stayed responsive" is exactly the kind of threshold that
    // passes on a fast machine and flakes in CI.
    await stubNetwork(page);

    // Installed before any module runs, so the demo's own construction is seen.
    await page.addInitScript(() => {
      const w = /** @type {any} */ (window);
      w.__workers = [];
      const Real = window.Worker;
      // @ts-expect-error — deliberately replacing the constructor.
      window.Worker = class extends Real {
        constructor(url, options) {
          w.__workers.push(String(url));
          super(url, options);
        }
      };
    });

    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const workers = await page.evaluate(
      () => /** @type {any} */ (window).__workers,
    );
    expect(workers).toHaveLength(1);
    expect(workers[0]).toContain("demo-worker");

    // And it ANSWERED: the status line's cell count comes back over the RPC
    // boundary, so a worker that started and then died would fail here rather
    // than leaving a passing test and a blank page.
    await expect(page.locator("#status")).toContainText(/\d+ cells/);
  });

  test("a dead worker is REPORTED, not left hanging", async ({ page }) => {
    // WHY THIS TEST MATTERS, and it was missing when the worker landed. A worker
    // that dies — a syntax error in its module graph, an OOM — fires `error` and
    // then never replies to anything. Every pending call hangs forever, and an
    // `error` event carries no request id, so nothing CAN be rejected. The only
    // correct behaviour is an out-of-band report, which is why `onFatal` is a
    // required parameter of `workerTransport`.
    //
    // The symptom without it is the worst kind: the demo sits on "Loading the
    // rule table…" indefinitely, which looks exactly like a slow network. So the
    // assertion is that the failure becomes VISIBLE.
    await stubNetwork(page);

    // A Worker that constructs successfully and then dies, which is the shape of
    // a real module-graph failure. Deliberately NOT a constructor that throws:
    // that would fail at `new Worker` and never exercise the error listener.
    await page.addInitScript(() => {
      // @ts-expect-error — deliberately replacing the constructor.
      window.Worker = class extends EventTarget {
        constructor() {
          super();
          setTimeout(() => {
            this.dispatchEvent(
              Object.assign(new Event("error"), {
                message: "simulated worker death",
              }),
            );
          }, 0);
        }
        postMessage() {
          /* a dead worker answers nothing — that is the whole point */
        }
        terminate() {}
      };
    });

    await page.goto(AT_FIXTURE);

    // Reported through the pre-store channel, because the worker has to exist
    // before the store does (the store's initial category comes from the rule
    // table, which the worker loads). Either channel is a pass; silence is not.
    await expect(page.locator("#status")).toContainText(/Failed/, {
      timeout: 15000,
    });
    await expect(page.locator("#status")).toContainText(
      /simulated worker death/,
    );
  });
});

test.describe("the header", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("collapses to give its height back to the 3D view", async ({ page }) => {
    // WHY THIS TEST MATTERS, and why it asserts HEIGHT rather than visibility.
    // The feedback assumed the header already floats over the 3D view. It does
    // not — it is a grid row, so on a phone its wrapped lines are taken OUT of
    // the 3D view's height. That makes collapsing a real win rather than a
    // cosmetic one, and "the bar got shorter" is the only assertion that shows it.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const header = page.locator("#header-bar");
    const scene = page.locator("#scene");
    const before = await header.boundingBox();
    const sceneBefore = await scene.boundingBox();
    if (before === null || sceneBefore === null) throw new Error("no boxes");

    await page.locator("#header-toggle").click();

    await expect(header).toHaveAttribute("data-collapsed", "true");
    await expect(page.locator("#header-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    const after = await header.boundingBox();
    const sceneAfter = await scene.boundingBox();
    if (after === null || sceneAfter === null) throw new Error("no boxes");
    expect(after.height).toBeLessThan(before.height);
    // The height went to the 3D view rather than nowhere.
    expect(sceneAfter.height).toBeGreaterThan(sceneBefore.height);

    // THE CONTROLS THAT STEER THE DEMO STAY REACHABLE (DEC-R2-4). Collapsing the
    // category picker away would put a primary input two taps from reach, and
    // hiding the legend would re-create the round-1 problem it was added to fix.
    await expect(page.locator("#category")).toBeVisible();
    await expect(page.locator("#legend")).toBeVisible();

    await page.locator("#header-toggle").click();
    await expect(header).toHaveAttribute("data-collapsed", "false");
  });

  test("expands itself when an error needs to be read", async ({
    page,
    context,
  }) => {
    // DEC-R2-15. The status line lives inside the header, and failures are
    // reported into it — so a collapsed header would swallow the message and the
    // demo would look like it did nothing. Driven through a REAL failure (a
    // refused geolocation permission) rather than by dispatching by hand, because
    // the wiring from reporter to reveal is the part that can be missing.
    await context.clearPermissions();
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.locator("#header-toggle").click();
    await expect(page.locator("#header-bar")).toHaveAttribute(
      "data-collapsed",
      "true",
    );

    await page.locator(".locate-button").click();

    await expect(page.locator("#header-bar")).toHaveAttribute(
      "data-collapsed",
      "false",
    );
    // And the message is actually legible, not merely present in the DOM.
    await expect(page.locator("#status")).toBeVisible();
    await expect(page.locator("#status")).toContainText(
      /denied|unavailable|timed out/,
    );
  });

  test("keeps the terrain attribution visible even when collapsed", async ({
    page,
  }) => {
    // Attribution is required wherever the data is shown, so it may not be
    // collapsed away. It moved out of the header into Leaflet's attribution
    // control (DEC-R2-4), which is always visible.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const attribution = page.locator("#map .leaflet-control-attribution");
    await expect(attribution).toContainText("OpenStreetMap");
    await expect(attribution).toContainText(
      /Mapzen|Terrarium|Tilezen|elevation/i,
    );

    await page.locator("#header-toggle").click();
    await expect(page.locator("#header-bar")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    // Still there with the bar collapsed — the whole point.
    await expect(attribution).toContainText("OpenStreetMap");
    await expect(attribution).toContainText(
      /Mapzen|Terrarium|Tilezen|elevation/i,
    );
  });
});

test.describe("the layer toggles", () => {
  test("switch geometry off and on without refetching", async ({ page }) => {
    // WHY THIS TEST MATTERS (W10, DEC-R2-10/12). The registry's whole purpose is
    // that a later AR mode can ask for buildings + POI markers and skip ground
    // plates. That is only true if a switch actually changes what is BUILT — and
    // the cheap mistake is to gate the drawing while still doing all the work, or
    // to trigger a refetch for a presentation-only change.
    //
    // Asserted through the status line's own counters rather than pixels: they are
    // reported from what was drawn, so they cannot agree with a wrong picture.
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // Generated from ALL_LAYERS, so a new builder cannot arrive without a switch.
    await expect(page.locator("#layers input[type=checkbox]")).toHaveCount(7);

    // The defaults reproduce the picture the demo shipped with — which is what
    // makes the migration of buildings/trees through the registry verifiable.
    await expect(page.locator("#layer-cells")).toBeChecked();
    await expect(page.locator("#layer-buildings")).toBeChecked();
    await expect(page.locator("#layer-trees")).toBeChecked();
    await expect(page.locator("#layer-roads")).not.toBeChecked();

    const status = page.locator("#status");
    await expect(status).toContainText(/\d+ volumes/);
    const before = counts.overpassQuery;

    await page.locator("#layer-buildings").uncheck();

    // The counters must drop to zero volumes: the layer is genuinely not built,
    // not merely hidden.
    await expect(status).not.toContainText(/[1-9]\d* volumes/);
    // NO REFETCH. Layers are presentation; the snapshot in the store is reused.
    expect(counts.overpassQuery).toBe(before);

    // And the cells are independent — switching buildings off must not disturb them.
    await expect(
      page.locator("#map path.affordance-cell").first(),
    ).toBeVisible();

    await page.locator("#layer-buildings").check();
    await expect(status).toContainText(/[1-9]\d* volumes/);
    expect(counts.overpassQuery).toBe(before);
  });

  test("draws ground plates when the layer is switched on", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS (W11). The feedback asked for ground areas as real
    // geometry — "flache Platten quasi im 3D-Raum" — and the registry only earns
    // its keep if a NEW builder is reachable through it without touching the ones
    // already there. So this asserts the default is OFF (the shipped picture must
    // stay reproducible) and that switching it on changes what is DRAWN.
    //
    // This test previously asserted only that plates were BUILT and counted, with a
    // long note recording that the pixels never changed and I could not find why.
    // The cause was the shader outage: plates are `MeshStandardMaterial`, so they
    // were compiled-out along with the buildings, the trees and the ground plane.
    // Every experiment I ran — lifting them 100 m, colouring them bright red — was
    // testing geometry that the renderer was silently refusing to draw.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await expect(page.locator("#layer-plates")).not.toBeChecked();
    await expect(page.locator("#status")).not.toContainText(/ground areas/);

    const shot = () =>
      page.evaluate(() => {
        const el = document.querySelector("#scene canvas");
        return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
      });

    // Wait for the scene to settle, or the startup terrain frame is what gets
    // compared rather than the layer change (the same trap as R2-3's test).
    let previous = await shot();
    await expect
      .poll(async () => {
        const current = await shot();
        const stable = current === previous;
        previous = current;
        return stable;
      }, REPAINT)
      .toBe(true);
    const before = previous;

    await page.locator("#layer-plates").check();
    await expect(page.locator("#layer-plates")).toBeChecked();

    // The fixture is Cologne Volksgarten: 3 `amenity=parking` areas, landuse, a
    // park, a garden and playgrounds. Both halves are asserted — that the geometry
    // was built, and that it reached the screen.
    await expect(page.locator("#status")).toContainText(/[1-9]d* ground areas/);
    await expect.poll(shot, REPAINT).not.toBe(before);
  });

  test("switching the cells layer off clears the grid in BOTH views", async ({
    page,
  }) => {
    // The registry has to reach every view, or one of them keeps drawing a layer
    // the store says is off — the cross-view disagreement the store exists to
    // prevent, reintroduced by the mechanism meant to prevent it.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await expect(
      page.locator("#map path.affordance-cell").first(),
    ).toBeVisible();

    await page.locator("#layer-cells").uncheck();

    await expect(page.locator("#map path.affordance-cell")).toHaveCount(0);
    // The 3D grid is inside a canvas, so it is asserted through the click it would
    // otherwise answer: with no grid there is nothing to pick.
    const canvas = page.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("#details")).toBeHidden();
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

  test("a cell popup names the OSM elements that produced its score, and they are clickable", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // Any new tab must land on a fixture, never on openstreetmap.org: this
    // suite is offline by policy, and that is about not hammering donated
    // infrastructure before it is about determinism. Routed on the CONTEXT, not
    // the page, so it also covers the tab the link opens.
    await page
      .context()
      .route("https://www.openstreetmap.org/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<html>osm</html>" }),
      );

    const cell = page.locator("#map path.affordance-cell").first();
    await cell.hover();

    // HOVER gives the number. That is all it can give: Leaflet tooltips are
    // non-interactive by design.
    const tooltip = page.locator(".leaflet-tooltip").first();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("walkable =");

    // CLICK gives the evidence. Provenance is the whole reason the C# reference
    // kept a contributing-entries map: it turns "that cell looks wrong" into
    // "that cell is wrong BECAUSE of way/12345" in one click.
    await cell.click();
    const popup = page.locator(".leaflet-popup");
    await expect(popup).toBeVisible();

    // It STAYS open when the pointer leaves — the whole difference from a
    // tooltip, and what makes the links reachable at all.
    await page.mouse.move(0, 0);
    await expect(popup).toBeVisible();

    // THE ASSERTION THAT WAS MISSING, and the reason this shipped broken. The
    // old test asserted the link was PRESENT (`toHaveCount(1)`) — which a dead
    // link satisfies exactly as well as a live one. These links lived in a
    // tooltip, which Leaflet renders with `pointer-events: none`, so the demo's
    // advertised core debugging affordance had never once been clickable while
    // the suite stayed green. Presence is not reachability: click it.
    const link = popup.locator('a[href*="openstreetmap.org/"]').first();
    await expect(link).toHaveAttribute(
      "href",
      /openstreetmap\.org\/(node|way|relation)\/\d+/,
    );
    const opened = await Promise.all([
      page.waitForEvent("popup"),
      link.click(),
    ]);
    expect(opened[0].url()).toMatch(/openstreetmap\.org\//);
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

test.describe("explaining one cell", () => {
  test("clicking a cell opens a details panel explaining its score", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const panel = page.locator("#details");
    await expect(panel).toBeHidden();

    await page.locator("#map path.affordance-cell").first().click();
    await expect(panel).toBeVisible();

    // The panel must carry what the popup cannot: every contributing feature,
    // expandable to its individual TAGS. "Which element made this 9?" was
    // already answerable; "which TAG made it 0?" is what this exists for.
    const feature = panel.locator("details.panel-feature").first();
    await expect(feature).toBeVisible();
    await feature.locator("summary").click();
    await expect(feature.locator("tr.panel-tag").first()).toBeVisible();

    // Dismissing it deselects, rather than merely hiding a still-selected cell
    // — otherwise re-clicking the same cell would appear to do nothing.
    await panel.locator(".panel-close").click();
    await expect(panel).toBeHidden();
    await page.locator("#map path.affordance-cell").first().click();
    await expect(panel).toBeVisible();
  });

  test("the checkbox reveals sub-threshold cells in three distinct bands", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const cells = page.locator("#map path.affordance-cell");
    const before = await cells.count();

    await page.locator("#show-below").check();

    // More cells, and specifically the two the old single skip made
    // indistinguishable: a hard veto and "no rule said anything here". Being
    // able to tell those apart is the entire point of the checkbox — and the
    // vetoed cell was previously the one cell that could not be clicked to ask
    // why it was vetoed, because it was not drawn.
    await expect
      .poll(async () => cells.count(), REPAINT)
      .toBeGreaterThan(before);
    // BOTH of the two that were previously indistinguishable, not just one.
    // Asserting only the identity band would pass on a fixture with no vetoed
    // cells at all — and the vetoed cell is the one the checkbox exists for.
    // The park fixture carries 15 of them against the checked-in rule table.
    await expect(
      page.locator("#map path.affordance-cell-identity").first(),
    ).toBeAttached();
    await expect(
      page.locator("#map path.affordance-cell-veto").first(),
    ).toBeAttached();

    // The legend grows the three band swatches with it: colours on screen that
    // the legend does not explain are worse than no legend.
    await expect(page.locator("#legend .legend-band")).toHaveCount(3);
  });

  test("a vetoed cell explains WHY it is zero, which is the whole round", async ({
    page,
  }) => {
    // THE HEADLINE CLAIM, asserted end to end for the first time. Everything
    // else in this round is scaffolding for one question the owner asked of a
    // cemetery tile: "why is this zero when it is also a park and a meadow?"
    //
    // Answering it needs four separate pieces to line up — the cell must be
    // DRAWN (W7), be CLICKABLE, open a panel (W6), and that panel must name the
    // vetoing element and mark the tag that did it (explainCell). Each of those
    // is unit-tested in isolation; nothing until now proved they connect.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.locator("#show-below").check();
    const vetoed = page.locator("#map path.affordance-cell-veto").first();
    await expect(vetoed).toBeVisible();
    await vetoed.click();

    const panel = page.locator("#details");
    await expect(panel).toBeVisible();

    // The sentence a table of numbers cannot say. "Nothing is mapped here",
    // "something vetoed it" and "it scored but under the bar" all render as
    // near-identical rows; the summary is what separates them.
    await expect(panel.locator(".panel-summary")).toContainText(/vetoed/i);

    // The vetoing FEATURE is marked, and open by default — the reader should
    // not have to guess which of several rows holds the answer.
    const vetoFeature = panel.locator("details.panel-feature-veto").first();
    await expect(vetoFeature).toBeVisible();
    await expect(vetoFeature).toHaveAttribute("open", "");

    // And the vetoing TAG inside it, which is the actual answer: not "some
    // element zeroed this" but "this key=value did".
    await expect(
      vetoFeature.locator("tr.panel-tag-veto").first(),
    ).toBeVisible();

    // THE OTHER HALF OF THE QUESTION, and the reason a tree was built rather
    // than a one-line "vetoed by X" banner. The owner asked to see that it
    // "was a meadow and a park and maybe even had a bench, but that the
    // cemetery reset it to zero regardless of how high the other ratings
    // were" — so the outvoted contributors must still be listed under the veto.
    expect(
      await panel.locator("details.panel-feature").count(),
    ).toBeGreaterThan(1);

    // And "what about the bench?" — the tags the veto short-circuit never
    // evaluated, rendered struck through. That row class exists for exactly
    // this sentence and had never been looked at outside a unit test. Every
    // vetoed cell in the park fixture carries between one and five of them.
    await expect(panel.locator("tr.panel-tag-skipped").first()).toBeVisible();
  });

  test("the selection follows a category switch and is dropped when the user moves", async ({
    page,
  }) => {
    // The store's central promise: the panel can never describe a cell in a
    // category the map is no longer showing, and can never describe a cell
    // belonging to a place the user has left. Both rules live in one reducer,
    // one line apart, and both are invisible to every other test here.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.locator("#map path.affordance-cell").first().click();
    const panel = page.locator("#details");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".panel-header strong")).toContainText(
      "walkable",
    );

    // A category change KEEPS the selection — "what does this same cell score
    // for battleArea?" is the obvious next click, and clearing it would make
    // that question impossible to ask.
    const other = await page.evaluate(() => {
      const select = document.getElementById("category");
      const values = [...(select?.querySelectorAll("option") ?? [])].map(
        (o) => o.value,
      );
      return values.find((v) => v !== "walkable") ?? "";
    });
    test.skip(other === "", "rule table declares only one category");
    await page.locator("#category").selectOption(other);

    await expect(panel).toBeVisible();
    // Re-explained in the NEW category, not left showing the old answer.
    await expect(panel.locator(".panel-header strong")).toContainText(other);

    // Moving the user DROPS it: the cell belongs to the place being left.
    //
    // The click has to land on BARE map, and that is not incidental. A click on
    // a cell selects without moving — Leaflet's `bindPopup` stops propagation,
    // so the map's own click handler never fires — while a click on empty map
    // moves without selecting. Asserting the precondition means a fixture whose
    // grid grows to cover this point fails loudly here rather than quietly
    // passing for the wrong reason.
    const point = { x: 60, y: 60 };
    const box = await page.locator("#map").boundingBox();
    if (box === null) throw new Error("no map box");
    const onCell = await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x, y)
          ?.classList.contains("affordance-cell") === true,
      [box.x + point.x, box.y + point.y],
    );
    expect(onCell).toBe(false);

    await page.locator("#map").click({ position: point });
    await expect(panel).toBeHidden();
  });
});

test.describe("the mobile layout", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("puts the 3D view behind a draggable map sheet", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const scene = page.locator("#scene");
    const map = page.locator("#map");
    const main = page.locator("main");

    const [sceneBox, mapBox, mainBox] = await Promise.all([
      scene.boundingBox(),
      map.boundingBox(),
      main.boundingBox(),
    ]);
    if (sceneBox === null || mapBox === null || mainBox === null) {
      throw new Error("no layout boxes");
    }

    // DEC-10: the 3D view fills the viewport rather than taking half of it.
    // The old layout gave each view half the height, which is what made the 3D
    // pane a letterbox on a phone.
    expect(sceneBox.height).toBeGreaterThan(mainBox.height * 0.9);
    // The map sits over it as a bottom sheet, not beside it.
    expect(mapBox.width).toBeCloseTo(mainBox.width, 0);
    expect(mapBox.y + mapBox.height).toBeCloseTo(mainBox.y + mainBox.height, 0);

    // And it can be dragged, which is the whole of D8's resizing ask — the
    // sheet IS the splitter, so there is no second affordance to find.
    const handle = page.locator("#sheet-handle");
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error("no handle box");

    // THE GRAB BAR MUST START ON THE SHEET'S EDGE, before any drag. It is
    // absolutely positioned, and while its offset was set only by the drag
    // handler it fell back to its static position — the TOP of the grid
    // container — leaving a 24 px bar floating over the 3D view ~400 px from
    // the sheet it resizes. The drag test could not see it: it grabs the bar
    // wherever it is and the first move snaps the sheet to the clamp anyway.
    expect(
      Math.abs(handleBox.y + handleBox.height / 2 - mapBox.y),
    ).toBeLessThan(handleBox.height);

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 150);
    await page.mouse.up();

    await expect
      .poll(async () => (await map.boundingBox())?.height ?? 0, {
        timeout: 5000,
      })
      .toBeGreaterThan(mapBox.height + 50);
  });

  test("keeps the 3D view painted while the sheet is dragged", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS (finding N1, the second half of R2-3). The sheet
    // drag is the OTHER caller of `BuildingView.resize()`, and it is the harsh
    // one: the window path calls resize once, this path calls it on every
    // pointer move. Each call reallocates and therefore CLEARS the drawing
    // buffer, so without a repaint the 3D backdrop goes blank the instant the
    // sheet starts moving and stays blank — on the one layout where the 3D view
    // is the full-screen background.
    //
    // The existing drag test above cannot see this: it asserts the sheet's
    // HEIGHT, never the canvas contents, so a blank backdrop passes it.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const painted = () =>
      page.evaluate(() => {
        const el = document.querySelector("#scene canvas");
        if (!(el instanceof HTMLCanvasElement)) return -1;
        const probe = document.createElement("canvas");
        probe.width = el.width;
        probe.height = el.height;
        const ctx = probe.getContext("2d");
        if (ctx === null) return -1;
        ctx.drawImage(el, 0, 0);
        const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 0x11 + 0x13 + 0x1a + 60) {
            count++;
          }
        }
        return count;
      });

    expect(await painted()).toBeGreaterThan(500);

    const handle = page.locator("#sheet-handle");
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error("no handle box");

    // A MULTI-STEP drag, so `resize()` is called repeatedly rather than once —
    // that is the coalescing path, and a per-event repaint would show up here
    // as a timeout rather than as a wrong picture.
    const x = handleBox.x + handleBox.width / 2;
    await page.mouse.move(x, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    for (const dy of [30, 60, 90, 120, 150]) {
      await page.mouse.move(x, handleBox.y - dy);
    }
    await page.mouse.up();

    await expect.poll(painted, REPAINT).toBeGreaterThan(500);
  });
});

test.describe("my location", () => {
  test("moves the user to a real fix, and says so while it is working", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    // Cologne Volksgarten — the fixture's own centre, so the refresh that
    // follows has data to score rather than an empty working set.
    await context.setGeolocation({ latitude: 50.9231, longitude: 6.9445 });
    await stubNetwork(page);
    // Deliberately NOT `AT_FIXTURE`: starting at the default proves the button
    // moved the user, rather than confirming where they already were.
    await page.goto("/");
    await waitForRefresh(page);

    const button = page.locator(".locate-button");
    await expect(button).toHaveAttribute("data-state", "idle");

    await button.click();

    // The button must reach a terminal state; `located` then relaxes back to
    // `idle` after a few seconds, so either is a pass here. What must NOT
    // happen is being stuck on `locating`.
    await expect
      .poll(async () => button.getAttribute("data-state"), { timeout: 10000 })
      .toMatch(/located|idle/);

    // And the fix actually drove a refresh — the status line reports the new
    // working set rather than the one it booted with.
    await expect(page.locator("#status")).toContainText("cells");

    // THE VIEWPORT MUST MOVE TOO, and asserting the status line alone missed
    // this: `map.locate({ setView: false })` deliberately leaves panning to the
    // app, and for a while nothing did it. The marker, the new grid and the
    // fetch box were all placed correctly — 2 km outside the visible map, at
    // zoom 18. A working button and a dead one looked identical.
    // Asserted through what a user would see rather than through Leaflet's
    // internals: the marker sits at the fix, so if the viewport did not follow
    // it, the marker is simply not on screen.
    const marker = page.locator("#map path.user-marker");
    await expect(marker).toBeVisible();
    const [markerBox, mapBox] = await Promise.all([
      marker.boundingBox(),
      page.locator("#map").boundingBox(),
    ]);
    if (markerBox === null || mapBox === null) throw new Error("no boxes");
    // Near the centre, because that is where `setView` puts it.
    expect(Math.abs(markerBox.x - (mapBox.x + mapBox.width / 2))).toBeLessThan(
      mapBox.width / 4,
    );
    expect(Math.abs(markerBox.y - (mapBox.y + mapBox.height / 2))).toBeLessThan(
      mapBox.height / 4,
    );
  });

  test("is a square pin in the bottom-right, and still names its state", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS (DEC-R2-3). Going icon-only removes the visible text
    // that used to carry every state, and the easy mistake is to remove the text
    // and forget that it WAS the accessible name — leaving a button that says
    // nothing to a screen reader and nothing on touch, where `title` never shows.
    // So the label is asserted as an attribute, not as content.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const button = page.locator(".locate-button");
    await expect(button).toBeVisible();

    // SQUARE, and therefore stable: the old button's width swung from
    // "my location" to "location permission denied", i.e. it changed size when it
    // failed.
    const box = await button.boundingBox();
    if (box === null) throw new Error("no button box");
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);

    // An inline SVG pin, not an image request and not an emoji.
    await expect(button.locator("svg path")).toHaveCount(1);

    // The wording moved to `title`/`aria-label` rather than being deleted.
    await expect(button).toHaveAttribute("aria-label", /location/i);
    await expect(button).toHaveAttribute("title", /location/i);

    // BOTTOM RIGHT, and above the attribution rather than over it — the ODbL
    // credit has to stay visible.
    const [mapBox, attribution] = await Promise.all([
      page.locator("#map").boundingBox(),
      page.locator("#map .leaflet-control-attribution").boundingBox(),
    ]);
    if (mapBox === null) throw new Error("no map box");
    expect(box.x).toBeGreaterThan(mapBox.x + mapBox.width / 2);
    expect(box.y).toBeGreaterThan(mapBox.y + mapBox.height / 2);
    if (attribution !== null) {
      // Strictly above it, not overlapping it.
      expect(box.y + box.height).toBeLessThanOrEqual(attribution.y + 1);
    }
    await expect(
      page.locator("#map .leaflet-control-attribution"),
    ).toContainText("OpenStreetMap");
  });

  test("reports a denied permission instead of hanging on 'locating…'", async ({
    page,
    context,
  }) => {
    // The failure path is half of `CLAUDE.md`'s async-feedback rule, and it is
    // the half that gets skipped: a button stuck on "locating…" forever looks
    // exactly like a slow GPS fix, so nobody reports it as a bug.
    await context.clearPermissions();
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.locator(".locate-button").click();

    await expect
      .poll(
        async () => page.locator(".locate-button").getAttribute("data-state"),
        {
          timeout: 10000,
        },
      )
      .toMatch(/denied|unavailable|timeout|idle/);
    await expect(page.locator("#status")).toContainText(
      /denied|unavailable|timed out/,
    );
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

  test("repaints after a viewport resize, without waiting for a camera drag", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS (finding R2-3). The view renders ON DEMAND — a
    // permanent rAF loop was measured and rejected (it made this suite ~6x
    // slower and would burn phone battery repainting a static city), so frames
    // are scheduled only from the `controls` change event and the render entry
    // points. `resize()` updated the renderer and the camera and scheduled
    // NOTHING. Setting `canvas.width`/`height` clears the drawing buffer, so
    // the pane went blank and STAYED blank until the user happened to drag the
    // camera — which is exactly how it was reported ("bis zum nächsten Mal,
    // wenn ich die Kamera dragge, dann ist es wieder da").
    //
    // The existing pixel test cannot catch this: it only ever runs at one
    // viewport. The assertion has to be "resize, then look, WITHOUT touching
    // the camera" — any pointer interaction repairs the symptom and makes a
    // broken build pass.
    await stubNetwork(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const canvas = page.locator("#scene canvas");
    await expect(canvas).toBeVisible();

    /** Non-background pixels in the drawing buffer. Same probe as above. */
    const painted = () =>
      page.evaluate(() => {
        const el = document.querySelector("#scene canvas");
        if (!(el instanceof HTMLCanvasElement)) return -1;
        const probe = document.createElement("canvas");
        probe.width = el.width;
        probe.height = el.height;
        const ctx = probe.getContext("2d");
        if (ctx === null) return -1;
        ctx.drawImage(el, 0, 0);
        const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 0x11 + 0x13 + 0x1a + 60) {
            count++;
          }
        }
        return count;
      });

    expect(await painted()).toBeGreaterThan(500);

    // WAIT FOR THE SCENE TO GO QUIESCENT BEFORE RESIZING, or this test is
    // flaky in the direction that hides the bug. `waitForRefresh` returns when
    // the status line says "N cells", but the startup terrain load schedules
    // its own frame through `setTerrain`, and that frame can land AFTER the
    // resize — repainting the canvas for a reason unrelated to `resize()` and
    // making a broken build pass. (Observed: this test passed once against
    // unfixed code for exactly that reason before the wait was added.)
    //
    // Polling for a stable drawing buffer rather than sleeping: the condition
    // being waited on is "nothing is repainting any more", which is precisely
    // what two identical reads establish.
    const fingerprint = () =>
      page.evaluate(() => {
        const el = document.querySelector("#scene canvas");
        return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
      });
    let previous = await fingerprint();
    await expect
      .poll(async () => {
        const current = await fingerprint();
        const stable = current === previous;
        previous = current;
        return stable;
      }, REPAINT)
      .toBe(true);

    // Still a DESKTOP width, so the mobile overlay layout does not change what
    // is on screen for reasons unrelated to repainting.
    await page.setViewportSize({ width: 1000, height: 700 });

    // Poll rather than assert once: the repaint is one rAF away, and the
    // resize listener has to run first. A bare read races the frame.
    await expect.poll(painted, REPAINT).toBeGreaterThan(500);
  });

  test("renders the BUILDINGS, not just the affordance grid", async ({
    page,
  }) => {
    // WHY THIS TEST EXISTS, and why the one below it was not enough. "actually
    // draws pixels" counts everything that is not the background, so the hex grid
    // alone satisfies it — and that is exactly what shipped: every
    // `MeshStandardMaterial` in the scene (buildings, trees, ground plane, plates)
    // failed to compile its fragment shader, leaving a scene of nothing but the
    // grid, while a green suite and a status line reporting "21 volumes" both said
    // it was fine.
    //
    // Buildings are keyed on NEUTRALITY, not brightness. The material is 0xc8ccd8
    // but it renders at about (133,137,148) once lit, so a brightness threshold
    // picked by eye from the source colour misses them entirely — which is exactly
    // what the first version of this test did, reporting 0 while the buildings were
    // plainly on screen in the captured PNG.
    //
    // Everything else in the frame is either saturated (the heat ramp's purples and
    // teals), blue (the sky, up to 92,108,140 — and max-min 48) or dark (the ground,
    // 0x3a4356). Only the buildings are simultaneously bright and near-grey, so
    //  isolates them. Measured, not guessed: 13,874
    // pixels at the default framing.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const buildingPixels = () =>
      page.evaluate(() => {
        const el = document.querySelector("#scene canvas");
        if (!(el instanceof HTMLCanvasElement)) return -1;
        const probe = document.createElement("canvas");
        probe.width = el.width;
        probe.height = el.height;
        const ctx = probe.getContext("2d");
        if (ctx === null) return -1;
        ctx.drawImage(el, 0, 0);
        const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (min > 110 && max - min < 40) count++;
        }
        return count;
      });

    // The fixture has 21 building volumes at the default framing. A generous floor:
    // the assertion that matters is "not zero", because zero is what a shader that
    // failed to compile produces.
    await expect.poll(buildingPixels, REPAINT).toBeGreaterThan(2000);
  });

  test("has a graded sky, so the ground reads against it", async ({ page }) => {
    // WHY THIS TEST MATTERS (DEC-R2-2). The background was 0x11131a and the ground
    // 0x1d2230 — two near-blacks, which is the whole reported symptom.
    //
    // WHAT IT ASSERTS, AND WHY THE THRESHOLD IS SMALL. The gradient's SHAPE is
    // pinned by five unit tests in `sky-gradient.test.ts` (orientation,
    // monotonicity, opacity, contrast against the ground). This test's job is only
    // that it reached the canvas.
    //
    // The threshold has to be small because only a sliver of sky is on screen: the
    // ground plane is 2.8 km across, so at this camera it fills everything below
    // ~7% of the frame height, and the gradient across that sliver is about 1 luma.
    // An earlier version asserted +8 between 2% and 45% — which passed only because
    // the ground plane was not being drawn at all (every MeshStandardMaterial had
    // failed to compile), so it was measuring sky against sky. It started failing
    // the moment that was fixed.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT. The gradient's SHAPE —
    // orientation, monotonicity, opacity, contrast against the ground — is pinned by
    // five unit tests in `sky-gradient.test.ts`, where it can be checked exactly.
    // This test only establishes that the gradient reached the canvas.
    //
    // The slope is NOT asserted here, and that is a measurement rather than a
    // preference: the ground plane is 2.8 km across, so only a thin band of sky is
    // on screen at this camera, and the luma change across that band is about 1 —
    // below the dithering noise, and a threshold on it would be flaky by
    // construction. An earlier version asserted +8 luma and passed only because
    // every MeshStandardMaterial had failed to compile, so the ground plane was not
    // drawn and it was comparing sky against sky.
    const sky = await page.evaluate(() => {
      const el = document.querySelector("#scene canvas");
      if (!(el instanceof HTMLCanvasElement)) return null;
      const probe = document.createElement("canvas");
      probe.width = el.width;
      probe.height = el.height;
      const ctx = probe.getContext("2d");
      if (ctx === null) return null;
      ctx.drawImage(el, 0, 0);
      // Top-left: above the horizon at any framing this scene uses.
      const [r, g, b] = ctx.getImageData(2, 2, 1, 1).data;
      return {
        r: r ?? 0,
        g: g ?? 0,
        b: b ?? 0,
        luma: 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0),
      };
    });
    if (sky === null) throw new Error("no canvas");

    // NOT the old near-black. 0x11131a is luma ~19, and that flat dark background
    // against a barely-lighter ground is the whole reported symptom.
    expect(sky.luma).toBeGreaterThan(40);
    // And it is SKY-coloured rather than grey: the gradient is a desaturated blue,
    // so blue leads red by a clear margin. A flat grey or a black clear-colour
    // would not.
    expect(sky.b).toBeGreaterThan(sky.r + 20);
  });

  test("the ground's shading changes as the camera moves, revealing its facets", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS, and what it deliberately does NOT assert. DEC-R2-1
    // kept normal-based flat shading and accepted that genuinely flat ground
    // looks flat — so "the terrain looks bumpy" is not a claim this build makes
    // and must not be tested. What IS claimed is that the surface is reflective:
    // a specular highlight slides across the facets as the camera moves, which is
    // the cue that reveals them. That is a claim about CHANGE under motion, so a
    // static screenshot cannot express it and neither can a material unit test
    // (the class needs a WebGLRenderer and cannot be constructed under vitest).
    //
    // Sampled from a band low in the frame, where the ground fills the view,
    // rather than the whole canvas — otherwise the existing "dragging moves the
    // camera" test would already cover it and this would prove nothing extra.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const groundBand = () =>
      page.evaluate(() => {
        const el = document.querySelector("#scene canvas");
        if (!(el instanceof HTMLCanvasElement)) return "";
        const probe = document.createElement("canvas");
        probe.width = el.width;
        probe.height = el.height;
        const ctx = probe.getContext("2d");
        if (ctx === null) return "";
        ctx.drawImage(el, 0, 0);
        // A low, wide strip: mostly ground plane at the default camera.
        const y = Math.floor(el.height * 0.85);
        const { data } = ctx.getImageData(0, y, el.width, 1);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += data[i] + data[i + 1] + data[i + 2];
        }
        return String(sum);
      });

    const before = await groundBand();
    expect(before).not.toBe("");

    const canvas = page.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");
    // A small orbit — enough to move the highlight, not enough to leave the city.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 - 40,
      box.y + box.height / 2 - 20,
    );
    await page.mouse.up();

    await expect.poll(groundBand, REPAINT).not.toBe(before);
  });

  test("can be navigated — dragging the canvas moves the camera", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const canvas = page.locator("#scene canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");

    /** A cheap fingerprint of what is on screen: the drawing buffer as a URL. */
    const shot = () =>
      page.evaluate(() => {
        const el = document.querySelector("#scene canvas");
        return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
      });

    const before = await shot();

    // THE WHOLE POINT OF W8, and it needs BOTH halves to pass. Before this the
    // view had a fixed camera and no rAF loop, so it was inert in two
    // independent ways: nothing listened to the pointer, and even if something
    // had moved the camera, nothing would ever have repainted. A test that only
    // checked "a controller is attached" would pass with a frozen picture.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2);
    await page.mouse.up();

    await expect.poll(shot, REPAINT).not.toBe(before);
  });

  test("draws the affordance grid too, and a click on it opens the panel", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // Finding M3: the 3D pane showed buildings and nothing else, so the two
    // views disagreed about what the app was even displaying. The grid being
    // present is asserted through a PICK rather than through pixels, because a
    // pick proves the geometry is both drawn and correctly indexed — a coloured
    // hexagon nobody can identify would pass a pixel test and still be useless.
    const canvas = page.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");

    const panel = page.locator("#details");
    await expect(panel).toBeHidden();

    // Sweep a short arc through the middle of the scene: the fixture's grid
    // covers the centre, but the exact pixel depends on the camera.
    for (const [dx, dy] of [
      [0, 0],
      [-40, 20],
      [40, 20],
      [0, 60],
      [-80, 60],
    ]) {
      await page.mouse.click(
        box.x + box.width / 2 + dx,
        box.y + box.height / 2 + dy,
      );
      if (await panel.isVisible()) break;
    }

    await expect(panel).toBeVisible();
    // The SAME panel a 2D click opens — one selection, one explanation, and the
    // panel does not know which view produced it.
    await expect(panel.locator(".panel-summary")).not.toBeEmpty();
  });

  test("stands the buildings on real terrain, and credits where it came from", async ({
    page,
  }) => {
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // The DEM tile is served as a REAL PNG, so this exercises the entire path:
    // fetch, decode, bilinear sample, displace. If the encoding in `fixtures.js`
    // were wrong, `createImageBitmap` would reject, every sample would come back
    // undefined, and the status line would say "unavailable" instead — which is
    // exactly what makes this assertion worth making.
    await expect
      .poll(async () => page.locator("#status").textContent(), {
        timeout: 10000,
      })
      .toMatch(/terrain/);
    await expect(page.locator("#status")).not.toContainText(
      "terrain unavailable",
    );
    expect(counts.terrain).toBeGreaterThan(0);

    // Attribution is required wherever the data is shown, exactly as for OSM —
    // and it lives in Leaflet's attribution control rather than the header,
    // because the header collapses and a credit that can be collapsed away does
    // not satisfy the obligation (DEC-R2-4).
    await expect(
      page.locator("#map .leaflet-control-attribution"),
    ).toContainText(/Terrain|Mapzen/);

    // And the terrain is actually doing something, not merely fetched. The
    // relief is in the status line because a viewer needs it for the same
    // reason a test does: "the DEM loaded and this place is flat" and "the DEM
    // did not load" render identically, and only a number tells them apart.
    // The fixture tile spans 0..40 m, so the relief must be tens of metres.
    const status = await page.locator("#status").textContent();
    const relief = /terrain ±(\d+) m/.exec(status ?? "");
    expect(relief).not.toBeNull();
    expect(Number(relief?.[1] ?? 0)).toBeGreaterThan(5);
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
    // relief. It is MORE load-bearing now than when that was reported — there
    // is real terrain since W11, and the status line carries its relief as a
    // second height right next to this one. The two answer different questions:
    // how many footprints carried no `height` tag, and how much relief the DEM
    // found.
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
    // while `nonFatalError` leaves it alone.
    await expect(page.locator("#map path.affordance-cell")).toHaveCount(0);
  });
});
