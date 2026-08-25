// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";

/**
 * Why these tests matter: they are the only place the M2 AR foundation is
 * proven END-TO-END through the real page boot — the seams resolving to the
 * fakes, the controller walking checking → ready → running, and the
 * on-running sequence (startSession → alignment → camera capture) firing in
 * the composed app rather than in isolated units. The wiring decisions they
 * pin (camera frames wired at initAR time, the recording slice actually
 * started, both modes booting the SAME foundation) all fail silently on
 * device when wrong.
 */

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

async function enterAr(page) {
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 }); // support probe done
  await button.click();
}

test("viewer mode boots to running: session started, alignment bound, capture at 8 Hz", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("enter-ar")).toHaveText("Start AR view");
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("AR running");

  const wiring = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      initAR: t.initARCalls,
      capture: t.captureCalls,
      alignment: t.alignmentCalls,
      recording: t.alignmentStore?.getState().recording,
    };
  });
  // Camera frames must be wired AT initAR time (the source is built there),
  // with the M2 isolation flags: camera + texture ON, depth OFF.
  expect(wiring.initAR).toEqual([
    {
      hasCameraFrame: true,
      isolationOptions: {
        enableCameraAccess: true,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: true,
      },
    },
  ]);
  // The silent-drop trap: without startSession the coordinator discards
  // every GPS fix without a log — the recording slice must be live.
  expect(wiring.recording?.isRecording).toBe(true);
  expect(wiring.recording?.sessionMetadata?.contextTag).toBe("tour-viewer");
  expect(wiring.alignment).toEqual([
    { hasStore: true, groupName: "fake-world-group" },
  ]);
  expect(wiring.capture).toEqual([{ intervalMs: 125 }]);
});

test("camera frames flow through the foundation and surface in the status line", async ({
  page,
}) => {
  await page.goto("/");
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("AR running");

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(3);
  });
  await expect(page.getByTestId("ar-status")).toHaveText(
    "Viewer mode — AR running · 3 camera frames",
  );
});

test("author mode (?author=1) boots the same foundation under its own labels", async ({
  page,
}) => {
  await page.goto("/?author=1");
  await expect(page.getByTestId("enter-ar")).toHaveText("Start AR authoring");
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Authoring in AR");
  await expect(page.getByTestId("ar-status")).toContainText("Author mode");

  const wiring = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      initARCount: t.initARCalls.length,
      capture: t.captureCalls,
      isRecording: t.alignmentStore?.getState().recording.isRecording,
    };
  });
  // QD-5/delta #7: the foundation is IDENTICAL — same capture cadence, same
  // live recording slice; only labels differ until M3/M4 diverge.
  expect(wiring.initARCount).toBe(1);
  expect(wiring.capture).toEqual([{ intervalMs: 125 }]);
  expect(wiring.isRecording).toBe(true);
});

test("a system session end tears the runtime down, and a re-entry starts a clean session", async ({
  page,
}) => {
  // Why this matters (PR #359 review): unlike the single-shot demos, this
  // AR entry is a toggle a visitor uses repeatedly. Without the teardown the
  // first session's recording stayed open, and its GPS elements — anchored
  // to the DEAD session's odom origin — blended into the next session's
  // alignment solve.
  await page.goto("/");
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("AR running");

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start AR view");
  const afterEnd = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      stopCaptureCalls: t.stopCaptureCalls,
      isRecording: t.alignmentStore?.getState().recording.isRecording,
    };
  });
  expect(afterEnd.stopCaptureCalls).toBe(1);
  expect(afterEnd.isRecording).toBe(false);

  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("AR running");
  const afterReenter = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      initARCount: t.initARCalls.length,
      isRecording: t.alignmentStore?.getState().recording.isRecording,
    };
  });
  expect(afterReenter.initARCount).toBe(2);
  expect(afterReenter.isRecording).toBe(true);
});

test("without fakes the button reports AR unsupported instead of breaking the page", async ({
  browser,
}) => {
  // A fresh context WITHOUT the init script: headless Chromium has no WebXR,
  // so the honest end state is the disabled unsupported button — and the
  // zip-viewer half of the page must stay fully functional next to it.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("enter-ar")).toHaveText(
    "AR not supported on this device",
    { timeout: 10000 },
  );
  await expect(page.getByTestId("enter-ar")).toBeDisabled();
  await expect(page.getByTestId("open-button")).toBeEnabled();
  await context.close();
});
