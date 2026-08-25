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
          return Promise.resolve();
        },
        endARSession: () => {
          test.endARSessionCalls += 1;
          return Promise.resolve();
        },
      },
      getArWorldGroup: () => worldGroup,
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
