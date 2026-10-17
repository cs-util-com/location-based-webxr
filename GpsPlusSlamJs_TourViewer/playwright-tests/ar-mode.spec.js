// @ts-check
import { expect, test } from "@playwright/test";

import {
  enterArAndMeasure,
  installTourViewerArFakes,
  openFixtureTour,
  seedAlignment,
  tapFinish,
} from "./ar-fakes.js";
import {
  E2E_QR_ARCHIVE,
  E2E_QR_TEXT,
  E2E_QR_UNKNOWN_TEXT,
  e2eQrLevelEntryName,
} from "./qr-fixture.mjs";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { parseTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";

/** Every file entry of a zip: text for JSON, the raw bytes otherwise. */
async function zipEntries(bytes) {
  const reader = new ZipReader(new BlobReader(new Blob([bytes])));
  const entries = {};
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    entries[entry.filename] = entry.filename.endsWith(".json")
      ? await entry.getData(new TextWriter())
      : await entry.getData(new Uint8ArrayWriter());
  }
  await reader.close();
  return entries;
}

/** The zip the page handed to the download fake, read back in node. */
async function readDownloadedZip(page, index = 0) {
  const bytes = await page.evaluate(async (i) => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads[i];
    return {
      filename: d.filename,
      data: Array.from(new Uint8Array(await d.blob.arrayBuffer())),
    };
  }, index);
  return {
    filename: bytes.filename,
    entries: await zipEntries(new Uint8Array(bytes.data)),
  };
}

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

const RANGES_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
/** The same tour, its `tour.json` marked as needing no GPS (Q-QF-1). */
const NO_GPS_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/no-gps-tour.zip";

/** The visitor's way in (DEC-N1): a `?qr=` launch, which opens the tour on
 *  boot and shows the visitor screen instead of the setup. */
async function openAsVisitor(page, url, { debug = false } = {}) {
  // `debug`: the technical status line (frames, votes, fixes) a visitor
  // reads only with ?debug=1 since UI round 1; tests of the pipeline's
  // internals read it there, the plain line has its own test.
  await page.goto(`/?qr=${encodeURIComponent(url)}${debug ? "&debug=1" : ""}`);
  // Open (follow-up F14): a visitor's page no longer fills its hidden
  // gallery, so the count of its images is no readiness signal.
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
}

/** Lock the fixture's code: arm the detection and feed frames until the
 *  gate reports the lock (M5 - nothing is placed before it). */
async function lockTheCode(page) {
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("ar-status").getAttribute("data-gate");
      },
      { timeout: 20000 },
    )
    // The CODE passed the gate (U1 milestone review #9: the visitor's state
    // alone also reads "placing" after a GPS-only pass).
    .toBe("passed-code");
}

/**
 * Open step 4 on the creator's page.
 *
 * Since the flow rework (F4) step 4 is a real disclosure like its siblings,
 * so the AR button lives inside a collapsed <details> until the creator
 * gets there - which is the point: the setup is one step at a time. A
 * VISITOR needs none of this (`visitor-screen.ts` opens step 4 for them,
 * because their summary is creator-only and could never be tapped).
 */
async function openMeasureStep(page) {
  const step = page.getByTestId("step-measure");
  // `el.open`, not getAttribute: an open <details> carries `open=""`, which
  // is FALSY - the attribute form silently clicks an already-open step and
  // closes it.
  if (await step.evaluate((el) => /** @type {HTMLDetailsElement} */ (el).open))
    return;
  // The step card shows one step; its station dot opens another (M2b).
  await page.getByTestId("station-measure").click();
  await expect(step).toHaveAttribute("open", "");
}

async function enterAr(page) {
  await openMeasureStep(page);
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 }); // support probe done
  await button.click();
}

test("the plain page is the creator's setup; a ?qr= launch is the visitor's screen", async ({
  page,
}) => {
  // Why this test matters (guided-setup plan DEC-N1): the two pages share
  // one HTML file, and a visitor scanning a printed code must never see the
  // setup, nor a creator the consent screen. The mode is the launch
  // parameter's presence and nothing else.
  await page.goto("/");
  await expect(page.getByTestId("wizard")).toBeVisible();
  // The suite's creator has chosen a host (playwright.config.js), so the
  // page opens at step 2, the link (polish round M2).
  await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
  await expect(page.getByTestId("print-url")).toBeHidden(); // step 3 collapsed
  await expect(page.getByTestId("visitor-screen")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");

  await openAsVisitor(page, RANGES_ARCHIVE);
  await expect(page.getByTestId("visitor-screen")).toBeVisible();
  // What AR needs is behind "What happens?" since V4 (polish round M4a).
  await expect(page.getByTestId("visitor-more")).toContainText(/camera/i);
  // The way from a tour to making one (polish round A8): the setup page,
  // in a new tab so the tour stays open.
  const own = page.getByTestId("make-your-own");
  await expect(own).toBeVisible();
  await expect(own).toHaveAttribute("href", "./");
  await expect(own).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("wizard")).toBeHidden();
  await expect(page.getByTestId("link-input")).toBeHidden();
  // The transport-demo surfaces are the creator's (M2 review #2): a visitor
  // gets the consent copy, the Start button and one stats line.
  await expect(page.getByTestId("storage-panel")).toBeHidden();
  await expect(page.getByTestId("gallery")).toBeHidden();
  // The transfer numbers are the creator's since UI round 1 (U1, review
  // F11): a visitor's could stall below 100 % and read as stuck.
  await expect(page.getByTestId("stats")).toBeHidden();
  await expect(page.getByTestId("ar-hint")).toContainText(
    "the tour's code (on the poster)",
  );
  await expect(page.getByTestId("enter-ar")).toHaveText("Start the tour");
});

test("a visitor who refuses the location starts the tour on codes alone: no location request, no GPS watch, no GPS escape, and a code places the tour (QR-first M1b-1)", async ({
  page,
}) => {
  // Why this matters (QR-first plan 2026-10-14-0445 §7 #10, §8 Q-QF-1): a
  // denial used to end at "allow location in your settings" with no way in,
  // though the tour's printed codes place it on their own (M1). The page
  // must start AR without the location permission or a GPS watch, say what
  // a tour without location needs, offer no "Continue with GPS only", and
  // let a code pass the gate.
  await page.addInitScript(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    if (t) {
      t.locationPermission = "prompt";
      t.locationOutcome = "denied";
    }
  });
  await openAsVisitor(page, RANGES_ARCHIVE);
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Allow location", { timeout: 10000 });
  await button.click();
  await expect(button).toHaveText("Start the tour");
  await expect(page.getByTestId("error")).toBeEmpty();
  const codesLine =
    "Scan one of the tour's printed codes to start - without location, the codes place the tour.";
  await expect(page.getByTestId("ar-hint")).toHaveText(codesLine);
  // The visitor tapped "Block": the browser now reports the site denied, so
  // the re-check before a codes-only start (review #3) does not ask again.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.locationPermission = "denied";
  });
  await button.click();
  await expect(button).toHaveText("Exit AR");
  const fakes = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      permissionRequests: t.geolocationPermissionRequests,
      gpsWatch: t.gpsCallback !== null,
    };
  });
  expect(fakes).toEqual({ permissionRequests: 0, gpsWatch: false });
  await expect(page.getByTestId("ar-status")).toContainText(
    "Without location, the tour's printed codes place it - any of them will do.",
  );
  // No GPS to continue with: the escape's clock never offers it.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.fireTimers();
  });
  await expect(page.getByTestId("scan-escape")).toBeHidden();
  // ...and the code places the tour on its own: the visitor's state reaches
  // "placed", not only the gate (M1b-1 review #4).
  await lockTheCode(page);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        await forceTrackingReady(page);
        return page.getByTestId("ar-status").getAttribute("data-state");
      },
      { timeout: 20000 },
    )
    .toBe("placed");
});

test("a visitor of a tour that needs no GPS is never asked for the location and starts on codes alone (Q-QF-1)", async ({
  page,
}) => {
  // Why this matters (owner decision Q-QF-1, the per-tour half): a creator
  // marks a tour whose printed codes place it on their own (`tour.json`
  // `needsNoGps`). Its visitor must see no "Allow location" step, no
  // "your browser will ask" line, no permission request and no GPS watch -
  // even with the permission still at "prompt" - and a code places it.
  await page.addInitScript(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    if (t) t.locationPermission = "prompt";
  });
  await openAsVisitor(page, NO_GPS_ARCHIVE);
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Start the tour", { timeout: 10000 });
  await expect(page.getByTestId("ar-hint")).toHaveText(
    "Once AR starts, point your phone at the tour's code (on the poster).",
  );
  await button.click();
  await expect(button).toHaveText("Exit AR");
  const fakes = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      locationRequests: t.locationRequests,
      permissionRequests: t.geolocationPermissionRequests,
      gpsWatch: t.gpsCallback !== null,
    };
  });
  expect(fakes).toEqual({
    locationRequests: 0,
    permissionRequests: 0,
    gpsWatch: false,
  });
  await lockTheCode(page);
});

test("a visitor who dismissed the location prompt is offered it once more before a codes-only start (M1b-1 review #3)", async ({
  page,
}) => {
  // Why this matters: Chrome reports a DISMISSED prompt as a denial while
  // the permission still reads "prompt", so one stray tap used to mean no
  // GPS for the whole page load. The start re-reads the permission and
  // offers the location again - once: a second dismissal starts on codes.
  await page.addInitScript(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    if (t) {
      t.locationPermission = "prompt";
      t.locationOutcome = "denied";
    }
  });
  await openAsVisitor(page, RANGES_ARCHIVE);
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Allow location", { timeout: 10000 });
  await button.click();
  await expect(button).toHaveText("Start the tour");
  await button.click();
  await expect(button).toHaveText("Allow location");
  await expect(page.getByTestId("ar-hint")).toContainText(/browser will ask/i);
  await button.click();
  await expect(button).toHaveText("Start the tour");
  await button.click();
  await expect(button).toHaveText("Exit AR");
  const fakes = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      locationRequests: t.locationRequests,
      gpsWatch: t.gpsCallback !== null,
    };
  });
  expect(fakes).toEqual({ locationRequests: 2, gpsWatch: false });
});

test("a visitor who allowed location but gets no fix starts AR with location (M2 review #1, M1b-1 review #1)", async ({
  page,
}) => {
  // Why this matters: indoors the permission is fine and the fix is not.
  // The framework's requester fetches a fix and answered granted: null, so
  // enable() failed on every tap ("AR could not start") - worse off than a
  // visitor who declined. The permission, not a fix, must start AR.
  await page.addInitScript(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    if (t) {
      t.locationPermission = "prompt";
      t.locationOutcome = "unavailable";
      t.controllerLocationResult = { supported: true, granted: null };
    }
  });
  await openAsVisitor(page, RANGES_ARCHIVE);
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Allow location", { timeout: 10000 });
  await button.click();
  await expect(button).toHaveText("Start the tour");
  // A benign note above the button, not the red alert (UI round 1, U1).
  await expect(page.getByTestId("ar-hint")).toContainText(/no gps fix yet/i);
  await expect(page.getByTestId("error")).toBeEmpty();
  await button.click();
  await expect(button).toHaveText("Exit AR");
});

test("a first-time visitor is asked for the location on its own tap, then starts the tour on the next (DEC-N2)", async ({
  page,
}) => {
  // Why this test matters (plan review #12): a WebXR session needs a user
  // activation and the framework awaits the geolocation prompt before
  // initAR, so a visitor answering the prompt would spend the activation.
  // The gate makes the first tap a location-only request.
  await page.addInitScript(() => {
    // Runs after the fakes' init script: the permission reads "prompt".
    const t = /** @type {any} */ (window).__tourViewerTest;
    if (t) t.locationPermission = "prompt";
  });
  await openAsVisitor(page, RANGES_ARCHIVE);
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Allow location", { timeout: 10000 });
  // The request is answered on the next microtask, so the in-progress
  // label is observable only through its trace in the button's history:
  // the fake resolves at once. Assert the settled state and the count.
  await button.click();
  await expect(button).toHaveText("Start the tour");
  const state = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return { requests: t.locationRequests, initAR: t.initARCalls.length };
  });
  expect(state).toEqual({ requests: 1, initAR: 0 }); // no session yet
  await button.click();
  await expect(button).toHaveText("Exit AR");
});

test("visitor mode boots to running: session started, alignment bound, capture at 8 Hz", async ({
  page,
}) => {
  await openAsVisitor(page, RANGES_ARCHIVE);
  await expect(page.getByTestId("enter-ar")).toHaveText("Start the tour");
  await expect(page.getByTestId("ar-hint")).toBeVisible();
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");
  // `#ar-root` is the DOM overlay: the start-screen hint must not sit over
  // the camera feed for the whole session (milestone review, 2026-09-05).
  await expect(page.getByTestId("ar-hint")).toBeHidden();

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
  // with the M2 isolation flags: camera + texture ON, and for an unrecorded
  // VISITOR depth OFF. A visitor does not request hit-test (only the
  // creator's reticle needs it), and hands initAR no depth callback: that
  // is every creator entry's (the mesh cursor, unless ?mesh=0) and a
  // recorded entry's (at the recording's 16 x 16 / 1 Hz).
  expect(wiring.initAR).toEqual([
    {
      hasCameraFrame: true,
      hasDepth: false,
      requestHitTest: false,
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
  await openAsVisitor(page, RANGES_ARCHIVE, { debug: true });
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(3);
  });
  // containText, not exact: the viewer QR pipeline appends its own status
  // segment to the same line once frames start flowing (M4).
  await expect(page.getByTestId("ar-status")).toContainText(
    "Visitor mode — AR running · 3 camera frames",
  );
});

test("creator mode (the plain page) boots the same foundation under its own labels", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");
  await enterAr(page);
  // A creator's one way out of AR (polish round M3, Q-Done).
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  await expect(page.getByTestId("ar-status")).toContainText("Creator mode");

  const wiring = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      initARCount: t.initARCalls.length,
      requestHitTest: t.initARCalls[0]?.requestHitTest,
      capture: t.captureCalls,
      isRecording: t.alignmentStore?.getState().recording.isRecording,
    };
  });
  // QD-5/delta #7: the foundation is IDENTICAL — same capture cadence, same
  // live recording slice; only labels differ until M3/M4 diverge.
  expect(wiring.initARCount).toBe(1);
  // The creator's session requests hit-test: the reticle needs the feature.
  expect(wiring.requestHitTest).toBe(true);
  expect(wiring.capture).toEqual([{ intervalMs: 125 }]);
  expect(wiring.isRecording).toBe(true);
});

test("Exit AR ends the visitor's session from the button (UI round 1, U2)", async ({
  page,
}) => {
  // Why this matters (usability review F2): the button used to sit
  // disabled as "Tour running" over the camera; a visitor who was done had
  // to guess at the back gesture.
  await openAsVisitor(page, RANGES_ARCHIVE);
  await enterAr(page);
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Exit AR");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveText("Start the tour");
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
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");
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
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
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

test("the creator measures the code, finishes, and downloads a rebuilt zip that carries the level and tour.json", async ({
  page,
  request,
}) => {
  // Why this matters (QR-pose plan M3): this drives the COMPOSED author
  // pipeline — scripted device detect/solve, but the REAL tracking
  // controller, the real qrDetected slice + stability gate, the real
  // alignment solve fed through the store and the real serializer - and
  // asserts the rebuilt zip carries a parseable level with a geo pose and
  // tour.json. Frame-exactness is pinned by the unit tests; this proves the
  // pieces are actually wired to each other.
  //
  // The hosted fixture already STORES this code's pose, so this is the
  // re-measure of a hosted tour: the stored level is kept (D10b). The first
  // measurement of a code - the mint conversion and the settle's re-mint
  // reaching the zip - is the next test's.
  await page.goto("/");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  // F11: the AR controls belong to the AR session. With step 4 open but no
  // session running they must NOT be on the page - on a desktop they were a
  // row of greyed-out buttons under "AR not supported". The status line is
  // the part that stays, because a refused entry explains itself there.
  await openMeasureStep(page);
  await expect(page.getByTestId("setup-controls")).toBeHidden();
  await expect(page.getByTestId("setup-finish")).toBeHidden();
  // And the readout says nothing rather than telling someone at a desk to
  // "hold the phone on the printed code so it fills the screen".
  await expect(page.getByTestId("setup-status")).toHaveText("");
  await enterAr(page);
  await expect(page.getByTestId("setup-controls")).toBeVisible();
  // In a session the AR button's Done is the way out (polish round M3);
  // the panel's Finish steps aside.
  await expect(page.getByTestId("setup-finish")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  await expect(page.getByTestId("setup-status")).toHaveText(
    /hold the phone on the printed code/i,
  );

  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  // One frame per poll tick: detects are async and coalesced, so a burst
  // would collapse into one observation. Stability needs ≥5.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/waiting for GPS alignment/i);
  // Nothing is measured before the gate opens: Finish stays off.
  await expect(page.getByTestId("setup-finish")).toBeDisabled();
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
  await expect(page.getByTestId("setup-status")).toHaveText(/0 of 3 fixes/i);
  await expect(page.getByTestId("setup-finish")).toBeDisabled();

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
  // Measured on its own once the gate opens (UI round 1, U3).
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code measured/i,
    { timeout: 10000 },
  );

  // The hosted zip already stores this code's pose, so the new measurement
  // does NOT replace it: the stored pose stays the reference and the
  // measurement only lines this visit up with it (authoring plan
  // 2026-09-28-0953 D10b, M2c review #5). The panel says so and the finish
  // button unlocks.
  await expect(page.getByTestId("setup-status")).toContainText(
    /saved position kept/i,
  );
  await expect(page.getByTestId("setup-status")).not.toContainText(/replaces/i);
  await expect(page.getByTestId("setup-finish")).toBeEnabled();

  // PLACE CONTENT (guided-setup plan M4, DEC-N9): a pin at the reticle
  // with a typed label, then a photo of the current frame. The reticle
  // fake sits on a surface at a known NUE position; the encoder fake
  // yields a 3-byte "JPEG". Both records land in tour.json, the photo's
  // bytes as content/<id>.jpg.
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
  // A cancelled pin leaves nothing behind (M4 review, minor).
  await page.getByTestId("setup-pin").click();
  await expect(page.getByTestId("pin-label")).toBeVisible();
  await page.getByTestId("pin-cancel").click();
  await expect(page.getByTestId("pin-label")).toBeHidden();
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("The old gate");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );
  // The outcome survives the store's dispatches (M4 review #3): frames and
  // a fix re-render the readout, and used to erase it within a frame.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(3);
  });
  await seedAlignment(page);
  await expect(page.getByTestId("setup-status")).toContainText(
    /Pin "The old gate" placed/,
  );
  // A frame must have flowed for the photo button; the poll above emitted
  // several.
  await expect(page.getByTestId("setup-photo")).toBeEnabled();
  // The photo uses a frame at most 1 s old (photo-frame.ts); on a phone one
  // arrives every 125 ms, so emit a fresh one as the device would.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
  });
  await page.getByTestId("setup-photo").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /2 objects placed/,
  );
  // No surface under the reticle: the pin is refused with a reason.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.reticleVisible = false;
  });
  await page.getByTestId("setup-pin").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /point the phone at a surface/i,
  );

  // FINISH (guided-setup plan M3, DEC-N6): the zip is rebuilt in the
  // browser from the session's bytes, the AR session ends, and the Finish
  // SAVES it by itself at the END of step 4 (field test 2, F4; owner
  // decision D-F4a: a save behind a button was missed). The button left
  // saves it again (D-F4b). The save that did not go through first
  // (async-UI rule: the failure branch).
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.saveOutcome = false;
  });
  await tapFinish(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating", {
    timeout: 15000,
  });
  // The Finish lands on step 6, the completion step (polish round M2, B9).
  await expect(page.getByTestId("step-done")).toHaveAttribute("open", "");
  await expect(page.getByTestId("step-measure")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.getByTestId("done-pending")).toBeHidden();
  await expect(page.getByTestId("finish-block")).toBeVisible();
  await expect(page.getByTestId("finish-status")).toContainText(/not saved/i);
  // The replace instructions wait for a file to actually exist.
  await expect(page.getByTestId("replace-help")).toBeHidden();
  const download = page.getByTestId("finish-download");
  await expect(download).toBeEnabled();
  await expect(download).toHaveText("Save the tour zip again");
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.saveOutcome = true;
  });
  await download.click();
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);
  await expect(page.getByTestId("replace-help")).toBeVisible();
  // Always the plain save, never the share sheet (D-F4b).
  expect(
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourViewerTest.downloads
        .slice(-2)
        .map((/** @type {{ seam: string }} */ d) => d.seam),
    ),
  ).toEqual(["download", "download"]);
  // A tour NOT on Drive keeps the other hosts' text; the Drive steps are
  // for Drive only (Drive replace plan §3 M3, milestone review #2).
  await expect(page.getByTestId("replace-help-generic")).toBeVisible();
  await expect(page.getByTestId("replace-help-drive")).toBeHidden();

  const rebuilt = await readDownloadedZip(page, 1);
  expect(rebuilt.filename).toBe("tour.zip");
  const names = Object.keys(rebuilt.entries).sort();
  // Every carried entry is BYTE-IDENTICAL to the hosted fixture (the plan's
  // M3 verification clause): images, session.json, padding.bin.
  const hosted = await zipEntries(
    new Uint8Array(await (await request.get(RANGES_ARCHIVE)).body()),
  );
  // The stored level is carried too (D10b): the re-measure kept it.
  const carried = Object.keys(hosted).filter((n) => n !== "tour.json");
  expect(carried.length).toBeGreaterThanOrEqual(11); // 8 images + 3
  for (const name of carried) {
    expect(rebuilt.entries[name], name).toEqual(hosted[name]);
  }
  expect(names).toContain("tour.json");
  // ONE level: the fixture's, BYTE FOR BYTE (above) - its 0.2 m size and
  // geo, and no mintQuality, because nothing re-minted it. Neither the
  // tap nor the Finish-time settle may rewrite a stored pose through this
  // visit's GPS; the hosted notes are expressed in its frame.
  const levelNames = names.filter((n) => n.startsWith("qr/"));
  expect(levelNames).toEqual([`qr/${await qrCodeId(E2E_QR_TEXT)}.json`]);
  const level = parseQrLevel(JSON.parse(rebuilt.entries[levelNames[0]]));
  expect(level.qr.physicalSizeM).toBe(0.2);
  expect(level.qr.geo).toMatchObject({
    lat: 47.5001,
    lon: 8.7001,
    alt: 400,
    // The fixture's stored facing (archive-server.mjs), kept as hosted.
    rotation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
  });
  expect(level.qr.mintQuality).toBeUndefined();
  // The pin the hosted zip already carried SURVIVES the rebuild - the
  // whole reason the manifest is loaded at open (M3 review #5/#7).
  const manifest = parseTourManifest(JSON.parse(rebuilt.entries["tour.json"]));
  // The fixture's own pin SURVIVES the rebuild (M3 review #5/#7), and the
  // two objects placed above are appended after it.
  expect(manifest.objects).toHaveLength(3);
  expect(manifest.objects[0]?.id).toBe("fixturepin01");
  const [, pin, photo] = manifest.objects;
  expect(pin?.kind).toBe("pin");
  expect(pin?.kind === "pin" ? pin.label : null).toBe("The old gate");
  // The pin keeps its place RELATIVE TO THE CODE (D10b): the visit settles
  // through its alignment corrected rigidly onto the code's stored pose.
  // The reticle (3 m north, 2 m west of the zero, altitude 400.5 - GPS-world
  // y IS altitude) is 1 m below the code as this visit measured it
  // (odometry y 1.5 on the seeded alignment's 400 m datum: 401.5) and
  // hypot(1, 3) m from it horizontally, so the pin sits that far from the
  // STORED code (47.5001, 8.7001, 400). Distances, not directions: the
  // fixture stores the facing the fakes measure (archive-server.mjs), so the
  // correction moves the visit without turning it; the frame math of a
  // turned correction is pinned in visit-settle.test.ts. Without the
  // correction the pin would be ~12.5 m from the code, at altitude 400.5.
  const metresPerDegLat = 111_195.08; // mean Earth radius, degrees to m
  const metresPerDegLon = metresPerDegLat * Math.cos((47.5001 * Math.PI) / 180);
  expect(pin?.geo.alt).toBeCloseTo(399, 6);
  expect(
    Math.hypot(
      ((pin?.geo.lat ?? 0) - 47.5001) * metresPerDegLat,
      ((pin?.geo.lon ?? 0) - 8.7001) * metresPerDegLon,
    ),
  ).toBeCloseTo(Math.hypot(1, 3), 1);
  expect(photo?.kind).toBe("photo");
  if (photo?.kind === "photo") {
    expect(photo.image).toBe(`content/${photo.id}.jpg`);
    expect(photo.imageWidth).toBe(2); // the fakes' 2×2 frames
    // The encoder fake's bytes rode through the rebuild untouched.
    expect(Array.from(rebuilt.entries[photo.image])).toEqual([255, 216, 255]);
  }
  // The reticle was torn down with the session.
  expect(
    await page.evaluate(
      () => /** @type {any} */ (window).__tourViewerTest.reticleDisposals,
    ),
  ).toBeGreaterThan(0);
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
  // origins. The snapshot makes the count session-relative. (The finish
  // above already ended the session.)
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/0 of 3 fixes/i);
  // Placement waits for THIS session's alignment too (M4 review #2): the
  // level survived the session end, the fixes did not.
  await expect(page.getByTestId("setup-pin")).toBeDisabled();
  await expect(page.getByTestId("setup-photo")).toBeDisabled();

  // A SECOND finish in the same open tour keeps the first one's objects
  // (PR #435 review): finishing ends the AR session but does not close the
  // tour, and the in-memory manifest used to stay at its pre-finish value,
  // so batch two rebuilt from it and batch one vanished from tour.json
  // along with its photo bytes.
  await seedAlignment(page);
  // The code in hand is stored now: this visit only sees it (U3).
  // The surface came back (the no-surface case above turned it off).
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.reticleVisible = true;
  });
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("The second visit");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );
  await tapFinish(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating", {
    timeout: 15000,
  });
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);

  const second = await readDownloadedZip(page, 2);
  const secondManifest = parseTourManifest(
    JSON.parse(second.entries["tour.json"]),
  );
  // The fixture's pin, batch one's pin and photo, batch two's pin.
  expect(secondManifest.objects.map((o) => o.kind)).toEqual([
    "pin",
    "pin",
    "photo",
    "pin",
  ]);
  const labels = secondManifest.objects.flatMap((o) =>
    o.kind === "pin" ? [o.label] : [],
  );
  expect(labels).toEqual(["Fixture pin", "The old gate", "The second visit"]);
  // Batch one's photo bytes are still in the archive, not just its record.
  const keptPhoto = secondManifest.objects.find((o) => o.kind === "photo");
  expect(
    Array.from(
      second.entries[keptPhoto?.kind === "photo" ? keptPhoto.image : ""],
    ),
  ).toEqual([255, 216, 255]);
});

/** A hosted tour with images only: no tour.json and no stored code, so a
 *  code measured into it is a FIRST measurement (D10b keeps nothing). */
const PLAIN_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/plain-tour.zip";

test("a first measurement of a code the tour does not store is minted into the rebuilt zip, and re-minted by the Finish", async ({
  page,
}) => {
  // Why this matters (QR-pose plan M3; authoring plan 2026-09-28-0953 M2c):
  // the previous test's tour already stores its code, so since D10b its
  // measurement keeps that pose and never reaches the mint. Creating a
  // tour's FIRST code is the main authoring path, and this is the only
  // place its composed pipeline is proven: the real mint conversion, the
  // Finish-time settle that re-mints the code from the whole visit's
  // alignment, and the serializer, down to the zip's bytes. A code of
  // another tour measured into the open one is a reference for it (scan-
  // to-open plan §13), so the fixture's code works for the plain tour.
  await page.goto("/");
  await page.getByTestId("link-input").fill(PLAIN_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await enterAr(page);
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/waiting for GPS alignment/i);
  // Three fixes before the tap (ids distinct from `seedAlignment`'s, which
  // adds three more after it).
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
            id: `first-${String(i)}`,
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
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code measured/,
    {
      timeout: 10000,
    },
  );
  // Nothing stored, nothing kept: the measurement IS the code's position.
  await expect(page.getByTestId("setup-status")).toContainText(
    // In AR the next move names Done (polish round M3, Q-Done).
    /Position saved\. Place pins and photos; Done saves the tour/,
  );
  await expect(page.getByTestId("setup-status")).not.toContainText(
    /kept|replaces/i,
  );
  await seedAlignment(page);
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("First code's pin");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  await tapFinish(page);
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);

  const rebuilt = await readDownloadedZip(page, 0);
  const names = Object.keys(rebuilt.entries);
  const levelNames = names.filter((n) => n.startsWith("qr/"));
  expect(levelNames).toEqual([`qr/${await qrCodeId(E2E_QR_TEXT)}.json`]);
  const level = parseQrLevel(JSON.parse(rebuilt.entries[levelNames[0]]));
  // 0.18 - the default since polish round M0b, the largest whole
  // centimetre the print PDF fits on A4 and Letter.
  expect(level.qr.physicalSizeM).toBeCloseTo(0.18, 9);
  expect(level.qr.geo?.lat).toEqual(expect.any(Number));
  expect(level.qr.geo?.rotation).toHaveLength(4);
  // The quality block records the alignment the stored geo CAME FROM
  // (milestone review #7) - M5's error attribution reads these. Since the
  // authoring settle (M2c) that is the Finish-time re-mint, not the tap:
  // the 3 fixes solved in at the measurement (automatic since U3) plus the 3 seeded after
  // it, i.e. 6 (visit-settle.ts.md, "Why the block describes the
  // SETTLE"). 3 would mean the tap's level reached the zip unsettled.
  expect(level.qr.mintQuality?.alignmentSampleCount).toBe(6);
  expect(level.qr.mintQuality?.gpsAccuracyM).toBe(5);
  const manifest = parseTourManifest(JSON.parse(rebuilt.entries["tour.json"]));
  expect(
    manifest.objects.map((o) => (o.kind === "pin" ? o.label : o.kind)),
  ).toEqual(["First code's pin"]);
});

/**
 * Point the fake camera at another code and feed frames until the page has
 * measured it. The status line already reads "Code measured" for the code
 * before, so waiting for that text alone would pass at once: the line must
 * first leave it (the new code is measured from scratch) and then come back.
 */
async function measureAnotherCode(page, text, position) {
  await page.evaluate(
    ({ text, position }) => {
      /** @type {any} */ (window).__tourViewerTest.armQrDetection(
        text,
        position,
      );
    },
    { text, position },
  );
  const statusAfterFrame = async () => {
    await page.evaluate(() => {
      /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
    });
    return page.getByTestId("setup-status").textContent();
  };
  await expect
    .poll(statusAfterFrame, { timeout: 15000 })
    .not.toMatch(/Code measured/);
  await expect
    .poll(statusAfterFrame, { timeout: 15000 })
    .toMatch(/Code measured/);
}

/** Metres between two stored codes' geo (equirectangular; ample at 20 m). */
function geoDistanceM(a, b) {
  const r = 6371008.8;
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dn = (b.lat - a.lat) * (Math.PI / 180) * r;
  const de = (b.lon - a.lon) * (Math.PI / 180) * r * Math.cos(lat);
  return Math.hypot(dn, de);
}

test("two new codes 20 m apart, measured in one visit, both reach the zip with one Finish (code book plan M4e)", async ({
  page,
}) => {
  // Two measurements, two pins, a Finish and the zip read back: longer
  // than the 30 s default allows on a loaded machine (the first run of
  // this test reached the saved zip and timed out reading it).
  test.setTimeout(90_000);
  // Why this matters (code book refactor plan, D1/D5): before the code
  // book, a Finish wrote ONE code, and a second code in the same visit was
  // refused with "Finish first". Now every code seen while a tour is open
  // is measured and kept, and one Finish writes all of them. The unit tests
  // prove the book, the settle and the zip writer apart; only the composed
  // page shows that the second code does not replace the first on its way
  // to the downloaded zip.
  await page.goto("/");
  await page.getByTestId("link-input").fill(PLAIN_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await enterAr(page);
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/waiting for GPS alignment/i);
  await seedAlignment(page);
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code measured/,
    { timeout: 10000 },
  );
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Pin at the first code");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  // The second code, 20 m east of the first ([1, 1.5, -2] by default; x is
  // east in the fakes' world).
  await measureAnotherCode(page, E2E_QR_UNKNOWN_TEXT, [21, 1.5, -2]);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Pin at the second code");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /2 objects placed/,
  );

  await tapFinish(page);
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);

  const rebuilt = await readDownloadedZip(page, 0);
  const first = `qr/${await qrCodeId(E2E_QR_TEXT)}.json`;
  const second = `qr/${await qrCodeId(E2E_QR_UNKNOWN_TEXT)}.json`;
  const levelNames = Object.keys(rebuilt.entries).filter((n) =>
    n.startsWith("qr/"),
  );
  expect(levelNames.sort()).toEqual([first, second].sort());
  const geoOf = (name) => {
    const geo = parseQrLevel(JSON.parse(rebuilt.entries[name])).qr.geo;
    if (geo == null) throw new Error(`${name} has no geo`);
    return geo;
  };
  // Each code keeps ITS OWN pose: 20 m apart, as measured. One pose written
  // under both names would read 0 m.
  expect(geoDistanceM(geoOf(first), geoOf(second))).toBeCloseTo(20, 0);
  const manifest = parseTourManifest(JSON.parse(rebuilt.entries["tour.json"]));
  expect(
    manifest.objects.map((o) => (o.kind === "pin" ? o.label : o.kind)).sort(),
  ).toEqual(["Pin at the first code", "Pin at the second code"]);
  // The summary after Finish names both codes: it listed only the code in
  // hand and the hosted ones, so the first code was missing (M4e).
  await expect(
    page.getByTestId("summary").getByTestId("summary-code"),
  ).toHaveCount(2);
});

test("a later visit adds a new code beside a stored one; the stored code's level is kept byte for byte (code book plan M4e)", async ({
  page,
}) => {
  // Two measurements, two pins, a Finish and the zip read back: longer
  // than the 30 s default allows on a loaded machine (the first run of
  // this test reached the saved zip and timed out reading it).
  test.setTimeout(90_000);
  // Why this matters (code book plan, D5): a creator who prints a second
  // code for a tour that already stores one measures the stored code (its
  // pose is kept, D10b) and then the new one. The Finish must write the
  // new code AND leave the stored one exactly as hosted - a re-write would
  // silently move every note placed against it.
  await openFixtureTour(page);
  await enterArAndMeasure(page);
  await measureAnotherCode(page, E2E_QR_UNKNOWN_TEXT, [21, 1.5, -2]);

  await tapFinish(page);
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);

  const rebuilt = await readDownloadedZip(page, 0);
  const hosted = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }, E2E_QR_ARCHIVE);
  const hostedEntries = await zipEntries(new Uint8Array(hosted));
  const stored = await e2eQrLevelEntryName();
  const added = `qr/${await qrCodeId(E2E_QR_UNKNOWN_TEXT)}.json`;
  expect(Object.keys(hostedEntries)).not.toContain(added);
  expect(rebuilt.entries[stored]).toBe(hostedEntries[stored]);
  const level = parseQrLevel(JSON.parse(rebuilt.entries[added]));
  expect(level.qr.geo?.lat).toEqual(expect.any(Number));
});

test("the creator's AR visit first asks for the tour's code, and stops asking once the code is seen (authoring plan 2026-09-28-0953 §3.2a, D5)", async ({
  page,
}) => {
  // Why this matters: a later visit's notes are corrected through the code
  // only when the code was seen in that visit (D10b), and the owner chose a
  // hint over a rule - so the hint is the only thing that tells the author
  // to look at the code first. Composed here with the real pipeline: the
  // hint must go away through a real stable fused pose and the async
  // identity hash, not a test's shortcut.
  await page.goto("/");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await enterAr(page);
  await expect(page.getByTestId("setup-status")).toHaveText(
    /^First, point the camera at this tour's printed code:/,
  );
  // It asks; it does not block (D5): the readout is there beside it.
  await expect(page.getByTestId("setup-status")).toHaveText(
    /hold the phone on the printed code/i,
  );
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/Pose stable/);
  // The code's identity is a hash that lands a moment later; then the hint
  // goes, with nothing else to do.
  await expect(page.getByTestId("setup-status")).not.toHaveText(
    /First, point the camera/,
  );
});

test("a failed finish says so with priority and can be retried; the panel shows the rebuild's progress meanwhile", async ({
  page,
}) => {
  // Why this matters (M3 review #1/#3): the measuring readout re-renders on
  // every store dispatch; it used to erase the failure reason on the very
  // next one, and the Finish button's busy flag was inverted.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await enterAr(page);
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/waiting for GPS alignment/i);
  await seedAlignment(page);
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code measured/i,
    { timeout: 10000 },
  );
  // Something to write, so Done runs a finish (polish round M3 review
  // #4: a visit that changed nothing just leaves).
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Kept through a failure");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  // The size note tells the creator what the rebuild will copy.
  await expect(page.getByTestId("setup-status")).toContainText(/MB/);

  // Every archive read fails from now on: the finish must fail loudly.
  await page.route("http://127.0.0.1:5197/**", (route) => route.abort());
  await tapFinish(page);
  await expect(page.getByTestId("setup-status")).toContainText(
    /finishing failed/i,
    { timeout: 30000 },
  );
  // A store dispatch (a frame, a fix) must NOT erase the reason.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(2);
  });
  await seedAlignment(page);
  await expect(page.getByTestId("setup-status")).toContainText(
    /finishing failed/i,
  );
  // The panel's Finish is back as the retry, and the AR button only
  // leaves now, so a finish that keeps failing cannot trap the creator.
  await expect(page.getByTestId("setup-finish")).toBeEnabled();
  await expect(page.getByTestId("enter-ar")).toHaveText("Close AR"); // the session survived

  // Retry with the network back: progress, then step 5.
  await page.unroute("http://127.0.0.1:5197/**");
  await tapFinish(page);
  await expect(page.getByTestId("setup-finish")).toBeDisabled();
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("finish-download")).toBeEnabled();
});

test("a recording-carrying tour places photos at CAPTURE SPOTS, not the ring", async ({
  page,
}) => {
  // Why this matters (geo-join plan Rev 2 §4 — the plan's own verification
  // clause): the fake tour gains a REAL action stream (era-5 session.json,
  // a zero, four consistent GPS↔odom pairs that solve a translation
  // alignment, two captures after the zero), and the COMPOSED viewer loop
  // must run the whole join — gates → chunked replay → decode → placement —
  // and say so in the status line. The ring wording must NOT appear: a
  // silent decline that still shows a ring is exactly the failure the
  // taxonomy exists to make visible.
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/recording-tour.zip";
  await openAsVisitor(page, ARCHIVE, { debug: true });

  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");

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

  // Guided-setup plan M5 (DEC-N3): the tour carries a measured code, so
  // NOTHING is placed until it locks - not even with tracking ready. The
  // gate's line stands alone (no coaching hint: "walk around" would
  // contradict "stay at the code").
  await forceTrackingReady(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(2);
  });
  await expect(page.getByTestId("ar-status")).toContainText(
    "Point the phone at the tour's code",
  );
  await expect(page.getByTestId("ar-status")).not.toContainText(
    /capture spots|slowly look around|hold steady/,
  );
  expect(
    await page.evaluate(
      () =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.length,
    ),
  ).toBe(0);
  await lockTheCode(page);
  // Once locked, the ready trigger places the photos at their capture spots.
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
    .toMatch(/photos at capture spots \(4 fixes/);
  await expect(page.getByTestId("ar-status")).not.toContainText("photo ring");

  // Further locks AFTER the placement refine the alignment under the
  // planes - they do not place a second time (review #4/#5).
  const planesBefore = await page.evaluate(
    () =>
      /** @type {any} */ (window).__tourViewerTest.fakeScene.children.length,
  );
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
    .toMatch(/Relocaliz/);
  await expect(page.getByTestId("ar-status")).toContainText("capture spots");
  const planesAfter = await page.evaluate(
    () =>
      /** @type {any} */ (window).__tourViewerTest.fakeScene.children.length,
  );
  expect(planesAfter).toBe(planesBefore);
});

test("a tour whose photo spots were baked at its Finish places them without any recording (scan-pass S1)", async ({
  page,
}) => {
  // Why this matters (scan-pass plan S1, S-D11): a published tour carries
  // its photos' spots in tour.json and no walk at all, so the viewer must
  // place from the baked spots - never replay the walk the copy kept for
  // a co-author - and report the BAKED quality (7 fixes; the walk has
  // none).
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/baked-tour.zip";
  await openAsVisitor(page, ARCHIVE, { debug: true });
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.alignmentStore.dispatch({
      type: "gpsData/setZeroPos",
      payload: { lat: 47.5, lon: 8.7 },
    });
  });
  await forceTrackingReady(page);
  await lockTheCode(page);
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
    .toMatch(/2 photos at capture spots \(7 fixes/);
  await expect(page.getByTestId("ar-status")).not.toContainText("photo ring");
  // A visitor's page decodes no photo for its hidden gallery at all
  // (follow-up F14), so the walk's frame is not read either.
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(0);
});

/** Force the tracking-quality slice to `ok` (→ onboarding `ready`). The
 *  fake initAR never dispatches poses, and `reportUpdated` is the slice's
 *  own action (not a middleware input), so it is not recomputed away. */
async function forceTrackingReady(page) {
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.alignmentStore.dispatch({
      type: "trackingQuality/reportUpdated",
      payload: {
        state: "ok",
        confidence: 0.9,
        subScores: {
          convergence: 1,
          residualConsensus: 1,
          gpsAccuracy: 1,
          coverage: 1,
        },
        diagnostics: {},
      },
    });
  });
}

test("a tour with no recording and no printed codes says so, instead of scanning", async ({
  page,
}) => {
  // Why this matters (feedback F3): the reporter's zip could not carry a
  // code, and the old line promised one forever.
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/plain-tour.zip";
  await openAsVisitor(page, ARCHIVE, { debug: true });
  await enterAr(page);
  await forceTrackingReady(page);
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
    .toMatch(/nothing to place/);
  await expect(page.getByTestId("ar-status")).not.toContainText("Scanning");
  // No measured code: the gate is waived and placing is by GPS - the
  // escape never appears, even after the clock (M5, DEC-N4). The gate's
  // line is the ONE "no code" line (M5 review #12).
  await expect(page.getByTestId("ar-status")).toContainText(
    "no measured code - placing by GPS",
  );
  await expect(page.getByTestId("ar-status")).not.toContainText(
    "no printed codes.",
  );
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.fireTimers();
  });
  await expect(page.getByTestId("scan-escape")).toBeHidden();
});

test("the visitor's content and ring wait for the lock; the escape after its clock places by GPS instead (M5, DEC-N3)", async ({
  page,
}) => {
  // Why this matters: the mandatory scan is the demo's claim. Before the
  // lock nothing stands in the scene; after it the tour.json pin is placed
  // and the ring follows the vote. A second visitor never locks: the clock
  // (fired by the fake, no frames needed) offers the escape, which places
  // by GPS and says so.
  await openAsVisitor(page, RANGES_ARCHIVE, { debug: true });
  await enterAr(page);
  await seedAlignment(page);
  await forceTrackingReady(page);
  await expect(page.getByTestId("ar-status")).toContainText(
    "Point the phone at the tour's code",
  );
  await expect(page.getByTestId("scan-escape")).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.length,
    ),
  ).toBe(0);
  await lockTheCode(page);
  await expect(page.getByTestId("ar-status")).toContainText("1 placed object");
  // The ring follows the VOTE (a few more frames past the lock).
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
    .toMatch(/photos in a ring/);
  expect(
    await page.evaluate(
      () =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.length,
    ),
  ).toBeGreaterThan(1);
  // The escape clock was cancelled by the lock: firing it changes nothing.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.fireTimers();
  });
  await expect(page.getByTestId("scan-escape")).toBeHidden();

  // A fresh session that never locks: the clock offers the escape.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start the tour");
  await enterAr(page);
  await seedAlignment(page);
  await expect(page.getByTestId("scan-escape")).toBeHidden();
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.fireTimers();
  });
  await expect(page.getByTestId("scan-escape")).toBeVisible();
  await expect(page.getByTestId("ar-status")).toContainText("GPS only");
  await page.getByTestId("scan-escape").click();
  await expect(page.getByTestId("scan-escape")).toBeHidden();
  await expect(page.getByTestId("ar-status")).toContainText(
    "Placing by GPS (less accurate)",
  );
  await expect(page.getByTestId("ar-status")).toContainText("1 placed object");
});

for (const viewport of [
  { width: 412, height: 915 },
  // S1's sideways layout: the animation beside the words (M4 review #8).
  { width: 915, height: 412 },
]) {
  test(`the visitor's scan card sits mid-screen on ${viewport.width}x${viewport.height}, offers the skip at the bottom after its clock, and closes on the lock (polish round M4b)`, async ({
    page,
  }) => {
    // Why this matters: the owner chose S1 (D-P5) - a card in the middle of
    // the camera view while the gate waits for the code, the skip at the
    // bottom after 10 s, the card gone by itself once the code is read. A
    // card off-centre, a skip below the edge of a DOM overlay (where nothing
    // scrolls), or a card left over the scene would each break it, and only
    // a browser sees them.
    await page.setViewportSize(viewport);
    await openAsVisitor(page, RANGES_ARCHIVE);
    await enterAr(page);
    await seedAlignment(page);
    await forceTrackingReady(page);
    const card = page.getByTestId("scan-card");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("scan-card-line")).toHaveText(
      "Point your phone at the tour's code (on the poster).",
    );
    // The line at the top steps aside while the card says it.
    await expect(page.getByTestId("ar-status")).toBeHidden();
    const box = await page.getByTestId("scan-card-panel").boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(
      1,
    );
    const middle = (box.y + box.height / 2) / viewport.height;
    expect(middle).toBeGreaterThan(0.35);
    expect(middle).toBeLessThan(0.55);
    // The skip waits for its clock, then sits at the bottom, on screen.
    const skip = page.getByTestId("scan-escape");
    await expect(skip).toBeHidden();
    await page.evaluate(() => {
      /** @type {any} */ (window).__tourViewerTest.fireTimers();
    });
    await expect(skip).toBeVisible();
    const skipBox = await skip.boundingBox();
    expect(skipBox).not.toBeNull();
    expect(skipBox.y + skipBox.height).toBeLessThanOrEqual(viewport.height);
    expect(skipBox.y).toBeGreaterThan(box.y + box.height);
    expect(
      Math.abs(skipBox.x + skipBox.width / 2 - viewport.width / 2),
    ).toBeLessThan(1);
    // The code is read: the card closes by itself, the line comes back.
    await lockTheCode(page);
    await expect(card).toBeHidden();
    await expect(page.getByTestId("ar-status")).toBeVisible();
  });
}

test("a visitor reads one plain sentence per state, never the debug readout (UI round 1, U1)", async ({
  page,
}) => {
  // Why this matters (usability review F1, F15): the visitor's status line
  // used to be a debug readout - a frame counter, "vote batches", "Pose
  // error px". Without ?debug=1 a visitor now reads one sentence per
  // state, and the line's data-state names the state for the page.
  await openAsVisitor(page, RANGES_ARCHIVE);
  await enterAr(page);
  await seedAlignment(page);
  await forceTrackingReady(page);
  const status = page.getByTestId("ar-status");
  await expect(status).toHaveAttribute("data-state", "scan");
  await expect(status).toHaveText(
    "Point your phone at the tour's code (on the poster).",
  );
  await lockTheCode(page);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        // The fakes send frames but no poses, so tracking quality decays to
        // "lost", which the placed line now reports (U1 milestone review
        // #7); a real session keeps reporting. Re-assert it is fine.
        await forceTrackingReady(page);
        return status.getAttribute("data-state");
      },
      { timeout: 20000 },
    )
    .toBe("placed");
  await expect(status).toHaveText("Tour placed. Look around.");
  // The screen reader's copy says the same, once.
  await expect(page.getByTestId("ar-status-live")).toHaveText(
    "Tour placed. Look around.",
  );
  for (const word of [
    "camera frames",
    "vote batch",
    "Pose error",
    "Visitor mode",
  ]) {
    await expect(status).not.toContainText(word);
  }
});

test("a visitor's plain line says when a tour has nothing to show, and when GPS placed it (U1 milestone review #2, #4)", async ({
  page,
}) => {
  // Why this matters: the first plain line read "Placing the tour…"
  // forever on a tour with no recording and no codes (the F3 case, now
  // without ?debug=1), and the GPS escape needs its own honest sentence.
  await openAsVisitor(page, PLAIN_ARCHIVE);
  await enterAr(page);
  await seedAlignment(page);
  await forceTrackingReady(page);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("ar-status").getAttribute("data-state");
      },
      { timeout: 20000 },
    )
    .toBe("nothing");
  await expect(page.getByTestId("ar-status")).toHaveText(
    "This tour has nothing to show here.",
  );

  // A tour with a code, the visitor taking the GPS escape.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await openAsVisitor(page, RANGES_ARCHIVE);
  await enterAr(page);
  await seedAlignment(page);
  await forceTrackingReady(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.fireTimers();
  });
  await page.getByTestId("scan-escape").click();
  await expect(page.getByTestId("ar-status")).toHaveAttribute(
    "data-gate",
    "passed-skipped",
  );
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("ar-status").getAttribute("data-state");
      },
      { timeout: 20000 },
    )
    .toBe("placed-gps");
  await expect(page.getByTestId("ar-status")).toContainText(
    "Tour placed by GPS (less exact).",
  );
});

test("without a QR detector the photos still land at capture spots (review #2)", async ({
  page,
}) => {
  // The join's old liveness guard was `qrController === null`, which is the
  // permanent state on a browser without BarcodeDetector - every decoded
  // photo was thrown away. Liveness is the controller status now.
  await page.addInitScript(() => {
    const seams = /** @type {any} */ (window).__tourViewerSeams;
    seams.createQrFrontEnd = () => null;
  });
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/recording-tour.zip";
  await openAsVisitor(page, ARCHIVE, { debug: true });
  await enterAr(page);
  await seedAlignment(page);
  await forceTrackingReady(page);
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
    .toMatch(/photos at capture spots/);
});

test("a re-entered session places the tour again once ITS tracking is ready (review #12)", async ({
  page,
}) => {
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/recording-tour.zip";
  await openAsVisitor(page, ARCHIVE, { debug: true });
  for (const entry of [1, 2]) {
    await enterAr(page);
    await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");
    await seedAlignment(page);
    // Each session has its own gate: the code locks anew (M5).
    await lockTheCode(page);
    await forceTrackingReady(page);
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
      .toMatch(/photos at capture spots/);
    const planes = await page.evaluate(
      () =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.length,
    );
    expect(planes, `entry ${String(entry)}`).toBeGreaterThan(0);
    await page.evaluate(() => {
      /** @type {any} */ (window).__tourViewerTest.endXrSession();
    });
    await expect(page.getByTestId("enter-ar")).toHaveText("Start the tour");
    // The session end disposes the planes; the next entry places anew.
    const afterEnd = await page.evaluate(
      () =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.length,
    );
    expect(afterEnd).toBe(0);
  }
});

test("viewer mode relocalizes against the tour's level: budgeted votes, marker, image ring", async ({
  page,
}) => {
  // Why this matters (QR-pose plan M4): the COMPOSED viewer loop — the
  // the zip-carried level resolved for the DETECTED code, the REAL vote
  // builder writing budgeted synthetic GPS events into the real store, and
  // the visible payoff (glue marker + the tour's images ringed around the
  // anchor). The budget is the guardrail: without it every locked frame
  // votes and a lingering visitor pins the alignment centroid.
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
  // three REFUSES a child that is not an Object3D, leaving only this
  // console error, so a pin label that never reached the scene graph left
  // no other trace (the e2e label fake was a plain object until 2026-10-03).
  const refusedAdds = /** @type {string[]} */ ([]);
  page.on("console", (message) => {
    if (message.text().includes("THREE.Object3D.add")) {
      refusedAdds.push(message.text());
    }
  });
  await openAsVisitor(page, ARCHIVE, { debug: true });

  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");

  // The session zero + a few real fixes (the alignment the votes refine).
  await seedAlignment(page);
  // Tracking reports ready BEFORE any code locks - and the gate (M5) holds
  // everything back: the line asks for the code, nothing is placed.
  await forceTrackingReady(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(2);
  });
  await expect(page.getByTestId("ar-status")).toContainText(
    "Point the phone at the tour's code",
  );
  expect(
    await page.evaluate(
      () =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.length,
    ),
  ).toBe(0);

  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
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
    .toMatch(/the code holds the placement/i);

  const afterBudget = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return {
      gpsCount:
        t.alignmentStore.getState().gpsData.gpsEvents.gpsPositions.length,
      markerUpdates: t.qrDebugUpdates,
      planes: t.fakeScene.children.length,
      pinLabels: t.fakeScene.children
        .flatMap((/** @type {any} */ c) => (c.isGroup ? c.children : []))
        .filter((/** @type {any} */ o) => o.isSprite === true).length,
    };
  });
  // 3 seeded fixes + 10 vote batches × 16 correspondences (the 30 m ring,
  // authoring plan M2b; 16 per lock since owner decision D13) = 163.
  expect(afterBudget.gpsCount).toBe(163);
  expect(afterBudget.markerUpdates).toBeGreaterThan(0);
  // The image ring (3 planes), placed once, plus the group of the tour.json
  // content placed after the lock (M5)...
  expect(afterBudget.planes).toBe(4);
  // ...which really holds the fixture pin's label sprite: a label three
  // refused still counted in the placement but was never drawn.
  expect(afterBudget.pinLabels).toBe(1);
  expect(refusedAdds).toEqual([]);

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
    .toBe(163);
});

test("a scanned code with no level reads as unknown instead of flapping", async ({
  page,
}) => {
  // The deferred negative cache (delta #8): a rejecting fetch would flap
  // the controller error↔scanning at the detection cadence; the placeholder
  // resolves once and the visitor gets a plain answer. A launch whose
  // archive is gone still boots VISITOR mode (the mode is the parameter's
  // presence), which is the "no tour open" visitor state.
  // ?debug=1: the line naming the code by its id is the author's readout
  // (a visitor reads "This code isn't part of this tour", U1).
  await page.goto(
    "/?qr=http%3A%2F%2F127.0.0.1%3A5197%2Fnope%2Fgone.zip&debug=1",
  );
  await expect(page.getByTestId("error")).toContainText("does not exist", {
    timeout: 15000,
  });
  await enterAr(page);
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_UNKNOWN_TEXT);
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
    // The readout names the code by its OWN identity - the hash of the
    // exact printed text - so an author can match the message to a poster
    // and to the file name they need to add.
    .toMatch(
      new RegExp(
        `code ${await qrCodeId(E2E_QR_UNKNOWN_TEXT)} has no level`,
        "i",
      ),
    );
});

test("the print panel draws one tile per poster at the declared size, and prints by PDF only", async ({
  page,
}) => {
  // Why this matters (owner request 2026-08-26; reshaped by polish round
  // M0b): the printed artifact is expensive to redo. This drives the real
  // URL builder and the real QR renderer: typing a link draws a tile per
  // poster (no Generate button, A13), the info line carries the range, the
  // size and the 100 % instruction, and the full launch URL is shown. The
  // panel is usable BEFORE any tour is open (DEC-F2).
  await page.goto("/");
  await expect(page.getByTestId("print-url")).toBeHidden();
  await page.getByTestId("station-print").click();
  await page
    .getByTestId("print-url")
    .fill("https://www.dropbox.com/scl/fi/abc/tour.zip?rlkey=k&dl=0");
  await page.getByTestId("print-url").press("Tab");

  // Three posters by default (P7), one tile each.
  await expect(page.getByTestId("print-tile")).toHaveCount(3);
  const drawn = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="print-canvas"]');
    return canvas instanceof HTMLCanvasElement
      ? { width: canvas.width, blank: canvas.toDataURL().length < 200 }
      : null;
  });
  expect(drawn?.width).toBeGreaterThan(0);
  expect(drawn?.blank).toBe(false);
  await expect(page.getByTestId("print-info")).toContainText("Codes 1 to 3");
  // 18 cm: the default, the largest whole centimetre the PDF fits on A4.
  await expect(page.getByTestId("print-info")).toContainText("18cm");
  await expect(page.getByTestId("print-info")).not.toContainText("Too large");
  // The 100 % instruction is the step's one line of copy since the r820
  // feedback (M0c review, finding 6b).
  await expect(
    page.getByTestId("print-panel").locator(".step-copy").first(),
  ).toContainText("100 %");
  // Each tile is a small poster (polish round D-P7): the default text
  // around its code.
  await expect(page.getByTestId("print-tile").first()).toContainText(
    "AR tour starts here",
  );
  await expect(page.getByTestId("print-tile").first()).toContainText(
    "Scan with Chrome on Android",
  );
  // The defaults sit behind "Settings" (r820 feedback R7).
  await expect(page.getByTestId("author-size")).toBeHidden();
  await page.getByTestId("print-settings").locator("summary").click();
  // BARE host (ZD-9): the landing forward carries ?qr= to the viewer, so
  // printed codes never spend payload bits on a path.
  await expect(page.getByTestId("print-url-out")).toContainText(
    "https://gps.csutil.com/?qr=",
  );
  // PDF only (A10): no print button, no Generate button.
  await expect(page.getByTestId("print-button")).toHaveCount(0);
  await expect(page.getByTestId("print-generate")).toHaveCount(0);

  // An oversized size says so in the same line, with the size that fits.
  await page.getByTestId("author-size").fill("30");
  await page.getByTestId("author-size").press("Tab");
  await expect(page.getByTestId("print-info")).toContainText(
    "Too large for A4",
  );
  await page.getByTestId("author-size").fill("18");
  await page.getByTestId("author-size").press("Tab");

  // One poster: one tile, named by its number.
  await page.getByTestId("print-count").fill("1");
  await page.getByTestId("print-count").press("Tab");
  await expect(page.getByTestId("print-tile")).toHaveCount(1);
  await expect(page.getByTestId("print-info")).toContainText("Code 1,");

  // Failure path (async-UI rule): a bad URL surfaces in the panel.
  await page.getByTestId("print-url").fill("not a url");
  await page.getByTestId("print-url").press("Tab");
  await expect(page.getByTestId("print-info")).toContainText(/http/i);
});

test("opening a tour shows the code and the link it carries, without asking again", async ({
  page,
}) => {
  // Why this matters (feedback F2, flows plan M3; reshaped by the second
  // testing session's F7): after Open, the creator's next step is printing
  // the code. The panel presents itself with the opened link - and since F7
  // it does NOT present a second field asking for that link again: the
  // field is replaced by the link as text, and the code renders without
  // anyone pressing a button.
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
  await page.goto("/");
  await expect(page.getByTestId("print-url")).toBeHidden();
  await page.getByTestId("link-input").fill(ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  // F7: shown, not asked for.
  await expect(page.getByTestId("print-url-shown")).toHaveText(ARCHIVE);
  await expect(page.getByTestId("print-url-ask")).toBeHidden();
  // Step 2 collapsed, step 3 open (wizard.ts): one step at a time.
  await expect(page.getByTestId("step-link")).not.toHaveAttribute("open", "");
  // "Show the code immediately" (F7): no Generate click here.
  await expect(page.getByTestId("print-canvas")).toBeVisible();
  await expect(page.getByTestId("print-tile")).toHaveCount(3);
  // The tester's way into the visitor path (DEC-N1, plan review #13): the
  // link carries the PRINTED payload once a code exists (M2 review #10).
  const link = page.getByTestId("visitor-link");
  await expect(link).toBeVisible();
  const printed = await page.getByTestId("print-url-out").textContent();
  expect(await link.getAttribute("href")).toBe(new URL(printed ?? "").search);
  // A new tab (polish round A17): the same tab threw away the open tour,
  // the code and the step the creator was on - back reset everything.
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  // A SECOND tour replaces what the code carries (PR #434 review): the
  // panel used to re-open showing the previous tour's link, so the printed
  // code launched the wrong tour. The displayed link and the encoded
  // payload must move together.
  const SECOND = "http://127.0.0.1:5197/ranges-ok/plain-tour.zip";
  await page.getByTestId("station-link").click();
  await page.getByTestId("link-input").fill(SECOND);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("print-url-shown")).toHaveText(SECOND, {
    timeout: 15000,
  });
  await expect
    .poll(async () => page.getByTestId("print-url-out").textContent())
    .toContain("plain-tour");

  // Changing the code number re-renders rather than leaving a stale code
  // on screen claiming to be the new one (M3 review #8).
  await page.getByTestId("print-settings").locator("summary").click();
  const beforeNumber = await page.getByTestId("print-url-out").textContent();
  await page.getByTestId("author-c").fill("2");
  await page.getByTestId("author-c").blur();
  await expect
    .poll(async () => page.getByTestId("print-url-out").textContent())
    .not.toBe(beforeNumber);

  // The size field is a creator's print input: NOT frozen by a viewer
  // session (review #17) - it is only captured in author mode.
  await expect(page.getByTestId("author-size")).toBeEnabled();
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

test("the setup remembers the step the creator reached, per hosted link (M6)", async ({
  page,
}) => {
  // Why this matters (guided-setup plan §2.7): a reload after the AR
  // session, or a return from the print dialog, used to land on step 1
  // with the link gone. The reached step is keyed by the hosted url, so a
  // different tour starts at step 2 as before.
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
  await page.goto("/");
  await page.getByTestId("link-input").fill(ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("print-panel")).toHaveAttribute("open", "");
  await page.getByTestId("station-hang").click();
  await expect(page.getByTestId("step-hang")).toHaveAttribute("open", "");
  await expect(page.getByTestId("print-panel")).not.toHaveAttribute("open", "");

  await page.reload();
  await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
  // The last opened link is prefilled (M6 review #2): one tap, not a paste.
  await expect(page.getByTestId("link-input")).toHaveValue(ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("step-hang")).toHaveAttribute("open", "");
  await expect(page.getByTestId("print-panel")).not.toHaveAttribute("open", "");
});

test("a refused AR entry explains itself on the page, with no session to explain it in", async ({
  page,
}) => {
  // Why this matters (M3 review #4): the printed size is validated BEFORE
  // the session starts, so a refusal means no session ever exists. The
  // session-gating that removes the AR controls from the setup page (F11)
  // must therefore not take the status line with it - or the creator gets a
  // Start button that does nothing and no explanation anywhere on the page.
  await page.goto("/");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  // Clearing the size is the real way in: the field ships with a default,
  // and `min` never fires outside a form submit. It sits in the closed
  // "Settings" block (r820 feedback R7), which is closed again afterwards:
  // the refusal has to open it.
  await page.getByTestId("print-settings").evaluate((details) => {
    /** @type {HTMLDetailsElement} */ (details).open = true;
  });
  await page.getByTestId("author-size").fill("");
  await page.getByTestId("print-settings").evaluate((details) => {
    /** @type {HTMLDetailsElement} */ (details).open = false;
  });
  await enterAr(page);
  // toBeVisible FIRST, and this is the point of the test: toHaveText and
  // toContainText read textContent and pass happily for an element inside a
  // collapsed <details>. The first version of this spec did exactly that
  // and would have passed while the message was invisible - the message
  // this whole rule exists to keep on screen (M3 milestone review #2).
  await expect(page.getByTestId("setup-status")).toBeVisible();
  await expect(page.getByTestId("setup-status")).toContainText(
    /side length in centimetres/i,
  );
  // Step 4 is still open - the message lives in it - and step 2, which
  // holds the field to fix, was opened alongside rather than instead.
  await expect(page.getByTestId("step-measure")).toHaveAttribute("open", "");
  await expect(page.getByTestId("print-panel")).toHaveAttribute("open", "");
  await expect(page.getByTestId("author-size")).toBeVisible();
  // Still no session, so still no AR controls.
  await expect(page.getByTestId("setup-controls")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");
});

test("step 4 opens the tour its printed code names, and stays on step 4", async ({
  page,
}) => {
  // Why this matters (scan-to-open plan §2, owner decision): a creator
  // walks to the poster with their phone, which has no tour open - the
  // reached step is remembered per device. The printed code carries the
  // tour's link, so reading it is enough; the paste form it replaced made
  // them send themselves the link first.
  //
  // The trap this pins (M3 review #1): the open runs step 1's path, whose
  // default is "a tour opened, go to step 2" - which would collapse the
  // step holding the AR overlay.
  await page.goto("/");
  await openMeasureStep(page);
  await expect(page.getByTestId("tour-missing")).toHaveCount(0);
  await enterAr(page);
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/Tour: tour.zip/);
  // Still on step 4, and the tour behind the code is the one open.
  await expect(page.getByTestId("step-measure")).toHaveAttribute("open", "");
  // One link of record: step 1's input carries what the code named, and
  // step 2's code is built from the same value.
  await expect(page.getByTestId("link-input")).toHaveValue(E2E_QR_ARCHIVE);
  await expect(page.getByTestId("print-url-shown")).toHaveText(E2E_QR_ARCHIVE);
});

test("a code whose tour cannot be opened says why, and one that names no tour says so", async ({
  page,
}) => {
  // Why this matters (plan §9 #5, #9): the panel is the only thing a
  // creator at the poster can read (the error box is outside the AR
  // overlay). A file not hosted yet is retried while the code stays in
  // view; a code of some other kind is told apart from a broken tour.
  await page.goto("/");
  await enterAr(page);
  const missing = `https://gps.csutil.com/tour/?qr=${encodeURIComponent(
    "http://127.0.0.1:5197/ranges-ok/does-not-exist.zip",
  )}`;
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, missing);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/Could not open the tour: file not found.*in view to try again/);

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(
      "https://menu.example/today",
    );
  });
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/does not point to a tour/);
});

test("the print step builds a real PDF of numbered codes", async ({ page }) => {
  // The test's OWN budget, raised so the per-assertion one below can
  // actually be spent. `playwright.config.js` sets no `timeout` (its two
  // are webServer start-up), so this test runs on the 30 s default - and by
  // the time control reaches the last assertion it has already spent a
  // `goto`, a gallery load, a three-code PDF build and two `evaluate` round
  // trips that pull the PDF bytes back. The real ceiling there was
  // `30 s - elapsed`, which SHRINKS under exactly the load the budget is
  // for. Without this the slow case dies as "Test timeout of 30000ms
  // exceeded" with a screenshot, instead of the expect-level failure that
  // names the missing text - which is the legibility this change is about
  // (PR #452 review).
  // `slow()` rather than a literal: x3 of the 30 s default is 90 s, which
  // clears the sum of the retrying budgets on the path below - 15 + 15 + 5
  // + 20 + 5 + 5 + 5 = 70 s of nominal ceiling, before `goto`, the
  // three-code build, and the two `evaluate` round trips that pull the PDF
  // bytes back. A literal 60 s did NOT clear that sum, so the enclosing
  // timeout would still have bound first and produced exactly the bare
  // screenshot failure this exists to avoid. `slow()` also re-derives
  // itself when a budget on the path changes, and says "known slow" in one
  // word (PR #453 review).
  test.slow();
  // Why this matters (second testing session, §4). The browser's print
  // dialog owns the paper and a "fit to page" toggle that silently
  // rescales, and a rescaled code measures the world wrong without ever
  // failing. This drives the WHOLE path in a browser - the real payload
  // builder once per poster, the real QR encoder, the hand-written PDF
  // writer - and reads the produced bytes back in node.
  //
  // Each poster must carry its OWN payload: two posters with the same
  // printed text are one code as far as the level lookup is concerned, so
  // an author who hung them in two places would get one of the two
  // positions at random.
  await page.goto("/");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await page.getByTestId("print-count").fill("3");
  await page.getByTestId("print-pdf").click();
  await expect(page.getByTestId("print-info")).toContainText(/saved/i, {
    timeout: 15000,
  });
  await expect(page.getByTestId("print-info")).toContainText("codes 1 to 3");

  const saved = await page.evaluate(() => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads;
    return d[d.length - 1].filename;
  });
  expect(saved).toBe("tour-codes-1-to-3-18cm.pdf");

  const pdf = await page.evaluate(async () => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads;
    return Array.from(new Uint8Array(await d[d.length - 1].blob.arrayBuffer()));
  });
  const text = new TextDecoder("latin1").decode(new Uint8Array(pdf));
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  // Three codes at 16 cm: one per page, because two would need 37 cm.
  expect(text).toContain("/Count 3");
  expect(text).toContain("/MediaBox [0 0 595.28 841.89]");
  // No caption line under the codes (owner, on r821); the numbers are
  // the file name's and each code's own (print-panel.wiring.test.ts).
  expect(text).not.toMatch(/\(Code \d+ - /);
  // The poster text around every code (polish round D-P7), defaults.
  expect(text).toContain("(AR tour starts here) Tj");
  // One line under the code (D8: it names the phone a tour needs).
  expect(text).toContain("(Scan with Chrome on Android) Tj");
  // Every page actually carries ink.
  expect((text.match(/ re f/g) ?? []).length).toBeGreaterThan(100);

  // The failure path (async-UI rule): a size no paper can hold says which
  // size would work, and the button comes back.
  await page.getByTestId("print-settings").locator("summary").click();
  await page.getByTestId("author-size").fill("40");
  await page.getByTestId("print-pdf").click();
  // An EXPLICIT budget, because the failure this produced pointed
  // somewhere else entirely. Measured with a mutation observer on this
  // element:
  //
  //   unthrottled   click -> readout +36ms -> refusal +5ms
  //   20x throttled click -> readout +2727ms -> refusal +29ms
  //
  // WHAT THAT DOES AND DOES NOT SHOW (PR #452 review). It establishes the
  // MECHANISM: both messages land, in an order the event sequence fixes,
  // newest wins, and the only thing load changes is how long the pair
  // takes. It does NOT establish that five seconds is too little - 2.8 s at
  // 20x sits inside the default with room to spare, so the gate run that
  // failed was slower than 20x throttling, by how much is unmeasured. The
  // budget below is therefore a MARGIN chosen against an unmeasured worst
  // case, not a number read off the data.
  //
  // `fill()` does not raise `change`; the blur that THIS click causes does,
  // so the size readout is triggered by the click and runs on the same
  // main thread as the PDF build. Both messages always land and the newest
  // claim always wins - the order is fixed by the event sequence, not by
  // timing - so the only thing load changes is how long the pair takes.
  // When that exceeded the default budget, the assertion timed out while
  // the element showed the READOUT, which reads as the wrong message
  // winning rather than as a slow one arriving.
  await expect(page.getByTestId("print-info")).toContainText(
    /does not fit A4/i,
    { timeout: 20000 },
  );
  await expect(page.getByTestId("print-info")).toContainText(/or less/i);
  await expect(page.getByTestId("print-pdf")).toBeEnabled();
  await expect(page.getByTestId("print-pdf")).toHaveText(
    "Download PDF to print",
  );
});

test("a failed open puts the page back to having no tour, not to showing the old one", async ({
  page,
}) => {
  // Why this matters (M3 milestone review #3). Step 2 shows the tour link
  // instead of asking for it, and step 4 stops offering to open a tour -
  // both correct WHILE a tour is open. Nothing used to put either back, so
  // after one successful open the page claimed a tour link for a tour it no
  // longer had, for the rest of its life: printing before hosting became a
  // one-shot per page load, and a creator whose second link failed had no
  // field to correct it in without reloading.
  await page.goto("/");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await expect(page.getByTestId("print-url-shown")).toHaveText(RANGES_ARCHIVE);
  await expect(page.getByTestId("print-url-ask")).toBeHidden();

  // A second link that does not resolve: the tour closes and none opens.
  await page.getByTestId("station-link").click();
  await page
    .getByTestId("link-input")
    .fill("http://127.0.0.1:5197/ranges-ok/nope.zip");
  await page.getByTestId("open-button").click();

  // A link with no file behind it YET is still the creator's link (polish
  // round M2, A16: an own server's link can come before its file): the
  // print step carries it, marked unverified, rather than asking again.
  await expect(page.getByTestId("link-status")).toContainText(
    "Not verified yet",
  );
  // ...and says so alone (PRs #584/#585 reviews).
  await expect(page.getByTestId("error")).toHaveText("");
  await expect(page.getByTestId("print-panel")).toHaveAttribute("open", "");
  await expect(page.getByTestId("print-url-shown")).toHaveText(
    "http://127.0.0.1:5197/ranges-ok/nope.zip - not verified yet",
  );
  await expect(page.getByTestId("print-url-ask")).toBeHidden();
});

test("the PDF button shows it is working, says when nothing was saved, and continues the numbering", async ({
  page,
}) => {
  // Why this matters. The repo's async-UI rule asks for the transitional
  // state to be ASSERTED, on both outcomes, and the PDF build is the
  // slowest thing the panel does - fifty QR encodes on one thread.
  //
  // The numbering half is the sharper point (M4 milestone review #1): the
  // PDF used to number 1..N and ignore the code-number field, so an author
  // who printed code 2 from the page and also downloaded a 3-poster PDF
  // ended up with two sheets carrying byte-identical text. Two posters
  // with the same printed text are ONE code to the level lookup, and
  // hanging them in two places gives one of the two positions at random.
  await page.goto("/");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );

  // The dismissed-picker path first (the async-UI rule's failure branch).
  // The save is HELD open rather than raced: eight QR encodes finish in a
  // few milliseconds, and a test that races them is flaky - which for an
  // async-UI guard is worse than not having one.
  await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.saveOutcome = false;
    t.holdPdfSave = true;
  });
  await page.getByTestId("print-count").fill("8");
  await page.getByTestId("print-pdf").click();
  await expect(page.getByTestId("print-pdf")).toHaveText("Building the PDF…");
  await expect(page.getByTestId("print-pdf")).toBeDisabled();
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.releasePdfSave();
  });
  await expect(page.getByTestId("print-info")).toContainText(/was not saved/i, {
    timeout: 15000,
  });
  await expect(page.getByTestId("print-pdf")).toBeEnabled();
  await expect(page.getByTestId("print-pdf")).toHaveText(
    "Download PDF to print",
  );

  // Now the numbering: a second batch starts where the code number says.
  await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.saveOutcome = true;
    t.holdPdfSave = false;
  });
  await page.getByTestId("print-settings").locator("summary").click();
  await page.getByTestId("author-c").fill("4");
  await page.getByTestId("print-count").fill("2");
  await page.getByTestId("print-pdf").click();
  await expect(page.getByTestId("print-info")).toContainText("codes 4 to 5", {
    timeout: 15000,
  });
  const saved = await page.evaluate(() => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads;
    return d[d.length - 1].filename;
  });
  expect(saved).toBe("tour-codes-4-to-5-18cm.pdf");
  const text = await page.evaluate(async () => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads;
    return new TextDecoder("latin1").decode(
      new Uint8Array(await d[d.length - 1].blob.arrayBuffer()),
    );
  });
  // Three pages' worth of codes would be codes 1-3: two pages means the
  // count, and the numbers inside each code are pinned by
  // print-panel.wiring.test.ts (no caption line since the owner's verdict
  // on r821).
  expect(text).toContain("/Count 2");
});

/** Measure the hung code and unlock placement - the state every authoring
 *  test needs before it can place anything. */
async function measureTheCode(page) {
  await enterAr(page);
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/waiting for GPS alignment/i);
  await seedAlignment(page);
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code measured/,
    {
      timeout: 10000,
    },
  );
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
}

test("a crash does not lose the walk: placed content survives a reload and lands in the zip", async ({
  page,
}) => {
  // THE promise of crash-safe authoring (F13), driven end to end through
  // the composed page and real OPFS.
  //
  // Why it matters: an AR session on a phone can be killed by the OS at any
  // moment - a call, a memory reclaim, an accidental back gesture - and
  // until now everything measured and placed since the last Finish lived in
  // page memory alone. A creator who walked a site for twenty minutes had
  // twenty minutes to lose.
  //
  // The reload here IS the crash: nothing is finished, nothing downloaded,
  // the page simply goes away mid-walk.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("The old gate");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  // The crash.
  await page.reload();
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );

  // OFFERED, not applied: a draft can be days old and can be one the
  // creator believes they discarded. Silent restoration would append
  // content they did not ask for into a zip they are about to publish.
  await openMeasureStep(page);
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("draft-offer-text")).toContainText("1 thing");
  await page.getByTestId("draft-restore").click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();

  // The restored pin is in the same list a live placement fills, so the
  // finish needs no second path - and the measured level came back with it,
  // which is what makes Finish reachable without re-measuring.
  await expect(page.getByTestId("setup-finish")).toBeEnabled({
    timeout: 10000,
  });
  await tapFinish(page);
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);

  const rebuilt = await readDownloadedZip(page, 0);
  const manifest = parseTourManifest(JSON.parse(rebuilt.entries["tour.json"]));
  const labels = manifest.objects.flatMap((o) =>
    o.kind === "pin" ? [o.label] : [],
  );
  // The fixture's own pin, plus the one placed BEFORE the reload.
  expect(labels).toContain("The old gate");
});

test("Done says Saving… while the zip is written, and a tap on it then leaves AR while the save carries on (polish round M3 review #1, #11)", async ({
  page,
}) => {
  // Why: the finish reads the whole hosted zip first, which can take
  // minutes on mobile data; a disabled "Saving…" left only the back
  // gesture. The archive's responses are held from the Done on, so the
  // finish waits exactly as it would on a slow network.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Saved later");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );
  /** @type {() => void} */
  let release = () => undefined;
  const held = new Promise((resolve) => (release = () => resolve(undefined)));
  await page.route("**/ranges-ok/tour.zip", async (route) => {
    await held;
    await route.continue();
  });
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Done");
  await button.click();
  await expect(button).toHaveText("Saving…");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveText("Start creating");
  release();
  // The save carried on after the session ended.
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
});

test("Done on a visit that only measured the stored code leaves AR without writing the tour again (polish round M3 review #4)", async ({
  page,
}) => {
  // Why: codes are measured on sight, and "a session with a code in
  // hand" counted as work - so Done on a visit that changed nothing
  // rebuilt the zip and saved a duplicate file. The stored code measured
  // again is kept (no change); Done then just leaves.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  await expect(page.getByTestId("setup-status")).toContainText(
    /Saved position kept/,
  );
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");
  await expect(page.getByTestId("finish-block")).toBeHidden();
  expect(
    await page.evaluate(
      () => /** @type {any} */ (window).__tourViewerTest.downloads.length,
    ),
  ).toBe(0);
});

test("a session that ends without a Finish keeps the work: the pin is still listed after it and offered after a reload (polish round B7)", async ({
  page,
}) => {
  // Why this matters (polish round B7): the owner left AR with "Exit AR"
  // and read it as "my changes are gone". Every placement is in the draft
  // the moment it is made; this pins what the page shows after a session
  // that ended without a Finish - since polish round M3 the system's end
  // (the back gesture): the creator's own button is Done, which finishes -
  // and that a reload still offers the work.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Kept by the exit");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");
  await expect(page.getByTestId("object-list")).toContainText(
    "Kept by the exit",
  );
  // Back into AR and out again: the pin is still there, beside the
  // fixture's own.
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");
  await expect(page.getByTestId("object-list")).toContainText(
    "Kept by the exit",
  );
  await expect(page.getByTestId("object-list")).toContainText("Fixture pin");

  await page.reload();
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  // The open has to finish first: it opens the remembered step itself, and
  // a summary tap that lands after the helper read the step as closed then
  // closes it again (red three times in a row on CI, PR #580).
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await openMeasureStep(page);
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("draft-offer-text")).toContainText("1 thing");
});

test("a draft is offered again after Not now, and gone after Delete it", async ({
  page,
}) => {
  // Why three buttons and not two (M5 review #4). Declining is not
  // deleting: a mis-tap on "no" must not become the loss this whole feature
  // exists to prevent. And a draft with no way to discard it is one that is
  // offered forever - the app's only escape would be clearing the site's
  // storage.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("A pin to abandon");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  const reopen = async () => {
    await page.reload();
    await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
    await page.getByTestId("open-button").click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-tour-open",
      "settled",
      {
        timeout: 15000,
      },
    );
    await openMeasureStep(page);
  };

  await reopen();
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("draft-dismiss").click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();

  // Still there: "not now" kept it.
  await reopen();
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("draft-discard").click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();

  // Wait for the HOUSEKEEPING to finish, not for the button.
  //
  // This poll no longer guards the reload below: the rejection is committed
  // by the meta write now, so the draft is gone from the next read whether
  // or not these deletes ever ran. What it still covers is that they DO run -
  // the files are reclaimed rather than left in the tour namespace for the
  // life of the origin, which is the half no unit test can observe against a
  // real OPFS directory.
  //
  // The end state is "the meta and nothing else", which no earlier state
  // satisfies: before the tap the namespace also holds the object file.
  await expect
    .poll(
      () =>
        page.evaluate(async (url) => {
          const root = await navigator.storage.getDirectory();
          const drafts = await root.getDirectoryHandle("drafts");
          const dir = await drafts.getDirectoryHandle(
            encodeURIComponent(url.trim()),
          );
          const names = [];
          for await (const name of dir.keys()) {
            if (name.endsWith(".blob")) names.push(name);
          }
          return names.sort().join(",");
        }, RANGES_ARCHIVE),
      { timeout: 10000 },
    )
    .toBe("meta.blob");

  // Gone for good. Waited on a POSITIVE signal rather than a sleep: the
  // repo forbids waitForTimeout, and beyond the rule, hidden-after-a-sleep
  // passes for any reason the offer failed to appear - a store that never
  // opened, a rejection, a slow OPFS. The signal is the open's own success
  // (step 2 shows the link; until scan-to-open it was step 4's paste form
  // hiding, set at the same point). It precedes the manifest settling, so
  // this proves less than "the draft path ran" - a known gap, as before.
  await reopen();
  await expect(page.getByTestId("setup-panel")).toBeAttached();
  await expect(page.getByTestId("print-url-shown")).toHaveText(RANGES_ARCHIVE, {
    timeout: 15000,
  });
  await expect(page.getByTestId("draft-offer")).toBeHidden();
});

test("placing after Delete it is still saved: a discard ends the draft, not the saving", async ({
  page,
}) => {
  // Why this test matters (PR #445 review). Discarding cleared the gate file
  // and never rewrote it, so the store stayed set while `readDraft` - which
  // reads a missing meta as "no draft" - could no longer see anything. Every
  // placement after the tap was unrecoverable, and NOTHING said so, because
  // those writes SUCCEED: the no-persistence notice only fires when a write
  // FAILS. Twice in three rounds the crash-safety feature has been the way
  // work is lost, both times through a fix that looked right.
  //
  // THE ORDER HERE IS THE TEST. A first attempt discarded and then measured
  // again before placing - and passed against the bug, because the mint path
  // writes the meta itself and put the gate file back. What reaches the
  // defect is minting BEFORE the discard: the offer is not modal, so a
  // creator can measure and place while it sits there, and after the tap
  // the code in hand is still set - which is the one state where placement
  // is allowed with no meta on disk.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("From the first session");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  // Second session: the draft is offered, and it is left ON SCREEN while the
  // creator measures and places. That is what keeps the level set across the
  // discard.
  await page.reload();
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await openMeasureStep(page);
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await measureTheCode(page);

  await page.getByTestId("draft-discard").click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();

  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Placed after the discard");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  // The assertion the bug fails: that pin has to survive a crash.
  await page.reload();
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await openMeasureStep(page);
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  // The visibility alone does NOT isolate the pin: `draftIsSpent` is false
  // if EITHER an unhosted object or an unhosted level is present, and the
  // discard's own `recordMeta` writes the level this session minted - so
  // deleting the object write entirely would still show the offer. The TEXT
  // is what proves the placement survived (PR #446 review).
  await expect(page.getByTestId("draft-offer-text")).toContainText(
    /1 thing you placed/,
  );
});

test("a pin placed BEFORE Delete it survives too: the discard rejects the old draft, not this session's work", async ({
  page,
}) => {
  // Why this test matters (PR #447 review). The sibling above covers
  // placements made AFTER the tap. This is the same data loss one tap
  // earlier, and it is worse because nothing on screen changes at all.
  //
  // The draft offer is not modal and placement is not gated on it, so a
  // creator can measure and place while it sits there. `store.clear()`
  // then empties the WHOLE namespace - including the `object:` files just
  // written for this session's pins, which were never part of the draft
  // being rejected - and only the meta is written back. The pins stay in
  // `ctx.placedObjects`, stay on the readout and still reach the finished
  // zip, so the creator sees nothing wrong. A crash before finishing loses
  // them, silently, because the write SUCCEEDED and the no-persistence
  // notice only fires on failure.
  //
  // Third time this feature has been the way work is lost. The assertion
  // that matters is the offer's TEXT: visibility alone is satisfied by the
  // re-recorded measurement.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("From the first session");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  // Second session: leave the offer up, measure, and place BEFORE tapping.
  await page.reload();
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await openMeasureStep(page);
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Placed before the discard");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  await page.getByTestId("draft-discard").click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();

  // The pin is still on screen, and it has to still be on disk.
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );
  // Wait for the FILES, not for round trips. The re-write after the clear is
  // fire-and-forget and the meta is deleted first, so a reload that beats
  // the chain finds no draft at all - and the failure would surface as
  // `draft-offer` never appearing, a timeout pointing at the offer rather
  // than at the race. The two assertions above are already true when first
  // evaluated, so they are not slack; the sibling test only looks stable
  // because four interactions sit in the same place, which is slack rather
  // than synchronisation. This spot has produced exactly this flake before,
  // at about one run in six (PR #443 round, and PR #449 review).
  //
  // Polling the store also makes this assert the durability claim directly
  // instead of inferring it from what the next open happens to show.
  await expect
    .poll(
      () =>
        page.evaluate(async (url) => {
          const root = await navigator.storage.getDirectory();
          const drafts = await root.getDirectoryHandle("drafts");
          const dir = await drafts.getDirectoryHandle(
            encodeURIComponent(url.trim()),
          );
          const names = [];
          // Only the files this app wrote, which is what the store's own
          // `keys()` returns: `keyForFileName` drops anything not ending
          // in `.blob`. Chromium leaves a `<name>.blob.crswap` sibling in
          // the directory while a write is in flight, and this poll races
          // exactly those writes - so a raw listing can hold a name
          // production would never report. Mid-write that only costs a
          // retry; a swap file left behind by an aborted write would make
          // this time out at ten seconds pointing at durability instead of
          // at the leftover (PR #451 review).
          for await (const name of dir.keys()) {
            if (name.endsWith(".blob")) names.push(name);
          }
          return names.sort().join(",");
        }, RANGES_ARCHIVE),
      { timeout: 10000 },
    )
    // The meta plus EXACTLY ONE object, which is the post-re-write state
    // and no other. A COUNT threshold was the first attempt and it waited
    // for nothing: before the tap this namespace already holds three files
    // (the meta the second session's mint rewrote, plus both pins), so
    // `>= 2` passed whether or not the clear had even started - the same
    // slack the comment above argues against, wearing a poll (PR #450
    // review, found independently by both reviewers).
    //
    // This shape is reachable only at the end: `clear` deletes the meta
    // FIRST and `recordMeta` puts it back only after the clear settles, so
    // every intermediate state either has two object files or no meta.
    //
    // Note for anyone copying this: `expect.poll` retries assertion
    // failures but propagates other throws, so a `NotFoundError` from a
    // directory that does not exist yet would fail rather than retry. Safe
    // here because session one has already written the draft;
    // `expect(async () => {}).toPass()` is the form that retries through
    // throws.
    .toMatch(/^meta\.blob,object%3A[^,]+\.blob$/);
  await page.reload();
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await openMeasureStep(page);
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("draft-offer-text")).toContainText(
    /1 thing you placed/,
  );
});

test("a draft accumulates ACROSS finishes: both batches land in the zip", async ({
  page,
}) => {
  // The rule the whole design turns on, and until now the only one with no
  // regression test (M5 review #5, verdict 11).
  //
  // Finishing is not terminal. It merges the placed objects into the
  // in-memory manifest, empties the list, and leaves that batch alive only
  // inside `ctx.rebuiltZip` - a Blob that dies with the page. So a draft
  // reset by each finish would hold only what came AFTER the last download,
  // while the finish itself rebuilds from the HOSTED zip, which never had
  // the earlier batch. The creator would end up with two downloads, each
  // missing the other's content, and nothing on screen saying so.
  //
  // The sequence below is the ordinary continuation of the flow: finish,
  // download, keep working (the upload to the host is a separate manual
  // step that has not happened yet), then crash.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);

  // Batch one.
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Batch one");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );
  await tapFinish(page);
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);

  // Batch two, without ever uploading batch one to the host.
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Batch two");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  // The crash.
  await page.reload();
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  // BOTH batches are still on offer - the hosted zip has neither.
  await expect(page.getByTestId("draft-offer-text")).toContainText("2 things");
  await page.getByTestId("draft-restore").click();

  await expect(page.getByTestId("setup-finish")).toBeEnabled({
    timeout: 10000,
  });
  await tapFinish(page);
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);

  // Index 0, not 1: the reload reset the page, and with it the fake's
  // record of downloads. The draft survived it because OPFS is not page
  // state - which is the whole point.
  const rebuilt = await readDownloadedZip(page, 0);
  const manifest = parseTourManifest(JSON.parse(rebuilt.entries["tour.json"]));
  const labels = manifest.objects.flatMap((o) =>
    o.kind === "pin" ? [o.label] : [],
  );
  expect(labels).toContain("Batch one");
  expect(labels).toContain("Batch two");
  // ...and neither is duplicated: the finish appends by id.
  expect(labels.filter((l) => l === "Batch one")).toHaveLength(1);
});

test("a measurement alone survives a crash - the draft is not deleted for having no pins", async ({
  page,
}) => {
  // M5 review, blocker 2. Measuring is the most expensive thing a creator
  // does: walk to the poster, hold the phone until the pose is stable and
  // GPS has aligned. Mint, then have the tab killed before the first pin,
  // and the draft holds a level and no objects - which the first version
  // judged "spent" and DELETED, sending the creator back to the wall.
  //
  // The tour must store no pose for the code: re-measuring a code the
  // hosted zip already stores keeps that pose (authoring plan
  // 2026-09-28-0953 D10b), so such a draft holds exactly what the hosted
  // zip holds - it IS spent, and nothing is lost by deleting it.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(PLAIN_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  // Nothing placed. The crash.
  await page.reload();
  await page.getByTestId("link-input").fill(PLAIN_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );

  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("draft-offer-text")).toContainText(
    /measured position/i,
  );
  await page.getByTestId("draft-restore").click();
  // The measurement is what makes Finish reachable without walking back.
  await expect(page.getByTestId("setup-finish")).toBeEnabled({
    timeout: 10000,
  });
});

test("the draft offer reveals step 4 rather than hiding inside it", async ({
  page,
}) => {
  // M5 review #8. `#draft-offer` lives inside step 4, and a tour open lands
  // the wizard on the REMEMBERED step - which for a creator who last left
  // off at step 2 is step 2. Un-hiding an element inside a closed
  // disclosure is zero pixels and no signal that unsaved work exists.
  //
  // The other two draft specs open step 4 by hand before asserting, so
  // they would pass whether or not a creator ever saw the offer. This one
  // deliberately does not.
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Somewhere");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  await page.reload();
  // Forget the reached step, so the wizard lands on step 2 the way it does
  // for a creator who has not been here before - or on any device that has
  // not stored one. The DRAFT survives this: it lives in OPFS, not in the
  // step memory, and that separation is exactly what makes this the real
  // case rather than a contrived one.
  await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  // The wizard put the creator on step 2, so step 4 is closed...
  await expect(page.getByTestId("print-panel")).toHaveAttribute("open", "");
  // ...and the offer is visible anyway, without any help from the test.
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("step-measure")).toHaveAttribute("open", "");
});

test("on a device that can share files, the starter button says share and reports sharing", async ({
  page,
}) => {
  // Why this test matters: the label is decided ONCE, while the button is
  // wired, from a capability probe - and a probe that answered wrongly, or
  // a label read from the markup instead of the capability, produces a
  // button whose word describes the opposite of what it does. That is
  // invisible to every other test, because the default headless browser
  // cannot share files and so always takes the download route. This is
  // also the only end-to-end exercise of the share COPY: a real share
  // sheet cannot be opened in CI.
  //
  // The starter zip is the right place for it. It is the file a creator
  // has to get INTO their cloud folder to finish step 1, so on a phone the
  // whole point is handing it to that app rather than dropping it in
  // Downloads - and it needs no AR session to reach.
  await installTourViewerArFakes(page, { shareRoute: true });
  await page.goto("/?nocache=1");
  await page.getByTestId("station-host").click();
  const starter = page.getByTestId("starter-zip");
  await expect(starter).toHaveText(/share the empty starter tour/i);
  await expect(starter).not.toHaveText(/download/i);
  await starter.click();
  await expect(starter).toHaveText(/starter zip shared/i);
  // ...and after the 3 s revert it goes back to the SHARE wording, not the
  // download one. That line was wrong when this was written: the revert
  // used the download label unconditionally, so the button re-labelled
  // itself "download" under a sheet it would open (M2 review #2).
  await expect(starter).toHaveText(/share the empty starter tour/i, {
    timeout: 6000,
  });
});

test("a share that hands nothing over says so, without blaming the creator", async ({
  page,
}) => {
  // The Web Share API reports a cancelled sheet and a failed share as the
  // same error, so the copy cannot claim the creator cancelled - it can
  // only say nothing was shared. Asserted end to end because this is the
  // branch a creator hits by pressing back, which is common and must not
  // look like a bug.
  await installTourViewerArFakes(page, { shareRoute: true });
  await page.goto("/?nocache=1");
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.saveOutcome = false;
  });
  await page.getByTestId("station-host").click();
  const starter = page.getByTestId("starter-zip");
  await starter.click();
  await expect(starter).toHaveText(/not shared/i);
  await expect(starter).not.toHaveText(/cancel/i);
});

/** The Drive-shaped test tour (archive-server.mjs): served on the Drive
 *  proxy's own path, with a file name the link does not carry. */
const DRIVE_ARCHIVE = "http://127.0.0.1:5197/api/drive-proxy?id=e2e-drive";
/** The same, with no file name sent - the fallback. */
const DRIVE_ARCHIVE_UNNAMED =
  "http://127.0.0.1:5197/api/drive-proxy?id=e2e-drive-unnamed";

/** Open `url` in step 1, measure the code and finish; the AR session ends
 *  and the finish block shows the download. */
async function measureAndFinish(page, url) {
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(url);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await measureTheCode(page);
  // Something to write: Done on a visit that changed nothing just leaves
  // (polish round M3 review #4).
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Drive pin");
  await page.getByTestId("pin-save").click();
  await tapFinish(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating", {
    timeout: 15000,
  });
  await expect(page.getByTestId("finish-block")).toBeVisible();
}

test("a Drive tour saves the zip under the Drive file's name, with the Drive steps - even on a phone that could share", async ({
  page,
}) => {
  // Why this matters (Drive replace plan §2): on a phone the only way to put
  // the rebuilt zip in place of a Drive file is the Drive WEBSITE's upload,
  // which needs the zip in Downloads (so: save, never share) and offers
  // "Replace existing file" only for the SAME name - which a Drive link does
  // not carry, so it comes from the host's content-disposition. The fake
  // records WHICH seam ran, so a share here would fail the test (§5 #4).
  await installTourViewerArFakes(page, {
    shareRoute: true,
    saveOutcome: false,
  });
  await measureAndFinish(page, DRIVE_ARCHIVE);
  const download = page.getByTestId("finish-download");
  const status = page.getByTestId("finish-status");
  // The Finish saved by itself (field test 2, F4) - here a save that did
  // not go through: the button stays live to save again and no steps
  // appear (async-UI rule, milestone review #2). The "(1)" name a repeat
  // download gets is checked by the Drive steps after the save.
  await expect(status).toContainText(/not saved/i);
  await expect(download).toBeEnabled();
  await expect(download).toHaveText("Save the tour zip again");
  await expect(page.getByTestId("replace-help-drive")).toBeHidden();
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.saveOutcome = true;
  });
  await download.click();
  await expect(status).toContainText(
    /saved to downloads - check that it is named My tour\.zip/i,
  );
  const saved = await page.evaluate(() => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads;
    return d.map((/** @type {any} */ x) => ({
      seam: x.seam,
      filename: x.filename,
    }));
  });
  expect(saved).toEqual([
    { seam: "download", filename: "My tour.zip" },
    { seam: "download", filename: "My tour.zip" },
  ]);
  // The Drive steps, with the name, in place of the other hosts' text.
  const steps = page.getByTestId("replace-help-drive");
  await expect(steps).toBeVisible();
  await expect(steps).toContainText("My tour.zip");
  await expect(steps).toContainText("Replace existing file");
  await expect(steps).toContainText("Desktop site");
  await expect(page.getByTestId("replace-help-generic")).toBeHidden();
  // The file's Drive address, for the Drive website (polish round M2,
  // step 6): rebuilt from the id the proxy link carries.
  const copy = page.getByTestId("replace-drive-copy");
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(copy).toHaveText(/copied/i);
  expect(
    await page.evaluate(
      () => /** @type {any} */ (window).__tourViewerTest.copied,
    ),
  ).toEqual(["https://drive.google.com/file/d/e2e-drive/view"]);
});

test("a Drive tour whose host sends no name asks the creator to check it", async ({
  page,
}) => {
  // Plan §4: without the header the page can only guess the name from the
  // link (tour.zip) - so the steps say to check the Drive file carries it,
  // instead of risking a silent second copy.
  await measureAndFinish(page, DRIVE_ARCHIVE_UNNAMED);
  await expect(page.getByTestId("finish-status")).toContainText(
    /check that it is named tour\.zip/i,
  );
  await expect(page.getByTestId("replace-help-drive")).toContainText(
    'Check that the file on Drive is named "tour.zip"',
  );
});

test("a delivered Finish asks once whether the file was uploaded, and a yes is noted (F19)", async ({
  page,
}) => {
  // Why (follow-up F19, owner decision 2026-10-14): a page cannot know the
  // creator uploaded the zip it saved, so a pin deleted later on the
  // desktop came back from this phone's draft. The phone asks once, after
  // the save delivered; a yes is noted (the composed walk with the desktop
  // delete is in authoring-settle.test.ts), and saving the same file again
  // asks nothing more.
  await installTourViewerArFakes(page);
  await measureAndFinish(page, RANGES_ARCHIVE);
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);
  const text = page.getByTestId("upload-ask-text");
  await expect(page.getByTestId("upload-ask")).toBeVisible();
  await expect(text).toContainText("Did you upload it?");
  await page.getByTestId("upload-yes").click();
  await expect(text).toContainText("Noted.");
  await expect(page.getByTestId("upload-yes")).toBeHidden();
  await expect(page.getByTestId("upload-no")).toBeHidden();
  await page.getByTestId("finish-download").click();
  await expect(page.getByTestId("finish-download")).toBeEnabled();
  await expect(text).toContainText("Noted.");
  await expect(page.getByTestId("upload-yes")).toBeHidden();
});

test("an opted-in authoring session is recorded across the finish and saved as its own zip, never inside the tour zip", async ({
  page,
}) => {
  // Why this matters (authoring recording plan 2026-09-28-0953, M1a): the
  // owner's troubleshooting loop is "record the authoring, hand over the
  // zip, replay it". This drives the composed page end to end - the real
  // store with the recording's backend and gate, the real OPFS in the
  // browser, the real creator setup dispatching its log actions - and
  // reads the saved zip back in node. Three things it proves no unit test
  // can: the switch, the marker and Save are wired to the recording that
  // runs; the Finish (tapped inside AR, ending it) and the exit's reset
  // after it are in the SAME numbered stream; and the tour zip the creator
  // publishes carries no recording (the visitor's geo join would replay
  // any `actions/` it found there).
  await page.goto("/?nocache=1&debug=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await openMeasureStep(page);
  // Nothing is recorded behind the creator's back: no marker, no Save.
  await expect(page.getByTestId("recording-marker")).toBeHidden();
  await expect(page.getByTestId("recording-save")).toBeHidden();
  // What leaves the phone with the zip is said beside the switch.
  await expect(page.getByTestId("recording-privacy")).toHaveText(
    "The recording holds the tour link, your GPS track and the 3D shape of the surroundings.",
  );
  await page.getByTestId("record-session").check();

  await measureTheCode(page);
  await expect(page.getByTestId("recording-marker")).toHaveText(
    "Recording this session",
  );
  await expect(page.getByTestId("record-session")).toBeDisabled();
  // Depth instead of pictures (decision D4): requested, and sampled at
  // the recording's rate.
  const depth = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    return { init: t.initARCalls.at(-1), capture: t.depthCaptureCalls };
  });
  expect(depth.init.hasDepth).toBe(true);
  expect(depth.init.isolationOptions.enableDepthSensingFeature).toBe(true);
  expect(depth.capture).toEqual([
    { intervalMs: 1000, gridSize: 16, rgb: false },
  ]);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitDepthSample();
  });

  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Recorded gate");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  // The Finish ends the AR session.
  await tapFinish(page);
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");
  expect(
    await page.evaluate(
      () => /** @type {any} */ (window).__tourViewerTest.stopDepthCalls,
    ),
  ).toBe(1);

  // The published tour zip carries no recording: no actions, and the
  // hosted zip's own session.json untouched.
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);
  const tour = await readDownloadedZip(page, 0);
  expect(
    Object.keys(tour.entries).filter((n) => /(^|\/)actions\//.test(n)),
  ).toEqual([]);
  expect(tour.entries["session.json"]).toBe('{"kind":"e2e-tour"}');

  // Save the recording: its own zip, under its own name. It lives in step
  // 5; the Finish lands on step 6 since polish round M2 (B9), so the
  // creator goes back to step 5 for it.
  await page.getByTestId("station-measure").click();
  await expect(page.getByTestId("recording-save")).toBeEnabled();
  await page.getByTestId("recording-save").click();
  await expect(page.getByTestId("recording-status")).toHaveText(
    /^Saved as tour-recording-.+\.zip\.$/,
    { timeout: 15000 },
  );
  await expect(page.getByTestId("recording-save")).toHaveText(
    "Save the recording",
  );
  const rec = await readDownloadedZip(page, 1);
  expect(rec.filename).toMatch(
    /^tour-recording-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}utc\.zip$/,
  );
  const meta = JSON.parse(rec.entries["session.json"]);
  expect(meta.odomCoordVersion).toBe(5);
  expect(meta.contextTag).toBe("tour-authoring");
  // The three seeded fixes, counted from the recording (the store's GPS
  // data was wiped when the finish ended AR).
  expect(meta.actionCount).toBe(3);
  // Stamped with the build that made it (M1a review finding 2): the Vite
  // define block reaches the framework's reader in the page.
  expect(meta.build.commitHash).toMatch(/^([0-9a-f]{7,}|dev)$/);
  expect(meta.build.frameworkVersion).toMatch(/^\d+\.\d+\.\d+/);

  // One numbering, nothing overwritten: 000001 .. N without a gap.
  const names = Object.keys(rec.entries)
    .filter((n) => n.startsWith("actions/"))
    .sort();
  expect(names).toEqual(
    names.map((_, i) => `actions/${String(i + 1).padStart(6, "0")}.json`),
  );
  expect(Object.keys(rec.entries).sort()).toEqual(
    ["session.json", ...names].sort(),
  );
  const actions = names.map((n) => JSON.parse(rec.entries[n]));
  const types = actions.map((a) => a.type);
  expect(types[0]).toBe("recording/startSession");
  expect(types).toContain("tourAuthoring/codeMeasured");
  expect(types).toContain("recording/recordDepthSample");
  expect(types.some((t) => t.startsWith("qrDetected/"))).toBe(true);
  // The depth sample is written packed (scan pass S2): no points, its
  // grid as little-endian float32 in base64url - written by the framework
  // in a real browser (the unit tests run the codec in Node only). The
  // fake sampler's one point is a full 1 x 1 grid at 1.5 m.
  const packed = actions.find((a) => a.type === "recording/recordDepthSample");
  expect(packed.payload.points).toEqual([]);
  expect(packed.payload.grid).toMatchObject({ v: 1, size: 1 });
  expect(
    Buffer.from(packed.payload.grid.depthF32, "base64url").readFloatLE(0),
  ).toBe(1.5);
  const placed = actions.find((a) => a.type === "tourAuthoring/objectPlaced");
  expect(placed.payload.object.label).toBe("Recorded gate");
  // The logged odometry, taken back through the logged group matrix, is
  // the reticle's world position (the fake group follows the alignment).
  const [ox, oy, oz] = placed.payload.reticleOdomNue;
  const g = placed.payload.arWorldGroupMatrix;
  const back = [0, 1, 2].map(
    (i) => g[i] * ox + g[4 + i] * oy + g[8 + i] * oz + g[12 + i],
  );
  expect(back[0]).toBeCloseTo(3, 6);
  expect(back[1]).toBeCloseTo(400.5, 6);
  expect(back[2]).toBeCloseTo(-2, 6);
  // The visit the finish ended was settled first (authoring plan
  // 2026-09-28-0953 M2c), and the settle is in the recording: the zip
  // carries its geo, not the tap's.
  expect(types.indexOf("tourAuthoring/settled")).toBeGreaterThan(
    types.indexOf("tourAuthoring/objectPlaced"),
  );
  const finished = types.indexOf("tourAuthoring/finished");
  expect(finished).toBeGreaterThan(types.indexOf("tourAuthoring/settled"));
  // The exit the finish caused is recorded AFTER it: its endSession and
  // the reset a replay needs to give the next visit its own alignment.
  expect(types.lastIndexOf("recording/endSession")).toBeGreaterThan(finished);
  expect(types.lastIndexOf("gpsData/resetGpsSessionData")).toBeGreaterThan(
    types.lastIndexOf("recording/endSession"),
  );
});

test("the troubleshooting recording is offered to a creator only with ?debug=1 (polish round M3, Q-Data)", async ({
  page,
}) => {
  // Why: "Record this session for troubleshooting" was for the developer
  // (A20); the owner decided it shows only with ?debug=1.
  await page.goto("/?nocache=1");
  await expect(page.getByTestId("record-session")).toBeHidden();
  await page.goto("/?nocache=1&debug=1");
  await expect(page.getByTestId("recording-block")).toBeAttached();
  await expect(page.getByTestId("record-session")).toBeAttached();
  expect(
    await page
      .getByTestId("recording-block")
      .evaluate((el) => /** @type {HTMLElement} */ (el).hidden),
  ).toBe(false);
});

test("a recording whose tab was killed is offered on the next open, saved from its own actions, and not offered again", async ({
  page,
}) => {
  // Why this matters (authoring recording plan 2026-09-28-0953, M1b): the
  // recording of a field session that went wrong is most likely one whose
  // tab the phone killed, and only this offer brings it back. The reload is
  // the kill: nothing was saved, the folder holds the actions alone (no
  // session.json), and the page that held its lock is gone. Proves on the
  // real OPFS and Web Locks what no unit test can: the lock of a dead page
  // is released, the new page finds the folder, rebuilds session.json from
  // the recorded fixes, hands the zip over through the same seam, and the
  // saved marker keeps it from being offered a second time.
  await page.goto("/?nocache=1&debug=1");
  await openMeasureStep(page);
  await expect(page.getByTestId("recording-block")).toHaveAttribute(
    "data-housekeeping",
    "done",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("recording-offer")).toBeHidden();
  await page.getByTestId("record-session").check();
  await enterAr(page);
  await expect(page.getByTestId("recording-marker")).toHaveText(
    "Recording this session",
  );
  await seedAlignment(page);
  await page.evaluate(() =>
    /** @type {any} */ (
      window
    ).__tourViewerTest.alignmentStore.flushPendingActionWrites(),
  );

  // The kill - and the page comes back WITHOUT ?debug=1: the switch is
  // the flag's since polish round M3, but a recording left behind is still
  // offered to the creator (M3 review #8).
  await page.goto("/?nocache=1");

  // Offered without opening step 4 by hand: the offer reveals its step.
  await expect(page.getByTestId("recording-offer")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("recording-offer-text")).toContainText(
    /^The recording from .+ was not saved\. Save it or delete it\?$/,
  );
  // Two taps (M1b review #4): the first prepares the zip, the second hands
  // it over on a fresh user activation.
  await page.getByTestId("recording-offer-save").click();
  await expect(page.getByTestId("recording-offer-save")).toHaveText(
    /^(Share|Download) it$/,
    { timeout: 15000 },
  );
  await expect(page.getByTestId("recording-status")).toHaveText(
    /^Ready: tour-recording-.+\.zip\. Tap (Share|Download) it to save it\.$/,
  );
  await page.getByTestId("recording-offer-save").click();
  await expect(page.getByTestId("recording-status")).toHaveText(
    /^Saved as tour-recording-.+\.zip\.$/,
    { timeout: 15000 },
  );
  await expect(page.getByTestId("recording-offer")).toBeHidden();

  const rec = await readDownloadedZip(page, 0);
  expect(rec.filename).toMatch(
    /^tour-recording-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}utc\.zip$/,
  );
  const meta = JSON.parse(rec.entries["session.json"]);
  expect(meta.odomCoordVersion).toBe(5);
  expect(meta.contextTag).toBe("tour-authoring");
  // The three seeded fixes, counted from the folder's own action files.
  expect(meta.actionCount).toBe(3);
  const types = Object.keys(rec.entries)
    .filter((n) => n.startsWith("actions/"))
    .sort()
    .map((n) => JSON.parse(rec.entries[n]).type);
  expect(types[0]).toBe("recording/startSession");
  expect(types.filter((t) => t === "gpsData/recordGpsEvent")).toHaveLength(3);

  // Saved: the next open offers nothing - asserted after its check ran,
  // or "hidden" would hold before the check had even looked.
  await page.reload();
  await expect(page.getByTestId("recording-block")).toHaveAttribute(
    "data-housekeeping",
    "done",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("recording-offer")).toBeHidden();
});

test("a visitor records only with ?debug=1 and the switch: the scan lock, its votes and the placement land in a tour-viewing zip", async ({
  page,
}) => {
  // Why this matters (authoring recording plan 2026-09-28-0953, M1b): a
  // viewer session that placed the tour wrongly is the other half of the
  // owner's troubleshooting loop. Proves through the composed page: a
  // visitor without ?debug=1 sees no switch at all (nothing changes for
  // visitors); with it, the same switch and privacy line as the creator's,
  // and the recording holds the viewer's own log actions - which lock cast
  // which votes, and what the ring was placed around - tagged tour-viewing
  // for the Recorder's replay.
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
  await openAsVisitor(page, ARCHIVE);
  await expect(page.getByTestId("recording-block")).toBeHidden();
  await expect(page.getByTestId("record-session")).toBeHidden();

  await page.goto(`/?qr=${encodeURIComponent(ARCHIVE)}&debug=1`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  await expect(page.getByTestId("record-session")).toBeVisible();
  await expect(page.getByTestId("recording-privacy")).toHaveText(
    "The recording holds the tour link, your GPS track and the 3D shape of the surroundings.",
  );
  await page.getByTestId("record-session").check();
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");
  await expect(page.getByTestId("recording-marker")).toHaveText(
    "Recording this session",
  );
  // Depth while recording, as the creator's recording (decision D4), and
  // at the recording's rate (r867 review #6): a visitor has no mesh cursor,
  // so this entry's depth is the recording's alone, and the capture call
  // pins that density rather than only that depth was asked for.
  expect(
    await page.evaluate(
      () =>
        /** @type {any} */ (window).__tourViewerTest.initARCalls.at(-1)
          .hasDepth,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourViewerTest.depthCaptureCalls,
      ),
    )
    .toEqual([{ intervalMs: 1000, gridSize: 16, rgb: false }]);

  await seedAlignment(page);
  await forceTrackingReady(page);
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  // Frames until the budget is spent: the votes flowed, and the ring was
  // placed at a voted lock (the relocalization e2e's path). Since M2b the
  // spent-budget line is the code's hold ("Relocalized - the code holds the
  // placement for N s more"), as in the relocalization e2e.
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
    .toMatch(/the code holds the placement/i);
  // The ring (3 planes) and the fixture pin's label.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          /** @type {any} */ (window).__tourViewerTest.fakeScene.children
            .length,
      ),
    )
    .toBe(4);

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("recording-save")).toBeEnabled();
  await page.getByTestId("recording-save").click();
  await expect(page.getByTestId("recording-status")).toHaveText(
    /^Saved as tour-recording-.+\.zip\.$/,
    { timeout: 15000 },
  );
  const rec = await readDownloadedZip(page, 0);
  const meta = JSON.parse(rec.entries["session.json"]);
  expect(meta.odomCoordVersion).toBe(5);
  expect(meta.contextTag).toBe("tour-viewing");
  const actions = Object.keys(rec.entries)
    .filter((n) => n.startsWith("actions/"))
    .sort()
    .map((n) => JSON.parse(rec.entries[n]));
  const types = actions.map((a) => a.type);
  const locked = actions.find((a) => a.type === "tourViewing/codeLocked");
  expect(locked.payload.text).toBe(E2E_QR_TEXT);
  expect(locked.payload.level.geo).toBeDefined();
  const cast = actions.find((a) => a.type === "tourViewing/votesCast");
  expect(cast.payload.text).toBe(E2E_QR_TEXT);
  expect(cast.payload.votes.length).toBeGreaterThan(0);
  // One batch per VOTED lock (the budget's 10), each the lock's full ring.
  // The keep-alive's per-fix rings are deliberately NOT votesCast (they are
  // recorded as stamped GPS events, M2b); no device fix follows the lock
  // here, so none were cast anyway.
  const batches = actions.filter((a) => a.type === "tourViewing/votesCast");
  expect(batches.map((a) => a.payload.votedLocks)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);
  expect(batches.every((a) => a.payload.votes.length === 16)).toBe(true);
  // The keep-alive's hold is in the log (M1b review #5): armed by a voted
  // lock with the code and the pose it re-votes from.
  const armed = actions.find(
    (a) => a.type === "tourViewing/keepAlive" && a.payload.event === "armed",
  );
  expect(armed.payload.text).toBe(E2E_QR_TEXT);
  expect(armed.payload.kept.qrPoseWorld).toBeDefined();
  // The lock is logged before the votes it cast.
  expect(types.indexOf("tourViewing/codeLocked")).toBeLessThan(
    types.indexOf("tourViewing/votesCast"),
  );
  const placed = actions.filter((a) => a.type === "tourViewing/placed");
  expect(placed.map((a) => a.payload.what)).toEqual(
    expect.arrayContaining(["ring", "content"]),
  );
  const ring = placed.find((a) => a.payload.what === "ring");
  expect(ring.payload.basis).toBe("code");
  expect(ring.payload.code.text).toBe(E2E_QR_TEXT);
  expect(types).toContain("gpsData/resetGpsSessionData");
});

test("a code hung far from its saved spot is ignored after a minute of walking: the gate passes, the line says so, the tour follows GPS (D20, M5c)", async ({
  page,
}) => {
  // Why this matters (authoring plan 2026-09-28-0953 §3.6, §7j #4; owner
  // decision 2026-10-02): a poster re-hung 40 m from its saved spot pins the
  // whole tour 40 m off while its votes hold. The viewer must notice it on
  // the visitor's own GPS, take the votes back so the tour follows GPS, and
  // tell the visitor in one plain sentence - never "Relocalized", never
  // "point the phone at the code" for a code it ignores. The fixes travel
  // the page's real GPS path (coordinator, device-fix routing, vote sink).
  //
  // The fixture's code is saved at (47.5001, 8.7001), about 11 m north and
  // 7.5 m east of the zero; it now hangs at 11 m north, 50 m east - 42.5 m
  // away. The odometry is the world frame (north = -z, east = x).
  const degPerMLat = 8.9832e-6;
  const degPerMLon = 1.32966e-5; // at lat 47.5
  const CODE = { n: 11, e: 50 };
  await openAsVisitor(page, RANGES_ARCHIVE, { debug: true });
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");
  const t0 = Date.now();
  /** A device fix at second `s`, on an 8 m circle around the poster. */
  const fix = (s) =>
    page.evaluate(
      ({ s, t0, CODE, degPerMLat, degPerMLon }) => {
        const a = (2 * Math.PI * s) / 30;
        const n = CODE.n + 8 * Math.cos(a);
        const e = CODE.e + 8 * Math.sin(a);
        /** @type {any} */ (window).__tourViewerTest.emitGps({
          lat: 47.5 + n * degPerMLat,
          lon: 8.7 + e * degPerMLon,
          timestamp: t0 + s * 1000,
          arPosition: [e, 1.4, -n],
        });
      },
      { s, t0, CODE, degPerMLat, degPerMLon },
    );
  /** How far the store's alignment puts the device's latest odometry
   *  position from its GPS position (m): the tour follows GPS when ~0. */
  const offFromGps = (s) =>
    page.evaluate(
      ({ s, CODE, degPerMLat, degPerMLon }) => {
        const store = /** @type {any} */ (window).__tourViewerTest
          .alignmentStore;
        const { zero, gpsEvents } = store.getState().gpsData;
        const m = gpsEvents.alignmentMatrix;
        const a = (2 * Math.PI * s) / 30;
        const n = CODE.n + 8 * Math.cos(a);
        const e = CODE.e + 8 * Math.sin(a);
        // Odometry-NUE (n, 1.4, e) through the column-major alignment...
        const wn = m[0] * n + m[4] * 1.4 + m[8] * e + m[12];
        const we = m[2] * n + m[6] * 1.4 + m[10] * e + m[14];
        // ...against the fix in the session NUE, whose zero is the FIRST
        // fix (the handler sets it), not (47.5, 8.7).
        const gn = (47.5 + n * degPerMLat - zero.lat) / degPerMLat;
        const ge = (8.7 + e * degPerMLon - zero.lon) / degPerMLon;
        return Math.hypot(wn - gn, we - ge);
      },
      { s, CODE, degPerMLat, degPerMLon },
    );
  const votesStored = () =>
    page.evaluate(
      () =>
        /** @type {any} */ (window).__tourViewerTest.alignmentStore
          .getState()
          .gpsData.gpsEvents.gpsPositions.filter(
            (p) => p.source === "synthetic-qr",
          ).length,
    );

  // The session zero, then the scan: the code votes and the gate passes.
  await fix(0);
  await page.evaluate(
    ({ text, CODE }) => {
      /** @type {any} */ (window).__tourViewerTest.armQrDetection(text, [
        CODE.e,
        1.5,
        -CODE.n,
      ]);
    },
    { text: E2E_QR_TEXT, CODE },
  );
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
    .toMatch(/the code holds the placement/i);
  await expect(page.getByTestId("ar-status")).toContainText("Code recognised");
  expect(await votesStored()).toBeGreaterThan(0);
  // The detection stops; the visitor walks for a minute.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.nextDetection = null;
  });
  for (let s = 1; s <= 55; s += 1) await fix(s);
  // Still held by the code's votes: the tour sits near the saved spot.
  expect(await offFromGps(55)).toBeGreaterThan(20);
  await expect(page.getByTestId("ar-status")).not.toContainText(
    "seems to have been moved",
  );
  for (let s = 56; s <= 75; s += 1) await fix(s);

  const status = page.getByTestId("ar-status");
  await expect(status).toContainText(
    "This code seems to have been moved, so its position is not used. Showing the tour by GPS.",
  );
  await expect(status).not.toContainText("Relocaliz");
  await expect(status).not.toContainText("Point the phone");
  await expect(status).not.toContainText("Scan the code again");
  await expect(status).toContainText("1 placed object");
  // The votes are gone and the tour follows GPS.
  expect(await votesStored()).toBe(0);
  expect(await offFromGps(75)).toBeLessThan(2);
  // A later lock of the same code changes nothing: no vote.
  await page.evaluate(
    ({ text, CODE }) => {
      /** @type {any} */ (window).__tourViewerTest.armQrDetection(text, [
        CODE.e,
        1.5,
        -CODE.n,
      ]);
      /** @type {any} */ (window).__tourViewerTest.emitFrames(12);
    },
    { text: E2E_QR_TEXT, CODE },
  );
  await fix(76);
  expect(await votesStored()).toBe(0);
  await expect(status).toContainText("seems to have been moved");
});

test("a creator's ring follows a mesh by default: depth at the mesh density, one mesh per session, none with ?mesh=0 (polish round M5)", async ({
  page,
}) => {
  // Why: the mesh cursor is the creator default since the owner tried it
  // on the phone (2026-10-15, mesh-cursor smoothing plan); the e2e scene has no
  // depth to mesh, so this pins the wiring - the depth request, the mesh's
  // life, the ring given its pick - and that with ?mesh=0 nothing of it
  // runs (the hit-test ring alone, as before M5).
  const state = () =>
    page.evaluate(() => {
      const t = /** @type {any} */ (window).__tourViewerTest;
      return {
        depth: t.depthCaptureCalls,
        meshes: t.meshSurfaces,
        disposed: t.meshSurfaceDisposals,
        pick: t.reticleSurfacePick,
      };
    });
  await page.goto("/");
  await openMeasureStep(page);
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  await expect.poll(async () => (await state()).meshes).toBe(1);
  expect(await state()).toMatchObject({
    depth: [{ intervalMs: 200, gridSize: 24 }],
    pick: true,
  });
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start creating");
  expect((await state()).disposed).toBe(1);

  await page.goto("/?mesh=0");
  await openMeasureStep(page);
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  expect(await state()).toMatchObject({ depth: [], meshes: 0, pick: false });

  // The old opt-in links (?mesh=1, from the phone test) keep the mesh on
  // through the composed page, not only in the flag's parser (r867 review
  // #7: the plan's verification named this case).
  await page.goto("/?mesh=1");
  await openMeasureStep(page);
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  await expect.poll(async () => (await state()).meshes).toBe(1);
  expect(await state()).toMatchObject({
    depth: [{ intervalMs: 200, gridSize: 24 }],
    pick: true,
  });
});
