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

import {
  AT_FIXTURE,
  countNonSkyPixels,
  diffFromStash,
  expectCanvasFillsContainer,
  installFrameProbe,
  recordStatus,
  stashFrame,
  stashStableFrame,
  stubNetwork,
  waitForRefresh,
  enableCellLayer,
} from "./fixtures.js";

test.describe("the demo boots", () => {
  test("loads the rule table, draws a basemap, reports its scale, and says when it is still widening", async ({
    page,
  }) => {
    // FOUR BEHAVIOURS, ONE BOOT. All four assert on the SAME boot and none of
    // them mutates anything, so paying for four boots bought nothing but wall
    // clock. `test.step` keeps each one separately named in the report, which is
    // what stops a failure from pointing at a group instead of at a behaviour.
    //
    // The status observer is installed AFTER `goto` and BEFORE `waitForRefresh`:
    // it lives in the page, so navigating destroys it, and the widening step
    // needs it recording across the very boot the other three then assert on.
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    const history = await recordStatus(page);
    await waitForRefresh(page);

    await test.step("loads the rule table and populates the category picker", async () => {
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

    await test.step("requests basemap tiles, so the grid has something to sit on", async () => {
      // `counts.basemap` was incremented and never read by anything — and unlike
      // an unused TypeScript export, nothing in the gate would say so: knip does
      // not reach into `playwright-tests/`, and this project has no lint stage.
      // Spending it is better than deleting it: a Leaflet tile layer that never
      // requests a tile still renders a perfectly convincing empty map, and
      // "the affordance cells are drawn" would keep passing over a blank canvas.
      expect(counts.basemap).toBeGreaterThan(0);
    });

    await test.step("reports the scale it is drawing with, as a legend", async () => {
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

    await test.step("says it is still widening, and then stops saying it", async () => {
      // F42, and this is the USER-FACING half of that fix rather than a test
      // convenience. Scoring widens over three rings and publishes after each one,
      // and `snapshotReady` sets `loading: idle` every time — so the status line
      // presented ring 2's cell, region and triangle counts exactly as it presents
      // the final ones. A user watched a settled-looking answer silently change
      // twice with nothing to say more was coming. The counts were never wrong;
      // the impression that they were final was.
      //
      // THROUGH THE MUTATION OBSERVER, not a poll. The widening marker is on
      // screen only between the first ring publishing and the last, and a poll
      // interval wide enough to be cheap is wide enough to miss it entirely —
      // which would mean this test passes on the bug it exists to catch. That is
      // the same reason `recordStatus` exists for the superseded-refresh test.
      const seen = await history();
      // It appeared at least once, alongside a real cell count — a marker on an
      // empty status line would prove nothing about which snapshot it qualified.
      expect(
        seen.filter((t) => /widening/.test(t) && /\d+ cells/.test(t)),
      ).not.toHaveLength(0);

      // And it is GONE at the end. `waitForRefresh` now waits for exactly this, so
      // a marker that never cleared would hang the whole suite rather than fail
      // here — but asserting it keeps the reason visible at the point of the claim.
      await expect(page.locator("#status")).not.toContainText("widening");
      await expect(page.locator("#status")).toContainText(/\d+ cells/);
    });
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

test.describe("the location picker", () => {
  test("moves the map and re-runs the pipeline (W5)", async ({ page }) => {
    // WHY THIS TEST MATTERS. The unit test pins that the picker reports the
    // right POSITION; nothing there proves the report reaches Leaflet and the
    // store. This is the wiring half, and its failure mode is the quiet one —
    // a picker that changes its own value and nothing else looks exactly like a
    // picker whose site happens to have no data.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // The markup carries no place names of its own — `index.html` ships an
    // EMPTY `<select>` and `attachSitePicker` fills it. WHICH places, and how
    // many, is `picker-places.test.ts`'s assertion against the list; repeating
    // a count here only bought a second place to update, and duly broke when
    // DEC-R6b-4 took the list from six to fourteen. What this has to catch is
    // the picker never running at all, which leaves the placeholder alone.
    const options = page.locator("#site option");
    await expect(options).not.toHaveCount(1);
    await expect(options.first()).toHaveValue("");

    /** Basemap tiles requested from the moment the choice is made. */
    const tilesAfter = [];
    const tilesBefore = new Set();
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes("tile.openstreetmap.org")) return;
      tilesAfter.push(url);
    });
    for (const url of tilesAfter.splice(0)) tilesBefore.add(url);

    // Porto, since DEC-R6b-1 dropped Heidelberg from the dropdown. It has to be
    // a place the picker actually OFFERS: `selectOption` on a value with no
    // matching option throws, so this line is itself a check that the id in the
    // list and the id used here have not drifted apart.
    await page.selectOption("#site", "porto-ribeira");

    // Leaflet requests tiles for wherever it now is. Porto is ~1500 km from
    // Cologne, so at zoom 18 not one tile of the previous view can be reused —
    // a map that did not move would request nothing new at all.
    await expect
      .poll(() => tilesAfter.filter((url) => !tilesBefore.has(url)).length, {
        timeout: 15000,
      })
      .toBeGreaterThan(0);

    // And the data pipeline re-ran rather than only the basemap panning.
    await waitForRefresh(page);
    await expect(page.locator("#status")).toContainText(/\d+ cells/);
  });
});

test.describe("the header", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("collapses, expands itself for an error, and never hides attribution", async ({
    page,
    context,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    /**
     * Puts the bar in a known state before each step.
     *
     * NECESSARY BECAUSE `#header-toggle` TOGGLES. Each of these behaviours was
     * written against a fresh boot, where the bar starts expanded, and each does
     * its own `click()` to collapse. Sharing one boot means a step can inherit a
     * collapsed bar from the step before and have its click EXPAND instead —
     * which would not fail loudly, it would assert the opposite of the intent.
     * Restoring the boot state is the exact translation.
     */
    const expandHeader = async () => {
      const bar = page.locator("#header-bar");
      if ((await bar.getAttribute("data-collapsed")) === "true") {
        await page.locator("#header-toggle").click();
      }
      await expect(bar).toHaveAttribute("data-collapsed", "false");
    };

    await test.step("collapses to give its height back to the 3D view", async () => {
      // WHY THIS TEST MATTERS, and why it asserts HEIGHT rather than visibility.
      // The feedback assumed the header already floats over the 3D view. It does
      // not — it is a grid row, so on a phone its wrapped lines are taken OUT of
      // the 3D view's height. That makes collapsing a real win rather than a
      // cosmetic one, and "the bar got shorter" is the only assertion that shows it.
      await expandHeader();
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

      // THE CONTROLS THAT STEER THE DEMO STAY REACHABLE (DEC-R2-4, narrowed by
      // DEC-R6b-5). Collapsing the category picker away would put a primary
      // input two taps from reach, and hiding the legend would re-create the
      // round-1 problem it was added to fix. The GROUND picker is no longer on
      // this list — see the dedicated collapse step below for why.
      await expect(page.locator("#category")).toBeVisible();
      await expect(page.locator("#legend")).toBeVisible();

      await page.locator("#header-toggle").click();
      await expect(header).toHaveAttribute("data-collapsed", "false");
    });

    await test.step("expands itself when an error needs to be read", async () => {
      // DEC-R2-15. The status line lives inside the header, and failures are
      // reported into it — so a collapsed header would swallow the message and the
      // demo would look like it did nothing. Driven through a REAL failure (a
      // refused geolocation permission) rather than by dispatching by hand, because
      // the wiring from reporter to reveal is the part that can be missing.
      await context.clearPermissions();
      await expandHeader();

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

    await test.step("keeps the terrain attribution visible even when collapsed", async () => {
      // Attribution is required wherever the data is shown, so it may not be
      // collapsed away. It moved out of the header into Leaflet's attribution
      // control (DEC-R2-4), which is always visible.
      await expandHeader();
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
});

test.describe("the layer toggles", () => {
  test("switch geometry, draw plates, and clear the grid in both views", async ({
    page,
  }) => {
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("switch geometry off and on without refetching", async () => {
      // WHY THIS TEST MATTERS (W10, DEC-R2-10/12). The registry's whole purpose is
      // that a later AR mode can ask for buildings + POI markers and skip ground
      // plates. That is only true if a switch actually changes what is BUILT — and
      // the cheap mistake is to gate the drawing while still doing all the work, or
      // to trigger a refetch for a presentation-only change.
      //
      // Asserted through the status line's own counters rather than pixels: they are
      // reported from what was drawn, so they cannot agree with a wrong picture.
      //
      // Generated from ALL_LAYERS, so a new builder cannot arrive without a switch.
      //
      // The number is DUPLICATED here rather than derived, because this file is
      // plain JS running in node and `layers.ts` is TypeScript served by vite —
      // there is no import that reaches it. The duplication is tolerable precisely
      // because it fails loudly and immediately: adding `terrainDebug` turned this
      // red on the very next gate run, and REMOVING it (W6, DEC-R5-4) turned it red
      // again — which is the whole value of asserting a count. `layers.test.ts`
      // pins the actual list.
      // `[data-layer]` RATHER THAN EVERY CHECKBOX IN THE CONTAINER. W15 grouped
      // the switches and put the perf toggle inside the diagnostics group, and it
      // is deliberately NOT a layer — so the loose selector started counting 9 and
      // this assertion failed for a reason that had nothing to do with the layers.
      // The attribute is what "is a layer switch" actually means.
      await expect(
        page.locator("#layers input[type=checkbox][data-layer]"),
      ).toHaveCount(7);

      // FIVE OF SEVEN START ON (DEC-R7b-5, DEC-R7b-6). Round 4 turned every
      // layer on; round 8 took landuse and cells back off after a session saw
      // the demo with the terrain relief carrying the ground. Both halves are
      // asserted, because an accidental flip in either direction matters and
      // "at least one is on" would catch neither.
      //
      // The height ramp is not here at all: it is an appearance of the ground
      // mode rather than a layer (DEC-R5-4).
      await expect(page.locator("#layer-terrainDebug")).toHaveCount(0);
      await expect(page.locator("#layer-cells")).not.toBeChecked();
      await expect(page.locator("#layer-plates")).not.toBeChecked();
      await expect(page.locator("#layer-buildings")).toBeChecked();
      await expect(page.locator("#layer-trees")).toBeChecked();
      await expect(page.locator("#layer-areas")).toBeChecked();
      await expect(page.locator("#layer-poi")).toBeChecked();
      // W9 turned every layer on by default, so a test about switching a layer ON
      // has to switch it OFF first. Asserting the "off" state is still worth doing
      // — it is what proves the toggle works in both directions rather than only
      // in the one the test happens to exercise.
      await expect(page.locator("#layer-roads")).toBeChecked();
      await page.locator("#layer-roads").uncheck();
      await expect(page.locator("#layer-roads")).not.toBeChecked();

      const status = page.locator("#status");
      await expect(status).toContainText(/\d+ volumes/);
      const before = counts.overpassQuery;

      await page.locator("#layer-buildings").uncheck();

      // The counters must drop to zero volumes: the layer is genuinely not built,
      // not merely hidden.
      await expect(status).not.toContainText(/[1-9]\d* volumes/);
      // NO NETWORK REFETCH. Layers are presentation, so no Overpass query is
      // issued -- and that stays true even for `cells`, which since round 10
      // stage B DOES trigger a refresh when switched on. That refresh re-scores
      // from tiles the worker already holds, so the query count is untouched.
      //
      // The distinction is worth the words: "layers never refetch" was true when
      // this was written and is now true only of the NETWORK. Raised by this
      // comment surviving a change that falsified half of it.
      expect(counts.overpassQuery).toBe(before);

      // And the cells are independent — switching buildings off must not disturb
      // them. Cells start OFF since DEC-R7b-6, so this switches them on first:
      // the claim is that the two layers do not interfere, which needs both to
      // be observable rather than both to start in any particular state.
      await page.locator("#layer-cells").check();
      await expect(
        page.locator("#map path.affordance-cell").first(),
      ).toBeVisible();
      await page.locator("#layer-cells").uncheck();

      await page.locator("#layer-buildings").check();
      await expect(status).toContainText(/[1-9]\d* volumes/);
      expect(counts.overpassQuery).toBe(before);

      // Roads back on, so the next step starts from the boot state this one did.
      await page.locator("#layer-roads").check();
      await expect(page.locator("#layer-roads")).toBeChecked();
    });

    await test.step("draws ground plates when the layer is switched on", async () => {
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
      //
      // PLATES START OFF since DEC-R7b-6, which is what this step wanted all
      // along: it used to have to switch them off first because W9 turned every
      // layer on, and the round-8 default now provides that starting state
      // directly. The "off" assertion is kept — it is what proves the toggle
      // works in both directions rather than only in the one exercised below.
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
      // `\d`, not a bare `d`: the missing backslash made this match a literal "d",
      // so it could not match a two-digit count — and this fixture builds 11 plates.
      await expect(page.locator("#status")).toContainText(
        /[1-9]\d* ground areas/,
      );
      await expect.poll(shot, REPAINT).not.toBe(before);
    });

    await test.step("switching the cells layer off clears the grid in BOTH views", async () => {
      // The registry has to reach every view, or one of them keeps drawing a layer
      // the store says is off — the cross-view disagreement the store exists to
      // prevent, reintroduced by the mechanism meant to prevent it.
      // ON FIRST, since DEC-R7b-6 starts them off. The claim is that switching
      // the layer off clears BOTH views, which needs a visible "before".
      await page.locator("#layer-cells").check();
      await expect(
        page.locator("#map path.affordance-cell").first(),
      ).toBeVisible();

      await page.locator("#layer-cells").uncheck();

      await expect(page.locator("#map path.affordance-cell")).toHaveCount(0);
      // The 3D grid is inside a canvas, so it is asserted through the click it would
      // otherwise answer: with no grid there is nothing to pick.
      //
      // AREAS OFF TOO, since round 8 (DEC-R7b-3a). Region slabs became clickable,
      // and a slab lies directly under the grid — so with only the cells hidden
      // this click now selects the REGION and the panel legitimately opens. That
      // is the feature working, not the grid failing to clear, and leaving the
      // assertion as it stood would have made a working feature look like a
      // regression in an unrelated test.
      await page.getByRole("checkbox", { name: "areas" }).uncheck();
      const canvas = page.locator("#scene canvas");
      const box = await canvas.boundingBox();
      if (box === null) throw new Error("no canvas box");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator("#details")).toBeHidden();
    });
  });
});

test.describe("the affordance map", () => {
  test("draws the cells, the extent, the outlines, the popup — and redraws on a category switch", async ({
    page,
  }) => {
    // FIVE BEHAVIOURS, ONE BOOT, and the plan for this budgeted two tests here.
    // One is enough: the first four are read-only, and the category switch is the
    // only mutation, so it simply goes last. The ordering rule does the work that
    // a second boot would have.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // CELLS ON: they start OFF since DEC-R7b-6, and this test is about the
    // grid. Switching them on here rather than changing the default keeps the
    // default itself asserted in one place (the layer-toggle test).
    await enableCellLayer(page); // async since round 10 stage B

    await test.step("draws res-13 cells over the basemap", async () => {
      // The class exists so this assertion cannot be satisfied by the region
      // outlines: Leaflet renders every polygon as an indistinguishable <path>,
      // and a test matching all of them would pass with an empty grid.
      const cells = page.locator("#map path.affordance-cell");
      await expect(cells.first()).toBeVisible();
      expect(await cells.count()).toBeGreaterThan(10);
    });

    await test.step("draws the fetched extent as a box, and says how big it is", async () => {
      // WHY THIS MATTERS. "One res-7 tile" is the unit the whole plan is written
      // in, and it stays an abstraction until it is drawn over a city. The box is
      // also NOT the hexagon — Overpass has no hexagon primitive, so the query
      // covers the tile's bounding box and we pay ~39% over-fetch on every tile.
      // Both shapes are asserted because drawing only the box would confirm the
      // exact misreading the display exists to correct.
      await expect(
        page.locator("#map path.fetch-extent").first(),
      ).toBeVisible();
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

    await test.step("draws region outlines, and draws them OVER the cells", async () => {
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

    await test.step("a cell popup names the OSM elements that produced its score, and they are clickable", async () => {
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

      // CLOSED before the next step. A Leaflet popup is an overlay pane above the
      // cells, and the step below hovers one to read its tooltip — an open popup
      // left behind would swallow that hover and fail a step that is not about
      // popups at all.
      await page.locator(".leaflet-popup-close-button").click();
      await expect(popup).toHaveCount(0);
    });

    await test.step("switching category redraws the grid", async () => {
      const other = await page.evaluate(() => {
        const select = document.getElementById("category");
        const values = [...(select?.querySelectorAll("option") ?? [])].map(
          (o) => o.value,
        );
        return values.find((v) => v !== "walkable") ?? "";
      });
      test.skip(other === "", "rule table declares only one category");

      await page.locator("#category").selectOption(other);

      // THROUGH THE HELPER, NOT A BARE `toContainText` — the second instance of
      // a flake this file has already diagnosed once (see the "my location"
      // test, fixed 2026-08-02 with the same reasoning). Choosing a category
      // kicks off a full rescore; the bare assertion allowed only Playwright's
      // default 5 s, which under the ROOT cascade's contention expires while the
      // status line still reads "Fetching and scoring around 50.92310,
      // 6.94450…" — the pipeline working correctly and slowly, not a defect.
      // Captured exactly that way on 2026-08-04, having passed the package's own
      // gate twice; the extra load of the other seven packages is the difference.
      // `waitForRefresh` allows 60 s and waits for the progressive widening to
      // settle, which nearly every other test here already relies on.
      await waitForRefresh(page);
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
});

test.describe("explaining one cell", () => {
  test("opens a panel, reveals the bands, explains a veto, and follows the selection", async ({
    page,
  }) => {
    // FOUR BEHAVIOURS, ONE BOOT. The plan budgeted two tests here; one is enough
    // because the only genuinely irreversible act — MOVING the user, which drops
    // the selection — is the last thing the last step does. Everything before it
    // either reads or toggles a switch it puts back.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // CELLS ON: they start OFF since DEC-R7b-6, and this test is about the
    // grid. Switching them on here rather than changing the default keeps the
    // default itself asserted in one place (the layer-toggle test).
    await enableCellLayer(page); // async since round 10 stage B

    const panel = page.locator("#details");

    await test.step("clicking a cell opens a details panel explaining its score", async () => {
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

      // Deselected again, so the next step starts where a fresh boot would.
      await panel.locator(".panel-close").click();
      await expect(panel).toBeHidden();
    });

    await test.step("the checkbox reveals sub-threshold cells in three distinct bands", async () => {
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

    await test.step("a vetoed cell explains WHY it is zero, which is the whole round", async () => {
      // THE HEADLINE CLAIM, asserted end to end for the first time. Everything
      // else in this round is scaffolding for one question the owner asked of a
      // cemetery tile: "why is this zero when it is also a park and a meadow?"
      //
      // Answering it needs four separate pieces to line up — the cell must be
      // DRAWN (W7), be CLICKABLE, open a panel (W6), and that panel must name the
      // vetoing element and mark the tag that did it (explainCell). Each of those
      // is unit-tested in isolation; nothing until now proved they connect.
      //
      // The reveal switch is already on from the step above, which is the state
      // this step needs — it is checked again rather than assumed, because a step
      // that silently depends on its predecessor is the coupling fusion has to
      // avoid.
      await page.locator("#show-below").check();
      const vetoed = page.locator("#map path.affordance-cell-veto").first();
      await expect(vetoed).toBeVisible();
      await vetoed.click();

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

      // Back to the boot state: the reveal off, and nothing selected.
      await panel.locator(".panel-close").click();
      await page.locator("#show-below").uncheck();
    });

    await test.step("the selection follows a category switch and is dropped when the user moves", async () => {
      // The store's central promise: the panel can never describe a cell in a
      // category the map is no longer showing, and can never describe a cell
      // belonging to a place the user has left. Both rules live in one reducer,
      // one line apart, and both are invisible to every other test here.
      await page.locator("#map path.affordance-cell").first().click();
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
      // A category change starts its OWN progressive refresh (W16), and the panel
      // is re-explained on each ring. Capturing state before that settles races
      // three republishes — which is what made this test flaky in the suite while
      // passing standalone.
      await waitForRefresh(page);

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
});

test.describe("the mobile layout", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("puts the 3D view behind a draggable sheet, and keeps it painted", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // THE LAYOUT STEP RUNS FIRST because it asserts the sheet's RESTING
    // position, and the step after it drags the sheet somewhere else.
    await test.step("puts the 3D view behind a draggable map sheet", async () => {
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
      expect(mapBox.y + mapBox.height).toBeCloseTo(
        mainBox.y + mainBox.height,
        0,
      );

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
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y - 150,
      );
      await page.mouse.up();

      await expect
        .poll(async () => (await map.boundingBox())?.height ?? 0, {
          timeout: 5000,
        })
        .toBeGreaterThan(mapBox.height + 50);
    });

    await test.step("keeps the 3D view painted while the sheet is dragged", async () => {
      // WHY THIS TEST MATTERS (finding N1, the second half of R2-3). The sheet
      // drag is the OTHER caller of `BuildingView.resize()`, and it is the harsh
      // one: the window path calls resize once, this path calls it on every
      // pointer move. Each call reallocates and therefore CLEARS the drawing
      // buffer, so without a repaint the 3D backdrop goes blank the instant the
      // sheet starts moving and stays blank — on the one layout where the 3D view
      // is the full-screen background.
      //
      // The step above cannot see this: it asserts the sheet's HEIGHT, never the
      // canvas contents, so a blank backdrop passes it. It also leaves the sheet
      // already dragged, which does not weaken this step — the claim is that the
      // canvas survives a drag, and it is measured across a drag either way.
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
    // moved the user, rather than confirming where they already were. Since
    // DEC-R6b-3 the default is Manhattan, so the opening view is a whole ocean
    // away from the geolocation fix below — this test got STRONGER when the
    // default moved, not weaker.
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
    //
    // THROUGH THE HELPER, NOT A BARE `toContainText`. The button reaching a
    // terminal state says the FIX arrived; the pipeline it kicks off is a
    // separate, much longer job, and the bare assertion above it only allowed
    // Playwright's default 5 s. Under worker contention that expires while the
    // status line still reads "Fetching and scoring around 50.92310, 6.94450…",
    // which is the pipeline working correctly and slowly rather than a defect —
    // captured exactly that way in a gate run on 2026-08-02. `waitForRefresh`
    // allows 60 s and additionally waits for the progressive widening to settle,
    // which every other test in this file already relies on.
    await waitForRefresh(page);
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

  test("is a square pin that names its state, and reports a denied permission", async ({
    page,
    context,
  }) => {
    // TWO BEHAVIOURS, ONE BOOT. The third `my location` test keeps its own,
    // because it needs a granted permission and starts at `/` rather than at the
    // fixture — the boot itself is different, so there is nothing to share.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("is a square pin in the bottom-right, and still names its state", async () => {
      // WHY THIS TEST MATTERS (DEC-R2-3). Going icon-only removes the visible text
      // that used to carry every state, and the easy mistake is to remove the text
      // and forget that it WAS the accessible name — leaving a button that says
      // nothing to a screen reader and nothing on touch, where `title` never shows.
      // So the label is asserted as an attribute, not as content.
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

    await test.step("reports a denied permission instead of hanging on 'locating…'", async () => {
      // The failure path is half of `CLAUDE.md`'s async-feedback rule, and it is
      // the half that gets skipped: a button stuck on "locating…" forever looks
      // exactly like a slow GPS fix, so nobody reports it as a bug.
      await context.clearPermissions();
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
});

test.describe("the 3D view", () => {
  test("draws pixels and buildings, and repaints after a resize", async ({
    page,
  }) => {
    // THREE READ-MOSTLY BEHAVIOURS ON ONE BOOT, kept in file order so nothing
    // had to be moved to fuse them. The middle one resizes the viewport and
    // therefore PUTS IT BACK before it ends: the building step after it isolates
    // its pixels with a `min > 110 && max - min < 40` predicate whose counts were
    // measured at the boot size, and handing it a 1000x700 canvas would change
    // what it is counting for a reason that has nothing to do with buildings.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("actually draws pixels, not just a canvas element", async () => {
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

    await test.step("repaints after a viewport resize, without waiting for a camera drag", async () => {
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
      // The pixel step above cannot catch this: it only ever looks at one
      // viewport. The assertion has to be "resize, then look, WITHOUT touching
      // the camera" — any pointer interaction repairs the symptom and makes a
      // broken build pass.
      //
      // NO PRE-RESIZE TO A "KNOWN DESKTOP WIDTH" HERE, and the missing line is a
      // fix rather than an omission. While this was its own test that
      // `setViewportSize` ran BEFORE `goto`, so the scene was painted once at a
      // stable size and the reading below was safe. Sharing a boot moved it
      // AFTER the paint, where resizing clears the drawing buffer and the very
      // next `painted()` races the repaint that refills it — it read 0 against a
      // `> 500` floor, in a serial run, with the scene plainly on screen. The
      // boot viewport is already a known desktop width, so the line bought
      // nothing and cost a race.
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

      // BACK TO THE BOOT SIZE for the step after this one — see the note at the
      // top of this test. The claim above has already been asserted, so
      // restoring costs nothing but one more repaint.
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect.poll(painted, REPAINT).toBeGreaterThan(500);
    });

    await test.step("renders the BUILDINGS, not just the affordance grid", async () => {
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
      // `min > 110 && max - min < 40` isolates them — the predicate below. Measured,
      // not guessed: 13,874 pixels at the default framing.

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
  });

  test("shows the terrain as a ramp, and the GPU path matches the CPU one", async ({
    page,
  }) => {
    // BOTH GROUND BEHAVIOURS ON ONE BOOT. The ramp step asserts the DEFAULT
    // ground mode, so it has to precede the A/B that changes it.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("shows the terrain as a height ramp, which is the default ground", async () => {
      // WHY THIS TEST MATTERS (W24, DEC-R2-25). The ramp exists to answer "did the
      // DEM load, or is this place simply flat?" — a question DEC-R2-1's deliberately
      // near-flat look leaves to a single number in the status line. A ramp that is
      // built but never reaches the screen answers nothing, and that is not a
      // hypothetical here: the plates layer spent ten work items in exactly that
      // state, counted and reported and completely invisible.
      //
      // So this asserts PIXELS, and asserts the ramp's own colours rather than "the
      // canvas changed". The ramp is saturated by construction and the scene it
      // replaces is not — every other surface in this view is a desaturated blue-grey
      // — so counting strongly-saturated pixels distinguishes the ramp from any
      // amount of ordinary repainting.

      // Counts the ramp's OWN two ends, not "saturated pixels".
      //
      // The first version of this counted saturation, and it would have passed on a
      // ground rendered entirely in `NO_DATA_RGB` magenta — which is the exact
      // failure the ramp exists to make visible, so the test would have been green
      // on the worst possible output. Measured before it was rewritten: the real
      // ramp's floor renders as rgb(64,64,160) and its top as rgb(224,224,224),
      // after three's linear-to-sRGB output conversion.
      //
      // Asserting BOTH ends is what makes it a ramp rather than a flat wash: cool
      // for the low ground, bright and neutral for the high ground. Magenta
      // (255,0,255) satisfies neither — blue does not lead red, and green is 0.
      const rampEnds = () =>
        page.evaluate(() => {
          const el = document.querySelector("#scene canvas");
          if (!(el instanceof HTMLCanvasElement))
            return { cool: -1, bright: -1 };
          const probe = document.createElement("canvas");
          probe.width = el.width;
          probe.height = el.height;
          const ctx = probe.getContext("2d");
          if (ctx === null) return { cool: -1, bright: -1 };
          ctx.drawImage(el, 0, 0);
          const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
          let cool = 0;
          let bright = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i] ?? 0;
            const g = data[i + 1] ?? 0;
            const b = data[i + 2] ?? 0;
            // Blue leads BOTH others by a clear margin — the ramp's floor. The sky
            // gradient is also blue-ish but far less separated, and the untinted
            // ground is a near-neutral blue-grey.
            if (b > r + 60 && b > g + 60) cool += 1;
            // Bright and near-neutral — the ramp's top stop.
            if (r > 190 && g > 190 && b > 170) bright += 1;
          }
          return { cool, bright };
        });

      // THE SPAN, MEASURED RELATIVE TO THE FRAME ITSELF (§1 prerequisite).
      //
      // `bright` above is an ABSOLUTE band (`r > 190 && g > 190 && b > 170`) and
      // round 6 §1 adopts ACESFilmicToneMapping, which re-maps every colour in
      // the scene. An absolute band is exactly the assertion that then goes red
      // for the right reason and gets "fixed" by lowering the number until it
      // passes again — which ends with a suite that cannot detect anything.
      //
      // The claim being made is "the ramp SPANS rather than washing out", and
      // that claim never depended on the top stop being at 190. Measuring the
      // spread of the frame's own luma says the same thing and survives any
      // exposure change. The absolute counts are kept alongside as a floor of
      // zero — they still catch "nothing was drawn" — but the span is what
      // carries the meaning.
      const rampSpan = () =>
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
          const lumas = [];
          for (let i = 0; i < data.length; i += 4) {
            lumas.push(
              0.2126 * (data[i] ?? 0) +
                0.7152 * (data[i + 1] ?? 0) +
                0.0722 * (data[i + 2] ?? 0),
            );
          }
          lumas.sort((a, b) => a - b);
          // p95 − p5, not max − min: one stray specular highlight or one dark
          // window would otherwise decide the answer.
          const at = (q) => lumas[Math.floor(lumas.length * q)] ?? 0;
          return at(0.95) - at(0.05);
        });

      // THE MAGENTA GUARD, STATED DIRECTLY (§1 prerequisite).
      //
      // The comment above explains that the first version of this test counted
      // saturation and would have passed on a ground rendered entirely in
      // `NO_DATA_RGB` magenta — the exact failure the ramp exists to make
      // visible. That guard was implicit in the two-ended band test. Now it is
      // its own assertion, so it cannot be lost when a band is re-tuned.
      const magenta = () =>
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
            // Red and blue both high, green absent — the shape of magenta at
            // any exposure, which is why it is written as a relationship rather
            // than as three thresholds.
            if (r > g + 80 && b > g + 80) count += 1;
          }
          return count;
        });

      // THE RAMP IS NO LONGER THE DEFAULT (§2, DEC-R6-5 reversing DEC-R5-4), so
      // it has to be selected before it can be asserted on pixels.
      //
      // The claim this step makes is unchanged and is still the valuable one —
      // "choosing the ramp actually reaches the screen", which is what R5-3 was
      // really about. What changed is only that the ramp is now one mode among
      // three appearances rather than the state a fresh load lands in; the
      // default is asserted by the ground-mode picker test instead.
      await page.locator("#ground-mode").selectOption("cpu-ramp");
      await expect
        .poll(async () => (await rampEnds()).cool, REPAINT)
        .toBeGreaterThan(20_000);
      // Both ends present, so the ramp spans rather than washing out. Generous
      // floors: what this guards against produces zero of one or both.
      await expect
        .poll(async () => (await rampEnds()).bright, REPAINT)
        .toBeGreaterThan(500);
      // The same claim, made without an absolute band so it survives §1's tone
      // mapping. 40 luma of spread is far below what a working ramp produces and
      // far above what a flat wash does.
      await expect.poll(rampSpan, REPAINT).toBeGreaterThan(40);
      // And it is a RAMP, not the no-data colour. A ground that failed to fetch
      // its DEM is entirely magenta, which the two bands above cannot see.
      await expect.poll(magenta, REPAINT).toBeLessThan(20_000);

      // And it goes away again on the plain entry: an appearance that cannot be
      // turned off is a change to the primary look, which is what DEC-R2-1 forbids
      // — the neutral ground has to stay reachable for the comparison R5-2 is about.
      await page.locator("#ground-mode").selectOption("cpu");
      await expect
        .poll(async () => (await rampEnds()).cool, REPAINT)
        .toBeLessThan(2000);

      // ...and comes back, on the OTHER strategy, which is the five-way form's
      // whole point: the ramp is not tied to one displacement path.
      await page.locator("#ground-mode").selectOption("gpu-ramp");
      await expect
        .poll(async () => (await rampEnds()).cool, REPAINT)
        .toBeGreaterThan(20_000);
    });

    await test.step("displaces the ground on the GPU, and it matches the CPU path", async () => {
      // WHY THIS TEST CARRIES MORE THAN USUAL. The GPU path is custom GLSL injected
      // into MeshStandardMaterial via onBeforeCompile — the exact surface that took
      // the entire scene down for ten work items when `scene.environment` was set.
      // jsdom cannot compile a shader, so nothing in the unit suite can tell you
      // this code even builds.
      //
      // Three things are asserted, and the first is the one that would have caught
      // the original outage: the console stays clean, so a shader that fails to
      // compile fails HERE rather than being logged and silently not drawn.
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(String(error)));

      // A PER-PIXEL comparison, and the threshold is measured rather than chosen.
      //
      // The first version of this compared whole-frame channel sums and allowed 5 %
      // — and it passed with the shader's displacement line deleted, because the
      // fixture's relief moves the summed frame by well under 5 %. It was a vacuous
      // test, caught by mutating the shader rather than by reading it.
      //
      // Counting pixels that differ by more than 3 levels separates the two cases
      // decisively:
      //
      //   GPU displacement working    116 differing pixels of 430 686
      //   GPU displacement deleted   8990 differing pixels of 430 686
      //
      // 77x apart, so 2000 is a floor with enormous margin in both directions. The
      // 116 are real and expected: the CPU path interpolates in float64 and the GPU
      // path samples a half-float texture, so bit-identical output was never the
      // claim. The claim is that they describe the same ground.
      // THE FRAME STAYS IN THE PAGE. This used to return the whole buffer as a JS
      // array — 1280 x 720 x 4 = 3 686 400 elements, serialised over CDP, twice —
      // which made this the slowest test in the suite by a wide margin at 53 s.
      // Stashing the first frame on `window` and doing the comparison in the page
      // ships one integer instead, and asserts exactly the same thing.
      // The probe itself lives in `fixtures.js`, because three tests wanted it and
      // three inline copies is three places for the metric to drift.
      // BOTH APPEARANCES MUST MATCH, or this compares colours instead of geometry.
      // The picker gained a ramp axis in W6 and the DEFAULT is now `cpu-ramp`, so
      // taking the "CPU" frame from the default and the "GPU" frame from `gpu` was
      // comparing ramp-coloured ground against neutral ground — thousands of
      // differing pixels, and nothing to do with displacement. Pinning the plain
      // entry on both sides keeps the A/B about the thing it is named after.
      await installFrameProbe(page);
      await page.locator("#ground-mode").selectOption("cpu");
      expect(await stashFrame(page)).toBeGreaterThan(0);
      await expect(page.locator("#status")).toContainText(/ground cpu \d/);

      // The A/B switch is a five-state picker since W6; "GPU ground" is one of its
      // options rather than a checkbox of its own.
      await page.locator("#ground-mode").selectOption("gpu");
      await expect(page.locator("#status")).toContainText(/ground gpu \d/);
      const { differing, anyLit } = await diffFromStash(page, 3, true);

      // SAME GROUND. If the two disagreed, switching the toggle would move the
      // buildings relative to the terrain and the GPU would be a second source of
      // truth for ground height — the defect DEC-R2-21 rejected geo-three for, and
      // it would be self-inflicted here. The arithmetic is asserted exactly in
      // terrain-texture.test.ts; this proves the SHADER implements that arithmetic.
      //
      // `-1` means the stash or the canvas was missing, which must fail rather
      // than sail through as "fewer than 2000 differing pixels".
      expect(differing).toBeGreaterThanOrEqual(0);
      expect(differing).toBeLessThan(2000);

      // And something was actually drawn, in the GPU frame.
      expect(anyLit).toBe(true);

      const noise =
        /Rule table fetch failed|net::ERR_FAILED|Failed to load resource/;
      expect(errors.filter((text) => !noise.test(text))).toEqual([]);
    });
  });

  test("draws regions, slabs, roads and POIs, each from its own switch", async ({
    page,
  }) => {
    // FOUR LAYER BEHAVIOURS ON ONE BOOT. Each step drives its OWN switch and
    // measures against a frame it stashes itself, so a layer another step left
    // off is a constant rather than an interference — which is why these four
    // can share a boot without a restoration between every one of them.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("fills the regions on the MAP when the areas layer is on", async () => {
      // W15, the 2D half of the same claim W14 draws in 3D. Regions shipped as a
      // 2 px dashed stroke with fill:false — deliberately understated, and the
      // reason the round-1 session missed them entirely, asking whether the flood
      // fill existed about a feature that had been on screen the whole time.
      //
      // Leaflet renders every polygon as an indistinguishable <path>, so the
      // outline and the fill carry different classes and this counts them
      // separately. Without that, "regions are filled" would match the unfilled
      // outline and pass while nothing had changed.

      const outlines = page.locator("#map path.region-outline");
      const fills = page.locator("#map path.region-fill");

      // The boundary is always drawn: it answers "where does this end", which does
      // not stop mattering when the fill answers "how good is it".
      await expect(outlines).not.toHaveCount(0);
      // Filled by default since W9, so the "unfilled" half of the claim has to be
      // reached by switching the layer off first.
      await page.getByRole("checkbox", { name: "areas" }).uncheck();
      await expect(fills).toHaveCount(0);
      await expect(outlines).not.toHaveCount(0);

      await page.getByRole("checkbox", { name: "areas" }).check();
      await expect(fills).not.toHaveCount(0);
      // Still outlined as well as filled.
      await expect(outlines).not.toHaveCount(0);

      // The fill is a real colour from the ramp, not a default. Leaflet writes the
      // style onto the path, so this reads what the browser actually applied
      // rather than what the code intended.
      const fill = await fills
        .first()
        .evaluate((node) => node.getAttribute("fill"));
      expect(fill).toMatch(/^#[0-9a-f]{6}$/i);

      await page.getByRole("checkbox", { name: "areas" }).uncheck();
      await expect(fills).toHaveCount(0);
    });

    await test.step("draws merged regions as slabs, in the map's own colours", async () => {
      // BUILT IS NOT VISIBLE — the lesson the plates layer taught by being counted
      // and reported for ten work items while nothing was drawn. Every geometry
      // layer since gets a pixel assertion, not only a counter one.
      //
      // The fixture has one walkable region, and it is coloured through the SAME
      // heatColour/heatScale pair the 2D map paints with. That sharing is the point
      // of W14: a region reading as "good" in one pane and "poor" in the other is
      // the cross-view disagreement the store exists to prevent.

      // The affordance grid paints highest at 55 % opacity and would tint every
      // ground pixel; the slab is what is under test.
      await page
        .getByRole("checkbox", { name: "cells", exact: true })
        .uncheck();

      // A DIFFERENCE COUNT, NOT A COLOUR FILTER — and this is the THIRD test in
      // this file to make that move for the same reason, after the road layer and
      // the POI markers.
      //
      // What was here counted "vivid" pixels as `r > g + 4 && b > r + 8`, measured
      // against a histogram of the scene as it looked then:
      //
      //   off   rgb(40,40,56) x375362      the ground
      //   on    rgb(40,32,64) x177961      the slab over it
      //
      // Red led green on the slab and equalled it on the ground, which separated
      // the two cleanly. The shiny-surfaces work then made the GROUND violet as
      // well, so the filter now matches the ground it was supposed to exclude:
      // switching the slabs on swaps violet pixels for other violet pixels and the
      // `+20 000` margin is not reached. It failed about one run in four, always
      // with the slab drawn correctly and the status line reporting it.
      //
      // Counting pixels that CHANGED cannot be broken by a palette, which is the
      // whole point — the claim being made is "switching this layer on changes a
      // large part of the picture, and switching it off puts it back", and that
      // claim never depended on which colours were involved.
      await installFrameProbe(page);

      // Off first: W9 draws the slabs by default, so the stashed frame has to be
      // one without them or the difference this measures is zero.
      await page.getByRole("checkbox", { name: "areas" }).uncheck();
      await expect(page.locator("#status")).not.toContainText(/\d+ area slabs/);
      await stashStableFrame(page);

      const changed = async () => (await diffFromStash(page, 24)).differing;

      await page.getByRole("checkbox", { name: "areas" }).check();
      await expect(page.locator("#status")).toContainText(/\d+ area slabs/);
      // ~178 000 pixels of slab were measured when this counted a colour band, and
      // a difference count sees at least as many. 20 000 is a floor with a wide
      // margin, and what it guards against produces ZERO.
      await expect.poll(changed, REPAINT).toBeGreaterThan(20_000);

      await page.getByRole("checkbox", { name: "areas" }).uncheck();
      await expect.poll(changed, REPAINT).toBeLessThan(20_000);
    });

    await test.step("draws roads, and the ground changes when they come on", async () => {
      // BUILT IS NOT VISIBLE. The plates layer was counted and reported for ten
      // work items while nothing was drawn, so every new geometry layer now gets a
      // pixel assertion rather than a counter assertion alone.
      //
      // Roads are the darkest thing in the scene by design (0x2f333d against a
      // ground of 0x3a4356), so the honest measure is how many DARK pixels appear
      // in the lower half where the ground fills the frame.

      // THE AFFORDANCE GRID COMES OFF FIRST, and that is not the test dodging its
      // job. `layer-order.ts` deliberately paints `cells` highest — it is the
      // finest-grained claim and the thing being inspected — and it is 55 %
      // opaque, so it tints every ground pixel in the lower half of the frame.
      // Measured with it on, switching roads on changed the dark-pixel count by
      // exactly zero while the status line correctly read "23 roads (1724 tri)".
      // Isolating the layer under test is what makes the pixel assertion about
      // roads rather than about the grid's alpha.
      // `exact`, because "cells" also substring-matches "show cells below the
      // threshold" and Playwright's strict mode rejects the ambiguity.
      await page
        .getByRole("checkbox", { name: "cells", exact: true })
        .uncheck();

      // Counts pixels that CHANGED against the roads-off frame.
      //
      // THIS USED TO COUNT A FIXED TONE BAND and that is the interesting part.
      // Two earlier attempts had already failed: counting dark pixels in the lower
      // half matched 215 343 of ~230 400 either way (the metric was saturated),
      // and the road material at 0x2f333d rendered within a few levels of the
      // ground, so switching the layer on moved 77 pixels out of 460 800. The fix
      // then was to lighten the material to 0x8b909c and count the narrow grey
      // band it renders in.
      //
      // That band is a proxy for "a road is on screen", and it is a proxy that
      // breaks whenever the SHADING changes rather than the roads. W12 moved the
      // sun onto the camera's azimuth and the count fell from ~6900 to 1604 — with
      // the roads drawn perfectly and the status line still reading "23 roads". A
      // test that fails when the lighting improves is measuring the wrong thing,
      // and W23 is about to recolour roads per class, which would break it again.
      //
      // A difference count is immune to both: it asserts what the layer actually
      // claims — that switching it on changes a large part of the picture and
      // switching it off puts it back — without pinning a palette or a light.
      // THE FRAME STAYS IN THE PAGE — see `installFrameProbe`. This used to pull
      // 3 686 400 array elements across the CDP bridge, once per poll iteration.
      await installFrameProbe(page);
      const changedFromStash = async () =>
        (await diffFromStash(page, 24)).differing;

      // Off first: roads draw by default since W9, so a "before" frame with them
      // already on would make the difference this measures zero.
      await page.getByRole("checkbox", { name: "roads" }).uncheck();
      // THE APP'S OWN SIGNAL FIRST. `stashStableFrame` is a settle, not a
      // barrier — it cannot know which change it is waiting for, and the status
      // line drops the road counter exactly when the layer stops being built.
      await expect(page.locator("#status")).not.toContainText(/\d+ roads/);
      // SETTLED, not merely captured — see `stashStableFrame`. A baseline taken
      // while the terrain or a scoring ring was still arriving is a baseline of a
      // scene that had not finished, and the "switch it back off" assertion then
      // never returns to zero. Measured that way once these four layer steps
      // began sharing a boot: 8100 differing pixels against a `< 3000` floor,
      // held for the full 15 s timeout, with the layer correctly off.
      await stashStableFrame(page);

      await page.getByRole("checkbox", { name: "roads" }).check();
      await expect(page.locator("#status")).toContainText(/[0-9]+ roads/);
      // ~6900 pixels of road were measured when this counted a tone band, and a
      // difference count sees at least as many. 3000 is a floor with room for a
      // re-captured fixture; the failure it guards against produces ZERO.
      await expect.poll(changedFromStash, REPAINT).toBeGreaterThan(3000);

      // And back off again, so the layer is a toggle rather than a one-way door.
      // Back to the original frame means back to almost no differing pixels.
      await page.getByRole("checkbox", { name: "roads" }).uncheck();
      await expect.poll(changedFromStash, REPAINT).toBeLessThan(3000);
    });

    await test.step("marks POIs, and clicking one says what it is", async () => {
      // THE WHOLE POINT OF W12, end to end: the notes asked to be able to point at
      // something and be told what it is, and until now the only clickable thing
      // was an affordance cell — an abstraction over the data rather than an object
      // in it.
      //
      // The fixture (Cologne Volksgarten) carries 9 qualifying nodes: benches,
      // waste baskets, recycling, bicycle parking. Counted from the captured
      // payload rather than guessed, so a re-capture that changes it fails loudly
      // here instead of quietly weakening the test.

      // ON by default since W9, so the "absent" half is reached by switching it
      // off — which also proves the counter disappears rather than sticking.
      await expect(page.locator("#status")).toContainText(/[0-9]+ POI/);
      await page.getByRole("checkbox", { name: "POI" }).uncheck();
      await expect(page.locator("#status")).not.toContainText("POI");
      await page.getByRole("checkbox", { name: "POI" }).check();
      await expect(page.locator("#status")).toContainText(/\d+ POI/);

      // BUILT is not VISIBLE — the lesson from the plates layer, which was counted
      // and reported for ten work items while nothing was drawn.
      //
      // THIS USED TO COUNT SATURATED AMBER, because every marker was one shared
      // orange cone. W19 gave the fifty most common kinds their own models in
      // muted material colours — timber, steel, stone — so the amber count went to
      // ZERO with the markers drawn perfectly. That is the second time this round
      // a colour-band proxy broke because the colours deliberately changed (the
      // road-layer test was the first), so this counts pixels that CHANGED against
      // the markers-off frame instead. A palette cannot break it.
      // The frame never leaves the page — see `installFrameProbe`. Shipping it
      // across CDP once per poll iteration was 3 686 400 array elements a go.
      await installFrameProbe(page);

      await page.getByRole("checkbox", { name: "POI" }).uncheck();
      // The app-level barrier before the settle, for the reason in the roads
      // step above: the counter disappears when the layer stops being built.
      await expect(page.locator("#status")).not.toContainText(/\d+ POI/);
      await stashStableFrame(page);
      await page.getByRole("checkbox", { name: "POI" }).check();
      await expect(page.locator("#status")).toContainText(/[0-9]+ POI/);

      // THRESHOLD 8, NOT 24, AND THAT IS THE THIRD FORM OF THIS ASSERTION.
      //
      // It counted saturated amber until W19 gave the fifty kinds muted material
      // colours and the amber count went to ZERO with the markers drawn
      // perfectly. It became a whole-frame difference count floored at 10, from
      // a measurement of 29. Then §4 began rebuilding the models at their source
      // dimensions — the bench 1.8 -> 1.36 m, the wayside cross 1.68 -> 1.26 m —
      // and the count fell to 9, reproducibly. Thirty-two models remain, so a
      // floor tuned to today's sizes would fail again on its own.
      //
      // **The instrument was too blunt, not the signal too weak.** `threshold`
      // is the SUM of the three channel deltas, so 24 meant ~8 levels per
      // channel — and the markers are correctly lit by a 3.4 degree golden-hour
      // sun (DEC-R6-3), which makes them genuinely low-contrast against the
      // ground rather than invisible. At 8 the same pixels are counted with room
      // to spare, and the floor below is re-derived from a fresh measurement
      // rather than inherited.
      //
      // What this still guards against is unchanged and is the whole point: a
      // layer that reports its count in the status line and draws nothing
      // produces exactly zero at any threshold.
      // MEASURED at 26 on the park fixture at threshold 8, against 9 for the
      // same scene at 24 — so the signal was there and the instrument was
      // blunt. The floor stays at 10, which is 2.6x below the measurement.
      //
      // **If this ever falls under 10 again, the answer is NOT a lower floor.**
      // Thirty-two models remain to be rebuilt at their source dimensions and
      // markers only get smaller, so the next step is to scope the difference to
      // the screen region the markers occupy instead of diluting it across 3.7 M
      // unchanged pixels. Lowering the floor a third time would leave a number
      // that passes whatever happens.
      const changed = async () => (await diffFromStash(page, 8)).differing;
      await expect.poll(changed, REPAINT).toBeGreaterThan(10);
    });
  });

  test("keeps buildings unpickable, grades the sky, and redraws on a camera move", async ({
    page,
  }) => {
    // THREE BEHAVIOURS ON ONE BOOT, with the camera drag last: it is the only
    // one of the three that leaves the view somewhere else.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("a building stays unpickable, which W12 must not have undone", async () => {
      // THE INVARIANT W12 COULD MOST EASILY HAVE BROKEN. Buildings were excluded
      // from the raycast set deliberately, so that hitting one does not silently
      // select the cell behind it as though the building had been chosen.
      // Generalising picking to two kinds of answer is exactly the change that
      // would undo it by accident, so it gets its own assertion rather than being
      // left to the unit test's defence-in-depth branch.

      const panel = page.locator("#details");
      await expect(panel).toBeHidden();

      // The buildings sit in the upper-middle of the frame at the default camera;
      // the affordance grid is drawn over the ground, not over the roofs.
      const canvas = page.locator("#scene canvas");
      const box = await canvas.boundingBox();
      if (box === null) throw new Error("no canvas box");
      await page.mouse.click(
        box.x + box.width * 0.55,
        box.y + box.height * 0.42,
      );

      // Either nothing was selected, or a CELL was — never a building. What must
      // not happen is a panel describing a building as though it were pickable.
      if (await panel.isVisible()) {
        await expect(panel).not.toContainText("building");

        // AND THEN CLOSED, which this step did not have to care about while it
        // owned a whole page. The click above may legitimately select the cell
        // behind the building, and the panel is a DOM overlay across the scene —
        // so the camera-drag step below would grab the PANEL instead of the
        // canvas, the camera would not move, and that step would fail for a
        // reason that has nothing to do with the camera. Observed exactly once,
        // on the first run after these three were fused.
        await panel.locator(".panel-close").click();
        await expect(panel).toBeHidden();
      }
    });

    await test.step("has a graded sky, so the ground reads against it", async () => {
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
      // And it is SKY-coloured rather than grey. This asserted `b > r + 20` — the
      // gradient is a desaturated blue, so blue led red by a clear margin.
      //
      // THAT FORM CANNOT SURVIVE §1 (round 6, DEC-R6-3/R6-2), and it is worth
      // saying why rather than just widening it. The sky becomes three's `Sky`
      // shader driven by a real sun elevation, defaulting to a low golden-hour
      // sun — at which point the sky is legitimately WARM and red leads blue.
      // "Blue leads red" was never the claim; it was one time of day's version
      // of the claim.
      //
      // What is actually being asserted is that the background is CHROMATIC
      // rather than the flat near-neutral it replaced. Channel spread says that
      // at any hour, and it fails on exactly what it should: a grey wash, a
      // black clear colour, or a canvas that was never painted.
      const spread =
        Math.max(sky.r, sky.g, sky.b) - Math.min(sky.r, sky.g, sky.b);
      expect(spread).toBeGreaterThan(20);
    });

    await test.step("the ground redraws when the camera moves", async () => {
      // WHAT THIS ASSERTS: the ground redraws when the camera moves. That is all,
      // and the name overstates it — kept, with this correction, because the
      // overstatement is the interesting part.
      //
      // IT DOES NOT ASSERT THE SPECULAR FACET CUE, AND NO PIXEL TEST HERE CAN.
      // DEC-R2-1 chose a reflective ground so a highlight would slide across the
      // facets as the camera moves, making relief readable without a colour ramp.
      // Before building W23 on that premise it was measured, by counting the
      // standard deviation of ground luminance across the lower band:
      //
      //   material as shipped (roughness 0.42, flatShading)  SD = 2.51
      //   deliberately matte control (roughness 1, smooth)   SD = 2.49
      //
      // The two are indistinguishable. The reason is geometric rather than a
      // material-tuning problem: Cologne's relief is about +/-25 m across a 2.8 km
      // plane, so adjacent facets differ by well under a degree, and a roughness
      // 0.42 lobe is far too broad to resolve that. The cue is not weak here, it is
      // absent — and it had never been observed on a real device either, because
      // the ground plane was compiled out by the shader outage from W20 until the
      // 2026-07-30 fix.
      //
      // The practical consequence is that W24's height ramp, not this, is what
      // answers "did the DEM load?". Whether DEC-R2-1 should change is the owner's
      // call and is raised in the round-2 plan; nothing here presumes it.
      //
      // Sampled from a band low in the frame, where the ground fills the view,
      // rather than the whole canvas — otherwise the existing "dragging moves the
      // camera" test would already cover it and this would prove nothing extra.

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
      // DRAGGED AT THE LEFT QUARTER, NOT THE CENTRE, and this is a real bug in
      // the test rather than a tweak. The step above can legitimately select a
      // cell, and the details panel then covers the RIGHT HALF of the 3D pane —
      // including its centre. A drag starting there lands on the panel, so
      // MapControls never sees it and the camera does not move at all.
      //
      // It passed anyway until §1 because the sun followed the camera: the
      // damping settle alone changed the lighting enough to change the strip.
      // With a physical sun (DEC-R6-3) an unmoved camera gives a byte-identical
      // strip, so the test finally reported what was always true.
      const dragX = box.x + box.width * 0.25;
      const dragY = box.y + box.height / 2;
      await page.mouse.move(dragX, dragY);
      await page.mouse.down();
      await page.mouse.move(dragX - 40, dragY - 20);
      await page.mouse.up();

      await expect.poll(groundBand, REPAINT).not.toBe(before);
    });
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

  test("picks a grid cell, stands on real terrain, and reports what it built", async ({
    page,
  }) => {
    // THREE BEHAVIOURS ON ONE BOOT. The grid pick runs first because it is the
    // one that needs an untouched camera; the two after it read the status line.
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // CELLS ON: they start OFF since DEC-R7b-6, and this test's first step is
    // ABOUT the grid. Without this the sweep still passes -- by picking the
    // region slab that lies under the grid -- so the M3 regression it was
    // written to catch could come back green. The panel it opened would also be
    // `renderRegion`, whose `.panel-summary` only exists when the region's
    // spread is wide enough, making the closing assertion fixture-dependent.
    await enableCellLayer(page); // async since round 10 stage B

    await test.step("draws the affordance grid too, and a click on it opens the panel", async () => {
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

      // Sweep an arc through the middle of the scene: the fixture's grid covers the
      // centre, but the exact pixel depends on the camera.
      //
      // WHY THE WHOLE SWEEP RETRIES, from a captured failure (2026-08-02). The
      // scene was fully built and the grid plainly drawn, but that run had scored a
      // SMALLER working set than a passing one — `845 cells · 1 walkable regions ·
      // 19 chunks scored / 0 reused` against the usual `1692 cells · 3 walkable
      // regions · 37 scored / 19 reused`. A smaller set is a smaller grid, and a
      // fixed arc of five offsets can then sit past its far edge, which is what the
      // screenshot shows. A republish landing under the sweep produces the same
      // symptom, and one screenshot cannot separate the two.
      //
      // So this asserts the claim rather than a mechanism: "a click on the grid
      // opens the panel" is not weakened by trying more than once, and repeating
      // costs nothing in the common case because the first offset usually hits.
      // Two earlier hypotheses were written and then DISPROVED — that
      // `isVisible()` races the on-demand repaint (a single-offset sweep passed
      // 5/5 with the old instant check), and that no cell was drawn at all (the
      // screenshot shows one). Do not replace this with a longer timeout.
      //
      // The offsets also now reach further DOWN the view, which is nearer the
      // camera and inside the grid in every run observed.
      const sweep = async () => {
        for (const [dx, dy] of [
          [0, 0],
          [-40, 20],
          [40, 20],
          [0, 60],
          [-80, 60],
          [0, 120],
          [-60, 140],
          [60, 140],
        ]) {
          await page.mouse.click(
            box.x + box.width / 2 + dx,
            box.y + box.height / 2 + dy,
          );
          if (await panel.isVisible()) return true;
        }
        return false;
      };
      await expect.poll(sweep, { timeout: 20_000 }).toBe(true);

      await expect(panel).toBeVisible();
      // The SAME panel a 2D click opens — one selection, one explanation, and the
      // panel does not know which view produced it.
      await expect(panel.locator(".panel-summary")).not.toBeEmpty();
    });

    await test.step("stands the buildings on real terrain, and credits where it came from", async () => {
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

    await test.step("reports what it built, including the honesty flags", async () => {
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
});

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
    let previousCount = -1;
    await expect
      .poll(
        () => {
          const settled = counts.overpassQuery === previousCount;
          previousCount = counts.overpassQuery;
          return settled;
        },
        { timeout: 30000, intervals: [500] },
      )
      .toBe(true);

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
 * W1 / finding R3-2 — the canvas must lay out at its container's size.
 *
 * TWO DESCRIBE BLOCKS because `test.use` is per-describe and the whole point is
 * to run the same assertion at two device pixel ratios: the bug is identically
 * zero at dpr 1, which is why every project in this suite ran at dpr 1 for the
 * whole of rounds 1 and 2 and never saw it.
 */
test.describe("the 3D canvas at a high device pixel ratio", () => {
  // A phone: 390x780 CSS pixels at dpr 2. Without the fix the canvas element is
  // 780x1560 CSS pixels inside a 390-wide container.
  test.use({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });

  test("lays out at its container's size, not at its drawing buffer's", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await expectCanvasFillsContainer(page);
  });
});

test.describe("the 3D canvas at dpr 1", () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test("still lays out at its container's size", async ({ page }) => {
    // The regression guard for the fix itself: at dpr 1 the attribute size and
    // the container size coincide, so this passed BEFORE the fix too. It is here
    // so that a future change which sizes the canvas some third way cannot break
    // the desktop case while the dpr-2 test keeps passing.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await expectCanvasFillsContainer(page);
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
   * the demo then selects `walkable` explicitly, which is NOT option 0. A test
   * that switched to index 1 and "back" to index 0 silently ended on a third
   * category — which is exactly how the camera assertion below first failed, at
   * 43 % of pixels changed, for a reason that had nothing to do with the camera.
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
 * W11 / DEC-R3-3 — the ground picker, including the state that hides the ground.
 */
test.describe("the ground mode picker", () => {
  test("offers the right modes, and 'No ground' really draws none", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // THE PICKER-CONTENTS STEP RUNS FIRST because it asserts the DEFAULT
    // selection, and the step below changes it. Fusing does not get to reorder
    // an assertion about an initial state to after something has moved it.
    await test.step("offers the height ramp on both strategies and on neither without ground", async () => {
      // WHAT THIS REPLACES, and why the replacement is a stronger claim. It used to
      // assert that the `terrainDebug` SWITCH was disabled under `No ground`
      // (DEC-R3-17) — a runtime guard against offering a control that does nothing.
      // W6 folds the ramp into the ground mode, so the guard is now structural:
      // there is no `none-ramp` entry to choose. Asserting the picker's contents
      // tests the property directly instead of testing the guard that used to
      // approximate it.
      const picker = page.locator("#ground-mode");
      // SEVEN since §2 (DEC-R6-16): a third appearance — the slope treatment —
      // across two displacement strategies, plus "none".
      await expect(picker.locator("option")).toHaveCount(7);
      // Every strategy keeps every appearance, which is what keeps the CPU-vs-GPU
      // A/B reachable whichever appearance is chosen (DEC-R3-3).
      for (const value of [
        "cpu",
        "cpu-slope",
        "cpu-ramp",
        "gpu",
        "gpu-slope",
        "gpu-ramp",
        "none",
      ]) {
        await expect(picker.locator(`option[value="${value}"]`)).toHaveCount(1);
      }
      // ...and no combination of "no ground" with an appearance exists to be
      // chosen, which is DEC-R3-17 held structurally rather than by a guard.
      await expect(picker.locator('option[value="none-ramp"]')).toHaveCount(0);
      await expect(picker.locator('option[value="none-slope"]')).toHaveCount(0);

      // SLOPE is the default since DEC-R6-5, reversing DEC-R5-4 — see
      // `ground-mode.ts` for the measurement behind the reversal.
      await expect(picker).toHaveValue("cpu-slope");

      await picker.selectOption("gpu-ramp");
      await expect(page.locator("#status")).toContainText(/ground gpu \d/);
    });

    await test.step("draws nothing as ground on 'No ground', and comes back", async () => {
      // WHY THIS TEST MATTERS. `No ground` is the state the round-3 notes asked
      // for — a way to look at the OSM ground areas without the terrain over them
      // — and the way it fails is silently: a mode switch that cleared the whole
      // scene would look exactly like the blanking bug W2 fixed, and a mode that
      // did nothing would look like the picker was decorative.
      const shot = () =>
        page.evaluate(() => {
          const el = document.querySelector("#scene canvas");
          if (!(el instanceof HTMLCanvasElement)) return "";
          return el.toDataURL();
        });

      // Taken here rather than at boot: the step above left the picker on
      // `gpu-ramp`, and the claim is "switching to none changes the picture",
      // which has to be measured from whatever ground is actually drawn now.
      const withGround = await shot();
      await page.locator("#ground-mode").selectOption("none");
      await expect.poll(shot, REPAINT).not.toBe(withGround);

      // The mesh layers are untouched — the buildings are still there.
      await expect(page.locator("#status")).toContainText(/\d+ volumes/);

      await page.locator("#ground-mode").selectOption("cpu");
      await expect(page.locator("#status")).toContainText(/ground cpu \d/);
    });
  });
});

/**
 * W12 / finding R3-8 — one scale, and a legend that says when there is no ramp.
 */
test.describe("the legend", () => {
  test("keeps its scale, and says when nothing qualifies", async ({ page }) => {
    // TWO BEHAVIOURS, ONE BOOT. The boot is ~4.8 s of a ~6.5 s test and both of
    // these want the identical one, so paying it twice bought nothing. They stay
    // separately named through `test.step`, which is what keeps a failure
    // pointing at one behaviour rather than at a pair — see
    // GpsPlusSlamJs_Docs/docs/2026-08-02-0612-osm-demo-e2e-fusion-plan.md.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("keeps its scale when the cells layer is switched off", async () => {
      // THE DEFECT, and it is not in the notes: the scale was derived from the
      // cells the MAP was handed, and those are filtered by this switch. So
      // switching it off collapsed the ramp — the legend went to "1 to 1" and the
      // 2D region fills were coloured on an empty scale while the 3D slabs used a
      // different one. Two views, two scales, the same regions.
      const legend = page.locator("#legend");
      const before = await legend.textContent();
      expect(before).not.toBeNull();

      await page.locator("#layer-cells").uncheck();
      await expect(page.locator("#map path.affordance-cell")).toHaveCount(0);

      // The cells are gone from the map; the scale describes the data, not the
      // drawing, so the legend must be unchanged.
      await expect(legend).toHaveText(before ?? "");

      // RESTORED before the next step. This step's own claim is that the legend
      // does not depend on the switch, so leaving it off would be harmless here —
      // but a step that hands the next one a state it did not ask for is how
      // fused tests start failing for reasons that are not about them.
      await page.locator("#layer-cells").check();
      await expect(page.locator("#map path.affordance-cell")).not.toHaveCount(
        0,
      );
    });

    await test.step("says nothing qualifies instead of showing a 1-to-1 ramp", async () => {
      // The reported symptom, as an assertion. Any category with no cell above the
      // bar produces a degenerate scale; the fixture's own categories are used
      // rather than a hardcoded name, so this stays true if the rule table moves.
      const picker = page.locator("#category");
      const values = await page
        .locator("#category option")
        .evaluateAll((nodes) =>
          nodes.map((node) => /** @type {HTMLOptionElement} */ (node).value),
        );

      for (const value of values) {
        await picker.selectOption(value);
        await waitForRefresh(page);
        const text = (await page.locator("#legend").textContent()) ?? "";
        // Either there is a real ramp, or there is a sentence — never a ramp whose
        // two ends carry the same number.
        const min = await page.locator("#legend .legend-min").count();
        if (min === 0) {
          expect(text).toContain("no cell scores above");
          return;
        }
      }
      // Not a failure: this fixture may have data for every category. Recorded so
      // a green run cannot be mistaken for proof that the empty state was reached.
      test.info().annotations.push({
        type: "note",
        description: "every category had cells above the bar in this fixture",
      });
    });
  });
});

/**
 * W13 / finding R3-8 — "show cells below the threshold does nothing".
 *
 * The switch was wired correctly the whole time. What it revealed was
 * near-invisible: a 1 px 50 %-opacity dashed outline on the map, and in 3D every
 * sub-threshold cell painted at the ramp's darkest stop over dark ground.
 */
test.describe("revealing the sub-threshold cells", () => {
  test("changes BOTH views, and the cells it reveals are interrogable", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // CELLS ON: they start OFF since DEC-R7b-6, and this test is about the
    // grid. Switching them on here rather than changing the default keeps the
    // default itself asserted in one place (the layer-toggle test).
    // Through the helper: the cells arrive asynchronously since round 10 stage
    // B, and `before2d` is captured immediately below. Without the wait it was
    // captured as ZERO -- so the "and back" assertion compared 1387 against 0
    // and the test failed for a reason that had nothing to do with show-below.
    await enableCellLayer(page);

    await test.step("changes BOTH views, in both directions", async () => {
      const canvas = page.locator("#scene canvas");
      const shot = () =>
        page.evaluate(() => {
          const el = document.querySelector("#scene canvas");
          return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
        });
      await expect(canvas).toBeVisible();

      const cells = page.locator("#map path.affordance-cell");
      const before2d = await cells.count();
      const before3d = await shot();

      await page.locator("#show-below").check();

      // 2D: more cells on screen. 3D: a different picture. Both halves, because
      // the reported symptom was that nothing appeared to happen at all.
      await expect.poll(() => cells.count()).toBeGreaterThan(before2d);
      await expect.poll(shot, REPAINT).not.toBe(before3d);

      // AND BACK, which is the half that catches a redraw that only ever adds.
      await page.locator("#show-below").uncheck();
      await expect.poll(() => cells.count()).toBe(before2d);
    });

    await test.step("an identity cell can still be clicked to ask why", async () => {
      // DEC-7's stated reason for revealing these cells at all: a hidden cell is
      // the one cell you cannot click to ask why. W13 changes the identity band's
      // TREATMENT — outline, not fill — and DEC-R3-21 keeps it interrogable.
      //
      // ASSERTED ON THE MAP, where a specific band can be addressed by class. The
      // 3D half of the same guarantee is the invisible pick face, which
      // `cell-mesh.test.ts` pins directly: a canvas click cannot be aimed at a
      // particular band without solving for the projection first.
      //
      // The switch is checked again here rather than inherited: the step above
      // ends by unchecking it, because "and back" is half of ITS claim.
      await page.locator("#show-below").check();
      const identity = page
        .locator("#map path.affordance-cell-identity")
        .first();
      await expect(identity).toBeVisible();

      await identity.click({ force: true });
      await expect(page.locator("#details")).toBeVisible();
    });
  });
});

/**
 * W14 / DEC-R3-9, DEC-R3-18 — the performance panels.
 *
 * THIS ITEM SHIPS THE INSTRUMENT; it does not take the measurement. The
 * CPU-vs-GPU comparison the note asked for happens on a phone, which is why the
 * control is a switch rather than a URL parameter.
 */
test.describe("the perf overlay", () => {
  test("mounts on demand and leaves the scene alone", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const panels = page.locator("#scene .perf-stats-overlay");
    await expect(panels).toHaveCount(0);

    /** Non-background pixels, so "the scene is unchanged" is a real claim. */
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

    const before = await painted();
    await page.locator("#perf-stats").check();

    // The panels are DOM over the canvas, so the rendered scene must not move —
    // an overlay that changed the picture would corrupt the very comparison it
    // exists to support.
    await expect(panels).toHaveCount(1);
    expect(Math.abs((await painted()) - before)).toBeLessThan(before * 0.02);

    await page.locator("#perf-stats").uncheck();
    await expect(panels).toHaveCount(0);
  });
});

/**
 * W15 / DEC-R3-10 — the control bar is grouped, and every layer still has a
 * switch.
 */
test.describe("the control bar", () => {
  test("gives every layer one switch, and collapses to the essentials", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("gives every layer exactly one visible switch", async () => {
      // THE REGISTRY'S OWN GUARANTEE, asserted through the UI: a builder that
      // arrives without a switch is a layer that renders and cannot be turned off,
      // which is the state `ALL_LAYERS` exists to prevent. Grouping the switches
      // moved every one of them, so this is also the regression guard for that.
      const switches = page.locator("#layers input[type=checkbox][data-layer]");
      const count = await switches.count();
      expect(count).toBeGreaterThan(0);

      const layers = await switches.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-layer")),
      );
      expect(new Set(layers).size).toBe(count);
      for (const layer of layers) {
        await expect(page.locator(`#layer-${layer}`)).toBeVisible();
      }

      // And the groups exist, with the perf switch inside the diagnostics one —
      // it is not a layer, so nothing else would put it there.
      await expect(page.locator("#layer-group-overlays")).toBeVisible();
      await expect(page.locator("#layer-group-world")).toBeVisible();
      await expect(
        page.locator("#layer-group-diagnostics #perf-stats"),
      ).toBeVisible();
    });

    await test.step("collapses to the title, category, affordance block and legend", async () => {
      // DEC-R6b-5 REDREW THIS LINE, and the shape of the change is the point.
      // Before round 7 exactly ONE setting collapsed — `show-below` — while the
      // World, Debug and Ground controls stayed on screen. That is backwards
      // from what the bar is for, and it is what the sixth session reported.
      //
      // Collapsed now keeps: the category picker, the legend, and the whole
      // affordance block INCLUDING `show-below`, which moved into that group.
      // Collapsed now hides: the hint, the status string, World, Debug, Ground.
      //
      // `show-below` being VISIBLE here is a deliberate reversal. The session's
      // first impression was that its disappearing was a bug; moving it into the
      // block the legend describes is what makes it stop disappearing.
      //
      // The narrow viewport is set HERE rather than at the top, so the step above
      // still runs at the desktop width it was written for. A resize is a repaint,
      // not a reload — the scene and the working set survive it, which is the
      // whole reason these two can share a boot.
      await page.setViewportSize({ width: 390, height: 780 });
      await page.locator("#header-toggle").click();

      await expect(page.locator("#category")).toBeVisible();
      await expect(page.locator("#legend")).toBeVisible();
      await expect(page.locator("#layer-cells")).toBeVisible();
      await expect(page.locator("#show-below")).toBeVisible();

      await expect(page.locator("#status")).toBeHidden();
      await expect(page.locator("#layer-group-world")).toBeHidden();
      await expect(page.locator("#layer-group-diagnostics")).toBeHidden();
      // The ground picker goes too (Q-R6b-3). It is the one control here that
      // changes what is DRAWN rather than whether it is drawn, and `index.html`
      // used to call it one of "the two primary inputs" — the owner chose the
      // session's note over that precedent, so the comment was reworded rather
      // than left describing a rule the code no longer follows.
      await expect(page.locator("#ground-mode-label")).toBeHidden();

      // And expanding brings all three back, so this is a collapse rather than
      // a removal.
      await page.locator("#header-toggle").click();
      await expect(page.locator("#layer-group-world")).toBeVisible();
      await expect(page.locator("#layer-group-diagnostics")).toBeVisible();
      await expect(page.locator("#ground-mode-label")).toBeVisible();
    });

    await test.step("puts show-below inside the affordance group, not beside it", async () => {
      // The MOVE, asserted structurally rather than by position on screen —
      // `layer-toggles.ts` has an `extras` hook for exactly this (the perf
      // switch already uses it), so the checkbox is a child of the group rather
      // than a sibling that happens to render nearby. A CSS-only fix would look
      // identical collapsed and wrong the moment the groups are reordered.
      await expect(
        page.locator("#layer-group-overlays #show-below"),
      ).toBeAttached();
    });
  });
});

/**
 * "No ground" must MEAN no ground — including after the user moves.
 *
 * Reported after the round-3 deploy: with `No ground` selected and the camera
 * under the scene, "there was still some additional ground layer rendered".
 * Measured from below with every layer switched off, nothing but the sky
 * remains — so the terrain plane is genuinely gone and what is visible from
 * underneath is the affordance grid, which is `DoubleSide` and traces the
 * terrain surface. These tests pin the half that could regress silently.
 */
test.describe("No ground", () => {
  test("is empty sky with the layers off, and survives a position change", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    await page.locator("#ground-mode").selectOption("none");

    // THE SKY STEP RUNS FIRST, and the order is the fusion's own rule rather
    // than taste: it is fully reversible (seven switches back on), while the step
    // below MOVES THE USER, which reloads the terrain and cannot be undone. An
    // irreversible step goes last or it hands every later step a world it did
    // not ask for.
    const LAYERS = [
      "cells",
      "areas",
      "buildings",
      "trees",
      "plates",
      "roads",
      "poi",
    ];

    await test.step("leaves nothing but sky when every layer is off too", async () => {
      // The claim the report was really about: "no ground" plus "no layers" is an
      // empty scene. Asserted as an absence of NEUTRAL pixels — the sky gradient is
      // strongly blue-dominant, while the ground plane (0x3a4356), the buildings
      // (0xc8ccd8) and the plates (0x4a5468) are all near-neutral greys. A grey
      // pixel here is a surface that should not be drawn.
      for (const layer of LAYERS) {
        const box = page.locator(`#layer-${layer}`);
        if (await box.isChecked()) await box.uncheck();
      }

      // NO GEOMETRY LEFT, measured as hard edges rather than as colours — see
      // `countNonSkyPixels`, whose predicate changed in §1 because the sky is no
      // longer two hard-coded colours. A colour heuristic ("is it
      // blue-dominant?") reads as sufficient here and is not: it also
      // classifies the building material as sky, so it would pass over a scene
      // full of geometry. An edge count never asks what colour anything is.
      //
      // The bound is small but not zero: a scattering sky carries a sun disc and
      // a tone-mapped gradient can step by a level here and there. A city fills
      // this frame with tens of thousands of edge pixels, so the separation is
      // three orders of magnitude rather than a tuned margin.
      const { count } = await countNonSkyPixels(page);

      expect(count).toBeLessThan(2000);

      for (const layer of LAYERS) {
        const box = page.locator(`#layer-${layer}`);
        if (!(await box.isChecked())) await box.check();
      }
    });

    await test.step("survives a position change, which reloads the terrain", async () => {
      // THE LIFECYCLE RISK. `setTerrain` runs on every position change and
      // re-applies the field to the plane; if it ever restored visibility — or if
      // a future caller rebuilt the plane — the ground would come back on the next
      // click with the picker still saying "No ground". A control that silently
      // stops applying is the shape of half of this round's findings.
      const shot = () =>
        page.evaluate(() => {
          const el = document.querySelector("#scene canvas");
          return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
        });
      await expect.poll(shot, REPAINT).not.toBe("");
      const withoutGround = await shot();

      // Move the user, which loads terrain for the new position and re-applies it.
      const map = page.locator("#map");
      const box = await map.boundingBox();
      if (box === null) throw new Error("no map box");
      await page.mouse.click(
        box.x + box.width / 2 + 30,
        box.y + box.height / 2,
      );
      await waitForRefresh(page);

      // The picker still says none, and the status line agrees — it reports the
      // mode it is actually drawing with.
      await expect(page.locator("#ground-mode")).toHaveValue("none");
      await expect(page.locator("#status")).toContainText(/ground none/);
      // And the ground did not come back: the frame is a scene without it. (The
      // cells moved with the user, so this is not a pixel comparison — the status
      // line's own mode readout is the honest assertion here.)
      expect(withoutGround).not.toBe("");
    });
  });
});

/**
 * From UNDER the world, with `No ground` (reported after the round-3 deploy).
 *
 * The report was "I turned off ground and looked at the 3D world from below,
 * and there was still some additional ground layer rendered — basically a full
 * black plane". This block is the reproduction, and what it establishes is that
 * **no geometry is drawn under the scene at all**: what fills the view is the
 * sky background, whose zenith end is a near-black blue and whose lower half is
 * a flat mid blue-grey. Both read as a surface and neither is one.
 *
 * The camera can get there because `MapControls` inherits `OrbitControls`'
 * default `maxPolarAngle` of PI — nothing stops it going under the world.
 */
test.describe("under the world", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** Rotates the camera down by `dy` pointer-pixels (MapControls: RIGHT = ROTATE). */
  const rotateUnder = async (page, dy) => {
    const box = await page.locator("#scene canvas").boundingBox();
    if (box === null) throw new Error("no canvas box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "right" });
    for (let i = 1; i <= 8; i++) await page.mouse.move(cx, cy + (dy * i) / 8);
    await page.mouse.up({ button: "right" });
    // Damping eases over several frames; wait for the picture to stop moving.
    let previous = "";
    await expect
      .poll(
        async () => {
          const now = await page.evaluate(() => {
            const el = document.querySelector("#scene canvas");
            return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
          });
          const stable = now === previous;
          previous = now;
          return stable;
        },
        { timeout: 15000, intervals: [300] },
      )
      .toBe(true);
  };

  test("shows the buildings from beneath, and no ground under them", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    await page.locator("#ground-mode").selectOption("none");
    // EVERY GROUND-HUGGING LAYER OFF, so what is left is the question actually
    // being asked. The affordance grid is DoubleSide and traces the terrain, so
    // it is the one thing that DOES look like ground from below — and since W9
    // the plates, the roads and the region slabs are on by default and lie flat
    // on the same surface, which is the same problem three more times over.
    for (const layer of ["cells", "plates", "roads", "areas", "poi"]) {
      const box = page.locator(`#layer-${layer}`);
      if (await box.isChecked()) await box.uncheck();
    }

    // ROTATED IN STEPS UNTIL THE CAMERA IS DEMONSTRABLY UNDER THE SCENE, rather
    // than by a magic number of pointer-pixels. `OrbitControls` maps a full
    // canvas height to 2*PI, so a fixed drag means a different angle at every
    // viewport — the first version of this test used 90 px, worked at one size
    // and put the buildings out of frame at another.
    //
    // The stop condition is the proof: the buildings are in frame AND their
    // centre of mass is in the upper third, which is what "looking up at them
    // from underneath" means and what looking down at them cannot produce.
    let withBuildings = { count: 0, meanY: 1 };
    for (let step = 0; step < 8; step++) {
      await rotateUnder(page, 40);
      withBuildings = await countNonSkyPixels(page);
      if (withBuildings.count > 1000 && withBuildings.meanY < 0.35) break;
    }
    expect(withBuildings.count).toBeGreaterThan(1000);
    expect(withBuildings.meanY).toBeLessThan(0.35);

    // AND NOTHING ELSE IS THERE. With the buildings and trees off too, the frame
    // has essentially no hard edges left — so the "ground layer" seen from below
    // is the background, not a surface. If a ground plane were ever drawn under
    // the world, its silhouette would put edges straight back.
    //
    // A RATIO RATHER THAN ZERO (§1). The old helper matched the painted sky.s
    // exact colours, so "not sky" could be exactly 0. An edge count cannot be:
    // a scattering sky carries a sun, and tone mapping can steepen a gradient
    // enough to trip a step here and there. What is being claimed is that the
    // geometry is gone, and a 20x drop says that without depending on a palette.
    await page.locator("#layer-buildings").uncheck();
    await page.locator("#layer-trees").uncheck();
    await expect
      .poll(async () => (await countNonSkyPixels(page)).count)
      .toBeLessThan(withBuildings.count / 20);
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

/**
 * W7 / DEC-R5-5 — the POI model gallery, which closes F28.
 *
 * WHY THIS BLOCK IS SHORT, and deliberately so. The page exists for a HUMAN to
 * look at fifty procedural models at true relative scale — DEC-R4-14 declined a
 * contact sheet and F28 recorded the consequence: _"the fifty POI models were
 * judged by no one."_ No assertion can replace that look.
 *
 * What it CAN assert is that the look is possible: the page loads, draws
 * something, and does not log a shader or module error. The gallery imports
 * `POI_MODELS` and builds fifty `MeshStandardMaterial`s — the exact surface that
 * silently took the whole demo scene off screen for ten work items when
 * `scene.environment` was set — so "renders nothing while reporting success" is
 * a real failure mode here rather than a hypothetical one.
 */
test.describe("the POI model gallery", () => {
  test("draws every model, and the console stays clean", async ({ page }) => {
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    // NO NETWORK STUB NEEDED, which is the point of the separate page: no store,
    // no worker, no Overpass, no rule table. If this ever starts needing one,
    // the page has grown a dependency it was built to avoid.
    await page.goto("/gallery.html");

    // The status line reports the count from the data rather than from a
    // hard-coded number, so this catches "the map came back empty" too.
    await expect(page.locator("#gallery-status")).toContainText(
      /\d+ POI models/,
    );
    const status = await page.locator("#gallery-status").textContent();
    expect(Number(/(\d+) POI models/.exec(status ?? "")?.[1])).toBe(50);

    // PIXELS, not "a canvas exists". A present canvas of the right size is
    // equally consistent with an empty scene, a camera inside the ground, or a
    // render that never ran — the same reason the demo's own boot test counts
    // non-background pixels.
    const litPixels = () =>
      page.evaluate(() => {
        const el = document.querySelector("#gallery canvas");
        if (!(el instanceof HTMLCanvasElement)) return -1;
        const probe = document.createElement("canvas");
        probe.width = el.width;
        probe.height = el.height;
        const ctx = probe.getContext("2d");
        if (ctx === null) return -1;
        ctx.drawImage(el, 0, 0);
        const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          // The background is #1b1e26. Anything clearly brighter is geometry.
          if ((data[i] ?? 0) > 60 || (data[i + 1] ?? 0) > 60) lit += 1;
        }
        return lit;
      });
    // POLLED, like every other pixel assertion in this suite. It also covers a
    // real asynchrony: Chromium can bring the GPU context up AFTER the first
    // frame, so the page draws once, loses that context and redraws on
    // `webglcontextrestored` — see `gallery.ts` for the measurement behind that.
    await expect.poll(litPixels, REPAINT).toBeGreaterThan(5000);

    expect(errors).toEqual([]);
  });
});

/**
 * The time-of-day control and the constraint it is most likely to breach
 * (§1, DEC-R6-3, DEC-R6-4, DEC-R4-5).
 *
 * TWO CLAIMS, AND THE SECOND IS THE IMPORTANT ONE.
 *
 * The first is that the hotkey reaches the sun at all. `setTimeOfDay` is unit
 * tested and `sunAt` is unit tested, but nothing until now connected a keypress
 * to a repaint — and a control that exists in the class and not on the page is
 * the exact shape of "the data is right and the picture never changed".
 *
 * The second is DEC-R4-5: **the affordance heat ramp must stay the loudest thing
 * on screen.** Round 6 pushes on that from four directions at once — ACES
 * re-maps every colour, the environment map lifts every surface, §2 will tint
 * the ground and §6 will multiply the grid's share of the frame by six. Until
 * now that constraint has been enforced by looking at screenshots, which means
 * it has never actually been enforced. This is the durable form of it.
 */
test.describe("the time of day", () => {
  test("moves the sun from a hotkey, and the heat ramp stays the loudest thing", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("a keypress repaints the scene with a different sun", async () => {
      // The whole point of the control. Measured as a difference count, so it
      // says nothing about which colours the sky happens to take at either time
      // — only that pressing the key changed the picture.
      await installFrameProbe(page);
      await stashStableFrame(page);

      // Focus the body rather than a field: the registry deliberately ignores
      // keys typed into inputs, and the site picker is a `<select>`.
      await page.locator("#scene").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("t");

      await expect
        .poll(async () => (await diffFromStash(page, 24)).differing, REPAINT)
        .toBeGreaterThan(1000);
    });

    await test.step("stepping back returns to where it started", async () => {
      // Determinism, visibly. The sun is a pure function of the time of day, so
      // forward-then-back must be the identity — if it drifted, the control
      // would be accumulating error and nobody would notice for a while.
      await stashStableFrame(page);
      await page.keyboard.press("t");
      await expect
        .poll(async () => (await diffFromStash(page, 24)).differing, REPAINT)
        .toBeGreaterThan(1000);
      await page.keyboard.press("T");
      await expect
        .poll(async () => (await diffFromStash(page, 24)).differing, REPAINT)
        .toBeLessThan(2000);
    });

    await test.step("the shortcut list is discoverable and matches the bindings", async () => {
      const help = page.locator("#hotkey-help");
      await expect(help).toBeHidden();
      await page.keyboard.press("?");
      await expect(help).toBeVisible();
      // Rendered FROM the registry, so this also catches a binding added
      // without a description.
      await expect(help).toContainText("step the sun forward");
      await expect(help.locator("kbd")).not.toHaveCount(0);
      await page.keyboard.press("?");
      await expect(help).toBeHidden();
    });

    await test.step("DEC-R4-5: the heat ramp is still the most saturated thing on screen", async () => {
      // THE CONSTRAINT ROUND 6 IS MOST LIKELY TO BREACH, and until now it has
      // only ever been checked by looking.
      //
      // Stated as a comparison rather than as an absolute: the grid's pixels
      // must be more saturated than the rest of the frame by a clear margin.
      // That survives tone mapping, an environment map and a palette change,
      // because it is a claim about the RELATIONSHIP between the data layer and
      // the backdrop rather than about any colour.
      //
      // MEAN ABSOLUTE CHROMA, NOT HSV SATURATION, and the first attempt got this
      // wrong in a way worth recording. HSV saturation is a RATIO, so the dark
      // blue-grey ground (0x3a4356 -> chroma 28 on a max of 86) scores 0.33 and
      // reads as "saturated" while looking entirely neutral; the measurement
      // then reported that switching the heat grid ON made the frame LESS
      // saturated, which is true of the ratio and false of the picture.
      //
      // Absolute chroma separates the two cleanly, because that is what "loud"
      // means here: the viridis ramp runs 80-216 levels of chroma (deep purple
      // to yellow), the ground is 28 and the buildings are 16.
      const meanChroma = () =>
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
          let sum = 0;
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i] ?? 0;
            const g = data[i + 1] ?? 0;
            const b = data[i + 2] ?? 0;
            sum += Math.max(r, g, b) - Math.min(r, g, b);
            count += 1;
          }
          return count === 0 ? -1 : sum / count;
        });

      // POLLED, NOT READ ONCE. The view renders on demand (DEC-R3-9), so a
      // measurement taken immediately after a toggle reads the PREVIOUS frame —
      // the first version of this did exactly that and reported a difference of
      // exactly zero, which looks like a real answer.
      const settledChroma = async () => {
        let previous = -1;
        for (let i = 0; i < 40; i++) {
          const now = await meanChroma();
          if (Math.abs(now - previous) < 0.01) return now;
          previous = now;
          await page.waitForTimeout(50);
        }
        return previous;
      };

      // How much chroma the heat grid ADDS, against one named ground mode.
      //
      // STARTS FROM A KNOWN STATE rather than inheriting one. An earlier version
      // measured "before" first and restored the layer to ON at the end, so the
      // SECOND call's baseline was already the with-cells picture, the toggle
      // was a no-op, and the chroma never moved. Unchecking first makes each
      // call self-contained and the two measurements unambiguous.
      const marginFor = async (mode) => {
        await page.locator("#ground-mode").selectOption(mode);

        await page.locator("#layer-cells").uncheck();
        const withoutCells = await settledChroma();

        // THE CELLS NOW ARRIVE ASYNCHRONOUSLY (round 10, stage B): the snapshot
        // omits the array while the layer is off, so switching it on is a
        // refresh rather than a redraw.
        //
        // AND THE MAP IS THE WRONG SURFACE TO WAIT ON, which cost a gate run to
        // learn: `enableCellLayer` waits for Leaflet `.affordance-cell` paths,
        // but everything measured here is the 3D CANVAS, whose grid comes from a
        // separate async `buildGrid` worker call. Map cells present does not
        // mean the scene has redrawn, so `settledChroma` could still read the
        // without-cells picture -- and the margin came out exactly 0.
        //
        // Waiting for the SCENE CHROMA TO MOVE is the non-circular signal: it
        // says the scene incorporated the toggle, without assuming which way.
        // `meanChroma` rather than a canvas dataURL, because an image
        // comparison answers the same question but dumps ~440 KB of base64 into
        // the failure message, which made the first attempt's own failure
        // unreadable.
        //
        // 30 s rather than `REPAINT`'s 15 s: this waits on a full refresh --
        // fetch loop, three progressive rings, a worker mesh build -- not on a
        // repaint. 15 s passed 3/3 standalone and failed under full-suite load.
        const settle = { timeout: 30000 };
        await enableCellLayer(page);
        await expect.poll(meanChroma, settle).not.toBe(withoutCells);
        const withCells = await settledChroma();

        expect(
          withCells,
          `${mode}: frame has chroma with cells`,
        ).toBeGreaterThan(0);
        expect(
          withoutCells,
          `${mode}: frame has chroma without cells`,
        ).toBeGreaterThan(0);
        return withCells - withoutCells;
      };

      // BOTH THE ISOLATED BACKDROP AND THE ONE A USER ACTUALLY SEES (F49), and
      // asserting only one of them is how this gate grew a hole.
      //
      // `cpu` is the plain lit ground. It isolates the relationship DEC-R4-5 is
      // about — data against BACKDROP — with every competing element switched
      // off, and it is what the first version of this test measured.
      //
      // WHY IT WAS NOT MEASURED AGAINST THE DEFAULT, originally, and the reason
      // is a finding rather than a convenience: run against round 5's default —
      // the height ramp (DEC-R5-4) — switching the cells ON *reduces* mean frame
      // chroma by 0.05. The ramp is a deliberately loud blue-to-white scale with
      // magenta for missing DEM, and it out-saturates the data layer DEC-R4-5
      // says must be loudest. **That constraint was ALREADY breached, by the
      // diagnostic, before round 6 touched anything** — which is direct evidence
      // for DEC-R6-5 demoting the ramp to a mode.
      //
      // THE HOLE THAT LEFT, AND WHY IT IS NOT ALLOWED BACK. The original carried
      // a comment promising "when §2 lands, the default ground becomes the one
      // measured here". §2 landed and made the default `cpu-slope`, not `cpu`,
      // so for one round the only durable defence of DEC-R4-5 measured a
      // configuration nobody sees. The slope treatment adds an aspect tint,
      // isoclines and a rim light, all of which put chroma into the backdrop.
      // A promise about a future default cannot live in a comment; it has to be
      // an assertion, so both modes are now named and a future default change
      // that breaks the constraint goes red instead of quietly stepping outside
      // the measurement.
      //
      // The default is spelled as a LITERAL, matching the rest of this suite,
      // and it is not floating free: `ground-mode.test.ts` pins
      // `DEFAULT_GROUND_MODE`, and the ground-mode picker spec above asserts the
      // control boots showing `cpu-slope`. A default change that missed this
      // line would fail there first.
      const DEFAULT_MODE = "cpu-slope";
      const plainMargin = await marginFor("cpu");
      const defaultMargin = await marginFor(DEFAULT_MODE);

      // The grid must ADD chroma, substantially, in BOTH. If a future exposure,
      // palette or ground-appearance change ever made the backdrop as colourful
      // as the data, this goes red — which is the whole point, because that is
      // the moment DEC-R4-5 is breached and it is otherwise invisible.
      //
      // MEASURED, by mutating each bound to an unreachable value and reading
      // what came back — an assertion nobody has watched fail is worth nothing,
      // and this suite has already shipped one vacuous test (§14.5's isocline
      // check, which asserted a constant against an argument it never took):
      //
      //   plain `cpu`   -> 9.285
      //   `cpu-slope`   -> 9.302  (the default)
      //
      // **The two agree to within 0.02, and that is the honest reading of F49:
      // the gate WAS sound at the default — by accident.** The aspect tint is
      // blended proportionally to steepness and the fixture site (Cologne) is
      // nearly flat, so the slope treatment puts almost no chroma into the
      // backdrop HERE. On a site with real relief, or after a default change, it
      // need not be. The second assertion costs one more measurement and removes
      // the accident; it is not carrying its weight in this number today, and
      // that is fine — it is carrying it against the change nobody has made yet.
      //
      // The bound of 5 therefore sits at ~54 % of the observed margin in both.
      //
      // **The wrong response to a red here is lowering the margin.** It is
      // either fixing the backdrop or re-judging the decision that made it the
      // default (DEC-R6-5 for `cpu-slope`), which is exactly the call the ramp
      // measurement above already forced once.
      expect(
        plainMargin,
        "plain ground: heat grid adds chroma",
      ).toBeGreaterThan(5);
      expect(
        defaultMargin,
        `${DEFAULT_MODE} (the default): heat grid adds chroma`,
      ).toBeGreaterThan(5);
    });
  });
});

/**
 * The affordance-tile look presets (§3, DEC-R6-9/10/22).
 *
 * WHY THIS TEST EXISTS RATHER THAN A SCREENSHOT. §3 is an experiment, so what
 * can be asserted is not which look is right — that is what the owner decides by
 * looking — but that the experiment WORKS: the key cycles, each preset actually
 * changes the picture, and the default is the look that shipped.
 *
 * The last of those is the one that protects the round. DEC-R6-22 keeps the
 * losing branches alive until §6 has landed, because two axes are premised on
 * the wider heat radius. Until then a preset accidentally becoming the default
 * would ship an experiment, and nothing else would notice.
 */
test.describe("the affordance-tile look presets", () => {
  test("cycle from a hotkey, change the picture, and start at the shipped look", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // CELLS ON: they start OFF since DEC-R7b-6, and this test judges the GRID
    // through the canvas rather than through the Leaflet DOM — so with the
    // layer off it compares two identical pictures and reports 0 changed
    // pixels, which looks like a broken repaint rather than a hidden layer.
    await enableCellLayer(page); // async since round 10 stage B

    await test.step("the default is the look that shipped", async () => {
      // Asserted on the STATUS LINE rather than on pixels: "which preset is
      // active" is a fact about state, and pixels are how the next step checks
      // that the state reaches the screen. Conflating them would make a
      // failure ambiguous.
      await expect(page.locator("#status")).toContainText("tiles current");
    });

    await test.step("pressing the key changes the picture", async () => {
      await installFrameProbe(page);
      await stashStableFrame(page);

      await page.locator("#scene").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("p");

      // The first step away from `current` is `opaque`, which only changes
      // alpha — so this also proves the cheap axes reach the material without a
      // republish.
      await expect(page.locator("#status")).toContainText("tiles opaque");
      await expect
        .poll(async () => (await diffFromStash(page, 24)).differing, REPAINT)
        .toBeGreaterThan(1000);
    });

    await test.step("a geometry preset rebuilds the grid rather than failing", async () => {
      // `prototype` and `bars` change the VERTEX BUFFERS, so they go through the
      // worker. The risk is not that they look wrong — it is that the rebuild
      // throws on an indexing mistake and the grid silently disappears, which a
      // cell-count assertion catches and a screenshot would not.
      for (const expected of ["prototype", "bars"]) {
        await page.keyboard.press("p");
        await expect(page.locator("#status")).toContainText(
          `tiles ${expected}`,
        );
        await expect(page.locator("#status")).toContainText(/\d+ cells/);
      }
    });

    await test.step("the cycle returns to the default", async () => {
      // Pressing through the whole list must come back, or the shipped look
      // becomes unreachable once someone has pressed the key.
      await page.keyboard.press("p");
      await expect(page.locator("#status")).toContainText("tiles translucent");
      await page.keyboard.press("p");
      await expect(page.locator("#status")).toContainText("tiles current");
    });

    await test.step("the preset is listed in the shortcut help", async () => {
      await page.keyboard.press("?");
      await expect(page.locator("#hotkey-help")).toContainText("preset");
      await page.keyboard.press("?");
    });
  });
});

test.describe("selecting a region", () => {
  /**
   * WHY THESE TESTS EXIST (DEC-R7b-3a). A testing session asked to click a heat
   * area and see its details, and reported that clicking one already showed a
   * bounding box. It did not: regions had a tooltip in 2D, no click handler in
   * either view, and were absent from the 3D raycast set by construction. What
   * was seen was the browser's focus outline on a Leaflet `<path>`.
   *
   * TWO TESTS RATHER THAN TWO STEPS, and that is a correction rather than a
   * style choice. Written as steps in one test, the 3D half ran against a panel
   * the 2D half had already opened — so `toBeVisible` passed on stale content
   * and the real assertion failed for a reason that had nothing to do with 3D.
   * The two routes to `regionSelected` are independent (a Leaflet handler and a
   * three.js raycast) and are now tested independently.
   */
  test("opens the details panel from the 2D map", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const panel = page.locator("#details");

    // CELLS OFF FIRST, and that is the realistic flow rather than a test
    // convenience: the cell layer draws in a pane ABOVE the region pane, so a
    // click anywhere a cell covers reaches the cell. That is deliberate --
    // `resolvePick` prefers the finer claim in 3D for the same reason -- and it
    // means a region is reachable exactly where the grid is not.
    await page.locator("#layer-cells").uncheck();

    // The FILLED class, not the outline: an unfilled sub-threshold outline is
    // also a `<path>`, and matching it would pass while nothing was selected.
    const region = page.locator("#map .region-fill").first();
    await region.waitFor({ state: "visible" });
    await region.click({ force: true });

    await expect(panel).toBeVisible();
    const stats = panel.locator(".panel-stats");
    await expect(stats).toBeVisible();
    // The statistic the whole panel exists for: the colour is the median, and
    // the range is what the colour cannot say.
    await expect(stats).toContainText("median");
    await expect(stats).toContainText("range");
  });

  test("opens the same panel from the 3D scene", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // WITH THE CELLS HIDDEN, which is the point rather than a convenience: a
    // slab lies directly under the grid and `resolvePick` prefers the finer
    // claim, so a region is reachable exactly where the grid is not. It is also
    // the state DEC-R7b-6 makes the default.
    await page.locator("#layer-cells").uncheck();

    const canvas = page.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const panel = page.locator("#details");
    await expect(panel).toBeVisible();
    // The SAME panel and the same mode a 2D click produces -- one selection, one
    // explanation, and the panel does not know which view produced it.
    await expect(panel.locator(".panel-stats")).toContainText("median");
  });

  test("replaces a region selection when a cell is selected", async ({
    page,
  }) => {
    // The mutual-exclusivity rule, seen from the outside. There is one panel, so
    // there is one selection; a region panel left under a cell selection would
    // be a confidently wrong answer.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const panel = page.locator("#details");

    await page.locator("#layer-cells").uncheck();
    const region = page.locator("#map .region-fill").first();
    await region.waitFor({ state: "visible" });
    await region.click({ force: true });
    await expect(panel.locator(".panel-stats")).toBeVisible();

    await enableCellLayer(page); // async since round 10 stage B
    const cell = page.locator("#map .affordance-cell").first();
    await cell.click({ force: true });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".panel-stats")).toHaveCount(0);
  });
});

test.describe("the geo-event", () => {
  /**
   * WHY THIS TEST EXISTS (round 9). Everything below the button is unit-tested —
   * the seeded candidates, the climb, the gate, the ensure-then-pin ordering —
   * but none of that proves the worker call, the button state and the drawing
   * are wired to each other. This is the only assertion that the feature exists
   * from a user's point of view.
   *
   * It also pins the in-progress state, which the root CLAUDE.md requires of an
   * async control and which is easy to omit: the operation can score hundreds of
   * chunks, so a button that looked inert while it worked would read as broken.
   */
  test("finds an event from the button and draws it on the map", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const button = page.locator("#geo-event");
    await expect(button).toHaveText(/Next geo-event/);

    await button.click();

    // The label must reach a terminal state. Either outcome is a pass — a
    // fixture with no qualifying ground genuinely has no event, and asserting
    // "an event was found" would make this test depend on the fixture's heat
    // rather than on the wiring.
    await expect(button).toHaveText(/Event at|No event nearby/, {
      timeout: 30_000,
    });
    await expect(button).toBeEnabled();

    // And nothing failed: a geo-event error routes through the same channel a
    // fetch failure does, so the header would be showing it.
    await expect(page.locator("#status")).not.toContainText("geo-event failed");

    // If it found one, it is on the map. The winner carries a class of its own
    // so this cannot pass on a candidate marker.
    const label = await button.textContent();
    if (label?.includes("Event at") === true) {
      // THE DISTANCE AND DIRECTION ARE THE POINT (F56), not decoration. The
      // winner is usually off-screen, so this string is the only feedback the
      // user gets; a label that lost them would look identical to a working
      // one on a map that happens to be showing nothing.
      expect(label).toMatch(
        /\d+(\.\d+)? (m|km) (N|NE|E|SE|S|SW|W|NW) · searched \d+ tiles?$/,
      );

      // PRESENT, not VISIBLE, and the difference is a real property of the
      // feature rather than a test convenience. An event tile is ~900 m across
      // and the demo opens at zoom 18, which shows a couple of hundred metres --
      // so the winner is very often outside the viewport, and Leaflet renders an
      // off-screen path as `d="M0 0"`, which reads as hidden. Asserting
      // visibility would make this test pass or fail on where the seeded
      // candidate happened to land.
      await expect(page.locator("#map .geo-winner")).not.toHaveCount(0);
      await expect(page.locator("#map .geo-candidate")).not.toHaveCount(0);
    }
  });
});

test.describe("the cell layer toggle", () => {
  /**
   * WHY THIS TEST EXISTS (F58).
   *
   * Round 10 stage B made switching the cell layer ON asynchronous: the snapshot
   * omits the array while the layer is off, so the toggle triggers a refresh
   * rather than a redraw. The round-10 summary ESTIMATED that this stays under
   * the "few hundred milliseconds" at which the root `CLAUDE.md` requires an
   * in-progress state, and flagged the estimate as an estimate.
   *
   * MEASURED AT ~1880 ms with the tiles already held — about 5x over. So the
   * switch needs a transitional state, and this asserts it is reached rather
   * than asserting a latency bound, which would be a machine-speed test.
   *
   * The rule the removed `setAvailable` left behind applies: DISABLED, never
   * hidden, stored value untouched. A control that disappears reads as a bug,
   * and one whose value is silently reset loses the choice just made.
   */
  test("shows an in-progress state while the cells are fetched", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const toggle = page.locator("#layer-cells");
    const row = page.locator("label.layer-toggle", { has: toggle });

    // OBSERVED, NOT POLLED. The busy state is transient — on a warm fixture it
    // can close in a few milliseconds — and a poll interval wide enough to be
    // cheap is wide enough to miss it entirely. That is the same reasoning
    // `recordStatus` gives for watching `#status` with a MutationObserver, and
    // the same technique.
    //
    // Two sequential `expect`s were the first attempt and were worse than
    // wrong: they sampled two different instants, so the class check passed and
    // the disabled check then failed against a state that had already cleared.
    const observed = await page.evaluate(() => {
      const input = document.getElementById("layer-cells");
      const label = input?.closest("label");
      if (label === null || label === undefined) return Promise.resolve(null);
      /** @type {{busy: boolean, disabled: boolean}[]} */
      const seen = [];
      const sample = () => {
        seen.push({
          busy: label.classList.contains("layer-busy"),
          disabled: input instanceof HTMLInputElement ? input.disabled : false,
        });
      };
      const observer = new MutationObserver(sample);
      observer.observe(label, { attributes: true, subtree: true });
      const w = /** @type {Record<string, unknown>} */ (window);
      w["__busySamples"] = seen;
      w["__stopBusy"] = () => {
        observer.disconnect();
        return seen;
      };
      return Promise.resolve(true);
    });
    expect(observed).toBe(true);

    await toggle.check();

    // AND LEFT: the terminal state is the switch usable again, with the choice
    // preserved — not reset, which is the half a naive implementation loses.
    await expect(row).not.toHaveClass(/layer-busy/, { timeout: 30000 });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await expect(page.locator("#map path.affordance-cell")).not.toHaveCount(0);

    // AND THE TRANSITIONAL STATE WAS ACTUALLY REACHED. Read only now, because
    // the observer had to outlive the whole operation — this is the assertion
    // the two racing `expect`s were trying and failing to make.
    const samples = await page.evaluate(() => {
      const w = /** @type {Record<string, unknown>} */ (window);
      const stop = w["__stopBusy"];
      return typeof stop === "function"
        ? /** @type {() => {busy: boolean, disabled: boolean}[]} */ (stop)()
        : [];
    });
    expect(
      samples.some((sample) => sample.busy && sample.disabled),
      "never saw the row busy AND the input disabled at the same moment",
    ).toBe(true);
  });

  test("leaves the switch usable when the refresh fails", async ({ page }) => {
    // THE FAILURE PATH, which `CLAUDE.md` requires alongside the success one.
    // A busy state that only clears on success strands the control forever, and
    // that is exactly the shape a `.then()` instead of a `.finally()` produces.
    // EVERY TILE REFUSED, from the start. `fetchFailed` then CLEARS the
    // snapshot, so the toggle sees nothing held, asks for a refresh, and that
    // refresh fails too -- which is the state the busy flag has to survive.
    //
    // (Written first as a `page.evaluate` calling a `__failWorker` hook that does
    // not exist, so the evaluate was a no-op and the test silently re-ran the
    // success path. An unfailable test, in the file where this round has been
    // cataloguing unfailable tests.)
    await stubNetwork(page, { overpassStatus: 400 });
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    await expect(page.locator("#status")).toContainText(/unavailable|Failed/);

    const toggle = page.locator("#layer-cells");
    const row = page.locator("label.layer-toggle", { has: toggle });

    // INSTALLED BEFORE THE CLICK. The busy window opens and closes inside the
    // operation, so an observer attached afterwards sees nothing and reports
    // "never busy" — which is what happened on the first attempt at this, for
    // the third time in this file.
    const seenBusy = await page.evaluate(() => {
      const input = document.getElementById("layer-cells");
      const label = input?.closest("label");
      if (label === null || label === undefined) return false;
      /** @type {boolean[]} */
      const seen = [];
      const observer = new MutationObserver(() => {
        seen.push(label.classList.contains("layer-busy"));
      });
      observer.observe(label, { attributes: true, subtree: true });
      const w = /** @type {Record<string, unknown>} */ (window);
      w["__stopFailBusy"] = () => {
        observer.disconnect();
        return seen;
      };
      return true;
    });
    expect(seenBusy).toBe(true);

    await toggle.check();

    // However it settles, the control comes back — AND WAS BUSY IN BETWEEN.
    //
    // `not.toHaveClass` alone cannot tell "cleared" from "never applied": it
    // succeeds on its first sample, so the assertion passed with
    // `withLayerBusy` deleted from `main.ts` entirely. The rewrite that fixed
    // the no-op `__failWorker` hook replaced an unfailable MECHANISM and kept an
    // unfailable ASSERTION, which is the same defect one level down.
    //
    // So the observer from the success test is installed here too, and the
    // busy state has to have been REACHED before it is allowed to be gone.
    await expect(row).not.toHaveClass(/layer-busy/, { timeout: 30000 });
    await expect(toggle).toBeEnabled();

    const failSamples = await page.evaluate(() => {
      const w = /** @type {Record<string, unknown>} */ (window);
      const stop = w["__stopFailBusy"];
      return typeof stop === "function"
        ? /** @type {() => boolean[]} */ (stop)()
        : [];
    });
    expect(
      failSamples.some((busy) => busy),
      "the switch never entered the busy state, so 'not busy' proves nothing",
    ).toBe(true);

    // NOTE ON WHAT THIS STILL DOES NOT COVER. `refresh()` does not reject here:
    // `update` collects refused tiles into `missingTiles` rather than throwing,
    // so an HTTP 400 is a SUCCESSFUL, empty refresh (`refresh-cycle.ts.md` says
    // so). The `finally`-versus-`then` distinction is unreachable from a browser
    // and is unit-tested on `withLayerBusy` instead.
  });
});
