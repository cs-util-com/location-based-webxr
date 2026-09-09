// @ts-check
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
 * @param {{ shareRoute?: boolean }} [options] `shareRoute` must be set HERE
 *   rather than through `__tourViewerTest` afterwards: the app reads the
 *   share capability once, while wiring its buttons, so a spec that flipped
 *   it after load would get the share copy under a "download" label.
 */
export async function installTourViewerArFakes(page, options = {}) {
  const shareRoute = options.shareRoute === true;
  await page.addInitScript((shareRoute) => {
    const test = {
      /** @type {{ hasCameraFrame: boolean, isolationOptions: unknown }[]} */
      initARCalls: [],
      /** @type {unknown[]} */
      captureCalls: [],
      /** @type {{ hasStore: boolean, groupName: string | undefined }[]} */
      alignmentCalls: [],
      stopCaptureCalls: 0,
      endARSessionCalls: 0,
      /** The store the alignment binding received — lets specs assert the
       *  recording slice actually started (the silent-drop trap). */
      alignmentStore: /** @type {any} */ (null),
      cameraFrameCallback: /** @type {any} */ (null),
      /** Deliver n fake RGBA frames through the initAR camera callback. */
      emitFrames(n = 1) {
        for (let i = 0; i < n; i += 1) {
          test.cameraFrameCallback?.({
            data: new Uint8ClampedArray(16),
            width: 2,
            height: 2,
          });
        }
      },
      /** Scripted device-level QR results for the author pipeline (M3). */
      nextDetection: /** @type {any} */ (null),
      nextSolution: /** @type {any} */ (null),
      qrDebugUpdates: 0,
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
      downloads: /** @type {{ filename: string, blob: Blob }[]} */ ([]),
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
      /** Photos "encoded" by the fake (a 3-byte stand-in per capture). */
      encodedFrames: 0,
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
    };
    /** @type {any} */ (window).__tourViewerTest = test;

    const worldGroup = {
      name: "fake-world-group",
      children: /** @type {unknown[]} */ ([]),
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
        requestGeolocationPermission: () => Promise.resolve({ granted: true }),
        requestOrientationPermission: () => Promise.resolve({ granted: true }),
        requestWebXRWithDepthPermission: () =>
          Promise.resolve({ granted: true }),
        startGpsWatch: () => {},
        startOrientationWatch: () => {},
        stopGpsWatch: () => {},
        stopOrientationWatch: () => {},
        initAR: (_container, isolationOptions, features, callbacks) => {
          test.initARCalls.push({
            hasCameraFrame: Boolean(callbacks?.cameraFrame),
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
      getArWorldGroup: () => (test.initARCalls.length > 0 ? worldGroup : null),
      // --- author-pipeline fakes (M3): the REAL controller/slice/stability
      // machinery runs; only the device-level detect/solve are scripted. ---
      createQrFrontEnd: () => ({
        kind: "barcode-detector",
        detect: () => Promise.resolve(test.nextDetection),
      }),
      solveQrPose: () => test.nextSolution,
      getCameraPose: () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1] }),
      getIntrinsics: () => ({ fx: 500, fy: 500, cx: 1, cy: 1 }),
      getScene: () => (test.initARCalls.length > 0 ? fakeScene : null),
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
        test.downloads.push({ filename, blob });
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
      startHitTestReticle: () => ({
        isVisible: () => test.reticleVisible,
        getWorldPosition: (out) => {
          const [x, y, z] = test.reticlePosition;
          out.set(x, y, z);
          return out;
        },
        dispose: () => {
          test.reticleDisposals += 1;
        },
      }),
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
      createLabel: (text) => {
        // A bare three Object3D stands in for the canvas-backed sprite.
        const object = { name: `label:${text}`, position: { set() {} } };
        return { object, dispose() {} };
      },
      stopCameraFrameCapture: () => {
        test.stopCaptureCalls += 1;
      },
    };
  }, shareRoute);
}
