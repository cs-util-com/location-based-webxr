// @ts-check
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { parseTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { expect } from "@playwright/test";

import { E2E_QR_ARCHIVE, E2E_QR_TEXT } from "./qr-fixture.mjs";
/**
 * Fake device seams for the AR e2e specs (the AnchorStarter/QrTrackingDemo
 * pattern): headless Chromium has no WebXR or camera, so the suite installs
 * `window.__tourViewerSeams` (consulted by `src/seams.ts` in DEV only)
 * BEFORE any page script runs, plus a `window.__tourViewerTest` control
 * surface the specs read back. Nothing here ships: the seam override is
 * statically stripped from production builds.
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ shareRoute?: boolean, printSizeM?: number, saveOutcome?: boolean, pdfViewer?: boolean }} [options]
 *   `pdfViewer`: the browser shows PDFs itself, so the print PDF opens in a
 *   tab (recorded in `pdfTabs`) instead of being downloaded (M0b).
 *   `printSizeM`: what the print-size estimate reports (QR size consensus
 *   plan S3a) - one new independent window per call, so the creator's offer
 *   appears after three detections; absent = the estimate refuses.
 *   `shareRoute` must be set HERE
 *   rather than through `__tourViewerTest` afterwards: the app reads the
 *   share capability once, while wiring its buttons, so a spec that flipped
 *   it after load would get the share copy under a "download" label.
 */
export async function installTourViewerArFakes(page, options = {}) {
  const shareRoute = options.shareRoute === true;
  const printSizeM = options.printSizeM ?? null;
  // The first save's outcome: the Finish saves by itself (field test 2,
  // F4), so a spec that needs it to fail says so before the page loads.
  const saveOutcome = options.saveOutcome ?? true;
  const pdfViewer = options.pdfViewer === true;
  await page.addInitScript(
    ({ shareRoute, printSizeM, saveOutcome, pdfViewer }) => {
      const test = {
        /** @type {{ hasCameraFrame: boolean, isolationOptions: unknown }[]} */
        initARCalls: [],
        /** @type {unknown[]} */
        captureCalls: [],
        /** @type {{ hasStore: boolean, groupName: string | undefined }[]} */
        alignmentCalls: [],
        stopCaptureCalls: 0,
        endARSessionCalls: 0,
        /** The depth sampler of a recorded entry (authoring recording plan
         *  2026-09-28-0953, D4): the configs it was started with, how often
         *  it was stopped, and the initAR depth callback a spec feeds. */
        depthCaptureCalls: /** @type {unknown[]} */ ([]),
        stopDepthCalls: 0,
        depthCallback: /** @type {any} */ (null),
        /** Deliver one fake depth sample through the initAR depth callback. */
        emitDepthSample() {
          test.depthCallback?.({
            timestamp: Date.now(),
            cameraPos: [0, 1.5, 0],
            cameraRot: [0, 0, 0, 1],
            points: [{ screenX: 0.5, screenY: 0.5, depthM: 1.5 }],
          });
        },
        /** The store the alignment binding received — lets specs assert the
         *  recording slice actually started (the silent-drop trap). */
        alignmentStore: /** @type {any} */ (null),
        cameraFrameCallback: /** @type {any} */ (null),
        /** Deliver n fake frames (RGBA + the capture pose, as the framework
         *  pairs them) through the initAR camera callback. */
        emitFrames(n = 1) {
          for (let i = 0; i < n; i += 1) {
            test.cameraFrameCallback?.({
              image: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
              cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              capturedAtMs: Date.now(),
            });
          }
        },
        /** Scripted device-level QR results for the author pipeline (M3). */
        nextDetection: /** @type {any} */ (null),
        nextSolution: /** @type {any} */ (null),
        qrDebugUpdates: 0,
        /** Calls to the fake print-size estimate. */
        printSizeCalls: 0,
        qrDebugDisposals: 0,
        fakeScene: /** @type {any} */ (null),
        /** Arm a consistent detection+solution for the given text/pose. */
        armQrDetection(text, position = [1, 1.5, -2]) {
          test.nextDetection = {
            text,
            corners: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
              { x: 20, y: 20 },
              { x: 10, y: 20 },
            ],
          };
          test.nextSolution = {
            qrPoseWorld: { position, rotation: [0, 0, 0, 1] },
            qrPoseInCamera: { position, rotation: [0, 0, 0, 1] },
            reprojectionErrorPx: 1,
          };
        },
        sessionEndCallback: /** @type {any} */ (null),
        /** The visitor screen's location gate (DEC-N2): what the permission
         *  query answers, and how many location-only taps were made. */
        locationPermission: "granted",
        locationRequests: 0,
        /** How often the controller asked for the location permission
         *  (none in the codes-only mode, QR-first M1b-1). */
        geolocationPermissionRequests: 0,
        /** What the controller's location request answers: a real phone
         *  indoors answers `granted: null` (no fix), M1b-1 review #1. */
        controllerLocationResult: /** @type {any} */ ({
          supported: true,
          granted: true,
        }),
        /** What the next location-only tap comes back with. */
        locationOutcome: "granted",
        /** The zips the finish step offered for download (M3): the fake
         *  captures them instead of saving; `saveOutcome` is what the fake
         *  reports (false = the picker was dismissed). */
        downloads:
          /** @type {{ filename: string, blob: Blob, seam?: "share-or-download" | "download" }[]} */ ([]),
        saveOutcome,
        /** Whether the device could share files. The tour zip is always
         *  saved (field test 2, F4); the starter zip and the recording
         *  still share where they can, and label their buttons so. */
        shareRoute,
        /** What step 6's Drive address button copied (polish round M2). */
        copied: /** @type {string[]} */ ([]),
        /** Whether the browser shows PDFs itself (polish round M0b); the
         *  tabs the PDF was shown in, or closed when its build failed. */
        pdfViewer,
        pdfTabs: /** @type {{ shown?: Blob, closed?: boolean }[]} */ ([]),
        /** Hold downloadPdf open so a test can observe the busy state. */
        holdPdfSave: false,
        releasePdfSave: () => undefined,
        /** The creator's reticle (M4): whether a surface is under it and
         *  where, in GPS-world NUE. */
        reticleVisible: true,
        reticlePosition: [3, 400.5, -2],
        reticleDisposals: 0,
        /** Whether the ring was given a mesh pick (polish round M5). */
        reticleSurfacePick: false,
        /** The mesh surfaces started, and how many were disposed. */
        meshSurfaces: 0,
        meshSurfaceDisposals: 0,
        /** A tap in AR (authoring plan 2026-09-28-0953 M4): the XR select
         *  listener the app handed the reticle, what the fake camera ray
         *  "hits" (an object id, or null), and the ids it was offered. */
        xrSelect: /** @type {null | (() => void)} */ (null),
        pickId: /** @type {string | null} */ (null),
        pickTargets: /** @type {string[]} */ ([]),
        /**
         * Tap the screen in AR, as the runtime does: a tap on a DOM-overlay
         * element first dispatches `beforexrselect` there, and a cancelled
         * one fires NO select. Returns whether the select fired.
         * @param {string} [selector] the overlay element tapped, if any
         */
        tapXr(selector) {
          if (selector !== undefined) {
            const target = document.querySelector(selector);
            const event = new Event("beforexrselect", {
              bubbles: true,
              cancelable: true,
            });
            target?.dispatchEvent(event);
            if (event.defaultPrevented) return false;
          }
          // No target ray: a screen-centre tap, as the driver hands one
          // whose event carried no pose.
          test.xrSelect?.(null);
          return true;
        },
        /** Photos "encoded" by the fake (a 3-byte stand-in per capture). */
        encodedFrames: 0,
        /** The stations' HUD (tour kit plan K4): the targets getter the
         *  page handed the last HUD it started, how many it started, and
         *  whether that one was disposed. */
        hud: /** @type {null | { getTargets: () => any[], disposed: boolean }} */ (
          null
        ),
        hudStarts: 0,
        /** Every source the stories' one audio element was asked to play
         *  (K4), and how many audio elements the page made. */
        audioPlays: /** @type {string[]} */ ([]),
        audioElements: 0,
        /** The AR start (visitor walk W4 build plan M2): hold the next
         *  initAR until `releaseInitAR()` (the coach's "Starting AR…"
         *  stays up), or fail it once (`failNextInitAR`). */
        holdInitAR: false,
        releaseInitAR: () => undefined,
        failNextInitAR: false,
        /** The scan gate's escape clock (M5): armed timers the spec fires. */
        timers:
          /** @type {{ fn: () => void, ms: number, cancelled: boolean }[]} */ ([]),
        fireTimers() {
          for (const t of test.timers.splice(0)) {
            if (!t.cancelled) t.fn();
          }
        },
        /** Simulate a SYSTEM session end (the Android back gesture). */
        endXrSession() {
          test.sessionEndCallback?.({ requestedByApp: false });
        },
        /** The AR pose a device GPS fix is paired with (the `getArPose`
         *  seam): `{ position: {x, y, z}, orientation: {x, y, z, w} }`,
         *  raw WebXR, or null (the handler then drops the fix). */
        arPose: /** @type {any} */ (null),
        /** The camera's orientation every later fix's pose carries (raw
         *  WebXR quaternion; `faceBearing` sets it): the identity looks
         *  along raw -Z. */
        facing: { x: 0, y: 0, z: 0, w: 1 },
        /** The GPS watch the session started (the controller's
         *  `startGpsWatch`), and a fix delivered through it - the page's
         *  own path: coordinator, `recordDeviceFix`, the vote sink. */
        gpsCallback: /** @type {any} */ (null),
        /**
         * Deliver one device fix at `arPosition` (raw WebXR) reading
         * `lat`/`lon`, stamped `timestamp`.
         * @param {{ lat: number, lon: number, accuracy?: number, timestamp: number, arPosition: [number, number, number] }} fix
         */
        emitGps(fix) {
          const [x, y, z] = fix.arPosition;
          test.arPose = {
            position: { x, y, z },
            orientation: { ...test.facing },
          };
          test.gpsCallback?.({
            lat: fix.lat,
            lon: fix.lon,
            altitude: 400,
            accuracy: fix.accuracy ?? 4,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            timestamp: fix.timestamp,
          });
        },
      };
      /** @type {any} */ (window).__tourViewerTest = test;

      /** Keep a recorded entry's depth callback for `emitDepthSample`;
       *  whether the entry asked for depth at all. */
      function keepDepthCallback(callbacks) {
        test.depthCallback = callbacks?.depth?.onCaptured ?? null;
        return test.depthCallback !== null;
      }

      /**
       * The store's alignment right now (16 numbers, column-major), or the
       * identity before there is one. The real world group's matrix IS the
       * alignment (lerped toward it), and since the authoring settle
       * (authoring plan 2026-09-28-0953 M2c) recomputes geo as
       * `alignment · local`, a group that pretended to be the identity
       * under a real alignment would move every settled pin by it.
       */
      function currentAlignment() {
        const m =
          test.alignmentStore?.getState?.().gpsData?.gpsEvents?.alignmentMatrix;
        return m != null && m.length === 16
          ? Array.from(m)
          : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      }
      const worldGroup = {
        name: "fake-world-group",
        children: /** @type {unknown[]} */ ([]),
        // The alignment, as far as the creator's placement reads the group
        // (its odometry position, the matrix it used, the settle).
        matrixWorld: {
          toArray: () => currentAlignment(),
        },
        /** World to the group's frame: the rigid inverse of the alignment,
         *  `R^T (v - t)`, in place like three's. */
        worldToLocal(v) {
          const m = currentAlignment();
          const d = [v.x - m[12], v.y - m[13], v.z - m[14]];
          const x = m[0] * d[0] + m[1] * d[1] + m[2] * d[2];
          const y = m[4] * d[0] + m[5] * d[1] + m[6] * d[2];
          const z = m[8] * d[0] + m[9] * d[1] + m[10] * d[2];
          v.x = x;
          v.y = y;
          v.z = z;
          return v;
        },
        add(object) {
          this.children.push(object);
        },
        remove(object) {
          this.children = this.children.filter((c) => c !== object);
        },
      };
      /** Scene-root stub for the image planes (real three meshes land here). */
      const fakeScene = {
        name: "fake-scene",
        children: /** @type {unknown[]} */ ([]),
        add(object) {
          this.children.push(object);
        },
        remove(object) {
          this.children = this.children.filter((c) => c !== object);
        },
      };
      test.fakeScene = fakeScene;
      /** @type {any} */ (window).__tourViewerSeams = {
        controllerDeps: {
          isWebXRSupported: () => Promise.resolve(true),
          requestGeolocationPermission: () => {
            test.geolocationPermissionRequests += 1;
            return Promise.resolve(test.controllerLocationResult);
          },
          requestOrientationPermission: () =>
            Promise.resolve({ granted: true }),
          requestWebXRWithDepthPermission: () =>
            Promise.resolve({ granted: true }),
          startGpsWatch: (onPosition) => {
            test.gpsCallback = onPosition;
          },
          startOrientationWatch: () => {},
          stopGpsWatch: () => {},
          stopOrientationWatch: () => {},
          initAR: (container, isolationOptions, features, callbacks) => {
            if (test.failNextInitAR) {
              test.failNextInitAR = false;
              return Promise.reject(new Error("The camera could not start."));
            }
            // As the framework does (webxr-session.ts initAR): a canvas the
            // size of the window, inserted as the overlay root's FIRST child.
            // Without it no e2e could see a panel pushed below the screen by
            // it - which is how the owner found the offer's buttons off
            // screen (2026-09-27).
            const canvas = document.createElement("canvas");
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            canvas.dataset.testid = "ar-canvas";
            container?.insertBefore(canvas, container.firstChild);
            test.initARCalls.push({
              hasCameraFrame: Boolean(callbacks?.cameraFrame),
              hasDepth: keepDepthCallback(callbacks),
              requestHitTest: Boolean(features?.requestHitTest),
              isolationOptions,
            });
            test.cameraFrameCallback = callbacks?.cameraFrame?.onFrame ?? null;
            // The controller's WRAPPED onSessionEnd — invoking it simulates
            // the XR session dying out from under the app.
            test.sessionEndCallback = callbacks?.onSessionEnd ?? null;
            if (!test.holdInitAR) return Promise.resolve();
            return new Promise((resolve) => {
              test.releaseInitAR = () => {
                test.holdInitAR = false;
                resolve(undefined);
              };
            });
          },
          endARSession: () => {
            test.endARSessionCalls += 1;
            // The real XR session fires its 'end' event on an app-requested
            // end too, which reaches the app's onSessionEnd through the
            // controller's wrapper - the finish step relies on that teardown.
            test.sessionEndCallback?.({ requestedByApp: true });
            return Promise.resolve();
          },
        },
        // Null until initAR ran — the framework builds the scene graph inside
        // initAR, and a fake that always returns the group made the debug-view
        // wiring assertion vacuous (PR #360 review).
        getArWorldGroup: () =>
          test.initARCalls.length > 0 ? worldGroup : null,
        // --- author-pipeline fakes (M3): the REAL controller/slice/stability
        // machinery runs; only the device-level detect/solve are scripted. ---
        createQrFrontEnd: () => ({
          kind: "barcode-detector",
          detect: () => Promise.resolve(test.nextDetection),
        }),
        solveQrPose: () => test.nextSolution,
        estimateQrPrintSize: () => {
          if (printSizeM === null) return null;
          const n = test.printSizeCalls;
          test.printSizeCalls += 1;
          return {
            sizeM: printSizeM,
            lateralBaselineM: 0.1,
            views: 8,
            oldestTimestamp: n * 4000,
            newestTimestamp: n * 4000 + 3875,
          };
        },
        getIntrinsics: () => ({ fx: 500, fy: 500, cx: 1, cy: 1 }),
        getScene: () => (test.initARCalls.length > 0 ? fakeScene : null),
        getArPose: () => test.arPose,
        createQrDebugView: () => ({
          update: () => {
            test.qrDebugUpdates += 1;
          },
          dispose: () => {
            test.qrDebugDisposals += 1;
          },
        }),
        enableArWorldGroupAlignment: (options) => {
          test.alignmentCalls.push({
            hasStore: Boolean(options.store),
            groupName: options.arWorldGroup?.name,
          });
          test.alignmentStore = options.store;
          return { dispose() {} };
        },
        startCameraFrameCapture: (config) => {
          test.captureCalls.push(config ?? {});
        },
        queryGeolocationPermission: () =>
          Promise.resolve(test.locationPermission),
        requestLocationOnce: () => {
          test.locationRequests += 1;
          if (test.locationOutcome === "granted") {
            test.locationPermission = "granted";
          }
          return Promise.resolve(test.locationOutcome);
        },
        shareOrDownloadZip: (blob, filename) => {
          test.downloads.push({ filename, blob, seam: "share-or-download" });
          // A test drives BOTH routes through one fake: `shareRoute` picks
          // which mechanism the app should believe ran, `saveOutcome`
          // whether anything left the page. The real share sheet cannot be
          // opened headlessly, so this seam is the only way the share copy
          // is ever exercised end to end.
          return Promise.resolve({
            route: test.shareRoute === true ? "share" : "download",
            delivered: test.saveOutcome,
          });
        },
        // Its own seam, recorded as such: a Drive tour must SAVE even on a
        // phone that could share (Drive replace plan §5 #4), and a spec can
        // only tell the routes apart by which seam ran.
        downloadZip: (blob, filename) => {
          test.downloads.push({ filename, blob, seam: "download" });
          return Promise.resolve(test.saveOutcome);
        },
        canShareZip: () => test.shareRoute === true,
        downloadPdf: (blob, filename) => {
          test.downloads.push({ filename, blob });
          // A test can HOLD the save open, which is the only deterministic
          // way to observe the button's in-progress state: the build itself
          // is fast enough that racing it is a flaky test, and a flaky test
          // for an async-UI rule is worse than none.
          if (!test.holdPdfSave) return Promise.resolve(test.saveOutcome);
          return new Promise((resolve) => {
            test.releasePdfSave = () => resolve(test.saveOutcome);
          });
        },
        openPdfTab: () =>
          test.pdfViewer
            ? {
                show: (blob) => {
                  test.pdfTabs.push({ shown: blob });
                },
                close: () => {
                  test.pdfTabs.push({ closed: true });
                },
              }
            : null,
        copyText: (text) => {
          test.copied.push(text);
          return Promise.resolve();
        },
        startHitTestReticle: (_group, onSelect, surfacePick) => {
          test.xrSelect = onSelect ?? null;
          test.reticleSurfacePick = typeof surfacePick === "function";
          return {
            isVisible: () => test.reticleVisible,
            getWorldPosition: (out) => {
              const [x, y, z] = test.reticlePosition;
              out.set(x, y, z);
              return out;
            },
            dispose: () => {
              test.reticleDisposals += 1;
            },
          };
        },
        // The camera ray, scripted: the stub scene has no geometry (the
        // real raycast is object-pick.test.ts's). Only an id the app
        // actually rendered can be hit.
        pickObjectInView: (targets) => {
          test.pickTargets = [...targets.keys()];
          return test.pickId !== null && targets.has(test.pickId)
            ? test.pickId
            : null;
        },
        encodeFrameJpeg: (image) => {
          test.encodedFrames += 1;
          return Promise.resolve({
            blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
              type: "image/jpeg",
            }),
            width: image.width,
            height: image.height,
          });
        },
        schedule: (fn, ms) => {
          const timer = { fn, ms, cancelled: false };
          test.timers.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
        // The stations' HUD (K4): no camera here, so the spec reads the
        // targets the page would point at.
        createWayfindingHud: (options) => {
          test.hudStarts += 1;
          const handle = { getTargets: options.getTargets, disposed: false };
          test.hud = handle;
          return {
            dispose() {
              handle.disposed = true;
            },
          };
        },
        // The stories' audio element (K4): headless Chromium cannot play
        // the fixture's bytes, so this records what would play.
        createAudioElement: () => {
          test.audioElements += 1;
          return {
            src: "",
            onended: null,
            play() {
              test.audioPlays.push(this.src);
              return Promise.resolve();
            },
            pause() {},
          };
        },
        // No `loadGlbModel` fake: the real seam runs three's GLTFLoader on
        // the fixture's minimal `.glb`.
        // No `createLabel` fake: Chromium has the canvas the real text
        // sprite needs. A plain-object stand-in was REFUSED by three's
        // Object3D.add (only a console error), so no spec saw a pin label
        // in the scene graph.
        stopCameraFrameCapture: () => {
          test.stopCaptureCalls += 1;
        },
        // The e2e scene has no depth to mesh: a stand-in that counts.
        startMeshSurface: () => {
          test.meshSurfaces += 1;
          return {
            pick: () => null,
            stats: () => ({ frame: null, triangles: 0 }),
            reset: () => undefined,
            dispose: () => {
              test.meshSurfaceDisposals += 1;
            },
          };
        },
        startDepthCapture: (config) => {
          test.depthCaptureCalls.push(config);
        },
        stopDepthCapture: () => {
          test.stopDepthCalls += 1;
        },
      };
    },
    { shareRoute, printSizeM, saveOutcome, pdfViewer },
  );
}

/**
 * Open the fixture tour on the creator's page (range streaming, no cache)
 * and open step 4. Shared by the editing and the summary specs.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function openFixtureTour(page) {
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(E2E_QR_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
  const step = page.getByTestId("step-measure");
  if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
    // The card shows one step; step 5's station dot opens it (M2b).
    await page.getByTestId("station-measure").click();
  }
}

/**
 * Enter AR and measure the fixture's code (it stores a pose, so the
 * measurement keeps it - D10b); placement unlocks. Shared by the editing
 * and the summary specs.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function enterArAndMeasure(page) {
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("enter-ar").click();
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

/**
 * Force the tracking-quality slice to `ok` (→ onboarding `ready`): the
 * alignment is then ready (`tour-flow.ts` `isPlacementReady`), so the walk's
 * photos place and the visitor's stations are judged without a code. The
 * fake initAR never dispatches poses, and `reportUpdated` is the slice's
 * own action (not a middleware input), so it is not recomputed away. Shared
 * by `ar-mode.spec.js` and `sample-tour.spec.js`.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function forceTrackingReady(page) {
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

/**
 * The session zero plus three consistent fixes - the alignment a placement
 * is expressed against (and that the votes refine). Shared by the specs
 * that place, edit or lay out the AR panel; it was copied into two of them.
 *
 * The fixes are the phone's own, so they are where the phone WAS: since a
 * station is reached by the phone's best position alone (tour editor plan
 * D16), the walk can reach one. By default it goes 15 m north, then 15 m
 * east; `southWest` walks 15 m south, then 15 m west instead, for a spec
 * whose station stands 15 m north of the zero.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ southWest?: boolean }} [options]
 */
export async function seedAlignment(page, { southWest = false } = {}) {
  await page.evaluate((southWest) => {
    const store = /** @type {any} */ (window).__tourViewerTest.alignmentStore;
    store.dispatch({
      type: "gpsData/setZeroPos",
      payload: { lat: 47.5, lon: 8.7 },
    });
    const pairs = [
      { odom: [0, 0, 0], lat: 47.5, lon: 8.7 },
      ...(southWest
        ? [
            { odom: [0, 0, 15], lat: 47.499865, lon: 8.7 },
            { odom: [-15, 0, 0], lat: 47.5, lon: 8.6998 },
          ]
        : [
            { odom: [0, 0, -15], lat: 47.500135, lon: 8.7 },
            { odom: [15, 0, 0], lat: 47.5, lon: 8.7002 },
          ]),
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
  }, southWest);
}

/** Metres to degrees at the fakes' zero (47.5, 8.7). */
const DEG_PER_M_LAT = 8.9832e-6;
const DEG_PER_M_LON = 1.32966e-5;

/**
 * One device fix with the phone `north`/`east` metres from the zero in
 * GPS-world terms: the fix reads that spot, and the AR pose is that spot
 * taken back through the store's CURRENT alignment (whatever the code's
 * votes made of it), so the camera stands exactly there.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} north
 * @param {number} east
 * @param {number | "now"} second the fix's second on the fakes' clock,
 *   or "now": a fix the guide's wall clock calls fresh
 * @param {number} [accuracy]
 */
export async function standAt(page, north, east, second, accuracy = 4) {
  await page.evaluate(
    ({ north, east, lat, lon, timestamp, accuracy }) => {
      const test = /** @type {any} */ (window).__tourViewerTest;
      const m =
        test.alignmentStore.getState().gpsData?.gpsEvents?.alignmentMatrix;
      const a =
        m != null && m.length === 16
          ? Array.from(m)
          : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      // World NUE -> odometry NUE: the rigid inverse R^T (w - t).
      const d = [north - a[12], 1.4 - a[13], east - a[14]];
      const n = a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
      const u = a[4] * d[0] + a[5] * d[1] + a[6] * d[2];
      const e = a[8] * d[0] + a[9] * d[1] + a[10] * d[2];
      test.emitGps({
        lat,
        lon,
        accuracy,
        // A fix of now (`second` "now"): fresh to the guide's clock.
        timestamp: timestamp ?? Date.now(),
        arPosition: [e, u, -n], // raw WebXR: x East, y Up, z South
      });
    },
    {
      north,
      east,
      lat: 47.5 + north * DEG_PER_M_LAT,
      lon: 8.7 + east * DEG_PER_M_LON,
      timestamp: second === "now" ? null : 1_790_000_000_000 + second * 1000,
      accuracy,
    },
  );
}

/**
 * The AR session's own tracking, as the framework's tracking slice hears it
 * (visitor walk W4 build plan M3): `true` delivers one pose (the phase
 * becomes `tracking`), `false` reports it lost. The fakes deliver no poses
 * otherwise, so the tracking-quality report reads `ar-lost` ("not
 * tracking") after every recompute - a device fix, a code's vote - until a
 * spec reports a pose; a forced `ok` report does not survive the next one.
 *
 * @param {import("@playwright/test").Page} page
 * @param {boolean} [tracking]
 */
export async function reportArTracking(page, tracking = true) {
  await page.evaluate((tracking) => {
    const test = /** @type {any} */ (window).__tourViewerTest;
    test.alignmentStore.dispatch(
      tracking
        ? {
            type: "tracking/poseReceived",
            payload: {
              pose: test.arPose ?? {
                position: { x: 0, y: 1.4, z: 0 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
              },
              sensorOrientation: null,
            },
          }
        : { type: "tracking/poseLost" },
    );
    test.emitFrames(1);
  }, tracking);
}

/**
 * Turn the camera to look along `bearingDeg` (degrees from north) in
 * GPS-world terms, through the store's CURRENT alignment: a yaw about raw
 * +Y. The pose keeps its position; later fixes keep the orientation. A
 * camera frame re-judges the stations (visitor walk W4 build plan M3).
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} bearingDeg
 */
export async function faceBearing(page, bearingDeg) {
  await page.evaluate((bearingDeg) => {
    const test = /** @type {any} */ (window).__tourViewerTest;
    const m =
      test.alignmentStore.getState().gpsData?.gpsEvents?.alignmentMatrix;
    const a =
      m != null && m.length === 16
        ? Array.from(m)
        : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    // The alignment's yaw: where odometry north points in the world.
    const alignYaw = Math.atan2(a[2], a[0]);
    // A raw yaw t looks at odometry bearing -t, so the world bearing is
    // alignYaw - t.
    const t = alignYaw - (bearingDeg * Math.PI) / 180;
    test.facing = { x: 0, y: Math.sin(t / 2), z: 0, w: Math.cos(t / 2) };
    if (test.arPose !== null) {
      test.arPose = { ...test.arPose, orientation: { ...test.facing } };
    }
    test.emitFrames(1);
  }, bearingDeg);
}

/** Every file entry's name, and each JSON entry's text, of a zip's bytes. */
export async function readZip(bytes) {
  const reader = new ZipReader(new BlobReader(new Blob([bytes])));
  const names = [];
  const json = {};
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    names.push(entry.filename);
    if (entry.filename.endsWith(".json")) {
      json[entry.filename] = await entry.getData(new TextWriter());
    }
  }
  await reader.close();
  return { names, json };
}

/** The level files (`qr/*.json`) of a zip, by entry name, as text. */
export async function levelTexts(bytes) {
  const { json } = await readZip(bytes);
  return Object.fromEntries(
    Object.entries(json).filter(([name]) => name.startsWith("qr/")),
  );
}

/** The world view needs the core geodesy, which runs under an activated
 *  licence: activated once, as the app does at boot. */
let licensed = false;

/**
 * A `tour.json` text parsed, with its pins and photos in the world as
 * `objects` (version 3 keeps them in stations at local poses, tour editor
 * plan W3) - what the specs read back from a written tour.
 * @param {string} text
 */
export function worldManifest(text) {
  if (!licensed) {
    createSlamAppStore({ storageBackend: new NullStorageBackend() });
    licensed = true;
  }
  const manifest = parseTourManifest(JSON.parse(text));
  return { ...manifest, objects: tourObjects(manifest) };
}

/** Entry names, the manifest and the level files of the n-th downloaded zip. */
export async function downloadedZip(page, index) {
  const data = await page.evaluate(async (i) => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads[i];
    return Array.from(new Uint8Array(await d.blob.arrayBuffer()));
  }, index);
  const bytes = new Uint8Array(data);
  const { names, json } = await readZip(bytes);
  return {
    names,
    manifest: worldManifest(json["tour.json"]),
    levels: await levelTexts(bytes),
  };
}

/**
 * The creator's Finish: in a session the AR button's Done (polish round
 * M3, Q-Done - the panel's Finish is hidden there), on the page the
 * panel's Finish. Which one is the page's own state, not the test's.
 */
export async function tapFinish(page) {
  const inSession = await page.evaluate(
    () => document.body.dataset["arActive"] === "true",
  );
  if (!inSession) {
    await page.getByTestId("setup-finish").click();
    return;
  }
  // After a failed finish the AR button only leaves ("Close AR") and the
  // panel's Finish is back in AR as the retry; otherwise the panel's
  // Finish must be hidden in AR - asserted, so a Finish that wrongly showed
  // there could not quietly carry every Done-path test (M3 review #11).
  if (
    (await page.getByTestId("enter-ar").textContent())?.trim() === "Close AR"
  ) {
    await page.getByTestId("setup-finish").click();
    return;
  }
  await expect(page.getByTestId("setup-finish")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).toHaveText("Done");
  await page.getByTestId("enter-ar").click();
}

/**
 * Finish, then download: the zip lands in the fake's downloads as the
 * `index`-th. The Finish button is disabled while the zip is rebuilt, so
 * waiting for it to leave that state is waiting for THIS rebuild - a second
 * Finish finds the first one's download button already live. It leaves it
 * enabled when work remains, or hidden when nothing is left to write
 * (code book plan M4d: an unchanged stored code is not work).
 */
export async function finishAndDownload(page, index) {
  const finish = page.getByTestId("setup-finish");
  await tapFinish(page);
  await expect
    .poll(async () => (await finish.isHidden()) || (await finish.isEnabled()), {
      timeout: 30000,
    })
    .toBe(true);
  await expect(page.getByTestId("finish-block")).toBeVisible();
  // The Finish saves the zip by itself (field test 2, F4).
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourViewerTest.downloads.length,
      ),
    )
    .toBe(index + 1);
}

/**
 * Lock the fixture's printed code: arm the detection and feed frames until
 * the gate reports that the CODE passed it (a GPS-only pass also reads
 * "placing"). The walk specs share it (visitor walk W4 build plan M2).
 *
 * @param {import("@playwright/test").Page} page
 */
export async function lockFixtureCode(page) {
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
    .toBe("passed-code");
}

/**
 * Wait for the guide to name a station again (visitor walk W4 build plan
 * M4, §1.9 R-2): an any-order tour names none while no distance is shown
 * (pending at the start of AR among them), and again only once the
 * distance has been back for the hold - 3 s of the page's own clock. The
 * guide re-judges on events, so camera frames are sent until the peek
 * names one (a peek of kind `none` names none). A fixed-order tour, or one
 * with a single station left, names one at once.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function waitForTheGuess(page) {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("walk-peek").getAttribute("data-kind");
      },
      { timeout: 15000, intervals: [250, 500, 1000] },
    )
    .not.toBe("none");
}

/**
 * Tap a row's control in the walk's list (visitor walk W4 build plan M4):
 * `act` (Skip, Bring back, the undo), `main` ("Guide me here"), `confirm`
 * or `cancel`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} title the row's station title
 * @param {"act" | "main" | "confirm" | "cancel"} control
 */
export function walkRowControl(page, title, control) {
  return page
    .getByTestId("walk-row")
    .filter({ hasText: title })
    .getByTestId(`walk-row-${control}`);
}
