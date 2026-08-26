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
  // containText, not exact: the viewer QR pipeline appends its own status
  // segment to the same line once frames start flowing (M4).
  await expect(page.getByTestId("ar-status")).toContainText(
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

test("author mode mints and exports a level that the parser round-trips", async ({
  page,
}) => {
  // Why this matters (QR-pose plan M3): this drives the COMPOSED author
  // pipeline — scripted device detect/solve, but the REAL tracking
  // controller, the real qrDetected slice + stability gate, the real
  // alignment solve fed through the store, the real mint conversion and the
  // real serializer — and asserts the exported JSON is a parseable level
  // with a geo pose. Frame-exactness is pinned by the unit tests; this
  // proves the pieces are actually wired to each other.
  await page.goto("/?author=1");
  await expect(page.getByTestId("author-panel")).toBeVisible();
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Authoring in AR");
  await expect(page.getByTestId("author-status")).toHaveText(
    /point the camera/i,
  );

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(
      "https://gps.csutil.com/tour/?qr=x&c=1",
    );
  });
  // One frame per poll tick: detects are async and coalesced, so a burst
  // would collapse into one observation. Stability needs ≥5.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("author-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/waiting for GPS alignment/i);
  await expect(page.getByTestId("mint-export")).toBeDisabled();
  // The size input is locked while the session runs — the solves used the
  // captured value (milestone review #3).
  await expect(page.getByTestId("author-size")).toBeDisabled();

  // The identity-matrix hole (milestone review #1): creating gpsData ships
  // an IDENTITY alignment matrix — the gate must NOT open on it.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.alignmentStore.dispatch({
      type: "gpsData/setZeroPos",
      payload: { lat: 47.5, lon: 8.7 },
    });
  });
  await expect(page.getByTestId("author-status")).toHaveText(/0 of 3 fixes/i);
  await expect(page.getByTestId("mint-export")).toBeDisabled();

  // Feed the REAL alignment solve: three odom↔GPS pairs, ~15 m apart, in a
  // consistent identity-ish mapping around the zero reference.
  await page.evaluate(() => {
    const store = /** @type {any} */ (window).__tourViewerTest.alignmentStore;
    const pairs = [
      { odom: [0, 0, 0], lat: 47.5, lon: 8.7 },
      { odom: [0, 0, -15], lat: 47.500135, lon: 8.7 },
      { odom: [15, 0, 0], lat: 47.5, lon: 8.7002 },
    ];
    for (const [i, p] of pairs.entries()) {
      store.dispatch({
        type: "gpsData/recordGpsEvent",
        payload: {
          odomPosition: p.odom,
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: `e2e-${String(i)}`,
            latitude: p.lat,
            longitude: p.lon,
            altitude: 400,
            latLongAccuracy: 5,
            timestamp: 1756150000000 + i * 1000,
          },
        },
      });
    }
  });
  await expect(page.getByTestId("author-status")).toHaveText(/ready to mint/i, {
    timeout: 10000,
  });

  await page.getByTestId("mint-export").click();
  const json = await page.getByTestId("author-json").inputValue();
  const level = JSON.parse(json);
  expect(level.version).toBe(1);
  // 0.16 — the page-fitting default (PR #364 review; see the print spec).
  expect(level.qr.physicalSizeM).toBeCloseTo(0.16, 9);
  expect(level.qr.geo.lat).toEqual(expect.any(Number));
  expect(level.qr.geo.lon).toEqual(expect.any(Number));
  expect(level.qr.geo.rotation).toHaveLength(4);
  expect(level.qr.mintQuality.mintedAtIso).toEqual(expect.any(String));
  // The quality block records what the alignment looked like at MINT time
  // (milestone review #7) — M5's error attribution reads these.
  expect(level.qr.mintQuality.alignmentSampleCount).toBe(3);
  expect(level.qr.mintQuality.gpsAccuracyM).toBe(5);
  await expect(page.getByTestId("author-download")).toBeVisible();
  await expect(page.getByTestId("author-copy")).toBeVisible();
  // The glue check received the detections (milestone review #8). The fake
  // world group is null until initAR ran, so this also pins the creation
  // ORDER — a view created before the session exists is dead code in
  // production (PR #360 review).
  const debugUpdates = await page.evaluate(
    () => /** @type {any} */ (window).__tourViewerTest.qrDebugUpdates,
  );
  expect(debugUpdates).toBeGreaterThan(0);

  // Re-entry must NOT inherit the dead session's evidence (PR #360 review):
  // the gpsData slice keeps its lifetime GPS pairs, so a fresh session's
  // gate would open at frame 0 on an alignment blended across two odom
  // origins. The snapshot makes the count session-relative.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start AR authoring");
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Authoring in AR");
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("author-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/0 of 3 fixes/i);
  await expect(page.getByTestId("mint-export")).toBeDisabled();
});

test("viewer mode relocalizes against the tour's level: budgeted votes, marker, image ring", async ({
  page,
}) => {
  // Why this matters (QR-pose plan M4): the COMPOSED viewer loop — the
  // zip-carried qr/1.json resolved for the DETECTED code, the REAL vote
  // builder writing budgeted synthetic GPS events into the real store, and
  // the visible payoff (glue marker + the tour's images ringed around the
  // anchor). The budget is the guardrail: without it every locked frame
  // votes and a lingering visitor pins the alignment centroid.
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
  await page.goto("/");
  await page.getByTestId("link-input").fill(ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });

  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("AR running");

  // The session zero + a few real fixes (the alignment the votes refine).
  await page.evaluate(() => {
    const store = /** @type {any} */ (window).__tourViewerTest.alignmentStore;
    store.dispatch({
      type: "gpsData/setZeroPos",
      payload: { lat: 47.5, lon: 8.7 },
    });
    const pairs = [
      { odom: [0, 0, 0], lat: 47.5, lon: 8.7 },
      { odom: [0, 0, -15], lat: 47.500135, lon: 8.7 },
      { odom: [15, 0, 0], lat: 47.5, lon: 8.7002 },
    ];
    for (const [i, p] of pairs.entries()) {
      store.dispatch({
        type: "gpsData/recordGpsEvent",
        payload: {
          odomPosition: p.odom,
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: `seed-${String(i)}`,
            latitude: p.lat,
            longitude: p.lon,
            altitude: 400,
            latLongAccuracy: 5,
            timestamp: 1756150000000 + i * 1000,
          },
        },
      });
    }
  });

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(
      "https://gps.csutil.com/tour/?qr=x&c=1",
    );
  });
  // Frames until the budget is SPENT — proves votes flowed and then stopped.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("ar-status").textContent();
      },
      { timeout: 20000 },
    )
    .toMatch(/vote budget spent/i);

  const afterBudget = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      gpsCount:
        t.alignmentStore.getState().gpsData.gpsEvents.gpsPositions.length,
      markerUpdates: t.qrDebugUpdates,
      planes: t.fakeScene.children.length,
    };
  });
  // 3 seeded fixes + 10 vote batches × 4 correspondences = 43.
  expect(afterBudget.gpsCount).toBe(43);
  expect(afterBudget.markerUpdates).toBeGreaterThan(0);
  expect(afterBudget.planes).toBe(3); // the image ring, placed once

  // Budget holds: more locked frames add NOTHING.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(5);
  });
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          /** @type {any} */ (window).__tourViewerTest.alignmentStore.getState()
            .gpsData.gpsEvents.gpsPositions.length,
      ),
    )
    .toBe(43);
});

test("a scanned code with no level reads as unknown instead of flapping", async ({
  page,
}) => {
  // The deferred negative cache (delta #8): a rejecting fetch would flap
  // the controller error↔scanning at the detection cadence; the placeholder
  // resolves once and the visitor gets a plain answer.
  await page.goto("/");
  await enterAr(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(
      "https://gps.csutil.com/tour/?qr=x&c=9",
    );
  });
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("ar-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/code 9 has no level/i);
});

test("the print panel renders a scannable code at a declared true size", async ({
  page,
}) => {
  // Why this matters (owner request 2026-08-26): the printed artifact is
  // creator step ZERO and expensive to redo. This drives the real measured
  // URL builder and the real QR renderer in a browser: a code appears, the
  // info line carries the version + the physical size + the 100%-scale
  // instruction, and the full launch URL is shown for copying.
  await page.goto("/?author=1");
  await page
    .getByTestId("print-url")
    .fill("https://www.dropbox.com/scl/fi/abc/tour.zip?rlkey=k&dl=0");
  await page.getByTestId("print-generate").click();

  await expect(page.getByTestId("print-canvas")).toBeVisible();
  const drawn = await page.evaluate(() => {
    const canvas = document.querySelector("canvas#print-canvas");
    return canvas instanceof HTMLCanvasElement
      ? { width: canvas.width, blank: canvas.toDataURL().length < 200 }
      : null;
  });
  expect(drawn?.width).toBeGreaterThan(0);
  expect(drawn?.blank).toBe(false);
  await expect(page.getByTestId("print-info")).toContainText("100% scale");
  // 16cm: the default PRINTED size must fit an A4/Letter page with the
  // quiet zone at 100% scale — 20cm did not, and the symbol clipped
  // (PR #364 review). The default therefore may NOT trigger the page-fit
  // warning, which is asserted absent here.
  await expect(page.getByTestId("print-info")).toContainText("16cm");
  await expect(page.getByTestId("print-info")).not.toContainText("cut off");
  await expect(page.getByTestId("print-button")).toBeVisible();
  // BARE host (ZD-9): the landing forward carries ?qr= to the viewer, so
  // printed codes never spend payload bits on a path.
  await expect(page.getByTestId("print-url-out")).toContainText(
    "https://gps.csutil.com/?qr=",
  );

  // An oversized size warns in the same info line the scale instruction
  // lives in — a clipped code does not decode, so silence is the bug.
  await page.getByTestId("author-size").fill("0.3");
  await page.getByTestId("print-generate").click();
  await expect(page.getByTestId("print-info")).toContainText("cut off");
  await page.getByTestId("author-size").fill("0.16");

  // Failure path (async-UI rule): a bad URL surfaces in the panel and the
  // button restores.
  await page.getByTestId("print-url").fill("not a url");
  await page.getByTestId("print-generate").click();
  await expect(page.getByTestId("print-info")).toContainText(/http/i);
  await expect(page.getByTestId("print-generate")).toBeEnabled();
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
