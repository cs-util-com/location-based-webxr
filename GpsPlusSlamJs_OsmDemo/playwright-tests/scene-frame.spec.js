// @ts-check
/**
 * The scene's ENU frame across a walk — the round-5B guarantee that the frame
 * holds still while the ground follows the user, including during a DEM outage.
 *
 * Split out of the single 4 486-line `osm-demo.spec.js` so the suite's shape
 * and its growth are visible; `fixtures.js` carries the shared setup and the
 * reasoning for why the whole suite is offline.
 */

import { test, expect } from "@playwright/test";

import {
  AT_FIXTURE,
  stubNetwork,
  waitForRefresh,
  REPAINT,
} from "./fixtures.js";

test.describe("the scene frame", () => {
  test("keeps ONE frame across a walk while the ground follows the user", async ({
    page,
  }) => {
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
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

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
    await page.locator("#map").click({ position: { x: 60, y: 60 } });
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
});

test.describe("the scene frame during a DEM outage", () => {
  test("keeps the ground under the user even when the terrain fails to load", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS, AND WHAT IT CAUGHT. Raised in review on #269. When
    // the DEM returns nothing the field is `undefined` — the ground stays flat,
    // deliberately, because a sea-level hole shaped like the outage reads as
    // terrain. The shipped code then left the ground plane WHERE IT WAS, on the
    // reasoning that moving a flat plane is invisible.
    //
    // That reasoning covered the appearance and missed the COVERAGE. The plane
    // is finite: it reaches TERRAIN_EXTENT_M from its centre and then stops. A
    // user who walks past that during an outage ends up off the edge of it with
    // no ground beneath them at all — and because the re-anchor threshold is
    // 5 km, that is reachable well inside one anchor.
    //
    // So a failed load still has to report WHERE it was asked to look. This is
    // the assertion that it does.
    await stubNetwork(page, { failTerrain: true });
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const scene = page.locator("#scene");
    const groundCentre = () => scene.getAttribute("data-ground-centre");

    // The outage is real: the status line says so rather than reporting relief.
    await expect(page.locator("#status")).toContainText(/terrain unavailable/);

    await expect.poll(groundCentre, REPAINT).toBe("0,0");

    await page.locator("#map").click({ position: { x: 60, y: 60 } });
    await waitForRefresh(page);

    // THE POINT: the window still moved with the user, outage or not.
    await expect.poll(groundCentre, REPAINT).not.toBe("0,0");
    const moved = (await groundCentre()) ?? "";
    const [dx, dy] = moved.split(",").map(Number);
    expect(Math.hypot(dx ?? 0, dy ?? 0)).toBeGreaterThan(20);
  });
});
