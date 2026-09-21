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
  test("a map click announces itself, and both channels clear together", async ({
    page,
  }) => {
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // THE NEXT fetch hangs. Armed after the boot precisely because the boot has
    // to succeed: this test is about what a populated app does while the user
    // waits for more, which is the real case.
    counts.holdOverpass();

    // A JUMP TO ANOTHER CITY, not a map click, and the difference is the whole
    // reason this test is worth having. A click a few hundred metres away
    // re-scores from tiles the worker ALREADY HOLDS and issues no query at all
    // (`layers-and-ground.spec.js` pins the same distinction for layers), so
    // holding Overpass would hold nothing and the refresh would be over before
    // the announce delay elapsed. The first draft of this test did exactly that
    // and failed for a reason that had nothing to do with the feature.
    await page.selectOption("#site", "porto-ribeira");

    const toast = page.locator("#loading-toast");
    await expect(toast).toBeVisible(AFTER_ANNOUNCE);
    await expect(toast).toContainText("Loading", AFTER_ANNOUNCE);
    // THE SECOND CHANNEL, and the one that survives a collapsed header only
    // because it is a class on an element whose text is rewritten constantly -
    // a child element would be deleted by the next `writeStatus`.
    await expect(page.locator("#status")).toHaveClass(/is-loading/, REPAINT);

    counts.releaseOverpass();
    await waitForRefresh(page);

    // THE TOAST IS GONE once the refresh has delivered. Note what this does NOT
    // show: `waitForRefresh` returns after the whole widening, by which time
    // `busy` has fallen too, so both hide paths have fired and this cannot tell
    // them apart. That the hide is IMMEDIATE on data arrival - the owner's
    // "instantly" - is a unit test on a fake clock, where the two can be driven
    // separately. The comment that used to sit here claimed this assertion
    // proved it, which it never did.
    await expect(toast).toBeHidden(REPAINT);
    await expect(page.locator("#status")).not.toHaveClass(
      /is-loading/,
      REPAINT,
    );
  });

  test("a refresh the user did not ask for stays silent", async ({ page }) => {
    // THE ITEM, and the reason the announcer has a latch at all. The walking
    // agent and a moving GPS fix re-enter the same refresh cycle every few
    // steps; announcing those would leave a near-permanent toast over the 3D
    // view during exactly the activity it exists for.
    //
    // The BOOT refresh is the unarmed refresh this suite can drive
    // deterministically: nobody gestured, so nothing may announce. Holding
    // Overpass before the first navigation puts the app in the state the toast
    // would fire in, for as long as we care to look.
    const counts = await stubNetwork(page);
    counts.holdOverpass();
    await page.goto(AT_FIXTURE);

    // The status line's dot IS expected here - it is the channel that reports
    // every refresh, armed or not. Waiting for it is also what makes the
    // silence below meaningful: it proves the app really is mid-refresh rather
    // than not started yet, which a bare sleep could never establish.
    await expect(page.locator("#status")).toHaveClass(
      /is-loading/,
      AFTER_ANNOUNCE,
    );

    // WAITING FOR IT TO APPEAR, AND REQUIRING THAT WAIT TO TIME OUT.
    //
    // This is the second version. The first asserted `toBeHidden(...)`, which
    // looks like the same claim and is not: `toBeHidden` succeeds on its FIRST
    // check, and an unattached element passes it immediately - so the assertion
    // resolved milliseconds after the refresh began, structurally before the 1 s
    // announce delay could have fired. It passed with the latch deleted
    // entirely, which the cold review demonstrated. An absence is only an
    // absence if something waited through the window in which the thing would
    // have appeared.
    await expect(
      page
        .locator("#loading-toast")
        .waitFor({ state: "attached", timeout: 4000 }),
    ).rejects.toThrow();

    counts.releaseOverpass();
    await waitForRefresh(page);
    await expect(page.locator("#loading-toast")).toBeHidden(REPAINT);
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

    await expect(page.locator("#loading-toast")).toBeVisible(AFTER_ANNOUNCE);

    counts.releaseOverpass();
    await waitForRefresh(page);
    await expect(page.locator("#loading-toast")).toBeHidden(REPAINT);
  });

  test("a fetch that fetches nothing still takes both channels down", async ({
    page,
  }) => {
    // THE OUTCOME WHERE A STUCK INDICATOR WOULD HURT MOST: the user waited, and
    // got nothing. An indicator left running would say the app is still trying
    // when it has stopped.
    //
    // WHAT THIS TEST LEARNED THE HARD WAY. Its first draft expected an ERROR
    // TOAST here, on the assumption that a failed query fails the refresh. It
    // does not: the pipeline tolerates a tile it could not fetch, publishes
    // what it has, and reports the shortfall in the status line - which is why
    // `waitForRefresh` watches for `unavailable` alongside `cells`. So the
    // honest assertion is that the refresh ENDS and both channels clear, not
    // that an error appears.
    //
    // 400 rather than 503 deliberately (see `fixtures.js`): a non-retryable
    // status escapes the retry loop at once, so this costs a second rather than
    // several of exponential backoff.
    const counts = await stubNetwork(page, { overpassStatus: 400 });
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    counts.holdOverpass();
    await page.selectOption("#site", "porto-ribeira");

    const toast = page.locator("#loading-toast");
    await expect(toast).toBeVisible(AFTER_ANNOUNCE);

    counts.releaseOverpass();

    await expect(toast).toBeHidden(AFTER_ANNOUNCE);
    await expect(page.locator("#status")).not.toHaveClass(
      /is-loading/,
      AFTER_ANNOUNCE,
    );
  });
});
