// @ts-check
/**
 * The layer switches and the ground modes — what each one adds to or removes
 * from the two views.
 *
 * Split out of the single 4 486-line `osm-demo.spec.js` so the suite's shape
 * and its growth are visible; `fixtures.js` carries the shared setup and the
 * reasoning for why the whole suite is offline.
 */

import { test, expect } from "./e2e-test.js";

import {
  AT_FIXTURE,
  countNonSkyPixels,
  stubNetwork,
  waitForRefresh,
  REPAINT,
} from "./fixtures.js";

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
      ).toHaveCount(8);

      // FIVE OF EIGHT START ON (DEC-R7b-5, DEC-R7b-6). Round 4 turned every
      // layer on; round 8 took plates and cells back off after a session saw the
      // demo with the terrain relief carrying the ground; the underground
      // diagnostic joined them off by default. Both halves are asserted, because
      // an accidental flip in either direction matters and "at least one is on"
      // would catch neither.
      //
      // The height ramp is not here at all: it is an appearance of the ground
      // mode rather than a layer (DEC-R5-4).
      await expect(page.locator("#layer-terrainDebug")).toHaveCount(0);
      await expect(page.locator("#layer-cells")).not.toBeChecked();
      await expect(page.locator("#layer-plates")).not.toBeChecked();
      await expect(page.locator("#layer-underground")).not.toBeChecked();
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

test.describe("the underground layer", () => {
  /**
   * WHY THESE TESTS MATTER.
   *
   * `isBelowSurface` removes 13.3 % of corpus features from the scores and from
   * the mesh and says nothing. This layer exists so a human can judge WHICH
   * features — the corpus test bounds the share, and only an eye on real ground
   * catches the mirror bug, where too eager a predicate deletes real walkable
   * ground and nothing looks broken because there is simply less map.
   *
   * BOTH VIEWS, because they answer different questions: the map says WHERE the
   * excluded ground is, the 3D view says what SHAPE it was. And the cells layer
   * has already taught, twice, that a layer can be registered, wired and still
   * draw nothing.
   */
  test("draws the excluded features in both views, and nothing when off", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const drawn = page.locator("#map path.underground-feature");

    // OFF FIRST, and this is the direction that actually broke before: a layer
    // whose data arrives regardless draws itself before anyone asks.
    await expect(page.locator("#layer-underground")).not.toBeChecked();
    await expect(drawn).toHaveCount(0);

    // The count is reported even with the layer off — that is the point of it.
    await expect(page.locator("#status")).toContainText(/\d+ underground/);

    // THE FULL DATA URL, not its length. A base64 PNG length is a coarse hash
    // — a scene that gained a few thin lines can encode to the same byte count
    // — so comparing lengths is the one assertion here that could stop biting
    // without failing. Every other canvas comparison in this file (584, 1410,
    // 2214, 2907, 3028, 3293, 3353) compares the whole string.
    const sceneBefore = await page.evaluate(() => {
      const el = document.querySelector("#scene canvas");
      return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
    });

    await page.locator("#layer-underground").check();

    // 2D: the outlines appear. Present rather than visible, because an excluded
    // feature can sit outside the viewport exactly as a geo-event can.
    await expect(drawn).not.toHaveCount(0, { timeout: 30000 });

    // 3D: the picture changes. Asserted as a CHANGE rather than a colour,
    // because what matters is that the scene incorporated the layer at all —
    // and the fixture's ground decides where the lines land.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.querySelector("#scene canvas");
            return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
          }),
        { timeout: 30000 },
      )
      .not.toBe(sceneBefore);

    // AND BACK OFF, which is the half a redraw-only implementation passes and a
    // draw-once one fails.
    await page.locator("#layer-underground").uncheck();
    await expect(drawn).toHaveCount(0, { timeout: 30000 });
  });
});
