// @ts-check
/**
 * The app shell: booting, the worker, the command bar, its panels and the
 * location controls. Everything here is about the page being alive and its
 * chrome behaving — not about what is drawn in either view.
 *
 * Split out of the single 4 486-line `osm-demo.spec.js` so the suite's shape
 * and its growth are visible; `fixtures.js` carries the shared setup and the
 * reasoning for why the whole suite is offline.
 */

import { test, expect } from "./e2e-test.js";
import { PROGRESSIVE_RADII } from "gps-plus-slam-osm";

import {
  AT_FIXTURE,
  enableCellLayer,
  recordStatusFromBoot,
  stubNetwork,
  waitForRefresh,
  REPAINT,
  appSearch,
  expectCanvasFillsContainer,
  diffFromStash,
  installFrameProbe,
  stashStableFrame,
  setting,
  expectNoPanelOpen,
  focusPageForHotkeys,
} from "./fixtures.js";

/**
 * The AR overlay's real DOM, built inside `#ar-root` with the production
 * class names and the production content lengths.
 *
 * EXTRACTED SO IT CAN BE MEASURED AT MORE THAN ONE VIEWPORT, which is the
 * gap the r541 field report walked into: the layout test below did its
 * arithmetic against "a 390 px phone" in the comments while running at the
 * suite's 1280 px Desktop Chrome. A stack that fits a desktop and folds on a
 * phone passed it, and the phone is the only device this overlay ships to.
 */
async function buildArOverlayFixture(page) {
  await page.evaluate(() => {
    const root = document.querySelector("#ar-root");
    if (root === null) throw new Error("no #ar-root");
    // THE FRAMEWORK'S CANVAS, first child and in flow, exactly as
    // `webxr-session.ts` inserts it — `insertBefore(renderer.domElement,
    // container.firstChild)`, with `setSize(innerWidth, innerHeight)` writing
    // the inline dimensions. THIS is the child the first version of this
    // fixture omitted, and omitting it is how a blocker passed a green gate:
    // making `#ar-root` itself the flex column turned this canvas into an
    // unshrinkable first item and pushed both controls a full viewport below
    // the fold. A fixture missing the one child that breaks the layout is not
    // a cheaper version of the real thing; it is a different thing.
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    root.append(canvas);

    const stack = document.createElement("div");
    stack.className = "ar-stack";
    const hud = document.createElement("div");
    hud.className = "ar-hud hud-readout plate";
    hud.textContent = "lat 50.9413\nlng 6.9580";
    // The collapse toggle is part of the readout's real box (DEC-H2).
    const toggle = document.createElement("button");
    toggle.className = "ar-hud-toggle btn btn--icon btn--glyph";
    toggle.textContent = "more";
    hud.append(toggle);
    stack.append(hud);
    root.append(stack);

    // THE BOTTOM STACK (H6): elevation + slider + gear on one row, the
    // compass readout on its own line beneath. Built with the production
    // class names and the production content lengths, because the whole
    // question this test answers is whether the real CSS fits them.
    const bottom = document.createElement("div");
    bottom.className = "ar-bottom hud-bottom";
    const bottomRow = document.createElement("div");
    bottomRow.className = "ar-bottom-row row";

    const elevation = document.createElement("div");
    elevation.className = "ar-elevation hud-elevation plate";
    const down = document.createElement("button");
    down.className = "ar-elevation-button btn btn--icon btn--glyph";
    down.textContent = "−";
    const value = document.createElement("span");
    value.className = "ar-elevation-value num";
    value.textContent = "+0.0 m";
    const up = document.createElement("button");
    up.className = "ar-elevation-button btn btn--icon btn--glyph";
    up.textContent = "+";
    elevation.append(down, value, up);

    const gearWrap = document.createElement("div");
    gearWrap.className = "ar-gear-wrap";
    const gear = document.createElement("button");
    gear.className = "ar-gear btn btn--icon";
    gear.textContent = "⚙";
    gearWrap.append(gear);

    bottomRow.append(elevation, gearWrap);
    bottom.append(bottomRow);
    root.append(bottom);
  });

  // THE COMPASS CONTROL IS THE REAL ONE (DEC-J12), not a hand-built copy.
  //
  // WHY THIS CHANGED. Everything above is a replica built with production class
  // names, and the compass replica had ALREADY DRIFTED: it rendered
  // "takes 15-30 fixes to express a change" (37 characters, ASCII hyphen)
  // against the production string OF THAT DAY, "takes ~15–30 fixes to express"
  // (29, en dash). The layout question this fixture exists to answer is whether
  // the real CSS fits the real strings, and a replica that is eight characters
  // too long answers a different question. J5 was about to widen that gap by
  // editing the copy by hand — the exact drift the spec's own comment warned
  // about.
  //
  // BOTH OF THOSE STRINGS ARE NOW HISTORY, which is the point: J5 shortened
  // production again in this same branch, to "~15–30 fixes to show" (20). A
  // replica would have needed a third hand-edit to keep up. This fixture did
  // not, because it renders whatever `ar-compass-control.ts` renders.
  //
  // MOUNTED BY DYNAMIC IMPORT OF THE SOURCE MODULE, which needs NO
  // production-visible export: the e2e runs against the Vite DEV server (see
  // `playwright.config.js`'s `webServer`), so `/src/*.ts` is served and
  // importable from the page. That is the whole reason DEC-J12's stop condition
  // ("if it needs an export purely for a test, stop") was never reached.
  //
  // ⚠️ IT COUPLES THIS FIXTURE TO THE DEV SERVER. Pointed at a built preview,
  // the import 404s and this throws — loudly, which is the right failure: a
  // silent fallback to a replica is what this replaces.
  //
  // AND IT COSTS A KNIP ENTRY: `/src/...` is not node-resolvable from this
  // file, so the root `check:deadcode` stage fails on it without the
  // `ignoreUnresolved` line in the repo-root `knip.json` (reasoning in
  // `knip.json.md`). Rename this module and BOTH places have to move.
  await page.evaluate(async () => {
    const bottom = document.querySelector("#ar-root .ar-bottom");
    if (bottom === null) throw new Error("no .ar-bottom");
    const module = await import("/src/ar-compass-control.ts");
    const control = module.createArCompassControl({
      root: bottom,
      onChange: () => {},
    });
    control.attach();
    // READY, because the two hint strings differ in length and the LONGER one
    // is the steady state this layout has to hold.
    control.setReady(true);
  });
}

test.describe("the demo boots", () => {
  test("loads the rule table, draws a basemap, reports its scale, says when it is still widening, on a clean console and a real worker, the views filling the row @pr", async ({
    page,
  }) => {
    // SEVEN BEHAVIOURS, ONE BOOT (the console, the worker and the desktop
    // layout joined the first four: each was a boot of its own asserting on
    // an unchanged page). All four assert on the SAME boot and none of
    // them mutates anything, so paying for four boots bought nothing but wall
    // clock. `test.step` keeps each one separately named in the report, which is
    // what stops a failure from pointing at a group instead of at a behaviour.
    //
    // The status observer is installed BEFORE `goto`, through an init script
    // that survives the navigation — the widening step needs it recording
    // across the very boot the other three then assert on, and the marker it
    // watches for can be gone before an after-`goto` install lands.
    const counts = await stubNetwork(page);
    // INSTALLED BEFORE `goto`, and that ordering IS the fix. The widening
    // marker is on screen only between the first ring publishing and the last;
    // recording from an `evaluate` after `goto` raced the boot and lost it
    // twice in five full-suite runs. `recordStatusFromBoot` installs at
    // document-start, so there is no window to lose it in.
    const history = await recordStatusFromBoot(page);
    // The console from the first line on (see "stays clean" below).
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    // Every `new Worker`, installed before any module runs, so the demo's own
    // construction is seen.
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

    await test.step("loads the rule table and populates the category picker", async () => {
      // The categories come from the rule table, not from a hardcoded list, so a
      // populated picker is evidence the table parsed. The default is
      // `battleArea` (DEC-G3): the demo's headline feature is the geo-event,
      // which models a boss NPC, and a boss belongs on a battle area rather
      // than on a pavement. It is a GUARDED choice — a table without that
      // column falls back to the first — so this also pins that the shipped
      // sheet still has it.
      const options = page.locator("#category option");
      await expect(options).not.toHaveCount(0);
      await expect(page.locator("#category")).toHaveValue("battleArea");

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
      // THE PLATE SHOWS WITH THE CELLS whose colours it explains, as the
      // chosen command-bar design has it; at rest the bar's category picker
      // names the category. Both directions, so neither half is assumed.
      const legend = page.locator("#legend");
      await expect(page.locator("#legend-plate")).toBeHidden();
      await enableCellLayer(page);
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
      // WHAT THE DATA REACHES, beside the fixed ramp. Asserted on the page too,
      // beside `legend-view.test.ts`: `heat-colours.ts.md` justifies saturating
      // 10-14 % of `walkable` on the grounds that "the legend compensates, and
      // has to", so the readout has to reach the screen.
      //
      // On the TEXT, not on an `aria-label`: a span with no role is
      // `role="generic"`, where ARIA prohibits an accessible name, so the
      // attribute is not a reliable channel. Both numbers are visible.
      await expect(legend.locator(".legend-observed")).toContainText(
        "max here",
      );
      await expect(legend.locator(".legend-observed")).toContainText("above");
      await page.locator("#layer-cells").uncheck();
      await expect(page.locator("#legend-plate")).toBeHidden();
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
      //
      // THE HISTORY RIDES ALONG IN THE FAILURE MESSAGE, permanently. This step
      // failed twice in five full-suite runs while passing 5/5 alone, and the
      // one thing needed to tell the competing explanations apart is what was
      // actually recorded: a first entry of `starting…` means the observer was
      // in place from the beginning and the marker genuinely never appeared,
      // while a first entry of the settled final text means the recorder was
      // installed too late to see it. Chasing that with instrumented reruns
      // costs ~11 minutes an attempt; attaching it here costs nothing and the
      // next natural failure carries the answer.
      expect(
        seen.filter((t) => /widening/.test(t) && /\d+ cells/.test(t)),
        `status history (${seen.length} entries):\n${seen.join("\n")}`,
      ).not.toHaveLength(0);

      // And it is GONE at the end. `waitForRefresh` now waits for exactly this, so
      // a marker that never cleared would hang the whole suite rather than fail
      // here — but asserting it keeps the reason visible at the point of the claim.
      await expect(page.locator("#status")).not.toContainText("widening");
      await expect(page.locator("#status")).toContainText(/\d+ cells/);
    });

    await test.step("stays clean — no shader, WebGL or page errors", async () => {
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
      const ignorable = (text) =>
        // The suite blocks the live rule sheet on purpose; the app reports the
        // degradation in its status line and the fixture asserts on it.
        /Rule table fetch failed/.test(text) ||
        // Blocked by `stubNetwork`, deliberately. `net::ERR_FAILED` is what
        // Chrome logs for a route that ABORTS the request, which is what the stub
        // does — it never answers with a status code.
        //
        // `Failed to load resource` IS NO LONGER IGNORED. This clause used to
        // read `net::ERR_FAILED|Failed to load resource`, which swallowed every
        // response answered with an error status — a 404, a 429, a 500 — along
        // with the aborts it was written for. Those are exactly the failures
        // worth hearing about. Aborted requests are still tolerated above.
        //
        // IT IS NOT, HOWEVER, WHY THE `favicon.ico` 404 SURVIVED (corrected in
        // review on #279). `scene-3d.spec.js` loads `/gallery.html` — a page that
        // had no favicon either — and asserts an EMPTY console with no filter at
        // all, and it is green. Headless Chromium in this suite never requests
        // `/favicon.ico`, so no filter here could have caught it. That one was
        // only ever visible in a real browser.
        /net::ERR_FAILED/.test(text);

      const real = errors.filter((text) => !ignorable(text));
      expect(
        real,
        `unexpected console errors:\n${real.join("\n---\n")}`,
      ).toEqual([]);
    });

    await test.step("is served by a worker that was really constructed, so the UI thread is not doing the work", async () => {
      // WHY THIS STEP MATTERS. Every other test in this suite would pass just
      // as well if the worker were quietly bypassed and everything ran on the
      // main thread — they assert on what is drawn, and the drawing is
      // identical either way. Counting `new Worker` rather than timing
      // anything: a timing assertion for "the UI thread stayed responsive" is
      // exactly the kind of threshold that passes on a fast machine and flakes
      // in CI.
      const workers = await page.evaluate(
        () => /** @type {any} */ (window).__workers,
      );
      expect(workers).toHaveLength(1);
      expect(workers[0]).toContain("demo-worker");
      // And it ANSWERED: the status line's cell count comes back over the RPC
      // boundary, so a worker that started and then died would fail here.
      await expect(page.locator("#status")).toContainText(/\d+ cells/);
    });

    await test.step("leaves the desktop layout alone while no session is running", async () => {
      // `#ar-root` is a child of the same grid as `#map` and `#scene`. As an
      // in-flow item with no CSS it added an implicit second row and took
      // roughly half the height from the views. The views fill the row; a
      // stolen implicit row shows up here as roughly half, so the bound is
      // generous and still discriminating.
      const main = await page.locator("main").boundingBox();
      const scene = await page.locator("#scene").boundingBox();
      if (main === null || scene === null) throw new Error("no boxes");
      expect(scene.height).toBeGreaterThan(main.height * 0.9);
    });
  });
});

test.describe("the worker", () => {
  test("a dead worker is REPORTED, not left hanging @pr", async ({ page }) => {
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

/** Long enough that the loading overlay's 1 s announce delay has certainly elapsed. */
const AFTER_ANNOUNCE = { timeout: 8_000 };

test.describe("the location picker", () => {
  // TWO TESTS, ONE PER GESTURE. One boot per gesture carries every check of that
  // gesture, in the order the states occur.
  test("jumps to a named place: clears the old city at once, announces the load centred on the scene, re-runs the pipeline, and keeps the place in the URL across a reload", async ({
    page,
  }) => {
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("is populated by the picker and rests on its placeholder", async () => {
      // WHY THIS TEST MATTERS. The unit test pins that the picker reports the
      // right POSITION; nothing there proves the report reaches Leaflet and the
      // store. This is the wiring half, and its failure mode is the quiet one —
      // a picker that changes its own value and nothing else looks exactly like a
      // picker whose site happens to have no data.
      // The markup carries no place names of its own — `index.html` ships an
      // EMPTY `<select>` and `attachSitePicker` fills it. WHICH places, and how
      // many, is `picker-places.test.ts`'s assertion against the list; repeating
      // a count here only bought a second place to update, and duly broke when
      // DEC-R6b-4 took the list from six to fourteen. What this has to catch is
      // the picker never running at all, which leaves the placeholder alone.
      const options = page.locator("#site option");
      await expect(options).not.toHaveCount(1);
      // ASSERTED ON THE SELECT, NOT ON AN OPTION (2026-08-19). This line used to
      // read `expect(options.first()).toHaveValue("")`, and an `<option>` is not
      // an input, textarea or select — so it began failing with "Not an input
      // element" the moment F3c unwrapped the picker from its `<label>`.
      //
      // WHY THE WRAPPER MADE IT PASS, since an earlier version of this comment
      // recorded that as unexplained: Playwright's `inputValue` retargets with
      // `follow-label`. For an element that is not itself a form control it takes
      // `element.closest("label")` and uses that label's `.control` — so an
      // `<option>` inside `<label>location <select id="site">…</label>` resolved
      // to the SELECT, whose value is `""`. Removing the wrapper removed the
      // retarget path. Recording a checkable mechanism as a mystery is worse than
      // not mentioning it: it tells the next reader not to look.
      //
      // What the test actually needs to catch is the picker never running, which
      // leaves the placeholder selected and alone. Both halves of that are
      // asserted here: the select still rests on the placeholder, and the
      // placeholder is the first option rather than a real place.
      await expect(page.locator("#site")).toHaveValue("");
      await expect(options.first()).toHaveText("Jump to City");
    });

    /** Basemap tiles requested from the moment the choice is made. */
    const tilesAfter = [];
    const tilesBefore = new Set();
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes("tile.openstreetmap.org")) return;
      tilesAfter.push(url);
    });
    for (const url of tilesAfter.splice(0)) tilesBefore.add(url);

    await test.step("clears the old city the moment a new one is DECLARED, and announces the load centred on the scene", async () => {
      // WHY THIS TEST MATTERS. The eighth testing session jumped New York ->
      // London, watched the height profile switch immediately, and watched New
      // York's buildings and cells stay on screen for the 20-30 s the Overpass
      // fetch took — under a status line that already said London. The status
      // channel was right and the picture was wrong, so making the status louder
      // would have fixed nothing; what had to change is that the scene stops
      // asserting a city the user has left.
      //
      // The window is real in the app and would be a race here, so the next fetch
      // is HELD: everything asserted below happens while London is still loading,
      // which is exactly the state that was reported.
      // The cell grid starts OFF (DEC-R7b-6), and it is the observable here: it is
      // drawn straight from the snapshot, so "the old city is still on screen" and
      // "the store still holds it" are the same statement.
      await enableCellLayer(page);

      const cells = page.locator("#map path.affordance-cell");
      await expect(cells).not.toHaveCount(0);

      counts.holdOverpass();
      // Porto, since DEC-R6b-1 dropped Heidelberg from the dropdown. It has to be
      // a place the picker actually OFFERS: `selectOption` on a value with no
      // matching option throws, so this line is itself a check that the id in the
      // list and the id used here have not drifted apart.
      await page.selectOption("#site", "porto-ribeira");

      // THE ASSERTION. Not "eventually the new city appears" — that was already
      // true and is what made the defect invisible to the suite. The old city's
      // cells are gone WHILE the new data is still in flight.
      await expect(cells).toHaveCount(0, { timeout: 15000 });

      // And the loading channel still explains the empty scene, so the two agree
      // for the first time rather than contradicting each other.
      await expect(page.locator("#status")).toContainText(/Fetching/i);

      // THE LOADING OVERLAY, while the same fetch is held: a jump to another
      // city issues a real Overpass query, so holding it holds the refresh
      // open past the announce delay.
      const overlay = page.locator("#loading-overlay");
      await expect(overlay).toBeVisible(AFTER_ANNOUNCE);
      await expect(overlay).toContainText("Loading", AFTER_ANNOUNCE);
      // CENTRED ON THE 3D SCENE, which is the owner's correction to the first
      // version and the only thing here a unit test genuinely cannot check: the
      // overlay is absolutely positioned inside `#scene`, so whether it lands in
      // the middle depends on that element being positioned, on the flex layout
      // around it, and on the real box sizes.
      const sceneBox = await page.locator("#scene").boundingBox();
      const overlayBox = await overlay.boundingBox();
      if (sceneBox === null || overlayBox === null) {
        throw new Error("expected both #scene and the overlay to be laid out");
      }
      const centreOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      const scene = centreOf(sceneBox);
      const shown = centreOf(overlayBox);
      // A couple of pixels of slack for sub-pixel layout; anything corner-ish
      // would miss by hundreds.
      expect(Math.abs(shown.x - scene.x)).toBeLessThan(4);
      expect(Math.abs(shown.y - scene.y)).toBeLessThan(4);
      // THE SECOND CHANNEL, and the one that survives a closed info panel only
      // because it is a class on an element whose text is rewritten constantly -
      // a child element would be deleted by the next `writeStatus`.
      await expect(page.locator("#status")).toHaveClass(/is-loading/, REPAINT);
    });

    await test.step("moves the map and re-runs the pipeline, and both loading channels clear together (W5)", async () => {
      counts.releaseOverpass();
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
      await expect(page.locator("#map path.affordance-cell")).not.toHaveCount(
        0,
      );
      // THE TOAST IS GONE once the refresh has delivered. Note what this does NOT
      // show: `waitForRefresh` returns after the whole widening, by which time
      // `busy` has fallen too, so both hide paths have fired and this cannot tell
      // them apart. That the hide is IMMEDIATE on data arrival - the owner's
      // "instantly" - is a unit test on a fake clock, where the two can be driven
      // separately. The comment that used to sit here claimed this assertion
      // proved it, which it never did.
      await expect(page.locator("#loading-overlay")).toBeHidden(REPAINT);
      await expect(page.locator("#status")).not.toHaveClass(
        /is-loading/,
        REPAINT,
      );
    });

    await test.step("writes the place into the URL, so a reload comes back to it", async () => {
      // WHY THIS TEST MATTERS. The read side has parsed `?lat=&lng=` and `?site=`
      // since round 4 and nothing ever wrote them, so the session's jump to London
      // survived exactly until a reload. The ask was for a link that can be pasted
      // into a report and navigated to by this suite — so the round trip through a
      // real reload is the assertion, not the string alone.
      // A NAMED place writes its id: it says WHERE in a link a human reads, and it
      // survives a re-capture moving the coordinates.
      await expect
        .poll(() => appSearch(page.url()))
        .toBe("?site=porto-ribeira");

      // The round trip. A reload with no other state must land back at Porto
      // rather than at the demo's default.
      await page.reload();
      await waitForRefresh(page);
      await expect(page.locator("#site")).toHaveValue("");
      await expect
        .poll(() => appSearch(page.url()))
        .toBe("?site=porto-ribeira");

      // Moving without naming a place writes COORDINATES instead, and drops the
      // stale id — a walk away from Porto must not keep claiming to be at Porto.
      //
      // NOT ANCHORED AT THE END SINCE STAGE 5 (DEC-R13-7): recentring the 3D view
      // on a map click moves the camera, so the camera writer adds its own keys.
      // The assertion that matters is that the PLACE keys are right and the site
      // id is gone, which is what the two checks below say separately.
      await page.locator("#map").click({ position: { x: 120, y: 120 } });
      await expect
        .poll(() => appSearch(page.url()))
        .toMatch(/^\?lat=-?\d+\.\d{5}&lng=-?\d+\.\d{5}/);
      expect(new URL(page.url()).searchParams.get("site")).toBeNull();
    });
  });

  test("links the 3D camera to the URL and to the 2D map: a map drag carries it, and a zoom keeps its target", async ({
    page,
  }) => {
    // THE ORDER IS LOAD-BEARING. The two-drag step asserts that no camera key
    // has been written yet, so it runs first.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("dragging the 2D map carries the 3D camera with it", async () => {
      // WHY THIS TEST MATTERS: the seventeenth session asked for the two views to
      // agree — "wenn man in der 2d Karte die Karte verschiebt, die Kamera in der
      // 3d Szene an die gleiche Stelle springt" — and this is the wiring that
      // makes them. The unit tests own the latch's logic; only an e2e can prove
      // that a real Leaflet drag reaches `buildingView.recentre` through it.
      //
      // OBSERVED THROUGH THE CAMERA LINK, which is the only machine-readable
      // statement of where the 3D view is looking (the camera matrix is not
      // exposed, and `data-frames` counts repaints from half a dozen unrelated
      // causes — it would rise whether or not the camera moved).
      //
      // TWO DRAGS IN THE SAME DIRECTION, not one: a single drag proves only that
      // SOMETHING wrote the URL. Dragging the content west twice walks the map's
      // centre east twice, so a camera that follows the centre must report a
      // strictly increasing longitude. A camera that merely twitched would not.
      const box = await page.locator("#map").boundingBox();
      if (box === null) throw new Error("no map box");
      const midX = box.x + box.width * 0.5;
      const midY = box.y + box.height * 0.5;

      const dragWest = async () => {
        await page.mouse.move(midX, midY);
        await page.mouse.down();
        await page.mouse.move(midX - 120, midY, { steps: 12 });
        await page.mouse.up();
      };

      // NOTHING WRITTEN YET, asserted rather than assumed. The two-drag
      // comparison below only means what its comment says if the first reading is
      // genuinely produced by the first drag — a `clng` already present at boot
      // would make the poll resolve instantly on a pre-drag value, and the
      // increase would then be satisfied by one drag. Nothing writes camera keys
      // at boot today; this is what keeps that true.
      expect(new URL(page.url()).searchParams.get("clng")).toBeNull();

      await dragWest();
      // AFTER THE THROTTLE, which is why this is a poll rather than a read: the
      // camera writer samples rather than writing per frame.
      await expect
        .poll(() => new URL(page.url()).searchParams.get("clng"))
        .not.toBeNull();
      const first = Number(new URL(page.url()).searchParams.get("clng"));
      expect(Number.isFinite(first)).toBe(true);

      await dragWest();
      await expect
        .poll(() => Number(new URL(page.url()).searchParams.get("clng")))
        .toBeGreaterThan(first);
    });

    await test.step("zooming the 2D map still KEEPS the 3D camera's target", async () => {
      // WHY THIS TEST MATTERS, and it is a regression guard rather than a new
      // feature: `zoomend` dollies the camera without moving its target, on
      // purpose — the two views' targets diverge all the time (a map click
      // recentres the camera without moving the map, a 3D drag moves the target
      // without moving the map), and a zoom must not silently reconcile them.
      //
      // The drag follow added by DEC-L4 can break exactly that, because Leaflet
      // raises `moveend` for a ZOOM as well as for a pan. The first version of
      // the latch armed on `zoomstart` to cover a drag that becomes a pinch, and
      // that made every wheel or button zoom teleport the camera's target to the
      // map centre. Found in the milestone review; this is the assertion that
      // would have caught it.
      // MAKE THE TWO DIVERGE FIRST, or the assertion is vacuous: with the camera
      // target already at the map centre, a recentre onto that centre is a no-op
      // and this test would pass against the defect.
      //
      // BY A MAP CLICK, NOT A 3D DRAG, and the difference matters. A click is one
      // discrete move — it recentres the camera on the clicked point and leaves
      // the map's centre alone — so the camera URL settles on a final value. A
      // drag writes through a 400 ms throttle, so the baseline read back is a
      // MID-drag sample, and the later write reports the drag's true endpoint: a
      // difference of ~0.0006° that has nothing to do with zooming. The first
      // version of this test read that as the defect.
      await page.locator("#map").click({ position: { x: 90, y: 90 } });
      await waitForRefresh(page);

      await expect
        .poll(() => new URL(page.url()).searchParams.get("clat"))
        .not.toBeNull();
      const before = new URL(page.url()).searchParams;
      const clat = Number(before.get("clat"));
      const clng = Number(before.get("clng"));

      await page.locator(".leaflet-control-zoom-in").click();
      // The dolly writes the camera URL again, so waiting for the DISTANCE to
      // change is what proves the zoom was actually processed — polling for "the
      // target did not change" would otherwise pass before anything happened.
      await expect
        .poll(() => Number(new URL(page.url()).searchParams.get("cdist")))
        .toBeLessThan(Number(before.get("cdist")));

      const after = new URL(page.url()).searchParams;
      // Five decimals is ~1.1 m; 0.0005° is a ~55 m bound that still fails
      // outright if the target was snapped to the map centre.
      expect(Math.abs(Number(after.get("clat")) - clat)).toBeLessThan(0.0005);
      expect(Math.abs(Number(after.get("clng")) - clng)).toBeLessThan(0.0005);
    });
  });

  // ITS OWN BOOT: the poll below proves a camera key gets written at all, which
  // only means something while the URL has none yet.
  test("remembers where the camera was looking, so a finding can be linked (DEC-R13-7)", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS. This partially reverses DEC-R12-5, and the reason
    // is a workflow rather than a feature: twice in the ninth session a finding
    // could not be pointed at — "wüsste ich nicht, wie ich dir das irgendwie
    // sinnvoll als Testbereich nennen kann". A written parameter nothing reads
    // back would leave that exactly as broken while looking fixed, so the
    // assertion is the round trip through a real reload, as for the place above.
    await stubNetwork(page);
    // `damping=off`: each drag below then costs its own frames, not an eased
    // tail of software-rendered repaints. The knob is read-only, so the URL
    // writers keep it through the reload; the app keeps its damping by default.
    await page.goto(`${AT_FIXTURE}&damping=off`);
    await waitForRefresh(page);

    const canvas = page.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");

    // A DRAG, not a click: panning is what the session was doing when it wanted
    // the URL to remember. MapControls pans with the primary button.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    // ONE move: the claim is the pose the drag ends on, each move costs
    // several frames on a software-rendered runner, and with damping off the
    // pan ends at the same point however many moves lead there.
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
    await page.mouse.up();

    // AFTER THE DEBOUNCE, which is the point of the poll rather than a read:
    // the write is deliberately not per-frame (400 ms), and asserting
    // immediately would pass only by accident.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("clat"))
      .not.toBeNull();
    const written = new URL(page.url()).searchParams;
    const clat = Number(written.get("clat"));
    const clng = Number(written.get("clng"));
    expect(Number.isFinite(clat)).toBe(true);
    expect(Number.isFinite(clng)).toBe(true);
    expect(Number(written.get("cdist"))).toBeGreaterThan(0);

    // THE ROUND TRIP. Reloading must aim the camera back at the same place —
    // observed through the URL the restored view writes for itself, which is
    // the only machine-readable statement of where it ended up looking.
    await page.reload();
    await waitForRefresh(page);
    // THE RELOADED URL STILL CARRIES THE OLD KEYS, and the restored view
    // writes nothing until the camera moves. So "a key is present" holds
    // before the nudge has written anything, and a read then compares the
    // link with itself: a restore that did nothing would pass. What is read
    // below is the nudge's own write, observed as a change of the pair.
    const pairNow = () => {
      const params = new URL(page.url()).searchParams;
      return `${params.get("clat")},${params.get("clng")}`;
    };
    const linked = pairNow();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    // Twenty pixels, not two: the writer skips a query that did not change,
    // and two pixels can round to the same five decimals, so no write would
    // come at all. Twenty is still metres, far inside the bound below.
    await page.mouse.move(
      box.x + box.width * 0.5 + 20,
      box.y + box.height * 0.5,
    );
    await page.mouse.up();
    // Times out, and fails, when the nudge writes nothing.
    await expect.poll(pairNow).not.toBe(linked);
    const back = new URL(page.url()).searchParams;
    const backLat = Number(back.get("clat"));
    const backLng = Number(back.get("clng"));
    // A nudge of a few metres, so the target must land near where it was.
    // Five decimals is ~1.1 m, so 0.001° is a generous ~110 m bound.
    expect(Math.abs(backLat - clat)).toBeLessThan(0.001);
    expect(Math.abs(backLng - clng)).toBeLessThan(0.001);
    // AND NEARER THE LINK THAN THE DEFAULT VIEW. The first drag moves the
    // target by less than the bound above, so a restore that did nothing (the
    // camera back on the fixture centre, plus the nudge) could still fit
    // inside it. Measured against both candidates, it cannot.
    const [fixtureLat, fixtureLng] = [50.9231, 6.9445];
    expect(Math.hypot(backLat - clat, backLng - clng)).toBeLessThan(
      Math.hypot(backLat - fixtureLat, backLng - fixtureLng),
    );
  });
});

test.describe("the phone layout", () => {
  /**
   * ONE BOOT FOR EVERY PHONE-LAYOUT CHECK, at 390 x 780. The steps that measure
   * the page at rest run first, the ones that change it (the sheet drag, the
   * failed locate) after them. The command bar and its panels are measured in
   * `hud-layout.spec.js`.
   *
   * AT DPR 2, so the canvas-size check runs at the ratio its bug needs (it is
   * identically zero at dpr 1). Every other step measures CSS pixels, which a
   * device pixel ratio does not change.
   */
  test.use({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });

  test("lays out the canvas, the map buttons, the locate pin and the sheet, toasts an error without opening a panel, and keeps the credits visible", async ({
    page,
    context,
  }) => {
    // XR SUPPORT IS STUBBED so the AR button exists: the map-buttons step
    // measures its wrapper too, and without the stub that half means nothing.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "xr", {
        configurable: true,
        value: { isSessionSupported: () => Promise.resolve(true) },
      });
    });
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("lays out the 3D canvas at its container's size, not at its drawing buffer's (dpr 2)", async () => {
      // W1 / finding R3-2. Without the fix the canvas element is 780x1560 CSS
      // pixels inside a 390-wide container.
      await expectCanvasFillsContainer(page);
    });

    await test.step("the map buttons wear only the design system's chrome: no Leaflet bar around them, the glyph centred", async () => {
      // WHY THIS TEST MATTERS (owner taste round 2026-09-04, plan §3). Both
      // buttons are design-system atoms, but their Leaflet control wrappers
      // still carried `leaflet-bar`, whose stylesheet is loaded unlayered from
      // the CDN and beats the layered atoms: under `leaflet-touch` (which
      // Leaflet 1.9 adds wherever PointerEvent exists — every modern browser,
      // headless Chromium included) that is a 2 px dark border at a 4 px
      // radius around a 44 px button with its own 14 px radius, the button
      // anchored top-left inside a wrapper that is wider and taller than it.
      // The owner saw "two rounded outlines, the pin too far left and up, a
      // thin dark line underneath". Red before the fix at THIS viewport: the
      // wrapper's border, the wrapper-vs-button box, the glyph's centre and
      // the glyph's rendered width; the wrapper's box-shadow was already
      // `none` under `leaflet-touch` and is asserted so nothing brings it
      // back. The AR button is only present with XR support stubbed, so the
      // stub is what makes its half mean anything.
      await expect(page.locator("#enter-ar")).toBeVisible({ timeout: 10000 });

      for (const [wrapper, button] of [
        [".locate-control", ".locate-button"],
        [".ar-control", "#enter-ar"],
      ]) {
        const chrome = await page.locator(wrapper).evaluate((el) => {
          const s = getComputedStyle(el);
          return { border: s.borderTopWidth, shadow: s.boxShadow };
        });
        expect(chrome, `${wrapper} draws chrome of its own`).toEqual({
          border: "0px",
          shadow: "none",
        });
        const outer = await page.locator(wrapper).boundingBox();
        const inner = await page.locator(button).boundingBox();
        if (outer === null || inner === null) throw new Error("no boxes");
        // The wrapper IS the button's box: nothing of Leaflet's is drawn
        // around it (Leaflet's own `leaflet-control` float/margin sit outside).
        expect(
          Math.abs(outer.width - inner.width),
          `${wrapper} width`,
        ).toBeLessThan(0.5);
        expect(
          Math.abs(outer.height - inner.height),
          `${wrapper} height`,
        ).toBeLessThan(0.5);
        expect(inner.width, `${button} is the 44 px tap square`).toBeCloseTo(
          44,
          0,
        );
        expect(inner.height, `${button} is the 44 px tap square`).toBeCloseTo(
          44,
          0,
        );
      }

      // The pin sits at the button's centre, not on its text baseline.
      const button = await page.locator(".locate-button").boundingBox();
      const pin = await page.locator(".locate-button svg").boundingBox();
      if (button === null || pin === null) throw new Error("no boxes");
      const dx = pin.x + pin.width / 2 - (button.x + button.width / 2);
      const dy = pin.y + pin.height / 2 - (button.y + button.height / 2);
      expect(Math.abs(dx), "pin x offset").toBeLessThan(1);
      expect(Math.abs(dy), "pin y offset").toBeLessThan(1);
      // And the GLYPH fills the system's 24 px icon box: the path's own bounds
      // are the viewBox now (5 2 14 20 → 16.8 × 24 px under `meet`); before,
      // the path drew 14 × 20 inside a 24 × 24 box. Measured on the <path>,
      // not the <svg> — the element was 24 × 24 all along, so an assertion on
      // it could not fail (milestone review, 2026-09-05).
      const glyph = await page
        .locator(".locate-button svg path")
        .evaluate((path) => {
          const r = path.getBoundingClientRect();
          return { width: r.width, height: r.height };
        });
      expect(glyph.height, "glyph height").toBeCloseTo(24, 0);
      expect(glyph.width, "glyph width").toBeGreaterThan(16);
    });

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
      // UNCONDITIONAL, and that is the fix rather than a tidy-up. This used to
      // read `if (attribution !== null) { … }`, and `boundingBox()` returns
      // null for a hidden element — so once the attribution control gained a
      // hidden state (it hides itself when there is nothing to credit), a
      // regression that hid the credit would have made this guard SKIP rather
      // than fail. Same vacuity class as the `toContainText` assertions, in the
      // one assertion their migration did not touch.
      expect(attribution).not.toBeNull();
      // Strictly above it, not overlapping it.
      expect(box.y + box.height).toBeLessThanOrEqual((attribution?.y ?? 0) + 1);

      // AND THE CREDIT IS INSIDE THE MAP, not merely "visible". `toBeVisible()`
      // does not detect an element clipped by an ancestor's `overflow: hidden`,
      // which `.leaflet-container` sets — and on mobile the map is a
      // drag-resizable sheet, so "off the bottom of a short sheet" is a
      // reachable state that every other assertion here would call fine.
      expect(
        (attribution?.y ?? 0) + (attribution?.height ?? 0),
      ).toBeLessThanOrEqual(mapBox.y + mapBox.height + 1);
      // ON THE VISIBLE SHORT NAME, not on the container's `textContent`. This
      // was the one `toContainText` the F10 migration missed, and it is the
      // exact shape that assertion class fails at: it matches a credit hidden
      // behind the expander and reports the obligation as met.
      await expect(
        page.locator("#map .map-attribution-short").filter({
          hasText: "OpenStreetMap",
        }),
      ).toBeVisible();
    });

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

    await test.step("toasts an error and opens no panel to show it", async () => {
      // AN ERROR NEVER TAKES OVER THE SCREEN (DEC-U10). The demo once expanded
      // its header to show a failure, which the owner reported as a bug: the
      // message now goes to a toast, visible whatever is open, and no panel
      // opens on its own to deliver it.
      //
      // Still driven through a REAL failure rather than a hand-dispatched one:
      // the wiring from reporter to surface is the part that can be missing.
      await context.clearPermissions();
      await expectNoPanelOpen(page);

      await page.locator(".locate-button").click();

      // AND THE BUTTON REACHES A TERMINAL STATE rather than hanging on
      // "locating…", which looks exactly like a slow GPS fix.
      await expect
        .poll(
          async () => page.locator(".locate-button").getAttribute("data-state"),
          {
            timeout: 10000,
          },
        )
        .toMatch(/denied|unavailable|timeout|idle/);

      // The message reaches a surface the user can actually see...
      await expect(page.locator("#toast-root .toast")).toContainText(
        /denied|unavailable|timed out/,
        { timeout: 15000 },
      );
      // ...and no panel opened to deliver it.
      await expectNoPanelOpen(page);
    });

    await test.step("keeps every credit VISIBLE", async () => {
      // Attribution is required wherever the data is shown, so it may not be
      // folded away. It lives in the map's own line (DEC-R2-4), which is always
      // on screen.
      //
      // MIGRATED FROM `toContainText` TO VISIBILITY (round three, G5/F10), and
      // this is the most important line in the step. `toContainText` matches on
      // `textContent`, which includes CSS-hidden nodes — so once the line grew
      // an expander, the old assertions kept passing over credits nobody could
      // see. The guard for the one rule in this app with legal weight would
      // have stopped guarding SILENTLY, which is worse than not having it.
      //
      // Verified by construction: these locators resolve to the short names in
      // the resting line, and the expanded panel is asserted separately below.
      const shortNames = page.locator("#map .map-attribution-short");
      await expect(shortNames).toHaveText([
        "OpenStreetMap",
        "Mapterhorn",
        "Mapzen/AWS",
      ]);
      // BOTH DEM sources, by name. The composition falls back per tile, so a
      // session may stand on either — a credit naming only one of them stops
      // satisfying the obligation the moment the other serves a tile. And each
      // is asserted VISIBLE, not merely present.
      for (const name of ["OpenStreetMap", "Mapterhorn", "Mapzen/AWS"]) {
        await expect(shortNames.filter({ hasText: name })).toBeVisible();
      }

      // THE THIN LINE THE FEEDBACK ASKED FOR: the long credit text starts
      // hidden, and only the short names are on screen.
      const full = page.locator("#map .map-attribution-full");
      await expect(full).toBeHidden();

      // AND IT IS ACTUALLY ONE LINE, at the 390 px width this describe runs at.
      // That is the milestone's acceptance criterion and nothing tested it —
      // which is how a `max-width: 60vw` "safety" cap shipped that wrapped the
      // bar to two lines on a phone while every other assertion stayed green.
      // Two line-heights at Leaflet's 0.75 rem/1.4 is ~34 px, so 26 px
      // separates one line from two without pinning an exact height.
      const restingBox = await page
        .locator("#map .map-attribution-line")
        .boundingBox();
      expect(restingBox?.height ?? 0).toBeLessThan(26);

      // THE EXPANDER IS BIG ENOUGH TO PRESS. It shipped at roughly 65 x 17 px —
      // `font: inherit` resolves to Leaflet's 0.75 rem and the rule set
      // `padding: 0` — which is under WCAG 2.2 SC 2.5.8's 24 px floor and
      // SMALLER than the header caret the owner complained about twice. The one
      // new touch control in the milestone about a control being wrong on a
      // phone. 24 rather than 44 is deliberate: the request was for a thin line.
      const toggleBox = await page
        .locator("#map .map-attribution-toggle")
        .boundingBox();
      expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(24);
      // BOTH DIRECTIONS, since H3 replaced the label with a single "…" and the
      // box stopped getting its width from the text. A height-only floor would
      // pass at 24 x 12, which is the shape this control would now take.
      expect(toggleBox?.width ?? 0).toBeGreaterThanOrEqual(24);

      await page.locator("#map .map-attribution-toggle").click();
      await expect(full).toBeVisible();
      await expect(full).toContainText(/Copernicus/i);
      await expect(full).toContainText(/SRTM/i);
      await expect(full).toContainText("OpenStreetMap contributors");
      await page.locator("#map .map-attribution-toggle").click();
      await expect(full).toBeHidden();

      // AND LEAFLET'S COURTESY LINK IS GONE — the one credit here that is not a
      // licence term, which the session asked to drop.
      await expect(
        page.locator("#map .leaflet-control-attribution a[href*='leafletjs']"),
      ).toHaveCount(0);
    });
  });
});

test.describe("my location", () => {
  test.describe("at a desktop width", () => {
    // The phone-layout test measures the pin and the credit at 390 px. These
    // are the same claims at 1280 x 720, where the map is a side pane rather
    // than a sheet: one boot for all.
    test.use({ viewport: { width: 1280, height: 720 } });

    test("the pin sits bottom-right above the credit, the credit inside the map, and a denied locate toasts with no panel open", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        // A DENIED PERMISSION, not a missing API: the app branches on the error
        // it gets back, and removing `geolocation` entirely would take a
        // different path (unsupported) that reports through a different string.
        const denied = {
          code: 1,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: "User denied Geolocation",
        };
        Object.defineProperty(navigator, "geolocation", {
          configurable: true,
          value: {
            getCurrentPosition: (_ok, fail) => fail?.(denied),
            watchPosition: (_ok, fail) => {
              fail?.(denied);
              return 1;
            },
            clearWatch: () => {},
          },
        });
      });
      await stubNetwork(page);
      await page.goto(AT_FIXTURE);
      await waitForRefresh(page);

      await test.step("the pin and the credit", async () => {
        const [box, mapBox, attribution] = await Promise.all([
          page.locator(".locate-button").boundingBox(),
          page.locator("#map").boundingBox(),
          page.locator("#map .leaflet-control-attribution").boundingBox(),
        ]);
        if (box === null || mapBox === null) throw new Error("no boxes");
        expect(box.x).toBeGreaterThan(mapBox.x + mapBox.width / 2);
        expect(box.y).toBeGreaterThan(mapBox.y + mapBox.height / 2);
        // UNCONDITIONAL: `boundingBox()` returns null for a hidden element, so
        // a guard on it here would skip exactly when the credit went missing.
        expect(attribution).not.toBeNull();
        // Strictly above the credit, not overlapping it.
        expect(box.y + box.height).toBeLessThanOrEqual(
          (attribution?.y ?? 0) + 1,
        );
        // INSIDE THE MAP, not merely "visible": `toBeVisible()` does not detect
        // an element clipped by the `overflow: hidden` of `.leaflet-container`.
        expect(
          (attribution?.y ?? 0) + (attribution?.height ?? 0),
        ).toBeLessThanOrEqual(mapBox.y + mapBox.height + 1);
      });

      await test.step("a denied locate toasts, and opens no panel", async () => {
        // If the toast wiring is ever lost nothing else fails: errors become
        // invisible. With every panel closed, so the info panel's status line
        // cannot pass for a build with no toast at all.
        await expectNoPanelOpen(page);

        await page.locator(".locate-button").click();

        // The wording is the locate control's; the claim is that SOMETHING
        // reached a surface the user can see with every panel closed.
        const toast = page.locator("#toast-root .toast");
        await expect(toast).toHaveText(/./, { timeout: 15000 });

        // AND NO PANEL OPENED, which a build that opened one to show the error
        // would otherwise pass.
        await expectNoPanelOpen(page);
      });
    });
  });

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

    // AND IT DOES NOT EAT THE CLICK IT SITS ON. Leaflet makes a `circleMarker`
    // interactive by DEFAULT, and nothing is bound to this one — so an
    // interactive marker gives it `pointer-events: auto` and swallows a click
    // that should have reached the map handler and moved the user. It sits
    // wherever the user currently is, which is the spot they are most likely to
    // click next.
    //
    // ASSERTED ON THE CLASS rather than by clicking it: today the cell paths
    // happen to paint over the marker (it is built in the constructor, they are
    // added later by `render()`), so a click test would pass on the paint order
    // instead of on the property that guarantees it. Raised in the #267 review,
    // where that same paint order disproved the thread's own reasoning.
    await expect(marker).not.toHaveClass(/leaflet-interactive/);
  });
});

/**
 * The desktop controls, on one boot.
 *
 * ORDER MATTERS: the breakdown reads what the boot printed, the perf overlay
 * compares against the picture the boot left, and the control bar runs last
 * because it ends at a phone width.
 */
test.describe("the desktop controls", () => {
  test("print the click breakdown, mount the perf overlay, move the sun and the render distance, and give every layer a visible switch", async ({
    page,
  }) => {
    // Installed before the page loads: the lines are printed during the boot.
    const lines = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith("click ring ")) lines.push(text);
    });
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("the click breakdown survives the worker boundary", async () => {
      // This does NOT rank a real click: Overpass is blocked here, so the fetch
      // stages are a small fixture. What only a real browser can show is that
      // the instrument composes across a real dedicated worker with its own
      // time origin, and that the numbers survive a real structured clone.
      //
      // One line per ring: the widening publishes per ring, and the stages that
      // happen once are zero on the later rings by design.
      expect(lines.length).toBeGreaterThanOrEqual(1);
      for (const line of lines) {
        // The ring is checked against the real list. A digit match would take
        // any number, and a character class once rejected a new ring.
        expect(line).toMatch(/^click ring \d+: \d+ ms total/);
        expect(PROGRESSIVE_RADII).toContain(
          Number(/^click ring (\d+):/.exec(line)?.[1]),
        );
        // Every stage carries its share of the whole.
        expect(line).toMatch(/ \d+ ms \(\d+ %\)/);
        // The residual is printed always, even when small.
        expect(line).toContain("residual ");
        expect(line).toContain("tiles ");
        // Every stage has a number. A reused dev server serving a stale build
        // of the library once printed `0 ms` with `1 unmeasured`.
        expect(line, `no tile was measured in: ${line}`).not.toContain(
          "unmeasured",
        );
        // `reconciles` is deliberately not asserted: its tolerance is a guess
        // that one sample cannot re-fit, and asserting today's outcome would
        // freeze that guess as a requirement.
        const wall = /^click ring \d+: (\d+) ms total/.exec(line)?.[1];
        expect(Number(wall)).toBeGreaterThan(0);
      }

      // By name, the zeros included: `parse` is 0 on a cache hit and
      // `terrain-wait` on a widening ring, and they are what lets the line
      // falsify a prediction.
      const first = lines[0] ?? "";
      for (const stage of [
        "fetch",
        "parse",
        "merge",
        "score",
        "derive",
        "terrain-wait",
        "mesh",
        "boundary",
        "draw",
      ]) {
        expect(first, `${stage} missing from: ${first}`).toContain(`${stage} `);
      }
    });

    await test.step("the perf overlay mounts on demand and leaves the scene alone", async () => {
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
      await setting(page, "#perf-stats", (c) => c.check());

      // The panels are DOM over the canvas, so the rendered scene must not
      // move: an overlay that changed the picture would corrupt the very
      // comparison it exists to support.
      await expect(panels).toHaveCount(1);
      expect(Math.abs((await painted()) - before)).toBeLessThan(before * 0.02);

      await setting(page, "#perf-stats", (c) => c.uncheck());
      await expect(panels).toHaveCount(0);
    });

    await test.step("a hotkey moves the sun, and stepping back returns", async () => {
      // The boot readout: the afternoon sun at 20° of the pinned date, in
      // labelled apparent solar time.
      const readout = page.locator("#sun-readout");
      await expect(readout).toHaveText("15:47 solar time");
      await expect(page.locator("#sun-date")).toHaveValue("2026-09-23");
      // The exact text for the return trip: a regex cannot tell the golden hour
      // from the stop half a degree away, both read 17:3x.
      const bootReadout = await readout.textContent();

      // FOUR: from the 20° boot, two 30-min clock stops (above 12°) and two
      // fine 1.5° stops near the horizon take the sun to ~10°, a clearly
      // different picture.
      await installFrameProbe(page);
      await stashStableFrame(page);
      // Focus the body rather than a field: the registry deliberately ignores
      // keys typed into inputs, and the site picker is a `<select>`.
      await expectNoPanelOpen(page);
      await focusPageForHotkeys(page);
      for (let k = 0; k < 4; k++) await page.keyboard.press("t");
      await expect
        .poll(async () => (await diffFromStash(page, 24)).differing, REPAINT)
        .toBeGreaterThan(1000);

      // The stop list makes forward-then-back the identity (unit-tested in
      // sun-clock.test.ts); this proves the page agrees.
      for (let k = 0; k < 4; k++) await page.keyboard.press("T");
      await expect(readout).toHaveText(bootReadout ?? "");
    });

    await test.step("the date field keeps focus while edited, and Enter hands it back", async () => {
      // "change" fires per edited segment, so a field that blurred on it lost
      // focus after the first edit. It must then give focus back on Enter, or
      // "t" would be swallowed as typing.
      await setting(page, "#sun-date", async (input) => {
        await input.fill("2026-12-21");
        await expect(input).toHaveValue("2026-12-21");
        // The boot's phase (20° in the afternoon) does not exist on 21 Dec at
        // the fixture (15.6° at noon), so the sun lands on that day's noon.
        await expect(page.locator("#sun-readout")).toHaveText(
          "12:00 solar time",
        );
        await expect(input).toBeFocused();
        await input.press("Enter");
        await expect(input).not.toBeFocused();
        const before = await page.locator("#sun-readout").textContent();
        await page.keyboard.press("t");
        await expect(page.locator("#sun-readout")).not.toHaveText(before ?? "");
      });
    });

    await test.step("the time slider moves the sun, and the keys still work after it", async () => {
      // A range input takes no typed text, so "t" must still step the sun while
      // it has focus (the hotkey registry exempts non-text inputs).
      const readout = page.locator("#sun-readout");
      await setting(page, "#sun-time", async (slider) => {
        const before = await readout.textContent();
        await slider.fill("150");
        await expect(readout).not.toHaveText(before ?? "");
        const afterSlider = await readout.textContent();
        await slider.focus();
        await page.keyboard.press("t");
        await expect(readout).not.toHaveText(afterSlider ?? "");
        await expect(slider).not.toHaveValue("150");
      });
    });

    await test.step("the shortcut list is discoverable and matches the bindings", async () => {
      const help = page.locator("#hotkey-help");
      await expect(help).toBeHidden();
      await page.keyboard.press("?");
      await expect(help).toBeVisible();
      // Rendered FROM the registry, so this also catches a binding added
      // without a description.
      await expect(help).toContainText("step the sun forward");
      await expect(help).toContainText("step the sun back");
      await expect(help.locator("kbd")).not.toHaveCount(0);
      await page.keyboard.press("?");
      await expect(help).toBeHidden();
    });

    await test.step("the render-distance dial moves the camera AND the fog, boots at 2x, and is inert at 1x", async () => {
      // The readout is painted from `buildingView.farPlaneM()` and `fogNearM()`,
      // which read back from the CAMERA and the FOG rather than from the slider,
      // so the text proves the projection matrix and the fog were written.
      //
      // The fog half is the point. `THREE.Fog` is linear with `far` at the far
      // plane, so everything past it is already fully fog coloured: moving the
      // far plane alone would show an identical image.
      //
      // `BuildingView` constructs a `WebGLRenderer`, so none of this can be a
      // unit test, and this first line is the only pin of the boot path:
      // painting without applying would read 2400 while the thumb sat at 2.
      const readout = page.locator("#render-distance-value");
      await expect(readout).toHaveText("draw 4800 m · haze 3168 m");

      await setting(page, "#render-distance", async (slider) => {
        await slider.fill("10");
        await slider.dispatchEvent("input");

        // Both moved, by the same factor: 10x is 24000, and the haze keeps its
        // 0.66 ratio. A far plane that moved alone would read haze 1584 m.
        await expect(readout).toHaveText("draw 24000 m · haze 15840 m");

        // And back. This asserts the 1x baseline after an explicit
        // `fill("1")`, not the boot default, which is why it reads 2400.
        await slider.fill("1");
        await slider.dispatchEvent("input");
        await expect(readout).toHaveText("draw 2400 m · haze 1584 m");
      });
    });

    await test.step("every layer has a VISIBLE switch", async () => {
      // Only what needs a browser. The inventory lives in
      // `layer-toggles.test.ts`; visibility is CSS resolving against real
      // layout, which jsdom does not do.
      //
      // `cells` is in the command bar, always on screen. Every other switch
      // is in the settings drawer, in sections that start folded, so the claim
      // is "visible once the drawer is open and its section unfolded"; the
      // drawer is closed again afterwards so the steps below see the boot
      // layout.
      await expect(page.locator("#layer-cells")).toBeVisible();
      await page.locator("#settings-open").click();
      const sections = page.locator("#settings-drawer details");
      const sectionCount = await sections.count();
      expect(sectionCount).toBeGreaterThan(0);
      const fold = (open) =>
        sections.evaluateAll((els, o) => {
          for (const el of els) {
            if (el instanceof HTMLDetailsElement) el.open = o;
          }
        }, open);
      await fold(true);
      const switches = page.locator("#layers input[type=checkbox][data-layer]");
      const count = await switches.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(switches.nth(i)).toBeVisible();
      }

      // And the groups are on screen, with the perf switch inside the
      // diagnostics one: it is not a layer, so nothing else would put it there.
      await expect(page.locator("#layer-group-overlays")).toBeVisible();
      await expect(page.locator("#layer-group-world")).toBeVisible();
      await expect(
        page.locator("#layer-group-diagnostics #perf-stats"),
      ).toBeVisible();
      await fold(false);
      await page.locator("#settings-open").click();
      await expectNoPanelOpen(page);
    });

    await test.step("show-below sits inside the affordance group, not beside it", async () => {
      // Structural rather than by position: a CSS-only fix would look identical
      // collapsed and wrong the moment the groups are reordered.
      await expect(
        page.locator("#layer-group-overlays #show-below"),
      ).toBeAttached();
    });
  });
});

test.describe("the AR entry point", () => {
  /**
   * WHY THIS SPEC EXISTS. AR milestone 1 shipped with three false claims that
   * four green gates all passed: nothing in the demo set the framework's
   * `zero`, so the button was permanently disabled and `startArMode` had no
   * reachable caller; the origin adapter was never called; and the geoid was
   * never sent. Every unit test passed, because each module was correct in
   * isolation and nothing asserted they were CONNECTED.
   *
   * A spec that drives the real button through a real fix is the smallest
   * thing that would have failed on all three. It cannot enter a session —
   * WebXR needs a device and headless Chromium has none — so it deliberately
   * stops at the boundary: does the button become usable, and does pressing it
   * reach the AR path rather than doing nothing.
   */
  test("locates when pressed without a fix, then OFFERS to enter AR @pr", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 50.9231, longitude: 6.9445 });
    // STUBBED, NOT SKIPPED. Headless Chromium reports no immersive-ar, so the
    // button hides and the GPS gate — the thing this test exists for — never
    // runs. A `test.skip` here would have been silent coverage loss of exactly
    // the assertion the milestone most needed, which is the pattern filed in
    // `2026-08-12-1215-conditional-e2e-skips-hide-coverage-followup.md`.
    //
    // Only the SUPPORT PROBE is faked. Nothing here pretends a session can
    // start; the test stops at the button, which is the boundary a headless
    // browser can honestly reach.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "xr", {
        configurable: true,
        value: { isSessionSupported: () => Promise.resolve(true) },
      });
    });
    await stubNetwork(page);
    await page.goto("/");
    await waitForRefresh(page);

    const arButton = page.locator("#enter-ar");
    const offer = page.locator("#ar-offer");

    // BEFORE ANY FIX: visible AND ENABLED.
    //
    // THIS ASSERTED `toBeDisabled()` UNTIL ROUND THREE, with the reason in
    // `title`. The thirteenth session reported exactly that state as broken —
    // "wenn ich noch nicht auf Location geklickt habe, dann macht der AR Button
    // noch nichts" — because a `title` never shows on touch, so what a phone
    // user meets is a faint square that ignores them. The press now performs
    // the step it was waiting for (G6, DEC-W2), so there is nothing to disable.
    await expect(arButton).toBeVisible();
    await expect(arButton).toBeEnabled();
    // The hint survives as a promise rather than an excuse.
    await expect(arButton).toHaveAttribute("title", /location/i);
    await expect(offer).toBeHidden();

    // THE PRESS ACTS AS THE GPS BUTTON. The locate control — not a second
    // indicator invented for this — is what shows the work in progress.
    await arButton.click();

    // AND WHEN THE FIX LANDS, ENTRY IS OFFERED rather than the user having to
    // remember the button. That second tap carries its own transient user
    // activation, which is what makes this shape legal where "request both at
    // once" was not.
    await expect(offer).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#ar-offer-enter")).toBeVisible();

    // THE OFFER'S BUTTON IS A REAL TAP TARGET. G1 was a control that was
    // correct and too small to use, twice; this is the control the whole
    // interaction funnels into.
    // 44, NOT 24. The CSS sets `min-height: 2.75rem` and its comment claims
    // "the same floor the header caret's tap target uses"; asserting 24 let a
    // regression to just over half that pass. 24 px is the plan's GLYPH-height
    // floor for the caret, which is a different measurement — the two were
    // conflated (PR review of P3, finding 8).
    const enterBox = await page.locator("#ar-offer-enter").boundingBox();
    expect(enterBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await test.step("keeps the AR offer clear of the toast and of the map's own controls", async () => {
      /**
       * WHY THIS TEST MATTERS (PR review of P3, finding 4).
       *
       * The offer shipped at `bottom: 1.25rem`, centred, up to 92vw — overlapping
       * `.toast` in both axes and winning on z-index. That covers the app's only
       * 2D message channel, including the GPS failures this very flow produces,
       * and at its widest it reached under the bottom-right locate and AR
       * controls where, having pointer events, it would swallow taps.
       *
       * Geometry rather than eyeballing, for the same reason the header's row
       * assertions are geometry: "it looks fine on my screen" is how the first
       * version got here.
       */
      // AT 390 px, WHICH IS THE WHOLE POINT. The overlap this guards is a phone
      // phenomenon: on a 1280 px desktop the toast sits bottom-LEFT and the offer
      // is centred, so their boxes never meet and every assertion below holds
      // whatever the offset is. Mutation testing showed exactly that -- lowering
      // the offer back into the toast band passed at desktop width.
      await page.setViewportSize({ width: 390, height: 780 });
      await expect(page.locator("#ar-offer")).toBeVisible();
      // A toast, put on screen the way the app does, so the two are measured
      // together rather than one of them imagined.
      await page.evaluate(() => {
        const root = document.querySelector("#toast-root");
        if (root === null) throw new Error("no #toast-root");
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = "Location permission denied.";
        root.append(toast);
      });

      const offer = await page.locator("#ar-offer").boundingBox();
      const toast = await page.locator("#toast-root .toast").boundingBox();
      const locate = await page.locator(".locate-button").boundingBox();
      if (offer === null || toast === null || locate === null) {
        throw new Error("no boxes");
      }

      const overlaps = (a, b) =>
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height;

      // THE MESSAGE CHANNEL IS NOT COVERED. This is the harm that geometry can
      // actually express: a toast hidden under the offer is a GPS error the user
      // never sees, and this flow produces those.
      expect(overlaps(offer, toast)).toBe(false);

      // THE MAP'S CONTROLS STAY USABLE — asserted by CLICKING one, not by
      // measuring boxes. On a desktop split the offer's box does land over the
      // map's bottom-right controls (`locate` is inside it at 1280 px), and
      // raising the offset until it does not is tuning against one viewport that
      // the mobile sheet then invalidates. What matters is that the offer cannot
      // SWALLOW the tap, which `pointer-events: none` on the container settles
      // for every viewport at once. Playwright's actionability check fails this
      // click if anything intercepts it.
      // STILL SHOWING AT THE MOMENT OF THE CLICK. Without this the click can be
      // measured against a box the offer no longer occupies, and the assertion
      // proves nothing -- which is what a mutation run showed the first version
      // doing.
      await expect(page.locator("#ar-offer")).toBeVisible();
      // A TRIAL CLICK: Playwright runs the full actionability check — visible,
      // stable, receives events — and throws if anything intercepts the point,
      // without actually clicking.
      //
      // WHAT THIS DOES AND DOES NOT GUARD, measured rather than assumed:
      //
      // - It holds the property that matters — the offer must never swallow a tap
      //   meant for the map — and it is the honest way to state it, because the
      //   obvious version (click, then assert the button changed state) was
      //   VACUOUS: the AR press above had already put the locate button in
      //   `located`, so that assertion held whether or not the click landed.
      // - It does NOT guard `.ar-offer`'s `pointer-events: none`. Mutation testing
      //   showed this step passing with that rule flipped to `auto`, so on this
      //   layout the control wins the hit test for some other reason — the
      //   z-order between a fixed overlay and Leaflet's control stack. The rule
      //   stays: it follows the pattern `.ar-hud` and `.ar-toast` already set and
      //   costs nothing. Saying it is tested here would simply be untrue.
      await page.locator(".locate-button").click({ trial: true });
    });

    // DISMISSIBLE, and it stays dismissed. An offer that reappears on the next
    // fix would fire ~1 Hz under a watch.
    await page.locator("#ar-offer-dismiss").click();
    await expect(offer).toBeHidden();
    await expect(arButton).toBeEnabled();
  });

  test("forgets the AR intent when the locate it started FAILS", async ({
    page,
    context,
  }) => {
    /**
     * WHY THIS TEST MATTERS — it is a regression test for a bug this milestone
     * shipped and its own review found.
     *
     * The AR press arms an intent and waits for the fix it asked for. The
     * locate control's failure handler resets three stale-fix variables and did
     * not reset that intent, so it stayed armed indefinitely. The consequence
     * was not subtle: press AR indoors, the lookup fails, and then a PLAIN GPS
     * PRESS minutes later pops up "Enter AR now" for a press the user never
     * made — verbatim the failure the plan called worse than the one being
     * fixed, and which the code's own docstring asserted could not happen.
     *
     * The gate could not have caught it: nothing exercised the failure path.
     */
    // NO GEOLOCATION PERMISSION, so the first lookup fails immediately rather
    // than after the 15 s timeout.
    await context.clearPermissions();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "xr", {
        configurable: true,
        value: { isSessionSupported: () => Promise.resolve(true) },
      });
    });
    await stubNetwork(page);
    await page.goto("/");
    await waitForRefresh(page);

    await page.locator("#enter-ar").click();
    // The failure surfaces on the channel a user can see.
    await expect(page.locator("#toast-root .toast")).toContainText(
      /denied|unavailable|timed out/,
      { timeout: 15000 },
    );
    await expect(page.locator("#ar-offer")).toBeHidden();

    // NOW THE USER PRESSES THE GPS PIN, having given up on AR. This is the
    // press the offer must not attach itself to.
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 50.9231, longitude: 6.9445 });
    await page.locator(".locate-button").click();

    // The fix really arrives — the hint disappears once entry is direct.
    await expect(page.locator("#enter-ar")).toHaveAttribute(
      "title",
      "Enter AR",
      { timeout: 10000 },
    );
    // ...and no offer, because the press that wanted one failed long ago.
    await expect(page.locator("#ar-offer")).toBeHidden();

    // THE MAP STAYS WHEN AR IS AVAILABLE, after exactly a plain GPS press. The rule the reference consumer's
    // pattern would break, asserted in the real DOM rather than only over the
    // pure state function, because the failure mode is a call site toggling
    // the map, not the derivation. The xr stub above is what makes it mean
    // anything: without it AR is never "available" and both views hold in
    // every state, including with the whole AR path deleted.
    await expect(page.locator("#enter-ar")).toBeEnabled({ timeout: 10000 });
    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator("#scene")).toBeVisible();
  });

  test("the offer's button is wired to AR entry, and the prompt clears the offer @pr", async ({
    page,
    context,
  }) => {
    /**
     * WHY THIS TEST MATTERS (PR review of P3, finding 6).
     *
     * The plan's P3 verification lists "prompt tapped → AR starts". Nothing
     * asserted it: the other test taps DISMISS, so a listener attached to the
     * wrong id would have shipped green — an offer whose main button does
     * nothing, which is the exact complaint this milestone exists to fix, moved
     * one control along.
     *
     * WHAT IT CAN AND CANNOT PROVE. Headless Chromium cannot start an immersive
     * session, so this stops where the existing AR tests stop: at the boundary.
     * What it pins is that the press REACHES the AR path — the offer clears and
     * the entry attempt reports its failure on the 2D channel — which is
     * exactly what a mis-wired listener would not do.
     */
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 50.9231, longitude: 6.9445 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "xr", {
        configurable: true,
        value: {
          isSessionSupported: () => Promise.resolve(true),
          // Supported, but every request fails — the honest shape for a
          // headless browser, and it puts the entry attempt on the error path
          // where this test can see it.
          requestSession: () => Promise.reject(new Error("no XR device")),
        },
      });
    });
    await stubNetwork(page);
    await page.goto("/");
    await waitForRefresh(page);

    await page.locator("#enter-ar").click();
    await expect(page.locator("#ar-offer")).toBeVisible({ timeout: 10000 });

    await page.locator("#ar-offer-enter").click();

    // The offer goes away on the press, before anything is awaited.
    await expect(page.locator("#ar-offer")).toBeHidden();
    // And the AR path really was entered — it reported why it could not start.
    await expect(page.locator("#toast-root .toast")).toBeVisible({
      timeout: 15000,
    });

    // AND `#ar-root` IS EMPTY AGAIN. Nothing may be left in it after a failed
    // entry: it is `position: fixed; inset: 0` and hidden only while `:empty`,
    // so any leftover child becomes a click-eating layer over the whole page.
    // The framework inserts its canvas before requesting the session and does
    // not clean it up if that rejects, which is what `endARSession()` is for.
    //
    // The assertion above would NOT catch that: Playwright's `toBeVisible`
    // checks box and CSS, not occlusion, so the toast reads as visible from
    // underneath a covering layer.
    //
    // ⚠️ IT NOW GUARDS THE DEC-K5 DOM VEIL TOO, WHICH IT DID NOT BEFORE
    // DEC-M1b, and the change is worth recording because the earlier note said
    // the opposite in detail. That veil used to be created only when
    // `descentStartM > 0`, and this fixture boots a view whose desktop camera
    // gives 0 — so deleting the veil's removal from the refusal path left this
    // test green, verified by mutation at the time. The veil is now created for
    // EVERY entry, including a refused one, so `#ar-root` really would be
    // non-empty if that removal were dropped.
    //
    // The veil's leak-on-refusal behaviour is pinned in `ar-mode.test.ts`
    // instead, where the camera height is controllable — and headless Chromium
    // cannot start an immersive session anyway, so the rest of the ordering is
    // unreachable here by construction.
    await expect(page.locator("#ar-root")).toBeEmpty();
  });

  test("keeps the AR overlay's controls OUT of the 3D content on a desktop, its bottom stack readable on a 390 px phone, and its experiment panel hidden when marked hidden", async ({
    page,
  }) => {
    /**
     * WHY THIS TEST MATTERS (G9, DEC-W5).
     *
     * "Currently it's in the middle of the screen and occludes basically the AR
     * 3D content." The compass slider was `bottom: 20vh`, centred and up to
     * 88vw wide — a bar straight across the near content.
     *
     * WHAT IT ACTUALLY TESTS, STATED PLAINLY: the STYLESHEET, not the wiring.
     * The compass control only exists inside an immersive session, and headless
     * Chromium reports no `immersive-ar` — stubbing the support probe gets the
     * button enabled but cannot make a session start, which the existing AR
     * tests say outright. jsdom is no help either: it applies no stylesheet and
     * does no layout, so the one thing that changed here is invisible to it. So
     * this attaches elements carrying the production class names to the real
     * `#ar-root` and measures what the real CSS does to them.
     *
     * THE GAP THAT REMAINS, named rather than papered over — and it is HALF the
     * size it was (DEC-J12). The compass is no longer a replica: the fixture
     * mounts the real `createArCompassControl`, so its class names, its child
     * order and its actual strings are the ones measured here. What is still
     * replica is the surrounding stack, so nothing proves `ar-mode.ts` still
     * builds an `.ar-stack` and attaches both controls into it.
     *
     * The replica was not a hypothetical risk: its hint read
     * "takes 15-30 fixes to express a change" against the production string of
     * the day, "takes ~15–30 fixes to express" — eight characters longer, with
     * an ASCII hyphen for the en dash. A layout test whose strings are wrong is
     * answering a different question than the one it claims. Production has
     * since moved on again (J5 shortened the hint to "~15–30 fixes to show"),
     * so neither quoted string is current — read them as the history that
     * motivated mounting the real module.
     */
    // ONE BOOT, THREE CHECKS, in this order: the desktop first, then the
    // same overlay resized to a phone (a resize, not a cold load at that
    // size), then the panel's hidden state, which adds to `#ar-root` and so
    // comes last.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await buildArOverlayFixture(page);

    await test.step("on the desktop, the controls stay out of the 3D content", async () => {
      const viewport = page.viewportSize();
      const hudBox = await page
        .locator("#ar-root .ar-stack .ar-hud")
        .boundingBox();
      const bottomBox = await page.locator("#ar-root .ar-bottom").boundingBox();
      const rowBox = await page
        .locator("#ar-root .ar-bottom .ar-bottom-row")
        .boundingBox();
      const compassBox = await page
        .locator("#ar-root .ar-bottom .ar-compass")
        .boundingBox();
      if (
        hudBox === null ||
        bottomBox === null ||
        rowBox === null ||
        compassBox === null ||
        viewport === null
      ) {
        throw new Error("no boxes");
      }

      // NEAR THE TOP IN ABSOLUTE TERMS, not merely "above the midpoint". The
      // relative pair alone would pass on a layout that put the readout at 40%
      // and the slider at 45% — and the blocker this test missed pushed both a
      // whole viewport DOWN, which a midpoint check catches only by luck.
      expect(hudBox.y).toBeLessThan(120);

      // THE SLIDER MOVED TO THE BOTTOM (H6), INVERTING WHAT THIS TEST USED TO
      // ASSERT — and the inversion is deliberate, not drift.
      //
      // It read `compassBox.y + compassBox.height < viewport.height / 2`, pinning
      // DEC-W5's top-of-screen column. The fourteenth session asked for the
      // slider "nach unten ... neben die Plus-Minus-UI". G9's original complaint,
      // which DEC-W5 answered, was that the slider sat in the MIDDLE of the view
      // and occluded the AR content — and the bottom satisfies that just as well
      // as the top did, so the earlier decision is superseded rather than broken.
      expect(compassBox.y).toBeGreaterThan(viewport.height / 2);

      // AND THE READOUT IS BELOW THE ROW, not beside it. This is the assertion
      // that would have caught the two earlier versions of this row: the row is
      // ~189 px of controls and the readout is ~40 characters, so a single-row
      // layout overflows a phone. Stated as "the readout starts below the row's
      // bottom edge" rather than as a pixel count, so it survives a font change.
      expect(compassBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1);

      // NOTHING OVERFLOWS THE VIEWPORT HORIZONTALLY, which is the failure the
      // arithmetic in `.ar-bottom`'s comment predicts if anyone puts the readout
      // back on the row or restores the 55vw slider.
      expect(bottomBox.x).toBeGreaterThanOrEqual(0);
      expect(bottomBox.x + bottomBox.width).toBeLessThanOrEqual(
        viewport.width + 1,
      );

      // AND IT STAYS CLEAR OF THE TOAST BAND. `.ar-toast` sits at 12vh, and the
      // far-travel toast fires at 2 km — during exactly the long walk this slider
      // is used on. A second row makes the stack taller, so this is the
      // constraint the extra row actually threatens (PR #311 review, finding 4).
      expect(bottomBox.y).toBeGreaterThan(viewport.height * 0.12);
    });

    await test.step("on a 390 px phone, the bottom stack stays readable", async () => {
      /**
       * WHY THIS TEST MATTERS (r541 field report, Q8; owner disagreement on Q4).
       *
       * "Der Kompass-Balken nutzt etwa die halbe Breite und bricht auf vier
       * Zeilen um, wo zwei reichen würden." The owner confirmed Q4 is NOT done.
       *
       * THE TEST ABOVE CANNOT SEE THIS, and that is the point of this one. It
       * asserts nothing OVERFLOWS the viewport — which a box that is too NARROW
       * passes trivially — and it runs at the suite's 1280 px Desktop Chrome
       * while doing its arithmetic against "a 390 px phone" in the comments. Both
       * halves of that gap are what let a folded stack ship.
       *
       * WHAT IS ASSERTED, and why these two together are not vacuous in either
       * direction:
       *
       * - the readout and the hint each render on ONE line box, which forces the
       *   compass box WIDE enough for the real 40-character string;
       * - nothing overflows the viewport, which caps it.
       *
       * Line boxes are counted with `Range.getClientRects()` — one rect per line
       * — rather than by dividing height by an assumed line-height, so the count
       * stays true if the font or the leading changes.
       */
      await page.setViewportSize({ width: 390, height: 844 });

      // FLUSH AT THE BOTTOM, AND CONFINED TO THE BOTTOM QUARTER (r541, Q8).
      //
      // Reported as "floats mid-screen instead of sitting flush at the bottom
      // edge". MEASURED, before and after the wrap fix, at this viewport:
      //
      //   before: height 189.4 px, top 620.8, bottom 810.25, gap below 33.75
      //   after:  height 133.0 px, top 677.2, bottom 810.25, gap below 33.75
      //
      // THE BOTTOM EDGE NEVER MOVED. `bottom: 4vh` was always working, so the
      // bar was never mis-positioned in Chromium -- it was 56 px TALLER, because
      // the readout wrapped to three lines plus a wrapped hint, and a box anchored
      // at the bottom grows UPWARD. That is why it read as floating.
      //
      // The 0.75 threshold is calibrated against those two numbers rather than
      // chosen: the pre-fix layout fails it by 12 px and the current one clears it
      // by 44. A looser bound (0.66) passes both and would guard nothing.
      const placement = await page.evaluate(() => {
        const el = document.querySelector("#ar-root .ar-bottom");
        if (el === null) throw new Error("no .ar-bottom");
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          gapBelow: window.innerHeight - r.bottom,
          viewportH: window.innerHeight,
        };
      });
      expect(
        placement.gapBelow,
        `the control stack sits ${Math.round(placement.gapBelow)} px off the bottom edge`,
      ).toBeLessThanOrEqual(placement.viewportH * 0.06);
      expect(
        placement.top,
        `the control stack reaches up to ${Math.round(placement.top)} px, into the AR content`,
      ).toBeGreaterThan(placement.viewportH * 0.75);

      const measured = await page.evaluate(() => {
        const lineCount = (selector) => {
          const el = document.querySelector(selector);
          if (el === null) throw new Error(`no ${selector}`);
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getClientRects().length;
        };
        const width = (selector) => {
          const el = document.querySelector(selector);
          if (el === null) throw new Error(`no ${selector}`);
          return el.getBoundingClientRect().width;
        };
        const box = (selector) => {
          const el = document.querySelector(selector);
          if (el === null) throw new Error(`no ${selector}`);
          const r = el.getBoundingClientRect();
          return { x: r.x, width: r.width, centre: r.y + r.height / 2 };
        };
        return {
          readoutLines: lineCount("#ar-root .ar-bottom .ar-compass-value"),
          hintLines: lineCount("#ar-root .ar-bottom .ar-compass-hint"),
          compassWidth: width("#ar-root .ar-bottom .ar-compass"),
          rowWidth: width("#ar-root .ar-bottom .ar-bottom-row"),
          bottomWidth: width("#ar-root .ar-bottom"),
          slider: box("#ar-root .ar-bottom .ar-compass-slider"),
          hint: box("#ar-root .ar-bottom .ar-compass-hint"),
          readout: box("#ar-root .ar-bottom .ar-compass-value"),
        };
      });

      // TWO ROWS, NOT THREE (J5, DEC-J8). "Den könnte man einfach rechts neben
      // den Slider packen, sodass das dann nur noch zwei Zeilen sind."
      //
      // COMPARED BY VERTICAL CENTRE, not by `y`. `.ar-compass` is
      // `align-items: center` and a 0.72rem hint is shorter than a range input,
      // so their TOPS never line up — an assertion on `y` would fail against a
      // correct implementation. Cold review of the plan caught exactly that.
      // DEC-L2-13 (2026-09-03): the READOUT shares the slider's row and the hint
      // has its own line below - the catalog's arrangement; DEC-J8's was the
      // reverse, and the comments above describe that earlier state.
      expect(
        Math.abs(measured.readout.centre - measured.slider.centre),
        "the compass readout is not on the slider's row",
      ).toBeLessThanOrEqual(2);
      // AND TO THE RIGHT of it, so "beside" means beside rather than behind.
      expect(measured.readout.x).toBeGreaterThanOrEqual(
        measured.slider.x + measured.slider.width - 1,
      );
      // WHILE THE HINT KEEPS A LINE OF ITS OWN (DEC-L2-13): it explains the
      // control, so it reads below the slider+readout row rather than beside it.
      expect(measured.hint.centre).toBeGreaterThan(measured.slider.centre);

      // THE SLIDER DID NOT PAY FOR IT. `width: 9rem` is `flex: 0 1 auto`, so the
      // readout now sharing its row could have been fitted by shrinking the
      // slider instead of using the free space — and every other assertion here
      // passes with a 100 px slider. 9rem is 144 px, and it exists so 0-1 is
      // draggable with a thumb outdoors.
      expect(
        measured.slider.width,
        `the compass slider shrank to ${Math.round(measured.slider.width)} px`,
      ).toBeGreaterThanOrEqual(144);

      // ONE LINE EACH. `compass 0.80 target — now 1.00 cold start` is ~40
      // characters at 0.9rem monospace, i.e. ~345 px of ink; it fits a 390 px
      // phone with room to spare, and only fails to fit when the box around it
      // has been shrunk to its slider.
      expect(
        measured.readoutLines,
        `the compass readout wraps to ${measured.readoutLines} lines in a ${Math.round(measured.compassWidth)} px box`,
      ).toBe(1);
      expect(
        measured.hintLines,
        `the compass hint wraps to ${measured.hintLines} lines`,
      ).toBe(1);

      // AND THE BOX FILLS THE COLUMN, stated as an equality rather than as
      // "wider than the row". Two separate properties ride on this:
      //
      // - the "nutzt etwa die halbe Breite" half of the report: `.ar-bottom` is
      //   a centred flex COLUMN, so a shrink-to-fit child sizes to its widest
      //   unwrappable item -- the 9rem slider -- and the readout then wrapped
      //   inside ~195 px however much room the phone actually had;
      // - the box must not RESIZE as the readout text changes. The fusion phase
      //   makes that string change length at runtime, so a shrink-to-fit box
      //   grows and shrinks under a stationary slider. A ">= rowWidth" bound
      //   passed with `align-self: stretch` deleted, which a mutation run
      //   showed; this equality is what actually pins that rule.
      expect(
        measured.compassWidth,
        "the compass box does not fill the bottom column",
      ).toBeCloseTo(measured.bottomWidth, 0);

      // STILL CAPPED. Without this the two assertions above are satisfied by any
      // box wide enough to overflow the screen, which is the failure the previous
      // two versions of this row actually shipped.
      expect(measured.bottomWidth).toBeLessThanOrEqual(390);

      // AND IT DOES NOT RESIZE WHEN THE READOUT GETS SHORTER, which is the
      // property `align-self: stretch` actually carries -- and the reason this
      // step exists at all.
      //
      // A MUTATION RUN CAUGHT THE FIRST VERSION OF THIS BEING VACUOUS. With the
      // long 40-character string the box exceeds the column`s width anyway and
      // clamps to it, so deleting the rule changed nothing measurable and the
      // equality above passed either way. The readout is only that long during
      // cold start; once the fusion settles it is short, shrink-to-fit collapses
      // the box to its 9rem slider, and the bar visibly narrows under a
      // stationary control. Re-measuring with the SHORT string is what makes the
      // rule load-bearing instead of decorative.
      const shortened = await page.evaluate(() => {
        const readout = document.querySelector(
          "#ar-root .ar-bottom .ar-compass-value",
        );
        const hint = document.querySelector(
          "#ar-root .ar-bottom .ar-compass-hint",
        );
        if (readout === null || hint === null) throw new Error("no readout");
        readout.textContent = "compass 0.80";
        hint.textContent = "";
        const box = document.querySelector("#ar-root .ar-bottom .ar-compass");
        const column = document.querySelector("#ar-root .ar-bottom");
        if (box === null || column === null) throw new Error("no box");
        return {
          compassWidth: box.getBoundingClientRect().width,
          bottomWidth: column.getBoundingClientRect().width,
        };
      });
      expect(
        shortened.compassWidth,
        "the compass box shrinks to its slider once the readout text is short",
      ).toBeCloseTo(shortened.bottomWidth, 0);
    });

    await test.step("the experiment panel is hidden while marked hidden", async () => {
      /**
       * WHY THIS TEST MATTERS (r541 and r543 field reports, DEC-Y16).
       *
       * "Der Settings Button funktioniert immer noch nicht" and "das wird halt
       * gar nicht ein/ausgeblendet, das ist immer sichtbar" — reported twice,
       * two branches apart.
       *
       * THE CAUSE IS A CSS CASCADE RULE, not an event problem, and that matters
       * because two rounds of diagnosis went looking in the wrong place.
       * `ar-experiment-panel.ts` opens and closes by writing `body.hidden`, which
       * takes effect through the USER-AGENT stylesheet's `[hidden] { display:
       * none }`. `.ar-experiments` sets `display: flex` in the AUTHOR stylesheet,
       * and author rules beat user-agent rules whatever their specificity. So
       * `hidden` did nothing at all: the panel was permanently visible, and the
       * gear toggled a flag with no visual effect — which is exactly what a dead
       * button looks like.
       *
       * ONE CAUSE, BOTH SYMPTOMS. The plan's DEC-Y16 argued they had to be two
       * independent failures, reasoning that a panel which mounts CLOSED cannot
       * be reported as permanently VISIBLE by a broken toggle. The premise was
       * right and the conclusion was wrong, because the panel never actually
       * mounted closed on screen — only in the DOM.
       *
       * jsdom cannot see this (no stylesheet, no cascade) and the unit test that
       * asserts `body.hidden` passes against the defect, which is why this one is
       * an e2e measuring `display` rather than the attribute.
       */

      const display = await page.evaluate(() => {
        const root = document.querySelector("#ar-root");
        if (root === null) throw new Error("no #ar-root");
        const wrap = document.createElement("div");
        wrap.className = "ar-gear-wrap";
        const body = document.createElement("div");
        // the builder adds the design system's classes beside the hook (M6b)
        body.className = "ar-experiments exp-panel plate";
        // EXACTLY WHAT THE PRODUCTION CODE WRITES at mount and on close.
        body.hidden = true;
        const row = document.createElement("label");
        row.className = "ar-experiments-row exp-row";
        row.textContent = "rotation prior";
        body.append(row);
        wrap.append(body);
        root.append(wrap);
        return {
          hidden: getComputedStyle(body).display,
          // AND THE OPEN STATE STILL LAYS OUT, so the fix cannot be "display:
          // none always", which would hide the panel for good and make the gear
          // genuinely dead rather than merely looking it.
          shown: (() => {
            body.hidden = false;
            return getComputedStyle(body).display;
          })(),
        };
      });

      expect(
        display.hidden,
        "the experiment panel still renders while marked hidden",
      ).toBe("none");
      expect(display.shown).toBe("flex");
    });
  });
});
