// @ts-check
/**
 * The app shell: booting, the worker, the header, the control bar and the
 * location controls. Everything here is about the page being alive and its
 * chrome behaving — not about what is drawn in either view.
 *
 * Split out of the single 4 486-line `osm-demo.spec.js` so the suite's shape
 * and its growth are visible; `fixtures.js` carries the shared setup and the
 * reasoning for why the whole suite is offline.
 */

import { test, expect } from "./e2e-test.js";

import {
  AT_FIXTURE,
  enableCellLayer,
  recordStatusFromBoot,
  stubNetwork,
  waitForRefresh,
  REPAINT,
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
    hud.className = "ar-hud";
    hud.textContent = "lat 50.9413\nlng 6.9580";
    // The collapse toggle is part of the readout's real box (DEC-H2).
    const toggle = document.createElement("button");
    toggle.className = "ar-hud-toggle";
    toggle.textContent = "more";
    hud.append(toggle);
    stack.append(hud);
    root.append(stack);

    // THE BOTTOM STACK (H6): elevation + slider + gear on one row, the
    // compass readout on its own line beneath. Built with the production
    // class names and the production content lengths, because the whole
    // question this test answers is whether the real CSS fits them.
    const bottom = document.createElement("div");
    bottom.className = "ar-bottom";
    const bottomRow = document.createElement("div");
    bottomRow.className = "ar-bottom-row";

    const elevation = document.createElement("div");
    elevation.className = "ar-elevation";
    const down = document.createElement("button");
    down.className = "ar-elevation-button";
    down.textContent = "−";
    const value = document.createElement("span");
    value.className = "ar-elevation-value";
    value.textContent = "+0.0 m";
    const up = document.createElement("button");
    up.className = "ar-elevation-button";
    up.textContent = "+";
    elevation.append(down, value, up);

    const compass = document.createElement("div");
    compass.className = "ar-compass";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "ar-compass-slider";
    // THE FULL-LENGTH READOUT, not a short one. `compass 0.80 target — now
    // 1.00 cold start` is what DEC-Y12 renders, and a shorter placeholder
    // would let a row that cannot hold the real string pass.
    const readout = document.createElement("span");
    readout.className = "ar-compass-value";
    readout.textContent = "compass 0.80 target — now 1.00 cold start";
    const hint = document.createElement("span");
    hint.className = "ar-compass-hint";
    hint.textContent = "takes 15-30 fixes to express a change";
    compass.append(slider, readout, hint);

    const gearWrap = document.createElement("div");
    gearWrap.className = "ar-gear-wrap";
    const gear = document.createElement("button");
    gear.className = "ar-gear";
    gear.textContent = "⚙";
    gearWrap.append(gear);

    bottomRow.append(elevation, gearWrap);
    bottom.append(bottomRow, compass);
    root.append(bottom);
  });
}

test.describe("the demo boots", () => {
  test("loads the rule table, draws a basemap, reports its scale, and says when it is still widening", async ({
    page,
  }) => {
    // FOUR BEHAVIOURS, ONE BOOT. All four assert on the SAME boot and none of
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
      // WHAT THE DATA REACHES, beside the fixed ramp (DEC-H7). Asserted here
      // because nothing else could: `legend-view.ts` has no unit test, so until
      // this line deleting the readout entirely stayed green — while
      // `heat-colours.ts.md` justifies saturating 10–14 % of `walkable` on the
      // grounds that "the legend compensates, and has to" (r513 review).
      //
      // On the TEXT, not on an `aria-label`: a span with no role is
      // `role="generic"`, where ARIA prohibits an accessible name, so the
      // attribute is not a reliable channel. Both numbers are visible.
      await expect(legend.locator(".legend-observed")).toContainText(
        "max here",
      );
      await expect(legend.locator(".legend-observed")).toContainText("above");
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

  test("clears the old city the moment a new one is DECLARED (DEC-R12-6)", async ({
    page,
  }) => {
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
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // The cell grid starts OFF (DEC-R7b-6), and it is the observable here: it is
    // drawn straight from the snapshot, so "the old city is still on screen" and
    // "the store still holds it" are the same statement.
    await enableCellLayer(page);

    const cells = page.locator("#map path.affordance-cell");
    await expect(cells).not.toHaveCount(0);

    counts.holdOverpass();
    await page.selectOption("#site", "porto-ribeira");

    // THE ASSERTION. Not "eventually the new city appears" — that was already
    // true and is what made the defect invisible to the suite. The old city's
    // cells are gone WHILE the new data is still in flight.
    await expect(cells).toHaveCount(0, { timeout: 15000 });

    // And the loading channel still explains the empty scene, so the two agree
    // for the first time rather than contradicting each other.
    await expect(page.locator("#status")).toContainText(/Fetching/i);

    counts.releaseOverpass();
    await waitForRefresh(page);
    await expect(cells).not.toHaveCount(0);
  });

  test("writes the place into the URL, so a reload comes back to it (DEC-R12-5)", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS. The read side has parsed `?lat=&lng=` and `?site=`
    // since round 4 and nothing ever wrote them, so the session's jump to London
    // survived exactly until a reload. The ask was for a link that can be pasted
    // into a report and navigated to by this suite — so the round trip through a
    // real reload is the assertion, not the string alone.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.selectOption("#site", "porto-ribeira");
    // A NAMED place writes its id: it says WHERE in a link a human reads, and it
    // survives a re-capture moving the coordinates.
    await expect
      .poll(() => new URL(page.url()).search)
      .toBe("?site=porto-ribeira");

    // The round trip. A reload with no other state must land back at Porto
    // rather than at the demo's default.
    await page.reload();
    await waitForRefresh(page);
    await expect(page.locator("#site")).toHaveValue("");
    await expect
      .poll(() => new URL(page.url()).search)
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
      .poll(() => new URL(page.url()).search)
      .toMatch(/^\?lat=-?\d+\.\d{5}&lng=-?\d+\.\d{5}/);
    expect(new URL(page.url()).searchParams.get("site")).toBeNull();
  });

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
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const canvas = page.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");

    // A DRAG, not a click: panning is what the session was doing when it wanted
    // the URL to remember. MapControls pans with the primary button.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35, {
      steps: 12,
    });
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
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width * 0.5 + 2,
      box.y + box.height * 0.5,
      {
        steps: 2,
      },
    );
    await page.mouse.up();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("clat"))
      .not.toBeNull();
    const back = new URL(page.url()).searchParams;
    // A nudge of two pixels, so the target must land within a few metres of
    // where it was. Five decimals is ~1.1 m, so 0.001° is a generous ~110 m
    // bound that still fails outright if the restore did nothing.
    expect(Math.abs(Number(back.get("clat")) - clat)).toBeLessThan(0.001);
    expect(Math.abs(Number(back.get("clng")) - clng)).toBeLessThan(0.001);
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
      // WHAT COLLAPSING MEANS CHANGED WITH Q11, and this assertion said the old
      // thing. It was "the height went to the 3D view rather than nowhere",
      // asserting the scene grew — true while the header was a `body` grid ROW,
      // because hiding it handed real height back.
      //
      // At this viewport the header now FLOATS over the views, so the scene is
      // already the full 780 px before the tap and collapsing uncovers pixels
      // rather than returning height. The old assertion could only fail, and it
      // failed with `Received: 780` against a 780 px viewport — i.e. it broke
      // BECAUSE the milestone succeeded.
      //
      // Updated rather than deleted: the property still worth pinning is that
      // collapsing never COSTS the 3D view height, which is what would happen if
      // the header were ever put back in flow while the rest of this layout
      // assumed otherwise.
      expect(sceneAfter.height).toBeGreaterThanOrEqual(sceneBefore.height);
      const viewport = page.viewportSize();
      if (viewport === null) throw new Error("no viewport");
      expect(
        sceneAfter.height,
        "the scene should span the viewport once the header floats (Q11)",
      ).toBeGreaterThanOrEqual(viewport.height - 1);

      // THE CONTROLS THAT STEER THE DEMO STAY REACHABLE (DEC-R2-4, narrowed by
      // DEC-R6b-5). Collapsing the category picker away would put a primary
      // input two taps from reach. The GROUND picker is no longer on this list
      // — see the dedicated collapse step below for why.
      await expect(page.locator("#category")).toBeVisible();

      // AND THE LEGEND NOW GOES WITH IT (round three, G3, DEC-W4). This line
      // asserted the opposite until the thirteenth session, on DEC-1's rule
      // that SOMETHING on screen must name the active category — the legend was
      // added for exactly that. What changed is not the rule but who satisfies
      // it: the category `<select>` asserted one line above moved into the
      // collapsed bar under its own caption, so it names the category AND can
      // change it. The legend's last collapsed survivor was the word beside it,
      // which is why the owner read it as a random "Battle Area".
      //
      // `#legend` goes hidden rather than empty-but-present because that word
      // was its only visible child once DEC-U7 hid the ramp and the numbers.
      // The expanded legend is untouched — see the dedicated step for it.
      await expect(page.locator("#legend")).toBeHidden();

      await page.locator("#header-toggle").click();
      await expect(header).toHaveAttribute("data-collapsed", "false");
    });

    await test.step("STAYS collapsed when an error occurs, and toasts it instead", async () => {
      // INVERTED 2026-08-19 (DEC-U10). This step used to assert the opposite —
      // that an error EXPANDS the header — which was DEC-R2-15, and which
      // existed only because the status line inside the header was the sole
      // channel a failure could reach. A message written into a collapsed
      // header is a message nobody sees.
      //
      // The owner reported that self-expanding behaviour as a bug in the
      // twelfth testing session; it was the demo telling the truth about
      // failures they were independently investigating. Errors now go to a
      // toast that is visible whether or not the header is collapsed, and
      // `writeStatus` no longer renders the error phase at all — both halves
      // together, because retiring only the expand would leave the message in a
      // collapsed header AND in a toast, which is the two-channel state
      // DEC-R2-15 rejected a toast in order to avoid.
      //
      // Still driven through a REAL failure rather than a hand-dispatched one:
      // the wiring from reporter to surface is the part that can be missing.
      await context.clearPermissions();
      await expandHeader();

      await page.locator("#header-toggle").click();
      await expect(page.locator("#header-bar")).toHaveAttribute(
        "data-collapsed",
        "true",
      );

      await page.locator(".locate-button").click();

      // The message reaches a surface the user can actually see...
      await expect(page.locator("#toast-root .toast")).toContainText(
        /denied|unavailable|timed out/,
        { timeout: 15000 },
      );
      // ...and the panel did not take over the screen to deliver it.
      await expect(page.locator("#header-bar")).toHaveAttribute(
        "data-collapsed",
        "true",
      );
    });

    await test.step("keeps every credit VISIBLE, collapsed bar or not", async () => {
      // Attribution is required wherever the data is shown, so it may not be
      // collapsed away. It lives outside the header (DEC-R2-4) in a line that
      // is always on screen.
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
      await expandHeader();
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

      await page.locator("#header-toggle").click();
      await expect(page.locator("#header-bar")).toHaveAttribute(
        "data-collapsed",
        "true",
      );
      // Still VISIBLE with the bar collapsed — the whole point.
      for (const name of ["OpenStreetMap", "Mapterhorn", "Mapzen/AWS"]) {
        await expect(shortNames.filter({ hasText: name })).toBeVisible();
      }
    });
  });

  test("shows a caret big enough to see, on the row the feedback asked for", async ({
    page,
  }) => {
    /**
     * WHY THIS TEST MATTERS, and why both halves are GEOMETRY.
     *
     * G1 is a repeat. The twelfth session's review raised the caret as a WCAG
     * 2.2 SC 2.5.8 target-size problem and the fix gave `#header-toggle` a
     * 2.75 rem box — measurable, correct, and invisible to the complaint. The
     * owner reported the same thing again the next day: a 0.8 em glyph floating
     * in a 44 px transparent square is reachable and still looks like a speck.
     * A test written against the tap target would have passed then too, so the
     * only assertion worth having is one on what is actually painted.
     *
     * The row half is the same trap one control over. The header is a single
     * `flex-wrap: wrap` row, so which items share a line is decided by width —
     * a unit test on DOM order passes identically on a one-row desktop layout
     * and a three-row phone layout, and G2 is a complaint about the phone.
     *
     * Reverting `.header-caret` to `font-size: 0.8em` fails the first
     * assertion; deleting `.header-row-break` or the `#site` width cap fails
     * the second.
     */
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const box = async (selector) => {
      const measured = await page.locator(selector).boundingBox();
      if (measured === null) throw new Error(`no box for ${selector}`);
      return measured;
    };

    // AN SVG WHOSE BOX IS ITS INK, which is what makes this line mean the thing
    // the plan pinned ("rendered glyph height >= 24 CSS px").
    //
    // Two attempts got here. The caret was `h1::before`, and a pseudo-element
    // is not a DOM node, so `boundingBox()` could not address it at all. The
    // first fix made it a <span> holding "▾" -- addressable, but the box was
    // `font-size` x `line-height` regardless of content, and ▾ is U+25BE BLACK
    // DOWN-POINTING *SMALL* TRIANGLE, whose ink is ~0.4-0.5 em. So this
    // assertion passed at 25.6 px while the owner was shown a ~12 px triangle:
    // a measurable proxy standing in for the visible thing, in the test written
    // to stop that happening a third time. The path now fills the element edge
    // to edge, so the box IS the triangle.
    const caret = await box(".header-caret");
    // H2, r541 -- REPORTED TOO BIG A SECOND TIME, and the fix is to put this
    // floor on the element it was always about.
    //
    // The 24 came from WCAG 2.2 SC 2.5.8, which governs the POINTER TARGET.
    // `#header-toggle` satisfies that on its own at 2.75rem (44 px), asserted
    // directly below -- so applying 24 to the painted INK held the caret at
    // 25.6 px for a reason that had already been met elsewhere. That is why
    // three fixes each passed a measurement and left the owner still saying it
    // was wrong: every assertion was on the wrong thing.
    //
    // The ink keeps a floor, because a caret can genuinely become a speck --
    // that was the sixth and thirteenth sessions complaint -- but the floor is
    // now about legibility rather than about reachability, and is set well
    // below the shipped 1.6 rem (25.6 px) so ordinary tuning does not trip it.
    expect(caret.height).toBeGreaterThanOrEqual(11);
    // AND SMALLER THAN THE TAP TARGET, which is the relationship the last three
    // sessions kept collapsing. If these two are ever equal again, the ink has
    // been sized by an accessibility rule a second time.
    expect(caret.height).toBeLessThan(40);

    // H1, FOURTEENTH SESSION -- the same control, now too BIG. "Der ist jetzt
    // zu groß ... sollte so hoch sein wie das 'Jump to City'-Dropdown ...
    // ungefähr doppelt so groß wie der 'Show Quests'-Button."
    //
    // THE HEIGHT WAS ALREADY RIGHT: 25.6 px against Show Quests' ~26.4. So an
    // assertion on height cannot express this complaint -- it passes unchanged,
    // and strict equality would demand making the caret BIGGER. What reads as
    // double is the WIDTH of a solid filled triangle, 33.6 px, wider than it is
    // tall, sitting beside a bordered box of thin text. Equal height, very
    // unequal ink.
    //
    // Hence a width assertion, and a RATIO rather than a pixel count: pinning
    // "no wider than tall" survives the next time the height moves, which it
    // has done three times in three sessions.
    expect(caret.width).toBeLessThanOrEqual(caret.height);

    const centre = (b) => b.y + b.height / 2;
    const toggle = await box("#header-toggle");
    // THE TARGET FLOOR, on the element WCAG 2.2 SC 2.5.8 is actually about.
    // Moved here from the caret in r541 (H2): the caret is what you SEE, this is
    // what you HIT, and conflating them is what made three consecutive fixes
    // measure the wrong quantity. Shrinking the ink must never shrink this.
    expect(toggle.width).toBeGreaterThanOrEqual(24);
    expect(toggle.height).toBeGreaterThanOrEqual(24);
    const site = await box("#site");
    const quests = await box("#geo-event");

    // DEC-W6 FIRST, because it is the assertion that cannot be marginal, and
    // therefore the one that should report the breakage.
    //
    // The layout consequence below is a real guard on this machine -- removing
    // the cap does push Show Quests off row 1 -- but the uncapped picker is
    // ~165-180 px against ~361 px of content width, so whether it survives
    // depends on the user agent's default select font, which differs between a
    // Windows dev machine and a Linux CI container. Ordered the other way round
    // the marginal assertion failed first and this one never ran.
    //
    // (It also replaced `quests.x + quests.width <= 390`, which could not fail
    // at all: a WRAPPED button starts at the header's left padding and ends
    // around 134 px, satisfying the bound in exactly the state it was written
    // to catch.)
    expect(site.width).toBeLessThanOrEqual(136);

    // ROW 1: the caret, the city picker, and Show Quests. Compared by the
    // vertical centre rather than `y`, because the three have different heights
    // and `align-items: baseline` does not line their tops up.
    expect(Math.abs(centre(site) - centre(toggle))).toBeLessThan(12);
    expect(Math.abs(centre(quests) - centre(toggle))).toBeLessThan(12);

    // SIZED TO THE DROPDOWN TEXT, AND LEVEL WITH IT (r543 field report).
    //
    // THIS REPLACES THE OWNER PIN THAT SAID THE OPPOSITE, and the supersession
    // is the point rather than a detail. The fourteenth session asked for the
    // caret "so hoch wie das Jump to City-Dropdown" and this line held
    // |caret.height - site.height| <= 4, which is exactly what blocked the
    // shrink when it was attempted at r541 and reverted. The same owner has
    // since decided the caret should match the dropdown TEXT instead. A later
    // explicit decision replaces an earlier one; the test is not weakened to
    // let a change through.
    //
    // MEASURED AGAINST THE LIVE FONT SIZE, not a rem constant, so the caret
    // cannot drift the next time the dropdown is restyled -- which is the
    // property the old relationship pin was written for and is worth keeping.
    const siteFontPx = await page.evaluate(() => {
      const el = document.querySelector("#site");
      if (el === null) throw new Error("no #site");
      return Number.parseFloat(getComputedStyle(el).fontSize);
    });
    // One notch above the text, deliberately: the caret is a FILLED triangle
    // and the label is thin strokes, so equal sizes make the caret read
    // heavier. The window is tight enough that a return to 1.6 rem (25.6 px)
    // fails it by a wide margin.
    expect(caret.height).toBeGreaterThanOrEqual(siteFontPx);
    expect(caret.height).toBeLessThanOrEqual(siteFontPx + 4);

    // AND LEVEL WITH THE DROPDOWN -- "immer noch nicht auf einer Hoehe mit dem
    // Jump To City Dropdown". The header used `align-items: baseline`, and a
    // flex button whose only child is an SVG has no text baseline, so the
    // browser synthesised one from its bottom margin edge: the 44 px toggle
    // hung its BOTTOM on the row's text baseline and the caret sat well above
    // the dropdown's centre. 2 px, because centred means centred -- the 12 px
    // slack used above is for controls of genuinely different heights.
    //
    // THIS ASSERTION DOES NOT PROVE THE FIX, and says so rather than implying
    // otherwise: a mutation run passes it with the header back on `baseline`,
    // at 1280 px and at 390 px alike. Chromium cannot reproduce the reported
    // misalignment; the reporter is on a native Android `<select>`, which is
    // taller than the headless one and moves the synthesised baseline. What
    // this assertion DOES do is stop the caret from being knocked off centre by
    // some later change, which is worth having on its own.
    expect(Math.abs(centre(caret) - centre(site))).toBeLessThanOrEqual(2);

    // ROW 2 STARTS BELOW: the layer groups are on a lower line, not beside the
    // button.
    //
    // ON A PHONE THIS IS NOT EVIDENCE FOR `.header-row-break`, and saying so is
    // the point. Mutation testing showed this line passing with the break
    // deleted: at 390 px the layer groups are far too wide to share a row
    // whatever the markup says, so the assertion holds for a reason that has
    // nothing to do with the fix. It is kept because it is what G2 asks for at
    // the width G2 was reported at — and the step below is what actually holds
    // the break to account.
    const layers = await box("#layers");
    expect(layers.y).toBeGreaterThan(quests.y + quests.height - 1);

    // WITHIN row 2, the category picker comes FIRST — under the caption that
    // names it, above the switches that describe what to draw for it. The unit
    // half of this lives in `layer-toggles.test.ts`; what the browser adds is
    // that it survives real layout.
    // THE X-ORDER IS THE ASSERTION; the centre comparison only rules out the
    // picker having been pushed onto a line BELOW the switches, and on its own
    // would pass with it on a line above them.
    const category = await box("#category");
    const cells = await box("#layer-cells");
    expect(category.x).toBeLessThan(cells.x);
    expect(centre(category)).toBeLessThanOrEqual(centre(cells) + 1);

    // AND ROW 1 SURVIVES A QUEST BEING FOUND -- the state it was described for,
    // and the one the first version of this test never entered.
    //
    // `#quest-readout` is `hidden` until then, so it is not a flex item and
    // costs nothing at boot; with "340 m SW" in it the row goes about 30 px over
    // a 390 px phone and the LAST item wraps. It used to sit before the button,
    // which meant the control the row exists for was the one that disappeared
    // the moment the feature was used. The readout now takes its own line
    // instead, and the three controls stay together.
    // THE READOUT IS POPULATED DIRECTLY, not by running a quest search, and
    // that is the right call for a LAYOUT test rather than a shortcut.
    //
    // Two earlier versions pressed Show Quests and waited for the real thing.
    // Both were flaky, for two different reasons, and the second reason is the
    // one that settles it: the readout is written only when a quest is actually
    // FOUND, so the step's precondition depends on the search finding something
    // — and when it reports "No quest nearby" the readout stays empty and the
    // geometry below silently measures the boot state again. A layout assertion
    // whose setup can quietly not happen is worse than no assertion.
    //
    // What this step is about is what the header does when that span has text
    // in it. The text's provenance is `event-label.ts`'s business, covered by
    // its own unit tests and by `map-and-cells.spec.js` end to end. The string
    // used here is the exact shape those produce.
    await page.evaluate(() => {
      const readout = document.querySelector("#quest-readout");
      if (readout === null) throw new Error("no #quest-readout");
      readout.textContent = "340 m SW";
      readout.removeAttribute("hidden");
    });
    await expect(page.locator("#quest-readout")).toBeVisible();
    const withReadout = await box("#geo-event");
    const toggleAgain = await box("#header-toggle");
    const siteAgain = await box("#site");
    expect(Math.abs(centre(siteAgain) - centre(toggleAgain))).toBeLessThan(12);
    expect(Math.abs(centre(withReadout) - centre(toggleAgain))).toBeLessThan(
      12,
    );

    // AND THE SPLIT SURVIVES A WIDE WINDOW, which is the assertion
    // `.header-row-break` actually earns. On a desktop everything in this bar
    // fits one line, so without the break the requested two rows collapse into
    // one and G2 is silently unimplemented on every machine that is not a
    // phone. Deleting `flex-basis: 100%` fails here and nowhere else.
    //
    // 1920 rather than 1280: at 1280 the margin was about 30 px, so one more
    // switch or a wider font stack would have made it vacuous the way the
    // 390 px version already was.
    await page.setViewportSize({ width: 1920, height: 900 });
    const wideQuests = await box("#geo-event");
    const wideLayers = await box("#layers");
    expect(wideLayers.y).toBeGreaterThan(wideQuests.y + wideQuests.height - 1);
  });

  test("keeps the caret level with the city dropdown on a 390 px phone", async ({
    page,
  }) => {
    /**
     * WHY THIS TEST MATTERS (r543 field report).
     *
     * "Dieses Dreieck ganz oben links bei Jump To City ist immer noch zu groß
     * und immer noch nicht auf einer Höhe mit dem Jump To City Dropdown."
     *
     * WHAT THIS TEST IS FOR, STATED HONESTLY — an earlier version of this
     * docblock overclaimed and a cold review caught it.
     *
     * It implied this viewport can see a misalignment the desktop test cannot.
     * **It cannot.** The mutation run passes with the header back on
     * `baseline` at 390 px exactly as it does at 1280 px; Chromium reproduces
     * the reported symptom at NEITHER width, which is why the fix ships
     * labelled as a hypothesis (a native Android `<select>` is taller than the
     * headless one and moves the synthesised baseline).
     *
     * What this test genuinely adds is the SIZE pin at the width the reports
     * come from — the phone stylesheet is free to restyle either the caret or
     * the dropdown below 860 px, where the header becomes a floating overlay,
     * and the desktop assertions would not notice. Two separate defects this
     * session were invisible because their tests ran at the wrong viewport;
     * the alignment check here rides along as a cheap regression guard rather
     * than as proof of anything.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const measured = await page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (el === null) throw new Error(`no ${selector}`);
        const r = el.getBoundingClientRect();
        return { y: r.y, height: r.height, centre: r.y + r.height / 2 };
      };
      const site = document.querySelector("#site");
      if (site === null) throw new Error("no #site");
      return {
        caret: rect(".header-caret"),
        site: rect("#site"),
        siteFontPx: Number.parseFloat(getComputedStyle(site).fontSize),
      };
    });

    // LEVEL WITH THE DROPDOWN. Same 2 px window as the desktop check: centred
    // means centred, and the wider slack elsewhere is for controls of
    // genuinely different heights sharing a row.
    expect(
      Math.abs(measured.caret.centre - measured.site.centre),
      `caret centre ${measured.caret.centre.toFixed(1)} vs dropdown ${measured.site.centre.toFixed(1)}`,
    ).toBeLessThanOrEqual(2);

    // AND STILL SIZED TO THE DROPDOWN'S TEXT here too, because the phone
    // stylesheet is free to restyle either of them.
    expect(measured.caret.height).toBeGreaterThanOrEqual(measured.siteFontPx);
    expect(measured.caret.height).toBeLessThanOrEqual(measured.siteFontPx + 4);
  });

  test("puts every header control in a block over a fully transparent bar", async ({
    page,
  }) => {
    /**
     * WHY THIS TEST MATTERS (J2/J3/J4, DEC-J5..DEC-J7).
     *
     * "Ich möchte, dass du diesen Hintergrund komplett 100 % transparent machst
     * und stattdessen noch mehr von diesen Boxen benutzt ... so sorgt man dafür,
     * dass noch mehr vom Hintergrund, von der 3D-Szene, sichtbar ist."
     *
     * AT 390 px, because that is where the change is real. Above 860 px the
     * header is a layout ROW whose background already matches `body`, so
     * "transparent" is invisible there; below it, the bar floats over the 3D
     * view and the 82 % scrim is what the report is about.
     *
     * THE BLOCK MEMBERSHIP IS ASSERTED AS A SHARED ANCESTOR, not as a class on
     * each control. What the owner asked for is that these controls read as one
     * group; an assertion per element passes just as well when each sits in a
     * block of its own, which is the opposite arrangement.
     *
     * `#status-block`'s membership would otherwise be UNGUARDED: `#legend` is a
     * `<div>`, so if `.header-block` ever loses its `display: flex` the status
     * line and the legend stack silently, with the header simply growing taller
     * and no assertion noticing. The nav block has three existing centre-
     * alignment assertions that would fail; this one has none.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const measured = await page.evaluate(() => {
      const el = (selector) => {
        const found = document.querySelector(selector);
        if (found === null) throw new Error(`no ${selector}`);
        return found;
      };
      const blockOf = (selector) => {
        const block = el(selector).closest(".header-block");
        return block === null ? null : block.id || "(unnamed block)";
      };
      const rect = (selector) => {
        const r = el(selector).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      return {
        headerBackground: getComputedStyle(el("header")).backgroundColor,
        blocks: {
          caret: blockOf("#header-toggle"),
          site: blockOf("#site"),
          quests: blockOf("#geo-event"),
          questReadout: blockOf("#quest-readout"),
          status: blockOf("#status"),
          legend: blockOf("#legend"),
        },
        groundModeInWorld:
          el("#ground-mode-label").closest("#layer-group-world") !== null,
        radii: [...document.querySelectorAll(".header-block")].map((b) =>
          Number.parseFloat(getComputedStyle(b).borderTopLeftRadius),
        ),
        navBlock: rect("#nav-block"),
        categoryBlock: rect("#layer-group-overlays"),
      };
    });

    // FULLY TRANSPARENT, not merely more transparent. `rgba(0, 0, 0, 0)` is what
    // a computed `background: transparent` reports.
    expect(measured.headerBackground).toBe("rgba(0, 0, 0, 0)");

    // ONE block for the navigation row, ONE for the readouts underneath.
    expect(measured.blocks.caret).toBe("nav-block");
    expect(measured.blocks.site).toBe("nav-block");
    expect(measured.blocks.quests).toBe("nav-block");
    expect(measured.blocks.questReadout).toBe("nav-block");
    expect(measured.blocks.status).toBe("status-block");
    expect(measured.blocks.legend).toBe("status-block");

    // THE ONE CONTROL THE REPORT DID NOT MENTION. Left loose it would be the
    // only bare thing on a transparent bar, which is the next session's finding.
    expect(measured.groundModeInWorld).toBe(true);

    // J3: "die Ecken nicht ganz so rund". `999px` is a full pill and was the
    // outlier in this codebase -- everything else rounds between 3 and 10 px.
    // A ceiling rather than an exact value, so ordinary tuning does not trip it.
    expect(measured.radii.length).toBeGreaterThan(0);
    for (const radius of measured.radii) expect(radius).toBeLessThanOrEqual(12);

    // J4: "die haben gerade so einen seltsamen Abstand zueinander." Expressed as
    // the MEASUREMENT rather than as a CSS value, because the row break's
    // negative margin is gap arithmetic -- change `row-gap` without changing
    // that margin and the distance doubles while the declaration still reads
    // 0.3rem.
    const gap = measured.categoryBlock.top - measured.navBlock.bottom;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(6);
  });

  test("drops the category label from the collapsed bar, and keeps it when expanded", async ({
    page,
  }) => {
    /**
     * WHY THIS TEST MATTERS (G3, DEC-W4).
     *
     * `.legend-category` was ADDED to the collapsed bar four hours before the
     * session that complained about it, by DEC-U7, on the reasoning that DEC-1
     * required something on screen to name the active category. Between those
     * two moments the category `<select>` moved into the collapsed bar under
     * its own caption — naming the category AND able to change it — so the word
     * became a duplicate sitting next to the control that says the same thing.
     * The owner read it as a random "Battle Area", which is exactly what a
     * label with no visible relationship to anything looks like.
     *
     * BOTH STATES ARE ASSERTED, and the expanded one is not padding: the
     * decision is about the COLLAPSED bar, so deleting the element outright
     * would overshoot and take DEC-1's heading with it.
     */
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const label = page.locator("#legend .legend-category");
    await expect(label).toBeVisible();

    await page.locator("#header-toggle").click();
    await expect(page.locator("#header-bar")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    await expect(label).toBeHidden();

    // The control that replaced it is the one that has to still be there — the
    // whole justification for hiding the word is that this names the category
    // and can change it.
    await expect(page.locator("#category")).toBeVisible();
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
  test("an error reaches the user with the header COLLAPSED (DEC-U10)", async ({
    page,
  }) => {
    // WHY THIS TEST IS THE ONE STANDING UNDER DEC-U10. Until 2026-08-19 every
    // non-AR message went to the status line inside the header, and that is
    // the only reason the header popped itself open on every error: a message
    // written into a collapsed header is a message nobody sees. The owner
    // reported that self-expanding behaviour as a bug, so the rule was retired
    // — which is only safe because errors now go to a toast instead.
    //
    // If the toast wiring is ever lost, NOTHING ELSE FAILS. The unit tests for
    // `toast.ts` still pass, the header correctly stays put, and errors become
    // completely invisible. That is the whole failure mode, and it is only
    // observable from the assembled app — which is why this is an e2e and not
    // another unit test.
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

    // COLLAPSED FIRST. Expanded, the old status line would have been visible
    // and the test would pass for a build with no toast at all.
    await page.locator("#header-toggle").click();
    await expect(page.locator("#header-bar")).toHaveAttribute(
      "data-collapsed",
      "true",
    );

    await page.locator(".locate-button").click();

    // The message itself is the locate control's wording; what this asserts is
    // that SOMETHING reached a surface the user can see while collapsed.
    const toast = page.locator("#toast-root .toast");
    await expect(toast).toHaveText(/./, { timeout: 15000 });

    // AND THE HEADER DID NOT MOVE — the retired rule, asserted as retired.
    // Without this the test would also pass for a build that reverted DEC-U10
    // and expanded the header, since the toast would still be there.
    await expect(page.locator("#header-bar")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
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
      // THE TOAST, NOT THE STATUS LINE (DEC-U10, 2026-08-19). Errors stopped
      // being written into `#status` when the header's self-expanding rule was
      // retired — leaving this assertion pointed at the old channel would have
      // made it fail for a working app, and pointing it at nothing would have
      // dropped the half of the async-feedback rule this step exists for.
      await expect(page.locator("#toast-root .toast")).toContainText(
        /denied|unavailable|timed out/,
        { timeout: 15000 },
      );
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

    await test.step("gives every layer a VISIBLE switch", async () => {
      // WHAT IS LEFT HERE IS THE PART THAT NEEDS A BROWSER, and only that.
      //
      // The inventory — one switch per `ALL_LAYERS` entry, each uniquely
      // addressable as `#layer-<id>`, each inside a named group box — moved to
      // `layer-toggles.test.ts` (jsdom), where it is checked against the
      // registry itself rather than against the DOM's internal consistency, and
      // where four mutations of `layer-toggles.ts` prove it can fail.
      //
      // Visibility cannot move: it is CSS resolving against real layout, which
      // jsdom does not do. So the assertion left in the browser is the one the
      // unit test cannot make — that the switches the registry promises are
      // actually ON SCREEN, not merely in the document.
      const switches = page.locator("#layers input[type=checkbox][data-layer]");
      const count = await switches.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(switches.nth(i)).toBeVisible();
      }

      // And the groups are on screen, with the perf switch inside the
      // diagnostics one — it is not a layer, so nothing else would put it there.
      await expect(page.locator("#layer-group-overlays")).toBeVisible();
      await expect(page.locator("#layer-group-world")).toBeVisible();
      await expect(
        page.locator("#layer-group-diagnostics #perf-stats"),
      ).toBeVisible();
    });

    await test.step("collapses to the title, the category picker and the affordance block", async () => {
      // DEC-R6b-5 REDREW THIS LINE, and the shape of the change is the point.
      // Before round 7 exactly ONE setting collapsed — `show-below` — while the
      // World, Debug and Ground controls stayed on screen. That is backwards
      // from what the bar is for, and it is what the sixth session reported.
      //
      // Collapsed now keeps: the category picker and the whole affordance block
      // INCLUDING `show-below`, which moved into that group.
      // Collapsed now hides: the hint, the status string, World, Debug, Ground
      // — and, since round three, the legend (G3, DEC-W4). It used to be on the
      // "keeps" list to satisfy DEC-1's requirement that the active category be
      // named on screen; the category picker one line below now does that, and
      // does it with a control rather than a label.
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
      await expect(page.locator("#legend")).toBeHidden();
      await expect(page.locator("#layer-cells")).toBeVisible();
      // HIDDEN, because `cells` is off by default (DEC-U9, 2026-08-19). This
      // line asserted the opposite and was GREEN BECAUSE THE FEATURE WAS
      // BROKEN: the paint ran only from a change-subscriber, so the default
      // state was never painted at all. The old comment called the visibility
      // "a deliberate reversal", which it had been — of an older decision, and
      // DEC-U9 reverses it back for a different reason: this control has
      // nothing to be below the threshold OF while the cells are not drawn.
      //
      // The collapse behaviour it was really testing is unchanged and still
      // covered: with `cells` ON the checkbox collapses and expands with the
      // affordance block it belongs to, which is asserted in
      // map-and-cells.spec.js.
      await expect(page.locator("#show-below")).toBeHidden();

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
      // `layer-toggles.ts` has an `extrasAfter` hook for exactly this (the perf
      // switch already uses it), so the checkbox is a child of the group rather
      // than a sibling that happens to render nearby. A CSS-only fix would look
      // identical collapsed and wrong the moment the groups are reordered.
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
  test("locates when pressed without a fix, then OFFERS to enter AR", async ({
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
  });

  test("the offer's button is wired to AR entry, and the prompt clears the offer", async ({
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
  });

  test("keeps the AR offer clear of the toast and of the map's own controls", async ({
    page,
    context,
  }) => {
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
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 50.9231, longitude: 6.9445 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "xr", {
        configurable: true,
        value: { isSessionSupported: () => Promise.resolve(true) },
      });
    });
    await stubNetwork(page);
    await page.goto("/");
    await waitForRefresh(page);

    // AT 390 px, WHICH IS THE WHOLE POINT. The overlap this guards is a phone
    // phenomenon: on a 1280 px desktop the toast sits bottom-LEFT and the offer
    // is centred, so their boxes never meet and every assertion below holds
    // whatever the offset is. Mutation testing showed exactly that -- lowering
    // the offer back into the toast band passed at desktop width.
    await page.setViewportSize({ width: 390, height: 780 });
    await page.locator("#enter-ar").click();
    await expect(page.locator("#ar-offer")).toBeVisible({ timeout: 10000 });

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

  test("keeps the AR overlay's controls OUT of the 3D content, top and bottom", async ({
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
     * THE GAP THAT REMAINS, named rather than papered over: nothing here proves
     * `ar-compass-control.ts` still uses `.ar-compass`, or that `ar-mode.ts`
     * still builds an `.ar-stack` and attaches both controls into it. Those
     * class names are the seam between this test and the code; the first is
     * pinned in `ar-compass-control.test.ts`, the second is not pinned at all.
     */
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await buildArOverlayFixture(page);

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

  test("keeps the AR bottom stack readable on a 390 px phone", async ({
    page,
  }) => {
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
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    await buildArOverlayFixture(page);

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
      return {
        readoutLines: lineCount("#ar-root .ar-bottom .ar-compass-value"),
        hintLines: lineCount("#ar-root .ar-bottom .ar-compass-hint"),
        compassWidth: width("#ar-root .ar-bottom .ar-compass"),
        rowWidth: width("#ar-root .ar-bottom .ar-bottom-row"),
        bottomWidth: width("#ar-root .ar-bottom"),
      };
    });

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

  test("hides the AR experiment panel when it is marked hidden", async ({
    page,
  }) => {
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
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const display = await page.evaluate(() => {
      const root = document.querySelector("#ar-root");
      if (root === null) throw new Error("no #ar-root");
      const wrap = document.createElement("div");
      wrap.className = "ar-gear-wrap";
      const body = document.createElement("div");
      body.className = "ar-experiments";
      // EXACTLY WHAT THE PRODUCTION CODE WRITES at mount and on close.
      body.hidden = true;
      const row = document.createElement("label");
      row.className = "ar-experiments-row";
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

  test("does NOT offer AR when the user only pressed the GPS button", async ({
    page,
    context,
  }) => {
    /**
     * WHY THIS TEST MATTERS, and why it is the risky half of DEC-W2.
     *
     * The offer belongs to the AR press. A prompt that appears because someone
     * pressed Locate — which a desktop user does constantly, and which every AR
     * session's own watch does ~1 Hz — is a worse bug than the one being fixed,
     * and it is the failure mode a "a fix arrived, so offer AR" implementation
     * would have shipped without anyone noticing in a headless suite.
     */
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 50.9231, longitude: 6.9445 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "xr", {
        configurable: true,
        value: { isSessionSupported: () => Promise.resolve(true) },
      });
    });
    await stubNetwork(page);
    await page.goto("/");
    await waitForRefresh(page);

    await page.locator(".locate-button").click();

    // THE FIX REALLY DOES ARRIVE, asserted on the LOCATE BUTTON's own state.
    //
    // This waited on `#enter-ar` being enabled, which was a proof until this
    // very milestone made the AR button enabled BEFORE any fix — the same spec
    // asserts exactly that a few tests above. Geolocation could have been
    // entirely broken and this test would still have passed, proving only that
    // `#ar-offer` is hidden at boot, which it always is (PR review of P3,
    // finding 3).
    // ON THE AR BUTTON'S HINT, which is DURABLE. `data-state="located"` would
    // also prove it, but it reverts to `idle` after 4 s — a transient this
    // assertion would be racing. The hint is present exactly while a press
    // would locate first, so its ABSENCE proves both that an origin arrived and
    // that the view is at the user, which is the state the offer would need.
    await expect(page.locator("#enter-ar")).toHaveAttribute(
      "title",
      "Enter AR",
      { timeout: 10000 },
    );
    await expect(page.locator("#ar-offer")).toBeHidden();
  });

  test("keeps the map when AR is available — DEC-12", async ({
    page,
    context,
  }) => {
    // The rule the reference consumer's pattern would break. Asserted in the
    // real DOM rather than only over the pure state function, because the
    // failure mode is a call site toggling the map, not the derivation.
    //
    // THE STUB IS WHAT MAKES THIS TEST MEAN ANYTHING. Without it headless
    // Chromium reports no immersive-ar, so AR is never "available" and the two
    // assertions below hold in every state the app can reach — including with
    // the whole AR path deleted. The first version omitted it and was exactly
    // the kind of test this branch keeps retiring.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "xr", {
        configurable: true,
        value: { isSessionSupported: () => Promise.resolve(true) },
      });
    });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 50.9231, longitude: 6.9445 });
    await stubNetwork(page);
    await page.goto("/");
    await waitForRefresh(page);
    await page.locator(".locate-button").click();

    // AR really is offered here — otherwise the map's survival proves nothing.
    await expect(page.locator("#enter-ar")).toBeEnabled({ timeout: 10000 });

    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator("#scene")).toBeVisible();
  });

  test("leaves the desktop layout alone while no session is running", async ({
    page,
  }) => {
    // `#ar-root` is a child of the same grid as `#map` and `#scene`. As an
    // in-flow item with no CSS it added an implicit second row and took roughly
    // half the height from the views — caught in review, invisible to every
    // existing gate because the height assertion runs only at the mobile
    // viewport and the canvas check compares against `#scene`'s own box.
    await stubNetwork(page);
    await page.goto("/");
    await waitForRefresh(page);

    const main = await page.locator("main").boundingBox();
    const scene = await page.locator("#scene").boundingBox();

    // The views fill the row. A stolen implicit row shows up here as roughly
    // half, so the bound is generous and still discriminating.
    expect(scene.height).toBeGreaterThan(main.height * 0.9);
  });

  test("accepts the auto-elevation kill switch in the URL and boots clean", async ({
    page,
  }) => {
    // HONESTY NOTE (cold-review F8): this desktop e2e CANNOT DISCRIMINATE
    // the kill switch. Headless never enters AR, so no HUD and no estimator
    // exist with the switch in EITHER position — every assertion below would
    // pass identically without `autoElevation=off` in the URL. What it can
    // honestly pin is only that a flagged URL does not break the boot (the
    // switch's whole surface is the URL, and a boot that chokes on the
    // parameter would kill the field A/B before it starts). The tests that
    // DO discriminate the switch are unit tests: the parser in
    // `ar-elevation-auto.test.ts` (`autoElevationEnabled`) and the wiring in
    // `ar-mode.test.ts` / `ar-mode.depth-wiring.test.ts` (no depth feature,
    // no capture, no pipeline without the dep).
    await stubNetwork(page);
    await page.goto(`${AT_FIXTURE}&autoElevation=off`);
    await waitForRefresh(page);

    await expect(page.locator("#scene")).toBeVisible();
    // A LAYOUT invariant, not a switch assertion: `#ar-root` must stay
    // `:empty` on the desktop (it covers the page the moment it is not) —
    // asserted here so the flagged boot keeps that property too.
    await expect(page.locator("#ar-root")).toBeEmpty();
  });
});
