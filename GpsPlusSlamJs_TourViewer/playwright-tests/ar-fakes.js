// @ts-check
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
 * @param {{ shareRoute?: boolean, printSizeM?: number }} [options]
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
  await page.addInitScript(
    ({ shareRoute, printSizeM }) => {
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
        /** What the next location-only tap comes back with. */
        locationOutcome: "granted",
        /** The zips the finish step offered for download (M3): the fake
         *  captures them instead of saving; `saveOutcome` is what the fake
         *  reports (false = the picker was dismissed). */
        downloads:
          /** @type {{ filename: string, blob: Blob, seam?: "share-or-download" | "download" }[]} */ ([]),
        saveOutcome: true,
        /** Which route the zip hand-off should take. False (the default)
         *  keeps every existing test on the save path; true makes the app
         *  label its buttons "share" and report the share copy. */
        shareRoute,
        /** Hold downloadPdf open so a test can observe the busy state. */
        holdPdfSave: false,
        releasePdfSave: () => undefined,
        /** The creator's reticle (M4): whether a surface is under it and
         *  where, in GPS-world NUE. */
        reticleVisible: true,
        reticlePosition: [3, 400.5, -2],
        reticleDisposals: 0,
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
            orientation: { x: 0, y: 0, z: 0, w: 1 },
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
          requestGeolocationPermission: () =>
            Promise.resolve({ granted: true }),
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
            return Promise.resolve();
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
        startHitTestReticle: (_group, onSelect) => {
          test.xrSelect = onSelect ?? null;
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
        startDepthCapture: (config) => {
          test.depthCaptureCalls.push(config);
        },
        stopDepthCapture: () => {
          test.stopDepthCalls += 1;
        },
      };
    },
    { shareRoute, printSizeM },
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
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
  const step = page.getByTestId("step-measure");
  if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
    await step.locator("summary").click();
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
 * The session zero plus three consistent fixes - the alignment a placement
 * is expressed against (and that the votes refine). Shared by the specs
 * that place, edit or lay out the AR panel; it was copied into two of them.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function seedAlignment(page) {
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

/** Metres to degrees at the fakes' zero (47.5, 8.7). */
const DEG_PER_M_LAT = 8.9832e-6;
const DEG_PER_M_LON = 1.32966e-5;

/**
 * One device fix with the phone `north`/`east` metres from the zero in
 * GPS-world terms: the fix reads that spot, and the AR pose is that spot
 * taken back through the store's CURRENT alignment (whatever the code's
 * votes made of it), so the camera stands exactly there.
 */
export async function standAt(page, north, east, second) {
  await page.evaluate(
    ({ north, east, lat, lon, timestamp }) => {
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
        accuracy: 4,
        timestamp,
        arPosition: [e, u, -n], // raw WebXR: x East, y Up, z South
      });
    },
    {
      north,
      east,
      lat: 47.5 + north * DEG_PER_M_LAT,
      lon: 8.7 + east * DEG_PER_M_LON,
      timestamp: 1_790_000_000_000 + second * 1000,
    },
  );
}
