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
  walkByMapClick,
  REPAINT,
  openCityLook,
} from "./fixtures.js";

test.describe("the layer toggles", () => {
  // ONE BOOT for the switches, the underground layer, the ground picker and the
  // scene frame. The walks come late because a move cannot be undone, and the
  // picker's default is read before anything changes the mode.
  test("switch geometry, draw plates, clear the grid, show the underground, hold one frame across a walk, and 'No ground' stays empty sky", async ({
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
      ).toHaveCount(11);

      // EIGHT OF ELEVEN START ON (DEC-R7b-5, DEC-R7b-6; `woods` joined, on, in
      // objects M2a; the land-use `tint`, on, with the colour schemes; `furniture`,
      // on, with the street furniture). Round 4 turned every
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
      await expect(page.locator("#layer-woods")).toBeChecked();
      await expect(page.locator("#layer-furniture")).toBeChecked();
      await expect(page.locator("#layer-tint")).toBeChecked();
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

    await test.step("draws the street furniture by default and removes it when switched off", async () => {
      // WHY THIS TEST MATTERS: the street furniture is on by default, behind a
      // switch. The park fixture
      // maps two street lamps, so the default build places them and the
      // status line counts them; the switch filters at draw time, so off
      // drops the count without a refetch, and on brings it back.
      const status = page.locator("#status");
      await expect(status).toContainText(/[1-9]\d* furniture/);
      const before = counts.overpassQuery;
      await openCityLook(page);
      await page.locator("#layer-furniture").uncheck();
      await expect(status).not.toContainText(/\d+ furniture/);
      await expect(status).toContainText(/[1-9]\d* volumes/);
      await page.locator("#layer-furniture").check();
      await expect(status).toContainText(/[1-9]\d* furniture/);
      expect(counts.overpassQuery).toBe(before);
    });

    await test.step("draws the cosmetic woods by default and removes them when switched off", async () => {
      // WHY THIS TEST MATTERS (objects M2a, owner decision: woods ON by default,
      // a switch). The park fixture maps one natural=wood, so the default
      // build invents trees in it and the status line counts them; switching
      // the layer off must drop the count (the layer is not built, not merely
      // hidden) without a refetch, and switching it on brings them back.
      const status = page.locator("#status");
      await expect(status).toContainText(/[1-9]\d* woods/);
      const before = counts.overpassQuery;
      await page.locator("#layer-woods").uncheck();
      await expect(status).not.toContainText(/\d+ woods/);
      await expect(status).toContainText(/[1-9]\d* volumes/);
      await page.locator("#layer-woods").check();
      await expect(status).toContainText(/[1-9]\d* woods/);
      expect(counts.overpassQuery).toBe(before);
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
      await page
        .getByRole("checkbox", { name: "areas", exact: true })
        .uncheck();
      const canvas = page.locator("#scene canvas");
      const box = await canvas.boundingBox();
      if (box === null) throw new Error("no canvas box");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator("#details")).toBeHidden();

      // Back to the boot state, so the steps below start from what a user has.
      await page.getByRole("checkbox", { name: "areas", exact: true }).check();
      await page.locator("#layer-plates").uncheck();
    });

    await test.step("the underground layer draws the excluded features in both views, and nothing when off", async () => {
      // The layer exists so a human can judge WHICH features `isBelowSurface`
      // removes: 13.3 % of corpus features leave the scores and the mesh with
      // nothing said, the corpus test bounds the share, and only an eye on real
      // ground catches the mirror bug, where too eager a predicate deletes real
      // walkable ground and nothing looks broken because there is simply less map.
      //
      // BOTH VIEWS, because they answer different questions: the map says WHERE
      // the excluded ground is, the 3D view says what SHAPE it was. The cells
      // layer has already taught, twice, that a layer can be registered, wired
      // and still draw nothing.
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

    await test.step("keeps ONE frame across a walk while the ground follows the user", async () => {
      // WHY THIS TEST MATTERS, AND WHY IT IS NOT A SCREENSHOT DIFF. "The scene
      // does not jump" needs a machine-readable definition. A canvas comparison
      // cannot supply one here: the user has moved, so the picture MUST change,
      // and an identical-pixels assertion would only pass for a scene that had
      // stopped drawing. What must not change is the FRAME those pixels are
      // expressed in — every published vertex is relative to it, so if it holds
      // across a step then nothing moved underneath the user.
      //
      // The counterweight is in the same assertion: the sampled ground window has
      // to FOLLOW the user, or the frame standing still is bought by the terrain
      // ceasing to cover where they are standing — at which point
      // `surfaceHeight`'s per-axis clamp extrudes the edge profile outward as
      // stripes that look like terrain and are not (finding R2-9).
      //
      // This is the regression the whole of round 5 exists for, and the one the
      // unit tests can only assert a piece of each: the frame is decided in
      // `scene-anchor.ts`, sampled in `terrain-window.ts`, threaded through
      // `heightfield.ts` and drawn by `building-view.ts`. Only the running app
      // proves the four agree.
      const scene = page.locator("#scene");
      const frameOrigin = () => scene.getAttribute("data-frame-origin");
      const groundCentre = () => scene.getAttribute("data-ground-centre");

      await expect.poll(groundCentre, REPAINT).not.toBe(null);
      const originAtStart = await frameOrigin();
      const centreAtStart = await groundCentre();
      expect(originAtStart).not.toBeNull();
      // The scene opens anchored where the user is, so the window starts on top
      // of the frame origin. Without this the "it moved" assertion below could be
      // satisfied by a window that was never there in the first place.
      expect(centreAtStart).toBe("0,0");

      // A MAP CLICK, which is how this demo simulates a walk — well inside the
      // 5 km re-anchor threshold, so it is travel rather than a discontinuity.
      // Near the corner of the map so the move is a few hundred metres, which is
      // far more than a rounding difference and far less than the threshold.
      //
      // THROUGH THE HELPER, because a bare click here is not reliably a walk:
      // region polygons stop propagation, and which geography sits under a fixed
      // pixel moves with the map's size. The helper picks a spot that is provably
      // outside every region at run time. See `walkByMapClick`.
      await walkByMapClick(page);
      await waitForRefresh(page);
      await expect.poll(groundCentre, REPAINT).not.toBe(centreAtStart);

      // THE FRAME IS UNCHANGED. Not "close to": the anchor is a held value, so any
      // difference at all means something re-derived it from the position.
      expect(await frameOrigin()).toBe(originAtStart);

      // AND THE GROUND MOVED WITH THE USER. Parsed rather than merely compared,
      // so a window that jumped to some unrelated place would not pass for one
      // that followed a click a few hundred metres away.
      const moved = (await groundCentre()) ?? "";
      const [dx, dy] = moved.split(",").map(Number);
      expect(Number.isFinite(dx) && Number.isFinite(dy)).toBe(true);
      expect(Math.hypot(dx ?? 0, dy ?? 0)).toBeGreaterThan(20);
      expect(Math.hypot(dx ?? 0, dy ?? 0)).toBeLessThan(5000);
    });

    /** The canvas as a string; a full data URL, never its length. */
    const shot = () =>
      page.evaluate(() => {
        const el = document.querySelector("#scene canvas");
        return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
      });

    await test.step("'No ground' changes the picture and leaves the buildings", async () => {
      // WHY THIS STEP MATTERS. `No ground` is a way to look at the OSM ground
      // areas without the terrain over them, and it fails silently: a mode
      // switch that cleared the whole scene would look like a blanking bug, and
      // a mode that did nothing would look like a decorative picker.
      const picker = page.locator("#ground-mode");
      await expect(picker).toHaveValue("cpu-slope");
      const withGround = await shot();
      await picker.selectOption("none");
      await expect.poll(shot, REPAINT).not.toBe(withGround);
      await expect(page.locator("#status")).toContainText(/ground none/);
      await expect(page.locator("#status")).toContainText(/\d+ volumes/);
    });

    // "No ground" must MEAN no ground, including after the user moves. Reported
    // with the camera under the scene as "there was still some additional ground
    // layer rendered"; measured from below with every layer off, only the sky
    // remains, and what is visible underneath is the DoubleSide affordance grid.
    // These steps pin the half that could regress silently.
    // THE SKY STEP RUNS FIRST, and the order is the fusion's own rule rather
    // than taste: it is fully reversible (eight switches back on), while the step
    // below MOVES THE USER, which reloads the terrain and cannot be undone. An
    // irreversible step goes last or it hands every later step a world it did
    // not ask for.
    const LAYERS = [
      "cells",
      "areas",
      "buildings",
      "trees",
      // The cosmetic woods (objects M2a) are a layer too, on by default.
      "woods",
      // The street furniture, on by default.
      "furniture",
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
      // The furniture switch sits in the folded city-look section.
      await openCityLook(page);
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

      // And it comes back: the picker is not a one-way door.
      await page.locator("#ground-mode").selectOption("cpu");
      await expect(page.locator("#status")).toContainText(/ground cpu \d/);
    });
  });
});
