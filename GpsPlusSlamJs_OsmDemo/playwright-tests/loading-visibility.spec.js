// @ts-check
/**
 * "Is it still loading?" - the two channels that answer it, in the browser.
 *
 * WHY THIS FILE EXISTS. The demo's only loading signal used to be the header's
 * status line, and `index.html` removes that line from the layout whenever the
 * header is collapsed - which is exactly what a user does to give the 3D view
 * the screen. A res-7 tile takes tens of seconds, so the app could sit looking
 * frozen for half a minute with nothing on screen saying otherwise. Owner
 * report, 2026-09-21.
 *
 * WHY IT IS AN E2E AND NOT ONLY UNIT TESTS. The DECISION - when to announce, and
 * when to stop - is unit-tested to the corner in `loading-announcer.test.ts` on
 * a fake clock, which is where "it did NOT show" can be asserted without racing
 * anything. What no unit test can see is the WIRING: that a real gesture reaches
 * the announcer, that the class actually lands on `#status`, and that a refresh
 * nobody asked for stays silent all the way through the real store and the real
 * worker.
 *
 * The gesture here is the SITE PICKER rather than a map click, for a reason that
 * cost a first draft: a click a few hundred metres away re-scores from tiles the
 * worker already holds and issues no Overpass query at all, so there is nothing
 * to hold open and nothing to wait for.
 *
 * Each test holds the Overpass response open, which is how the ~15-90 s window
 * the feature exists for becomes a deterministic one in a suite that is
 * otherwise instant.
 */

import { test, expect } from "./e2e-test.js";

import {
  AT_FIXTURE,
  stubNetwork,
  waitForRefresh,
  REPAINT,
} from "./fixtures.js";

/**
 * Long enough that the 1 s announce delay has certainly elapsed.
 *
 * NOT a bare `waitForTimeout` anywhere below: every assertion still waits for
 * an ELEMENT. This is only the budget handed to those waits, sized so that a
 * slow CI machine cannot fail a test the app would have passed.
 */
const AFTER_ANNOUNCE = { timeout: 8_000 };

test.describe("the loading channels", () => {
  test("a refresh the user did not ask for stays silent", async ({
    page,
    context,
  }) => {
    // THE ITEM, and the reason the announcer has a latch at all. The walking
    // agent and a moving GPS fix re-enter the same refresh cycle every few
    // steps; announcing those would leave something on screen over the 3D view
    // during exactly the activity it exists for.
    //
    // THE TRIGGER CHANGED ON 2026-09-22 and the reason is worth keeping. This
    // used the BOOT refresh as its unarmed example - nobody gestured, so
    // nothing could announce. Then the owner opened the app, watched an empty
    // scene for thirty seconds, and asked for the cold start to announce after
    // all. The boot is now armed, so it is no longer an example of silence.
    //
    // LOCATE is, and deliberately: pressing it produces a position change and
    // therefore a refresh, but the button's own handler lives inside
    // `locate-control.ts` where `main.ts` cannot reach it, and the callback it
    // does expose (`onLocated`) fires for every watch fix as well as for the
    // press. Arming there would arm the position stream, so locate is left
    // unarmed - which makes it the honest stand-in for the stream itself.
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 50.9231, longitude: 6.9445 });

    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    // The boot's own overlay has to be gone before this means anything.
    await expect(page.locator("#loading-overlay")).toBeHidden(AFTER_ANNOUNCE);

    counts.holdOverpass();
    await page.locator(".locate-button").click();

    // The status line's dot IS expected - it reports every refresh, armed or
    // not. Waiting for it is what makes the silence below meaningful: it proves
    // the app really is mid-refresh rather than not started yet, which a bare
    // sleep could never establish.
    await expect(page.locator("#status")).toHaveClass(
      /is-loading/,
      AFTER_ANNOUNCE,
    );

    // WAITING FOR IT TO APPEAR, AND REQUIRING THAT WAIT TO TIME OUT.
    //
    // This is the second version of this assertion. The first used
    // `toBeHidden`, which looks like the same claim and is not: it succeeds on
    // its FIRST check, and an unattached element passes immediately - so it
    // resolved milliseconds after the refresh began, structurally before the
    // 1 s announce delay could fire. It passed with the latch deleted
    // entirely. An absence is only an absence if something waited through the
    // window in which the thing would have appeared.
    await expect(
      page
        .locator("#loading-overlay")
        .waitFor({ state: "attached", timeout: 4000 }),
    ).rejects.toThrow();

    counts.releaseOverpass();
  });

  test("a site pick made MID-FETCH still announces", async ({ page }) => {
    // THE DEFECT THIS WAS WRITTEN FOR, found in cold review of the first
    // implementation. `arm()` runs, and the very next statement dispatches
    // `placeChanged` - which blanks the snapshot. The demo's snapshot
    // subscription fired `dataArrived()` on that blanking, which cancelled the
    // countdown the gesture had just started. Net effect: picking a city while
    // anything was already fetching produced NO toast at all, for the longest
    // wait in the app, in the collapsed-header case the feature exists for.
    //
    // The unit tests could not see it - the wiring is in `main.ts`, which
    // exports nothing - and neither could the other e2e here, because they all
    // wait for the boot to finish first and so arm while the cycle is idle.
    // This one deliberately gestures while the boot refresh is still in flight.
    const counts = await stubNetwork(page);
    counts.holdOverpass();
    await page.goto(AT_FIXTURE);

    // Mid-refresh, and proven so rather than assumed.
    await expect(page.locator("#status")).toHaveClass(
      /is-loading/,
      AFTER_ANNOUNCE,
    );

    await page.selectOption("#site", "porto-ribeira");

    await expect(page.locator("#loading-overlay")).toBeVisible(AFTER_ANNOUNCE);

    counts.releaseOverpass();
    await waitForRefresh(page);
    await expect(page.locator("#loading-overlay")).toBeHidden(REPAINT);
  });
});
