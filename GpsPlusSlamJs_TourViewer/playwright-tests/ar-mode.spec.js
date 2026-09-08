// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";
import { E2E_QR_TEXT, E2E_QR_UNKNOWN_TEXT } from "./qr-fixture.mjs";
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

/** The visitor's way in (DEC-N1): a `?qr=` launch, which opens the tour on
 *  boot and shows the visitor screen instead of the setup. */
async function openAsVisitor(page, url, imageCount = 8) {
  await page.goto(`/?qr=${encodeURIComponent(url)}`);
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(
    imageCount,
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
        return page.getByTestId("ar-status").textContent();
      },
      { timeout: 20000 },
    )
    .toMatch(/Code recognised/);
}

async function enterAr(page) {
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 }); // support probe done
  await button.click();
}

/** The session zero plus three consistent fixes - the alignment a placement
 *  is expressed against (and that the votes refine). */
async function seedAlignment(page) {
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
  await expect(page.getByTestId("step-host")).toHaveAttribute("open", "");
  await expect(page.getByTestId("print-url")).toBeHidden(); // step 2 collapsed
  await expect(page.getByTestId("visitor-screen")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).toHaveText("Start AR setup");

  await openAsVisitor(page, RANGES_ARCHIVE);
  await expect(page.getByTestId("visitor-screen")).toBeVisible();
  await expect(page.getByTestId("visitor-screen")).toContainText("camera");
  await expect(page.getByTestId("wizard")).toBeHidden();
  await expect(page.getByTestId("link-input")).toBeHidden();
  // The transport-demo surfaces are the creator's (M2 review #2): a visitor
  // gets the consent copy, the Start button and one stats line.
  await expect(page.getByTestId("storage-panel")).toBeHidden();
  await expect(page.getByTestId("gallery")).toBeHidden();
  await expect(page.getByTestId("stats")).toBeVisible();
  await expect(page.getByTestId("ar-hint")).toContainText("printed code");
  await expect(page.getByTestId("enter-ar")).toHaveText("Start the tour");
});

test("a visitor who refuses the location stays on 'Allow location' with the settings hint; a granted-but-no-fix visitor may start (M2 review #1)", async ({
  page,
}) => {
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
  await expect(button).toHaveText("Allow location");
  await expect(page.getByTestId("error")).toContainText(/browser settings/i);
  // The same phone, now indoors: the permission is fine, the fix is not.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.locationOutcome =
      "unavailable";
  });
  await button.click();
  await expect(button).toHaveText("Start the tour");
  await expect(page.getByTestId("error")).toContainText(/no gps fix yet/i);
  await button.click();
  await expect(button).toHaveText("Tour running");
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
  await expect(button).toHaveText("Tour running");
});

test("visitor mode boots to running: session started, alignment bound, capture at 8 Hz", async ({
  page,
}) => {
  await openAsVisitor(page, RANGES_ARCHIVE);
  await expect(page.getByTestId("enter-ar")).toHaveText("Start the tour");
  await expect(page.getByTestId("ar-hint")).toBeVisible();
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Tour running");
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
  // with the M2 isolation flags: camera + texture ON, depth OFF. A VISITOR
  // does not request hit-test (only the creator's reticle needs it).
  expect(wiring.initAR).toEqual([
    {
      hasCameraFrame: true,
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
  await openAsVisitor(page, RANGES_ARCHIVE);
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Tour running");

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
  await expect(page.getByTestId("enter-ar")).toHaveText("Start AR setup");
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Setting up in AR");
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
  await expect(page.getByTestId("enter-ar")).toHaveText("Setting up in AR");

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Start AR setup");
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
  await expect(page.getByTestId("enter-ar")).toHaveText("Setting up in AR");
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
  // alignment solve fed through the store, the real mint conversion and the
  // real serializer — and asserts the exported JSON is a parseable level
  // with a geo pose. Frame-exactness is pinned by the unit tests; this
  // proves the pieces are actually wired to each other.
  await page.goto("/");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
  await expect(page.getByTestId("setup-panel")).toBeVisible();
  await expect(page.getByTestId("setup-finish")).toBeDisabled(); // not measured
  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Setting up in AR");
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
  await expect(page.getByTestId("setup-mint")).toBeDisabled();
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
  await expect(page.getByTestId("setup-mint")).toBeDisabled();

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
  await expect(page.getByTestId("setup-status")).toHaveText(
    /save the position/i,
    { timeout: 10000 },
  );

  await page.getByTestId("setup-mint").click();
  // The measured level replaces the fixture's authored one (same printed
  // text) - the panel says so and the finish button unlocks.
  await expect(page.getByTestId("setup-status")).toContainText(/replaces/i);
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
  // browser from the session's bytes, the AR session ends, step 5 opens
  // with the download; the download is a fresh tap (its own gesture).
  await page.getByTestId("setup-finish").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Start AR setup", {
    timeout: 15000,
  });
  await expect(page.getByTestId("step-finish")).toHaveAttribute("open", "");
  await expect(page.getByTestId("finish-status")).toContainText(/ready/i);
  const download = page.getByTestId("finish-download");
  await expect(download).toBeEnabled();
  // The dismissed-picker path first (async-UI rule: the failure branch).
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.saveOutcome = false;
  });
  await download.click();
  await expect(page.getByTestId("finish-status")).toContainText(/not saved/i);
  await expect(download).toBeEnabled();
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.saveOutcome = true;
  });
  await download.click();
  await expect(page.getByTestId("finish-status")).toContainText(/saved as/i);
  await expect(page.getByTestId("step-replace")).toHaveAttribute("open", "");

  const rebuilt = await readDownloadedZip(page, 1);
  expect(rebuilt.filename).toBe("tour.zip");
  const names = Object.keys(rebuilt.entries).sort();
  // Every carried entry is BYTE-IDENTICAL to the hosted fixture (the plan's
  // M3 verification clause): images, session.json, padding.bin.
  const hosted = await zipEntries(
    new Uint8Array(await (await request.get(RANGES_ARCHIVE)).body()),
  );
  const carried = Object.keys(hosted).filter(
    (n) => !n.startsWith("qr/") && n !== "tour.json",
  );
  expect(carried.length).toBeGreaterThanOrEqual(10); // 8 images + 2
  for (const name of carried) {
    expect(rebuilt.entries[name], name).toEqual(hosted[name]);
  }
  expect(names).toContain("tour.json");
  // ONE level (the fixture's, REPLACED - its physicalSizeM was 0.2 and it
  // carried no mintQuality; the minted one is 0.16 with the quality block).
  const levelNames = names.filter((n) => n.startsWith("qr/"));
  expect(levelNames).toEqual([`qr/${await qrCodeId(E2E_QR_TEXT)}.json`]);
  const level = parseQrLevel(JSON.parse(rebuilt.entries[levelNames[0]]));
  // 0.16 — the page-fitting default (PR #364 review; see the print spec).
  expect(level.qr.physicalSizeM).toBeCloseTo(0.16, 9);
  expect(level.qr.geo?.lat).toEqual(expect.any(Number));
  expect(level.qr.geo?.rotation).toHaveLength(4);
  // The quality block records what the alignment looked like at MINT time
  // (milestone review #7) — M5's error attribution reads these.
  expect(level.qr.mintQuality?.alignmentSampleCount).toBe(3);
  expect(level.qr.mintQuality?.gpsAccuracyM).toBe(5);
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
  // The pin sits where the reticle was: 3 m north, 2 m west of the zero,
  // at the reticle's absolute altitude (GPS-world y IS altitude).
  expect(pin?.geo.alt).toBeCloseTo(400.5, 6);
  expect(pin?.geo.lat).toBeGreaterThan(47.5);
  expect(pin?.geo.lon).toBeLessThan(8.7);
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
  await expect(page.getByTestId("enter-ar")).toHaveText("Setting up in AR");
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
  await expect(page.getByTestId("setup-mint")).toBeDisabled();
  // Placement waits for THIS session's alignment too (M4 review #2): the
  // level survived the session end, the fixes did not.
  await expect(page.getByTestId("setup-pin")).toBeDisabled();
  await expect(page.getByTestId("setup-photo")).toBeDisabled();
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
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
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
    /save the position/i,
    { timeout: 10000 },
  );
  await page.getByTestId("setup-mint").click();
  await expect(page.getByTestId("setup-finish")).toBeEnabled();
  // The size note tells the creator what the rebuild will copy.
  await expect(page.getByTestId("setup-status")).toContainText(/MB/);

  // Every archive read fails from now on: the finish must fail loudly.
  await page.route("http://127.0.0.1:5197/**", (route) => route.abort());
  await page.getByTestId("setup-finish").click();
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
  await expect(page.getByTestId("setup-finish")).toBeEnabled();
  await expect(page.getByTestId("enter-ar")).toHaveText("Setting up in AR"); // the session survived

  // Retry with the network back: progress, then step 5.
  await page.unroute("http://127.0.0.1:5197/**");
  await page.getByTestId("setup-finish").click();
  await expect(page.getByTestId("setup-finish")).toBeDisabled();
  await expect(page.getByTestId("step-finish")).toHaveAttribute("open", "", {
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
  await openAsVisitor(page, ARCHIVE, 2);

  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Tour running");

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
    "Point the phone at the printed code",
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
  await openAsVisitor(page, ARCHIVE, 8);
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

test("the visitor's content and ring wait for the lock; the escape after 45 s places by GPS instead (M5, DEC-N3)", async ({
  page,
}) => {
  // Why this matters: the mandatory scan is the demo's claim. Before the
  // lock nothing stands in the scene; after it the tour.json pin is placed
  // and the ring follows the vote. A second visitor never locks: the clock
  // (fired by the fake, no frames needed) offers the escape, which places
  // by GPS and says so.
  await openAsVisitor(page, RANGES_ARCHIVE);
  await enterAr(page);
  await seedAlignment(page);
  await forceTrackingReady(page);
  await expect(page.getByTestId("ar-status")).toContainText(
    "Point the phone at the printed code",
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
  await openAsVisitor(page, ARCHIVE, 2);
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
  await openAsVisitor(page, ARCHIVE, 2);
  for (const entry of [1, 2]) {
    await enterAr(page);
    await expect(page.getByTestId("enter-ar")).toHaveText("Tour running");
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
  await openAsVisitor(page, ARCHIVE, 8);

  await enterAr(page);
  await expect(page.getByTestId("enter-ar")).toHaveText("Tour running");

  // The session zero + a few real fixes (the alignment the votes refine).
  await seedAlignment(page);
  // Tracking reports ready BEFORE any code locks - and the gate (M5) holds
  // everything back: the line asks for the code, nothing is placed.
  await forceTrackingReady(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(2);
  });
  await expect(page.getByTestId("ar-status")).toContainText(
    "Point the phone at the printed code",
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
  // The image ring (3 planes), placed once, plus the fixture pin's label
  // that the tour.json content placed after the lock (M5).
  expect(afterBudget.planes).toBe(4);

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
  // resolves once and the visitor gets a plain answer. A launch whose
  // archive is gone still boots VISITOR mode (the mode is the parameter's
  // presence), which is the "no tour open" visitor state.
  await page.goto("/?qr=http%3A%2F%2F127.0.0.1%3A5197%2Fnope%2Fgone.zip");
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

test("the print panel renders a scannable code at a declared true size", async ({
  page,
}) => {
  // Why this matters (owner request 2026-08-26): the printed artifact is
  // creator step ZERO and expensive to redo. This drives the real measured
  // URL builder and the real QR renderer in a browser: a code appears, the
  // info line carries the version + the physical size + the 100%-scale
  // instruction, and the full launch URL is shown for copying.
  // Since the flows plan M3 (DEC-F2) the panel is on the page for EVERYONE
  // - no ?author=1 - and usable BEFORE any tour is open (the "print first,
  // hang, then author" loop), collapsed until expanded.
  await page.goto("/");
  await expect(page.getByTestId("print-url")).toBeHidden();
  await page.getByTestId("print-panel").locator("summary").click();
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

  // The browser's own print (menu, Ctrl+P) with the panel collapsed used to
  // print a blank page: `beforeprint` opens the panel when a code exists
  // (closing interview 2026-09-08). The event is dispatched by hand because
  // no spec can observe window.print() itself.
  await page.evaluate(() => {
    const details = document.querySelector("details#print-panel");
    if (details instanceof HTMLDetailsElement) details.open = false;
    window.dispatchEvent(new Event("beforeprint"));
  });
  await expect(page.getByTestId("print-canvas")).toBeVisible();

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

test("opening a tour opens the print panel prefilled with the tour's link", async ({
  page,
}) => {
  // Why this matters (feedback F2, flows plan M3): after Open, the creator's
  // next step is printing the code - the first on-phone session could not
  // find it because it sat behind ?author=1. The panel must present itself
  // with the opened link, without clobbering a link the creator typed.
  const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
  await page.goto("/");
  await expect(page.getByTestId("print-url")).toBeHidden();
  await page.getByTestId("link-input").fill(ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
  await expect(page.getByTestId("print-url")).toBeVisible();
  await expect(page.getByTestId("print-url")).toHaveValue(ARCHIVE);
  // Step 1 collapsed, step 2 open (wizard.ts): one step at a time.
  await expect(page.getByTestId("step-host")).not.toHaveAttribute("open", "");
  // The tester's way into the visitor path (DEC-N1, plan review #13): the
  // raw link until a code exists, then the PRINTED payload (M2 review #10).
  const link = page.getByTestId("visitor-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /\?qr=http/);
  await page.getByTestId("print-generate").click();
  await expect(page.getByTestId("print-canvas")).toBeVisible();
  const printed = await page.getByTestId("print-url-out").textContent();
  const href = await link.getAttribute("href");
  expect(href).toBe(new URL(printed ?? "").search);
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
