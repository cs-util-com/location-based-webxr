// @ts-check
/**
 * The ground window during a DEM outage. The frame across a normal walk runs in
 * the layer test of `layers-and-ground.spec.js`, on its boot.
 *
 * Split out of the single 4 486-line `osm-demo.spec.js` so the suite's shape
 * and its growth are visible; `fixtures.js` carries the shared setup and the
 * reasoning for why the whole suite is offline.
 */

import { test, expect } from "./e2e-test.js";

import {
  AT_FIXTURE,
  stubNetwork,
  waitForRefresh,
  walkByMapClick,
  REPAINT,
} from "./fixtures.js";

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

    await walkByMapClick(page);
    await waitForRefresh(page);

    // THE POINT: the window still moved with the user, outage or not.
    await expect.poll(groundCentre, REPAINT).not.toBe("0,0");
    const moved = (await groundCentre()) ?? "";
    const [dx, dy] = moved.split(",").map(Number);
    expect(Math.hypot(dx ?? 0, dy ?? 0)).toBeGreaterThan(20);
  });
});
