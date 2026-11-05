import { test, expect } from "./e2e-test.js";
import {
  installAnchorStarterFakes,
  bootAnchorStarter,
  pushGpsFix,
} from "./fakes.js";

/**
 * Tier 1 placement-flow e2e for the persistent-anchor starter.
 *
 * Why this suite matters (see
 * GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md §6 Tier 1):
 * Tier 0 can only prove the desktop capability gate. With the DEV seam faked
 * (real WebXR/GPS are absent in Playwright Chromium), these tests cover the
 * actual application flow a real user walks through: boot → onboarding
 * guidance → soft-gated placement → URL `?show=` persistence (write + reload
 * round-trip) → placement-failure revert.
 *
 * Async-UX caveat: `placeAnchor()` is synchronous (it writes `?show=` via
 * `history.replaceState` in the same call stack), so the transient `Saving…`
 * button state is never observable from e2e. We therefore assert ONLY the
 * durable final state (`Saved ✓`), per the pinned rationale in the plan §6.
 */

const SAMPLE_FIX = { lat: 48.20817, lon: 16.37381, altitude: 171, accuracy: 4 };

test.describe("Anchor starter — Tier 1 placement flow", () => {
  test.beforeEach(async ({ page }) => {
    await installAnchorStarterFakes(page);
  });

  test("a boot on a ready report: placeable, guided, wired, and a user-ended session tears down @pr", async ({
    page,
  }) => {
    await bootAnchorStarter(page);

    // Soft-gate: the button is placeable immediately after boot, before any
    // tracking-readiness — only the recommendation differs.
    const placeButton = page.getByTestId("place-button");
    await expect(placeButton).toBeVisible();
    await expect(placeButton).toBeEnabled();
    await expect(placeButton).toHaveText("Place anchor");

    // Nothing is saved yet, so the share/reload affordances stay hidden.
    await expect(page.getByTestId("copy-link-button")).toBeHidden();
    await expect(page.getByTestId("start-screen")).toBeHidden();

    // Default fake report is `ok` → the guidance maps to the ready band.
    await expect(page.locator("#guidance-title")).toHaveText("Ready");
    await expect(page.locator("#guidance-percent")).toHaveText("100%");
    await expect(page.locator("#guidance-bar")).toHaveAttribute(
      "data-tone",
      "good",
    );

    // Regression guard for the "guidance stuck on AR tracking lost" bug. The
    // framework only forwards per-frame AR poses into the store when initAR
    // receives its `callbacks.tracking` group (store + restart callback
    // together, since the setter fold); drop the group and tracking.phase
    // never leaves `initializing`, pinning the onboarding guidance to
    // "AR tracking lost" forever. The guidance assertions fake
    // selectTrackingQuality directly, so they would NOT catch the missing
    // wiring — this observes the initAR call the fake intercepts.
    const wiring = await page.evaluate(() => ({
      store: window.__anchorStarterTest.trackingStoreWired,
      callbacks: window.__anchorStarterTest.trackingCallbacksWired,
    }));
    expect(wiring.store).toBe(true);
    expect(wiring.callbacks).toBe(true);

    // Last, because it ends the session. Why this matters (PR #363/#364
    // reviews): THREE apps each shipped a different variant of the same
    // missed teardown wiring — AnchorStarter's was that only the start-FAILURE
    // path tore down, so a session the user ends (back gesture, "Exit AR")
    // left `isRecording` true and the dead session's odometry↔GPS pairs in the
    // store, blending into the next entry's alignment solve. Reviewers caught
    // all three by reading; this drives the REAL onSessionEnd callback the
    // fake initAR captured, so a fourth variant fails a test instead of
    // relying on luck.
    // Division of proof, stated so nobody "strengthens" this into a trap:
    // the framework's ar-session-teardown.test.ts proves the teardown drops
    // the odometry↔GPS pairs against the real slices. No pair can land in
    // THIS harness (`getCurrentArPose` is a direct framework import, not a
    // seam, and there is no XR session), so this spec proves the app half —
    // the callback is WIRED and actually fires the teardown — via the
    // recording flag, which is the observable the wiring miss left stuck.
    const before = await page.evaluate(
      () =>
        window.__anchorStarterTest.trackingStore?.getState().recording
          .isRecording,
    );
    expect(before).toBe(true); // non-vacuous: a session is actually open

    const after = await page.evaluate(() => {
      const t = window.__anchorStarterTest;
      t.fireSessionEnd?.({ reason: "user" });
      return {
        wired: typeof t.fireSessionEnd === "function",
        isRecording: t.trackingStore?.getState().recording.isRecording,
      };
    });
    expect(after.wired).toBe(true);
    expect(after.isRecording).toBe(false);

    // The DEVICE-and-DOM half (PR #366 review): the store-only teardown left
    // the start screen hidden forever — a dead end with GPS polling still
    // running. The rollback must restore the way back in.
    await expect(page.getByTestId("start-screen")).toBeVisible();
    await expect(page.getByTestId("start-button")).toBeEnabled();
    await expect(page.getByTestId("placement")).toBeHidden();
  });

  test("renders a warming-up tracking report as a progress phase @pr", async ({
    page,
  }) => {
    await installAnchorStarterFakes(page, {
      trackingReport: {
        state: "warming-up",
        confidence: 0.4,
        subScores: { coverage: 1, freshness: 0.5, agreement: 0.5 },
      },
    });
    await bootAnchorStarter(page);

    await expect(page.locator("#guidance-title")).toHaveText("Move around");
    // warming-up percentReady = coverage * 0.6 → 60%.
    await expect(page.locator("#guidance-percent")).toHaveText("60%");
    await expect(page.locator("#guidance-bar")).toHaveAttribute(
      "data-tone",
      "progress",
    );
  });

  test("placing saves the anchor into ?show=, surfaces the share affordances and starts the wayfinding HUD @pr", async ({
    page,
  }) => {
    await bootAnchorStarter(page);
    await pushGpsFix(page, SAMPLE_FIX);

    await page.getByTestId("place-button").click();

    // Assert only the durable final state (see the async-UX caveat above).
    const placeButton = page.getByTestId("place-button");
    await expect(placeButton).toHaveText("Saved ✓");
    await expect(placeButton).toBeDisabled();
    await expect(page.getByTestId("banner")).toContainText(
      "Saved into the page link",
    );
    await expect(page.getByTestId("copy-link-button")).toBeVisible();

    const search = await page.evaluate(() => location.search);
    expect(search).toMatch(/[?&]show=/);
    const showValue = new URLSearchParams(search).get("show");
    expect(
      showValue,
      "?show= must carry a non-trivial encoded anchor",
    ).toBeTruthy();
    expect(showValue.length).toBeGreaterThan(4);

    // The wayfinding HUD is the "guide me to the anchor" feature. It must be
    // wired for the freshly placed anchor with the camera, a target getter,
    // and the distance deadband — dropping any of these silently disables the
    // guidance on real devices.
    const hudCalls = await page.evaluate(
      () => window.__anchorStarterTest.wayfindingHudCalls,
    );
    expect(hudCalls.length).toBe(1);
    expect(hudCalls[0]).toEqual({
      hasCamera: true,
      hasGetTargets: true,
      distanceMin: 1.5,
      distanceMax: 3.0,
    });
  });

  test("the saved link round-trips: marker, banner, HUD and the placed altitude come back on reload @pr", async ({
    page,
  }) => {
    await bootAnchorStarter(page);
    await pushGpsFix(page, SAMPLE_FIX);
    await page.getByTestId("place-button").click();
    await expect(page.getByTestId("place-button")).toHaveText("Saved ✓");

    // Why the altitude matters: a shared anchor must be positioned on the
    // vertical (up/down) axis too, not just lat/lon. The placed `altitude` is
    // encoded into `?show=` (so the copied link carries it) and, when that link
    // is loaded on the cache-hit path, the anchor is re-created with the same
    // altitude (so it applies on load). See
    // GpsPlusSlamJs_Docs/docs/2026-06-06-1210-anchor-starter-cachehit-jump-investigation.md.
    // `?show=` encodes the committed reference as a JSON envelope; its
    // required `alt` field must equal the placed altitude.
    const showParam = await page.evaluate(() =>
      new URLSearchParams(location.search).get("show"),
    );
    expect(showParam).not.toBeNull();
    expect(JSON.parse(showParam).a[0].alt).toBe(SAMPLE_FIX.altitude);

    // The anchor lives entirely in the page link — reload it and boot again
    // (addInitScript re-runs: the recorded calls reset).
    const savedUrl = page.url();
    await page.goto(savedUrl);
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("placement")).toBeVisible();
    await expect(page.getByTestId("guidance")).toBeVisible();

    // cache-hit branch: the place button stays hidden (no re-placement), and
    // the marker is rebuilt from the URL-decoded spec (default style).
    await expect(page.getByTestId("place-button")).toBeHidden();

    // The default fake tracking report is already "ready", so the cache-hit
    // boot advances relocalising → anchor-shown immediately; assert that
    // durable end state rather than the transient "re-localise" banner (the
    // relocalising copy is pinned separately in placement-view.test.ts).
    await expect(page.getByTestId("banner")).toContainText(
      "Your saved anchor is shown",
    );

    const seen = await page.evaluate(() => {
      const t = window.__anchorStarterTest;
      return {
        markerCalls: t.markerCalls,
        hudCalls: t.wayfindingHudCalls,
        lastAnchor: t.anchorCalls.at(-1),
      };
    });
    expect(seen.markerCalls.length).toBeGreaterThan(0);
    expect(seen.markerCalls.at(-1)).toEqual({
      ui: 1,
      scale: 1,
      rotationDeg: 0,
    });

    // The story: open a shared link and the HUD guides you to the anchor from
    // afar. The cache-hit boot spawns the anchor from the URL, and the HUD
    // must ride along.
    expect(seen.hudCalls.length).toBe(1);
    expect(seen.hudCalls[0].hasGetTargets).toBe(true);

    // The cache-hit anchor was created with the persisted altitude on the
    // `skipBootstrap` path.
    expect(seen.lastAnchor).toBeDefined();
    expect(seen.lastAnchor.skipBootstrap).toBe(true);
    expect(seen.lastAnchor.gpsPoint?.altitude).toBe(SAMPLE_FIX.altitude);
  });

  test("a failed anchor creation reverts cleanly, leaks nothing, and a retry places exactly one marker @pr", async ({
    page,
  }) => {
    // Why this matters: spawnAnchor adds the marker to the AR world group
    // *before* createGpsAnchor runs. If creation throws (or any later step in
    // placeAnchor does), the half-spawned marker must be removed — otherwise a
    // retry stacks overlapping markers and leaks the frame-loop registration.
    // The HUD belongs to a successfully spawned anchor; a failed placement
    // must not leave a HUD polling a marker that was rolled back.
    await bootAnchorStarter(page);
    await pushGpsFix(page, SAMPLE_FIX);

    const childCount = () =>
      page.evaluate(() => window.__anchorStarterTest.worldGroupChildren.length);

    // Force the faked createGpsAnchor to throw, exercising the PLACE_FAILED
    // revert (async-UX rule: in-progress state reverts and the error surfaces).
    await page.evaluate(() => {
      window.__anchorStarterTest.failCreateAnchor = true;
    });
    await page.getByTestId("place-button").click();

    const error = page.getByTestId("error");
    await expect(error).toBeVisible();
    await expect(error).not.toBeEmpty();

    // Button reverts to a placeable state; nothing was saved.
    const placeButton = page.getByTestId("place-button");
    await expect(placeButton).toHaveText("Place anchor");
    await expect(placeButton).toBeEnabled();
    await expect(page.getByTestId("copy-link-button")).toBeHidden();
    expect(await childCount()).toBe(0);
    const hudCalls = await page.evaluate(
      () => window.__anchorStarterTest.wayfindingHudCalls,
    );
    expect(hudCalls.length).toBe(0);

    // Two failed attempts in a row must never accumulate markers.
    await placeButton.click();
    await expect(error).not.toBeEmpty();
    expect(await childCount()).toBe(0);

    // Clear the fault and place successfully — exactly one marker remains.
    await page.evaluate(() => {
      window.__anchorStarterTest.failCreateAnchor = false;
    });
    await placeButton.click();
    await expect(placeButton).toHaveText("Saved ✓");
    expect(await childCount()).toBe(1);
  });

  test("blocks placement until it can be placed: first the alignment hint, then the point-at-the-ground hint @pr", async ({
    page,
  }) => {
    await bootAnchorStarter(page);
    await pushGpsFix(page, SAMPLE_FIX);

    const error = page.getByTestId("error");
    const placeButton = page.getByTestId("place-button");
    const expectNothingSaved = async () => {
      const search = await page.evaluate(() => location.search);
      expect(search).not.toMatch(/[?&]show=/);
    };

    // A surface is under the cursor but alignment is still null → the reticle's
    // world pose is not yet GPS-world, so placement must wait and surface the
    // alignment hint rather than committing the anchor to a meaningless GPS.
    const alignment = await page.evaluate(() => {
      const t = window.__anchorStarterTest;
      const kept = t.alignmentMatrix;
      t.alignmentMatrix = null;
      return kept;
    });
    await placeButton.click();
    await expect(error).toBeVisible();
    await expect(error).toContainText("Aligning to GPS");
    await expect(placeButton).toHaveText("Place anchor");
    await expectNothingSaved();

    // The anchor is placed under the hit-test reticle (the AR cursor), so a
    // press with no surface must NOT place — it surfaces the hint and the
    // button stays placeable for a retry once the user points at the ground.
    await page.evaluate((matrix) => {
      const t = window.__anchorStarterTest;
      t.alignmentMatrix = matrix;
      t.reticleVisible = false;
    }, alignment);
    await placeButton.click();
    await expect(error).toBeVisible();
    await expect(error).toContainText("Point your phone at the ground");
    await expect(placeButton).toHaveText("Place anchor");
    await expect(placeButton).toBeEnabled();
    await expect(page.getByTestId("copy-link-button")).toBeHidden();
    await expectNothingSaved();

    // Pointing at the ground (reticle visible) then retrying places normally.
    await page.evaluate(() => {
      window.__anchorStarterTest.reticleVisible = true;
    });
    await placeButton.click();
    await expect(placeButton).toHaveText("Saved ✓");
  });
});

test.describe("Anchor starter — boot rollback", () => {
  /**
   * Why this test matters: every step after `initAR` succeeds has a side effect
   * (sensor watches start, the cache-hit branch may spawn an anchor). If one of
   * those awaited steps rejects, the app must NOT linger half-started — Start
   * stuck on "Starting…", the start screen hidden, GPS still watching. The
   * post-`initAR` try/catch in `startAr` calls `failStart`, which rolls every
   * side effect back and restores the start screen so the user can retry. Here
   * we force the awaited `requestDeviceOrientationPermission` to reject and
   * assert the UI is fully rewound.
   *
   * `failStart` fires after `initAR` has already created the renderer + WebXR
   * session, so it must call `endARSession()` to return the framework to a
   * clean, re-initialisable state. Without that call `renderer`/`xrSession` stay
   * non-null and `initAR()` throws on the retry ("AR session already
   * initialized"), permanently wedging the app. The faked seams don't reproduce
   * the real re-entry guard (the fake `initAR` is a no-op), but we can assert
   * the call happened and that the retry boots cleanly.
   */
  test("a post-initAR failure rewinds to the start screen, ends the session, and the retry boots @pr", async ({
    page,
  }) => {
    await installAnchorStarterFakes(page, { failOrientationPermission: true });
    await page.goto("/");

    await page.getByTestId("start-button").click();

    // The start screen comes back and Start is re-enabled for a retry.
    const startScreen = page.getByTestId("start-screen");
    await expect(startScreen).toBeVisible();
    const startButton = page.getByTestId("start-button");
    await expect(startButton).toBeEnabled();
    await expect(startButton).toHaveText("Start AR");

    // The failure reason is surfaced, and the live HUD stays hidden.
    const message = page.getByTestId("capability-message");
    await expect(message).toBeVisible();
    await expect(message).not.toBeEmpty();
    await expect(page.getByTestId("guidance")).toBeHidden();
    await expect(page.getByTestId("placement")).toBeHidden();

    // endARSession must have been called during failStart.
    const calls = await page.evaluate(
      () => window.__anchorStarterTest.endARSessionCalls,
    );
    expect(calls).toBe(1);

    // Clear the fault so the retry succeeds.
    await page.evaluate(() => {
      window.__anchorStarterTest.failOrientationPermission = false;
    });

    // Retry: the app should boot fully now that the framework is clean.
    await startButton.click();
    await expect(page.getByTestId("guidance")).toBeVisible();
    await expect(page.getByTestId("placement")).toBeVisible();
  });
});
