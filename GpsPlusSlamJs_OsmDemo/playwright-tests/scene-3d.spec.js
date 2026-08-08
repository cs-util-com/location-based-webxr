// @ts-check
/**
 * The 3D pane: what it draws, how it lays out at any device pixel ratio, the
 * lighting controls and the POI models. The slowest file in the suite, because
 * every test here rasterises WebGL in software.
 *
 * Split out of the single 4 486-line `osm-demo.spec.js` so the suite's shape
 * and its growth are visible; `fixtures.js` carries the shared setup and the
 * reasoning for why the whole suite is offline.
 */

import { test, expect } from "@playwright/test";

import {
  AT_FIXTURE,
  countNonSkyPixels,
  diffFromStash,
  expectCanvasFillsContainer,
  installFrameProbe,
  stashFrame,
  stashStableFrame,
  stubNetwork,
  waitForRefresh,
  enableCellLayer,
  REPAINT,
} from "./fixtures.js";

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
      // The fixture has one region in the displayed category, and it is coloured
      // through the SAME
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
      // SMALLER working set than a passing one. The status line read
      // `845 cells · 1 <category> regions · 19 chunks scored / 0 reused` against
      // the usual `1692 cells · 3 <category> regions · 37 scored / 19 reused`
      // (captured while the demo defaulted to `walkable`; DEC-G3 has since made
      // it `battleArea`, which changes the counts but not the reasoning). A smaller set is a smaller grid, and a
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
    // THE ROOF ROW, counted from the data (DEC-S18). Every family-S marker is
    // drawn a second time as its symbol alone over a stand-in building, which is
    // the state stage 1 will actually use and the one no assertion can judge for
    // legibility. A pixel count cannot tell "the roof row is missing" from "the
    // sheet is smaller", so the count is reported and read.
    const roofStates = Number(
      /(\d+) shown again as a symbol alone/.exec(status ?? "")?.[1],
    );
    // TWENTY-FIVE, NOT TWENTY-SEVEN, and the difference is the point rather than
    // an off-by-two. Stage 0c ported 27 winners, but two of them —
    // `leisure=picnic_table` and `amenity=bench` — are family-L PROPS: real
    // objects at real-world size, with no symbol and no column (DEC-S3,
    // DEC-S14). Only the 25 family-S markers have a symbol that can float over
    // a roof, so only they get a second slot.
    expect(roofStates).toBe(25);

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
    // RECALIBRATED FROM 5000 TO 2500 BY THE SYMBOL PORT, and the drop is the
    // port working rather than a regression. Twenty-seven markers stopped being
    // 3-15 m buildings and became 2.5 m symbols on a column, so the same row
    // covers far fewer pixels: measured 3772 immediately after stage 0c, against
    // 5000+ before it.
    //
    // The number is still doing its job — it separates "the row drew" from "the
    // scene is empty, or the camera is inside the ground" — and the headroom is
    // deliberately generous downward because stage 0d re-frames this page.
    // A tighter bound would fail on the next legitimate change.
    await expect.poll(litPixels, REPAINT).toBeGreaterThan(2500);

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

test.describe("the NPC agent", () => {
  test("routes on a click, walks it, and lets the scene go quiet again", async ({
    page,
  }) => {
    // ONE BOOT FOR THE WHOLE OF STAGE 4 (DEC-R11-18), and the reason is
    // measured rather than stylistic. The e2e pyramid plan timed this suite's
    // boot at ~4.8 s and found the e2e stage to be 93 % of this package's gate,
    // and it named the exact pattern this stage was about to repeat: "rounds
    // 7-10 each added a feature test with its own boot", which took the
    // post-fusion suite from ~200 s back to ~547 s. DEC-R11-15 ships stage 4
    // whole, so one test covering the whole of it is that decision's shape.
    //
    // THE FOUR STEPS, and why they have to share a boot: the control click is
    // what stops the walking assertions being satisfied by an agent that always
    // takes the long way (the fixture trap the plan's §6 names), and the quiet
    // assertion is only meaningful against frames that were RISING a moment
    // earlier.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const scene = page.locator("#scene");

    // NOTHING IS TURNED OFF FIRST, and that is the assertion hiding in the
    // setup. For one commit this test had to `uncheck` the `areas` layer,
    // because a region slab outranked the ground and the four `battleArea`
    // slabs blanket everything near the user at this fixture — so every click
    // resolved to a region and the agent could never be ordered. DEC-R11-21
    // reversed that precedence, and the demo's DEFAULT configuration is what
    // this test now runs against.
    const canvas = page.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");
    /** A click at a fraction of the canvas, in page coordinates. */
    const clickAt = (fx, fy) =>
      page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    /** The same click, with a named mouse button. */
    const clickAtWith = (fx, fy, button) =>
      page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, {
        button,
      });

    await test.step("a right-click on open ground orders nothing", async () => {
      // THE STEP GOES FIRST because "no route was drawn" is only an assertion
      // while no route has ever been drawn — after the next step there is a
      // stale `data-route` to confuse it, and "unchanged" is a much weaker
      // observation than "still absent".
      //
      // R13-7: the view picked on `pointerup` without reading `event.button`,
      // so this exact gesture ordered the NPC *and* opened the context menu.
      // DEC-R13-8 reserves the secondary button for the coordinate-copy
      // affordance, and reserving it means first making it inert.
      await clickAtWith(0.5, 0.72, "right");
      // A NEGATIVE ASSERTION NEEDS A REAL WINDOW, and `expect.poll(…).toBe(null)`
      // does not give one: it passes at t=0, before the worker could possibly
      // have answered, so it would stay green with the guard deleted. That is
      // exactly the vacuous assertion the comments further down this test warn
      // about. TWO SUCCESSIVE POLLS AGREEING is the same idiom the quiescence
      // step uses, and for the same reason — the poll's own interval supplies
      // the gap, so there is no `waitForTimeout` to tune. If a route does
      // appear, the attribute never goes back to null and this times out.
      let absentBefore = false;
      await expect
        .poll(
          async () => {
            const absent = (await scene.getAttribute("data-route")) === null;
            const twice = absent && absentBefore;
            absentBefore = absent;
            return twice;
          },
          { timeout: 10000, intervals: [500] },
        )
        .toBe(true);
    });

    await test.step("a click on open ground draws a route, near-straight", async () => {
      // THE CONTROL, and it is the first step for the reason the unit suite
      // puts its own control first: without it, "a route was drawn" and "a
      // route wanders" are the same observation. The ratio is what makes it an
      // assertion rather than a sighting.
      //
      // Just below the camera's pivot, which is open ground at the fixture —
      // the buildings sit in the upper-middle of the frame (the existing
      // unpickable test relies on the same layout).
      await clickAt(0.5, 0.72);

      await expect
        .poll(() => scene.getAttribute("data-route"), REPAINT)
        .not.toBe(null);
      const drawn = await scene.getAttribute("data-route");
      const [points, lengthM, straightM] = String(drawn).split(":").map(Number);

      // A polyline, not a single point: the agent has somewhere to walk.
      expect(points).toBeGreaterThan(1);
      expect(lengthM).toBeGreaterThan(0);
      // NEAR-STRAIGHT. A hex grid cannot draw a perfect line and the route is
      // quantised to res-13 cell centres, so 1.6x is loose for the
      // quantisation and far tighter than any detour around a building.
      expect(lengthM).toBeLessThan(straightM * 1.6);
    });

    await test.step("the agent moves, so the scene keeps drawing", async () => {
      // Frames are scheduled ON DEMAND in this view (DEC-R3-9) — there is no
      // permanent rAF loop — so a rising counter here is only explicable by
      // something actually animating.
      const frames = () => scene.getAttribute("data-frames").then(Number);
      const before = await frames();
      await expect.poll(frames, REPAINT).toBeGreaterThan(before);
    });

    await test.step("and the scene goes QUIET once it arrives", async () => {
      // THE ASSERTION THE WHOLE STAGE RESTS ON (DEC-R11-15). The accepted risk
      // was a reintroduced permanent render loop — measured at ~6x slower e2e
      // with one test into a timeout — and this is the only thing that catches
      // one. It had to exist in W3's first commit rather than be added
      // afterwards, because landing the frame scheduling together with new UI
      // is what would make such a regression hard to attribute.
      //
      // QUIESCENCE, not a fixed wait: the walk's duration depends on whatever
      // route the fixture produced, so "it stopped" is the observable and "it
      // stopped by now" is not. Two SUCCESSIVE POLLS agreeing is the whole
      // measurement — the poll's own interval supplies the gap, so there is no
      // `waitForTimeout` here and nothing to tune if the route length changes.
      let previous = -1;
      await expect
        .poll(
          async () => {
            const now = Number(await scene.getAttribute("data-frames"));
            const unchanged = now === previous;
            previous = now;
            return unchanged;
          },
          { timeout: 30000, intervals: [500] },
        )
        .toBe(true);
    });

    await test.step("a second order replaces the first route", async () => {
      // THE SUPERSEDING PATH, which is the one thing about clicking twice that
      // only the running app can show: the click handler, `latestOnly`, the
      // worker queue and the polyline teardown all have to agree that the
      // newest destination wins. The route search is SYNCHRONOUS inside the
      // worker and an `abort` cannot preempt it, so "the newest click wins" is
      // the honest guarantee — and this is what proves it holds.
      //
      // NOT A BUILDING CLICK. DEC-R11-17's blocker — a click on a facade
      // resolving to nothing rather than to the ground behind it — is pinned by
      // five assertions in `pick.test.ts`, and asserting it here would need a
      // building at a KNOWN screen coordinate, which this fixture does not
      // guarantee: the first attempt clicked what the older "buildings stay
      // unpickable" test uses and landed on open ground, drawing a route. A
      // browser test that silently clicks empty ground while claiming to click
      // a building is exactly the vacuous assertion the plan's §6 warns about.
      const before = await scene.getAttribute("data-route");
      // WHERE THE AGENT IS STANDING when the second order is given — the end of
      // the first route, since the step above waited for the walk to finish.
      const stoodAt = await scene.getAttribute("data-agent");
      expect(stoodAt).not.toBeNull();

      await clickAt(0.35, 0.62);
      await expect
        .poll(() => scene.getAttribute("data-route"), REPAINT)
        .not.toBe(before);

      // AND IT DID NOT TELEPORT BACK TO THE START (raised in review on #274).
      // The cycle read the USER's position for both the click target and the
      // agent's, so a second order without moving planned from the user again
      // and snapped the cone back before it began walking. The agent's own
      // position is the start of the new route, so one frame into the walk it
      // is still within a stride of where it stopped.
      const [stoodX, stoodZ] = String(stoodAt).split(",").map(Number);
      const [nowX, nowZ] = String(await scene.getAttribute("data-agent"))
        .split(",")
        .map(Number);
      // Generous: one frame of walking at AGENT_SPEED_MPS is metres, while the
      // teleport this catches is the whole distance of the first route.
      expect(Math.hypot(nowX - stoodX, nowZ - stoodZ)).toBeLessThan(20);
    });

    await test.step("a click on a drawn cell both opens the panel and orders", async () => {
      // STAGE 3 (DEC-R13-6), AND BOTH HALVES HAVE TO BE ASSERTED: opening the
      // panel alone is what shipped before, and ordering alone is the naive
      // fix. Either one on its own passes half of this step.
      //
      // THE CELL LAYER IS OFF BY DEFAULT (DEC-R7b-6), which is exactly why the
      // bug went unnoticed — so the step turns it on first, through the helper
      // that also waits out the progressive widening. Nothing else in this test
      // needs cells, and it runs last for that reason.
      await enableCellLayer(page);

      const panel = page.locator("#details");
      /** Whether the route attribute moved off `was` within a worker round trip. */
      const routeChanged = async (was) =>
        page
          .waitForFunction(
            (previous) =>
              document.querySelector("#scene")?.getAttribute("data-route") !==
              previous,
            was,
            { timeout: 4000 },
          )
          .then(
            () => true,
            () => false,
          );

      // A SWEEP, FOR THE REASON THE OLDER GRID-PICK TEST SWEEPS: the fixture's
      // grid covers the centre of the view, but which pixel is over a CELL
      // depends on how large a working set that run happened to score. A fixed
      // point landed on a region slab instead, which opens the panel and orders
      // nothing — so a single click would fail intermittently, and a weaker
      // assertion would pass on the wrong thing.
      //
      // THE PAIR IS SELF-DISCRIMINATING, which is what makes this a test of
      // DEC-R13-6 rather than of two unrelated facts:
      //
      // - a REGION click opens the panel and leaves the route alone;
      // - a GROUND click orders the agent and opens no panel;
      // - only a CELL does both, which is exactly the behaviour this stage adds.
      //
      // Opening the panel alone is what shipped BEFORE this stage, and ordering
      // alone is the naive fix, so either half on its own proves nothing.
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
          const before = await scene.getAttribute("data-route");
          await page.mouse.click(
            box.x + box.width / 2 + dx,
            box.y + box.height / 2 + dy,
          );
          if (!(await panel.isVisible())) continue;
          if (await routeChanged(before)) return true;
        }
        return false;
      };
      await expect.poll(sweep, { timeout: 40_000 }).toBe(true);
      await expect(panel).toBeVisible();
    });
  });
});
