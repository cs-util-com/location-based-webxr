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
 */
export async function installTourViewerArFakes(page) {
  await page.addInitScript(() => {
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
      /** Simulate a SYSTEM session end (the Android back gesture). */
      endXrSession() {
        test.sessionEndCallback?.({ requestedByApp: false });
      },
    };
    /** @type {any} */ (window).__tourViewerTest = test;

    const worldGroup = { name: "fake-world-group" };
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
        initAR: (_container, isolationOptions, _features, callbacks) => {
          test.initARCalls.push({
            hasCameraFrame: Boolean(callbacks?.cameraFrame),
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
      stopCameraFrameCapture: () => {
        test.stopCaptureCalls += 1;
      },
    };
  });
}
